/**
 * Улучшенная система выполнения запросов для SurrealDB ORM
 */

import type { ConnectionManager } from './connection';
import type { ILogger } from '../../helpers';
import { QueryError, TimeoutError, RateLimitError } from '../errors';
import { CacheManager } from '../cache';
import type { CacheInterface } from '../cache';
import type {
	SurrealQueryParams,
	SurrealQueryResult,
	SurrealRPCInterface,
} from '../types/surreal.js';

// Конфигурация query engine
export interface QueryEngineConfig {
	timeout?: number;
	retryAttempts?: number;
	retryDelay?: number;
	enableCaching?: boolean;
	cacheTTL?: number;
	enableQueryLogging?: boolean;
	maxQuerySize?: number;
	rateLimit?: {
		requestsPerSecond: number;
		burstLimit: number;
	};
}

// Статистика запроса
export interface QueryStats {
	query: string;
	duration: number;
	timestamp: string;
	cached: boolean;
	retries: number;
	error?: string;
}

// Результат запроса с строгой типизацией
export interface QueryResult<T = unknown> {
	data: T;
	stats: QueryStats;
	metadata?: {
		affectedRows?: number;
		lastInsertId?: string;
		warnings?: string[];
	};
}

// Параметры запроса с строгой типизацией
export interface QueryParams extends SurrealQueryParams {}

// Кэш запросов с строгой типизацией
interface QueryCache {
	[queryHash: string]: {
		result: unknown;
		timestamp: number;
		ttl: number;
	};
}

// Rate limiter
class RateLimiter {
	private requests: number[] = [];
	private burstTokens: number;

	constructor(
		private requestsPerSecond: number,
		private burstLimit: number
	) {
		this.burstTokens = burstLimit;
	}

