import type { KEYS } from "@nemigo/helpers/types";
import type { BaseRecord, RecordBySchema } from "@helpers/types.js";
import type { SurrealRPC } from "./rpc.js";
import type { SurrealENV } from "./types.js";

/**
 * Конфигурация поля таблицы
 */
export interface FieldConfig {
	/** Тип поля в SurrealDB */
	type: "string" | "number" | "bool" | "datetime" | "object" | "array" | "record";
	/** Обязательное поле */
	required?: boolean;
	/** Значение по умолчанию */
	default?: any;
	/** Применять default всегда (DEFAULT ALWAYS) */
	defaultAlways?: boolean;
	/** Фиксируемое вычисляемое значение (VALUE expr) */
	valueExpr?: string;
	/** Поле только для чтения */
	readonly?: boolean;
	/** Ограничения (например, min/max для чисел) */
	constraints?: Record<string, any>;
	/** Ссылка на другую таблицу (для type: "record") */
	references?: string;
	/** Опции ссылочной целостности */
	reference?: { onDelete?: "REJECT" | "CASCADE" | "IGNORE" | "UNSET" | { then: string } };
	/** Комментарий к полю */
	comment?: string;
	/** Тип элементов массива, если type: "array" */
	arrayOf?:
		| { type: "string" | "number" | "bool" | "datetime" | "object" | "record"; references?: string }
		| "string"
		| "number"
		| "bool"
		| "datetime"
		| "object"
		| { record: string }
		| { object: { properties?: Record<string, FieldConfig>; flexible?: boolean } };
	/** Вложенные свойства для object */
	properties?: Record<string, FieldConfig>;
	/** FLEXIBLE для object */
	flexible?: boolean;
	/** Допустимые литералы значения (генерирует ASSERT $value IN [...]) */
	literals?: Array<string | number | boolean>;
	/** Права доступа для поля */
	permissions?: "FULL" | "NONE" | { select?: string; create?: string; update?: string };
}

/**
 * Конфигурация таблицы
 */
export interface TableConfig {
	/** Комментарий к таблице */
	comment?: string;
	/** Режим схемы таблицы */
	schema?: "SCHEMAFULL" | "SCHEMALESS";
	/** Поля таблицы */
	fields: Record<string, FieldConfig>;
	/** Индексы */
	indexes?: Array<{
		name: string;
		fields: string[];
		unique?: boolean;
		search?: {
			analyzer: string;
			bm25?: { k1?: number; b?: number };
			highlights?: boolean;
		};
	}>;
	/** Ограничения на уровне таблицы */
	constraints?: Array<{
		name: string;
		expression: string;
	}>;
	/** Триггеры */
	triggers?: Array<{
		name: string;
		event: "CREATE" | "UPDATE" | "DELETE";
		expression: string;
	}>;
	/** Права доступа для таблицы */
	permissions?: "FULL" | "NONE" | { select?: string; create?: string; update?: string; delete?: string };
}

/**
 * Схема базы данных для ORM
 */
export interface DatabaseSchema {
	[tables: string]: TableConfig;
}

/**
 * Тип записи таблицы на основе конфигурации
 */
export type TableRecord<Config extends TableConfig> = BaseRecord & {
	[K in keyof Config["fields"]]: Config["fields"][K]["required"] extends true
		? FieldType<Config["fields"][K]>
		: FieldType<Config["fields"][K]> | undefined;
};

/**
 * Тип поля на основе конфигурации
 */
type FieldType<F extends FieldConfig> = F["type"] extends "string"
	? string
	: F["type"] extends "number"
		? number
		: F["type"] extends "bool"
			? boolean
			: F["type"] extends "datetime"
				? string
				: F["type"] extends "record"
					? F["references"] extends string
						? `${F["references"]}:${string}`
						: string
					: F["type"] extends "object"
						? Record<string, any>
						: F["type"] extends "array"
							? any[]
							: any;

/**
 * Тип схемы базы данных с типизированными записями
 */
export type TypedDatabaseSchema<Schema extends DatabaseSchema> = {
	[K in keyof Schema]: TableRecord<Schema[K]>;
};

/**
 * Класс для работы с таблицей
 */
export class Table<Config extends TableConfig> {
	private rpc: SurrealRPC<any>;
	private tableName: string;
	private config: Config;

	constructor(rpc: SurrealRPC<any>, tableName: string, config: Config) {
		this.rpc = rpc;
		this.tableName = tableName;
		this.config = config;
	}

	/**
	 * Создать таблицу в базе данных
	 */
	async create(): Promise<void> {
		const sql = this.generateCreateTableSQL();
		await this.rpc.query(sql);
	}

	/**
	 * Удалить таблицу
	 */
	async drop(): Promise<void> {
		await this.rpc.query(`REMOVE TABLE ${this.tableName}`);
	}

