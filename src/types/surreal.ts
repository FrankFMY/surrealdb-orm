/**
 * Строгие типы для SurrealDB специфичных структур
 */

// Базовые типы SurrealDB
export type SurrealId = string;
export type SurrealRecord<T = Record<string, unknown>> = {
	id: SurrealId;
} & T;

// Типы для SurrealDB полей
export type SurrealFieldType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'bool' // alias for boolean
	| 'datetime'
	| 'duration'
	| 'decimal'
	| 'float'
	| 'int'
	| 'object'
	| 'array'
	| 'record'
	| 'geometry'
	| 'option'
	| 'future'
	| 'uuid';

// Строгая типизация для record типов
export type SurrealRecordTypeString<T extends string = string> = `record<${T}>`;
export type SurrealArrayType<
	T extends SurrealFieldType | SurrealRecordTypeString = SurrealFieldType,
> = `array<${T}>`;

// Типы для объектов SurrealDB
export type SurrealObject<
	T extends Record<string, unknown> = Record<string, unknown>,
> = T;

// Типы для массивов SurrealDB
export type SurrealArray<T = unknown> = T[];

// Строгая типизация для ID полей
export type SurrealIdField = SurrealId;
export type SurrealRecordId<T extends string = string> = `${T}:${string}`;

// Типы для геометрии
export type SurrealGeometry = {
	type:
		| 'Point'
		| 'LineString'
		| 'Polygon'
		| 'MultiPoint'
		| 'MultiLineString'
		| 'MultiPolygon';
	coordinates: number[] | number[][] | number[][][];
};

// Типы для duration
export type SurrealDuration = string; // ISO 8601 duration format

// Типы для decimal
export type SurrealDecimal = string; // Decimal as string to preserve precision

// Типы для option
export type SurrealOption<T> = T | null;

// Типы для future
export type SurrealFuture<T> = Promise<T>;

// Строгая типизация для полей таблицы
export interface SurrealFieldConfig<
	T extends SurrealFieldType = SurrealFieldType,
> {
	type: T;
	required?: boolean;
	default?: T extends 'string' ? string
	: T extends 'number' | 'int' | 'float' | 'decimal' ? number
	: T extends 'boolean' ? boolean
	: T extends 'datetime' ? Date | string
	: T extends 'duration' ? SurrealDuration
	: T extends 'uuid' ? string
	: T extends 'geometry' ? SurrealGeometry
	: T extends 'object' ? Record<string, unknown>
	: T extends 'array' ? unknown[]
	: T extends 'record' ? SurrealRecordId
	: T extends 'option' ? unknown | null
	: T extends 'future' ? Promise<unknown>
	: unknown;
	defaultAlways?: boolean;
	readonly?: boolean;
	value?: T extends 'string' ? string
	: T extends 'number' | 'int' | 'float' | 'decimal' ? number
	: T extends 'boolean' ? boolean
	: T extends 'datetime' ? Date | string
	: T extends 'duration' ? SurrealDuration
	: T extends 'uuid' ? string
	: T extends 'geometry' ? SurrealGeometry
	: T extends 'object' ? Record<string, unknown>
	: T extends 'array' ? unknown[]
	: T extends 'record' ? SurrealRecordId
	: T extends 'option' ? unknown | null
	: T extends 'future' ? Promise<unknown>
	: unknown;
	valueExpr?: string;
	assert?: string;
	permissions?: SurrealPermissions;
	constraints?: SurrealConstraints;
}

// Типы для ограничений
export interface SurrealConstraints {
	// String constraints
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	email?: boolean;
	url?: boolean;
	uuid?: boolean;

	// Number constraints
	min?: number;
	max?: number;
	integer?: boolean;
	positive?: boolean;
	negative?: boolean;

	// Array constraints
	minItems?: number;
	maxItems?: number;
	uniqueItems?: boolean;

	// Object constraints
	requiredProperties?: string[];
	additionalProperties?: boolean;

	// Custom constraints
	custom?: (value: unknown) => boolean;

	// Legacy constraints
	unique?: boolean;
	index?: boolean;
	fulltext?: boolean;
	spatial?: boolean;
	foreign?: {
		table: string;
		field?: string;
		onDelete?:
			| 'CASCADE'
			| 'SET NULL'
			| 'SET DEFAULT'
			| 'RESTRICT'
			| 'NO ACTION';
		onUpdate?:
			| 'CASCADE'
			| 'SET NULL'
			| 'SET DEFAULT'
			| 'RESTRICT'
			| 'NO ACTION';
	};
}

// Типы для разрешений
export type SurrealPermissions =
	| 'FULL'
	| 'NONE'
	| {
			select?: string;
			create?: string;
			update?: string;
			delete?: string;
	  };

// Строгая типизация для индексов
export interface SurrealIndexConfig {
	name: string;
	fields: string[];
	unique?: boolean;
	type?: 'BTREE' | 'HASH' | 'MTREE' | 'SEARCH';
	analyzer?: string;
	highlights?: boolean;
	bm25?: {
		k1?: number;
		b?: number;
	};
}

// Строгая типизация для событий
export interface SurrealEventConfig {
	name: string;
	when: string;
	then: string;
	comment?: string;
}

// Строгая типизация для триггеров
export interface SurrealTriggerConfig {
	name: string;
	when: 'CREATE' | 'UPDATE' | 'DELETE';
	then: string;
	comment?: string;
}

// Строгая типизация для таблицы
export interface SurrealTableConfig<
	T extends Record<string, unknown> = Record<string, unknown>,
