/**
 * Система пула подключений для SurrealDB ORM
 */

import { ConnectionManager } from '../core/connection';
import type { ConnectionConfig } from '../core/connection';
import type { ILogger, Future } from '../../helpers';

// Конфигурация пула
export interface PoolConfig extends ConnectionConfig {
	minConnections?: number;
	maxConnections?: number;
	acquireTimeout?: number;
	releaseTimeout?: number;
	idleTimeout?: number;
	healthCheckInterval?: number;
	retryAttempts?: number;
	retryDelay?: number;
}

// Состояние подключения в пуле
export interface PooledConnection {
	connection: ConnectionManager;
	inUse: boolean;
	lastUsed: number;
	createdAt: number;
	healthCheckCount: number;
	lastHealthCheck: number;
}

// Статистика пула
export interface PoolStats {
	totalConnections: number;
	activeConnections: number;
	idleConnections: number;
	waitingRequests: number;
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;
	avgAcquisitionTime: number;
	avgConnectionLifetime: number;
}

// Пул подключений
export class ConnectionPool {
	private connections: PooledConnection[] = [];
	private waitingQueue: Array<{
		resolve: (connection: ConnectionManager) => void;
		reject: (error: Error) => void;
		timestamp: number;
		timeout: NodeJS.Timeout;
	}> = [];
	private config: Required<PoolConfig> & ConnectionConfig;
	private logger: ILogger;
	private future: Future;
	private healthCheckTimer?: NodeJS.Timeout;
	private cleanupTimer?: NodeJS.Timeout;
	private stats = {
		totalRequests: 0,
		successfulRequests: 0,
		failedRequests: 0,
		totalAcquisitionTime: 0,
	};

	constructor(config: PoolConfig, logger: ILogger, future: Future) {
		this.config = {
			minConnections: config.minConnections ?? 2,
			maxConnections: config.maxConnections ?? 10,
			acquireTimeout: config.acquireTimeout ?? 30000,
			releaseTimeout: config.releaseTimeout ?? 5000,
			idleTimeout: config.idleTimeout ?? 300000, // 5 минут
			healthCheckInterval: config.healthCheckInterval ?? 60000, // 1 минута
			retryAttempts: config.retryAttempts ?? 3,
			retryDelay: config.retryDelay ?? 1000,
			timeout: config.timeout ?? 30000,
			heartbeatInterval: config.heartbeatInterval ?? 30000,
			reconnectOnClose: config.reconnectOnClose ?? true,
			maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
			reconnectDelay: config.reconnectDelay ?? 5000,
			rpc: config.rpc,
			namespace: config.namespace,
			database: config.database,
			user: config.user,
			pass: config.pass,
		};
		this.logger = logger;
		this.future = future;

		this.initialize();
	}

