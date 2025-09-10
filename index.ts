// Основные экспорты (оригинальная версия)
export * from './rpc';
export * from './types';
export * from './orm';
export * from './helpers';

// Дополнительные утилиты
export * from './types-gen';

// Примеры (опционально)
export * from './examples';

// Улучшенные экспорты
export * from './src/orm-enhanced';
export * from './src/cache';
export * from './src/core/query-engine';
export * from './src/performance/query-optimizer';
export * from './src/migrations/migration-manager';
export * from './src/monitoring/metrics-collector';
export * from './src/security';

// Экспорты с разрешением конфликтов
export type { ValidationError as ValidationErrorType } from './src/types/validation';
export * from './src/errors';

export { ConnectionPool as CoreConnectionPool } from './src/core/connection';
export { ConnectionPool as PerformanceConnectionPool } from './src/performance/connection-pool';
