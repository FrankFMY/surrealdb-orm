/**
 * Система ошибок для SurrealDB ORM
 */

import type { ValidationError as ValidationErrorType } from '../types/validation.js';

// Базовый класс ошибки ORM
export abstract class SurrealORMError extends Error {
	abstract readonly code: string;
	abstract readonly statusCode: number;
	readonly timestamp: string;
	readonly context?: Record<string, unknown>;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message);
		this.name = this.constructor.name;
		this.timestamp = new Date().toISOString();
		this.context = context;

		// Сохраняем стек вызовов
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}

	toJSON() {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			statusCode: this.statusCode,
			timestamp: this.timestamp,
			context: this.context,
			stack: this.stack,
		};
	}
}

// Ошибки валидации
export class ValidationError extends SurrealORMError {
	readonly code = 'VALIDATION_ERROR';
	readonly statusCode = 400;
	readonly validationErrors: ValidationErrorType[];

	constructor(
		message: string,
		validationErrors: ValidationErrorType[],
		context?: Record<string, unknown>
	) {
		super(message, context);
		this.validationErrors = validationErrors;
	}

	toJSON() {
		return {
			...super.toJSON(),
			validationErrors: this.validationErrors,
		};
	}
}

// Ошибки подключения
export class ConnectionError extends SurrealORMError {
	readonly code = 'CONNECTION_ERROR';
	readonly statusCode = 503;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message, context);
	}
}

// Ошибки аутентификации
export class AuthenticationError extends SurrealORMError {
	readonly code = 'AUTHENTICATION_ERROR';
	readonly statusCode = 401;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message, context);
	}
}

// Ошибки авторизации
export class AuthorizationError extends SurrealORMError {
	readonly code = 'AUTHORIZATION_ERROR';
	readonly statusCode = 403;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message, context);
	}
}

// Ошибки схемы
export class SchemaError extends SurrealORMError {
	readonly code = 'SCHEMA_ERROR';
	readonly statusCode = 400;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message, context);
	}
}

// Ошибки запросов
export class QueryError extends SurrealORMError {
	readonly code = 'QUERY_ERROR';
	readonly statusCode = 400;
	readonly sql?: string;

	constructor(
		message: string,
		sql?: string,
		context?: Record<string, unknown>
	) {
		super(message, context);
		this.sql = sql;
	}

	toJSON() {
		return {
			...super.toJSON(),
			sql: this.sql,
		};
	}
}

// Ошибки транзакций
export class TransactionError extends SurrealORMError {
	readonly code = 'TRANSACTION_ERROR';
	readonly statusCode = 500;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message, context);
	}
}

// Ошибки миграций
export class MigrationError extends SurrealORMError {
	readonly code = 'MIGRATION_ERROR';
	readonly statusCode = 500;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message, context);
	}
}

// Ошибки live queries
export class LiveQueryError extends SurrealORMError {
	readonly code = 'LIVE_QUERY_ERROR';
	readonly statusCode = 400;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message, context);
	}
}

// Ошибки rate limiting
export class RateLimitError extends SurrealORMError {
	readonly code = 'RATE_LIMIT_ERROR';
	readonly statusCode = 429;
	readonly retryAfter?: number;

	constructor(
		message: string,
		retryAfter?: number,
		context?: Record<string, unknown>
	) {
		super(message, context);
		this.retryAfter = retryAfter;
	}

	toJSON() {
		return {
			...super.toJSON(),
			retryAfter: this.retryAfter,
		};
	}
}

// Ошибки таймаута
export class TimeoutError extends SurrealORMError {
	readonly code = 'TIMEOUT_ERROR';
	readonly statusCode = 408;
	readonly timeout: number;

	constructor(
		message: string,
		timeout: number,
		context?: Record<string, unknown>
	) {
		super(message, context);
		this.timeout = timeout;
	}

	toJSON() {
		return {
			...super.toJSON(),
			timeout: this.timeout,
		};
	}
}

// Ошибки конфигурации
export class ConfigurationError extends SurrealORMError {
	readonly code = 'CONFIGURATION_ERROR';
	readonly statusCode = 500;

	constructor(message: string, context?: Record<string, unknown>) {
		super(message, context);
	}
}

