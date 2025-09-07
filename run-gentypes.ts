#!/usr/bin/env -S node --enable-source-maps
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { SurrealRPC } from "./rpc.js";
import { createORM } from "./orm.js";
import { schemaToTypes } from "./types-gen.js";

async function main() {
	const args = process.argv.slice(2);
	const NS = process.env.SURREAL_NS || "test";
	const DB = process.env.SURREAL_DB || "test";
	const USER = process.env.SURREAL_USER || "root";
	const PASS = process.env.SURREAL_PASS || "root";
	const RPC = process.env.SURREAL_RPC || "ws://127.0.0.1:8000/rpc";
	const outIdx = args.findIndex((a) => a === "--out");
	const outfile = outIdx >= 0 ? args[outIdx + 1] : undefined;
	const nsIdx = args.findIndex((a) => a === "--namespace");
	const namespace = nsIdx >= 0 ? args[nsIdx + 1] : "DB";
	const asJson = args.includes("--json");
	const plainIdx = args.findIndex((a) => a === "--plain" || a === "--plain-namespace");
	const plainNamespace = plainIdx >= 0 ? args[plainIdx + 1] : "Plain";
	const expand = args.includes("--expand-records");

	const rpc = new SurrealRPC({
		process: "GEN-TYPES",
		isSERVER: false,
		future: { run: () => {}, clear: () => {} } as any,
		logger: { debug: () => {}, error: console.error, good: () => {} } as any,
		env: { rpc: RPC, namespace: NS, database: DB, user: USER, pass: PASS } as any,
	});
	await rpc.open();
	const orm = createORM(rpc as any, {} as any);
	const schema = await orm.introspectDatabase();

	if (asJson) {
		const payload = JSON.stringify(schema, null, 2);
		if (outfile) {
			const p = resolve(process.cwd(), outfile);
			const ws = createWriteStream(p);
			ws.end(payload);
			console.log(`Schema JSON written to ${p}`);
		} else {
			console.log(payload);
		}
		process.exit(0);
	}

	const code = schemaToTypes(schema, { namespace, plainNamespace, expandRecords: expand });
	if (outfile) {
		const p = resolve(process.cwd(), outfile);
		const ws = createWriteStream(p);
		ws.end(code);
		console.log(`Types written to ${p}`);
	} else {
		console.log(code);
	}
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
