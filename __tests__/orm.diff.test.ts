import { describe, it, expect } from "vitest";
import { Table } from "../orm.js";

class MockRPC {
	logs: string[] = [];
	async query(sql: string) {
		this.logs.push(sql);
		return [{ result: null }];
	}
}

describe("Diff plan", () => {
	it("planDiff returns missing definitions only", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "users", {
			fields: {
				email: { type: "string", required: true },
				age: { type: "number" },
			},
			indexes: [{ name: "idx_email", fields: ["email"], unique: true }],
		});
		// Mock getInfo to pretend email field exists, but idx and age missing
		(table as any).getInfo = async () => ({
			fields: { email: "DEFINE FIELD email" },
			indexes: {},
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE FIELD IF NOT EXISTS age ON TABLE users TYPE number");
		expect(sql).toContain("DEFINE INDEX IF NOT EXISTS idx_email ON TABLE users FIELDS email UNIQUE");
	});

	it("overwrites index and alters permissions/comment", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "user", {
			fields: { email: { type: "string" } },
			indexes: [{ name: "idx_email", fields: ["email"] }],
			permissions: { select: "where true" },
			comment: "Users table",
		} as any);
		(table as any).getInfo = async () => ({
			fields: { email: "DEFINE FIELD email ON TABLE user TYPE string" },
			indexes: { idx_email: { sql: "DEFINE INDEX idx_email ON TABLE user FIELDS name;" } },
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE FIELD OVERWRITE email ON TABLE user TYPE string;");
		expect(sql).toContain("DEFINE INDEX OVERWRITE idx_email ON TABLE user FIELDS email;");
		expect(sql).toContain('ALTER TABLE user PERMISSIONS FOR select where true COMMENT "Users table";');
	});

	it("overwrites SEARCH index when analyzer differs", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "posts", {
			fields: { title: { type: "string" } },
			indexes: [{ name: "ft_title", fields: ["title"], search: { analyzer: "ft_title2", bm25: { k1: 1.2, b: 0.75 }, highlights: true } }],
		} as any);
		(table as any).getInfo = async () => ({
			fields: { title: "DEFINE FIELD title ON TABLE posts TYPE string" },
			indexes: { ft_title: { sql: "DEFINE INDEX ft_title ON TABLE posts FIELDS title SEARCH ANALYZER ft_title BM25 (1.2, 0.75) HIGHLIGHTS;" } },
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE INDEX OVERWRITE ft_title ON TABLE posts FIELDS title SEARCH ANALYZER ft_title2 BM25 (1.2, 0.75) HIGHLIGHTS;");
	});

	it("overwrites field when DEFAULT changes", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "user", {
			fields: { email: { type: "string", default: "new@example.com" } },
		} as any);
		(table as any).getInfo = async () => ({
			fields: { email: "DEFINE FIELD email ON TABLE user TYPE string DEFAULT 'old@example.com'" },
			indexes: {},
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain('DEFINE FIELD OVERWRITE email ON TABLE user TYPE string DEFAULT "new@example.com";');
	});

	it("overwrites field when ASSERT differs", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "user", {
			fields: { email: { type: "string", constraints: { "string::is::email": true } } },
		} as any);
		(table as any).getInfo = async () => ({
			fields: { email: "DEFINE FIELD email ON TABLE user TYPE string" },
			indexes: {},
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE FIELD OVERWRITE email ON TABLE user TYPE string ASSERT string::is::email($value);");
	});

	it("overwrites field when PERMISSIONS differ", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "user", {
			fields: { email: { type: "string", permissions: { select: "where true" } } },
		} as any);
		(table as any).getInfo = async () => ({
			fields: { email: "DEFINE FIELD email ON TABLE user TYPE string" },
			indexes: {},
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE FIELD OVERWRITE email ON TABLE user TYPE string PERMISSIONS FOR select where true;");
	});

	it("overwrites field when VALUE expr differs", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "user", {
			fields: { slug: { type: "string", valueExpr: "string::lowercase($value)" } },
		} as any);
		(table as any).getInfo = async () => ({
			fields: { slug: "DEFINE FIELD slug ON TABLE user TYPE string" },
			indexes: {},
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE FIELD OVERWRITE slug ON TABLE user TYPE string VALUE string::lowercase($value);");
	});

	it("overwrites field when READONLY differs", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "user", {
			fields: { created_at: { type: "datetime", readonly: true } },
		} as any);
		(table as any).getInfo = async () => ({
			fields: { created_at: "DEFINE FIELD created_at ON TABLE user TYPE datetime" },
			indexes: {},
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE FIELD OVERWRITE created_at ON TABLE user TYPE datetime READONLY;");
	});

	it("overwrites field when REFERENCE ON DELETE differs", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "post", {
			fields: { author: { type: "record", references: "user", reference: { onDelete: "CASCADE" } } },
		} as any);
		(table as any).getInfo = async () => ({
			fields: { author: "DEFINE FIELD author ON TABLE post TYPE record<user>" },
			indexes: {},
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE FIELD OVERWRITE author ON TABLE post TYPE record<user> REFERENCE ON DELETE CASCADE;");
	});

	it("overwrites field when DEFAULT ALWAYS differs", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "user", {
			fields: { active: { type: "bool", default: true, defaultAlways: true } },
		} as any);
		(table as any).getInfo = async () => ({
			fields: { active: "DEFINE FIELD active ON TABLE user TYPE bool DEFAULT false" },
			indexes: {},
			events: {},
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain("DEFINE FIELD OVERWRITE active ON TABLE user TYPE bool DEFAULT ALWAYS true;");
	});

	it("does not alter table when schema/permissions/comment match", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "tb", {
			fields: { f: { type: "string" } },
			schema: "SCHEMALESS",
			permissions: { select: "x = true" },
			comment: "hello",
		} as any);
		(table as any).getInfo = async () => ({
			fields: { f: "DEFINE FIELD f ON TABLE tb TYPE string" },
			indexes: {},
			events: {},
			table: { schema: "SCHEMALESS", permissions: { select: "x = true" }, comment: "hello" },
		});
		const sql = await (table as any).planDiff();
		expect(sql).not.toContain("ALTER TABLE tb");
	});

	it("alters table when schema/permissions/comment differ", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "tb", {
			fields: { f: { type: "string" } },
			schema: "SCHEMAFULL",
			permissions: "FULL",
			comment: "new",
		} as any);
		(table as any).getInfo = async () => ({
			fields: { f: "DEFINE FIELD f ON TABLE tb TYPE string" },
			indexes: {},
			events: {},
			table: { schema: "SCHEMALESS", permissions: { select: "x = true" }, comment: "old" },
		});
		const sql = await (table as any).planDiff();
		expect(sql).toContain('ALTER TABLE tb SCHEMAFULL PERMISSIONS FULL COMMENT "new";');
	});
});
