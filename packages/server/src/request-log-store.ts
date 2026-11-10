import type { CacheWarmStretch } from "@aiki/protocol";
/**
 * The request log's database: one row per model request of every project on this backend, kept `REQUEST_LOG_KEEP_DAYS`
 * days, plus each conversation's last prompt fingerprint and which projects were read back from their transcripts.
 * `request-log.ts` writes it; `cache-stats.ts` and `bun run cache-report` read it. bun:sqlite, synchronous: a row is a
 * few hundred bytes, written off the request's path.
 */
import { Database } from "bun:sqlite";
import {
	type CacheMissReason,
	type ConversationKind,
	LONG_PROMPT_CACHE_TTL_MS,
	type PreviousRequest,
	type RequestSource,
	type WakeReason,
} from "@aiki/protocol";
import type { PromptFingerprint } from "./prompt-fingerprint.ts";

export const REQUEST_LOG_FILE = "request-log.sqlite";
export const REQUEST_LOG_KEEP_DAYS = 90;
const SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Which conversation sent a request. */
export type ConversationIdentity = {
	kind: ConversationKind;
	threadId: string | null;
	workerId: string | null;
	taskId: string | null;
	/** The schedule that started the worker or thread, if one did: its first message is then a `schedule` wake. */
	scheduleId: string | null;
};

export type RequestRow = ConversationIdentity & {
	/** The response's timestamp (pi-ai stamps it when the request starts), ms since the epoch. */
	at: number;
	projectId: string;
	conversationId: number;
	provider: string;
	model: string;
	stopReason: string | null;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	/** The part of `cacheWrite` written for an hour; null when the provider does not split it. */
	cacheWrite1h: number | null;
	output: number;
	cost: number;
	costInput: number;
	costCacheRead: number;
	costCacheWrite: number;
	costOutput: number;
	promptTokens: number;
	/** Since the conversation's previous request; null for its first. */
	idleMs: number | null;
	missTokens: number;
	missCost: number;
	missReason: CacheMissReason | null;
	wake: WakeReason | null;
	/** pi-ai's cache retention for the request (`short`, `long`, `none`); null when not known. */
	retention: string | null;
	changes: string[] | null;
	source: RequestSource;
	durationMs: number | null;
};

type DbRow = {
	at: number;
	project_id: string;
	conversation_id: number;
	conversation_kind: string;
	thread_id: string | null;
	worker_id: string | null;
	task_id: string | null;
	schedule_id: string | null;
	provider: string;
	model: string;
	stop_reason: string | null;
	input: number;
	cache_read: number;
	cache_write: number;
	cache_write_1h: number | null;
	output: number;
	cost: number;
	cost_input: number;
	cost_cache_read: number;
	cost_cache_write: number;
	cost_output: number;
	prompt_tokens: number;
	idle_ms: number | null;
	miss_tokens: number;
	miss_cost: number;
	miss_reason: string | null;
	wake: string | null;
	retention: string | null;
	changes: string | null;
	source: string;
	duration_ms: number | null;
};

const COLUMNS = [
	"at",
	"project_id",
	"conversation_id",
	"conversation_kind",
	"thread_id",
	"worker_id",
	"task_id",
	"schedule_id",
	"provider",
	"model",
	"stop_reason",
	"input",
	"cache_read",
	"cache_write",
	"cache_write_1h",
	"output",
	"cost",
	"cost_input",
	"cost_cache_read",
	"cost_cache_write",
	"cost_output",
	"prompt_tokens",
	"idle_ms",
	"miss_tokens",
	"miss_cost",
	"miss_reason",
	"wake",
	"retention",
	"changes",
	"source",
	"duration_ms",
] as const;

function toDb(row: RequestRow): DbRow {
	return {
		at: row.at,
		project_id: row.projectId,
		conversation_id: row.conversationId,
		conversation_kind: row.kind,
		thread_id: row.threadId,
		worker_id: row.workerId,
		task_id: row.taskId,
		schedule_id: row.scheduleId,
		provider: row.provider,
		model: row.model,
		stop_reason: row.stopReason,
		input: row.input,
		cache_read: row.cacheRead,
		cache_write: row.cacheWrite,
		cache_write_1h: row.cacheWrite1h,
		output: row.output,
		cost: row.cost,
		cost_input: row.costInput,
		cost_cache_read: row.costCacheRead,
		cost_cache_write: row.costCacheWrite,
		cost_output: row.costOutput,
		prompt_tokens: row.promptTokens,
		idle_ms: row.idleMs,
		miss_tokens: row.missTokens,
		miss_cost: row.missCost,
		miss_reason: row.missReason,
		wake: row.wake,
		retention: row.retention,
		changes: row.changes === null ? null : JSON.stringify(row.changes),
		source: row.source,
		duration_ms: row.durationMs,
	};
}

