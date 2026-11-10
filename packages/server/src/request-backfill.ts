import { stateKind } from "./state-identity.ts";
/**
 * Reads a project's transcripts back into request log rows: once per project, for the requests made before the log
 * recorded them live (`liveSince`). The answers carry their usage, so tokens, cost, misses and their reasons, idle gaps
 * and what woke the agent (from the inputs before each answer) come back; prompt fingerprints and the cache retention
 * do not (`changes` and `retention` stay null).
 *
 * The project's `session.sqlite` is opened read-only through pi-durable's own storage, beside the Harness that may own
 * it: SQLite lets a reader in while the owner writes, and this never writes (`ReadOnlySqlite` refuses).
 */
import { existsSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import {
	type ConversationId,
	type ConversationRecord,
	type Cursor,
	type EntryRecord,
	ROOT_CONVERSATION_ID,
	type Storage,
} from "@earendil-works/pi-durable";
import { MAIN_THREAD_ID } from "@aiki/protocol";
import { errorMessage } from "./errors.ts";
import { messageText } from "./prompt-fingerprint.ts";
import { ConversationRequests, type RequestLog, wakeOf } from "./request-log.ts";
import type { ConversationIdentity, RequestRow } from "./request-log-store.ts";

const PAGE = 500;

/** pi-durable's storage opening always runs its schema migration: these two statements of it are no-ops when current. */
const MIGRATION_NO_OPS = [/^\s*CREATE TABLE IF NOT EXISTS\s+\w*durable_schema\b/i, /^\s*INSERT OR IGNORE INTO\s+\w*durable_schema\b/i];

/**
 * A `SqliteDatabase` over a read-only connection: reads go through, the migration's two no-op statements are skipped,
 * and any other write fails (a schema that needs migrating, which only the owning Harness may do).
 */
class ReadOnlySqlite implements SqliteDatabase {
	readonly #db: DatabaseSync;
	readonly #statements = new Map<string, StatementSync>();
	#chain: Promise<unknown> = Promise.resolve();

	constructor(path: string) {
		this.#db = new DatabaseSync(path, { readOnly: true });
	}

	#statement(sql: string): StatementSync {
		let statement = this.#statements.get(sql);
		if (statement === undefined) {
			statement = this.#db.prepare(sql);
			this.#statements.set(sql, statement);
		}
		return statement;
	}

	async exec(sql: string): Promise<void> {
		if (MIGRATION_NO_OPS.some((pattern) => pattern.test(sql))) return;
		this.#db.exec(sql);
	}

	async run(sql: string, ...params: SqliteValue[]): Promise<void> {
		if (MIGRATION_NO_OPS.some((pattern) => pattern.test(sql))) return;
		this.#statement(sql).run(...params);
	}

	async runCounted(sql: string, ...params: SqliteValue[]): Promise<number> {
		if (MIGRATION_NO_OPS.some((pattern) => pattern.test(sql))) return 0;
		return Number(this.#statement(sql).run(...params).changes);
	}

	async get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return this.#statement(sql).get(...params) as T | undefined;
	}

	async all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return this.#statement(sql).all(...params) as T[];
	}

	transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
		const run = this.#chain.then(async () => {
			this.#db.exec("BEGIN");
			try {
				const result = await callback(this);
				this.#db.exec("COMMIT");
				return result;
			} catch (error) {
				this.#db.exec("ROLLBACK");
				throw error;
			}
		});
		this.#chain = run.catch(() => undefined);
		return run;
	}

	async close(): Promise<void> {
		await this.#chain;
		this.#db.close();
	}
}

/** A project's durable storage, opened for reading only. */
export async function openStorageReadOnly(path: string): Promise<SqliteStorage> {
	return SqliteStorage.open(new ReadOnlySqlite(path));
}

type WorkerLike = { id?: unknown; conversationId?: unknown; taskId?: unknown; scheduleId?: unknown };
type ThreadLike = WorkerLike;

