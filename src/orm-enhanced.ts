/**
 * Улучшенная версия SurrealDB ORM с валидацией, кэшированием и безопасностью
 */

import type { DatabaseSchema, TableConfig, FieldConfig } from '../orm';
import { SchemaValidator } from './types/validation';
import type {
	StrictDatabaseSchema,
	ValidationContext,
} from './types/validation';
import { ConnectionManager } from './core/connection';
import { QueryEngine } from './core/query-engine';
import { CacheManager } from './cache';
import { ValidationError, SchemaError, QueryError } from './errors';
import { SQLInjectionValidator, RateLimiter, AuditLogger } from './security';

// Экспорт классов для использования в примерах
export { ConnectionManager, QueryEngine };

// Конфигурация ORM
export interface EnhancedORMConfig {
	enableValidation?: boolean;
	enableCaching?: boolean;
	enableAudit?: boolean;
	enableRateLimit?: boolean;
	strictMode?: boolean;
	cacheConfig?: {
		defaultTTL?: number;
		maxSize?: number;
	};
	rateLimitConfig?: {
		requestsPerSecond: number;
		burstLimit: number;
	};
	auditConfig?: {
		logAllOperations?: boolean;
		sensitiveFields?: string[];
	};
}

// Улучшенная таблица
export class EnhancedTable<Config extends TableConfig> {
	private validator: SchemaValidator;
	private rateLimiter?: RateLimiter;
	private auditLogger?: AuditLogger;
	private cache?: CacheManager;

	constructor(
		private rpc: ConnectionManager,
		private queryEngine: QueryEngine,
		private tableName: string,
		private config: Config,
		private ormConfig: EnhancedORMConfig
	) {
		this.validator = new SchemaValidator({
			[tableName]: config,
		} as StrictDatabaseSchema);

		if (ormConfig.enableRateLimit && ormConfig.rateLimitConfig) {
			this.rateLimiter = new RateLimiter(
				ormConfig.rateLimitConfig.requestsPerSecond,
				ormConfig.rateLimitConfig.burstLimit
			);
		}

		if (ormConfig.enableAudit) {
			this.auditLogger = new AuditLogger();
		}
	}

	/**
	 * Создание записи с валидацией
	 */
	async createRecord(
		data: Record<string, unknown>,
		context?: ValidationContext
	): Promise<any> {
		// Rate limiting
		if (this.rateLimiter && !this.rateLimiter.isAllowed('create')) {
			throw new QueryError('Rate limit exceeded');
		}

		// Валидация входных данных
		if (this.ormConfig.enableValidation) {
			const validation = this.validator.validateRecord(
				this.tableName,
				data,
				context || { tableName: this.tableName, operation: 'create' }
			);

			if (!validation.isValid) {
				throw new ValidationError(
					'Validation failed',
					validation.errors
				);
			}

			data = validation.sanitizedData;
		}

		// Проверка SQL инъекций
		for (const [key, value] of Object.entries(data)) {
			if (
				typeof value === 'string' &&
				!SQLInjectionValidator.validate(value)
			) {
				throw new QueryError(
					`Potential SQL injection detected in field: ${key}`
				);
			}
		}

		// Аудит
		if (this.auditLogger) {
			this.auditLogger.log({
				operation: 'CREATE',
				tableName: this.tableName,
				details: { data },
			});
		}

		// Выполнение запроса
		const id = `${this.tableName}:${Date.now()}`;
		const now = Date.now();
		const payload = { ...data, id, created: now, updated: now };

		const result = await this.queryEngine.query(
			`CREATE type::thing($table, $id) CONTENT $data RETURN AFTER`,
			{ table: this.tableName, id, data: payload }
		);

		// Инвалидация кэша
		if (this.cache) {
			await this.cache.invalidateTable(this.tableName);
		}

		return result.data[0];
	}

