/**
 * Примеры использования SurrealDB ORM
 */

import { SurrealRPC, createORM, type DatabaseSchema } from './index.js';
import { SimpleFuture, SimpleLogger } from './helpers.js';

// Пример схемы базы данных
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
			profile: {
				type: 'object',
				required: false,
				properties: {
					bio: { type: 'string' },
					avatar: { type: 'string' },
				},
			},
			tags: {
				type: 'array',
				arrayOf: 'string',
				required: false,
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
	posts: {
		comment: 'Посты пользователей',
		fields: {
			title: {
				type: 'string',
				required: true,
				comment: 'Заголовок поста',
			},
			content: {
				type: 'string',
				required: true,
				comment: 'Содержимое поста',
			},
			author: {
				type: 'record',
				required: true,
				references: 'users',
			},
			published: {
				type: 'bool',
				required: true,
				default: false,
			},
			tags: {
				type: 'array',
				arrayOf: 'string',
				required: false,
			},
		},
		indexes: [
			{
				name: 'idx_author_published',
				fields: ['author', 'published'],
			},
			{
				name: 'search_content',
				fields: ['content'],
				search: {
					analyzer: 'english',
					bm25: { k1: 1.2, b: 0.75 },
					highlights: true,
				},
			},
		],
	},
};

// Пример использования
export async function example() {
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

	// Синхронизация схемы
	await orm.sync();

	// Работа с пользователями
	const usersTable = orm.table('users');

	// Создание пользователя
	const user = await usersTable.createRecord({
		email: 'john@example.com',
		nickname: 'john_doe',
		age: 25,
		profile: {
			bio: 'Software developer',
			avatar: 'https://example.com/avatar.jpg',
		},
		tags: ['developer', 'typescript'],
	});

	console.log('Создан пользователь:', user);

	// Поиск пользователя
	const foundUser = await usersTable.findById(user.id);
	console.log('Найден пользователь:', foundUser);

	// Обновление пользователя
	const updatedUser = await usersTable.updateRecord(user.id, {
		age: 26,
		profile: {
			bio: 'Senior Software Developer',
			avatar: 'https://example.com/new-avatar.jpg',
		},
	});
	console.log('Обновлен пользователь:', updatedUser);

	// Работа с постами
	const postsTable = orm.table('posts');

	// Создание поста
	const post = await postsTable.createRecord({
		title: 'Мой первый пост',
		content: 'Это содержимое моего первого поста в блоге.',
		author: user.id,
		published: true,
		tags: ['блог', 'первый пост'],
	});

	console.log('Создан пост:', post);

	// Поиск постов с условиями
	const publishedPosts = await postsTable.find('published = $published', {
		published: true,
	});
	console.log('Опубликованные посты:', publishedPosts);

	// Использование Query Builder
	const query = postsTable
		.query()
		.where('published = $published', { published: true })
		.orderBy('created', 'DESC')
		.limit(10);

	const recentPosts = await query.exec();
	console.log('Последние посты:', recentPosts);

	// Live queries
	const live = await orm.live('posts', {
		where: 'published = true',
		fetch: ['author'],
		onEvent: (evt) => {
			console.log('Live event:', evt.action, evt.result);
		},
	});

	// Графовые связи
	await orm.relate('wrote', user.id, post.id, {
		at: new Date().toISOString(),
	});

	// Транзакции
	await rpc.withTransaction(async () => {
		const newPost = await postsTable.createRecord({
			title: 'Пост в транзакции',
			content: 'Этот пост создан в транзакции.',
			author: user.id,
			published: false,
		});

		await postsTable.updateRecord(newPost.id, {
			published: true,
		});

		console.log('Пост создан и обновлен в транзакции:', newPost);
	});

	// Очистка
	await live.kill();
	live.unsubscribe();

	console.log('Пример завершен успешно!');
}

// Экспорт схемы для использования в других файлах
export { schema };
