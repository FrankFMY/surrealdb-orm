import type { DatabaseSchema } from "./orm.js";
import { createORM } from "./orm.js";
import type { SurrealRPC } from "./rpc.js";

/**
 * Пример схемы базы данных
 */
export const exampleSchema: DatabaseSchema = {
	users: {
		comment: "Пользователи системы",
		fields: {
			email: {
				type: "string",
				required: true,
				constraints: {
					"string::is::email": true,
				},
				comment: "Email пользователя",
			},
			nickname: {
				type: "string",
				required: true,
				constraints: {
					"string::len": [3, 50],
				},
				comment: "Никнейм пользователя",
			},
			age: {
				type: "number",
				required: false,
				constraints: {
					"number::min": 0,
					"number::max": 150,
				},
				comment: "Возраст пользователя",
			},
			isActive: {
				type: "bool",
				required: true,
				default: true,
				comment: "Активен ли пользователь",
			},
			profile: {
				type: "object",
				required: false,
				comment: "Дополнительная информация о пользователе",
			},
			createdAt: {
				type: "datetime",
				required: true,
				comment: "Дата создания",
			},
		},
		indexes: [
			{
				name: "idx_email",
				fields: ["email"],
				unique: true,
			},
			{
				name: "idx_nickname",
				fields: ["nickname"],
				unique: true,
			},
		],
		triggers: [
			{
				name: "set_created_at",
				event: "CREATE",
				expression: "$value.createdAt = time::now()",
			},
		],
	},

	posts: {
		comment: "Посты пользователей",
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
			tags: {
				type: "array",
				required: false,
				comment: "Теги поста",
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

	categories: {
		comment: "Категории постов",
		fields: {
			name: {
				type: "string",
				required: true,
				constraints: {
					"string::len": [1, 100],
				},
				comment: "Название категории",
			},
			description: {
				type: "string",
				required: false,
				comment: "Описание категории",
			},
			parent: {
				type: "record",
				required: false,
				references: "categories",
				comment: "Родительская категория",
			},
		},
		indexes: [
			{
				name: "idx_name",
				fields: ["name"],
				unique: true,
			},
			{
				name: "idx_parent",
				fields: ["parent"],
			},
		],
	},
};

/**
 * Пример использования ORM
 */
export async function exampleUsage(rpc: SurrealRPC<any>) {
	// Создаем ORM
	const orm = createORM(rpc, exampleSchema);

	// Синхронизируем схему с базой данных
	await orm.sync();

	// Работаем с таблицей пользователей
	const usersTable = orm.table("users");

	// Создаем пользователя
	const user = await usersTable.createRecord({
		email: "john@example.com",
		nickname: "john_doe",
		age: 25,
		isActive: true,
		profile: {
			bio: "Software developer",
			location: "Moscow",
		},
	});

	console.log("Created user:", user);

	// Находим пользователя по ID
	const foundUser = await usersTable.findById(user.id);
	console.log("Found user:", foundUser);

	// Обновляем пользователя
	const updatedUser = await usersTable.updateRecord(user.id, {
		age: 26,
		profile: {
			...user.profile,
			bio: "Senior Software Developer",
		},
	});
	console.log("Updated user:", updatedUser);

	// Работаем с таблицей постов
	const postsTable = orm.table("posts");

	// Создаем пост
	const post = await postsTable.createRecord({
		title: "My First Post",
		content: "This is the content of my first post. It's quite long and meaningful.",
		author: user.id,
		tags: ["programming", "typescript", "surrealdb"],
		published: true,
	});

	console.log("Created post:", post);

	// Находим все посты
	const allPosts = await postsTable.findAll();
	console.log("All posts:", allPosts);

	// Работаем с категориями
	const categoriesTable = orm.table("categories");

	// Создаем категорию
	const category = await categoriesTable.createRecord({
		name: "Programming",
		description: "Posts about programming",
	});

	console.log("Created category:", category);

	// Создаем подкатегорию
	const subcategory = await categoriesTable.createRecord({
		name: "TypeScript",
		description: "Posts about TypeScript",
		parent: category.id,
	});

	console.log("Created subcategory:", subcategory);
}

/**
 * Пример более сложной схемы с отношениями
 */
export const complexSchema: DatabaseSchema = {
	companies: {
		comment: "Компании",
		fields: {
			name: {
				type: "string",
				required: true,
				comment: "Название компании",
			},
			inn: {
				type: "string",
				required: true,
				comment: "ИНН компании",
			},
			address: {
				type: "object",
				required: false,
				comment: "Адрес компании",
			},
		},
		indexes: [
			{
				name: "idx_inn",
				fields: ["inn"],
				unique: true,
			},
		],
	},

	employees: {
		comment: "Сотрудники",
		fields: {
			firstName: {
				type: "string",
				required: true,
				comment: "Имя",
			},
			lastName: {
				type: "string",
				required: true,
				comment: "Фамилия",
			},
			email: {
				type: "string",
				required: true,
				comment: "Email",
			},
			company: {
				type: "record",
				required: true,
				references: "companies",
				comment: "Компания",
			},
			position: {
				type: "string",
				required: true,
				comment: "Должность",
			},
			salary: {
				type: "number",
				required: false,
				comment: "Зарплата",
			},
		},
		indexes: [
			{
				name: "idx_email",
				fields: ["email"],
				unique: true,
			},
			{
				name: "idx_company",
				fields: ["company"],
			},
		],
	},

	projects: {
		comment: "Проекты",
		fields: {
			name: {
				type: "string",
				required: true,
				comment: "Название проекта",
			},
			description: {
				type: "string",
				required: false,
				comment: "Описание проекта",
			},
			company: {
				type: "record",
				required: true,
				references: "companies",
				comment: "Компания-заказчик",
			},
			manager: {
				type: "record",
				required: true,
				references: "employees",
				comment: "Менеджер проекта",
			},
			status: {
				type: "string",
				required: true,
				default: "planning",
				comment: "Статус проекта",
			},
			budget: {
				type: "number",
				required: false,
				comment: "Бюджет проекта",
			},
		},
		indexes: [
			{
				name: "idx_company",
				fields: ["company"],
			},
			{
				name: "idx_manager",
				fields: ["manager"],
			},
			{
				name: "idx_status",
				fields: ["status"],
			},
		],
		constraints: [
			{
				name: "check_status",
				expression: "$value.status IN ['planning', 'active', 'completed', 'cancelled']",
			},
		],
	},

	project_assignments: {
		comment: "Назначения сотрудников на проекты",
		fields: {
			project: {
				type: "record",
				required: true,
				references: "projects",
				comment: "Проект",
			},
			employee: {
				type: "record",
				required: true,
				references: "employees",
				comment: "Сотрудник",
			},
			role: {
				type: "string",
				required: true,
				comment: "Роль в проекте",
			},
			hoursPerWeek: {
				type: "number",
				required: true,
				comment: "Часов в неделю",
			},
		},
		indexes: [
			{
				name: "idx_project",
				fields: ["project"],
			},
			{
				name: "idx_employee",
				fields: ["employee"],
			},
			{
				name: "idx_project_employee",
				fields: ["project", "employee"],
				unique: true,
			},
		],
	},
};