	/**
	 * Обновление записи с валидацией
	 */
	async updateRecord(
		id: string,
		data: Record<string, unknown>,
		context?: ValidationContext
	): Promise<any> {
		// Rate limiting
		if (this.rateLimiter && !this.rateLimiter.isAllowed('update')) {
			throw new QueryError('Rate limit exceeded');
		}

		// Валидация входных данных
		if (this.ormConfig.enableValidation) {
			const validation = this.validator.validateRecord(
				this.tableName,
				data,
				context || { tableName: this.tableName, operation: 'update' }
			);

			if (!validation.isValid) {
				throw new ValidationError(
					'Validation failed',
					validation.errors
				);
			}

			data = validation.sanitizedData;
		}

		// Проверка SQL инъекций
		for (const [key, value] of Object.entries(data)) {
			if (
				typeof value === 'string' &&
				!SQLInjectionValidator.validate(value)
			) {
				throw new QueryError(
					`Potential SQL injection detected in field: ${key}`
				);
			}
		}

		// Аудит
		if (this.auditLogger) {
			this.auditLogger.log({
				operation: 'UPDATE',
				tableName: this.tableName,
				recordId: id,
				details: { data },
			});
		}

		// Выполнение запроса
		const updateData = { ...data, updated: Date.now() };
		const result = await this.queryEngine.query(
			`UPDATE type::thing($table, $id) CONTENT $data RETURN AFTER`,
			{ table: this.tableName, id, data: updateData }
		);

		// Инвалидация кэша
		if (this.cache) {
			await this.cache.invalidateTable(this.tableName);
		}

		return result.data[0];
	}

	/**
	 * Поиск записи по ID с кэшированием
	 */
	async findById(id: string): Promise<any> {
		// Rate limiting
		if (this.rateLimiter && !this.rateLimiter.isAllowed('read')) {
			throw new QueryError('Rate limit exceeded');
		}

		// Проверка кэша
		if (this.cache) {
			const cached = await this.cache.getQueryResult(`findById:${id}`);
			if (cached) {
				return cached;
			}
		}

		// Выполнение запроса
		const result = await this.queryEngine.query(
			`SELECT * FROM type::thing($table, $id)`,
			{ table: this.tableName, id }
		);

		const record = result.data[0] || null;

		// Кэширование результата
		if (this.cache && record) {
			await this.cache.setQueryResult(`findById:${id}`, record);
		}

		return record;
	}

	/**
	 * Поиск записей с условиями
	 */
	async find(
		where: string,
		vars: Record<string, unknown> = {}
	): Promise<any[]> {
		// Rate limiting
		if (this.rateLimiter && !this.rateLimiter.isAllowed('read')) {
			throw new QueryError('Rate limit exceeded');
		}

		// Проверка SQL инъекций в WHERE условии
		if (!SQLInjectionValidator.validate(where)) {
			throw new QueryError(
				'Potential SQL injection detected in WHERE clause'
			);
		}

		// Проверка SQL инъекций в переменных
		for (const [key, value] of Object.entries(vars)) {
			if (
				typeof value === 'string' &&
				!SQLInjectionValidator.validate(value)
			) {
				throw new QueryError(
					`Potential SQL injection detected in variable: ${key}`
				);
			}
		}

		// Выполнение запроса
		const result = await this.queryEngine.query(
			`SELECT * FROM type::table($table) WHERE ${where}`,
			{ table: this.tableName, ...vars }
		);

		return result.data || [];
	}

	/**
	 * Удаление записи
	 */
	async deleteRecord(id: string): Promise<void> {
		// Rate limiting
		if (this.rateLimiter && !this.rateLimiter.isAllowed('delete')) {
			throw new QueryError('Rate limit exceeded');
		}

		// Аудит
		if (this.auditLogger) {
			this.auditLogger.log({
				operation: 'DELETE',
				tableName: this.tableName,
				recordId: id,
			});
		}

		// Выполнение запроса
		await this.queryEngine.query(
			`DELETE FROM type::thing($table, $id) RETURN NONE`,
			{ table: this.tableName, id }
		);

		// Инвалидация кэша
		if (this.cache) {
			await this.cache.invalidateTable(this.tableName);
		}
	}

