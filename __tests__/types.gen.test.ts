import { describe, it, expect } from "vitest";
import { schemaToTypes } from "../index.js";

describe("schemaToTypes", () => {
	it("generates TS for simple schema with nested objects and arrays", () => {
		const schema = {
			user: {
				fields: {
					name: { type: "string", required: true },
					age: { type: "number" },
					author: { type: "record", references: "user" },
					tags: { type: "array", arrayOf: "string" },
					links: { type: "array", arrayOf: { record: "post" } },
					profile: { type: "object", properties: { city: { type: "string" }, addr: { type: "object", properties: { street: { type: "string" } } } } },
					metrics: { type: "array", arrayOf: { object: { properties: { score: { type: "number" } } } } },
				},
			},
			post: {
				fields: {
					title: { type: "string", required: true },
				},
			},
		} as any;

		const code = schemaToTypes(schema, { namespace: "DB", plainNamespace: "Plain" });
		expect(code).toContain("export namespace DB");
		expect(code).toContain("export interface user");
		expect(code).toContain("name: string");
		expect(code).toContain("age?: number");
		expect(code).toContain("author?: `user:${string}`");
		expect(code).toContain("tags?: string[]");
		expect(code).toContain("links?: (`post:${string}`)[]");
		expect(code).toContain("profile?: {");
		expect(code).toContain("city?: string");
		expect(code).toContain("addr?: {");
		expect(code).toContain("street?: string");
		expect(code).toContain("metrics?: ({\n  score?: number;\n})[]");
		// Plain namespace exists
		expect(code).toContain("export namespace Plain");
	});
});
