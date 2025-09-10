/**
 * Типизированная обработка ошибок для SurrealDB ORM
 */

/**
 * Базовый класс для всех ошибок ORM
 */
export abstract class ORMError extends Error {
	abstract readonly code: string;
	abstract readonly statusCode: number;

	constructor(
		message: string,
		public readonly context?: Record<string, unknown>
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

/**
 * Ошибка валидации данных
 */
export class ValidationError extends ORMError {
	readonly code = 'VALIDATION_ERROR';
	readonly statusCode = 400;

	constructor(
		message: string,
		public readonly field?: string,
		public readonly value?: unknown,
		context?: Record<string, unknown>
	) {
		super(message, { field, value, ...context });
	}
}

/**
 * Ошибка схемы базы данных
 */
export class SchemaError extends ORMError {
	readonly code = 'SCHEMA_ERROR';
	readonly statusCode = 422;

	constructor(
		message: string,
		public readonly table?: string,
		public readonly field?: string,
		context?: Record<string, unknown>
	) {
		super(message, { table, field, ...context });
	}
}

/**
 * Ошибка выполнения запроса
 */
export class QueryError extends ORMError {
	readonly code = 'QUERY_ERROR';
	readonly statusCode = 500;

	constructor(
		message: string,
		public readonly sql?: string,
		public readonly vars?: Record<string, unknown>,
		context?: Record<string, unknown>
	) {
		super(message, { sql, vars, ...context });
	}
}

/**
 * Ошибка подключения к базе данных
 */
export class ConnectionError extends ORMError {
	readonly code = 'CONNECTION_ERROR';
	readonly statusCode = 503;

	constructor(
		message: string,
		public readonly endpoint?: string,
		context?: Record<string, unknown>
	) {
		super(message, { endpoint, ...context });
	}
}

/**
 * Ошибка таймаута
 */
export class TimeoutError extends ORMError {
	readonly code = 'TIMEOUT_ERROR';
	readonly statusCode = 408;

	constructor(
		message: string,
		public readonly timeout?: number,
		context?: Record<string, unknown>
	) {
		super(message, { timeout, ...context });
	}
}

/**
 * Ошибка ограничения скорости
 */
export class RateLimitError extends ORMError {
	readonly code = 'RATE_LIMIT_ERROR';
	readonly statusCode = 429;

	constructor(
		message: string,
		public readonly limit?: number,
		public readonly window?: number,
		context?: Record<string, unknown>
	) {
		super(message, { limit, window, ...context });
	}
}

/**
 * Ошибка кэширования
 */
export class CacheError extends ORMError {
	readonly code = 'CACHE_ERROR';
	readonly statusCode = 500;

	constructor(
		message: string,
		public readonly key?: string,
		context?: Record<string, unknown>
	) {
		super(message, { key, ...context });
	}
}

/**
 * Ошибка безопасности
 */
export class SecurityError extends ORMError {
	readonly code = 'SECURITY_ERROR';
	readonly statusCode = 403;

	constructor(
		message: string,
		public readonly operation?: string,
		context?: Record<string, unknown>
	) {
		super(message, { operation, ...context });
	}
}

/**
 * Типизированный результат операции
 */
export type Result<T, E extends ORMError = ORMError> =
	| { success: true; data: T }
	| { success: false; error: E };

/**
 * Безопасное выполнение операции с типизированным результатом
 */
export async function safeExecute<T>(
	operation: () => Promise<T>
): Promise<Result<T>> {
	try {
		const data = await operation();
		return { success: true, data };
	} catch (error) {
		if (error instanceof ORMError) {
			return { success: false, error };
		}

		// Преобразуем неизвестные ошибки в QueryError
		const queryError = new QueryError(
			error instanceof Error ? error.message : String(error)
		);
		return { success: false, error: queryError };
	}
}

/**
 * Безопасное выполнение операции с кастомной обработкой ошибок
 */
export async function safeExecuteWith<T, E extends ORMError>(
	operation: () => Promise<T>,
	errorHandler: (error: unknown) => E
): Promise<Result<T, E>> {
	try {
		const data = await operation();
		return { success: true, data };
	} catch (error) {
		const ormError = errorHandler(error);
		return { success: false, error: ormError };
	}
}

/**
 * Проверка, является ли ошибка определенного типа
 */
export function isErrorType<T extends ORMError>(
	error: unknown,
	errorClass: new (...args: any[]) => T
): error is T {
	return error instanceof errorClass;
}

/**
 * Извлечение данных из результата с обработкой ошибок
 */
export function extractResult<T>(result: Result<T>): T {
	if (result.success) {
		return result.data;
	}
	throw result.error;
}

/**
 * Извлечение данных из результата с fallback значением
 */
export function extractResultWithFallback<T>(
	result: Result<T>,
	fallback: T
): T {
	return result.success ? result.data : fallback;
}

/**
 * Цепочка операций с обработкой ошибок
 */
export async function chainOperations<T>(
	operations: Array<() => Promise<T>>
): Promise<Result<T[]>> {
	const results: T[] = [];

	for (const operation of operations) {
		const result = await safeExecute(operation);
		if (!result.success) {
			return result;
		}
		results.push(result.data);
	}

	return { success: true, data: results };
}

/**
 * Параллельное выполнение операций с обработкой ошибок
 */
export async function parallelOperations<T>(
	operations: Array<() => Promise<T>>
): Promise<Result<T[]>> {
	try {
		const results = await Promise.all(operations.map((op) => op()));
		return { success: true, data: results };
	} catch (error) {
		if (error instanceof ORMError) {
			return { success: false, error };
		}

		const queryError = new QueryError(
			error instanceof Error ? error.message : String(error)
		);
		return { success: false, error: queryError };
	}
}

/**
 * Retry механизм с экспоненциальной задержкой
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	maxRetries: number = 3,
	baseDelay: number = 1000
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;

			if (attempt === maxRetries) {
				break;
			}

			// Экспоненциальная задержка
			const delay = baseDelay * Math.pow(2, attempt);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

/**
 * Типизированный retry с обработкой ошибок
 */
export async function withTypedRetry<T>(
	operation: () => Promise<T>,
	maxRetries: number = 3,
	baseDelay: number = 1000
): Promise<Result<T>> {
	return safeExecute(() => withRetry(operation, maxRetries, baseDelay));
}
