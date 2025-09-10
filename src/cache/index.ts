/**
 * Система кэширования для SurrealDB ORM
 */

import { EventEmitter } from 'events';

// Интерфейс для Redis клиента
interface RedisClient {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	setex(key: string, seconds: number, value: string): Promise<void>;
	del(key: string): Promise<void>;
	exists(key: string): Promise<number>;
	keys(pattern: string): Promise<string[]>;
	dbsize(): Promise<number>;
	flushdb(): Promise<void>;
}

// Интерфейс для кэша с строгой типизацией
export interface CacheInterface {
	get<T = unknown>(key: string): Promise<T | null>;
	set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
	delete(key: string): Promise<void>;
	clear(): Promise<void>;
	has(key: string): Promise<boolean>;
	keys(): Promise<string[]>;
	size(): Promise<number>;
}

// Конфигурация кэша
export interface CacheConfig {
	defaultTTL?: number;
	maxSize?: number;
	strategy?: 'LRU' | 'LFU' | 'FIFO';
	enableEvents?: boolean;
	compression?: boolean;
}

// События кэша с строгой типизацией
export interface CacheEvents {
	hit: <T = unknown>(key: string, value: T) => void;
	miss: (key: string) => void;
	set: <T = unknown>(key: string, value: T, ttl?: number) => void;
	delete: (key: string) => void;
	clear: () => void;
	evict: (key: string, reason: string) => void;
	error: (error: Error) => void;
}

// Элемент кэша
interface CacheItem<T = unknown> {
	value: T;
	expiresAt?: number;
	accessCount: number;
	lastAccessed: number;
	createdAt: number;
}

// In-memory кэш с LRU стратегией
export class MemoryCache extends EventEmitter implements CacheInterface {
	private cache = new Map<string, CacheItem>();
	private accessOrder: string[] = [];
	private readonly config: Required<CacheConfig>;

	constructor(config: CacheConfig = {}) {
		super();
		this.config = {
			defaultTTL: config.defaultTTL ?? 300000, // 5 минут
			maxSize: config.maxSize ?? 1000,
			strategy: config.strategy ?? 'LRU',
			enableEvents: config.enableEvents ?? true,
			compression: config.compression ?? false,
		};

		// Очистка истекших элементов
		setInterval(() => this.cleanup(), 60000); // каждую минуту
	}

	async get<T>(key: string): Promise<T | null> {
		try {
			const item = this.cache.get(key);

			if (!item) {
				this.emitEvent('miss', key);
				return null;
			}

			// Проверка истечения
			if (item.expiresAt && Date.now() > item.expiresAt) {
				await this.delete(key);
				this.emitEvent('miss', key);
				return null;
			}

			// Обновление статистики доступа
			item.accessCount++;
			item.lastAccessed = Date.now();

			// Обновление порядка доступа для LRU
			if (this.config.strategy === 'LRU') {
				this.updateAccessOrder(key);
			}

			this.emitEvent('hit', key, item.value);
			return item.value as T;
		} catch (error) {
			this.emitEvent('error', error as Error);
			return null;
		}
	}

	async set<T>(key: string, value: T, ttl?: number): Promise<void> {
		try {
			const now = Date.now();
			const expiresAt =
				ttl ? now + ttl
				: this.config.defaultTTL ? now + this.config.defaultTTL
				: undefined;

			const item: CacheItem<T> = {
				value,
				expiresAt,
				accessCount: 1,
				lastAccessed: now,
				createdAt: now,
			};

			// Проверка размера кэша
			if (
				this.cache.size >= this.config.maxSize &&
				!this.cache.has(key)
			) {
				await this.evict();
			}

			this.cache.set(key, item);
			this.updateAccessOrder(key);

			this.emitEvent('set', key, value, ttl);
		} catch (error) {
			this.emitEvent('error', error as Error);
		}
	}

	async delete(key: string): Promise<void> {
		try {
			const existed = this.cache.has(key);
			this.cache.delete(key);
			this.removeFromAccessOrder(key);

			if (existed) {
				this.emitEvent('delete', key);
			}
		} catch (error) {
			this.emitEvent('error', error as Error);
		}
	}

	async clear(): Promise<void> {
		try {
			this.cache.clear();
			this.accessOrder = [];
			this.emitEvent('clear');
		} catch (error) {
			this.emitEvent('error', error as Error);
		}
	}

	async has(key: string): Promise<boolean> {
		const item = this.cache.get(key);
		if (!item) return false;

		if (item.expiresAt && Date.now() > item.expiresAt) {
			await this.delete(key);
			return false;
		}

		return true;
	}

