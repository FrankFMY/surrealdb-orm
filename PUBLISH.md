# Инструкция по публикации в npm

## Подготовка к публикации

Проект готов к публикации в npm! Все необходимые файлы созданы и настроены.

### Что было сделано:

1. ✅ **Создан `package.json`** с правильными настройками:

    - Имя пакета: `surrealdb-orm`
    - Версия: `1.0.0`
    - Основные файлы: `dist/index.js` и `dist/index.d.ts`
    - Зависимости: `ws` для WebSocket соединений
    - Dev зависимости: TypeScript, типы для Node.js и WebSocket

2. ✅ **Создан `tsconfig.json`** для сборки:

    - Генерация `.d.ts` файлов
    - Сборка в папку `dist/`
    - Настройка модульной системы ESNext

3. ✅ **Исправлены зависимости**:

    - Создан файл `helpers.ts` с собственными типами и утилитами
    - Убраны внешние зависимости `@nemigo/helpers/*` и `@server/logger/*`
    - Исправлены все импорты в коде

4. ✅ **Настроена сборка**:

    - TypeScript компиляция работает без ошибок
    - Генерируются `.js`, `.d.ts` и `.map` файлы
    - Все типы корректно экспортируются

5. ✅ **Обновлена документация**:
    - README.md с инструкциями по установке из npm
    - Примеры использования обновлены
    - Создан `.npmignore` для исключения ненужных файлов

## Команды для публикации

### 1. Войти в npm (если еще не вошли)

```bash
npm login
```

Введите имя пользователя, пароль и email, которые использовались при регистрации на npm.

### 2. Проверить содержимое пакета

```bash
npm pack --dry-run
```

Эта команда покажет, какие файлы будут включены в пакет без его создания.

### 3. Опубликовать пакет

```bash
npm publish --access public
```

Флаг `--access public` нужен для публичного пакета.

### 4. Проверить публикацию

После успешной публикации пакет будет доступен по адресу:
https://www.npmjs.com/package/surrealdb-orm

## Использование после публикации

Пользователи смогут установить пакет командой:

```bash
npm install surrealdb-orm
```

И использовать в своем коде:

```typescript
import {
	SurrealRPC,
	createORM,
	SimpleFuture,
	SimpleLogger,
} from 'surrealdb-orm';

// Создание подключения
const rpc = new SurrealRPC({
	env: {
		rpc: 'ws://localhost:3603/rpc',
		namespace: 'test',
		database: 'test_db',
		user: 'root',
		pass: 'password',
	},
	future: new SimpleFuture(),
	logger: new SimpleLogger(),
});

await rpc.open();

// Создание ORM с типизированной схемой
const orm = createORM(rpc, schema);
```

## Обновление версии

Для обновления пакета:

1. Измените версию в `package.json`
2. Обновите `CHANGELOG.md` (если есть)
3. Запустите `npm run build`
4. Опубликуйте: `npm publish --access public`

## Структура пакета

```
surrealdb-orm/
├── dist/                 # Собранные файлы
│   ├── index.js         # Основной файл
│   ├── index.d.ts       # Типы TypeScript
│   ├── rpc.js           # RPC клиент
│   ├── orm.js           # ORM функциональность
│   ├── helpers.js       # Утилиты и типы
│   └── ...              # Остальные модули
├── README.md            # Документация
└── package.json         # Метаданные пакета
```

Пакет готов к публикации! 🚀