	/**
	 * Создать запись
	 */
	async createRecord(data: Omit<TableRecord<Config>, "id" | "zip" | "created" | "updated">): Promise<TableRecord<Config>> {
		const id = `${this.tableName}:${Date.now()}`;
		const now = Date.now();
		const payload = { ...data, id, created: now, updated: now } as Record<string, unknown>;
		const sql = `CREATE type::thing($table, $id) CONTENT $data RETURN AFTER`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, id, data: payload });
		const created = (result[0]?.result as unknown as TableRecord<Config>[])?.[0];
		return created as TableRecord<Config>;
	}

	/**
	 * Найти запись по ID
	 */
	async findById(id: string): Promise<TableRecord<Config> | null> {
		const sql = `SELECT * FROM type::thing($table, $id)`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, id });
		const row = (result[0]?.result as unknown as TableRecord<Config>[])?.[0] ?? null;
		return row;
	}

	/**
	 * Найти все записи
	 */
	async findAll(): Promise<TableRecord<Config>[]> {
		const sql = `SELECT * FROM type::table($table)`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName });
		return (result[0]?.result as unknown as TableRecord<Config>[]) || [];
	}

	/**
	 * Найти записи по условию WHERE
	 */
	async find(where: string, vars: Record<string, unknown> = {}): Promise<TableRecord<Config>[]> {
		const sql = `SELECT * FROM type::table($table) WHERE ${where}`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, ...vars });
		return (result[0]?.result as unknown as TableRecord<Config>[]) || [];
	}

	/**
	 * Гибкий select с where/order/limit
	 */
	async select(options: {
		where?: string;
		vars?: Record<string, unknown>;
		orderBy?: string;
		orderDir?: "ASC" | "DESC";
		limit?: number;
		start?: number;
	}): Promise<TableRecord<Config>[]> {
		let sql = `SELECT * FROM type::table($table)`;
		if (options.where) sql += ` WHERE ${options.where}`;
		if (options.orderBy) sql += ` ORDER BY ${options.orderBy} ${options.orderDir ?? "ASC"}`;
		if (typeof options.limit === "number") sql += ` LIMIT ${options.limit}`;
		if (typeof options.start === "number") sql += ` START ${options.start}`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, ...(options.vars ?? {}) });
		return (result[0]?.result as unknown as TableRecord<Config>[]) || [];
	}

	/** Подсчёт записей по условию */
	async count(where?: string, vars: Record<string, unknown> = {}): Promise<number> {
		let sql = `SELECT count() AS count FROM type::table($table)`;
		if (where) sql += ` WHERE ${where}`;
		const res = await this.rpc.query<{ count: number }[]>(sql, { table: this.tableName, ...vars });
		return (res[0]?.result as any[])?.[0]?.count ?? 0;
	}

	/** Удаление по условию */
	async deleteWhere(where: string, vars: Record<string, unknown> = {}): Promise<void> {
		const sql = `DELETE FROM type::table($table) WHERE ${where} RETURN NONE`;
		await this.rpc.query(sql, { table: this.tableName, ...vars });
	}

	/** Пагинация */
	async page(options: {
		where?: string;
		vars?: Record<string, unknown>;
		orderBy?: string;
		orderDir?: "ASC" | "DESC";
		page: number;
		pageSize: number;
	}): Promise<{ items: TableRecord<Config>[]; total: number; page: number; pageSize: number }> {
		const { page, pageSize, ...rest } = options;
		const start = page * pageSize;
		const [items, total] = await Promise.all([
			this.select({ ...rest, start, limit: pageSize }),
			this.count(rest.where, rest.vars ?? {}),
		]);
		return { items, total, page, pageSize };
	}

	/** Query Builder */
	query() {
		return new TableQuery<TableRecord<Config>>(this.rpc as any, this.tableName);
	}

	/**
	 * Обновить запись
	 */
	async updateRecord(id: string, data: Partial<Omit<TableRecord<Config>, "id" | "zip" | "created">>): Promise<TableRecord<Config>> {
		const updateData = { ...data, updated: Date.now() } as Record<string, unknown>;
		const sql = `UPDATE type::thing($table, $id) CONTENT $data RETURN AFTER`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, id, data: updateData });
		const updated = (result[0]?.result as unknown as TableRecord<Config>[])?.[0];
		return updated as TableRecord<Config>;
	}

	/** MERGE частичное объединение */
	async mergeRecord(id: string, data: Partial<Omit<TableRecord<Config>, "id" | "zip" | "created">>): Promise<TableRecord<Config>> {
		const sql = `UPDATE type::thing($table, $id) MERGE $data RETURN AFTER`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, id, data });
		return (result[0]?.result as unknown as TableRecord<Config>[])?.[0] as TableRecord<Config>;
	}

	/** PATCH JSON Patch */
	async patchRecord(id: string, patch: unknown): Promise<TableRecord<Config>> {
		const sql = `UPDATE type::thing($table, $id) PATCH $data RETURN AFTER`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, id, data: patch });
		return (result[0]?.result as unknown as TableRecord<Config>[])?.[0] as TableRecord<Config>;
	}

	/** REPLACE полная замена */
	async replaceRecord(id: string, data: Omit<TableRecord<Config>, "id">): Promise<TableRecord<Config>> {
		const sql = `UPDATE type::thing($table, $id) REPLACE $data RETURN AFTER`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, id, data });
		return (result[0]?.result as unknown as TableRecord<Config>[])?.[0] as TableRecord<Config>;
	}

	/** UPSERT */
	async upsertRecord(id: string, data: Partial<TableRecord<Config>>): Promise<TableRecord<Config>> {
		const now = Date.now();
		const record = { ...data, id, updated: now } as Record<string, unknown>;
		const sql = `UPSERT type::thing($table, $id) MERGE $data RETURN AFTER`;
		const result = await this.rpc.query<TableRecord<Config>[]>(sql, { table: this.tableName, id, data: record });
		return (result[0]?.result as unknown as TableRecord<Config>[])?.[0] as TableRecord<Config>;
	}

	/**
	 * Удалить запись
	 */
	async deleteRecord(id: string): Promise<void> {
		const sql = `DELETE FROM type::thing($table, $id) RETURN NONE`;
		await this.rpc.query(sql, { table: this.tableName, id });
	}

	/**
	 * Генерация SQL для создания таблицы
	 */
	private generateCreateTableSQL(): string {
		const parts: string[] = [];

		// Определение таблицы
		const schemaMode = this.config.schema ?? "SCHEMALESS";
		let tableDef = `DEFINE TABLE IF NOT EXISTS ${this.tableName} ${schemaMode}`;
		if (this.config.permissions) {
			if (this.config.permissions === "FULL" || this.config.permissions === "NONE") {
				tableDef += ` PERMISSIONS ${this.config.permissions}`;
			} else {
				tableDef += ` PERMISSIONS`;
				if (this.config.permissions.select) tableDef += ` FOR select ${this.config.permissions.select}`;
				if (this.config.permissions.create) tableDef += ` FOR create ${this.config.permissions.create}`;
				if (this.config.permissions.update) tableDef += ` FOR update ${this.config.permissions.update}`;
				if (this.config.permissions.delete) tableDef += ` FOR delete ${this.config.permissions.delete}`;
			}
		}
		tableDef += `;`;
		parts.push(tableDef);
		if (this.config.comment) parts.push(`-- ${this.config.comment}`);

		// Определение полей
		for (const [fieldName, fieldConfig] of Object.entries(this.config.fields)) {
			const fieldSQL = this.generateFieldSQL(fieldName, fieldConfig);
			parts.push(fieldSQL);
		}

		// Индексы
		if (this.config.indexes) {
			for (const index of this.config.indexes) {
				const indexSQL = this.generateIndexSQL(index);
				parts.push(indexSQL);
			}
		}

		// Ограничения
		if (this.config.constraints) {
			for (const constraint of this.config.constraints) {
				const constraintSQL = this.generateConstraintSQL(constraint);
				parts.push(constraintSQL);
			}
		}

		// Триггеры
		if (this.config.triggers) {
			for (const trigger of this.config.triggers) {
				const triggerSQL = this.generateTriggerSQL(trigger);
				parts.push(triggerSQL);
			}
		}

		return parts.join("\n");
	}

	/** Обеспечить схему таблицы (идемпотентно, за счет IF NOT EXISTS) */
	async ensureSchema(): Promise<void> {
		const sql = this.generateCreateTableSQL();
		await this.rpc.query(sql);
	}

	/** INFO FOR TABLE */
	async getInfo(): Promise<{
		fields: Record<string, string>;
		indexes: Record<string, { sql: string }>;
		events: Record<string, { sql: string }>;
		table?: { schema?: string; permissions?: TableConfig["permissions"]; comment?: string };
	}> {
		try {
			const res = await this.rpc.query<any>(`INFO FOR TABLE ${this.tableName}`);
			const info = (res[0]?.result as any) ?? {};
			let permissions: TableConfig["permissions"] | undefined;
			if (info.permissions) {
				if (typeof info.permissions === "string") {
					const p = info.permissions.toUpperCase();
					if (p === "FULL" || p === "NONE") permissions = p as any;
				} else if (typeof info.permissions === "object") {
					const obj: any = {};
					if (info.permissions.select) obj.select = info.permissions.select;
					if (info.permissions.create) obj.create = info.permissions.create;
					if (info.permissions.update) obj.update = info.permissions.update;
					if (info.permissions.delete) obj.delete = info.permissions.delete;
					if (Object.keys(obj).length) permissions = obj as any;
				}
			}
			const comment: string | undefined = typeof info.comment === "string" ? info.comment : undefined;
			// schema режим может отсутствовать в INFO; оставим undefined, если недоступен
			const schemaMode: string | undefined = info.schema ?? info.mode ?? undefined;
			return {
				fields: info.fields ?? {},
				indexes: info.indexes ?? {},
				events: info.events ?? {},
				table: { schema: schemaMode, permissions, comment },
			};
		} catch {
			return { fields: {}, indexes: {}, events: {} } as any;
		}
	}

	/** План недостающих сущностей (пока упрощённо: полное DEFINE с IF NOT EXISTS) */
	async planMissing(): Promise<string> {
		return this.generateCreateTableSQL();
	}

	/** Миграция недостающих: выполняет DEFINE ... IF NOT EXISTS */
	async migrateMissing(): Promise<void> {
		const sql = await this.planMissing();
		await this.rpc.query(sql);
	}

	/** План дифф-миграции: только недостающие поля/индексы/события */
	async planDiff(): Promise<string> {
		const info = await this.getInfo();
		const parts: string[] = [];
		// Поля
		for (const [fieldName, fieldCfg] of Object.entries(this.config.fields)) {
			const have = info.fields[fieldName] as string | undefined;
			if (!have) {
				parts.push(this.generateFieldSQL(fieldName, fieldCfg));
			} else {
				const want = this.generateFieldSQL(fieldName, fieldCfg).replace("IF NOT EXISTS ", "OVERWRITE ");
				const normalized = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
				if (normalized(have) !== normalized(want)) parts.push(want);
			}
		}
		// Индексы
		if (this.config.indexes) {
			for (const idx of this.config.indexes) {
				const current = info.indexes[idx.name];
				if (!current) parts.push(this.generateIndexSQL(idx));
				else {
					const want = this.generateIndexSQL(idx).replace("IF NOT EXISTS ", "OVERWRITE ");
					const have = current.sql as string;
					const normalized = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
					if (normalized(have) !== normalized(want)) parts.push(want);
				}
			}
		}
		// Ограничения -> как события
		if (this.config.constraints) {
			for (const c of this.config.constraints) {
				const have = info.events[c.name]?.sql as string | undefined;
				const want = this.generateConstraintSQL(c).replace("IF NOT EXISTS ", "OVERWRITE ");
				if (!have) parts.push(this.generateConstraintSQL(c));
				else {
					const normalized = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
					if (normalized(have) !== normalized(want)) parts.push(want);
				}
			}
		}
		// Триггеры
		if (this.config.triggers) {
			for (const t of this.config.triggers) {
				const have = info.events[t.name]?.sql as string | undefined;
				const want = this.generateTriggerSQL(t).replace("IF NOT EXISTS ", "OVERWRITE ");
				if (!have) parts.push(this.generateTriggerSQL(t));
				else {
					const normalized = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
					if (normalized(have) !== normalized(want)) parts.push(want);
				}
			}
		}
		// Режим схемы, права и комментарий таблицы
		const alters: string[] = [];
		const currentTable = (info as any).table as { schema?: string; permissions?: TableConfig["permissions"]; comment?: string } | undefined;
		const samePerms = (a?: TableConfig["permissions"], b?: TableConfig["permissions"]) => {
			if (!a && !b) return true;
			if (!a || !b) return false;
			if (typeof a === "string" || typeof b === "string") return a === b;
			return (
				(a.select ?? "") === (b.select ?? "") &&
				(a.create ?? "") === (b.create ?? "") &&
				(a.update ?? "") === (b.update ?? "") &&
				(a.delete ?? "") === (b.delete ?? "")
			);
		};
		if (this.config.schema && this.config.schema !== (currentTable?.schema as any)) {
			alters.push(this.config.schema);
		}
		if (
			(this.config.permissions && !samePerms(this.config.permissions, currentTable?.permissions)) ||
			(!this.config.permissions && currentTable?.permissions)
		) {
			if (this.config.permissions === "FULL" || this.config.permissions === "NONE") {
				alters.push(`PERMISSIONS ${this.config.permissions}`);
			} else if (this.config.permissions && typeof this.config.permissions === "object") {
				const p: string[] = [];
				if (this.config.permissions.select) p.push(`FOR select ${this.config.permissions.select}`);
				if (this.config.permissions.create) p.push(`FOR create ${this.config.permissions.create}`);
				if (this.config.permissions.update) p.push(`FOR update ${this.config.permissions.update}`);
				if (this.config.permissions.delete) p.push(`FOR delete ${this.config.permissions.delete}`);
				if (p.length) alters.push(`PERMISSIONS ${p.join(" ")}`);
			}
		}
		if (this.config.comment !== undefined && this.config.comment !== (currentTable?.comment ?? undefined)) {
			alters.push(`COMMENT ${JSON.stringify(this.config.comment)}`);
		}
		if (alters.length) parts.push(`ALTER TABLE ${this.tableName} ${alters.join(" ")};`);
		return parts.join("\n");
	}

	/** Применить дифф */
	async applyDiff(): Promise<void> {
		const sql = await this.planDiff();
		if (sql.trim()) await this.rpc.query(sql);
	}

	/**
	 * Генерация SQL для поля
	 */
	private generateFieldSQL(fieldName: string, config: FieldConfig): string {
		const parts: string[] = [];

		// Комментарий
		if (config.comment) {
			parts.push(`-- ${config.comment}`);
		}

		// Определение поля
		let fieldDef = `DEFINE FIELD IF NOT EXISTS ${fieldName} ON TABLE ${this.tableName}`;

		// Добавляем тип только для определенных типов
		if (
			[
				"string",
				"number",
				"bool",
				"datetime",
				"record",
				"object",
				"array",
			].includes(config.type)
		) {
			if (config.type === "record" && config.references) fieldDef += ` TYPE record<${config.references}>`;
			else if (config.type === "array" && config.arrayOf) {
				if (typeof config.arrayOf === "string") fieldDef += ` TYPE array<${config.arrayOf}>`;
				else if ((config.arrayOf as any).record) fieldDef += ` TYPE array<record<${(config.arrayOf as any).record}>>`;
				else if (typeof config.arrayOf === "object" && (config.arrayOf as any).type === "record" && (config.arrayOf as any).references)
					fieldDef += ` TYPE array<record<${(config.arrayOf as any).references}>>`;
				else if (typeof config.arrayOf === "object" && (config.arrayOf as any).object) fieldDef += ` TYPE array<object>`;
				else fieldDef += ` TYPE array`;
			} else if (config.type === "object") {
				fieldDef += ` TYPE object`;
				if (config.flexible) fieldDef += ` FLEXIBLE`;
			} else {
				fieldDef += ` TYPE ${config.type}`;
			}
		}

		// REFERENCE ON DELETE ... (для record/array<record<...>>)
		if ((config.type === "record" && config.references) || (config.type === "array" && (config.arrayOf as any)?.record)) {
			const del = config.reference?.onDelete;
			if (del) {
				if (typeof del === "string") fieldDef += ` REFERENCE ON DELETE ${del}`;
				else if (typeof del === "object" && del.then) fieldDef += ` REFERENCE ON DELETE THEN ${del.then}`;
			}
		}

		// Обязательность (только для определенных типов)
		if (
			config.required &&
			[
				"string",
				"number",
				"bool",
				"datetime",
				"record",
				"object",
				"array",
			].includes(config.type)
		) {
			fieldDef += " ASSERT $value != NONE";
		}

		// Значение по умолчанию
		if (config.default !== undefined) {
			fieldDef += ` DEFAULT${config.defaultAlways ? " ALWAYS" : ""} ${JSON.stringify(config.default)}`;
		}

		// VALUE выражение
		if (config.valueExpr) {
			fieldDef += ` VALUE ${config.valueExpr}`;
		}

		// READONLY
		if (config.readonly) fieldDef += ` READONLY`;

		// Права доступа
		if (config.permissions) {
			if (config.permissions === "FULL" || config.permissions === "NONE") {
				fieldDef += ` PERMISSIONS ${config.permissions}`;
			} else {
				fieldDef += ` PERMISSIONS`;
				if (config.permissions.select) fieldDef += ` FOR select ${config.permissions.select}`;
				if (config.permissions.create) fieldDef += ` FOR create ${config.permissions.create}`;
				if (config.permissions.update) fieldDef += ` FOR update ${config.permissions.update}`;
			}
		}

		// Ссылка на другую таблицу — тип уже уточнён выше через record<tb>

		// Ограничения
		if (config.constraints) {
			for (const [constraint, value] of Object.entries(config.constraints)) {
				// Специальные маппинги популярных ограничений
				if (constraint === "string::is::email") {
					fieldDef += ` ASSERT string::is::email($value)`;
					continue;
				}
				if (constraint === "string::len" && Array.isArray(value) && value.length === 2) {
					const [min, max] = value as [number, number];
					fieldDef += ` ASSERT string::len($value) >= ${JSON.stringify(min)} AND string::len($value) <= ${JSON.stringify(max)}`;
					continue;
				}
				if (constraint === "number::min") {
					fieldDef += ` ASSERT $value >= ${JSON.stringify(value)}`;
					continue;
				}
				if (constraint === "number::max") {
					fieldDef += ` ASSERT $value <= ${JSON.stringify(value)}`;
					continue;
				}

				// Фоллбек: вызывать как функцию constraint($value, ...)
				if (Array.isArray(value)) {
					fieldDef += ` ASSERT ${constraint}($value, [${value.map((v) => JSON.stringify(v)).join(", ")}])`;
				} else if (typeof value === "boolean") {
					fieldDef += ` ASSERT ${constraint}($value)`;
				} else {
					fieldDef += ` ASSERT ${constraint}($value, ${JSON.stringify(value)})`;
				}
			}
		}

		// Литералы
		if (config.literals && config.literals.length) {
			const values = config.literals.map((v) => JSON.stringify(v)).join(", ");
			fieldDef += ` ASSERT $value IN [${values}]`;
		}

		parts.push(fieldDef + ";");

		// Вложенные поля для object
		if (config.type === "object" && config.properties) {
			for (const [child, childCfg] of Object.entries(config.properties)) {
				parts.push(this.generateFieldSQL(`${fieldName}.${child}`, childCfg));
			}
		}
		// Вложенные поля для array<object>
		if (config.type === "array" && typeof config.arrayOf === "object" && (config.arrayOf as any).object) {
			const obj = (config.arrayOf as any).object as { properties?: Record<string, FieldConfig> };
			for (const [child, childCfg] of Object.entries(obj.properties || {})) {
				parts.push(this.generateFieldSQL(`${fieldName}.*.${child}`, childCfg));
			}
		}

		return parts.join("\n");
	}

	/**
	 * Генерация SQL для индекса
	 */
	private generateIndexSQL(index: {
		name: string;
		fields: string[];
		unique?: boolean;
		search?: { analyzer: string; bm25?: { k1?: number; b?: number }; highlights?: boolean };
	}): string {
		if (index.search) {
			const parts: string[] = [];
			parts.push(`DEFINE INDEX IF NOT EXISTS ${index.name} ON TABLE ${this.tableName} FIELDS ${index.fields.join(", ")}`);
			parts.push(`SEARCH ANALYZER ${index.search.analyzer}`);
			if (index.search.bm25 && (index.search.bm25.k1 !== undefined || index.search.bm25.b !== undefined)) {
				const k1 = index.search.bm25.k1 ?? "";
				const b = index.search.bm25.b ?? "";
				parts.push(`BM25 (${k1}, ${b})`);
			}
			if (index.search.highlights) parts.push("HIGHLIGHTS");
			return parts.join(" ") + ";";
		}
		const unique = index.unique ? " UNIQUE" : "";
		return `DEFINE INDEX IF NOT EXISTS ${index.name} ON TABLE ${this.tableName} FIELDS ${index.fields.join(", ")}${unique};`;
	}

	/**
	 * Генерация SQL для ограничения
	 */
	private generateConstraintSQL(constraint: { name: string; expression: string }): string {
		// Реализуем как EVENT, который бросает ошибку при нарушении
		return `DEFINE EVENT IF NOT EXISTS ${constraint.name} ON TABLE ${this.tableName} WHEN $event = "CREATE" OR $event = "UPDATE" THEN (
			IF NOT (${constraint.expression}) THEN THROW { code: 400, message: "constraint:${constraint.name}" } END
		);`;
	}

	/**
	 * Генерация SQL для триггера
	 */
	private generateTriggerSQL(trigger: { name: string; event: string; expression: string }): string {
		return `DEFINE EVENT IF NOT EXISTS ${trigger.name} ON TABLE ${this.tableName} WHEN $event = "${trigger.event}" THEN (${trigger.expression});`;
	}
}

