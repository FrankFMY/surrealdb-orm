import { describe, it, expect } from "vitest";
import { Table } from "../orm.js";

class MockRPC {
	logs: any[] = [];
	async query(sql: string, vars?: Record<string, unknown>) {
		this.logs.push({ sql, vars });
		return [{ result: [] }];
	}
}

describe("Table utils", () => {
	it("select/count/page/deleteWhere composes sql and vars", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "posts", { fields: { title: { type: "string" } } as any });
		await table.select({ where: "published = $p", vars: { p: true }, orderBy: "title", orderDir: "DESC", limit: 5, start: 10 });
		await table.count("published = $p", { p: true });
		await table.page({ where: "published = $p", vars: { p: true }, orderBy: "title", orderDir: "ASC", page: 0, pageSize: 2 });
		await table.deleteWhere("author = $a", { a: "users:1" });
		expect(rpc.logs.length).toBe(5);
		expect(rpc.logs[0].sql).toContain("SELECT * FROM type::table($table) WHERE published = $p ORDER BY title DESC LIMIT 5 START 10");
		expect(rpc.logs[1].sql).toContain("SELECT count() AS count FROM type::table($table) WHERE published = $p");
		expect(rpc.logs[4].sql).toContain("DELETE FROM type::table($table) WHERE author = $a RETURN NONE");
	});
});