async function documentValue(storage: Storage, kind: string, conversationId: number): Promise<Record<string, unknown> | undefined> {
	const scope = { kind: "conversation", conversationId } as Parameters<Storage["findDocument"]>[0]["scope"];
	const record = await storage.findDocument({ kind, scope }, "current", BACKGROUND_CONTEXT);
	if (record === undefined) return undefined;
	return (await storage.document(record.id, "current", BACKGROUND_CONTEXT))?.value as Record<string, unknown> | undefined;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Who each conversation is: main, the threads in main's thread list, the workers in every coordinator's worker list. */
async function identities(storage: Storage): Promise<Map<number, ConversationIdentity>> {
	const main = Number(ROOT_CONVERSATION_ID);
	const known = new Map<number, ConversationIdentity>([
		[main, { kind: "main", threadId: MAIN_THREAD_ID, workerId: null, taskId: null, scheduleId: null }],
	]);
	const places: { conversationId: number; threadId: string }[] = [{ conversationId: main, threadId: MAIN_THREAD_ID }];
	const threads = (await documentValue(storage, stateKind("threads"), main))?.threads;
	if (typeof threads === "object" && threads !== null) {
		for (const thread of Object.values(threads as Record<string, ThreadLike>)) {
			const id = text(thread.id);
			if (id === null || typeof thread.conversationId !== "number") continue;
			known.set(thread.conversationId, {
				kind: "thread",
				threadId: id,
				workerId: null,
				taskId: text(thread.taskId),
				scheduleId: text(thread.scheduleId),
			});
			places.push({ conversationId: thread.conversationId, threadId: id });
		}
	}
	for (const place of places) {
		const workers = (await documentValue(storage, stateKind("workers"), place.conversationId))?.workers;
		if (typeof workers !== "object" || workers === null) continue;
		for (const worker of Object.values(workers as Record<string, WorkerLike>)) {
			const id = text(worker.id);
			if (id === null || typeof worker.conversationId !== "number") continue;
			known.set(worker.conversationId, {
				kind: "worker",
				threadId: place.threadId,
				workerId: id,
				taskId: text(worker.taskId),
				scheduleId: text(worker.scheduleId),
			});
		}
	}
	return known;
}

/** A conversation no list names any more (a forgotten worker): its owning task still says what it was. */
async function identityByOwner(storage: Storage, record: ConversationRecord): Promise<ConversationIdentity> {
	const unknown: ConversationIdentity = { kind: "other", threadId: null, workerId: null, taskId: null, scheduleId: null };
	if (record.owner === undefined) return unknown;
	const task = await storage.task(record.owner.taskId, BACKGROUND_CONTEXT);
	if (task?.kind === stateKind("worker-anchor")) return { ...unknown, kind: "worker" };
	if (task?.kind === stateKind("thread-anchor")) return { ...unknown, kind: "thread" };
	return unknown;
}

async function* conversations(storage: Storage): AsyncGenerator<ConversationRecord> {
	let cursor: Cursor | undefined;
	do {
		const page = await storage.scanConversations({ order: "ascending" }, PAGE, cursor, BACKGROUND_CONTEXT);
		yield* page.items;
		cursor = page.next;
	} while (cursor !== undefined);
}

async function* entries(storage: Storage, conversationId: ConversationId): AsyncGenerator<EntryRecord> {
	let cursor: Cursor | undefined;
	do {
		const page = await storage.scanEntries({ conversationId, order: "ascending" }, PAGE, cursor, BACKGROUND_CONTEXT);
		yield* page.items;
		// The reads are synchronous underneath: let the server answer between pages.
		await new Promise((resolve) => setImmediate(resolve));
		cursor = page.next;
	} while (cursor !== undefined);
}

export type BackfillOptions = {
	projectId: string;
	/** Only requests before this time: later ones the live log has. */
	before: number;
	cacheReadPerToken?: (provider: string, model: string) => number | undefined;
};

/** Every request of every conversation in `storage` before `options.before`, as rows in time order. */
export async function backfillRows(storage: Storage, options: BackfillOptions): Promise<RequestRow[]> {
	const known = await identities(storage);
	const rows: RequestRow[] = [];
	for await (const record of conversations(storage)) {
		const conversationId = Number(record.id);
		const identity = known.get(conversationId) ?? (await identityByOwner(storage, record));
		const requests = new ConversationRequests({
			projectId: options.projectId,
			conversationId,
			identity,
			...(options.cacheReadPerToken === undefined ? {} : { cacheReadPerToken: options.cacheReadPerToken }),
		});
		let userTexts: string[] = [];
		let toolResults = 0;
		let answered = false;
		for await (const entry of entries(storage, record.id)) {
			switch (entry.kind) {
				case "pi.compaction":
				case "pi.reset":
					requests.restart();
					break;
				case "pi.system":
					requests.instructionsChanged();
					break;
				case "pi.user":
					for (const message of entry.model ?? []) userTexts.push(messageText((message as { content?: unknown }).content));
					break;
				case "pi.tool-result":
					toolResults += 1;
					break;
				case "pi.assistant":
					for (const message of entry.model ?? []) {
						const wake = wakeOf({ toolResults, userTexts, firstTurn: !answered, repeated: false }, identity);
						const row = requests.request(message as never, { wake, retention: null, changes: null, source: "backfill" });
						// A forked conversation sees its parent's entries too; those rows are the parent's.
						if (entry.conversationId === record.id && row.at < options.before) rows.push(row);
						userTexts = [];
						toolResults = 0;
						answered = true;
					}
					break;
			}
		}
	}
	return rows.sort((a, b) => a.at - b.at);
}

/**
 * Read every project not read back yet, one after the other, and mark each done with its rows in one transaction. A
 * project's live rows wait for its read-back (`RequestLog.waitFor`), so they go on from its last row. A failure is
 * logged and leaves the project unmarked, so the next start tries again.
 */
export function backfillProjects(options: {
	requestLog: RequestLog;
	projects: readonly { id: string; sessionPath: string }[];
	now?: () => number;
	log?: (message: string) => void;
	cacheReadPerToken?: (provider: string, model: string) => number | undefined;
}): Promise<void> {
	const store = options.requestLog.store;
	const now = options.now ?? Date.now;
	const log = options.log ?? ((message: string) => console.log(message));
	const before = store.liveSince() ?? now();
	let chain: Promise<void> = Promise.resolve();
	for (const project of options.projects) {
		if (store.backfill(project.id) !== undefined) continue;
		const done = chain.then(async () => {
			const started = now();
			if (!existsSync(project.sessionPath)) {
				store.finishBackfill(project.id, [], now(), null);
				return;
			}
			const storage = await openStorageReadOnly(project.sessionPath);
			try {
				const rows = await backfillRows(storage, {
					projectId: project.id,
					before,
					...(options.cacheReadPerToken === undefined ? {} : { cacheReadPerToken: options.cacheReadPerToken }),
				});
				store.finishBackfill(project.id, rows, now(), null);
				log(`request log: read ${rows.length} earlier requests of ${project.id} from its transcripts in ${now() - started} ms`);
			} finally {
				await storage.close(BACKGROUND_CONTEXT).catch(() => undefined);
			}
		});
		options.requestLog.waitFor(project.id, done);
		chain = done.catch((error: unknown) => {
			log(`request log: could not read ${project.id}'s transcripts back: ${errorMessage(error)}`);
		});
	}
	return chain;
}
