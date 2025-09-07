import { describe, it, expect } from "vitest";
import { SurrealORM } from "../orm.js";

class MockRPC {
	logs: any[] = [];
	async query(sql: string) {
		this.logs.push(sql);
		if (sql === "INFO FOR DB") {
			return [{ result: { tables: { user: {}, post: {} } } }];
		}
		if (sql === "INFO FOR TABLE user STRUCTURE") {
			return [
				{
					result: {
						fields: [
							{ name: "name", type: "string" },
							{ name: "age", type: "number" },
						],
					},
				},
			];
		}
		if (sql === "INFO FOR TABLE post STRUCTURE") {
			return [
				{
					result: {
						fields: [
							{ name: "title", type: "string" },
							{ name: "author", type: "record<user>" },
							{ name: "profile.city", type: "string" },
							{ name: "profile.addr.street", type: "string" },
							{ name: "metrics.*.score", type: "number" },
						],
						indexes: {
							uniq_title: { sql: "DEFINE INDEX uniq_title ON TABLE post FIELDS title UNIQUE;" },
							search_body: { sql: "DEFINE INDEX search_body ON TABLE post FIELDS body SEARCH ANALYZER english BM25(1.2, 0.75) HIGHLIGHTS;" },
						},
						permissions: { select: "NONE", create: "FULL" },
					},
				},
			];
		}
		return [{ result: {} }];
	}
}

describe("Introspection", () => {
	it("infoDB and introspectDatabase build schema", async () => {
		const rpc = new MockRPC() as any;
		const orm = new SurrealORM(rpc, {} as any);
		const db = await orm.infoDB();
		expect(db.tables).toBeTruthy();
		const schema = await orm.introspectDatabase();
		expect(Object.keys(schema)).toEqual(["user", "post"]);
		expect(schema.user.fields.name.type).toBe("string");
		expect(schema.user.fields.age.type).toBe("number");
		expect(schema.post.fields.author.type).toBe("record");
		expect(schema.post.fields.author.references).toBe("user");
		expect(schema.post.indexes?.[0].unique).toBe(true);
		// nested reconstruction
		expect((schema.post.fields.profile as any).type).toBe("object");
		expect((schema.post.fields.profile as any).properties.city.type).toBe("string");
		expect((schema.post.fields.profile as any).properties.addr.properties.street.type).toBe("string");
		expect((schema.post.fields.metrics as any).type).toBe("array");
		expect(((schema.post.fields.metrics as any).arrayOf.object.properties.score as any).type).toBe("number");
		// permissions object
		expect(schema.post.permissions && typeof schema.post.permissions === "object").toBe(true);
		// search index parsed
		const search = schema.post.indexes?.find((i) => i.name === undefined || (i as any).name === undefined || (i as any).search) as any;
		expect(search?.search?.analyzer).toBe("english");
		expect(search?.search?.bm25?.k1).toBe(1.2);
		expect(search?.search?.bm25?.b).toBe(0.75);
		expect(search?.search?.highlights).toBe(true);
	});
});
