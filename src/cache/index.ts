/**
 * Система кэширования для SurrealDB ORM
 */

import { EventEmitter } from 'events';

// Интерфейс для кэша
export interface CacheInterface {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
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

// События кэша
export interface CacheEvents {
  'hit': (key: string, value: unknown) => void;
  'miss': (key: string) => void;
  'set': (key: string, value: unknown, ttl?: number) => void;
  'delete': (key: string) => void;
  'clear': () => void;
  'evict': (key: string, reason: string) => void;
  'error': (error: Error) => void;
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
      compression: config.compression ?? false
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
      const expiresAt = ttl ? now + ttl : (this.config.defaultTTL ? now + this.config.defaultTTL : undefined);
      
      const item: CacheItem<T> = {
        value,
        expiresAt,
        accessCount: 1,
        lastAccessed: now,
        createdAt: now
      };

      // Проверка размера кэша
      if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
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
    
    for (const [key, item] of this.cache.entries()) {
      if (!item.expiresAt || now <= item.expiresAt) {
        validKeys.push(key);
      }
    }
    
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
    
    for (const item of this.cache.values()) {
      totalAccessCount += item.accessCount;
      if (item.expiresAt && now > item.expiresAt) {
        expiredCount++;
      }
    }
    
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: totalAccessCount > 0 ? (totalAccessCount - this.cache.size) / totalAccessCount : 0,
      expiredCount,
      strategy: this.config.strategy
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
        keyToEvict = this.accessOrder[0];
        break;
        
      case 'LFU':
        let minAccessCount = Infinity;
        for (const [key, item] of this.cache.entries()) {
          if (item.accessCount < minAccessCount) {
            minAccessCount = item.accessCount;
            keyToEvict = key;
          }
        }
        break;
        
      case 'FIFO':
        let oldestTime = Infinity;
        for (const [key, item] of this.cache.entries()) {
          if (item.createdAt < oldestTime) {
            oldestTime = item.createdAt;
            keyToEvict = key;
          }
        }
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
    
    for (const [key, item] of this.cache.entries()) {
      if (item.expiresAt && now > item.expiresAt) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.delete(key);
    }
  }

  private emitEvent<K extends keyof CacheEvents>(event: K, ...args: Parameters<CacheEvents[K]>): void {
    if (this.config.enableEvents) {
      this.emit(event, ...args);
    }
  }
}

// Redis кэш (требует redis клиент)
export class RedisCache implements CacheInterface {
  private client: any; // Redis client
  private readonly config: Required<CacheConfig>;

  constructor(redisClient: any, config: CacheConfig = {}) {
    this.client = redisClient;
    this.config = {
      defaultTTL: config.defaultTTL ?? 300000,
      maxSize: config.maxSize ?? 10000,
      strategy: config.strategy ?? 'LRU',
      enableEvents: config.enableEvents ?? false,
      compression: config.compression ?? false
    };
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const actualTTL = ttl || this.config.defaultTTL;
      
      if (actualTTL) {
        await this.client.setex(key, Math.floor(actualTTL / 1000), serialized);
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
      this.levels.map(level => level.set(key, value, ttl))
    );
  }

  async delete(key: string): Promise<void> {
    // Удаление из всех уровней
    await Promise.all(
      this.levels.map(level => level.delete(key))
    );
  }

  async clear(): Promise<void> {
    // Очистка всех уровней
    await Promise.all(
      this.levels.map(level => level.clear())
    );
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
      keys.forEach(key => allKeys.add(key));
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
  async getSchema(tableName: string): Promise<any> {
    return this.cache.get(this.buildKey(['schema', tableName]));
  }

  async setSchema(tableName: string, schema: any, ttl?: number): Promise<void> {
    return this.cache.set(this.buildKey(['schema', tableName]), schema, ttl);
  }

  // Кэширование запросов
  async getQueryResult(queryHash: string): Promise<any> {
    return this.cache.get(this.buildKey(['query', queryHash]));
  }

  async setQueryResult(queryHash: string, result: any, ttl?: number): Promise<void> {
    return this.cache.set(this.buildKey(['query', queryHash]), result, ttl);
  }

  // Кэширование метаданных
  async getMetadata(key: string): Promise<any> {
    return this.cache.get(this.buildKey(['metadata', key]));
  }

  async setMetadata(key: string, metadata: any, ttl?: number): Promise<void> {
    return this.cache.set(this.buildKey(['metadata', key]), metadata, ttl);
  }

  // Инвалидация кэша
  async invalidateTable(tableName: string): Promise<void> {
    const keys = await this.cache.keys();
    const tableKeys = keys.filter(key => key.includes(`:${tableName}:`));
    
    await Promise.all(
      tableKeys.map(key => this.cache.delete(key))
    );
  }

  async invalidateQuery(queryHash: string): Promise<void> {
    return this.cache.delete(this.buildKey(['query', queryHash]));
  }

  // Очистка всего кэша
  async clear(): Promise<void> {
    return this.cache.clear();
  }
}

// Экспорт
export {
  CacheInterface,
  CacheConfig,
  CacheEvents,
  MemoryCache,
  RedisCache,
  MultiLevelCache,
  CacheManager
};