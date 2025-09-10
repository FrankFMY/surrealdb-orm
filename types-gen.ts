import type { DatabaseSchema, FieldConfig, TableConfig } from './orm.js';

export interface TypeGenOptions {
	namespace?: string;
	plainNamespace?: string;
	expandRecords?: boolean; // разворачивать record в Plain ссылку
	excludeSystem?: boolean; // исключать системные поля из Create/Update
}

function tsTypeFromField(
	field: FieldConfig,
	refs: { expand: boolean; plainNs: string }
): string {
	switch (field.type) {
		case 'string':
			return 'string';
		case 'number':
			return 'number';
		case 'bool':
			return 'boolean';
		case 'datetime':
			return 'string';
		case 'object': {
			const props = field.properties || {};
			const lines: string[] = ['{'];
			for (const [k, v] of Object.entries(props)) {
				const fieldConfig = v as FieldConfig;
				const t = tsTypeFromField(fieldConfig, refs);
				const optional = fieldConfig.required ? '' : '?';
				lines.push(`  ${k}${optional}: ${t};`);
			}
			lines.push('}');
			return lines.join('\n');
		}
		case 'record': {
			const ref = field.references ?? 'thing';
			if (refs.expand) return `${refs.plainNs}.${ref}`;
			return '`' + ref + ':${string}`';
		}
		case 'array': {
			const a = field.arrayOf;
			if (!a) return 'unknown[]';
			if (typeof a === 'string') {
				if (a === 'string') return 'string[]';
				if (a === 'number') return 'number[]';
				if (a === 'bool') return 'boolean[]';
				if (a === 'datetime') return 'string[]';
				if (a === 'object') return 'Record<string, unknown>[]';
				return 'unknown[]';
			}
			if (typeof a === 'object' && a !== null && 'record' in a) {
				const ref = (a as { record: string }).record;
				if (refs.expand) return `(${refs.plainNs}.${ref})[]`;
				return '(`' + ref + ':${string}`)[]';
			}
			if (typeof a === 'object' && a !== null && 'object' in a) {
				const obj = (
					a as {
						object: { properties?: Record<string, FieldConfig> };
					}
				).object;
				const nested: FieldConfig = {
					type: 'object',
					properties: obj.properties,
				};
				return `(${tsTypeFromField(nested, refs)})[]`;
			}
			return 'unknown[]';
		}
		default:
			return 'unknown';
	}
}

export function schemaToTypes(
	schema: DatabaseSchema,
	opts: TypeGenOptions = {}
): string {
	const ns = opts.namespace ?? 'DB';
	const plainNs = opts.plainNamespace ?? 'Plain';
	const expand = !!opts.expandRecords;
	const lines: string[] = [];
	lines.push(
		`export type RecordId<T extends string> = \`${'${T}'}:${'${string}'}\`;`
	);
	lines.push(
		`export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;`
	);
	lines.push(
		`type WithoutKeys<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;`
	);
	lines.push(
		`type MarkOptionalIfNoRequired<T, M extends keyof T> = { [K in keyof T as K extends M ? never : K]: T[K] } & { [K in keyof T as K extends M ? K : never]?: T[K] };`
	);
	lines.push(
		`type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;`
	);
	lines.push(`export namespace ${ns} {`);
	for (const [tableName, table] of Object.entries<TableConfig>(schema)) {
		lines.push(`  export interface ${tableName} {`);
		lines.push('    id: `' + tableName + ':${string}`;');
		for (const [field, cfg] of Object.entries<FieldConfig>(table.fields)) {
			const t = tsTypeFromField(cfg, { expand: false, plainNs });
			const optional = cfg.required ? '' : '?';
			lines.push(`    ${field}${optional}: ${t};`);
		}
		lines.push(`  }`);
	}
	lines.push(`}`);

	// Plain namespace
	lines.push(`export namespace ${plainNs} {`);
	for (const [tableName, table] of Object.entries<TableConfig>(schema)) {
		lines.push(`  export interface ${tableName} {`);
		for (const [field, cfg] of Object.entries<FieldConfig>(table.fields)) {
			const t = tsTypeFromField(cfg, { expand, plainNs });
			const optional = cfg.required ? '' : '?';
			lines.push(`    ${field}${optional}: ${t};`);
		}
		lines.push(`  }`);
	}
	lines.push(`}`);

	// Input helpers per table: исключаем id, readonly, valueExpr; обязательность по required
	const shouldOmitField = (cfg: FieldConfig, fieldName: string): boolean => {
		const SYSTEM = new Set([
			'id',
			'created',
			'updated',
			'createdAt',
			'updatedAt',
			'version',
			'zip',
		]);
		if (fieldName === 'id') return true;
		if (cfg.readonly) return true;
		if (cfg.valueExpr) return true;
		if (opts.excludeSystem && SYSTEM.has(fieldName)) return true;
		return false;
	};
	for (const [tableName, table] of Object.entries<TableConfig>(schema)) {
		const requiredKeys: string[] = [];
		const updatableKeys: string[] = [];
		for (const [field, cfg] of Object.entries<FieldConfig>(table.fields)) {
			if (shouldOmitField(cfg, field)) continue;
			updatableKeys.push(field);
			if (cfg.required && cfg.default === undefined) {
				requiredKeys.push(field);
			}
		}
		// Базируется на Plain.<table>, чтобы записи могли разворачиваться опционально
		lines.push(`export type CreateInput_${tableName} = {`);
		for (const [field, cfg] of Object.entries<FieldConfig>(table.fields)) {
			if (shouldOmitField(cfg, field)) continue;
			const t = tsTypeFromField(cfg, { expand, plainNs });
			const isRequired = cfg.required && cfg.default === undefined;
			const opt = isRequired ? '' : '?';
			lines.push(`  ${field}${opt}: ${t};`);
		}
		lines.push(`};`);
		lines.push(
			`export type UpdateInput_${tableName} = Partial<Pick<${plainNs}.${tableName}, ${updatableKeys.length ? updatableKeys.map((k) => `"${k}"`).join(' | ') : 'never'}>>;`
		);
	}

	// Generic helpers
	lines.push(`export type CreateInput<T> = T;`);
	lines.push(`export type UpdateInput<T> = DeepPartial<T>;`);

	return lines.join('\n');
}
