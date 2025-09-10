/**
 * Улучшенная система подключений для SurrealDB ORM
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { SurrealENV } from '../../types';
import type { ILogger, Future } from '../../helpers';
import { ConnectionError, AuthenticationError, TimeoutError } from '../errors';

// Состояния подключения
export enum ConnectionState {
	DISCONNECTED = 'disconnected',
	CONNECTING = 'connecting',
	CONNECTED = 'connected',
	AUTHENTICATING = 'authenticating',
	AUTHENTICATED = 'authenticated',
	ERROR = 'error',
}

// Конфигурация подключения
export interface ConnectionConfig extends SurrealENV {
	timeout?: number;
	retryAttempts?: number;
	retryDelay?: number;
	heartbeatInterval?: number;
	reconnectOnClose?: boolean;
	maxReconnectAttempts?: number;
	reconnectDelay?: number;
}

// События подключения
export interface ConnectionEvents {
	stateChange: (
		state: ConnectionState,
		previousState: ConnectionState
	) => void;
	connected: () => void;
	disconnected: () => void;
	error: (error: Error) => void;
	message: (message: any) => void;
	heartbeat: () => void;
}

// Менеджер подключений
export class ConnectionManager extends EventEmitter {
	private ws: WebSocket | null = null;
	private state: ConnectionState = ConnectionState.DISCONNECTED;
	private config: Required<ConnectionConfig> & SurrealENV;
	private logger: ILogger;
	private future: Future;
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private reconnectAttempts = 0;
	private messageQueue: Array<{
		message: any;
		resolve: Function;
		reject: Function;
	}> = [];
	private pendingMessages = new Map<
		string,
		{ resolve: Function; reject: Function; timeout: NodeJS.Timeout }
	>();

	constructor(config: ConnectionConfig, logger: ILogger, future: Future) {
		super();
		this.config = {
			timeout: config.timeout ?? 30000,
			retryAttempts: config.retryAttempts ?? 3,
			retryDelay: config.retryDelay ?? 1000,
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
	}

	/**
	 * Подключение к SurrealDB
	 */
	async connect(): Promise<void> {
		if (
			this.state === ConnectionState.CONNECTED ||
			this.state === ConnectionState.CONNECTING
		) {
			return;
		}

		this.setState(ConnectionState.CONNECTING);

		try {
			await this.establishConnection();
			await this.authenticate();
			this.startHeartbeat();
			this.setState(ConnectionState.CONNECTED);
			this.emit('connected');
		} catch (error) {
			this.setState(ConnectionState.ERROR);
			this.emit('error', error);
			throw error;
		}
	}

	/**
	 * Отключение от SurrealDB
	 */
	async disconnect(): Promise<void> {
		this.setState(ConnectionState.DISCONNECTED);
		this.stopHeartbeat();
		this.clearReconnectTimer();

		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		// Отклонение всех ожидающих сообщений
		for (const [id, pending] of this.pendingMessages.entries()) {
			clearTimeout(pending.timeout);
			pending.reject(new ConnectionError('Connection closed'));
		}
		this.pendingMessages.clear();

		this.emit('disconnected');
	}

	/**
	 * Отправка сообщения
	 */
	async send<T = any>(message: any): Promise<T> {
		if (this.state !== ConnectionState.CONNECTED) {
			throw new ConnectionError('Not connected to database');
		}

		return new Promise<T>((resolve, reject) => {
			const id = this.generateMessageId();
			const timeout = setTimeout(() => {
				this.pendingMessages.delete(id);
				reject(
					new TimeoutError('Message timeout', this.config.timeout)
				);
			}, this.config.timeout);

			this.pendingMessages.set(id, { resolve, reject, timeout });

			const messageWithId = { ...message, id };

			try {
				this.ws!.send(JSON.stringify(messageWithId));
			} catch (error) {
				this.pendingMessages.delete(id);
				clearTimeout(timeout);
				reject(new ConnectionError('Failed to send message'));
			}
		});
	}

	/**
	 * Получение текущего состояния
	 */
	getState(): ConnectionState {
		return this.state;
	}

	/**
	 * Проверка подключения
	 */
	isConnected(): boolean {
		return this.state === ConnectionState.CONNECTED;
	}

	/**
	 * Установка соединения
	 */
	private async establishConnection(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.config.rpc);

				const timeout = setTimeout(() => {
					reject(
						new TimeoutError(
							'Connection timeout',
							this.config.timeout
						)
					);
				}, this.config.timeout);

				this.ws.on('open', () => {
					clearTimeout(timeout);
					this.logger.info(
						{
							module: 'ConnectionManager',
							method: 'establishConnection',
						},
						'WebSocket connected'
					);
					resolve();
				});

				this.ws.on('error', (error) => {
					clearTimeout(timeout);
					this.logger.error(
						{
							module: 'ConnectionManager',
							method: 'establishConnection',
						},
						error
					);
					reject(
						new ConnectionError(`WebSocket error: ${error.message}`)
					);
				});

				this.ws.on('close', (code, reason) => {
					this.logger.warn(
						{
							module: 'ConnectionManager',
							method: 'establishConnection',
						},
						`WebSocket closed: ${code} ${reason.toString()}`
					);

					if (
						this.state === ConnectionState.CONNECTED &&
						this.config.reconnectOnClose
					) {
						this.scheduleReconnect();
					}
				});

				this.ws.on('message', (data) => {
					try {
						const message = JSON.parse(data.toString());
						this.handleMessage(message);
					} catch (error) {
						this.logger.error(
							{
								module: 'ConnectionManager',
								method: 'establishConnection',
							},
							`Failed to parse message: ${error instanceof Error ? error.message : 'Unknown error'}`
						);
					}
				});
			} catch (error) {
				reject(
					new ConnectionError(
						`Failed to create WebSocket: ${error instanceof Error ? error.message : 'Unknown error'}`
					)
				);
			}
		});
	}

	/**
	 * Аутентификация
	 */
	private async authenticate(): Promise<void> {
		this.setState(ConnectionState.AUTHENTICATING);

		try {
			// Signin
			await this.send({
				method: 'signin',
				params: [
					{
						user: this.config.user,
						pass: this.config.pass,
					},
				],
			});

			// Use namespace and database
			await this.send({
				method: 'use',
				params: [this.config.namespace, this.config.database],
			});

			this.setState(ConnectionState.AUTHENTICATED);
			this.logger.info(
				{ module: 'ConnectionManager', method: 'authenticate' },
				'Authentication successful'
			);
		} catch (error) {
			throw new AuthenticationError(
				`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Обработка входящих сообщений
	 */
	private handleMessage(message: any): void {
		this.emit('message', message);

		// Обработка ответов на запросы
		if (message.id && this.pendingMessages.has(message.id)) {
			const pending = this.pendingMessages.get(message.id)!;
			clearTimeout(pending.timeout);
			this.pendingMessages.delete(message.id);

			if (message.error) {
				pending.reject(
					new ConnectionError(
						message.error.message || 'Unknown error'
					)
				);
			} else {
				pending.resolve(message.result);
			}
		}

		// Обработка live query уведомлений
		if (message.result && message.result.action) {
			this.emit('liveQuery', message.result);
		}
	}

	/**
	 * Запуск heartbeat
	 */
	private startHeartbeat(): void {
		this.stopHeartbeat();

		this.heartbeatTimer = setInterval(async () => {
			try {
				await this.send({ method: 'ping', params: [] });
				this.emit('heartbeat');
			} catch (error) {
				this.logger.warn(
					{ module: 'ConnectionManager', method: 'startHeartbeat' },
					`Heartbeat failed: ${error instanceof Error ? error.message : 'Unknown error'}`
				);

				if (this.config.reconnectOnClose) {
					this.scheduleReconnect();
				}
			}
		}, this.config.heartbeatInterval);
	}

	/**
	 * Остановка heartbeat
	 */
	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	/**
	 * Планирование переподключения
	 */
	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
			this.logger.error(
				{ module: 'ConnectionManager', method: 'scheduleReconnect' },
				'Max reconnect attempts reached'
			);
			return;
		}

		this.clearReconnectTimer();
		this.reconnectAttempts++;

		this.logger.info(
			{ module: 'ConnectionManager', method: 'scheduleReconnect' },
			`Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}`
		);

		this.reconnectTimer = setTimeout(async () => {
			try {
				await this.connect();
				this.reconnectAttempts = 0; // Сброс счетчика при успешном подключении
			} catch (error) {
				this.logger.error(
					{
						module: 'ConnectionManager',
						method: 'scheduleReconnect',
					},
					`Reconnect failed: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
				this.scheduleReconnect();
			}
		}, this.config.reconnectDelay);
	}

	/**
	 * Очистка таймера переподключения
	 */
	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	/**
	 * Установка состояния
	 */
	private setState(newState: ConnectionState): void {
		const previousState = this.state;
		this.state = newState;
		this.emit('stateChange', newState, previousState);
	}

	/**
	 * Генерация ID сообщения
	 */
	private generateMessageId(): string {
		return (
			Math.random().toString(36).substring(2, 15) +
			Math.random().toString(36).substring(2, 15)
		);
	}

	/**
	 * Получение статистики подключения
	 */
	getStats() {
		return {
			state: this.state,
			reconnectAttempts: this.reconnectAttempts,
			pendingMessages: this.pendingMessages.size,
			queuedMessages: this.messageQueue.length,
			isConnected: this.isConnected(),
		};
	}
}