/** Простой Query Builder для SELECT */
export class TableQuery<RecordType> {
	private rpc: SurrealRPC<any>;
	private tableName: string;
	private _where: string = "";
	private _vars: Record<string, unknown> = {};
	private _orderBy: string | undefined;
	private _orderDir: "ASC" | "DESC" = "ASC";
	private _orderRaw: string | undefined;
	private _limit: number | undefined;
	private _start: number | undefined;
	private _fetch: string[] = [];
	private _select: string[] = [];
	private _omit: string[] = [];
	private _value: string | undefined;
	private _distinct: boolean = false;
	private _groupBy: string[] = [];
	private _split: string | undefined;
	private _withIndexes: { noindex?: boolean; indexes?: string[] } | undefined;
	private _only: boolean = false;
	private _version: string | undefined;
	private _timeout: string | undefined;
	private _parallel: boolean = false;
	private _explain: false | "BASIC" | "FULL" = false;

	constructor(rpc: SurrealRPC<any>, tableName: string) {
		this.rpc = rpc;
		this.tableName = tableName;
	}

	where(clause: string, vars: Record<string, unknown> = {}) {
		this._where = clause;
		Object.assign(this._vars, vars);
		return this;
	}

	orderBy(field: string, dir: "ASC" | "DESC" = "ASC") {
		this._orderBy = field;
		this._orderDir = dir;
		this._orderRaw = undefined;
		return this;
	}