function fromDb(row: DbRow): RequestRow {
	return {
		at: row.at,
		projectId: row.project_id,
		conversationId: row.conversation_id,
		kind: row.conversation_kind as ConversationKind,
		threadId: row.thread_id,
		workerId: row.worker_id,
		taskId: row.task_id,
		scheduleId: row.schedule_id,
		provider: row.provider,
		model: row.model,
		stopReason: row.stop_reason,
		input: row.input,
		cacheRead: row.cache_read,
		cacheWrite: row.cache_write,
		cacheWrite1h: row.cache_write_1h,
		output: row.output,
		cost: row.cost,
		costInput: row.cost_input,
		costCacheRead: row.cost_cache_read,
		costCacheWrite: row.cost_cache_write,
		costOutput: row.cost_output,
		promptTokens: row.prompt_tokens,
		idleMs: row.idle_ms,
		missTokens: row.miss_tokens,
		missCost: row.miss_cost,
		missReason: row.miss_reason as CacheMissReason | null,
		wake: row.wake as WakeReason | null,
		retention: row.retention,
		changes: row.changes === null ? null : (JSON.parse(row.changes) as string[]),
		source: row.source as RequestSource,
		durationMs: row.duration_ms,
	};
}

export type BackfillRecord = { projectId: string; doneAt: number; rows: number; error: string | null };

export class RequestLogStore {
	readonly #db: Database;
	readonly #warmListeners = new Set<() => void>();
	readonly #insert: ReturnType<Database["prepare"]>;