	async keys(): Promise<string[]> {
		const now = Date.now();
		const validKeys: string[] = [];

		this.cache.forEach((item, key) => {
			if (!item.expiresAt || now <= item.expiresAt) {
				validKeys.push(key);
			}
		});

		return validKeys;
	}

	async size(): Promise<number> {
		return this.cache.size;
	}

	// Статистика кэша
	getStats() {
		const now = Date.now();
		let totalAccessCount = 0;
		let expiredCount = 0;

		this.cache.forEach((item) => {
			totalAccessCount += item.accessCount;
			if (item.expiresAt && now > item.expiresAt) {
				expiredCount++;
			}
		});

		return {
			size: this.cache.size,
			maxSize: this.config.maxSize,
			hitRate:
				totalAccessCount > 0 ?
					(totalAccessCount - this.cache.size) / totalAccessCount
				:	0,
			expiredCount,
			strategy: this.config.strategy,
		};
	}

	private updateAccessOrder(key: string): void {
		if (this.config.strategy !== 'LRU') return;

		this.removeFromAccessOrder(key);
		this.accessOrder.push(key);
	}

	private removeFromAccessOrder(key: string): void {
		const index = this.accessOrder.indexOf(key);
		if (index > -1) {
			this.accessOrder.splice(index, 1);
		}
	}

	private async evict(): Promise<void> {
		if (this.cache.size === 0) return;

		let keyToEvict: string | null = null;

		switch (this.config.strategy) {
			case 'LRU':
				// Найти первый элемент в accessOrder, который все еще существует в кэше
				for (const key of this.accessOrder) {
					if (this.cache.has(key)) {
						keyToEvict = key;
						break;
					}
				}
				// Если не нашли в accessOrder, взять первый элемент из кэша
				if (!keyToEvict) {
					const firstKey = this.cache.keys().next().value;
					keyToEvict = firstKey || null;
				}
				break;

			case 'LFU':
				let minAccessCount = Infinity;
				this.cache.forEach((item, key) => {
					if (item.accessCount < minAccessCount) {
						minAccessCount = item.accessCount;
						keyToEvict = key;
					}
				});
				break;

			case 'FIFO':
				let oldestTime = Infinity;
				this.cache.forEach((item, key) => {
					if (item.createdAt < oldestTime) {
						oldestTime = item.createdAt;
						keyToEvict = key;
					}
				});
				break;
		}

		if (keyToEvict) {
			await this.delete(keyToEvict);
			this.emitEvent('evict', keyToEvict, this.config.strategy);
		}
	}

	private cleanup(): void {
		const now = Date.now();
		const expiredKeys: string[] = [];

		this.cache.forEach((item, key) => {
			if (item.expiresAt && now > item.expiresAt) {
				expiredKeys.push(key);
			}
		});

		for (const key of expiredKeys) {
			this.delete(key);
		}
	}

	private emitEvent<K extends keyof CacheEvents>(
		event: K,
		...args: Parameters<CacheEvents[K]>
	): void {
		if (this.config.enableEvents) {
			this.emit(event, ...args);
		}
	}
}

// Redis кэш (требует redis клиент)
export class RedisCache implements CacheInterface {
	private client: RedisClient;
	private readonly config: Required<CacheConfig>;

	constructor(redisClient: RedisClient, config: CacheConfig = {}) {
		this.client = redisClient;
		this.config = {
			defaultTTL: config.defaultTTL ?? 300000,
			maxSize: config.maxSize ?? 10000,
			strategy: config.strategy ?? 'LRU',
			enableEvents: config.enableEvents ?? false,
			compression: config.compression ?? false,
		};
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		try {
			const value = await this.client.get(key);
			return value ? JSON.parse(value) : null;
		} catch (error) {
			return null;
		}
	}

	async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
		try {
			const serialized = JSON.stringify(value);
			const actualTTL = ttl || this.config.defaultTTL;

			if (actualTTL) {
				await this.client.setex(
					key,
					Math.floor(actualTTL / 1000),
					serialized
				);
			} else {
				await this.client.set(key, serialized);
			}
		} catch (error) {
			// Логирование ошибки
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.client.del(key);
		} catch (error) {
			// Логирование ошибки
		}
	}

	async clear(): Promise<void> {
		try {
			await this.client.flushdb();
		} catch (error) {
			// Логирование ошибки
		}
	}

	async has(key: string): Promise<boolean> {
		try {
			const result = await this.client.exists(key);
			return result === 1;
		} catch (error) {
			return false;
		}
	}

	async keys(): Promise<string[]> {
		try {
			return await this.client.keys('*');
		} catch (error) {
			return [];
		}
	}

	async size(): Promise<number> {
		try {
			return await this.client.dbsize();
		} catch (error) {
			return 0;
		}
	}
}

