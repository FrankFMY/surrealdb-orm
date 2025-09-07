import type { DatabaseSchema, FieldConfig, TableConfig } from "./orm.js";

export interface TypeGenOptions {
	namespace?: string;
	plainNamespace?: string;
	expandRecords?: boolean; // разворачивать record в Plain ссылку
}

function tsTypeFromField(field: FieldConfig, refs: { expand: boolean; plainNs: string }): string {
	switch (field.type) {
		case "string":
			return "string";
		case "number":
			return "number";
		case "bool":
			return "boolean";
		case "datetime":
			return "string";
		case "object": {
			const props = field.properties || {};
			const lines: string[] = ["{"];
			for (const [k, v] of Object.entries(props)) {
				const t = tsTypeFromField(v as any, refs);
				const optional = (v as any).required ? "" : "?";
				lines.push(`  ${k}${optional}: ${t};`);
			}
			lines.push("}");
			return lines.join("\n");
		}
		case "record": {
			const ref = field.references ?? "thing";
			if (refs.expand) return `${refs.plainNs}.${ref}`;
			return "`" + ref + ":${string}`";
		}
		case "array": {
			const a = field.arrayOf;
			if (!a) return "unknown[]";
			if (typeof a === "string") {
				if (a === "string") return "string[]";
				if (a === "number") return "number[]";
				if (a === "bool") return "boolean[]";
				if (a === "datetime") return "string[]";
				if (a === "object") return "Record<string, unknown>[]";
				return "unknown[]";
			}
			if ((a as any).record) {
				const ref = (a as any).record as string;
				if (refs.expand) return `(${refs.plainNs}.${ref})[]`;
				return "(`" + ref + ":${string}`)[]";
			}
			if ((a as any).object) {
				const obj = (a as any).object as { properties?: Record<string, FieldConfig> };
				const nested: FieldConfig = { type: "object", properties: obj.properties } as any;
				return `(${tsTypeFromField(nested, refs)})[]`;
			}
			return "unknown[]";
		}
		default:
			return "unknown";
	}
}

export function schemaToTypes(schema: DatabaseSchema, opts: TypeGenOptions = {}): string {
	const ns = opts.namespace ?? "DB";
	const plainNs = opts.plainNamespace ?? "Plain";
	const expand = !!opts.expandRecords;
	const lines: string[] = [];
	lines.push(`export type RecordId<T extends string> = \`${"${T}"}:${"${string}"}\`;`);
	lines.push(`export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;`);
	lines.push(`type WithoutKeys<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;`);
	lines.push(
		`type MarkOptionalIfNoRequired<T, M extends keyof T> = { [K in keyof T as K extends M ? never : K]: T[K] } & { [K in keyof T as K extends M ? K : never]?: T[K] };`
	);
	lines.push(`type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;`);
	lines.push(`export namespace ${ns} {`);
	for (const [tableName, table] of Object.entries<TableConfig>(schema as any)) {
		lines.push(`  export interface ${tableName} {`);
		lines.push("    id: `" + tableName + ":${string}`;");
		for (const [field, cfg] of Object.entries<FieldConfig>(table.fields)) {
			const t = tsTypeFromField(cfg, { expand: false, plainNs });
			const optional = cfg.required ? "" : "?";
			lines.push(`    ${field}${optional}: ${t};`);
		}
		lines.push(`  }`);
	}
	lines.push(`}`);

	// Plain namespace
	lines.push(`export namespace ${plainNs} {`);
	for (const [tableName, table] of Object.entries<TableConfig>(schema as any)) {
		lines.push(`  export interface ${tableName} {`);
		for (const [field, cfg] of Object.entries<FieldConfig>(table.fields)) {
			const t = tsTypeFromField(cfg, { expand, plainNs });
			const optional = cfg.required ? "" : "?";
			lines.push(`    ${field}${optional}: ${t};`);
		}
		lines.push(`  }`);
	}
	lines.push(`}`);

	// Input helpers per table: исключаем id, readonly, valueExpr; обязательность по required
	const shouldOmitField = (cfg: FieldConfig, fieldName: string): boolean => {
		if (fieldName === "id") return true;
		if ((cfg as any).readonly) return true;
		if ((cfg as any).valueExpr) return true;
		return false;
	};
	for (const [tableName, table] of Object.entries<TableConfig>(schema as any)) {
		const requiredKeys: string[] = [];
		const updatableKeys: string[] = [];
		for (const [field, cfg] of Object.entries<FieldConfig>(table.fields)) {
			if (shouldOmitField(cfg, field)) continue;
			updatableKeys.push(field);
			if ((cfg as any).required && (cfg as any).default === undefined) {
				requiredKeys.push(field);
			}
		}
		// Базируется на Plain.<table>, чтобы записи могли разворачиваться опционально
		lines.push(`export type CreateInput_${tableName} = {`);
		for (const [field, cfg] of Object.entries<FieldConfig>(table.fields)) {
			if (shouldOmitField(cfg, field)) continue;
			const t = tsTypeFromField(cfg, { expand, plainNs });
			const isRequired = (cfg as any).required && (cfg as any).default === undefined;
			const opt = isRequired ? "" : "?";
			lines.push(`  ${field}${opt}: ${t};`);
		}
		lines.push(`};`);
		lines.push(
			`export type UpdateInput_${tableName} = Partial<Pick<${plainNs}.${tableName}, ${updatableKeys.length ? updatableKeys.map((k) => `"${k}"`).join(" | ") : "never"}>>;`
		);
	}

	// Generic helpers
	lines.push(`export type CreateInput<T> = T;`);
	lines.push(`export type UpdateInput<T> = DeepPartial<T>;`);

	return lines.join("\n");
}