	private constructor(db: Database) {
		this.#db = db;
		this.#insert = db.prepare(
			`INSERT INTO requests (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map((column) => `$${column}`).join(", ")})`,
		);
	}

	/** Open or create the log; `now` stamps a new one's `liveSince`. `readonly` opens an existing file for reading only. */
	static open(path: string, options: { now?: number; readonly?: boolean } = {}): RequestLogStore {
		if (options.readonly === true) {
			const db = new Database(path, { readonly: true, strict: true });
			return new RequestLogStore(db);
		}
		const db = new Database(path, { create: true, strict: true });
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA busy_timeout = 5000");
		db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`);
		const version = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
		if (version !== null && Number(version.value) > SCHEMA_VERSION) {
			db.close();
			throw new Error(`request log schema ${version.value} is newer than this release's ${SCHEMA_VERSION}`);
		}
		db.exec(`CREATE TABLE IF NOT EXISTS requests (
			id INTEGER PRIMARY KEY,
			at INTEGER NOT NULL,
			project_id TEXT NOT NULL,
			conversation_id INTEGER NOT NULL,
			conversation_kind TEXT NOT NULL,
			thread_id TEXT,
			worker_id TEXT,
			task_id TEXT,
			schedule_id TEXT,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			stop_reason TEXT,
			input INTEGER NOT NULL,
			cache_read INTEGER NOT NULL,
			cache_write INTEGER NOT NULL,
			cache_write_1h INTEGER,
			output INTEGER NOT NULL,
			cost REAL NOT NULL,
			cost_input REAL NOT NULL,
			cost_cache_read REAL NOT NULL,
			cost_cache_write REAL NOT NULL,
			cost_output REAL NOT NULL,
			prompt_tokens INTEGER NOT NULL,
			idle_ms INTEGER,
			miss_tokens INTEGER NOT NULL,
			miss_cost REAL NOT NULL,
			miss_reason TEXT,
			wake TEXT,
			retention TEXT,
			changes TEXT,
			source TEXT NOT NULL,
			duration_ms INTEGER
		) STRICT`);
		db.exec(`CREATE TABLE IF NOT EXISTS cache_warm_snapshots (project_id TEXT NOT NULL, conversation_id INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(project_id, conversation_id)) STRICT`);
		db.exec(`CREATE TABLE IF NOT EXISTS cache_warm_stretches (
            project_id TEXT NOT NULL, conversation_id INTEGER NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL,
            summary TEXT NOT NULL, PRIMARY KEY (project_id, conversation_id, id)
        ) STRICT`);
        db.exec("CREATE INDEX IF NOT EXISTS requests_by_time ON requests (at)");
		db.exec("CREATE INDEX IF NOT EXISTS requests_by_conversation ON requests (project_id, conversation_id, at)");
		db.exec(`CREATE TABLE IF NOT EXISTS prompt_state (
			project_id TEXT NOT NULL,
			conversation_id INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			fingerprint TEXT NOT NULL,
			PRIMARY KEY (project_id, conversation_id)
		) STRICT`);
		db.exec(`CREATE TABLE IF NOT EXISTS backfills (
			project_id TEXT PRIMARY KEY,
			done_at INTEGER NOT NULL,
			rows INTEGER NOT NULL,
			error TEXT
		) STRICT`);
		db.query("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
		db.query("INSERT OR IGNORE INTO meta (key, value) VALUES ('live_since', ?)").run(String(options.now ?? Date.now()));
		return new RequestLogStore(db);
	}

	/** When this log started recording requests as they ran: older ones come from the transcripts. */
	markWarmRestarted(): void {
        for (const row of this.#db.query<{project_id: string; conversation_id: number; id: string; summary: string}, []>("SELECT * FROM cache_warm_stretches").all()) {
            const summary = JSON.parse(row.summary) as CacheWarmStretch;
            if (summary.stopped !== undefined) continue;
            summary.stopped = "Server restarted";
            this.#db.query("UPDATE cache_warm_stretches SET summary = ? WHERE project_id = ? AND conversation_id = ? AND id = ?")
                .run(JSON.stringify(summary), row.project_id, row.conversation_id, row.id);
        }
	}

	liveSince(): number | null {
		const row = this.#db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'live_since'").get();
		return row === null ? null : Number(row.value);
	}

	insert(row: RequestRow): void {
		this.#insert.run(toDb(row) as never);
	}

	insertMany(rows: readonly RequestRow[]): void {
		this.#db.transaction(() => {
			for (const row of rows) this.#insert.run(toDb(row) as never);
		})();
	}

	/** The conversation's newest request, for a tracker to go on from after a restart. */
	previousRequest(projectId: string, conversationId: number): (PreviousRequest & { at: number }) | undefined {
		const row = this.#db
			.query<{ at: number; prompt_tokens: number; provider: string; model: string }, [string, number]>(
				"SELECT at, prompt_tokens, provider, model FROM requests WHERE project_id = ? AND conversation_id = ? AND source != 'keepWarm' AND prompt_tokens > 0 ORDER BY at DESC, id DESC LIMIT 1",
			)
			.get(projectId, conversationId);
		if (row === null) return undefined;
		const cached = this.#db
			.query<{ found: number }, [string, number]>(
				"SELECT EXISTS (SELECT 1 FROM requests WHERE project_id = ? AND conversation_id = ? AND source != 'keepWarm' AND cache_read + cache_write > 0) AS found",
			)
			.get(projectId, conversationId);
		// The cache lasts as long as the newest write asked for: the tracker's rule (`CacheMissTracker`), from the rows.
		const write = this.#db
			.query<{ hour: number | null }, [string, number]>(
				"SELECT cache_write_1h AS hour FROM requests WHERE project_id = ? AND conversation_id = ? AND source != 'keepWarm' AND cache_write > 0 ORDER BY at DESC, id DESC LIMIT 1",
			)
			.get(projectId, conversationId);
		return {
			at: row.at,
			timestamp: row.at,
			promptTokens: row.prompt_tokens,
			modelKey: `${row.provider}/${row.model}`,
			reportedCache: (cached?.found ?? 0) === 1,
			...((write?.hour ?? 0) > 0 ? { cacheTtlMs: LONG_PROMPT_CACHE_TTL_MS } : {}),
		};
	}

	/** The newest request's time of the conversation, any request (failed ones too). */
	lastRequestAt(projectId: string, conversationId: number): number | undefined {
		const row = this.#db
			.query<{ at: number }, [string, number]>(
				"SELECT MAX(at) AS at FROM requests WHERE project_id = ? AND conversation_id = ? AND source != 'keepWarm'",
			)
			.get(projectId, conversationId);
		return row?.at ?? undefined;
	}

	promptState(projectId: string, conversationId: number): PromptFingerprint | undefined {
		const row = this.#db
			.query<{ fingerprint: string }, [string, number]>(
				"SELECT fingerprint FROM prompt_state WHERE project_id = ? AND conversation_id = ?",
			)
			.get(projectId, conversationId);
		return row === null ? undefined : (JSON.parse(row.fingerprint) as PromptFingerprint);
	}

	savePromptState(projectId: string, conversationId: number, fingerprint: PromptFingerprint, at: number): void {
		this.#db
			.query(
				"INSERT INTO prompt_state (project_id, conversation_id, updated_at, fingerprint) VALUES (?, ?, ?, ?) ON CONFLICT (project_id, conversation_id) DO UPDATE SET updated_at = excluded.updated_at, fingerprint = excluded.fingerprint",
			)
			.run(projectId, conversationId, at, JSON.stringify(fingerprint));
	}

	backfill(projectId: string): BackfillRecord | undefined {
		const row = this.#db
			.query<{ project_id: string; done_at: number; rows: number; error: string | null }, [string]>(
				"SELECT project_id, done_at, rows, error FROM backfills WHERE project_id = ?",
			)
			.get(projectId);
		return row === null ? undefined : { projectId: row.project_id, doneAt: row.done_at, rows: row.rows, error: row.error };
	}

	/** Record a project's read-back with its rows in one transaction, so a crash in between reads it again. */
	finishBackfill(projectId: string, rows: readonly RequestRow[], at: number, error: string | null): void {
		this.#db.transaction(() => {
			for (const row of rows) this.#insert.run(toDb(row) as never);
			this.#db
				.query("INSERT OR REPLACE INTO backfills (project_id, done_at, rows, error) VALUES (?, ?, ?, ?)")
				.run(projectId, at, rows.length, error);
		})();
	}

	/** Forget rows and fingerprints older than `keepDays`. */
	prune(now: number, keepDays: number = REQUEST_LOG_KEEP_DAYS): number {
		const cutoff = now - keepDays * DAY_MS;
		this.#db.query("DELETE FROM cache_warm_snapshots WHERE json_extract(snapshot, '$.request.row.at') < ?").run(now - 8 * 3_600_000);
		this.#db.query("DELETE FROM cache_warm_stretches WHERE at < ?").run(cutoff);
		const removed = this.#db.query("DELETE FROM requests WHERE at < ?").run(cutoff).changes;
		this.#db.query("DELETE FROM prompt_state WHERE updated_at < ?").run(cutoff);
		return removed;
	}

	/** Rows in `[from, to)`, oldest first; one project's when `projectId` is given. */
	rows(query: { from: number; to: number; projectId?: string }): RequestRow[] {
		const rows =
			query.projectId === undefined
				? this.#db
						.query<DbRow, [number, number]>(`SELECT ${COLUMNS.join(", ")} FROM requests WHERE at >= ? AND at < ? ORDER BY at, id`)
						.all(query.from, query.to)
				: this.#db
						.query<DbRow, [number, number, string]>(
							`SELECT ${COLUMNS.join(", ")} FROM requests WHERE at >= ? AND at < ? AND project_id = ? ORDER BY at, id`,
						)
						.all(query.from, query.to, query.projectId);
		return rows.map(fromDb);
	}

    saveWarmSnapshot(projectId: string, conversationId: number, snapshot: unknown): void {
        this.#db.query("INSERT OR REPLACE INTO cache_warm_snapshots VALUES (?, ?, ?)").run(projectId, conversationId, JSON.stringify(snapshot));
    }
    warmSnapshots(projectId: string): unknown[] {
        return this.#db.query<{snapshot: string}, [string]>("SELECT snapshot FROM cache_warm_snapshots WHERE project_id = ?").all(projectId).map(row => JSON.parse(row.snapshot));
    }
    deleteWarmSnapshots(projectId: string, conversationId?: number): void {
        if (conversationId === undefined) this.#db.query("DELETE FROM cache_warm_snapshots WHERE project_id = ?").run(projectId);
        else this.#db.query("DELETE FROM cache_warm_snapshots WHERE project_id = ? AND conversation_id = ?").run(projectId, conversationId);
    }
    onWarmChange(listener: () => void): () => void { this.#warmListeners.add(listener); return () => { this.#warmListeners.delete(listener); }; }
    saveWarmStretch(projectId: string, conversationId: number, summary: CacheWarmStretch): void {
        this.#db.query("INSERT OR REPLACE INTO cache_warm_stretches VALUES (?, ?, ?, ?, ?)")
            .run(projectId, conversationId, summary.id, summary.lastAt, JSON.stringify(summary));
		queueMicrotask(() => { for (const listener of this.#warmListeners) listener(); });
    }
    warmStretches(projectId: string, conversationId: number): CacheWarmStretch[] {
        return this.#db.query<{summary: string}, [string, number]>("SELECT summary FROM cache_warm_stretches WHERE project_id = ? AND conversation_id = ? ORDER BY at")
            .all(projectId, conversationId).map(row => JSON.parse(row.summary) as CacheWarmStretch);
    }
    recordWarm(row: RequestRow, summary: CacheWarmStretch): void {
        this.#db.transaction(() => { this.insert(row); this.saveWarmStretch(row.projectId, row.conversationId, summary); })();
    }
	close(): void {
		this.#db.close();
	}
}
