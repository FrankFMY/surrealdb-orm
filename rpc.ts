import type { KEYS, RecordBySchema, Future, ILogger } from './helpers.js';
import type { CreateRecordDataRPC, SurrealENV } from './types.js';
import { randID } from './helpers.js';
import { exit } from 'node:process';
import WebSocket from 'ws';

//...

export type SurrealRPC_BulkCommand<
	DB,
	Table extends KEYS<DB>,
	Bulk extends boolean
> = Bulk extends true
	? { params: [Table]; return: RecordBySchema<DB, Table>[] }
	: { params: [string]; return: RecordBySchema<DB, Table> | null };

export interface SurrealRPC_Schema<
	DB,
	Table extends KEYS<DB>,
	Bulk extends boolean,
	Data = unknown
> {
	ping: {
		params: never[];
		return: void;
	};
	use: {
		/**
		 * [NAMESPACE, DATABASE]
		 */
		params: [string, string];
		return: void;
	};
	signin: {
		params: [{ user: string; pass: string }];
		/**
		 * JWT
		 */
		return: string;
	};
	query: {
		params: [string] | [string, Record<string, unknown>];
		return: { result: Data }[];
	};
	//...
	create: {
		params: [Table, CreateRecordDataRPC<DB, Table>];
		return: RecordBySchema<DB, Table>;
	};
	insert: {
		params: [Table, CreateRecordDataRPC<DB, Table>[]];
		return: RecordBySchema<DB, Table>[];
	};
	update: {
		params: [string, DB[Table]];
		return: RecordBySchema<DB, Table>;
	};
	merge: {
		params: [Table | string, Partial<DB[Table]>];
		return: any;
	};
	live: {
		params: [string] | [string, boolean];
		return: string;
	};
	kill: {
		params: [string];
		return: null;
	};
	let: {
		params: [string, unknown];
		return: null;
	};
	//...
	select: SurrealRPC_BulkCommand<DB, Table, Bulk>;
	delete: SurrealRPC_BulkCommand<DB, Table, Bulk>;
}

//...

export interface SurrealRPC_ResponseOK<
	DB,
	Table extends KEYS<DB>,
	Bulk extends boolean,
	Data,
	Command extends KEYS<SurrealRPC_Schema<DB, Table, Bulk, Data>>
> {
	id: string;
	result: SurrealRPC_Schema<DB, Table, Bulk, Data>[Command]['return'];
	error?: never;
}

export interface SurrealRPC_ResponseERR {
	id: string;
	result?: never;
	error: { code: number; message: string };
}

//...

export type SurrealRPC_UnknownResponseOK<DB> = SurrealRPC_ResponseOK<
	DB,
	KEYS<DB>,
	boolean,
	any,
	KEYS<SurrealRPC_Schema<DB, KEYS<DB>, boolean>>
>;

export type SurrealRPC_UnknownResponse<DB> =
	| SurrealRPC_UnknownResponseOK<DB>
	| SurrealRPC_ResponseERR;

//...

export interface ConstructSurrealRPC {
	process?: string;
	isSERVER?: boolean;
	future: Future;
	logger: ILogger;
	env: SurrealENV;
}

export class SurrealRPC<DB> {
	private _env: SurrealENV;
	readonly logger: ILogger;
	readonly future: Future;

	readonly meta: {
		process: string;
		isSERVER: boolean;
	};

	get env() {
		return this._env;
	}

	constructor(ctx: ConstructSurrealRPC) {
		this.logger = ctx.logger;
		this.future = ctx.future;
		this._env = { ...ctx.env };
		this.meta = {
			process: ctx.process ?? 'SDB',
			isSERVER: ctx.isSERVER ?? false,
		};
	}

	async use(dataspace: Partial<Omit<SurrealENV, 'rpc'>> = {}) {
		this._env = { ...this._env, ...dataspace };
		await this.ping();
		await this.customize();
	}

