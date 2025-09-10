/**
 * Система сбора метрик и мониторинга для SurrealDB ORM
 */

import { EventEmitter } from 'events';
import type { ILogger } from '../../helpers';

// Типы метрик
export interface Metric {
	name: string;
	value: number;
	timestamp: string;
	tags?: Record<string, string>;
	type: 'counter' | 'gauge' | 'histogram' | 'timer';
}

export interface CounterMetric extends Metric {
	type: 'counter';
	increment: number;
}

export interface GaugeMetric extends Metric {
	type: 'gauge';
	value: number;
}

export interface HistogramMetric extends Metric {
	type: 'histogram';
	buckets: Record<string, number>;
	count: number;
	sum: number;
}

export interface TimerMetric extends Metric {
	type: 'timer';
	duration: number;
}

// Конфигурация коллектора метрик
export interface MetricsConfig {
	collectionInterval?: number;
	retentionPeriod?: number;
	maxMetrics?: number;
	enableAggregation?: boolean;
	aggregationInterval?: number;
}

// Агрегированные метрики
export interface AggregatedMetrics {
	name: string;
	period: string;
	count: number;
	sum: number;
	min: number;
	max: number;
	avg: number;
	p50: number;
	p95: number;
	p99: number;
	timestamp: string;
}

// События метрик
export interface MetricsEvents {
	metric: (metric: Metric) => void;
	aggregation: (metrics: AggregatedMetrics) => void;
	threshold: (metric: Metric, threshold: number) => void;
}

// Коллектор метрик
export class MetricsCollector extends EventEmitter {
	private metrics: Metric[] = [];
	private config: Required<MetricsConfig>;
	private logger: ILogger;
	private collectionTimer?: NodeJS.Timeout;
	private aggregationTimer?: NodeJS.Timeout;
	private thresholds = new Map<
		string,
		{ value: number; operator: '>' | '<' | '=' }
	>();

	constructor(config: MetricsConfig = {}, logger: ILogger) {
		super();
		this.config = {
			collectionInterval: config.collectionInterval ?? 60000, // 1 минута
			retentionPeriod: config.retentionPeriod ?? 3600000, // 1 час
			maxMetrics: config.maxMetrics ?? 10000,
			enableAggregation: config.enableAggregation ?? true,
			aggregationInterval: config.aggregationInterval ?? 300000, // 5 минут
		};
		this.logger = logger;

		this.startCollection();
		if (this.config.enableAggregation) {
			this.startAggregation();
		}
	}

	/**
	 * Запись метрики
	 */
	record(metric: Metric): void {
		// Проверка пороговых значений
		this.checkThresholds(metric);

		// Добавление метрики
		this.metrics.push(metric);

		// Ограничение размера
		if (this.metrics.length > this.config.maxMetrics) {
			this.metrics = this.metrics.slice(-this.config.maxMetrics);
		}

		this.emit('metric', metric);
	}

	/**
	 * Увеличение счетчика
	 */
	increment(
		name: string,
		increment = 1,
		tags?: Record<string, string>
	): void {
		this.record({
			name,
			type: 'counter',
			value: increment,
			timestamp: new Date().toISOString(),
			tags,
		} as CounterMetric);
	}

	/**
	 * Установка значения gauge
	 */
	gauge(name: string, value: number, tags?: Record<string, string>): void {
		this.record({
			name,
			type: 'gauge',
			value,
			timestamp: new Date().toISOString(),
			tags,
		} as GaugeMetric);
	}

	/**
	 * Запись времени выполнения
	 */
	timer(name: string, duration: number, tags?: Record<string, string>): void {
		this.record({
			name,
			type: 'timer',
			value: duration,
			duration,
			timestamp: new Date().toISOString(),
			tags,
		} as TimerMetric);
	}

	/**
	 * Запись гистограммы
	 */
	histogram(
		name: string,
		value: number,
		buckets: Record<string, number>,
		tags?: Record<string, string>
	): void {
		this.record({
			name,
			type: 'histogram',
			value,
			buckets,
			count: 1,
			sum: value,
			timestamp: new Date().toISOString(),
			tags,
		} as HistogramMetric);
	}

	/**
	 * Установка порогового значения
	 */
	setThreshold(
		name: string,
		value: number,
		operator: '>' | '<' | '=' = '>'
	): void {
		this.thresholds.set(name, { value, operator });
	}

	/**
	 * Проверка пороговых значений
	 */
	private checkThresholds(metric: Metric): void {
		const threshold = this.thresholds.get(metric.name);
		if (!threshold) return;

		let triggered = false;
		switch (threshold.operator) {
			case '>':
				triggered = metric.value > threshold.value;
				break;
			case '<':
				triggered = metric.value < threshold.value;
				break;
			case '=':
				triggered = metric.value === threshold.value;
				break;
		}

		if (triggered) {
			this.emit('threshold', metric, threshold.value);
			this.logger.warn(
				{ module: 'MetricsCollector', method: 'checkThresholds' },
				`Threshold exceeded for metric ${metric.name}: ${metric.value} ${threshold.operator} ${threshold.value}`
			);
		}
	}

