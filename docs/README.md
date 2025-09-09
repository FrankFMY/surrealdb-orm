# SurrealDB ORM - Улучшенная версия

Типизированный ORM для работы с SurrealDB в TypeScript с расширенными возможностями валидации, кэширования, безопасности и мониторинга.

## 🚀 Основные возможности

### ✨ Новые функции
- **Строгая валидация данных** с поддержкой кастомных валидаторов
- **Система кэширования** с поддержкой Redis и многоуровневого кэша
- **Connection pooling** для оптимизации производительности
- **Система миграций** с поддержкой откатов и зависимостей
- **Мониторинг и метрики** в реальном времени
- **Безопасность** с защитой от SQL инъекций и rate limiting
- **Аудит операций** с детальным логированием
- **Оптимизация запросов** с автоматическим анализом производительности

### 🔧 Улучшения
- **Улучшенная типизация** с строгими типами и валидацией
- **Обработка ошибок** с детальными сообщениями и контекстом
- **Архитектурные улучшения** с разделением ответственности
- **Производительность** с кэшированием и оптимизацией запросов

## 📦 Установка

```bash
npm install surrealdb-orm-enhanced
# или
yarn add surrealdb-orm-enhanced
# или
pnpm add surrealdb-orm-enhanced
```

## 🏗️ Быстрый старт

### Базовое использование

```typescript
import { 
  ConnectionManager, 
  QueryEngine, 
  createEnhancedORM,
  type EnhancedORMConfig 
} from 'surrealdb-orm-enhanced';
import { SimpleLogger, SimpleFuture } from 'surrealdb-orm-enhanced/helpers';

// Конфигурация подключения
const connectionConfig = {
  rpc: 'ws://localhost:3603/rpc',
  namespace: 'test',
  database: 'test_db',
  user: 'root',
  pass: 'password',
  timeout: 30000,
  retryAttempts: 3
};

// Создание подключения
const connection = new ConnectionManager(
  connectionConfig,
  new SimpleLogger(),
  new SimpleFuture()
);

await connection.connect();

// Создание query engine
const queryEngine = new QueryEngine(connection, new SimpleLogger(), {
  enableCaching: true,
  cacheTTL: 300000,
  enableQueryLogging: true
});

// Определение схемы с валидацией
const schema = {
  users: {
    comment: 'Пользователи системы',
    fields: {
      email: {
        type: 'string' as const,
        required: true,
        constraints: {
          email: true,
          minLength: 5,
          maxLength: 100
        }
      },
      age: {
        type: 'number' as const,
        required: false,
        constraints: {
          min: 0,
          max: 150
        }
      }
    },
    indexes: [
      {
        name: 'idx_email',
        fields: ['email'],
        unique: true
      }
    ]
  }
};

// Конфигурация ORM
const ormConfig: EnhancedORMConfig = {
  enableValidation: true,
  enableCaching: true,
  enableAudit: true,
  enableRateLimit: true,
  strictMode: true,
  cacheConfig: {
    defaultTTL: 300000,
    maxSize: 1000
  },
  rateLimitConfig: {
    requestsPerSecond: 100,
    burstLimit: 10
  }
};

// Создание ORM
const orm = createEnhancedORM(connection, queryEngine, schema, ormConfig);

// Синхронизация схемы
await orm.sync();

// Работа с данными
const usersTable = orm.table('users');

// Создание пользователя с валидацией
const user = await usersTable.createRecord({
  email: 'john@example.com',
  age: 25
});

console.log('Создан пользователь:', user);
```

### Использование с Connection Pool

```typescript
import { ConnectionPool } from 'surrealdb-orm-enhanced/performance';

// Создание пула подключений
const pool = new ConnectionPool(
  connectionConfig,
  new SimpleLogger(),
  new SimpleFuture(),
  5 // размер пула
);

await pool.initialize();

// Получение подключения из пула
const connection = pool.getConnection();

// Использование подключения
const queryEngine = new QueryEngine(connection, new SimpleLogger());
```

### Система миграций

```typescript
import { MigrationManager } from 'surrealdb-orm-enhanced/migrations';

const migrationManager = new MigrationManager(queryEngine, new SimpleLogger());

// Регистрация миграции
migrationManager.registerMigration({
  version: '20240101000001',
  name: 'create_users_table',
  description: 'Создание таблицы пользователей',
  up: async (queryEngine) => {
    await queryEngine.query(`
      DEFINE TABLE users SCHEMALESS;
      DEFINE FIELD email ON TABLE users TYPE string ASSERT string::is::email($value);
      DEFINE FIELD age ON TABLE users TYPE number ASSERT $value >= 0 AND $value <= 150;
    `);
  },
  down: async (queryEngine) => {
    await queryEngine.query('REMOVE TABLE users;');
  },
  rollbackable: true
});

// Применение миграций
await migrationManager.migrate();

// Проверка статуса
const status = await migrationManager.getStatus();
console.log('Статус миграций:', status);
```

### Мониторинг и метрики

```typescript
import { MetricsCollector } from 'surrealdb-orm-enhanced/monitoring';

const metrics = new MetricsCollector({
  collectionInterval: 60000,
  retentionPeriod: 3600000
}, new SimpleLogger());

// Установка пороговых значений
metrics.setThreshold('query_duration', 1000, '>');
metrics.setThreshold('error_rate', 0.1, '>');

// Запись метрик
metrics.increment('queries_total');
metrics.timer('query_duration', 150);
metrics.gauge('active_connections', 5);

// Получение агрегированных метрик
const queryMetrics = metrics.getAggregatedMetrics('query_duration', '1h');
console.log('Метрики запросов:', queryMetrics);
```

## 🔒 Безопасность

### Защита от SQL инъекций

