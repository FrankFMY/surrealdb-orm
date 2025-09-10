# SurrealDB ORM

Улучшенный типизированный ORM для работы с SurrealDB в TypeScript с валидацией, кэшированием, безопасностью и мониторингом.

## Возможности

- ✅ Типизированное определение схемы базы данных
- ✅ Автоматическая генерация SQL для создания таблиц
- ✅ CRUD операции с типизацией
- ✅ Поддержка индексов, ограничений и триггеров
- ✅ Синхронизация схемы с базой данных
- ✅ Ссылки между таблицами
- ✅ Расширенные обновления: MERGE, PATCH, REPLACE, UPSERT
- ✅ Live‑queries: live/kill/subscribe
- ✅ Утилиты для графовых связей: relate/unrelate
- ✅ Nested поля: `obj.prop`, `obj.sub.prop`, `arr.*.prop` для `array<object>`
- ✅ SEARCH индексы: `ANALYZER`, `BM25(k1,b)`, `HIGHLIGHTS` в конфиге/SQL/интроспекции/диффе
- ✅ Валидация данных с детальными ошибками
- ✅ Многоуровневое кэширование (Memory, Redis, Multi-level)
- ✅ Пул соединений для высокой производительности
- ✅ Система миграций и версионирование схемы
- ✅ Мониторинг и сбор метрик производительности
- ✅ Защита от SQL-инъекций и аудит операций
- ✅ Оптимизация и анализ SQL-запросов
- ✅ Централизованная обработка ошибок

## Установка

### Из npm (рекомендуется)

```bash
npm install surrealdb-orm
# или
pnpm add surrealdb-orm
# или
yarn add surrealdb-orm
```

### Импорт модулей

```typescript
// Основной ORM
import { createORM, SurrealRPC } from 'surrealdb-orm';

// Enhanced ORM с дополнительными возможностями
import {
	createEnhancedORM,
	ConnectionManager,
	QueryEngine,
} from 'surrealdb-orm/enhanced';

// Основные типы и утилиты
import type { DatabaseSchema, FieldConfig } from 'surrealdb-orm/types';
import { SurrealRPC } from 'surrealdb-orm/rpc';
import { createORM } from 'surrealdb-orm/orm';
import { KEYS, RecordBySchema } from 'surrealdb-orm/helpers';

// Валидация
import { SchemaValidator } from 'surrealdb-orm/validation';

// Кэширование
import { CacheManager, MemoryCache, RedisCache } from 'surrealdb-orm/cache';

// Производительность
import { ConnectionPool, QueryOptimizer } from 'surrealdb-orm/performance';

// Миграции
import { MigrationManager } from 'surrealdb-orm/migrations';

// Мониторинг
import { MetricsCollector } from 'surrealdb-orm/monitoring';

// Безопасность
import { SQLInjectionValidator, AuditLogger } from 'surrealdb-orm/security';

// Обработка ошибок
import {
	SurrealORMError,
	ValidationError,
	ConnectionError,
} from 'surrealdb-orm/errors';
```

### Из исходного кода

```bash
git clone https://github.com/FrankFMY/surrealdb-orm.git
cd surrealdb-orm
npm install
npm run build
```

## Быстрый старт

### 1. Запуск примера

```bash
# Переходим в директорию с ORM
cd surrealdb-orm

# Запускаем быстрый старт
npm run examples
```

### 2. Определение схемы

```typescript
import { DatabaseSchema } from 'surrealdb-orm';

const schema: DatabaseSchema = {
	users: {
		comment: 'Пользователи системы',
		fields: {
			email: {
				type: 'string',
				required: true,
				constraints: {
					'string::is::email': true,
				},
				comment: 'Email пользователя',
			},
			nickname: {
				type: 'string',
				required: true,
				constraints: {
					'string::len': [3, 50],
				},
				comment: 'Никнейм пользователя',
			},
			age: {
				type: 'number',
				required: false,
				constraints: {
					'number::min': 0,
					'number::max': 150,
				},
				comment: 'Возраст пользователя',
			},
		},
		indexes: [
			{
				name: 'idx_email',
				fields: ['email'],
				unique: true,
			},
		],
	},
};
```

### 3. Создание Enhanced ORM

```typescript
import {
	ConnectionManager,
	QueryEngine,
	createEnhancedORM,
	SimpleFuture,
	SimpleLogger,
} from 'surrealdb-orm/enhanced';

// Настройка подключения
const connection = new ConnectionManager(
	{
		rpc: 'ws://localhost:3603/rpc',
		namespace: 'test',
		database: 'test_db',
		user: 'root',
		pass: 'password',
	},
	new SimpleLogger(),
	new SimpleFuture()
);

await connection.connect();

// Создание Query Engine с кэшированием
const queryEngine = new QueryEngine(connection, new SimpleLogger(), {
	enableCaching: true,
	enableQueryLogging: true,
});

// Создание Enhanced ORM с валидацией и кэшированием
const orm = createEnhancedORM(connection, queryEngine, schema, {
	enableValidation: true,
	enableCaching: true,
	enableAudit: true,
	strictMode: true,
});
```