// Многоуровневый кэш
export class MultiLevelCache implements CacheInterface {
	private levels: CacheInterface[];

	constructor(levels: CacheInterface[]) {
		this.levels = levels;
	}

	async get<T>(key: string): Promise<T | null> {
		// Поиск по уровням сверху вниз
		for (let i = 0; i < this.levels.length; i++) {
			const value = await this.levels[i].get<T>(key);
			if (value !== null) {
				// Продвижение в верхние уровни
				for (let j = 0; j < i; j++) {
					await this.levels[j].set(key, value);
				}
				return value;
			}
		}
		return null;
	}

	async set<T>(key: string, value: T, ttl?: number): Promise<void> {
		// Установка во все уровни
		await Promise.all(
			this.levels.map((level) => level.set(key, value, ttl))
		);
	}

	async delete(key: string): Promise<void> {
		// Удаление из всех уровней
		await Promise.all(this.levels.map((level) => level.delete(key)));
	}

	async clear(): Promise<void> {
		// Очистка всех уровней
		await Promise.all(this.levels.map((level) => level.clear()));
	}

	async has(key: string): Promise<boolean> {
		// Проверка в любом из уровней
		for (const level of this.levels) {
			if (await level.has(key)) {
				return true;
			}
		}
		return false;
	}

	async keys(): Promise<string[]> {
		// Объединение ключей из всех уровней
		const allKeys = new Set<string>();
		for (const level of this.levels) {
			const keys = await level.keys();
			keys.forEach((key) => allKeys.add(key));
		}
		return Array.from(allKeys);
	}

	async size(): Promise<number> {
		// Сумма размеров всех уровней
		let totalSize = 0;
		for (const level of this.levels) {
			totalSize += await level.size();
		}
		return totalSize;
	}
}

// Кэш-менеджер для ORM
export class CacheManager {
	private cache: CacheInterface;
	private keyPrefix: string;

	constructor(cache: CacheInterface, keyPrefix = 'surrealdb_orm') {
		this.cache = cache;
		this.keyPrefix = keyPrefix;
	}

	private buildKey(parts: string[]): string {
		return `${this.keyPrefix}:${parts.join(':')}`;
	}

	// Кэширование схем
	async getSchema<T = unknown>(tableName: string): Promise<T | null> {
		return this.cache.get<T>(this.buildKey(['schema', tableName]));
	}

	async setSchema<T = unknown>(
		tableName: string,
		schema: T,
		ttl?: number
	): Promise<void> {
		return this.cache.set(
			this.buildKey(['schema', tableName]),
			schema,
			ttl
		);
	}

	// Кэширование запросов
	async getQueryResult<T = unknown>(queryHash: string): Promise<T | null> {
		return this.cache.get<T>(this.buildKey(['query', queryHash]));
	}

	async setQueryResult<T = unknown>(
		queryHash: string,
		result: T,
		ttl?: number
	): Promise<void> {
		return this.cache.set(this.buildKey(['query', queryHash]), result, ttl);
	}

	// Кэширование метаданных
	async getMetadata<T = unknown>(key: string): Promise<T | null> {
		return this.cache.get<T>(this.buildKey(['metadata', key]));
	}

	async setMetadata<T = unknown>(
		key: string,
		metadata: T,
		ttl?: number
	): Promise<void> {
		return this.cache.set(this.buildKey(['metadata', key]), metadata, ttl);
	}

	// Инвалидация кэша
	async invalidateTable(tableName: string): Promise<void> {
		const keys = await this.cache.keys();
		const tableKeys = keys.filter(
			(key) =>
				key.includes(`:${tableName}:`) ||
				key.includes(`_${tableName}_`) ||
				key.endsWith(`:${tableName}`) ||
				key.endsWith(`_${tableName}`) ||
				key.includes(`:${tableName}_`) ||
				key.includes(`_${tableName}:`)
		);

		await Promise.all(tableKeys.map((key) => this.cache.delete(key)));
	}

	async invalidateQuery(queryHash: string): Promise<void> {
		return this.cache.delete(this.buildKey(['query', queryHash]));
	}

	// Очистка всего кэша
	async clear(): Promise<void> {
		return this.cache.clear();
	}
}