	orderByRand() {
		this._orderBy = undefined;
		this._orderRaw = "RAND()";
		return this;
	}

	orderByWith(field: string, opts: { dir?: "ASC" | "DESC"; numeric?: boolean; collate?: boolean } = {}) {
		const parts: string[] = [field];
		if (opts.collate) parts.push("COLLATE");
		if (opts.numeric) parts.push("NUMERIC");
		if (opts.dir) parts.push(opts.dir);
		this._orderRaw = parts.join(" ");
		this._orderBy = undefined;
		return this;
	}

	limit(n: number) {
		this._limit = n;
		return this;
	}
	start(n: number) {
		this._start = n;
		return this;
	}
	fetch(fields: string[]) {
		this._fetch = fields;
		return this;
	}
	select(fields: string[]) {
		this._select = fields;
		return this;
	}
	omit(fields: string[]) {
		this._omit = fields;
		return this;
	}
	value(field: string) {
		this._value = field;
		return this;
	}
	distinct(flag: boolean = true) {
		this._distinct = flag;
		return this;
	}
	groupBy(fields: string[]) {
		this._groupBy = fields;
		return this;
	}
	split(field: string) {
		this._split = field;
		return this;
	}
	withIndexes(indexes: string[]) {
		this._withIndexes = { indexes };
		return this;
	}
	withNoIndex() {
		this._withIndexes = { noindex: true };
		return this;
	}
	only(flag: boolean = true) {
		this._only = flag;
		return this;
	}
	version(expr: string) {
		this._version = expr;
		return this;
	}
	timeout(duration: string) {
		this._timeout = duration;
		return this;
	}
	parallel(flag: boolean = true) {
		this._parallel = flag;
		return this;
	}
	explain() {
		this._explain = "BASIC";
		return this;
	}
	explainFull() {
		this._explain = "FULL";
		return this;
	}

