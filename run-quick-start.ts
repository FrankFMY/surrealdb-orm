#!/usr/bin/env tsx

/**
 * Запуск быстрого старта SurrealDB ORM
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runQuickStart() {
	try {
		console.log("🚀 Запуск быстрого старта SurrealDB ORM...");

		const { stdout, stderr } = await execAsync("tsx quick-start.ts", {
			cwd: process.cwd(),
		});

		if (stdout) {
			console.log(stdout);
		}

		if (stderr) {
			console.error(stderr);
		}
	} catch (error) {
		console.error("❌ Ошибка при запуске быстрого старта:", error);
		process.exit(1);
	}
}

runQuickStart();
