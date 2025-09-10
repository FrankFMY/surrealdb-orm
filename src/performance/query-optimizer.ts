/**
 * Система оптимизации запросов для SurrealDB ORM
 */

import type { QueryEngine } from '../core/query-engine';

// Статистика запроса
export interface QueryMetrics {
	query: string;
	executionTime: number;
	resultSize: number;
	cacheHit: boolean;
	timestamp: string;
	complexity: QueryComplexity;
}

// Сложность запроса
export interface QueryComplexity {
	score: number;
	factors: {
		joins: number;
		subqueries: number;
		aggregations: number;
		sorting: boolean;
		filtering: boolean;
	};
}

// План оптимизации
export interface OptimizationPlan {
	originalQuery: string;
	optimizedQuery: string;
	optimizations: Optimization[];
	estimatedImprovement: number;
}

// Тип оптимизации
export interface Optimization {
	type: 'index' | 'join' | 'filter' | 'projection' | 'cache';
	description: string;
	impact: 'low' | 'medium' | 'high';
}

// Анализ производительности
export class QueryAnalyzer {
	private metrics: QueryMetrics[] = [];
	private slowQueries: QueryMetrics[] = [];
	private readonly slowQueryThreshold = 1000; // 1 секунда

	/**
	 * Анализ сложности запроса
	 */
	analyzeComplexity(query: string): QueryComplexity {
		const upperQuery = query.toUpperCase();

		const factors = {
			joins: (upperQuery.match(/\bJOIN\b/g) || []).length,
			subqueries: (upperQuery.match(/\(SELECT/g) || []).length,
			aggregations: (
				upperQuery.match(/\b(COUNT|SUM|AVG|MIN|MAX|GROUP BY)\b/g) || []
			).length,
			sorting: /\bORDER BY\b/.test(upperQuery),
			filtering: /\bWHERE\b/.test(upperQuery),
		};

		// Расчет сложности
		let score = 0;
		score += factors.joins * 10;
		score += factors.subqueries * 15;
		score += factors.aggregations * 5;
		score += factors.sorting ? 3 : 0;
		score += factors.filtering ? 2 : 0;

		return { score, factors };
	}

	/**
	 * Запись метрик запроса
	 */
	recordMetrics(metrics: QueryMetrics): void {
		this.metrics.push(metrics);

		if (metrics.executionTime > this.slowQueryThreshold) {
			this.slowQueries.push(metrics);
		}

		// Ограничение размера истории
		if (this.metrics.length > 10000) {
			this.metrics = this.metrics.slice(-5000);
		}

		if (this.slowQueries.length > 1000) {
			this.slowQueries = this.slowQueries.slice(-500);
		}
	}

	/**
	 * Получение статистики производительности
	 */
	getPerformanceStats() {
		const totalQueries = this.metrics.length;
		const avgExecutionTime =
			totalQueries > 0 ?
				this.metrics.reduce((sum, m) => sum + m.executionTime, 0) /
				totalQueries
			:	0;

		const slowQueryCount = this.slowQueries.length;
		const slowQueryRate =
			totalQueries > 0 ? slowQueryCount / totalQueries : 0;

		const avgComplexity =
			totalQueries > 0 ?
				this.metrics.reduce((sum, m) => sum + m.complexity.score, 0) /
				totalQueries
			:	0;

		return {
			totalQueries,
			avgExecutionTime,
			slowQueryCount,
			slowQueryRate,
			avgComplexity,
			recentSlowQueries: this.slowQueries.slice(-10),
		};
	}

	/**
	 * Получение самых медленных запросов
	 */
	getSlowestQueries(limit = 10): QueryMetrics[] {
		return this.slowQueries
			.sort((a, b) => b.executionTime - a.executionTime)
			.slice(0, limit);
	}
}

// Оптимизатор запросов
export class QueryOptimizer {
	private analyzer: QueryAnalyzer;

	constructor() {
		this.analyzer = new QueryAnalyzer();
	}

	/**
	 * Оптимизация запроса
	 */
	optimizeQuery(query: string): OptimizationPlan {
		const complexity = this.analyzer.analyzeComplexity(query);
		const optimizations: Optimization[] = [];
		let optimizedQuery = query;
		let estimatedImprovement = 0;

		// Оптимизация индексов
		const indexOptimizations = this.optimizeIndexes(query);
		optimizations.push(...indexOptimizations.optimizations);
		optimizedQuery = indexOptimizations.query;
		estimatedImprovement += indexOptimizations.improvement;

		// Оптимизация JOIN'ов
		const joinOptimizations = this.optimizeJoins(optimizedQuery);
		optimizations.push(...joinOptimizations.optimizations);
		optimizedQuery = joinOptimizations.query;
		estimatedImprovement += joinOptimizations.improvement;

		// Оптимизация фильтров
		const filterOptimizations = this.optimizeFilters(optimizedQuery);
		optimizations.push(...filterOptimizations.optimizations);
		optimizedQuery = filterOptimizations.query;
		estimatedImprovement += filterOptimizations.improvement;

		// Оптимизация проекции
		const projectionOptimizations = this.optimizeProjection(optimizedQuery);
		optimizations.push(...projectionOptimizations.optimizations);
		optimizedQuery = projectionOptimizations.query;
		estimatedImprovement += projectionOptimizations.improvement;

		return {
			originalQuery: query,
			optimizedQuery,
			optimizations,
			estimatedImprovement,
		};
	}