	/**
	 * Инициализация пула
	 */
	private async initialize(): Promise<void> {
		try {
			// Создание минимального количества подключений
			for (let i = 0; i < this.config.minConnections; i++) {
				await this.createConnection();
			}

			// Запуск health check
			this.startHealthCheck();

			// Запуск очистки неактивных подключений
			this.startCleanup();

			this.logger.info(
				{ module: 'ConnectionPool', method: 'initialize' },
				`Pool initialized with ${this.config.minConnections} connections`
			);
		} catch (error) {
			this.logger.error(
				{ module: 'ConnectionPool', method: 'initialize' },
				`Failed to initialize pool: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
			throw error;
		}
	}

	/**
	 * Получение подключения из пула
	 */
	async acquire(): Promise<ConnectionManager> {
		const startTime = Date.now();
		this.stats.totalRequests++;

		try {
			// Поиск свободного подключения
			let pooledConnection = this.connections.find(
				(conn) => !conn.inUse && conn.connection.isConnected()
			);

			if (!pooledConnection) {
				// Создание нового подключения, если не достигнут лимит
				if (this.connections.length < this.config.maxConnections) {
					pooledConnection = await this.createConnection();
				} else {
					// Ожидание освобождения подключения
					pooledConnection = await this.waitForConnection();
				}
			}

			if (!pooledConnection) {
				throw new Error('Failed to acquire connection');
			}

			// Помечаем подключение как используемое
			pooledConnection.inUse = true;
			pooledConnection.lastUsed = Date.now();

			const acquisitionTime = Date.now() - startTime;
			this.stats.totalAcquisitionTime += acquisitionTime;
			this.stats.successfulRequests++;

			this.logger.debug(
				{ module: 'ConnectionPool', method: 'acquire' },
				`Connection acquired in ${acquisitionTime}ms`
			);

			return pooledConnection.connection;
		} catch (error) {
			this.stats.failedRequests++;
			this.logger.error(
				{ module: 'ConnectionPool', method: 'acquire' },
				`Failed to acquire connection: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
			throw error;
		}
	}

	/**
	 * Возврат подключения в пул
	 */
	async release(connection: ConnectionManager): Promise<void> {
		const pooledConnection = this.connections.find(
			(conn) => conn.connection === connection
		);

		if (!pooledConnection) {
			this.logger.warn(
				{ module: 'ConnectionPool', method: 'release' },
				'Attempted to release unknown connection'
			);
			return;
		}

		// Проверка состояния подключения
		if (!connection.isConnected()) {
			this.logger.warn(
				{ module: 'ConnectionPool', method: 'release' },
				'Released connection is not connected, removing from pool'
			);
			await this.removeConnection(pooledConnection);
			return;
		}

		// Освобождение подключения
		pooledConnection.inUse = false;
		pooledConnection.lastUsed = Date.now();

		// Обработка ожидающих запросов
		this.processWaitingQueue();

		this.logger.debug(
			{ module: 'ConnectionPool', method: 'release' },
			'Connection released back to pool'
		);
	}

	/**
	 * Создание нового подключения
	 */
	private async createConnection(): Promise<PooledConnection> {
		const connection = new ConnectionManager(
			this.config,
			this.logger,
			this.future
		);

		try {
			await connection.connect();

			const pooledConnection: PooledConnection = {
				connection,
				inUse: false,
				lastUsed: Date.now(),
				createdAt: Date.now(),
				healthCheckCount: 0,
				lastHealthCheck: Date.now(),
			};

			this.connections.push(pooledConnection);

			this.logger.info(
				{ module: 'ConnectionPool', method: 'createConnection' },
				`New connection created. Pool size: ${this.connections.length}`
			);

			return pooledConnection;
		} catch (error) {
			this.logger.error(
				{ module: 'ConnectionPool', method: 'createConnection' },
				`Failed to create connection: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
			throw error;
		}
	}

	/**
	 * Ожидание освобождения подключения
	 */
	private async waitForConnection(): Promise<PooledConnection | undefined> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				const index = this.waitingQueue.findIndex(
					(req) => req.timeout === timeout
				);
				if (index > -1) {
					this.waitingQueue.splice(index, 1);
				}
				reject(new Error('Connection acquisition timeout'));
			}, this.config.acquireTimeout);

			this.waitingQueue.push({
				resolve: (connection: ConnectionManager) => {
					clearTimeout(timeout);
					const pooledConnection = this.connections.find(
						(conn) => conn.connection === connection
					);
					resolve(pooledConnection || undefined);
				},
				reject: (error: Error) => {
					clearTimeout(timeout);
					reject(error);
				},
				timestamp: Date.now(),
				timeout,
			});
		});
	}

	/**
	 * Обработка очереди ожидания
	 */
	private processWaitingQueue(): void {
		if (this.waitingQueue.length === 0) return;

		const availableConnection = this.connections.find(
			(conn) => !conn.inUse && conn.connection.isConnected()
		);
		if (!availableConnection) return;

		const waitingRequest = this.waitingQueue.shift();
		if (waitingRequest) {
			availableConnection.inUse = true;
			availableConnection.lastUsed = Date.now();
			waitingRequest.resolve(availableConnection.connection);
		}
	}

	/**
	 * Удаление подключения из пула
	 */
	private async removeConnection(
		pooledConnection: PooledConnection
	): Promise<void> {
		const index = this.connections.indexOf(pooledConnection);
		if (index > -1) {
			this.connections.splice(index, 1);

			try {
				await pooledConnection.connection.disconnect();
			} catch (error) {
				this.logger.warn(
					{ module: 'ConnectionPool', method: 'removeConnection' },
					`Error disconnecting connection: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
			}
		}
	}

	/**
	 * Запуск health check
	 */
	private startHealthCheck(): void {
		this.healthCheckTimer = setInterval(async () => {
			await this.performHealthCheck();
		}, this.config.healthCheckInterval);
	}

	/**
	 * Выполнение health check
	 */
	private async performHealthCheck(): Promise<void> {
		for (const pooledConnection of this.connections) {
			try {
				if (!pooledConnection.connection.isConnected()) {
					this.logger.warn(
						{
							module: 'ConnectionPool',
							method: 'performHealthCheck',
						},
						'Unhealthy connection detected, removing from pool'
					);
					await this.removeConnection(pooledConnection);
					continue;
				}

				// Простой ping для проверки соединения
				await pooledConnection.connection.send({
					method: 'ping',
					params: [],
				});

				pooledConnection.healthCheckCount++;
				pooledConnection.lastHealthCheck = Date.now();
			} catch (error) {
				this.logger.warn(
					{ module: 'ConnectionPool', method: 'performHealthCheck' },
					`Health check failed for connection: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
				await this.removeConnection(pooledConnection);
			}
		}

		// Восстановление минимального количества подключений
		while (this.connections.length < this.config.minConnections) {
			try {
				await this.createConnection();
			} catch (error) {
				this.logger.error(
					{ module: 'ConnectionPool', method: 'performHealthCheck' },
					`Failed to restore connection during health check: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
				break;
			}
		}
	}

	/**
	 * Запуск очистки неактивных подключений
	 */
	private startCleanup(): void {
		this.cleanupTimer = setInterval(async () => {
			await this.cleanupIdleConnections();
		}, this.config.idleTimeout / 2);
	}

	/**
	 * Очистка неактивных подключений
	 */
	private async cleanupIdleConnections(): Promise<void> {
		const now = Date.now();
		const connectionsToRemove: PooledConnection[] = [];

		for (const pooledConnection of this.connections) {
			if (
				!pooledConnection.inUse &&
				now - pooledConnection.lastUsed > this.config.idleTimeout &&
				this.connections.length > this.config.minConnections
			) {
				connectionsToRemove.push(pooledConnection);
			}
		}

		for (const connection of connectionsToRemove) {
			await this.removeConnection(connection);
		}

		if (connectionsToRemove.length > 0) {
			this.logger.info(
				{ module: 'ConnectionPool', method: 'cleanupIdleConnections' },
				`Cleaned up ${connectionsToRemove.length} idle connections`
			);
		}
	}

	/**
	 * Получение статистики пула
	 */
	getStats(): PoolStats {
		const activeConnections = this.connections.filter(
			(conn) => conn.inUse
		).length;
		const idleConnections = this.connections.filter(
			(conn) => !conn.inUse
		).length;
		const avgAcquisitionTime =
			this.stats.totalRequests > 0 ?
				this.stats.totalAcquisitionTime / this.stats.totalRequests
			:	0;
		const avgConnectionLifetime =
			this.connections.length > 0 ?
				this.connections.reduce(
					(sum, conn) => sum + (Date.now() - conn.createdAt),
					0
				) / this.connections.length
			:	0;

		return {
			totalConnections: this.connections.length,
			activeConnections,
			idleConnections,
			waitingRequests: this.waitingQueue.length,
			totalRequests: this.stats.totalRequests,
			successfulRequests: this.stats.successfulRequests,
			failedRequests: this.stats.failedRequests,
			avgAcquisitionTime,
			avgConnectionLifetime,
		};
	}

	/**
	 * Закрытие пула
	 */
	async close(): Promise<void> {
		// Остановка таймеров
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
		}
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
		}

		// Отклонение всех ожидающих запросов
		for (const waitingRequest of this.waitingQueue) {
			waitingRequest.reject(new Error('Pool is closing'));
		}
		this.waitingQueue = [];

		// Закрытие всех подключений
		await Promise.all(
			this.connections.map((conn) => conn.connection.disconnect())
		);

		this.connections = [];
		this.logger.info(
			{ module: 'ConnectionPool', method: 'close' },
			'Pool closed'
		);
	}
}
