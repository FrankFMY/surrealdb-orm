# SurrealDB ORM

Простой и типизированный ORM для работы с SurrealDB в TypeScript.

## Возможности

-   ✅ Типизированное определение схемы базы данных
-   ✅ Автоматическая генерация SQL для создания таблиц
-   ✅ CRUD операции с типизацией
-   ✅ Поддержка индексов, ограничений и триггеров
-   ✅ Синхронизация схемы с базой данных
-   ✅ Ссылки между таблицами
-   ✅ Расширенные обновления: MERGE, PATCH, REPLACE, UPSERT
-   ✅ Live‑queries: live/kill/subscribe
-   ✅ Утилиты для графовых связей: relate/unrelate
-   ✅ Nested поля: `obj.prop`, `obj.sub.prop`, `arr.*.prop` для `array<object>`
-   ✅ SEARCH индексы: `ANALYZER`, `BM25(k1,b)`, `HIGHLIGHTS` в конфиге/SQL/интроспекции/диффе

## Установка

### Из npm (рекомендуется)

```bash
npm install surrealdb-orm
# или
pnpm add surrealdb-orm
# или
yarn add surrealdb-orm
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
cd packages/surreal

# Запускаем быстрый старт
npm exec tsx run-quick-start.ts
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

### 3. Создание ORM

```typescript
import {
	SurrealRPC,
	createORM,
	SimpleFuture,
	SimpleLogger,
} from 'surrealdb-orm';

// Настройка подключения
const env = {
	rpc: 'ws://localhost:3603/rpc',
	namespace: 'test',
	database: 'test_db',
	user: 'root',
	pass: 'password',
};

// Создание подключения
const rpc = new SurrealRPC({
	env,
	future: new SimpleFuture(),
	logger: new SimpleLogger(),
});

await rpc.open();

// Создание ORM
const orm = createORM(rpc, schema);
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

## Типы полей

### Поддерживаемые типы

-   `string` - строковые значения
-   `number` - числовые значения
-   `boolean` - логические значения
-   `datetime` - дата и время
-   `object` - объекты
-   `array` - массивы (поддержка `array<string>`, `array<number>`, `array<record<users>>`, `array<object>` с nested подполями)
-   `record` - ссылки на другие таблицы
-   `literals` — набор допустимых значений с генерацией `ASSERT $value IN [...]`

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
npm exec tsx run-test.ts
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

### Table<Config>

-   `create()` - создать таблицу
-   `drop()` - удалить таблицу
-   `createRecord(data)` - создать запись
-   `findById(id)` - найти запись по ID
-   `findAll()` - найти все записи
-   `updateRecord(id, data)` - обновить запись
-   `deleteRecord(id)` - удалить запись

### SurrealORM<Schema>

-   `table(name)` - получить таблицу по имени
-   `createTables()` - создать все таблицы
-   `dropTables()` - удалить все таблицы
-   `sync()` - синхронизировать схему
-   `migrateV2()` - гарантировать схему (idempotent DEFINE)
-   `migrateMissing()` - упрощённая миграция только недостающих сущностей
-   `planDiff()` / `applyDiff()` - дифф‑миграции (ALTER/OVERWRITE/DEFINE)
-   `introspectDatabase()` / `introspectTable()` - интроспекция (INFO FOR DB/TABLE)

### Генерация типов

-   Пространства имён: `DB.*` (c `id` как `table:${string}`) и `Plain.*` (доменные типы)
-   Алиасы входов по таблицам: `CreateInput_<table>`, `UpdateInput_<table>`
    -   Create исключает `id`, `readonly`, `valueExpr`; обязательность = `required` без `default`
    -   Update — Partial только по обновляемым полям
-   Утилиты: `RecordId<T>`, `DeepPartial<T>`, `CreateInput<T>`, `UpdateInput<T>`