	private async customize() {
		return this.query(`
DEFINE FUNCTION IF NOT EXISTS fn::zipper($data: any) {
  RETURN function($data) {
      const [ data = "undefined" ] = arguments;
      const flat = JSON.stringify(data);
      const polynomial = Uint32Array.from({length: 256}, (_, i) => {
          let crc = i;
          for (let j = 8; j--;) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
          return crc;
      });
      let i = flat.length;
      let crc = 0 ^ -1;
      while (i--) crc = (crc >>> 8) ^ polynomial[(crc ^ flat.charCodeAt(i)) & 0xff];
      return "zi" + ((crc ^ -1) >>> 0).toString(16);
  };
};
DEFINE FUNCTION IF NOT EXISTS fn::upsert($record: object, $now: number) {
  LET $zip = fn::zipper((SELECT * OMIT id, created, updated, zip FROM $record)[0]);
  RETURN IF ($record.zip != $zip)
      THEN ((UPDATE $record.id SET zip = $zip, updated = $now)[0])
      ELSE $record
  END;
};`);
	}

	//...

	private async ping() {
		await this.send('ping', []);
		await this.send('signin', [
			{
				user: this.env.user,
				pass: this.env.pass,
			},
		]);
		await this.send('use', [this.env.namespace, this.env.database]);
		await this.send('ping', []);
	}

	async query<Data = unknown>(
		sql: string,
		vars?: Record<string, unknown>
	): Promise<{ result: Data }[]> {
		const method = `SQL - ${randID()}`;
		this.logger.debug({ module: this.meta.process, method }, { sql, vars });
		const params = (vars ? [sql, vars] : [sql]) as SurrealRPC_Schema<
			DB,
			KEYS<DB>,
			false,
			Data
		>['query']['params'];
		const response = await this.send<KEYS<DB>, false, Data, 'query'>(
			'query',
			params
		);
		this.logger.debug({ module: this.meta.process, method }, response);
		return response;
	}

	async run<Data = unknown>(
		sql: string,
		vars?: Record<string, unknown>
	): Promise<Data> {
		const response = await this.query<Data>(sql, vars);
		return response[0].result;
	}

	/** Получить сырое RPC-ответ (как есть) */
	async queryRaw(sql: string, vars?: Record<string, unknown>) {
		const method = `SQL-RAW - ${randID()}`;
		this.logger.debug({ module: this.meta.process, method }, { sql, vars });
		// используем обычный query, он возвращает массив результатов
		return this.send<KEYS<DB>, false, any, 'query'>(
			'query',
			(vars ? [sql, vars] : [sql]) as any
		);
	}

	// Live queries
	async live(table: string, diff = false) {
		return this.send<KEYS<DB>, false, string, 'live'>(
			'live',
			diff ? [table, true] : [table]
		);
	}

	/** Запуск LIVE SELECT с произвольным WHERE */
	async liveSelect(sql: string) {
		// RPC live поддерживает только table, для сложных — используем query("LIVE SELECT ...") и парсим первый id
		const res = await this.query<string[]>(sql);
		return (res[0]?.result as unknown as string[])?.[0];
	}

	async kill(queryUuid: string) {
		return this.send<KEYS<DB>, false, null, 'kill'>('kill', [queryUuid]);
	}

	async transaction<Data = any>(arr: string[]): Promise<Data> {
		return this.run<Data>(`
RETURN {
	LET $result = [];
${arr.map((sql) => `$result = array::add($result, (${sql}))`).join(';\n')};
	RETURN $result;
}`);
	}

	// ----- Transactions -----
	async begin() {
		await this.query('BEGIN TRANSACTION');
	}

	async commit() {
		await this.query('COMMIT TRANSACTION');
	}

	async cancel() {
		await this.query('CANCEL TRANSACTION');
	}