	toSQL(): { sql: string; vars: Record<string, unknown> } {
		let selectKeyword = "SELECT";
		if (this._distinct) selectKeyword += " DISTINCT";
		let head = `${selectKeyword} *`;
		if (this._value) head = `${selectKeyword} VALUE ${this._value}`;
		else if (this._select.length) {
			head = `${selectKeyword} ${this._select.join(", ")}`;
			if (this._omit.length) head += ` OMIT ${this._omit.join(", ")}`;
		}
		let sql = `${head} FROM ${this._only ? "ONLY " : ""}type::table($table)`;
		if (this._withIndexes?.noindex) sql += ` WITH NOINDEX`;
		else if (this._withIndexes?.indexes?.length) sql += ` WITH INDEX ${this._withIndexes.indexes.join(", ")}`;
		if (this._version) sql += ` VERSION ${this._version}`;
		if (this._split) sql += ` SPLIT ${this._split}`;
		if (this._where) sql += ` WHERE ${this._where}`;
		if (this._groupBy.length) sql += ` GROUP BY ${this._groupBy.join(", ")}`;
		if (this._orderRaw) sql += ` ORDER BY ${this._orderRaw}`;
		else if (this._orderBy) sql += ` ORDER BY ${this._orderBy} ${this._orderDir}`;
		if (typeof this._limit === "number") sql += ` LIMIT ${this._limit}`;
		if (typeof this._start === "number") sql += ` START ${this._start}`;
		if (this._fetch.length) sql += ` FETCH ${this._fetch.join(", ")}`;
		if (this._timeout) sql += ` TIMEOUT ${this._timeout}`;
		if (this._parallel) sql += ` PARALLEL`;
		if (this._explain === "FULL") sql += ` EXPLAIN FULL`;
		else if (this._explain === "BASIC") sql += ` EXPLAIN`;
		return { sql, vars: { table: this.tableName, ...this._vars } };
	}