// Ошибки несовместимости версий
export class VersionError extends SurrealORMError {
	readonly code = 'VERSION_ERROR';
	readonly statusCode = 400;
	readonly expectedVersion?: string;
	readonly actualVersion?: string;

	constructor(
		message: string,
		expectedVersion?: string,
		actualVersion?: string,
		context?: Record<string, unknown>
	) {
		super(message, context);
		this.expectedVersion = expectedVersion;
		this.actualVersion = actualVersion;
	}

	toJSON() {
		return {
			...super.toJSON(),
			expectedVersion: this.expectedVersion,
			actualVersion: this.actualVersion,
		};
	}
}

// Неизвестная ошибка
class UnknownError extends SurrealORMError {
	readonly code = 'UNKNOWN_ERROR';
	readonly statusCode = 500;
}

// Утилиты для работы с ошибками
export class ErrorHandler {
	/**
	 * Проверяет, является ли ошибка ошибкой ORM
	 */
	static isORMError(error: unknown): error is SurrealORMError {
		return error instanceof SurrealORMError;
	}

	/**
	 * Преобразует любую ошибку в ошибку ORM
	 */
	static normalizeError(
		error: unknown,
		context?: Record<string, unknown>
	): SurrealORMError {
		if (this.isORMError(error)) {
			return error;
		}

		if (error instanceof Error) {
			// Попытка определить тип ошибки по сообщению
			const message = error.message.toLowerCase();

			if (message.includes('connection') || message.includes('network')) {
				return new ConnectionError(error.message, context);
			}

			if (
				message.includes('authentication') ||
				message.includes('auth')
			) {
				return new AuthenticationError(error.message, context);
			}

			if (
				message.includes('authorization') ||
				message.includes('permission')
			) {
				return new AuthorizationError(error.message, context);
			}

			if (message.includes('schema') || message.includes('table')) {
				return new SchemaError(error.message, context);
			}

			if (message.includes('query') || message.includes('sql')) {
				return new QueryError(error.message, undefined, context);
			}

			if (message.includes('transaction')) {
				return new TransactionError(error.message, context);
			}

			if (message.includes('timeout')) {
				return new TimeoutError(error.message, 0, context);
			}

			// По умолчанию - общая ошибка
			return new UnknownError(error.message, context);
		}

		// Неизвестная ошибка
		return new UnknownError(
			typeof error === 'string' ? error : 'Unknown error occurred',
			context
		);
	}

	/**
	 * Логирует ошибку
	 */
	static logError(
		error: SurrealORMError,
		logger?: {
			error: (message: string, context?: Record<string, unknown>) => void;
		}
	): void {
		if (logger) {
			logger.error(`[${error.code}] ${error.message}`, {
				...error.context,
				timestamp: error.timestamp,
				stack: error.stack,
			});
		} else {
			console.error(`[${error.code}] ${error.message}`, error.toJSON());
		}
	}

	/**
	 * Создает пользовательское сообщение об ошибке
	 */
	static createUserMessage(error: SurrealORMError): string {
		switch (error.code) {
			case 'VALIDATION_ERROR':
				return 'Данные не прошли валидацию. Проверьте введенные значения.';

			case 'CONNECTION_ERROR':
				return 'Ошибка подключения к базе данных. Попробуйте позже.';

			case 'AUTHENTICATION_ERROR':
				return 'Ошибка аутентификации. Проверьте учетные данные.';

			case 'AUTHORIZATION_ERROR':
				return 'Недостаточно прав для выполнения операции.';

			case 'SCHEMA_ERROR':
				return 'Ошибка схемы базы данных.';

			case 'QUERY_ERROR':
				return 'Ошибка выполнения запроса.';

			case 'TRANSACTION_ERROR':
				return 'Ошибка транзакции.';

			case 'MIGRATION_ERROR':
				return 'Ошибка миграции базы данных.';

			case 'LIVE_QUERY_ERROR':
				return 'Ошибка live query.';

			case 'RATE_LIMIT_ERROR':
				return 'Превышен лимит запросов. Попробуйте позже.';

			case 'TIMEOUT_ERROR':
				return 'Превышено время ожидания операции.';

			case 'CONFIGURATION_ERROR':
				return 'Ошибка конфигурации.';

			case 'VERSION_ERROR':
				return 'Несовместимость версий.';

			default:
				return 'Произошла неизвестная ошибка.';
		}
	}
}