	async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
		await this.begin();
		try {
			const result = await fn();
			await this.commit();
			return result;
		} catch (e) {
			try {
				await this.cancel();
			} catch {}
			throw e;
		}
	}

	//...

	private heap = new Map<
		string,
		{
			resolver: (
				result: SurrealRPC_UnknownResponseOK<DB>['result']
			) => void;
			rejecter: (error: SurrealRPC_ResponseERR['error']) => void;
		}
	>();

	private liveSubscribers = new Map<
		string,
		Set<
			(payload: {
				action: 'CLOSE' | 'CREATE' | 'UPDATE' | 'DELETE';
				id: string;
				result: unknown;
			}) => void
		>
	>();

	protected async send<
		Table extends KEYS<DB>,
		Bulk extends boolean,
		Data,
		Command extends KEYS<SurrealRPC_Schema<DB, Table, Bulk, Data>>
	>(
		cmd: Command,
		params: SurrealRPC_Schema<DB, Table, Bulk, Data>[Command]['params']
	): Promise<SurrealRPC_Schema<DB, Table, Bulk, Data>[Command]['return']> {
		let resolver!: (
			result: SurrealRPC_ResponseOK<
				DB,
				Table,
				Bulk,
				Data,
				Command
			>['result']
		) => void;
		let rejecter!: (error: SurrealRPC_ResponseERR['error']) => void;
		const promise = new Promise<
			SurrealRPC_Schema<DB, Table, Bulk, Data>[Command]['return']
		>((resolve, reject) => {
			resolver = resolve;
			rejecter = reject;
		});
		const id = randID();
		this.heap.set(id, { resolver, rejecter });
		this.ws.send(JSON.stringify({ id, method: cmd, params }));
		return promise;
	}

	//...

	private ws!: WebSocket;
	private resolver!: () => void;
	private ready!: Promise<void>;

	async open() {
		this.ready = new Promise<void>((resolve) => (this.resolver = resolve));
		this.ws = new WebSocket(this.env.rpc /*, "rpc" */);

		this.ws.addEventListener('open', async () => {
			await this.ping();
			await this.customize();
			this.future.run(() => this.ping().catch(() => {}), {
				type: 'interval',
				key: this.meta.process,
			});
			this.resolver();
		});

		this.ws.addEventListener('error', (error) => {
			this.logger.error(
				{ module: this.meta.process, method: 'open' },
				error
			);
			// if (this.isSERVER)
			return exit(1);
			// this.open();
		});

		this.ws.addEventListener('close', () => {
			this.future.clear('interval', this.meta.process);
			if (this.meta.isSERVER) return exit(1);
			this.open();
		});

		this.ws.addEventListener('message', (e) => {
			const parsed = JSON.parse(e.data.toString());
			// ответ на rpc с id
			if (parsed && parsed.id) {
				const promise = this.heap.get(parsed.id);
				if (promise) {
					if (parsed.error) promise.rejecter(parsed.error);
					else promise.resolver(parsed.result);
					this.heap.delete(parsed.id);
				}
				return;
			}
			// live-уведомление без id
			if (
				parsed &&
				parsed.result &&
				parsed.result.action &&
				parsed.result.id
			) {
				const payload = parsed.result as {
					action: 'CLOSE' | 'CREATE' | 'UPDATE' | 'DELETE';
					id: string;
					result: unknown;
				};
				const subs = this.liveSubscribers.get(payload.id);
				if (subs)
					for (const cb of subs)
						try {
							cb(payload);
						} catch {}
			}
		});

		this.ready.then(() => {
			this.logger.good(this.meta.process, 'connected');
		});

		return this.ready;
	}

	subscribeLive(
		queryUuid: string,
		cb: (payload: {
			action: 'CLOSE' | 'CREATE' | 'UPDATE' | 'DELETE';
			id: string;
			result: unknown;
		}) => void
	) {
		const set = this.liveSubscribers.get(queryUuid) ?? new Set();
		set.add(cb);
		this.liveSubscribers.set(queryUuid, set);
		return () => {
			const s = this.liveSubscribers.get(queryUuid);
			if (!s) return;
			s.delete(cb);
			if (!s.size) this.liveSubscribers.delete(queryUuid);
		};
	}
}
