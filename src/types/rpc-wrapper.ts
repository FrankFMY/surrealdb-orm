/**
 * Типизированные обертки для RPC запросов SurrealDB
 */

import type { SurrealRPC } from '../../rpc';
import type { TableRecord, TableConfig, DatabaseSchema } from '../../orm';
import {
	extractRPCResult,
	extractTableRecords,
	extractTableRecord,
	extractTableInfo,
	extractDatabaseSchema,
	isRPCResult,
} from './type-guards';
import { QueryError, safeExecute } from './error-handling';

/**
 * Типизированный результат RPC запроса
 */
export interface TypedRPCResult<T> {
	result: T;
	error?: string;
}

/**
 * Типизированная обертка для RPC запросов
 */
export class TypedRPCWrapper {
	constructor(private rpc: SurrealRPC<any>) {}

	/**
	 * Выполняет типизированный запрос
	 */
	async query<T>(sql: string, vars?: Record<string, unknown>): Promise<T> {
		const result = await safeExecute(async () => {
			const response = await this.rpc.query(sql, vars);
			return extractRPCResult<T>(response);
		});

		if (!result.success) {
			throw new QueryError(
				`RPC query failed: ${result.error.message}`,
				sql,
				vars,
				{ originalError: result.error }
			);
		}

		return result.data;
	}

	/**
	 * Выполняет запрос и возвращает массив записей таблицы
	 */
	async queryTableRecords<T extends TableConfig>(
		sql: string,
		tableName: string,
		vars?: Record<string, unknown>
	): Promise<TableRecord<T>[]> {
		try {
			const response = await this.rpc.query(sql, vars);
			return extractTableRecords<T>(response, tableName);
		} catch (error) {
			throw new Error(
				`Table records query failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Выполняет запрос и возвращает одну запись таблицы
	 */
	async queryTableRecord<T extends TableConfig>(
		sql: string,
		tableName: string,
		vars?: Record<string, unknown>
	): Promise<TableRecord<T> | null> {
		try {
			const response = await this.rpc.query(sql, vars);
			return extractTableRecord<T>(response, tableName);
		} catch (error) {
			throw new Error(
				`Table record query failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Выполняет запрос и возвращает информацию о таблице
	 */
	async queryTableInfo(
		sql: string,
		vars?: Record<string, unknown>
	): Promise<Record<string, unknown>> {
		try {
			const response = await this.rpc.query(sql, vars);
			return extractTableInfo(response);
		} catch (error) {
			throw new Error(
				`Table info query failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Выполняет запрос и возвращает схему базы данных
	 */
	async queryDatabaseSchema(
		sql: string,
		vars?: Record<string, unknown>
	): Promise<DatabaseSchema> {
		try {
			const response = await this.rpc.query(sql, vars);
			return extractDatabaseSchema(response);
		} catch (error) {
			throw new Error(
				`Database schema query failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Выполняет запрос без возврата результата
	 */
	async execute(sql: string, vars?: Record<string, unknown>): Promise<void> {
		try {
			await this.rpc.query(sql, vars);
		} catch (error) {
			throw new Error(
				`RPC execute failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Выполняет запрос и возвращает количество записей
	 */
	async queryCount(
		sql: string,
		vars?: Record<string, unknown>
	): Promise<number> {
		try {
			const response = await this.rpc.query(sql, vars);
			const result = extractRPCResult<Array<{ count: number }>>(response);

			if (!Array.isArray(result) || result.length === 0) {
				return 0;
			}

			const countResult = result[0];
			if (
				typeof countResult !== 'object' ||
				countResult === null ||
				!('count' in countResult)
			) {
				return 0;
			}

			return typeof countResult.count === 'number' ?
					countResult.count
				:	0;
		} catch (error) {
			throw new Error(
				`Count query failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Выполняет запрос и возвращает результат как есть (для специальных случаев)
	 */
	async queryRaw(
		sql: string,
		vars?: Record<string, unknown>
	): Promise<unknown> {
		try {
			const response = await this.rpc.query(sql, vars);
			return extractRPCResult<unknown>(response);
		} catch (error) {
			throw new Error(
				`Raw query failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
}

/**
 * Создает типизированную обертку для RPC
 */
export function createTypedRPC(rpc: SurrealRPC<any>): TypedRPCWrapper {
	return new TypedRPCWrapper(rpc);
}
