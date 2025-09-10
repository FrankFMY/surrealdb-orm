/**
 * Тесты для системы кэширования
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	MemoryCache,
	CacheManager,
	type CacheConfig,
} from '../../src/cache/index.js';

describe('MemoryCache', () => {
	let cache: MemoryCache;

	beforeEach(() => {
		cache = new MemoryCache({
			defaultTTL: 1000,
			maxSize: 10,
			strategy: 'LRU',
		});
	});

	describe('basic operations', () => {
		it('should set and get values', async () => {
			await cache.set('key1', 'value1');
			const value = await cache.get('key1');
			expect(value).toBe('value1');
		});

		it('should return null for non-existent keys', async () => {
			const value = await cache.get('nonexistent');
			expect(value).toBeNull();
		});

		it('should check if key exists', async () => {
			await cache.set('key1', 'value1');
			expect(await cache.has('key1')).toBe(true);
			expect(await cache.has('nonexistent')).toBe(false);
		});

		it('should delete keys', async () => {
			await cache.set('key1', 'value1');
			await cache.delete('key1');
			expect(await cache.has('key1')).toBe(false);
		});

		it('should clear all keys', async () => {
			await cache.set('key1', 'value1');
			await cache.set('key2', 'value2');
			await cache.clear();
			expect(await cache.size()).toBe(0);
		});
	});

	describe('TTL functionality', () => {
		it('should expire values after TTL', async () => {
			await cache.set('key1', 'value1', 100);

			expect(await cache.get('key1')).toBe('value1');

			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(await cache.get('key1')).toBeNull();
		});

		it('should not expire values without TTL', async () => {
			await cache.set('key1', 'value1');

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(await cache.get('key1')).toBe('value1');
		});
	});

	describe('size limits', () => {
		it('should respect max size limit', async () => {
			// Fill cache to max size
			for (let i = 0; i < 10; i++) {
				await cache.set(`key${i}`, `value${i}`);
			}

			expect(await cache.size()).toBe(10);

			// Add one more - should evict oldest
			await cache.set('key10', 'value10');

			expect(await cache.size()).toBe(10);
			expect(await cache.has('key0')).toBe(false);
			expect(await cache.has('key10')).toBe(true);
		});
	});

	describe('LRU strategy', () => {
		it('should evict least recently used items', async () => {
			await cache.set('key1', 'value1');
			await cache.set('key2', 'value2');
			await cache.set('key3', 'value3');

			// Access key1 to make it recently used
			await cache.get('key1');

			// Add more items to trigger eviction (11 items total, maxSize is 10)
			for (let i = 4; i <= 11; i++) {
				await cache.set(`key${i}`, `value${i}`);
			}

			// key1 should still be there, key2 should be evicted
			expect(await cache.has('key1')).toBe(true);
			expect(await cache.has('key2')).toBe(false);
		});
	});

	describe('events', () => {
		it('should emit events', async () => {
			const hitSpy = vi.fn();
			const missSpy = vi.fn();
			const setSpy = vi.fn();

			cache.on('hit', hitSpy);
			cache.on('miss', missSpy);
			cache.on('set', setSpy);

			await cache.set('key1', 'value1');
			await cache.get('key1');
			await cache.get('nonexistent');

			expect(setSpy).toHaveBeenCalledWith('key1', 'value1', undefined);
			expect(hitSpy).toHaveBeenCalledWith('key1', 'value1');
			expect(missSpy).toHaveBeenCalledWith('nonexistent');
		});
	});

	describe('statistics', () => {
		it('should provide statistics', async () => {
			await cache.set('key1', 'value1');
			await cache.get('key1');
			await cache.get('nonexistent');

			const stats = cache.getStats();
			expect(stats.size).toBe(1);
			expect(stats.maxSize).toBe(10);
			expect(stats.strategy).toBe('LRU');
		});
	});
});

describe('CacheManager', () => {
	let cacheManager: CacheManager;
	let mockCache: any;

	beforeEach(() => {
		mockCache = {
			get: vi.fn(),
			set: vi.fn(),
			delete: vi.fn(),
			clear: vi.fn(),
			has: vi.fn(),
			keys: vi.fn(),
			size: vi.fn(),
		};

		cacheManager = new CacheManager(mockCache, 'test_prefix');
	});

	describe('schema caching', () => {
		it('should cache and retrieve schemas', async () => {
			const schema = { fields: { id: { type: 'string' } } };

			mockCache.get.mockResolvedValue(schema);
			await cacheManager.setSchema('users', schema);

			const result = await cacheManager.getSchema('users');
			expect(result).toEqual(schema);
			expect(mockCache.set).toHaveBeenCalledWith(
				'test_prefix:schema:users',
				schema,
				undefined
			);
			expect(mockCache.get).toHaveBeenCalledWith(
				'test_prefix:schema:users'
			);
		});
	});

	describe('query result caching', () => {
		it('should cache and retrieve query results', async () => {
			const result = [{ id: '1', name: 'John' }];

			mockCache.get.mockResolvedValue(result);
			await cacheManager.setQueryResult('query_hash', result);

			const cached = await cacheManager.getQueryResult('query_hash');
			expect(cached).toEqual(result);
			expect(mockCache.set).toHaveBeenCalledWith(
				'test_prefix:query:query_hash',
				result,
				undefined
			);
			expect(mockCache.get).toHaveBeenCalledWith(
				'test_prefix:query:query_hash'
			);
		});
	});

	describe('metadata caching', () => {
		it('should cache and retrieve metadata', async () => {
			const metadata = { version: '1.0.0', lastModified: '2024-01-01' };

			mockCache.get.mockResolvedValue(metadata);
			await cacheManager.setMetadata('version', metadata);

			const result = await cacheManager.getMetadata('version');
			expect(result).toEqual(metadata);
			expect(mockCache.set).toHaveBeenCalledWith(
				'test_prefix:metadata:version',
				metadata,
				undefined
			);
			expect(mockCache.get).toHaveBeenCalledWith(
				'test_prefix:metadata:version'
			);
		});
	});

	describe('cache invalidation', () => {
		it('should invalidate table cache', async () => {
			mockCache.keys.mockResolvedValue([
				'test_prefix:query:users_find',
				'test_prefix:query:posts_find',
				'test_prefix:schema:users',
			]);

			await cacheManager.invalidateTable('users');

			expect(mockCache.delete).toHaveBeenCalledWith(
				'test_prefix:query:users_find'
			);
			expect(mockCache.delete).toHaveBeenCalledWith(
				'test_prefix:schema:users'
			);
			expect(mockCache.delete).not.toHaveBeenCalledWith(
				'test_prefix:query:posts_find'
			);
		});

		it('should invalidate specific query cache', async () => {
			await cacheManager.invalidateQuery('query_hash');

			expect(mockCache.delete).toHaveBeenCalledWith(
				'test_prefix:query:query_hash'
			);
		});

		it('should clear all cache', async () => {
			await cacheManager.clear();

			expect(mockCache.clear).toHaveBeenCalled();
		});
	});
});
