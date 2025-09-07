import { describe, it, expect } from "vitest";
import { Table } from "../orm.js";

class MockRPC {
	logs: string[] = [];
	async query(sql: string) {
		this.logs.push(sql);
		return [{ result: null }];
	}
}

describe("SQL generation", () => {
	it("generates DEFINE TABLE/FIELD/INDEX/EVENT", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "posts", {
			comment: "Посты",
			fields: {
				title: { type: "string", required: true, readonly: true },
				status: { type: "string", literals: ["planning", "active"] },
				published: { type: "bool", required: true, default: false, defaultAlways: true },
			},
			indexes: [
				{ name: "idx_title", fields: ["title"], unique: false },
				{ name: "ft_title", fields: ["title"], search: { analyzer: "ft_title", bm25: { k1: 1.2, b: 0.75 }, highlights: true } },
			],
			constraints: [{ name: "check_len", expression: "string::len($value.title) > 2" }],
		});

		await table.create();
		const sql = rpc.logs.join("\n");
		expect(sql).toContain("DEFINE TABLE IF NOT EXISTS posts SCHEMALESS");
		expect(sql).toContain("DEFINE FIELD IF NOT EXISTS title ON TABLE posts TYPE string ASSERT $value != NONE READONLY");
		expect(sql).toContain('DEFINE FIELD IF NOT EXISTS status ON TABLE posts TYPE string ASSERT $value IN ["planning", "active"]');
		expect(sql).toContain("DEFINE FIELD IF NOT EXISTS published ON TABLE posts TYPE bool ASSERT $value != NONE DEFAULT ALWAYS false");
		expect(sql).toContain("DEFINE INDEX IF NOT EXISTS idx_title ON TABLE posts FIELDS title");
		expect(sql).toContain("DEFINE INDEX IF NOT EXISTS ft_title ON TABLE posts FIELDS title SEARCH ANALYZER ft_title BM25 (1.2, 0.75) HIGHLIGHTS");
		expect(sql).toContain("DEFINE EVENT IF NOT EXISTS check_len ON TABLE posts");
	});
});