	async acquire(): Promise<void> {
		const now = Date.now();

		// Очистка старых запросов
		this.requests = this.requests.filter((time) => now - time < 1000);

		// Проверка лимита запросов в секунду
		if (this.requests.length >= this.requestsPerSecond) {
			const waitTime = 1000 - (now - this.requests[0]);
			await this.sleep(waitTime);
			return this.acquire();
		}

		// Проверка burst лимита
		if (this.burstTokens <= 0) {
			const waitTime = 1000; // Ждем секунду для восстановления burst токенов
			await this.sleep(waitTime);
			this.burstTokens = this.burstLimit;
		}

		this.requests.push(now);
		this.burstTokens--;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// Query Engine
export class QueryEngine {
	private config: Required<QueryEngineConfig>;
	private logger: ILogger;
	private connection: ConnectionManager;
	private cache?: CacheManager;
	private rateLimiter?: RateLimiter;
	private queryCache: QueryCache = {};
	private queryStats: QueryStats[] = [];

	constructor(
		connection: ConnectionManager,
		logger: ILogger,
		config: QueryEngineConfig = {}
	) {
		this.connection = connection;
		this.logger = logger;
		this.config = {
			timeout: config.timeout ?? 30000,
			retryAttempts: config.retryAttempts ?? 3,
			retryDelay: config.retryDelay ?? 1000,
			enableCaching: config.enableCaching ?? true,
			cacheTTL: config.cacheTTL ?? 300000, // 5 минут
			enableQueryLogging: config.enableQueryLogging ?? false,
			maxQuerySize: config.maxQuerySize ?? 1024 * 1024, // 1MB
			rateLimit: config.rateLimit ?? {
				requestsPerSecond: 100,
				burstLimit: 10,
			},
		};

		if (this.config.enableCaching) {
			// Инициализация кэша (в реальном проекте здесь будет внешний кэш)
			this.cache = new CacheManager({
				get: async (key: string) => this.queryCache[key]?.result,
				set: async (key: string, value: unknown, ttl?: number) => {
					this.queryCache[key] = {
						result: value,
						timestamp: Date.now(),
						ttl: ttl || this.config.cacheTTL,
					};
				},
				delete: async (key: string) => {
					delete this.queryCache[key];
				},
				clear: async () => {
					this.queryCache = {};
				},
				has: async (key: string) => {
					const cached = this.queryCache[key];
					return cached && Date.now() - cached.timestamp < cached.ttl;
				},
				keys: async () => Object.keys(this.queryCache),
				size: async () => Object.keys(this.queryCache).length,
			} as CacheInterface);
		}

		if (this.config.rateLimit) {
			this.rateLimiter = new RateLimiter(
				this.config.rateLimit.requestsPerSecond,
				this.config.rateLimit.burstLimit
			);
		}
	}

	/**
	 * Выполнение SQL запроса
	 */
	async query<T = unknown>(
		sql: string,
		params?: QueryParams
	): Promise<QueryResult<T>> {
		const startTime = Date.now();
		const queryHash = this.generateQueryHash(sql, params);

		// Проверка размера запроса
		if (sql.length > this.config.maxQuerySize) {
			throw new QueryError('Query size exceeds maximum allowed size');
		}

		// Rate limiting
		if (this.rateLimiter) {
			await this.rateLimiter.acquire();
		}

		// Проверка кэша
		if (this.config.enableCaching && this.cache) {
			const cached = await this.cache.getQueryResult(queryHash);
			if (cached) {
				const stats: QueryStats = {
					query: sql,
					duration: Date.now() - startTime,
					timestamp: new Date().toISOString(),
					cached: true,
					retries: 0,
				};

				this.logQuery(stats);
				return {
					data: cached as T,
					stats,
				};
			}
		}

		// Выполнение запроса с повторными попытками
		let lastError: Error | null = null;
		let retries = 0;

		for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
			try {
				const result = await this.executeQuery<T>(sql, params);

				// Кэширование результата
				if (
					this.config.enableCaching &&
					this.cache &&
					this.isCacheableQuery(sql)
				) {
					await this.cache.setQueryResult(
						queryHash,
						result,
						this.config.cacheTTL
					);
				}

				const stats: QueryStats = {
					query: sql,
					duration: Date.now() - startTime,
					timestamp: new Date().toISOString(),
					cached: false,
					retries,
				};

				this.logQuery(stats);
				this.queryStats.push(stats);

				return {
					data: result,
					stats,
				};
			} catch (error) {
				lastError = error as Error;
				retries++;

				if (attempt < this.config.retryAttempts) {
					this.logger.warn(
						{ module: 'QueryEngine', method: 'query' },
						`Query failed, retrying (${attempt + 1}/${this.config.retryAttempts}): ${error instanceof Error ? error.message : 'Unknown error'}`
					);

					await this.sleep(this.config.retryDelay);
				}
			}
		}

		// Все попытки исчерпаны
		const stats: QueryStats = {
			query: sql,
			duration: Date.now() - startTime,
			timestamp: new Date().toISOString(),
			cached: false,
			retries,
			error: lastError?.message,
		};

		this.logQuery(stats);
		this.queryStats.push(stats);

		throw new QueryError(
			`Query failed after ${this.config.retryAttempts} retries: ${lastError?.message}`,
			sql
		);
	}

	/**
	 * Выполнение запроса с таймаутом
	 */
	private async executeQuery<T>(
		sql: string,
		params?: QueryParams
	): Promise<T> {
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				reject(new TimeoutError('Query timeout', this.config.timeout));
			}, this.config.timeout);
		});

		const queryPromise = this.connection.send<T>({
			method: 'query',
			params: params ? [sql, params] : [sql],
		});

		return Promise.race([queryPromise, timeoutPromise]);
	}

	/**
	 * Выполнение транзакции
	 */
	async transaction<T>(
		queries: Array<{ sql: string; params?: QueryParams }>
	): Promise<QueryResult<T>> {
		const startTime = Date.now();

		try {
			// Начало транзакции
			await this.query('BEGIN TRANSACTION');

			const results: unknown[] = [];

			// Выполнение запросов
			for (const { sql, params } of queries) {
				const result = await this.query(sql, params);
				results.push(result.data);
			}

			// Подтверждение транзакции
			await this.query('COMMIT TRANSACTION');

			const stats: QueryStats = {
				query: `TRANSACTION (${queries.length} queries)`,
				duration: Date.now() - startTime,
				timestamp: new Date().toISOString(),
				cached: false,
				retries: 0,
			};

			this.logQuery(stats);
			this.queryStats.push(stats);

			return {
				data: results as T,
				stats,
			};
		} catch (error) {
			// Откат транзакции
			try {
				await this.query('CANCEL TRANSACTION');
			} catch (rollbackError) {
				this.logger.error(
					{ module: 'QueryEngine', method: 'transaction' },
					`Failed to rollback transaction: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown error'}`
				);
			}

			throw new QueryError(
				`Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	/**
	 * Выполнение batch запросов
	 */
	async batch<T>(
		queries: Array<{ sql: string; params?: QueryParams }>
	): Promise<QueryResult<T[]>> {
		const startTime = Date.now();

		const results = await Promise.all(
			queries.map(({ sql, params }) => this.query<T>(sql, params))
		);

		const stats: QueryStats = {
			query: `BATCH (${queries.length} queries)`,
			duration: Date.now() - startTime,
			timestamp: new Date().toISOString(),
			cached: false,
			retries: 0,
		};

		this.logQuery(stats);
		this.queryStats.push(stats);

		return {
			data: results.map((r) => r.data),
			stats,
		};
	}

	/**
	 * Очистка кэша
	 */
	async clearCache(): Promise<void> {
		if (this.cache) {
			await this.cache.clear();
		}
		this.queryCache = {};
	}

	/**
	 * Инвалидация кэша для таблицы
	 */
	async invalidateTableCache(tableName: string): Promise<void> {
		if (this.cache) {
			await this.cache.invalidateTable(tableName);
		}

		// Очистка локального кэша для запросов, связанных с таблицей
		const keysToDelete = Object.keys(this.queryCache).filter((key) =>
			key.includes(tableName)
		);

		for (const key of keysToDelete) {
			delete this.queryCache[key];
		}
	}

	/**
	 * Получение статистики запросов
	 */
	getQueryStats(): QueryStats[] {
		return [...this.queryStats];
	}

	/**
	 * Получение статистики производительности
	 */
	getPerformanceStats() {
		const stats = this.queryStats;
		const totalQueries = stats.length;
		const cachedQueries = stats.filter((s) => s.cached).length;
		const avgDuration =
			totalQueries > 0 ?
				stats.reduce((sum, s) => sum + s.duration, 0) / totalQueries
			:	0;
		const errorRate =
			totalQueries > 0 ?
				stats.filter((s) => s.error).length / totalQueries
			:	0;

		return {
			totalQueries,
			cachedQueries,
			cacheHitRate: totalQueries > 0 ? cachedQueries / totalQueries : 0,
			avgDuration,
			errorRate,
			recentQueries: stats.slice(-10),
		};
	}

	/**
	 * Генерация хэша запроса
	 */
	private generateQueryHash(sql: string, params?: QueryParams): string {
		const content = JSON.stringify({ sql, params });
		let hash = 0;

		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}

		return hash.toString(36);
	}

	/**
	 * Проверка, можно ли кэшировать запрос
	 */
	private isCacheableQuery(sql: string): boolean {
		const upperSql = sql.toUpperCase().trim();

		// Не кэшируем модифицирующие запросы
		const nonCacheableKeywords = [
			'INSERT',
			'UPDATE',
			'DELETE',
			'CREATE',
			'DROP',
			'ALTER',
			'BEGIN',
			'COMMIT',
			'CANCEL',
			'SIGNIN',
			'SIGNUP',
		];

		return !nonCacheableKeywords.some((keyword) =>
			upperSql.startsWith(keyword)
		);
	}

	/**
	 * Логирование запроса
	 */
	private logQuery(stats: QueryStats): void {
		if (this.config.enableQueryLogging) {
			this.logger.info(
				{ module: 'QueryEngine', method: 'logQuery' },
				`Query executed: ${stats.duration}ms ${stats.cached ? '(cached)' : ''} - ${stats.query} (retries: ${stats.retries})`
			);
		}
	}

	/**
	 * Задержка
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