	async exec(): Promise<RecordType[]> {
		const { sql, vars } = this.toSQL();
		const res = await this.rpc.query<RecordType[]>(sql, vars);
		return (res[0]?.result as unknown as RecordType[]) || [];
	}

	async first(): Promise<RecordType | null> {
		const hadLimit = typeof this._limit === "number";
		if (!hadLimit) this._limit = 1;
		try {
			const rows = await this.exec();
			return rows[0] ?? null;
		} finally {
			if (!hadLimit) this._limit = undefined;
		}
	}

	async execValue<T = unknown>(): Promise<T[]> {
		if (!this._value) {
			throw new Error("execValue() требует value(field)");
		}
		const { sql, vars } = this.toSQL();
		const res = await this.rpc.query<T[]>(sql, vars);
		return (res[0]?.result as unknown as T[]) || [];
	}

	async firstValue<T = unknown>(): Promise<T | null> {
		const hadLimit = typeof this._limit === "number";
		if (!this._value) {
			throw new Error("firstValue() требует value(field)");
		}
		if (!hadLimit) this._limit = 1;
		try {
			const values = await this.execValue<T>();
			return values[0] ?? null;
		} finally {
			if (!hadLimit) this._limit = undefined;
		}
	}

	async count(): Promise<number> {
		let sql = `SELECT count() AS count FROM type::table($table)`;
		if (this._where) sql += ` WHERE ${this._where}`;
		const res = await this.rpc.query<{ count: number }[]>(sql, { table: this.tableName, ...this._vars });
		return (res[0]?.result as any[])?.[0]?.count ?? 0;
	}
}

/**
 * ORM класс для работы с базой данных
 */
export class SurrealORM<Schema extends DatabaseSchema> {
	private tables = new Map<keyof Schema, Table<Schema[keyof Schema]>>();
	private rpc: SurrealRPC<TypedDatabaseSchema<Schema>>;
	private schema: Schema;

	constructor(rpc: SurrealRPC<TypedDatabaseSchema<Schema>>, schema: Schema) {
		this.rpc = rpc;
		this.schema = schema;
		// Инициализация таблиц
		for (const [tableName, config] of Object.entries(schema)) {
			this.tables.set(tableName, new Table(rpc, tableName, config) as Table<Schema[keyof Schema]>);
		}
	}

	/** Introspection: INFO FOR DB */
	async infoDB(): Promise<any> {
		const res = await (this.rpc as any).query("INFO FOR DB");
		return (res?.[0]?.result as any) ?? {};
	}

	/**
	 * Парсинг строкового типа Surreal в FieldConfig
	 */
	private parseFieldType(typeStr?: string): Pick<FieldConfig, "type" | "references" | "arrayOf"> {
		if (!typeStr) return { type: "object" };
		const t = typeStr.trim().toLowerCase();
		// record<user>
		const rec = t.match(/^record<([a-z0-9_:-]+)>$/i);
		if (rec) return { type: "record", references: rec[1] };
		// array<record<user>>
		const arrRec = t.match(/^array<\s*record<([^>]+)>\s*>$/i);
		if (arrRec) return { type: "array", arrayOf: { record: arrRec[1] } } as any;
		// array<string|number|bool|datetime|object>
		const arr = t.match(/^array<\s*([a-z0-9_]+)\s*>$/i);
		if (arr) {
			const el = arr[1];
			if (el === "string" || el === "number" || el === "bool" || el === "datetime" || el === "object") {
				return { type: "array", arrayOf: el as any };
			}
			// array<record> без цели → пусть будет object
			return { type: "array", arrayOf: "object" as any };
		}
		if (t === "string" || t === "number" || t === "bool" || t === "datetime" || t === "object") {
			return { type: t as any };
		}
		return { type: "object" };
	}

