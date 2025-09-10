/**
 * Система безопасности для SurrealDB ORM
 */

import { createHash, createHmac, randomBytes } from 'crypto';

// Валидация SQL инъекций
export class SQLInjectionValidator {
	private static readonly DANGEROUS_PATTERNS = [
		/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/gi,
		/(--|\/\*|\*\/|;|\||&|\$|`|'|"|\\|%00|%0a|%0d)/gi,
		/(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
		/(\b(OR|AND)\s+['"]\s*=\s*['"])/gi,
		/(\bUNION\s+SELECT\b)/gi,
		/(\bDROP\s+TABLE\b)/gi,
		/(\bDELETE\s+FROM\b)/gi,
		/(\bINSERT\s+INTO\b)/gi,
		/(\bUPDATE\s+SET\b)/gi,
	];

	static validate(input: string): boolean {
		if (!input || typeof input !== 'string') return true;

		return !this.DANGEROUS_PATTERNS.some((pattern) => pattern.test(input));
	}

	static sanitize(input: string): string {
		if (!input || typeof input !== 'string') return '';

		return input
			.replace(/[<>]/g, '') // Удаление HTML тегов
			.replace(/['"]/g, '') // Удаление кавычек
			.replace(/[;\\]/g, '') // Удаление опасных символов
			.trim();
	}
}

// Rate limiting
export class RateLimiter {
	private requests = new Map<string, number[]>();

	constructor(
		private maxRequests: number,
		private windowMs: number
	) {}

	isAllowed(identifier: string): boolean {
		const now = Date.now();
		const userRequests = this.requests.get(identifier) || [];

		// Очистка старых запросов
		const validRequests = userRequests.filter(
			(time) => now - time < this.windowMs
		);

		if (validRequests.length >= this.maxRequests) {
			return false;
		}

		validRequests.push(now);
		this.requests.set(identifier, validRequests);
		return true;
	}

	getRemainingRequests(identifier: string): number {
		const now = Date.now();
		const userRequests = this.requests.get(identifier) || [];
		const validRequests = userRequests.filter(
			(time) => now - time < this.windowMs
		);

		return Math.max(0, this.maxRequests - validRequests.length);
	}
}

// Аудит операций
export class AuditLogger {
	private logs: AuditLog[] = [];

	log(operation: AuditOperation): void {
		const log: AuditLog = {
			...operation,
			timestamp: new Date().toISOString(),
			id: this.generateId(),
		};

		this.logs.push(log);

		// Ограничение размера логов
		if (this.logs.length > 10000) {
			this.logs = this.logs.slice(-5000);
		}
	}

	getLogs(filter?: AuditFilter): AuditLog[] {
		if (!filter) return [...this.logs];

		return this.logs.filter((log) => {
			if (filter.userId && log.userId !== filter.userId) return false;
			if (filter.operation && log.operation !== filter.operation)
				return false;
			if (filter.tableName && log.tableName !== filter.tableName)
				return false;
			if (filter.startDate && log.timestamp < filter.startDate)
				return false;
			if (filter.endDate && log.timestamp > filter.endDate) return false;
			return true;
		});
	}

	private generateId(): string {
		return randomBytes(16).toString('hex');
	}
}

// Типы для аудита
export interface AuditLog {
	id: string;
	timestamp: string;
	userId?: string;
	operation: string;
	tableName?: string;
	recordId?: string;
	details?: Record<string, any>;
	ipAddress?: string;
	userAgent?: string;
}

export interface AuditOperation {
	userId?: string;
	operation: string;
	tableName?: string;
	recordId?: string;
	details?: Record<string, any>;
	ipAddress?: string;
	userAgent?: string;
}

export interface AuditFilter {
	userId?: string;
	operation?: string;
	tableName?: string;
	startDate?: string;
	endDate?: string;
}