> {
	comment?: string;
	fields: Record<keyof T, SurrealFieldConfig>;
	indexes?: SurrealIndexConfig[];
	events?: SurrealEventConfig[];
	triggers?: SurrealTriggerConfig[];
	permissions?: SurrealPermissions;
	changefeed?: boolean;
	changetime?: string;
}

// Строгая типизация для схемы базы данных
export type SurrealDatabaseSchema<
	T extends Record<string, Record<string, unknown>> = Record<
		string,
		Record<string, unknown>
	>,
> = {
	[K in keyof T]: SurrealTableConfig<T[K]>;
};

// Типы для запросов
export interface SurrealQueryParams {
	[key: string]: string | number | boolean | Date | null | undefined;
}

export interface SurrealQueryResult<T = unknown> {
	time: string;
	status: 'OK' | 'ERR';
	result: T;
	detail?: string;
}

// Типы для RPC методов
export interface SurrealRPCMethods {
	query: {
		params: [string, SurrealQueryParams?];
		return: SurrealQueryResult<unknown>[];
	};
	live: {
		params: [string];
		return: string;
	};
	kill: {
		params: [string];
		return: void;
	};
	ping: {
		params: [];
		return: void;
	};
	info: {
		params: ['DB' | `TABLE ${string}` | `NS` | `USER ${string}`];
		return: unknown;
	};
	use: {
		params: [string, string];
		return: void;
	};
	signup: {
		params: [string, string];
		return: string;
	};
	signin: {
		params: [string, string];
		return: string;
	};
	authenticate: {
		params: [string];
		return: string;
	};
	invalidate: {
		params: [];
		return: void;
	};
}

// Строгая типизация для RPC интерфейса
export interface SurrealRPCInterface {
	query<T = unknown>(
		sql: string,
		params?: SurrealQueryParams
	): Promise<SurrealQueryResult<T>[]>;
	live(sql: string): Promise<string>;
	kill(queryId: string): Promise<void>;
	ping(): Promise<void>;
	info(
		scope: 'DB' | `TABLE ${string}` | `NS` | `USER ${string}`
	): Promise<unknown>;
	use(namespace: string, database: string): Promise<void>;
	signup(user: string, pass: string): Promise<string>;
	signin(user: string, pass: string): Promise<string>;
	authenticate(token: string): Promise<string>;
	invalidate(): Promise<void>;
}

// Типы для подключения
export interface SurrealConnectionConfig {
	url: string;
	namespace: string;
	database: string;
	user?: string;
	pass?: string;
	token?: string;
	timeout?: number;
	heartbeatInterval?: number;
	reconnectOnClose?: boolean;
	maxReconnectAttempts?: number;
	reconnectDelay?: number;
}

// Типы для состояния подключения
export enum SurrealConnectionState {
	DISCONNECTED = 'disconnected',
	CONNECTING = 'connecting',
	CONNECTED = 'connected',
	RECONNECTING = 'reconnecting',
	ERROR = 'error',
}

// Типы для ошибок
export class SurrealError extends Error {
	constructor(
		message: string,
		public readonly code?: string,
		public readonly details?: Record<string, unknown>
	) {
		super(message);
		this.name = 'SurrealError';
	}
}

// Интерфейс для ошибок валидации
export interface SurrealValidationError {
	field: string;
	message: string;
	code: string;
	value?: unknown;
}

export class SurrealConnectionError extends SurrealError {
	constructor(message: string, details?: Record<string, unknown>) {
		super(message, 'CONNECTION_ERROR', details);
		this.name = 'SurrealConnectionError';
	}
}

export class SurrealQueryError extends SurrealError {
	constructor(message: string, details?: Record<string, unknown>) {
		super(message, 'QUERY_ERROR', details);
		this.name = 'SurrealQueryError';
	}
}

export class SurrealValidationErrorClass extends SurrealError {
	constructor(message: string, details?: Record<string, unknown>) {
		super(message, 'VALIDATION_ERROR', details);
		this.name = 'SurrealValidationError';
	}
}

// Утилитарные типы
export type SurrealTableName<T extends SurrealDatabaseSchema> = keyof T;
export type SurrealFieldName<T extends SurrealTableConfig> = keyof T['fields'];
export type SurrealRecordType<T extends SurrealTableConfig> = {
	[K in keyof T['fields']]: T['fields'][K] extends (
		SurrealFieldConfig<infer U>
	) ?
		U extends 'string' ? string
		: U extends 'number' | 'int' | 'float' | 'decimal' ? number
		: U extends 'boolean' ? boolean
		: U extends 'datetime' ? Date
		: U extends 'duration' ? SurrealDuration
		: U extends 'uuid' ? string
		: U extends 'geometry' ? SurrealGeometry
		: U extends 'object' ? Record<string, unknown>
		: U extends 'array' ? unknown[]
		: U extends 'record' ? SurrealRecordId
		: U extends 'option' ? unknown | null
		: U extends 'future' ? Promise<unknown>
		: unknown
	:	never;
};

// Типы для валидации
export interface SurrealValidationResult<T = unknown> {
	isValid: boolean;
	data?: T;
	errors: SurrealValidationError[];
	warnings?: SurrealValidationError[];
}

// Типы для миграций
export interface SurrealMigration {
	version: string;
	name: string;
	up: string;
	down: string;
	description?: string;
}

// Типы для мониторинга
export interface SurrealMetrics {
	connections: {
		active: number;
		idle: number;
		total: number;
	};
	queries: {
		total: number;
		successful: number;
		failed: number;
		avgDuration: number;
	};
	cache: {
		hits: number;
		misses: number;
		hitRate: number;
	};
}