	/** Introspection: INFO FOR TABLE → TableConfig */
	async introspectTable(table: string): Promise<TableConfig> {
		// STRUCTURE предпочтительнее (массивы полей)
		let info: any;
		try {
			const res = await (this.rpc as any).query(`INFO FOR TABLE ${table} STRUCTURE`);
			info = res?.[0]?.result ?? {};
		} catch {
			const res = await (this.rpc as any).query(`INFO FOR TABLE ${table}`);
			info = res?.[0]?.result ?? {};
		}

		const fields: Record<string, FieldConfig> = {};
		// Варианты: info.fields как объект; либо info.fields как массив структур
		if (Array.isArray(info.fields)) {
			for (const f of info.fields) {
				const name: string = f.name ?? f.key ?? f.field ?? "";
				if (!name) continue;
				const typeStr: string | undefined = f.type ?? f.kind ?? f.datatype;
				const base = this.parseFieldType(typeStr);
				const required = f.nullable === false || f.required === true ? true : undefined;
				const cfg: FieldConfig = {
					...base,
					required,
					default: f.value ?? f.default,
					comment: f.comment,
				};
				if (f.readonly === true) cfg.readonly = true;
				if (f.value_expr || f.value) cfg.valueExpr = f.value_expr ?? f.value;
				if (f.default_always === true) cfg.defaultAlways = true;
				if (f.reference?.onDelete) cfg.reference = { onDelete: f.reference.onDelete };
				fields[name] = cfg;
			}
		} else if (info.fields && typeof info.fields === "object") {
			for (const [name, def] of Object.entries<any>(info.fields)) {
				const defStr = typeof def === "string" ? def : (def?.sql ?? "");
				// TYPE
				let typeStr: string | undefined;
				const mType = defStr.match(/\bTYPE\s+([^\s;]+)/i);
				if (mType) typeStr = mType[1];
				const base = this.parseFieldType(typeStr);
				const cfg: FieldConfig = { ...base } as any;
				// DEFAULT / DEFAULT ALWAYS (только литералы)
				const mDef = defStr.match(/\bDEFAULT(\s+ALWAYS)?\s+([^;]+?)(?:\s+READONLY|\s+ASSERT|\s+PERMISSIONS|;)/i);
				if (mDef) {
					cfg.defaultAlways = !!mDef[1];
					const expr = mDef[2].trim();
					if (!/[()\w]+::/.test(expr)) {
						try {
							cfg.default = JSON.parse(expr);
						} catch {
							if (/^".*"$/.test(expr) || /^'.*'$/.test(expr)) cfg.default = expr.replace(/^['"]|['"]$/g, "");
						}
					}
				}
				// VALUE expr
				const mVal = defStr.match(/\bVALUE\s+([^;]+?)(?:\s+READONLY|\s+ASSERT|\s+PERMISSIONS|;)/i);
				if (mVal) cfg.valueExpr = mVal[1].trim();
				// READONLY
				if (/\bREADONLY\b/i.test(defStr)) cfg.readonly = true;
				// REFERENCE ON DELETE ...
				const mRef = defStr.match(/REFERENCE\s+ON\s+DELETE\s+(REJECT|CASCADE|IGNORE|UNSET|THEN\s+[^\s;]+)/i);
				if (mRef) {
					const v = mRef[1];
					cfg.reference = v.startsWith("THEN ") ? { onDelete: { then: v.slice(5).trim() } as any } : { onDelete: v as any };
				}
				fields[name] = cfg;
			}
		}

		// Реконструкция вложенных полей из имён с точками и a.*.b
		const nested: Record<string, FieldConfig> = {};
		const setLeaf = (container: FieldConfig, key: string, leaf: FieldConfig) => {
			if (container.type === "object") {
				container.properties = container.properties || {};
				container.properties[key] = leaf;
			}
		};
		const ensureObject = (parent: Record<string, FieldConfig>, key: string): FieldConfig => {
			if (!parent[key]) parent[key] = { type: "object", properties: {} } as any;
			if (parent[key].type !== "object") parent[key] = { type: "object", properties: {} } as any;
			return parent[key];
		};
		const ensureArrayObject = (parent: Record<string, FieldConfig>, key: string): FieldConfig => {
			if (!parent[key]) parent[key] = { type: "array", arrayOf: { object: { properties: {} } } } as any;
			if (parent[key].type !== "array" || !(parent[key] as any).arrayOf || !(parent[key] as any).arrayOf.object) {
				parent[key] = { type: "array", arrayOf: { object: { properties: {} } } } as any;
			}
			return parent[key];
		};
		const addNested = (fullName: string, cfg: FieldConfig) => {
			if (!fullName.includes(".") && !fullName.includes("*")) {
				nested[fullName] = nested[fullName] ?? cfg;
				return;
			}
			const tokens = fullName.split(".");
			let cursor: Record<string, FieldConfig> = nested;
			let currentContainer: FieldConfig | null = null;
			for (let i = 0; i < tokens.length; i++) {
				const tok = tokens[i];
				const isLast = i === tokens.length - 1;
				if (tok === "*") {
					// объект массива на предыдущем ключе
					continue;
				}
				const nextTok = tokens[i + 1];
				if (nextTok === "*") {
					// текущий токен — массив объектов
					currentContainer = ensureArrayObject(cursor, tok);
					// продвинемся через * к следующему узлу
					i++; // пропускаем '*'
					// далее следующий токен будет строковым ключом свойства объекта в массиве
					const arrObj = (currentContainer as any).arrayOf.object as any as { properties?: Record<string, FieldConfig> };
					arrObj.properties = arrObj.properties || {};
					if (isLast) {
						arrObj.properties[tokens[i + 1] ?? ""] = cfg;
						break;
					}
					cursor = arrObj.properties as Record<string, FieldConfig>;
					continue;
				}
				if (isLast) {
					if (currentContainer) {
						if (currentContainer.type === "object") {
							setLeaf(currentContainer, tok, cfg);
						} else if (currentContainer.type === "array" && (currentContainer as any).arrayOf?.object) {
							const arrObj = (currentContainer as any).arrayOf.object as { properties?: Record<string, FieldConfig> };
							arrObj.properties = arrObj.properties || {};
							arrObj.properties[tok] = cfg;
						}
					} else {
						// верхний уровень объекта
						nested[tok] = nested[tok] ?? cfg;
					}
					break;
				}
				// обычный объект
				const obj = ensureObject(cursor, tok);
				obj.properties = obj.properties || {};
				cursor = obj.properties as Record<string, FieldConfig>;
				currentContainer = obj;
			}
		};
		for (const [fname, cfg] of Object.entries(fields)) addNested(fname, cfg);

		const indexes: TableConfig["indexes"] = [];
		if (info.indexes && typeof info.indexes === "object") {
			for (const [idxName, idx] of Object.entries<any>(info.indexes)) {
				// Пытаемся вытащить поля и настройки из SQL
				let fieldsList: string[] = [];
				let unique: boolean | undefined;
				let search: NonNullable<TableConfig["indexes"]>[number]["search"] | undefined;
				const sql: string = idx?.sql ?? idx;
				if (typeof sql === "string") {
					const m = sql.match(/FIELDS\s+([^\s;]+)/i);
					if (m) fieldsList = m[1].split(",").map((s) => s.trim());
					unique = /\bUNIQUE\b/i.test(sql) ? true : undefined;
					const mSearch = sql.match(/SEARCH\s+ANALYZER\s+([\w:.-]+)/i);
					if (mSearch) {
						search = { analyzer: mSearch[1] } as any;
						const mBm = sql.match(/BM25\s*\(\s*([^,)]*)\s*,\s*([^)]*)\)/i);
						if (mBm) {
							const k1 = mBm[1].trim();
							const b = mBm[2].trim();
							(search as any).bm25 = {};
							if (k1) (search as any).bm25.k1 = Number(k1);
							if (b) (search as any).bm25.b = Number(b);
						}
						if (/\bHIGHLIGHTS\b/i.test(sql)) (search as any).highlights = true;
					}
				}
				indexes!.push({ name: idxName, fields: fieldsList, unique, search } as any);
			}
		}

		let permissions: TableConfig["permissions"] | undefined;
		if (info.permissions) {
			// Попробуем собрать структуру FOR select/create/update/delete если доступны
			const p = info.permissions as any;
			if (typeof p === "string") {
				permissions = p.toUpperCase() === "FULL" || p.toUpperCase() === "NONE" ? (p.toUpperCase() as any) : undefined;
			} else if (typeof p === "object") {
				const obj: any = {};
				if (p.select) obj.select = p.select;
				if (p.create) obj.create = p.create;
				if (p.update) obj.update = p.update;
				if (p.delete) obj.delete = p.delete;
				if (Object.keys(obj).length) permissions = obj as any;
			}
		}

		return {
			fields: nested,
			indexes: indexes && indexes.length ? indexes : undefined,
			permissions,
		};
	}

