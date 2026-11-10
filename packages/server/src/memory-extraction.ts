/**
 * Extracting memories after a coordinator compaction.
 *
 * When a `pi.compaction` entry lands on the coordinator's conversation, the part of the transcript it replaced is still
 * in storage. This module reads that part and asks the coordinator's model for the durable facts worth keeping: user
 * preferences go to the global scope, project facts to the project scope, and anything memory already holds is updated
 * rather than duplicated. The writes are one commit per scope touched, of kind `extraction`, with the compaction's entry
 * ID as their source, so the app can offer an undo and history can say where a fact came from.
 *
 * Durability: the work is driven by what is in storage, not by an in-memory event. `projects/<id>/memory-extraction.json`
 * keeps the newest compaction entry that was handled, every start (or any later commit) scans the durable entries above
 * it, and a compaction is handled once — a restart mid-run re-reads the same entry only if it was never marked, and its
 * commit is one commit, so a crash before the commit writes nothing. Failures are logged and never block the conversation
 * or anything else.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai";
import type {
	Conversation,
	Cursor,
	EntryId,
	EntryRecord,
} from "@earendil-works/pi-durable";
import { join } from "node:path";
import { errorMessage } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { MemoryEditor, describeBatchChanges, memoryAgentExecutor, memoryAgentTools, runMemoryAgent } from "./memory-agent.ts";
import type { MemoryStore } from "./memory.ts";
import type { Project, ProjectStore } from "./projects.ts";

/** The file, next to `project.json`, that remembers what was already extracted. */
export const MEMORY_EXTRACTION_FILE = "memory-extraction.json";
/** The `pi.compaction` entry kind. */
const COMPACTION_ENTRY = "pi.compaction";
/** Entries one page of the scan for missed compactions reads. */
const SCAN_PAGE_ENTRIES = 200;
/** A scan stops after this many entries: a backlog that old is not worth an extraction run apiece. */
const SCAN_MAX_ENTRIES = 2_000;
/** Characters of the compacted part one extraction reads. */
export const EXTRACTION_TRANSCRIPT_CHARS = 24_000;
/** Characters of one tool result or message the serialized transcript keeps. */
const EXTRACTION_MESSAGE_CHARS = 1_500;

export const EXTRACTION_SYSTEM_PROMPT = `You keep the durable memory of a coding assistant harness. A conversation was just compacted and its earlier part replaced by a summary, so read that part once more and save what must not be lost.

Save durable facts only:
- to the "global" scope, what is true of the user: preferences, habits, how they like to work, their tools and accounts;
- to the "project" scope, what is true of this project: conventions, decisions and their reasons, gotchas, where things are, how it is built and deployed.

Rules:
- Write facts, not a transcript. No progress reports, no "the user asked", no restating of the task.
- Search first (memory_search, a few phrasings and tags) and update the topic that already holds a fact instead of creating a near-duplicate. Write one \`##\` section per subject.
- Skip anything memory already says. Never write what is merely in the compaction summary and will therefore still be in context.
- Prefer a few well-placed sections in existing topics over new files. Create a topic only for a subject with no home.
- When you are done, answer in one short paragraph saying what you saved, or that nothing was worth keeping.`;

export type MemoryExtractionStoreOptions = {
	projects: ProjectStore;
	log?: (message: string) => void;
};

/** What the file records: main's newest extracted compaction entry, and each background thread's by conversation. */
type ExtractionRecord = { main: number | null; threads: Record<string, number> };

function entryIdOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * One small JSON file per project recording the newest `pi.compaction` entry that was extracted, main's and each
 * background thread's, so a restart neither repeats an extraction nor needs a table of its own.
 */
export class MemoryExtractionStore {
	readonly #projects: ProjectStore;
	readonly #log: (message: string) => void;
	readonly #cache = new Map<string, ExtractionRecord>();
	#queue: Promise<unknown> = Promise.resolve();

	constructor(options: MemoryExtractionStoreOptions) {
		this.#projects = options.projects;
		this.#log = options.log ?? (() => undefined);
	}

