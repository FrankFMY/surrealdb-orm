#!/usr/bin/env tsx

import { testORM } from "./test-orm.js";

console.log("🚀 Запуск теста SurrealDB ORM...");
console.log("Убедитесь, что SurrealDB запущен на ws://localhost:3603/rpc");

testORM()
	.then(() => {
		console.log("✅ Тест завершен успешно");
		process.exit(0);
	})
	.catch((error) => {
		console.error("❌ Тест завершился с ошибкой:", error);
		process.exit(1);
	});
