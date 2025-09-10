/**
 * Вспомогательные типы и утилиты для SurrealDB ORM
 */

// Базовые типы для работы с записями
export interface BaseRecord {
	id: string;
	created?: number;
	updated?: number;
	zip?: string;
}

// Тип для извлечения ключей объекта
export type KEYS<T> = keyof T;

// Тип для записи по схеме
export type RecordBySchema<DB, Table extends KEYS<DB>> =
	DB[Table] extends (
		{
			id: string;
		}
	) ?
		DB[Table]
	:	DB[Table] & { id: string };

// Утилиты для работы с типами
export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type CreateInput<T> = Omit<T, 'id' | 'created' | 'updated' | 'zip'>;
export type UpdateInput<T> = DeepPartial<
	Omit<T, 'id' | 'created' | 'updated' | 'zip'>
>;

// Тип для ID записи
export type RecordId<T> = T extends { id: infer U } ? U : never;

// Интерфейс для Future (упрощенная версия)
export interface Future {
	run: (
		fn: () => void | Promise<void>,
		options: { type: 'interval' | 'timeout'; key: string; delay?: number }
	) => void;
	clear: (type: 'interval' | 'timeout', key: string) => void;
}

// Интерфейс для логгера (упрощенная версия)
export interface ILogger {
	debug: (
		context: { module: string; method: string },
		data?: unknown
	) => void;
	info: (context: { module: string; method: string }, data?: unknown) => void;
	warn: (context: { module: string; method: string }, data?: unknown) => void;
	error: (
		context: { module: string; method: string },
		data?: unknown
	) => void;
	good: (module: string, message: string) => void;
}

// Утилита для генерации случайного ID
export function randID(): string {
	return (
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15)
	);
}

// Простая реализация Future
export class SimpleFuture implements Future {
	private intervals = new Map<string, NodeJS.Timeout>();
	private timeouts = new Map<string, NodeJS.Timeout>();

	run(
		fn: () => void | Promise<void>,
		options: { type: 'interval' | 'timeout'; key: string; delay?: number }
	): void {
		const delay = options.delay || 1000;

		if (options.type === 'interval') {
			const interval = setInterval(fn, delay);
			this.intervals.set(options.key, interval);
		} else {
			const timeout = setTimeout(fn, delay);
			this.timeouts.set(options.key, timeout);
		}
	}

	clear(type: 'interval' | 'timeout', key: string): void {
		if (type === 'interval') {
			const interval = this.intervals.get(key);
			if (interval) {
				clearInterval(interval);
				this.intervals.delete(key);
			}
		} else {
			const timeout = this.timeouts.get(key);
			if (timeout) {
				clearTimeout(timeout);
				this.timeouts.delete(key);
			}
		}
	}
}

// Простая реализация логгера
export class SimpleLogger implements ILogger {
	debug(context: { module: string; method: string }, data?: unknown): void {
		console.debug(`[${context.module}:${context.method}]`, data);
	}

	info(context: { module: string; method: string }, data?: unknown): void {
		console.info(`[${context.module}:${context.method}]`, data);
	}

	warn(context: { module: string; method: string }, data?: unknown): void {
		console.warn(`[${context.module}:${context.method}]`, data);
	}

	error(context: { module: string; method: string }, data?: unknown): void {
		console.error(`[${context.module}:${context.method}]`, data);
	}

	good(module: string, message: string): void {
		console.log(`✅ [${module}] ${message}`);
	}
}
