#!/usr/bin/env tsx

/**
 * Быстрый старт с SurrealDB ORM
 *
 * Этот файл демонстрирует основные возможности ORM:
 * - Определение схемы базы данных
 * - Создание таблиц
 * - CRUD операции
 * - Работа с отношениями
 */

import { SurrealRPC } from "./rpc.js";
import { createORM } from "./orm.js";
import type { DatabaseSchema } from "./orm.js";
import type { SurrealENV } from "./types.js";

// Определяем простую схему для блога
const blogSchema: DatabaseSchema = {
	users: {
		comment: "Пользователи блога",
		fields: {
			username: {
				type: "string",
				required: true,
				constraints: {
					"string::len": [3, 20],
				},
				comment: "Имя пользователя",
			},
			email: {
				type: "string",
				required: true,
				constraints: {
					"string::is::email": true,
				},
				comment: "Email пользователя",
			},
			bio: {
				type: "string",
				required: false,
				comment: "Краткая биография",
			},
		},
		indexes: [
			{
				name: "idx_username",
				fields: ["username"],
				unique: true,
			},
			{
				name: "idx_email",
				fields: ["email"],
				unique: true,
			},
		],
	},

	posts: {
		comment: "Посты блога",
		fields: {
			title: {
				type: "string",
				required: true,
				constraints: {
					"string::len": [1, 200],
				},
				comment: "Заголовок поста",
			},
			content: {
				type: "string",
				required: true,
				comment: "Содержимое поста",
			},
			author: {
				type: "record",
				required: true,
				references: "users",
				comment: "Автор поста",
			},
			published: {
				type: "bool",
				required: true,
				default: false,
				comment: "Опубликован ли пост",
			},
		},
		indexes: [
			{
				name: "idx_author",
				fields: ["author"],
			},
			{
				name: "idx_published",
				fields: ["published"],
			},
		],
		constraints: [
			{
				name: "check_content_length",
				expression: "string::len($value.content) > 10",
			},
		],
	},

	comments: {
		comment: "Комментарии к постам",
		fields: {
			content: {
				type: "string",
				required: true,
				comment: "Текст комментария",
			},
			post: {
				type: "record",
				required: true,
				references: "posts",
				comment: "Пост, к которому относится комментарий",
			},
			author: {
				type: "record",
				required: true,
				references: "users",
				comment: "Автор комментария",
			},
		},
		indexes: [
			{
				name: "idx_post",
				fields: ["post"],
			},
			{
				name: "idx_author",
				fields: ["author"],
			},
		],
	},
};

async function quickStart() {
	console.log("🚀 Запуск быстрого старта SurrealDB ORM...");
	console.log("📁 Текущая директория:", process.cwd());

	// Конфигурация подключения
	const env: SurrealENV = {
		rpc: "ws://localhost:3603/rpc",
		namespace: "blog",
		database: "blog_db",
		user: "root",
		pass: "q43uxrUDbNUcIxp5WhUmdCLuwRzBZ807",
	};

	console.log("🔧 Конфигурация:", env);

	// Создаем простые моки для тестирования
	const future = {
		run: (fn: any, options: any) => {
			if (options?.type === "interval") {
				return setInterval(fn, 5000);
			}
			return setTimeout(fn, 0);
		},
		clear: (type: any, key: any) => {
			if (type === "interval") {
				clearInterval(key);
			} else {
				clearTimeout(key);
			}
		},
		delay: 0,
		timers: new Map(),
		intervals: new Map(),
		get: (type: any, key: any) => null,
		reset: () => {},
	} as any;

	// Создаем подключение к базе
	const rpc = new SurrealRPC({
		env,
		future,
		logger: {
			print: (caller: any, message: any) => console.log(`[${caller}]`, message),
			debug: (caller: any, message: any) => console.log(`[DEBUG] ${caller}`, message),
			info: (caller: any, message: any) => console.log(`[INFO] ${caller}`, message),
			warn: (caller: any, message: any) => console.log(`[WARN] ${caller}`, message),
			error: (caller: any, message: any) => console.log(`[ERROR] ${caller}`, message),
			good: (caller: any, message: any) => console.log(`[SUCCESS] ${caller}`, message),
			log: (caller: any, message: any) => console.log(`[LOG] ${caller}`, message),
			throw: (caller: any, message: any) => {
				throw new Error(`[${caller}] ${message}`);
			},
			load: (caller: any, message: any) => console.log(`[LOAD] ${caller}`, message),
			redirect: () => {},
			balance: () => {},
		} as any,
	});

	try {
		// Подключаемся к базе
		await rpc.open();
		console.log("✅ Подключение к SurrealDB установлено");

		// Создаем ORM
		const orm = createORM(rpc, blogSchema);
		console.log("✅ ORM создан");

		// Синхронизируем схему
		await orm.sync();
		console.log("✅ Схема синхронизирована");

		// Работаем с пользователями
		const usersTable = orm.table("users");

		// Создаем пользователя
		const user = await usersTable.createRecord({
			username: "john_doe",
			email: "john@example.com",
			bio: "Любитель программирования и кофе",
		});
		console.log("✅ Пользователь создан:", user);

		// Работаем с постами
		const postsTable = orm.table("posts");

		// Создаем пост
		const post = await postsTable.createRecord({
			title: "Мой первый пост",
			content: "Это мой первый пост в блоге. Здесь я расскажу о своих впечатлениях от изучения SurrealDB и создания ORM.",
			author: user.id,
			published: true,
		});
		console.log("✅ Пост создан:", post);

		// Работаем с комментариями
		const commentsTable = orm.table("comments");

		// Создаем комментарий
		const comment = await commentsTable.createRecord({
			content: "Отличный пост! Очень интересно узнать о SurrealDB.",
			post: post.id,
			author: user.id,
		});
		console.log("✅ Комментарий создан:", comment);

		// Получаем все данные
		const allUsers = await usersTable.findAll();
		const allPosts = await postsTable.findAll();
		const allComments = await commentsTable.findAll();

		console.log("\n📊 Результаты:");
		console.log(`👥 Пользователей: ${allUsers.length}`);
		console.log(`📝 Постов: ${allPosts.length}`);
		console.log(`💬 Комментариев: ${allComments.length}`);

		// Демонстрируем поиск
		const foundUser = await usersTable.findById(user.id);
		console.log("\n🔍 Найденный пользователь:", foundUser?.username);

		// Демонстрируем обновление
		const updatedPost = await postsTable.updateRecord(post.id, {
			title: "Мой первый пост (обновленный)",
		});
		console.log("✏️ Пост обновлен:", updatedPost?.title);

		console.log("\n🎉 Быстрый старт завершен успешно!");
	} catch (error) {
		console.error("❌ Ошибка при выполнении быстрого старта:", error);
	} finally {
		// Закрываем подключение
		try {
			(rpc as any).ws?.close();
		} catch (e) {
			// Игнорируем ошибки закрытия
		}
	}
}

// Запускаем быстрый старт
quickStart().catch(console.error);