### 4. Синхронизация схемы

```typescript
// Создать все таблицы из схемы
await orm.sync();
```

### 5. Работа с данными

```typescript
// Получить таблицу
const usersTable = orm.table('users');

// Создать запись
const user = await usersTable.createRecord({
	email: 'john@example.com',
	nickname: 'john_doe',
	age: 25,
});

// Найти запись по ID
const foundUser = await usersTable.findById(user.id);

// Найти все записи
const allUsers = await usersTable.findAll();

// Обновить запись
const updatedUser = await usersTable.updateRecord(user.id, {
	age: 26,
});

// Удалить запись
await usersTable.deleteRecord(user.id);
```

## Расширенные возможности

### Connection Pool для производительности

```typescript
import { ConnectionPool } from 'surrealdb-orm/performance';

const pool = new ConnectionPool(
	{
		rpc: 'ws://localhost:3603/rpc',
		namespace: 'test',
		database: 'test_db',
		user: 'root',
		pass: 'password',
		minConnections: 2,
		maxConnections: 10,
	},
	new SimpleLogger(),
	new SimpleFuture()
);

// Получить соединение из пула
const connection = await pool.acquire();

// Использовать соединение
const orm = createEnhancedORM(connection, queryEngine, schema);

// Вернуть соединение в пул
await pool.release(connection);
```

### Кэширование

```typescript
import { CacheManager, MemoryCache } from 'surrealdb-orm/cache';

const cache = new CacheManager({
	defaultTTL: 300000, // 5 минут
	maxSize: 1000,
	strategy: 'LRU',
});

// Кэширование запросов
const cachedUsers = await cache.get('users:all', async () => {
	return await usersTable.findAll();
});

// Инвалидация кэша
await cache.invalidateTable('users');
```

### Валидация данных

```typescript
import { SchemaValidator } from 'surrealdb-orm/validation';

const validator = new SchemaValidator(schema);

// Валидация перед созданием
const validationResult = validator.validateRecord('users', userData);
if (!validationResult.isValid) {
	console.error('Ошибки валидации:', validationResult.errors);
}

// Создание с валидацией
const user = await usersTable.createRecord(userData, { validate: true });
```

### Система миграций

```typescript
import { MigrationManager } from 'surrealdb-orm/migrations';

const migrationManager = new MigrationManager(queryEngine, logger);

// Регистрация миграции
migrationManager.registerMigration({
	version: '20240101000001',
	name: 'create_users_table',
	description: 'Создание таблицы пользователей',
	up: async (queryEngine) => {
		await queryEngine.query(`
			DEFINE TABLE users SCHEMALESS;
			DEFINE FIELD email ON TABLE users TYPE string ASSERT string::is::email($value);
		`);
	},
	down: async (queryEngine) => {
		await queryEngine.query('REMOVE TABLE users;');
	},
});

// Применение миграций
await migrationManager.migrate();
```

### Мониторинг и метрики

```typescript
import { MetricsCollector } from 'surrealdb-orm/monitoring';

const metrics = new MetricsCollector(
	{
		collectionInterval: 10000,
		retentionPeriod: 300000,
	},
	logger
);

// Сбор метрик
metrics.increment('queries_total');
metrics.timer('query_duration', 150);
metrics.gauge('active_connections', 5);

// Получение статистики
const stats = metrics.getStats();
console.log('Метрики:', stats);
```

### Безопасность

```typescript
import { SQLInjectionValidator, AuditLogger } from 'surrealdb-orm/security';

const sqlValidator = new SQLInjectionValidator();
const auditLogger = new AuditLogger(logger);

// Проверка SQL на инъекции
const isSafe = sqlValidator.validateQuery('SELECT * FROM users WHERE id = $id');
if (!isSafe) {
	throw new Error('Потенциальная SQL-инъекция');
}

// Аудит операций
await auditLogger.logOperation({
	operation: 'CREATE',
	table: 'users',
	userId: 'user:123',
	data: { email: 'user@example.com' },
});
```

## Типы полей

### Поддерживаемые типы

- `string` - строковые значения
- `number` - числовые значения
- `boolean` - логические значения
- `datetime` - дата и время
- `object` - объекты
- `array` - массивы (поддержка `array<string>`, `array<number>`, `array<record<users>>`, `array<object>` с nested подполями)
- `record` - ссылки на другие таблицы
- `literals` — набор допустимых значений с генерацией `ASSERT $value IN [...]`