	/**
	 * Оптимизация индексов
	 */
	private optimizeIndexes(query: string): {
		query: string;
		optimizations: Optimization[];
		improvement: number;
	} {
		const optimizations: Optimization[] = [];
		let improvement = 0;

		// Поиск WHERE условий без индексов
		const whereMatches = query.match(/WHERE\s+([^ORDER|GROUP|LIMIT]+)/gi);
		if (whereMatches) {
			for (const whereClause of whereMatches) {
				const fields = this.extractFieldsFromWhere(whereClause);
				for (const field of fields) {
					optimizations.push({
						type: 'index',
						description: `Consider adding index on ${field}`,
						impact: 'high',
					});
					improvement += 20;
				}
			}
		}

		return { query, optimizations, improvement };
	}

	/**
	 * Оптимизация JOIN'ов
	 */
	private optimizeJoins(query: string): {
		query: string;
		optimizations: Optimization[];
		improvement: number;
	} {
		const optimizations: Optimization[] = [];
		let improvement = 0;

		// Поиск неэффективных JOIN'ов
		const joinMatches = query.match(
			/JOIN\s+(\w+)\s+ON\s+([^WHERE|ORDER|GROUP|LIMIT]+)/gi
		);
		if (joinMatches) {
			for (const joinClause of joinMatches) {
				optimizations.push({
					type: 'join',
					description:
						'Consider optimizing JOIN order and conditions',
					impact: 'medium',
				});
				improvement += 15;
			}
		}

		return { query, optimizations, improvement };
	}

	/**
	 * Оптимизация фильтров
	 */
	private optimizeFilters(query: string): {
		query: string;
		optimizations: Optimization[];
		improvement: number;
	} {
		const optimizations: Optimization[] = [];
		let improvement = 0;

		// Поиск неэффективных WHERE условий
		if (query.includes('WHERE')) {
			optimizations.push({
				type: 'filter',
				description: 'Consider moving selective filters first',
				impact: 'medium',
			});
			improvement += 10;
		}

		return { query, optimizations, improvement };
	}

	/**
	 * Оптимизация проекции
	 */
	private optimizeProjection(query: string): {
		query: string;
		optimizations: Optimization[];
		improvement: number;
	} {
		const optimizations: Optimization[] = [];
		let improvement = 0;

		// Проверка на SELECT *
		if (query.includes('SELECT *')) {
			optimizations.push({
				type: 'projection',
				description:
					'Consider selecting only required fields instead of *',
				impact: 'low',
			});
			improvement += 5;
		}

		return { query, optimizations, improvement };
	}

	/**
	 * Извлечение полей из WHERE условия
	 */
	private extractFieldsFromWhere(whereClause: string): string[] {
		const fields: string[] = [];
		const fieldMatches = whereClause.match(/(\w+)\s*[=<>!]/g);
		if (fieldMatches) {
			for (const match of fieldMatches) {
				const field = match.replace(/\s*[=<>!].*/, '');
				if (!fields.includes(field)) {
					fields.push(field);
				}
			}
		}
		return fields;
	}

	/**
	 * Получение анализатора
	 */
	getAnalyzer(): QueryAnalyzer {
		return this.analyzer;
	}
}

// Менеджер производительности
export class PerformanceManager {
	private optimizer: QueryOptimizer;
	private metrics: Map<string, QueryMetrics[]> = new Map();

	constructor() {
		this.optimizer = new QueryOptimizer();
	}

	/**
	 * Анализ и оптимизация запроса
	 */
	analyzeAndOptimize(query: string): OptimizationPlan {
		return this.optimizer.optimizeQuery(query);
	}

	/**
	 * Запись метрик
	 */
	recordMetrics(query: string, metrics: QueryMetrics): void {
		const analyzer = this.optimizer.getAnalyzer();
		analyzer.recordMetrics(metrics);

		// Сохранение метрик по запросам
		if (!this.metrics.has(query)) {
			this.metrics.set(query, []);
		}
		this.metrics.get(query)!.push(metrics);
	}

	/**
	 * Получение рекомендаций по оптимизации
	 */
	getOptimizationRecommendations(): string[] {
		const recommendations: string[] = [];
		const stats = this.optimizer.getAnalyzer().getPerformanceStats();

		if (stats.slowQueryRate > 0.1) {
			recommendations.push(
				'High slow query rate detected. Consider optimizing frequently used queries.'
			);
		}

		if (stats.avgExecutionTime > 500) {
			recommendations.push(
				'Average query execution time is high. Consider adding indexes or optimizing queries.'
			);
		}

		if (stats.avgComplexity > 20) {
			recommendations.push(
				'High query complexity detected. Consider breaking down complex queries.'
			);
		}

		return recommendations;
	}

	/**
	 * Получение статистики производительности
	 */
	getPerformanceStats() {
		return {
			analyzer: this.optimizer.getAnalyzer().getPerformanceStats(),
			recommendations: this.getOptimizationRecommendations(),
			queryCount: this.metrics.size,
		};
	}
}
