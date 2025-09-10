/**
 * Type guards для безопасной работы с типами SurrealDB ORM
 */

import type {
	TableRecord,
	FieldConfig,
	TableConfig,
	DatabaseSchema,
} from '../../orm';

/**
 * Проверяет, является ли значение массивом записей таблицы
 */
export function isTableRecordArray<T extends TableConfig>(
	value: unknown,
	tableName: string
): value is TableRecord<T>[] {
	if (!Array.isArray(value)) return false;
	if (value.length === 0) return true; // Пустой массив валиден

	// Проверяем первую запись на наличие обязательных полей
	const firstRecord = value[0];
	return (
		typeof firstRecord === 'object' &&
		firstRecord !== null &&
		'id' in firstRecord &&
		typeof (firstRecord as any).id === 'string' &&
		(firstRecord as any).id.startsWith(`${tableName}:`)
	);
}

/**
 * Проверяет, является ли значение одной записью таблицы
 */
export function isTableRecord<T extends TableConfig>(
	value: unknown,
	tableName: string
): value is TableRecord<T> {
	if (typeof value !== 'object' || value === null) return false;

	const record = value as Record<string, unknown>;
	return (
		'id' in record &&
		typeof record.id === 'string' &&
		record.id.startsWith(`${tableName}:`)
	);
}

/**
 * Проверяет, является ли значение результатом RPC запроса
 */
export function isRPCResult(value: unknown): value is { result: unknown }[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		typeof value[0] === 'object' &&
		value[0] !== null &&
		'result' in value[0]
	);
}

/**
 * Проверяет, является ли значение объектом с полями таблицы
 */
export function isTableInfo(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Проверяет, является ли значение конфигурацией поля
 */
export function isFieldConfig(value: unknown): value is FieldConfig {
	if (typeof value !== 'object' || value === null) return false;

	const config = value as Record<string, unknown>;
	return (
		'type' in config &&
		typeof config.type === 'string' &&
		[
			'string',
			'number',
			'bool',
			'datetime',
			'object',
			'array',
			'record',
		].includes(config.type)
	);
}

/**
 * Проверяет, является ли значение схемой базы данных
 */
export function isDatabaseSchema(value: unknown): value is DatabaseSchema {
	if (typeof value !== 'object' || value === null) return false;

	const schema = value as Record<string, unknown>;
	return Object.values(schema).every((table) => isTableConfig(table));
}

/**
 * Проверяет, является ли значение конфигурацией таблицы
 */
export function isTableConfig(value: unknown): value is TableConfig {
	if (typeof value !== 'object' || value === null) return false;

	const config = value as Record<string, unknown>;
	return (
		'fields' in config &&
		typeof config.fields === 'object' &&
		config.fields !== null
	);
}

/**
 * Безопасное извлечение результата из RPC ответа
 */
export function extractRPCResult<T>(response: unknown): T {
	if (!isRPCResult(response)) {
		throw new Error('Invalid RPC response format');
	}

	return response[0].result as T;
}

/**
 * Безопасное извлечение массива записей из RPC ответа
 */
export function extractTableRecords<T extends TableConfig>(
	response: unknown,
	tableName: string
): TableRecord<T>[] {
	const result = extractRPCResult<unknown>(response);

	if (!isTableRecordArray<T>(result, tableName)) {
		throw new Error(`Invalid table records format for table: ${tableName}`);
	}

	return result;
}

/**
 * Безопасное извлечение одной записи из RPC ответа
 */
export function extractTableRecord<T extends TableConfig>(
	response: unknown,
	tableName: string
): TableRecord<T> | null {
	const result = extractRPCResult<unknown>(response);

	if (result === null || result === undefined) {
		return null;
	}

	if (!isTableRecord<T>(result, tableName)) {
		throw new Error(`Invalid table record format for table: ${tableName}`);
	}

	return result;
}

/**
 * Безопасное извлечение информации о таблице
 */
export function extractTableInfo(response: unknown): Record<string, unknown> {
	const result = extractRPCResult<unknown>(response);

	if (!isTableInfo(result)) {
		throw new Error('Invalid table info format');
	}

	return result;
}

/**
 * Безопасное извлечение схемы базы данных
 */
export function extractDatabaseSchema(response: unknown): DatabaseSchema {
	const result = extractRPCResult<unknown>(response);

	if (!isDatabaseSchema(result)) {
		throw new Error('Invalid database schema format');
	}

	return result;
}