### Примеры полей

```typescript
fields: {
  // Строковое поле с ограничениями
  email: {
    type: "string",
    required: true,
    constraints: {
      "string::is::email": true,
      "string::len": [5, 100],
    },
  },

  // Числовое поле с ограничениями
  age: {
    type: "number",
    required: false,
    constraints: {
      "number::min": 0,
      "number::max": 150,
    },
  },

  // Ссылка на другую таблицу
  author: {
    type: "record",
    required: true,
    references: "users",
  },

  // Объект
  profile: {
    type: "object",
    required: false,
  },
  // Вложенные свойства объекта (генерация подполей)
  "profile.city": { type: "string" },
  "profile.addr.street": { type: "string" },

  // Массив
  tags: {
    type: "array",
    arrayOf: "string", // array<string>
    required: false,
  },
  // Массив объектов с вложенными подполями
  metrics: { type: "array", arrayOf: { object: { properties: { score: { type: "number" } } } } },
  "metrics.*.score": { type: "number" },

  // Литералы
  status: {
    type: "string",
    required: true,
    literals: ["planning", "active", "completed", "cancelled"],
  },
}
```

## Индексы

```typescript
indexes: [
	{
		name: 'idx_email',
		fields: ['email'],
		unique: true,
	},
	{
		name: 'idx_author_status',
		fields: ['author', 'status'],
	},
	{
		name: 'search_body',
		fields: ['body'],
		search: {
			analyzer: 'english',
			bm25: { k1: 1.2, b: 0.75 },
			highlights: true,
		},
	},
];
```

## Ограничения

```typescript
constraints: [
	{
		name: 'check_content_length',
		expression: 'string::len($value.content) > 10',
	},
];
```

## Триггеры

```typescript
triggers: [
	{
		name: 'set_created_at',
		event: 'CREATE',
		expression: '$value.createdAt = time::now()',
	},
];
```

## Расширенные операции обновления

```ts
// MERGE (частичное объединение)
await table.mergeRecord(id, { field: 'value' });

// PATCH (JSON Patch)
await table.patchRecord(id, [{ op: 'add', path: '/field', value: 1 }]);

// REPLACE (полная замена)
await table.replaceRecord(id, { id /* ...все поля записи... */ });

// UPSERT (создать/обновить)
await table.upsertRecord(id, { any: 'data' });
```

## Поиск с условиями

```ts
const rows = await table.find('published = $pub AND string::len(title) > 3', {
	pub: true,
});
```

## Live‑queries

```ts
const liveId = await rpc.live('posts', /* diff = */ false);
const unsubscribe = rpc.subscribeLive(liveId, (evt) => {
	// evt.action: "CREATE" | "UPDATE" | "DELETE" | "CLOSE"
	console.log('live event', evt);
});
// ...
await rpc.kill(liveId);
unsubscribe();
```

### Live builder через ORM

```ts
const live = await orm.live('posts', {
	where: 'published = true',
	fetch: ['author'],
	onEvent: (evt) => console.log('live:', evt.action, evt.result),
});
// ...
await rpc.kill(live.id);
live.unsubscribe();
```

## Графовые связи

```ts
// Создать ребро
await orm.relate('wrote', 'user:alice', 'post:1', {
	at: new Date().toISOString(),
});
// Удалить ребро
await orm.unrelate('wrote', 'user:alice', 'post:1');
```

## Пермишены

```ts
const schema: DatabaseSchema = {
	posts: {
		comment: 'Посты',
		permissions: {
			select: 'published = true OR user = $auth.id',
			create: 'user = $auth.id',
			update: 'user = $auth.id',
			delete: 'user = $auth.id OR $auth.admin = true',
		},
		fields: {
			title: { type: 'string', required: true },
			content: { type: 'string', required: true, permissions: 'FULL' },
		},
	},
};
```

## Запуск тестов

```bash
# Убедитесь, что SurrealDB запущен
docker-compose up -d

# Запустите тест
npm test
```

## CLI

### Генерация типов / схемы

````bash
# Типы TypeScript из живой БД (namespace DB по умолчанию)
npm exec tsx run-gentypes.ts --namespace DB --out types.d.ts

# В JSON схему
npm exec tsx run-gentypes.ts --json --out schema.json

Дополнительные флаги:

```bash
# Развернуть record<tb> в Plain.tb (вместо `tb:${string}`)
npm exec tsx run-gentypes.ts --namespace DB --plain Plain --expand-records --out types.d.ts
````

Переменные окружения подключения: `SURREAL_RPC`, `SURREAL_NS`, `SURREAL_DB`, `SURREAL_USER`, `SURREAL_PASS`.

### План и применение миграций

````bash
# План
npm exec tsx run-migrate.ts plan --detail
# В JSON
npm exec tsx run-migrate.ts plan --json > plan.json

# Применить
npm exec tsx run-migrate.ts apply

Destructive‑план (только отчёт, без выполнения):

```bash
npm exec tsx run-migrate.ts plan --detail --destructive
````

В отчёте помечаются SEARCH‑индексы и аспекты изменений (тип, default/value/readonly/assert/permissions и т.д.).

## Транзакции

```ts
await rpc.withTransaction(async () => {
	const created = await orm.table('posts').createRecord({
		title: 'Tx',
		content: '...long enough...',
		author: 'users:john',
	});
	await orm.table('posts').deleteRecord(created.id);
});
```

## Примеры

Смотрите файл `examples.ts` для более подробных примеров использования ORM.

## API Reference

### Основные классы

#### Table<Config>

- `create()` - создать таблицу
- `drop()` - удалить таблицу
- `createRecord(data, options?)` - создать запись
- `findById(id)` - найти запись по ID
- `findAll()` - найти все записи
- `updateRecord(id, data)` - обновить запись
- `deleteRecord(id)` - удалить запись

#### Enhanced ORM

- `table(name)` - получить таблицу по имени
- `sync()` - синхронизировать схему
- `getStats()` - получить статистику ORM

#### ConnectionManager

- `connect()` - подключиться к базе
- `disconnect()` - отключиться
- `query(sql, params?)` - выполнить запрос

#### QueryEngine

- `query(sql, params?)` - выполнить запрос
- `getPerformanceStats()` - получить статистику производительности

### Расширенные классы

#### ConnectionPool

- `acquire()` - получить соединение из пула
- `release(connection)` - вернуть соединение в пул
- `getStats()` - получить статистику пула
- `close()` - закрыть пул

#### CacheManager

- `get(key, factory)` - получить значение из кэша
- `set(key, value, ttl?)` - установить значение в кэш
- `invalidate(key)` - инвалидировать ключ
- `invalidateTable(table)` - инвалидировать кэш таблицы

#### SchemaValidator

- `validateRecord(table, data)` - валидировать запись
- `validateField(table, field, value)` - валидировать поле

#### MigrationManager

- `registerMigration(migration)` - зарегистрировать миграцию
- `migrate()` - применить миграции
- `getStatus()` - получить статус миграций

#### MetricsCollector

- `increment(name, value?, labels?)` - увеличить счетчик
- `timer(name, value)` - записать время выполнения
- `gauge(name, value)` - установить значение метрики
- `getStats()` - получить статистику

#### SQLInjectionValidator

- `validateQuery(query)` - проверить запрос на инъекции

#### AuditLogger

- `logOperation(operation)` - записать операцию в аудит

### Генерация типов

- Пространства имён: `DB.*` (c `id` как `table:${string}`) и `Plain.*` (доменные типы)
- Алиасы входов по таблицам: `CreateInput_<table>`, `UpdateInput_<table>`
    - Create исключает `id`, `readonly`, `valueExpr`; обязательность = `required` без `default`
    - Update — Partial только по обновляемым полям
- Утилиты: `RecordId<T>`, `DeepPartial<T>`, `CreateInput<T>`, `UpdateInput<T>`


### 🔧 **Строгие типы SurrealDB**

```typescript
// Полная типизация SurrealDB структур
import type {
	SurrealRecord,
	SurrealFieldType,
	SurrealDatabaseSchema,
	SurrealTableConfig,
	SurrealFieldConfig,
	SurrealConstraints,
	SurrealValidationError,
} from 'surrealdb-orm/types';

// Строгая типизация полей
type UserRecord = SurrealRecord<{
	email: string;
	age: number;
	profile: Record<string, unknown>;
}>;

// Строгая типизация схемы
const schema: SurrealDatabaseSchema<{
	users: UserRecord;
	posts: PostRecord;
}> = {
	users: {
		fields: {
			email: { type: 'string', required: true },
			age: { type: 'number', constraints: { min: 0, max: 150 } },
		},
	},
};
```

## Требования

- Node.js >= 18.0.0
- TypeScript >= 5.0.0
- SurrealDB server

## Зависимости

- `ws` - WebSocket клиент для подключения к SurrealDB

## Дополнительные примеры

Смотрите файл `examples/enhanced-examples.ts` для подробных примеров использования всех возможностей Enhanced ORM.

## Поддержка

- GitHub: https://github.com/FrankFMY/surrealdb-orm-enhanced
- Issues: https://github.com/FrankFMY/surrealdb-orm-enhanced/issues