	/** Инспекция всей БД → DatabaseSchema */
	async introspectDatabase(): Promise<DatabaseSchema> {
		const db = await this.infoDB();
		const tables: string[] = Array.isArray(db?.tables) ? db.tables : typeof db?.tables === "object" ? Object.keys(db.tables) : [];
		const result: DatabaseSchema = {};
		for (const t of tables) {
			result[t] = await this.introspectTable(t);
		}
		return result;
	}

	/**
	 * Получить таблицу по имени
	 */
	table<K extends keyof Schema>(name: K): Table<Schema[K]> {
		const table = this.tables.get(name);
		if (!table) {
			throw new Error(`Table ${String(name)} not found in schema`);
		}
		return table as Table<Schema[K]>;
	}

	/**
	 * Создать все таблицы из схемы
	 */
	async createTables(): Promise<void> {
		for (const [tableName, table] of this.tables) {
			await table.create();
		}
	}

	/**
	 * Удалить все таблицы из схемы
	 */
	async dropTables(): Promise<void> {
		for (const [tableName, table] of this.tables) {
			await table.drop();
		}
	}

	/**
	 * Синхронизировать схему (создать недостающие таблицы)
	 */
	async sync(): Promise<void> {
		// Получаем список существующих таблиц
		const existingTables = await this.rpc.query("INFO FOR DB");
		const result = existingTables[0]?.result as any;
		const tables = result?.tables || {};

		// Создаем только те таблицы, которых нет
		for (const [tableName, table] of this.tables) {
			if (!tables[tableName]) {
				await table.create();
			}
		}
	}

	/** Создать ребро между записями */
	async relate(edgeTable: string, fromId: string, toId: string, data?: Record<string, unknown>) {
		const sql = `RELATE type::thing($from_tb, $from_id) -> $edge -> type::thing($to_tb, $to_id) ${data ? "CONTENT $data" : ""} RETURN AFTER`;
		const [from_tb, from_id] = fromId.split(":");
		const [to_tb, to_id] = toId.split(":");
		const result = await this.rpc.query(sql, { from_tb, from_id, to_tb, to_id, edge: edgeTable, data });
		return (result[0]?.result as any[])?.[0] ?? null;
	}

	/** Удалить ребро между записями */
	async unrelate(edgeTable: string, fromId: string, toId: string) {
		const sql = `DELETE FROM (SELECT id FROM type::table($edge) WHERE in = type::thing($from_tb,$from_id) AND out = type::thing($to_tb,$to_id)) RETURN NONE`;
		const [from_tb, from_id] = fromId.split(":");
		const [to_tb, to_id] = toId.split(":");
		await this.rpc.query(sql, { from_tb, from_id, to_tb, to_id, edge: edgeTable });
	}

	/**
	 * Выполнить миграцию/синхронизацию: DEFINE TABLE/FIELD/INDEX/EVENT для всех таблиц
	 */
	async migrate(): Promise<void> {
		for (const [, table] of this.tables) {
			await table.create();
		}
	}

	/** Миграции v2: пройтись по всем таблицам и гарантировать схему (fields/indexes/events) */
	async migrateV2(): Promise<void> {
		for (const [, table] of this.tables) {
			await (table as any).ensureSchema();
		}
	}

	/** Облегченная миграция: только недостающие сущности (за счет IF NOT EXISTS эквивалентна ensure) */
	async migrateMissing(): Promise<void> {
		return this.migrateV2();
	}

	/** План дифф-миграций по всем таблицам */
	async planDiff(): Promise<string> {
		const chunks: string[] = [];
		for (const [, table] of this.tables) {
			const sql = await (table as any).planDiff();
			if (sql.trim()) chunks.push(sql);
		}
		return chunks.join("\n\n");
	}

	/** Применить дифф по всем таблицам */
	async applyDiff(): Promise<void> {
		const sql = await this.planDiff();
		if (sql.trim()) await this.rpc.query(sql);
	}

	/** Live builder: LIVE SELECT с where/fetch, subscribe/kill */
	async live(
		table: keyof Schema & string,
		options?: {
			where?: string;
			fetch?: string[];
			diff?: boolean;
			onEvent?: (evt: { action: "CLOSE" | "CREATE" | "UPDATE" | "DELETE"; id: string; result: unknown }) => void;
		}
	) {
		const where = options?.where ? ` WHERE ${options.where}` : "";
		const fetch = options?.fetch?.length ? ` FETCH ${options.fetch.join(", ")}` : "";
		const mode = options?.diff ? ` DIFF` : "";
		const sql = `LIVE SELECT${mode} * FROM ${table}${where}${fetch};`;
		const queryId = await (this.rpc as any).liveSelect(sql);
		let unsubscribe = () => {};
		if (options?.onEvent) unsubscribe = (this.rpc as any).subscribeLive(queryId, options.onEvent);
		return { id: queryId, unsubscribe, kill: () => (this.rpc as any).kill(queryId) };
	}
}

/**
 * Фабрика для создания ORM
 */
export function createORM<Schema extends DatabaseSchema>(rpc: SurrealRPC<any>, schema: Schema): SurrealORM<Schema> {
	return new SurrealORM(rpc, schema);
}