	fileOf(projectId: string): string {
		return join(this.#projects.projectDir(projectId), MEMORY_EXTRACTION_FILE);
	}

	async #record(projectId: string): Promise<ExtractionRecord> {
		const cached = this.#cache.get(projectId);
		if (cached !== undefined) return cached;
		let value: unknown;
		try {
			value = await readJsonFile(this.fileOf(projectId));
		} catch (error) {
			this.#log(`project ${projectId}: ${MEMORY_EXTRACTION_FILE} is unreadable: ${errorMessage(error)}`);
			return { main: null, threads: {} };
		}
		const raw = value as { lastProcessedEntryId?: unknown; threads?: unknown } | undefined;
		const threads: Record<string, number> = {};
		if (typeof raw?.threads === "object" && raw.threads !== null) {
			for (const [conversationId, entryId] of Object.entries(raw.threads)) {
				const id = entryIdOrNull(entryId);
				if (id !== null) threads[conversationId] = id;
			}
		}
		const record = { main: entryIdOrNull(raw?.lastProcessedEntryId), threads };
		this.#cache.set(projectId, record);
		return record;
	}

	/**
	 * The newest compaction entry already extracted from main (no `conversationId`) or from the background thread with
	 * that conversation, or null when none was.
	 */
	async lastProcessed(projectId: string, conversationId?: number): Promise<number | null> {
		const record = await this.#record(projectId);
		return conversationId === undefined ? record.main : (record.threads[String(conversationId)] ?? null);
	}

	/** Record that a compaction entry was handled. Only moves forward, so a late write cannot rewind it. */
	async markProcessed(projectId: string, entryId: number, conversationId?: number): Promise<void> {
		const run = this.#queue.then(async () => {
			const previous = await this.lastProcessed(projectId, conversationId);
			if (previous !== null && previous >= entryId) return;
			const current = await this.#record(projectId);
			const next: ExtractionRecord =
				conversationId === undefined
					? { ...current, main: entryId }
					: { ...current, threads: { ...current.threads, [String(conversationId)]: entryId } };
			await writeJsonFile(this.fileOf(projectId), { version: 1, lastProcessedEntryId: next.main, threads: next.threads });
			this.#cache.set(projectId, next);
		});
		this.#queue = run.catch((error: unknown) => {
			this.#log(`project ${projectId}: could not record the extracted compaction: ${errorMessage(error)}`);
		});
		await run;
	}
}

/** One entry of the compacted part as the extraction prompt shows it. */
export function describeCompactedEntry(entry: EntryRecord): string[] {
	const lines: string[] = [];
	for (const message of entry.model ?? []) {
		const text = contentText(message.content).trim();
		switch (message.role) {
			case "user":
				if (text.length > 0) lines.push(`[User]: ${text}`);
				break;
			case "assistant": {
				if (text.length > 0) lines.push(`[Assistant]: ${text}`);
				const calls = message.content.flatMap((block) =>
					block.type === "toolCall" ? [`${block.name}(${JSON.stringify(block.arguments)})`] : [],
				);
				if (calls.length > 0) lines.push(`[Assistant calls]: ${calls.join("; ")}`);
				break;
			}
			case "toolResult":
				if (text.length > 0) lines.push(`[Tool result]: ${text}`);
				break;
			default:
				break;
		}
	}
	return lines.map((line) => (line.length <= EXTRACTION_MESSAGE_CHARS ? line : `${line.slice(0, EXTRACTION_MESSAGE_CHARS)}…`));
}

/** The compacted part as one prompt, newest last, within `budget` characters (the oldest is cut first). */
export function serializeCompactedPart(
	entries: readonly EntryRecord[],
	budget = EXTRACTION_TRANSCRIPT_CHARS,
): { text: string; omitted: number } {
	const chunks = entries.map((entry) => describeCompactedEntry(entry).join("\n\n")).filter((chunk) => chunk.length > 0);
	const kept: string[] = [];
	let used = 0;
	let omitted = 0;
	for (let index = chunks.length - 1; index >= 0; index--) {
		const chunk = chunks[index] ?? "";
		if (used + chunk.length > budget) {
			omitted = index + 1;
			break;
		}
		used += chunk.length;
		kept.push(chunk);
	}
	kept.reverse();
	return { text: kept.join("\n\n"), omitted };
}

