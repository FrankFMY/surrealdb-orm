#!/usr/bin/env -S node --enable-source-maps
import { readFileSync } from "node:fs";
import { SurrealRPC } from "./rpc.js";
import { createORM } from "./orm.js";

function banner(msg: string) {
	console.log("\n=== " + msg + " ===\n");
}

type DetailedItem = {
	kind: "table" | "field" | "index" | "event" | "other";
	table?: string;
	name?: string;
	action: "create" | "overwrite" | "alter" | "define" | "drop";
	aspects?: string[];
	sql?: string;
};

function splitStatements(sql: string): string[] {
	return sql
		.split(/;\s*\n?/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => s + ";");
}

function analyzeStatement(stmt: string): DetailedItem {
	const s = stmt.trim();
	const up = s.toUpperCase();
	const aspects: string[] = [];
	const action: DetailedItem["action"] = up.includes(" OVERWRITE ")
		? "overwrite"
		: up.startsWith("ALTER TABLE")
			? "alter"
			: up.includes(" IF NOT EXISTS ")
				? "create"
				: "define";

	// ALTER TABLE
	let m = s.match(/^ALTER\s+TABLE\s+(\w+)\s+(.+);?$/i);
	if (m) {
		const rest = m[2];
		if (/\bSCHEMAFULL\b/i.test(rest)) aspects.push("schemafull");
		if (/\bSCHEMALESS\b/i.test(rest)) aspects.push("schemaless");
		if (/\bPERMISSIONS\b/i.test(rest)) aspects.push("permissions");
		if (/\bCOMMENT\b/i.test(rest)) aspects.push("comment");
		return { kind: "table", table: m[1], action, aspects, sql: s };
	}

	// DEFINE FIELD ... ON TABLE ...
	m = s.match(/^DEFINE\s+FIELD\s+(?:OVERWRITE|IF NOT EXISTS\s+)?(\w+)\s+ON\s+(?:TABLE\s+)?(\w+)\s+(.+);?$/i);
	if (m) {
		const rest = m[3];
		if (/\bTYPE\b/i.test(rest)) aspects.push("type");
		if (/\bDEFAULT\s+ALWAYS\b/i.test(rest)) aspects.push("defaultAlways");
		else if (/\bDEFAULT\b/i.test(rest)) aspects.push("default");
		if (/\bVALUE\b/i.test(rest)) aspects.push("value");
		if (/\bREADONLY\b/i.test(rest)) aspects.push("readonly");
		if (/\bASSERT\b/i.test(rest)) aspects.push("assert");
		if (/\bPERMISSIONS\b/i.test(rest)) aspects.push("permissions");
		if (/REFERENCE\s+ON\s+DELETE/i.test(rest)) aspects.push("reference.onDelete");
		return { kind: "field", table: m[2], name: m[1], action, aspects, sql: s };
	}

	// DEFINE INDEX ... ON TABLE ... FIELDS ... [UNIQUE]
	m = s.match(/^DEFINE\s+INDEX\s+(?:OVERWRITE|IF NOT EXISTS\s+)?(\w+)\s+ON\s+(?:TABLE\s+)?(\w+)\s+(.+);?$/i);
	if (m) {
		const rest = m[3];
		if (/\bFIELDS\b/i.test(rest)) aspects.push("fields");
		if (/\bUNIQUE\b/i.test(rest)) aspects.push("unique");
		if (/\bSEARCH\s+ANALYZER\b/i.test(rest)) aspects.push("search");
		return { kind: "index", table: m[2], name: m[1], action, aspects, sql: s };
	}

	// DEFINE EVENT ... ON TABLE ...
	m = s.match(/^DEFINE\s+EVENT\s+(?:OVERWRITE|IF NOT EXISTS\s+)?(\w+)\s+ON\s+(?:TABLE\s+)?(\w+)\s+/i);
	if (m) {
		if (/\bWHEN\b/i.test(s)) aspects.push("when");
		if (/\bTHEN\b/i.test(s)) aspects.push("then");
		return { kind: "event", table: m[2], name: m[1], action, aspects, sql: s };
	}

	return { kind: "other", action, sql: s } as DetailedItem;
}

function analyze(sql: string) {
	const stmts = splitStatements(sql);
	const items = stmts.map(analyzeStatement);
	const groups: Record<string, DetailedItem[]> = { tables: [], fields: [], indexes: [], events: [], alters: [], other: [] };
	for (const it of items) {
		switch (it.kind) {
			case "table":
				if (it.action === "alter") groups.alters.push(it);
				else groups.tables.push(it);
				break;
			case "field":
				groups.fields.push(it);
				break;
			case "index":
				groups.indexes.push(it);
				break;
			case "event":
				groups.events.push(it);
				break;
			default:
				groups.other.push(it);
		}
	}
	return { total: stmts.length, items, groups };
}