// Пул подключений
export class ConnectionPool {
	private connections: ConnectionManager[] = [];
	private config: ConnectionConfig;
	private logger: ILogger;
	private future: Future;
	private currentIndex = 0;

	constructor(
		config: ConnectionConfig,
		logger: ILogger,
		future: Future,
		poolSize = 5
	) {
		this.config = config;
		this.logger = logger;
		this.future = future;

		// Создание пула подключений
		for (let i = 0; i < poolSize; i++) {
			const connection = new ConnectionManager(config, logger, future);
			this.connections.push(connection);
		}
	}

	/**
	 * Инициализация пула
	 */
	async initialize(): Promise<void> {
		await Promise.all(this.connections.map((conn) => conn.connect()));
	}

	/**
	 * Получение подключения (round-robin)
	 */
	getConnection(): ConnectionManager {
		const connection = this.connections[this.currentIndex];
		this.currentIndex = (this.currentIndex + 1) % this.connections.length;
		return connection;
	}

	/**
	 * Получение всех подключений
	 */
	getAllConnections(): ConnectionManager[] {
		return [...this.connections];
	}

	/**
	 * Закрытие пула
	 */
	async close(): Promise<void> {
		await Promise.all(this.connections.map((conn) => conn.disconnect()));
	}

	/**
	 * Статистика пула
	 */
	getStats() {
		return {
			size: this.connections.length,
			connected: this.connections.filter((conn) => conn.isConnected())
				.length,
			currentIndex: this.currentIndex,
			connections: this.connections.map((conn) => conn.getStats()),
		};
	}
}
