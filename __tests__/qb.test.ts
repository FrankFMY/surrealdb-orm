import { describe, it, expect } from "vitest";
import { Table, TableQuery } from "../orm.js";

class MockRPC {
	logs: any[] = [];
	async query(sql: string, vars?: Record<string, unknown>) {
		this.logs.push({ sql, vars });
		return [{ result: [] }];
	}
}

describe("Query Builder", () => {
	it("builds SQL and executes", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "posts", { fields: { title: { type: "string" } } as any });
		const rows = await table.query().where("published = $p", { p: true }).orderBy("title", "DESC").limit(10).start(0).fetch(["author"]).exec();
		expect(Array.isArray(rows)).toBe(true);
		const last = (rpc as any).logs[(rpc as any).logs.length - 1];
		expect(last.sql).toContain("SELECT * FROM type::table($table) WHERE published = $p ORDER BY title DESC LIMIT 10 START 0 FETCH author");
		expect(last.vars.table).toBe("posts");
	});

	it("supports select/omit/value", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "posts", { fields: { title: { type: "string" }, secret: { type: "string" } } as any });
		const qb1 = table.query().select(["title", "secret"]).omit(["secret"]).where("published = true");
		const sql1 = qb1.toSQL().sql;
		expect(sql1).toContain("SELECT title, secret OMIT secret FROM type::table($table) WHERE published = true");
		const qb2 = table.query().value("title").where("published = true");
		const sql2 = qb2.toSQL().sql;
		expect(sql2).toContain("SELECT VALUE title FROM type::table($table) WHERE published = true");
	});

	it("supports distinct/groupBy/split and first/execValue/firstValue", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "posts", { fields: { title: { type: "string" }, tag: { type: "string" } } as any });
		const qb = table
			.query()
			.select(["title", "count() as c"]) // агрегатный пример
			.distinct()
			.groupBy(["title"])
			.split("tag")
			.where("published = true")
			.orderBy("c", "DESC")
			.limit(5)
			.start(0);
		const { sql } = qb.toSQL();
		expect(sql).toContain(
			"SELECT DISTINCT title, count() as c FROM type::table($table) SPLIT tag WHERE published = true GROUP BY title ORDER BY c DESC LIMIT 5 START 0"
		);

		const first = await qb.first();
		expect(first === null || typeof first === "object").toBe(true);

		const qbVal = table.query().value("title").where("published = true");
		const { sql: sqlVal } = qbVal.toSQL();
		expect(sqlVal).toContain("SELECT VALUE title FROM type::table($table) WHERE published = true");
		const values = await qbVal.execValue<string>();
		expect(Array.isArray(values)).toBe(true);
		const firstValue = await qbVal.firstValue<string>();
		expect(firstValue === null || typeof firstValue === "string").toBe(true);
	});

	it("supports WITH INDEX/NOINDEX, ONLY, VERSION, TIMEOUT, PARALLEL", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "posts", { fields: { title: { type: "string" } } as any });
		const q1 = table.query().withIndexes(["ft_title"]).only().version("time::now()").timeout("5s").parallel();
		const sql1 = q1.toSQL().sql;
		expect(sql1).toContain("SELECT * FROM ONLY type::table($table) WITH INDEX ft_title VERSION time::now() TIMEOUT 5s PARALLEL");
		const q2 = table.query().withNoIndex().where("published = true");
		const sql2 = q2.toSQL().sql;
		expect(sql2).toContain("WITH NOINDEX WHERE published = true");
	});

	it("supports ORDER BY RAND / NUMERIC / COLLATE and EXPLAIN", async () => {
		const rpc = new MockRPC() as any;
		const table = new Table(rpc, "posts", { fields: { title: { type: "string" } } as any });
		const q1 = table.query().orderByRand().explain();
		const sql1 = q1.toSQL().sql;
		expect(sql1).toContain("ORDER BY RAND() EXPLAIN");
		const q2 = table.query().orderByWith("title", { numeric: true, collate: true, dir: "ASC" }).explainFull();
		const sql2 = q2.toSQL().sql;
		expect(sql2).toContain("ORDER BY title COLLATE NUMERIC ASC EXPLAIN FULL");
	});
});