async function planDestructive(rpc: any, schema: any) {
	const droppables: DetailedItem[] = [];
	// live tables
	const dbRes = await rpc.query("INFO FOR DB");
	const db = dbRes?.[0]?.result || {};
	const liveTables = Array.isArray(db.tables) ? db.tables : db.tables ? Object.keys(db.tables) : [];
	const schemaTables = Object.keys(schema || {});
	// tables to drop
	for (const t of liveTables) {
		if (!schemaTables.includes(t)) droppables.push({ kind: "table", table: t, action: "drop" });
	}
	// fields/indexes/events
	for (const t of liveTables) {
		const res = await rpc.query(`INFO FOR TABLE ${t}`);
		const info = res?.[0]?.result || {};
		const sTable = schema[t];
		if (!sTable) continue;
		const sFields = Object.keys(sTable.fields || {});
		const sIndexes = new Set((sTable.indexes || []).map((i: any) => i.name));
		const sEvents = new Set([...(sTable.constraints || []).map((c: any) => c.name), ...(sTable.triggers || []).map((c: any) => c.name)]);
		// fields
		for (const fname of Object.keys(info.fields || {})) {
			if (!sFields.includes(fname)) droppables.push({ kind: "field", table: t, name: fname, action: "drop" });
		}
		// indexes
		for (const iname of Object.keys(info.indexes || {})) {
			if (!sIndexes.has(iname)) {
				const sql = info.indexes[iname]?.sql || "";
				const aspects: string[] = [];
				if (/\bSEARCH\s+ANALYZER\b/i.test(sql)) aspects.push("search");
				droppables.push({ kind: "index", table: t, name: iname, action: "drop", aspects });
			}
		}
		// events
		for (const ename of Object.keys(info.events || {})) {
			if (!sEvents.has(ename)) droppables.push({ kind: "event", table: t, name: ename, action: "drop" });
		}
	}
	return droppables;
}

async function main() {
	const args = process.argv.slice(2);
	const action = args[0] || "plan"; // plan | apply
	const json = args.includes("--json");
	const detail = args.includes("--detail");
	const destructive = args.includes("--destructive");
	const schemaArgIdx = args.findIndex((a) => a === "--schema");
	const schemaPath = schemaArgIdx >= 0 ? args[schemaArgIdx + 1] : undefined;
	const NS = process.env.SURREAL_NS || "test";
	const DB = process.env.SURREAL_DB || "test";
	const USER = process.env.SURREAL_USER || "root";
	const PASS = process.env.SURREAL_PASS || "root";
	const RPC = process.env.SURREAL_RPC || "ws://127.0.0.1:8000/rpc";

	const rpc = new SurrealRPC({
		process: "MIGRATE",
		isSERVER: false,
		future: { run: () => {}, clear: () => {} } as any,
		logger: { debug: () => {}, error: console.error, good: () => {} } as any,
		env: { rpc: RPC, namespace: NS, database: DB, user: USER, pass: PASS } as any,
	});
	await rpc.open();

	const schema = schemaPath ? JSON.parse(readFileSync(schemaPath, "utf8")) : {};
	const orm = createORM(rpc as any, schema as any);

	if (action === "plan") {
		const sql = await orm.planDiff();
		const analyzed = sql.trim() ? analyze(sql) : { total: 0, items: [], groups: {} as any };
		let drops: DetailedItem[] = [];
		if (destructive) drops = await planDestructive(rpc, schema);
		const summary = {
			total: analyzed.total || 0,
			tables: (analyzed as any).groups?.tables?.length || 0,
			fields: (analyzed as any).groups?.fields?.length || 0,
			indexes: (analyzed as any).groups?.indexes?.length || 0,
			events: (analyzed as any).groups?.events?.length || 0,
			alters: (analyzed as any).groups?.alters?.length || 0,
			destructive: drops.length,
		};

		if (json) {
			console.log(JSON.stringify({ ...analyzed, destructive: drops, summary }, null, 2));
			process.exit(summary.total > 0 || summary.destructive > 0 ? 1 : 0);
		} else if (detail) {
			banner("Plan (detailed)");
			console.log(
				`Summary: total=${summary.total}, tables=${summary.tables}, fields=${summary.fields}, indexes=${summary.indexes}, events=${summary.events}, alters=${summary.alters}, destructive=${summary.destructive}`
			);
			console.log(`\nTotal statements: ${analyzed.total}`);
			for (const [group, arr] of Object.entries((analyzed as any).groups || {})) {
				console.log(`\n# ${group} (${(arr as any[]).length})`);
				for (const it of arr as any[]) {
					const head = [it.table, it.name].filter(Boolean).join(".");
					const aspects = it.aspects?.length ? ` [${it.aspects.join(", ")}]` : "";
					console.log(`- ${it.action} ${it.kind}${head ? " " + head : ""}${aspects}`);
					console.log(`  ${it.sql}`);
				}
			}
			if (destructive) {
				console.log(`\n# destructive (${drops.length})`);
				for (const d of drops) {
					const head = [d.table, d.name].filter(Boolean).join(".");
					const aspects = d.aspects?.length ? ` [${d.aspects.join(", ")}]` : "";
					console.log(`- drop ${d.kind} ${head}${aspects}`);
				}
			}
			process.exit(summary.total > 0 || summary.destructive > 0 ? 1 : 0);
		} else {
			if (sql.trim()) {
				banner("Plan");
				console.log(sql);
			} else {
				console.log("No diff to apply.");
			}
			if (destructive && drops.length) {
				banner("Destructive plan (no execution)");
				for (const d of drops) {
					const head = [d.table, d.name].filter(Boolean).join(".");
					const aspects = d.aspects?.length ? ` [${d.aspects.join(", ")}]` : "";
					console.log(`- drop ${d.kind} ${head}${aspects}`);
				}
			}
			process.exit(sql.trim() || drops.length ? 1 : 0);
		}
	}

	if (action === "apply") {
		const sql = await orm.planDiff();
		if (!sql.trim()) {
			if (json) console.log(JSON.stringify({ applied: 0 }, null, 2));
			else console.log("Nothing to apply.");
			process.exit(0);
		}
		await orm.applyDiff();
		if (json) console.log(JSON.stringify({ applied: true }, null, 2));
		else console.log("Applied successfully.");
		process.exit(0);
	}

	console.error("Unknown action. Use: plan | apply [--json] [--detail] [--schema schema.json] [--destructive]");
	process.exit(2);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
