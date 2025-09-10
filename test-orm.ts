import { SurrealRPC } from './rpc';
import { createORM } from './orm';
import { schema } from './examples';
import type { SurrealENV } from './types';

/**
 * Простой тест ORM
 */
export async function testORM() {
	// Конфигурация подключения к SurrealDB
	const env: SurrealENV = {
		rpc: 'ws://localhost:3603/rpc',
		namespace: 'test',
		database: 'test_db',
		user: 'root',
		pass: 'q43uxrUDbNUcIxp5WhUmdCLuwRzBZ807',
	};

	// Создаем простые моки для тестирования
	const future = {
		run: (
			fn: () => void | Promise<void>,
			options: {
				type: 'interval' | 'timeout';
				key: string;
				delay?: number;
			}
		) => {
			if (options.type === 'interval') {
				setInterval(fn, options.delay || 5000);
			} else {
				setTimeout(fn, options.delay || 0);
			}
		},
		clear: (type: 'interval' | 'timeout', key: string) => {
			if (type === 'interval') {
				clearInterval(parseInt(key));
			} else {
				clearTimeout(parseInt(key));
			}
		},
	};

	// Создаем подключение к базе
	const rpc = new SurrealRPC({
		env,
		future,
		logger: {
			debug: (
				caller: string | { module?: string; method?: string },
				message: unknown
			) => {
				const module =
					typeof caller === 'string' ? caller : (
						caller?.module || 'unknown'
					);
				const method =
					typeof caller === 'string' ? '' : caller?.method || '';
				console.log(
					`[DEBUG] ${module}${method ? `:${method}` : ''}`,
					message
				);
			},
			info: (
				caller: string | { module?: string; method?: string },
				message: unknown
			) => {
				const module =
					typeof caller === 'string' ? caller : (
						caller?.module || 'unknown'
					);
				const method =
					typeof caller === 'string' ? '' : caller?.method || '';
				console.log(
					`[INFO] ${module}${method ? `:${method}` : ''}`,
					message
				);
			},
			warn: (
				caller: string | { module?: string; method?: string },
				message: unknown
			) => {
				const module =
					typeof caller === 'string' ? caller : (
						caller?.module || 'unknown'
					);
				const method =
					typeof caller === 'string' ? '' : caller?.method || '';
				console.log(
					`[WARN] ${module}${method ? `:${method}` : ''}`,
					message
				);
			},
			error: (
				caller: string | { module?: string; method?: string },
				message: unknown
			) => {
				const module =
					typeof caller === 'string' ? caller : (
						caller?.module || 'unknown'
					);
				const method =
					typeof caller === 'string' ? '' : caller?.method || '';
				console.log(
					`[ERROR] ${module}${method ? `:${method}` : ''}`,
					message
				);
			},
			good: (
				caller: string | { module?: string; method?: string },
				message: unknown
			) => {
				const module =
					typeof caller === 'string' ? caller : (
						caller?.module || 'unknown'
					);
				const method =
					typeof caller === 'string' ? '' : caller?.method || '';
				console.log(
					`[SUCCESS] ${module}${method ? `:${method}` : ''}`,
					message
				);
			},
		},
	});

	try {
		// Подключаемся к базе
		await rpc.open();
		console.log('✅ Подключение к SurrealDB установлено');

		// Создаем ORM
		const orm = createORM(rpc, schema);
		console.log('✅ ORM создан');

		// Синхронизируем/мигрируем схему
		await orm.migrateMissing();
		console.log('✅ Схема синхронизирована');

		// Работаем с таблицей пользователей
		const usersTable = orm.table('users');

		// Создаем пользователя
		const user = await usersTable.createRecord({
			email: 'test@example.com',
			nickname: 'test_user',
			age: 25,
			isActive: true,
			profile: {
				bio: 'Test user',
				location: 'Test City',
			},
		});
		console.log('✅ Пользователь создан:', user);

		// Находим пользователя
		const foundUser = await usersTable.findById(user.id);
		console.log('✅ Пользователь найден:', foundUser);

		// Обновляем пользователя
		const updatedUser = await usersTable.updateRecord(user.id, {
			age: 26,
			profile: {
				...(user.profile as Record<string, unknown>),
				bio: 'Updated test user',
			},
		});
		console.log('✅ Пользователь обновлен:', updatedUser);

		// MERGE частичное обновление
		const mergedUser = await usersTable.mergeRecord(user.id, { age: 27 });
		console.log('✅ Пользователь merge:', mergedUser);

		// UPSERT (повторный вызов для существующего id)
		const upsertedUser = await usersTable.upsertRecord(user.id, {
			isActive: true,
		});
		console.log('✅ Пользователь upsert:', upsertedUser);

		// Работаем с постами
		const postsTable = orm.table('posts');

		// Создаем пост
		const post = await postsTable.createRecord({
			title: 'Test Post',
			content:
				'This is a test post with enough content to pass validation.',
			author: user.id,
			tags: ['test', 'orm', 'surrealdb'],
			published: true,
		});
		console.log('✅ Пост создан:', post);

		// Транзакция: создадим и удалим в одной сессии
		await rpc.withTransaction(async () => {
			const p2 = await postsTable.createRecord({
				title: 'Tx Post',
				content: 'Transactional content long enough...',
				author: user.id,
				published: false,
			});
			await postsTable.deleteRecord(p2.id);
		});

		// Live builder (быстрый пример)
		const live = await orm.live('posts', {
			where: 'published = true',
			onEvent: (evt) => console.log('🔔 live:', evt.action),
		});
		await rpc.kill(live.id);
		live.unsubscribe();

		// Пример связи: пост принадлежит пользователю (как отдельное ребро, если нужно)
		await orm.relate('wrote', user.id, post.id, {
			at: new Date().toISOString(),
		});

		// Удалим связь, чтобы проверить unrelate
		await orm.unrelate('wrote', user.id, post.id);

		// Находим все посты
		const allPosts = await postsTable.select({
			where: 'published = $pub',
			vars: { pub: true },
			orderBy: 'title',
			orderDir: 'ASC',
			limit: 10,
		});
		console.log('✅ Все посты:', allPosts);

		// Подсчёт и пагинация
		const totalPublished = await postsTable.count('published = $pub', {
			pub: true,
		});
		console.log('✅ Кол-во опубликованных:', totalPublished);
		const page1 = await postsTable.page({
			where: 'published = $pub',
			vars: { pub: true },
			orderBy: 'title',
			orderDir: 'ASC',
			page: 0,
			pageSize: 5,
		});
		console.log(
			'✅ Пагинация страница 1:',
			page1.items.length,
			'/',
			page1.total
		);

		// Очистим созданные посты из теста (пример deleteWhere)
		await postsTable.deleteWhere('author = $author', { author: user.id });

		console.log('🎉 Все тесты прошли успешно!');
	} catch (error) {
		console.error('❌ Ошибка при тестировании ORM:', error);
	} finally {
		// Закрываем подключение
		try {
			(rpc as unknown as { ws?: { close: () => void } }).ws?.close();
		} catch (e) {
			// Игнорируем ошибки закрытия
		}
	}
}

// Запускаем тест, если файл выполняется напрямую
if (typeof require !== 'undefined' && require.main === module) {
	testORM().catch(console.error);
}