	/**
	 * Получение метрик по имени
	 */
	getMetrics(name: string, tags?: Record<string, string>): Metric[] {
		return this.metrics.filter((metric) => {
			if (metric.name !== name) return false;
			if (!tags) return true;

			for (const [key, value] of Object.entries(tags)) {
				if (metric.tags?.[key] !== value) return false;
			}
			return true;
		});
	}

	/**
	 * Получение последних метрик
	 */
	getRecentMetrics(count = 100): Metric[] {
		return this.metrics.slice(-count);
	}

	/**
	 * Получение агрегированных метрик
	 */
	getAggregatedMetrics(
		name: string,
		period = '1h'
	): AggregatedMetrics | null {
		const now = new Date();
		const periodMs = this.parsePeriod(period);
		const startTime = new Date(now.getTime() - periodMs);

		const relevantMetrics = this.metrics.filter((metric) => {
			if (metric.name !== name) return false;
			const metricTime = new Date(metric.timestamp);
			return metricTime >= startTime && metricTime <= now;
		});

		if (relevantMetrics.length === 0) return null;

		const values = relevantMetrics
			.map((m) => m.value)
			.sort((a, b) => a - b);
		const count = values.length;
		const sum = values.reduce((acc, val) => acc + val, 0);
		const min = values[0];
		const max = values[count - 1];
		const avg = sum / count;
		const p50 = values[Math.floor(count * 0.5)];
		const p95 = values[Math.floor(count * 0.95)];
		const p99 = values[Math.floor(count * 0.99)];

		return {
			name,
			period,
			count,
			sum,
			min,
			max,
			avg,
			p50,
			p95,
			p99,
			timestamp: now.toISOString(),
		};
	}

	/**
	 * Запуск сбора метрик
	 */
	private startCollection(): void {
		this.collectionTimer = setInterval(() => {
			this.cleanupOldMetrics();
		}, this.config.collectionInterval);
	}

	/**
	 * Запуск агрегации
	 */
	private startAggregation(): void {
		this.aggregationTimer = setInterval(() => {
			this.performAggregation();
		}, this.config.aggregationInterval);
	}

	/**
	 * Очистка старых метрик
	 */
	private cleanupOldMetrics(): void {
		const cutoffTime = new Date(Date.now() - this.config.retentionPeriod);
		const initialCount = this.metrics.length;

		this.metrics = this.metrics.filter(
			(metric) => new Date(metric.timestamp) > cutoffTime
		);

		const removedCount = initialCount - this.metrics.length;
		if (removedCount > 0) {
			this.logger.debug(
				{ module: 'MetricsCollector', method: 'cleanupOldMetrics' },
				`Cleaned up ${removedCount} old metrics`
			);
		}
	}

	/**
	 * Выполнение агрегации
	 */
	private performAggregation(): void {
		const metricNames = new Set(this.metrics.map((m) => m.name));

		metricNames.forEach((name) => {
			const aggregated = this.getAggregatedMetrics(name, '5m');
			if (aggregated) {
				this.emit('aggregation', aggregated);
			}
		});
	}

	/**
	 * Парсинг периода времени
	 */
	private parsePeriod(period: string): number {
		const match = period.match(/^(\d+)([smhd])$/);
		if (!match) return 3600000; // 1 час по умолчанию

		const value = parseInt(match[1]);
		const unit = match[2];

		switch (unit) {
			case 's':
				return value * 1000;
			case 'm':
				return value * 60 * 1000;
			case 'h':
				return value * 60 * 60 * 1000;
			case 'd':
				return value * 24 * 60 * 60 * 1000;
			default:
				return 3600000;
		}
	}

	/**
	 * Получение статистики коллектора
	 */
	getStats() {
		const metricTypes = new Map<string, number>();
		for (const metric of this.metrics) {
			metricTypes.set(
				metric.type,
				(metricTypes.get(metric.type) || 0) + 1
			);
		}

		return {
			totalMetrics: this.metrics.length,
			metricTypes: Object.fromEntries(metricTypes),
			thresholds: this.thresholds.size,
			retentionPeriod: this.config.retentionPeriod,
			maxMetrics: this.config.maxMetrics,
		};
	}

	/**
	 * Остановка коллектора
	 */
	stop(): void {
		if (this.collectionTimer) {
			clearInterval(this.collectionTimer);
		}
		if (this.aggregationTimer) {
			clearInterval(this.aggregationTimer);
		}
	}
}

// Декоратор для автоматического сбора метрик
export function withMetrics(collector: MetricsCollector, metricName: string) {
	return function (
		target: any,
		propertyName: string,
		descriptor: PropertyDescriptor
	) {
		const method = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			const startTime = Date.now();

			try {
				const result = await method.apply(this, args);
				const duration = Date.now() - startTime;

				collector.timer(`${metricName}.${propertyName}`, duration, {
					status: 'success',
				});

				return result;
			} catch (error) {
				const duration = Date.now() - startTime;

				collector.timer(`${metricName}.${propertyName}`, duration, {
					status: 'error',
					error: error instanceof Error ? error.name : 'Unknown',
				});

				throw error;
			}
		};
	};
}