export type MemoryExtractionServiceOptions = {
	/** Read at each use, so a model change applies to the next extraction. */
	project(): Project;
	conversation: Conversation;
	/** Set for a background thread's conversation: its progress is recorded apart from main's. */
	background?: boolean;
	memory: MemoryStore;
	store: MemoryExtractionStore;
	models: Models;
	log?: (message: string) => void;
};

/**
 * One project's extraction: it finds compaction entries that were not extracted yet and runs one extraction for each.
 * Nothing else waits on it, and it runs at most one at a time.
 */
export class MemoryExtractionService {
	readonly #options: MemoryExtractionServiceOptions;
	readonly #log: (message: string) => void;
	#stopWatch: (() => Promise<void>) | undefined;
	#chain: Promise<void> = Promise.resolve();
	#stopped = false;
	#noModelLogged = false;

	constructor(options: MemoryExtractionServiceOptions) {
		this.#options = options;
		this.#log = options.log ?? (() => undefined);
	}

	/** The key the store records this conversation's progress under: none for main. */
	get #trackedConversation(): number | undefined {
		return this.#options.background === true ? this.#options.conversation.id : undefined;
	}

	/** Start watching the conversation and handle any compaction missed while the process was off. */
	async start(): Promise<void> {
		this.#stopped = false;
		try {
			const handle = await this.#options.conversation.watch(BACKGROUND_CONTEXT);
			handle.start(async (call) => {
				if (call.kind === "failed") throw call.error;
				const view = call.value;
				if (this.#stopped) return;
				// Only a new `pi.compaction` entry is worth a look; the durable scan below decides what is new.
				if (view.entries.some((entry) => entry.kind === COMPACTION_ENTRY)) this.wake();
			});
			handle.closed.then(() => {
				this.#stopWatch = undefined;
			});
			this.#stopWatch = async () => {
				await handle.stop();
			};
		} catch (error) {
			this.#log(`could not watch the conversation for compactions: ${errorMessage(error)}`);
		}
		this.wake();
	}

	/** Stop watching and wait for a run in progress, so nothing writes after the owner is gone. */
	async stop(): Promise<void> {
		this.#stopped = true;
		const stop = this.#stopWatch;
		this.#stopWatch = undefined;
		await stop?.().catch(() => undefined);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, 5_000);
			timer.unref?.();
		});
		await Promise.race([this.#chain.catch(() => undefined), timeout]);
		if (timer !== undefined) clearTimeout(timer);
	}

	/** Look for un-extracted compactions now; the work is queued behind a running extraction, never parallel to it. */
	wake(): void {
		const run = this.#chain.then(() => this.#drain());
		this.#chain = run.catch((error: unknown) => {
			this.#log(`extraction failed: ${errorMessage(error)}`);
		});
	}

	async #drain(): Promise<void> {
		while (!this.#stopped) {
			const entry = await this.#nextCompaction();
			if (entry === undefined) return;
			try {
				await this.#extract(entry);
			} catch (error) {
				this.#log(`extraction from compaction entry ${entry.id} failed: ${errorMessage(error)}`);
			}
			// Marked even after a failure: a compaction is handled once, so a provider that is down cannot make every
			// later start retry the same part. The next compaction extracts again.
			await this.#options.store.markProcessed(this.#options.project().id, entry.id, this.#trackedConversation);
		}
	}

	/** The oldest `pi.compaction` entry above the last one handled, reading durable entries only. */
	async #nextCompaction(): Promise<EntryRecord | undefined> {
		const projectId = this.#options.project().id;
		const last = (await this.#options.store.lastProcessed(projectId, this.#trackedConversation)) ?? 0;
		let cursor: Cursor | undefined;
		let scanned = 0;
		while (scanned < SCAN_MAX_ENTRIES) {
			const page = await this.#options.conversation.entries(
				{ minEntryId: (last + 1) as EntryId, order: "ascending" },
				SCAN_PAGE_ENTRIES,
				cursor,
				BACKGROUND_CONTEXT,
			);
			for (const entry of page.items) {
				scanned += 1;
				if (entry.kind === COMPACTION_ENTRY) return entry;
			}
			if (page.next === undefined) return undefined;
			cursor = page.next;
		}
		return undefined;
	}

	/**
	 * The entries a compaction replaced: everything the conversation's context held just before the compaction entry,
	 * minus the summary markers themselves. Read through `context({ at })`, so the head marker of the previous context
	 * is where the range starts.
	 */
	async compactedEntries(entry: EntryRecord): Promise<EntryRecord[]> {
		const head = entry.head;
		if (head === undefined) return [];
		const before = await this.#options.conversation.entries(
			{ maxEntryId: (entry.id - 1) as EntryId, order: "descending" },
			1,
			undefined,
			BACKGROUND_CONTEXT,
		);
		const last = before.items[0];
		if (last === undefined) return [];
		const view = await this.#options.conversation.context(BACKGROUND_CONTEXT, { at: last.id });
		return view.entries.filter(
			(candidate) =>
				candidate.id < head &&
				candidate.kind !== COMPACTION_ENTRY &&
				(candidate.model?.length ?? 0) > 0,
		);
	}

	async #extract(entry: EntryRecord): Promise<void> {
		const project = this.#options.project();
		const agent = await this.#options.conversation.agent(BACKGROUND_CONTEXT);
		if (agent.model === undefined) {
			if (!this.#noModelLogged) {
				this.#log("no coordinator model, so no memories are extracted from compactions");
				this.#noModelLogged = true;
			}
			return;
		}
		this.#noModelLogged = false;
		const compacted = await this.compactedEntries(entry);
		if (compacted.length === 0) return;
		const serialized = serializeCompactedPart(compacted);
		if (serialized.text.trim().length === 0) return;
		const editor = new MemoryEditor({
			store: this.#options.memory,
			projectId: project.id,
			scopes: ["global", "project"],
			source: { projectId: project.id, conversationId: this.#options.conversation.id, entryId: entry.id },
			log: this.#log,
		});
		const prompt = [
			`The earlier part of this conversation (entries before ${entry.head}) was just compacted. Here it is, as it was:`,
			"",
			"<compacted>",
			serialized.text,
			"</compacted>",
			...(serialized.omitted > 0
				? ["", `${serialized.omitted} older entries are not repeated here; save only from what is shown.`]
				: []),
			"",
			"Search memory first, then save what is worth keeping. Then answer with what you saved.",
		].join("\n");
		const answer = await runMemoryAgent({
			models: this.#options.models,
			model: agent.model,
			thinkingLevel: agent.thinkingLevel,
			systemPrompt: EXTRACTION_SYSTEM_PROMPT,
			prompt,
			tools: memoryAgentTools({ scopes: ["global", "project"], archives: false }),
			execute: memoryAgentExecutor(editor),
			log: this.#log,
		});
		const { commits } = await editor.commit({
			kind: "extraction",
			source: { projectId: project.id, conversationId: this.#options.conversation.id, entryId: entry.id },
			render: (scope, changes) => ({
				subject: `memory: extraction from conversation ${this.#options.conversation.id}`,
				body: [
					`Saved from the part of conversation ${this.#options.conversation.id} that the compaction at entry ${entry.id} replaced.`,
					"",
					describeBatchChanges(changes),
					...(answer.trim().length === 0 ? [] : ["", answer.trim()]),
				].join("\n"),
			}),
		});
		if (commits.length === 0) return;
		this.#log(
			`extracted memories from compaction entry ${entry.id} into ${commits
				.map((commit) => `${commit.scope} (${commit.commit.slice(0, 8)})`)
				.join(", ")}`,
		);
	}
}