```typescript
// Автоматическая валидация входных данных
const user = await usersTable.createRecord({
  email: 'user@example.com',
  // Потенциально опасные данные будут автоматически санитизированы
  name: "'; DROP TABLE users; --"
});
```

### Rate Limiting

```typescript
// Автоматическое ограничение частоты запросов
const ormConfig: EnhancedORMConfig = {
  enableRateLimit: true,
  rateLimitConfig: {
    requestsPerSecond: 100,
    burstLimit: 10
  }
};
```

### Аудит операций

```typescript
// Автоматическое логирование всех операций
const ormConfig: EnhancedORMConfig = {
  enableAudit: true,
  auditConfig: {
    logAllOperations: true,
    sensitiveFields: ['password', 'token']
  }
};
```

## 📊 Производительность

### Кэширование

```typescript
// Автоматическое кэширование запросов
const queryEngine = new QueryEngine(connection, logger, {
  enableCaching: true,
  cacheTTL: 300000, // 5 минут
  enableQueryLogging: true
});

// Кэширование схем
const schema = await queryEngine.getSchema('users');
```

### Оптимизация запросов

```typescript
import { QueryOptimizer } from 'surrealdb-orm-enhanced/performance';

const optimizer = new QueryOptimizer();

// Анализ и оптимизация запроса
const plan = optimizer.optimizeQuery(`
  SELECT * FROM users WHERE email = $email AND age > $minAge
`);

console.log('Оптимизации:', plan.optimizations);
console.log('Ожидаемое улучшение:', plan.estimatedImprovement + '%');
```

## 🧪 Тестирование

### Unit тесты

```typescript
import { describe, it, expect } from 'vitest';
import { EnhancedTable } from 'surrealdb-orm-enhanced';

describe('EnhancedTable', () => {
  it('should validate data correctly', async () => {
    const table = new EnhancedTable(/* ... */);
    
    // Тест валидации
    await expect(
      table.createRecord({ email: 'invalid-email' })
    ).rejects.toThrow('Validation failed');
  });
});
```

### Интеграционные тесты

```typescript
describe('ORM Integration', () => {
  it('should handle full CRUD operations', async () => {
    const orm = createEnhancedORM(/* ... */);
    
    // Создание
    const user = await orm.table('users').createRecord({
      email: 'test@example.com',
      age: 25
    });
    
    // Чтение
    const found = await orm.table('users').findById(user.id);
    expect(found).toBeDefined();
    
    // Обновление
    const updated = await orm.table('users').updateRecord(user.id, {
      age: 26
    });
    expect(updated.age).toBe(26);
    
    // Удаление
    await orm.table('users').deleteRecord(user.id);
  });
});
```

## 📈 Мониторинг

### Метрики производительности

```typescript
// Получение статистики производительности
const stats = orm.getStats();
console.log('Статистика ORM:', stats);

// Метрики запросов
const queryStats = queryEngine.getPerformanceStats();
console.log('Производительность запросов:', queryStats);

// Статистика пула подключений
const poolStats = pool.getStats();
console.log('Статистика пула:', poolStats);
```

### Алерты и уведомления

```typescript
// Настройка уведомлений о превышении порогов
metrics.on('threshold', (metric, threshold) => {
  console.warn(`Порог превышен: ${metric.name} = ${metric.value} (порог: ${threshold})`);
  
  // Отправка уведомления
  sendAlert({
    type: 'threshold_exceeded',
    metric: metric.name,
    value: metric.value,
    threshold
  });
});
```

## 🔧 Конфигурация

### Полная конфигурация

```typescript
const config: EnhancedORMConfig = {
  // Валидация
  enableValidation: true,
  strictMode: true,
  
  // Кэширование
  enableCaching: true,
  cacheConfig: {
    defaultTTL: 300000,
    maxSize: 1000
  },
  
  // Аудит
  enableAudit: true,
  auditConfig: {
    logAllOperations: true,
    sensitiveFields: ['password', 'token', 'secret']
  },
  
  // Rate limiting
  enableRateLimit: true,
  rateLimitConfig: {
    requestsPerSecond: 100,
    burstLimit: 10
  }
};
```

## 📚 API Reference

### EnhancedTable

- `createRecord(data, context?)` - Создание записи с валидацией
- `updateRecord(id, data, context?)` - Обновление записи с валидацией
- `findById(id)` - Поиск по ID с кэшированием
- `find(where, vars?)` - Поиск с условиями
- `deleteRecord(id)` - Удаление записи
- `getStats()` - Получение статистики таблицы

### EnhancedSurrealORM

- `table(name)` - Получение таблицы
- `validateSchema()` - Валидация схемы
- `sync()` - Синхронизация схемы
- `getStats()` - Получение статистики ORM

### QueryEngine

- `query(sql, params?)` - Выполнение запроса
- `transaction(queries)` - Выполнение транзакции
- `batch(queries)` - Выполнение batch запросов
- `clearCache()` - Очистка кэша
- `getPerformanceStats()` - Статистика производительности

## 🤝 Вклад в проект

1. Fork репозитория
2. Создайте feature branch (`git checkout -b feature/amazing-feature`)
3. Commit изменения (`git commit -m 'Add amazing feature'`)
4. Push в branch (`git push origin feature/amazing-feature`)
5. Откройте Pull Request

## 📄 Лицензия

MIT License - см. файл [LICENSE](LICENSE) для деталей.

## 🆘 Поддержка

- 📧 Email: support@surrealdb-orm.com
- 💬 Discord: [SurrealDB Community](https://discord.gg/surrealdb)
- 📖 Документация: [docs.surrealdb-orm.com](https://docs.surrealdb-orm.com)
- 🐛 Issues: [GitHub Issues](https://github.com/surrealdb-orm/issues)