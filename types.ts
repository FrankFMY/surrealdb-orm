import type { KEYS } from "@nemigo/helpers/types";
import type { RecordBySchema } from "@helpers/types.js";

export interface SurrealENV {
	rpc: string;
	namespace: string;
	database: string;
	user: string;
	pass: string;
}

export type CreateRecordDataRPC<DB, Table extends KEYS<DB>> = Omit<RecordBySchema<DB, Table>, "id"> & { id: string };

// Экспортируем типы из ORM
export type { DatabaseSchema, TableConfig, FieldConfig } from "./orm.js";