	/**
	 * Получение статистики таблицы
	 */
	getStats() {
		return {
			tableName: this.tableName,
			rateLimiter:
				this.rateLimiter ?
					{
						remainingRequests:
							this.rateLimiter.getRemainingRequests('read'),
					}
				:	null,
			auditLogs: this.auditLogger ? this.auditLogger.getLogs() : null,
		};
	}
}

// Улучшенный ORM
export class EnhancedSurrealORM<Schema extends DatabaseSchema> {
	private tables = new Map<
		keyof Schema,
		EnhancedTable<Schema[keyof Schema]>
	>();
	private validator: SchemaValidator;
	private cache?: CacheManager;
	private auditLogger?: AuditLogger;

	constructor(
		private rpc: ConnectionManager,
		private queryEngine: QueryEngine,
		private schema: Schema,
		private config: EnhancedORMConfig = {}
	) {
		this.validator = new SchemaValidator(schema as StrictDatabaseSchema);

		if (config.enableCaching) {
			this.cache = new CacheManager({
				get: async () => null,
				set: async () => {},
				delete: async () => {},
				clear: async () => {},
				has: async () => false,
				keys: async () => [],
				size: async () => 0,
			} as any);
		}

		if (config.enableAudit) {
			this.auditLogger = new AuditLogger();
		}

		// Инициализация таблиц
		for (const [tableName, tableConfig] of Object.entries(schema)) {
			this.tables.set(
				tableName,
				new EnhancedTable(
					rpc,
					queryEngine,
					tableName,
					tableConfig,
					config
				) as EnhancedTable<Schema[keyof Schema]>
			);
		}
	}

	/**
	 * Получение таблицы
	 */
	table<K extends keyof Schema>(name: K): EnhancedTable<Schema[K]> {
		const table = this.tables.get(name);
		if (!table) {
			throw new SchemaError(`Table ${String(name)} not found in schema`);
		}
		return table as EnhancedTable<Schema[K]>;
	}

	/**
	 * Валидация схемы
	 */
	validateSchema(): boolean {
		const validation = this.validator.validateSchema();
		if (!validation.isValid) {
			console.error('Schema validation errors:', validation.errors);
		}
		return validation.isValid;
	}

	/**
	 * Синхронизация схемы
	 */
	async sync(): Promise<void> {
		if (this.config.strictMode && !this.validateSchema()) {
			throw new SchemaError('Schema validation failed in strict mode');
		}

		// Получение существующих таблиц
		const result = await this.queryEngine.query('INFO FOR DB');
		const existingTables = result.data?.tables || {};

		// Создание недостающих таблиц
		for (const [tableName, table] of this.tables) {
			if (!existingTables[tableName]) {
				await this.createTable(tableName as string, table);
			}
		}
	}

	/**
	 * Создание таблицы
	 */
	private async createTable(
		tableName: string,
		table: EnhancedTable<any>
	): Promise<void> {
		const sql = this.generateCreateTableSQL(tableName, table);
		await this.queryEngine.query(sql);
	}

	/**
	 * Генерация SQL для создания таблицы
	 */
	private generateCreateTableSQL(
		tableName: string,
		table: EnhancedTable<any>
	): string {
		// Упрощенная версия генерации SQL
		return `DEFINE TABLE IF NOT EXISTS ${tableName} SCHEMALESS;`;
	}

	/**
	 * Получение статистики ORM
	 */
	getStats() {
		return {
			tables: Array.from(this.tables.keys()),
			queryStats: this.queryEngine.getQueryStats(),
			performanceStats: this.queryEngine.getPerformanceStats(),
			auditLogs: this.auditLogger ? this.auditLogger.getLogs() : null,
		};
	}
}

// Фабрика для создания улучшенного ORM
export function createEnhancedORM<Schema extends DatabaseSchema>(
	rpc: ConnectionManager,
	queryEngine: QueryEngine,
	schema: Schema,
	config?: EnhancedORMConfig
): EnhancedSurrealORM<Schema> {
	return new EnhancedSurrealORM(rpc, queryEngine, schema, config);
}
