/**
 * The coordinator's `history` tool: this conversation's own earlier entries, searched or read by ID.
 *
 * Compaction only shrinks what the model sees. The entries it replaces stay in storage, and the summary says so, so the
 * coordinator can go back to them instead of reconstructing them from memory: `query` searches the transcript (past a
 * summary, past resets), and `from`/`to` reads a range of entries as they were.
 *
 * Prompt-cache rule: the tool adds no system prompt section. Its description is static, and its answers are ordinary
 * tool results, so a search never re-renders the prompt the way a section would.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import {
	type Conversation,
	type Cursor,
	type EntryId,
	type EntryRecord,
	type Extension,
	type JsonObject,
	type ToolRegistration,
	defineExtension,
	defineTool,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { Coordinators } from "./coordinators.ts";
import { errorMessage } from "./errors.ts";

/** The tool's name and its extension's; workers remove the extension, so they have neither. */
export const HISTORY_TOOL = "history";
export const HISTORY_EXTENSION = "history-tool";

/** Matches one search answers with when the caller does not say. */
const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 40;
/** Entries one page of a scan reads. */
const SEARCH_PAGE_ENTRIES = 200;
/** An answer stops after this many entries and says how to go further back. */
const MAX_SCANNED_ENTRIES = 3_000;
/** Characters of context a hit shows around its first match. */
const SNIPPET_CHARS = 200;
/** Entries one range read returns, and characters each keeps. */
const READ_MAX_ENTRIES = 40;
const READ_ENTRY_CHARS = 1_000;
/** Longest answer, in characters, so a search cannot fill the context it is trying to save. */
const MAX_OUTPUT_CHARS = 6_000;

/** Longest part of a tool result or an entry the rendering keeps before it marks the rest as cut. */
function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

/** One message of an entry as a line or two for the model: who said it, the text, and the tools it called. */
function messageLines(message: Message): string[] {
	switch (message.role) {
		case "user": {
			const text = contentText(message.content).trim();
			return text.length === 0 ? [] : [`user: ${text}`];
		}
		case "assistant": {
			const lines: string[] = [];
			const text = contentText(message.content).trim();
			if (text.length > 0) lines.push(`assistant: ${text}`);
			const calls = message.content.flatMap((block) =>
				block.type === "toolCall"
					? [
							`${block.name}(${Object.entries(block.arguments)
								.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
								.join(", ")})`,
						]
					: [],
			);
			if (calls.length > 0) lines.push(`assistant called: ${calls.join("; ")}`);
			return lines;
		}
		case "toolResult": {
			const text = contentText(message.content).trim();
			return text.length === 0 ? [] : [`tool result${message.isError === true ? " (error)" : ""}: ${text}`];
		}
		default:
			return [];
	}
}

/** An entry's text as the tool shows it: its messages in order, each clipped. */
export function describeEntry(entry: EntryRecord, entryChars = READ_ENTRY_CHARS): string {
	const lines = (entry.model ?? []).flatMap(messageLines);
	if (lines.length === 0) return `#${entry.id} ${entry.kind}\n  (no text)`;
	return `#${entry.id} ${entry.kind}\n${lines.map((line) => `  ${clip(line, entryChars)}`).join("\n")}`;
}

/** An entry's text for matching, one line, without the role labels. */
function searchableText(entry: EntryRecord): string {
	return (entry.model ?? [])
		.flatMap(messageLines)
		.join("\n")
		.toLowerCase();
}

/** A short window of `text` around the first term it contains, with the whitespace collapsed. */
function snippetAround(text: string, terms: readonly string[]): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const lower = flat.toLowerCase();
	let at = -1;
	for (const term of terms) {
		const found = lower.indexOf(term);
		if (found !== -1 && (at === -1 || found < at)) at = found;
	}
	if (at === -1 || flat.length <= SNIPPET_CHARS) return clip(flat, SNIPPET_CHARS);
	const start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3));
	const window = flat.slice(start, start + SNIPPET_CHARS);
	return `${start > 0 ? "…" : ""}${window}${start + SNIPPET_CHARS < flat.length ? "…" : ""}`;
}

/** The role a hit is mostly about, so a list reads at a glance. */
function entryRole(entry: EntryRecord): string {
	const message = entry.model?.[0];
	switch (message?.role) {
		case "user":
			return "user";
		case "assistant":
			return "assistant";
		case "toolResult":
			return "tool result";
		default:
			return entry.kind;
	}
}

/** The words a query searches for, lowercased; every one has to appear in an entry for it to match. */
export function searchTerms(query: string): string[] {
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 0);
}

export type HistoryHit = { id: number; kind: string; role: string; snippet: string };

/** The entries of one page that match every term of the query. */
function hitsOf(entries: readonly EntryRecord[], terms: readonly string[]): HistoryHit[] {
	const hits: HistoryHit[] = [];
	for (const entry of entries) {
		const text = searchableText(entry);
		if (!terms.every((term) => text.includes(term))) continue;
		hits.push({ id: entry.id, kind: entry.kind, role: entryRole(entry), snippet: snippetAround(text, terms) });
	}
	return hits;
}

export type HistoryServiceOptions = {
	/** The coordinator conversation: only it may search the transcript through this tool. */
	conversation: Conversation;
	/** Every coordinator conversation (main and its background threads); each searches its own transcript. */
	coordinators?: Coordinators;
};

/**
 * Search and range reads over the conversation's durable entries. Both walk the storage, not the active (post-compaction)
 * context, which is what makes the tool able to reach entries the model can no longer see.
 */
export class HistoryService {
	readonly #conversation: Conversation;
	readonly #coordinators: Coordinators | undefined;
	#extension: Extension | undefined;

	constructor(options: HistoryServiceOptions) {
		this.#conversation = options.conversation;
		this.#coordinators = options.coordinators;
	}

	/** The transcript a call reads: the calling coordinator's own. */
	async #transcript(conversationId: number | undefined, context: Context): Promise<Conversation> {
		if (conversationId === undefined || conversationId === this.#conversation.id) return this.#conversation;
		return (await this.#coordinators?.conversation(conversationId, context)) ?? this.#conversation;
	}

	get extension(): Extension {
		this.#extension ??= createHistoryExtension(this);
		return this.#extension;
	}

	/** Whether a tool call comes from the conversation this extension belongs to: the project's coordinator. */
	isCoordinator(conversationId: number): boolean {
		return this.#coordinators === undefined
			? conversationId === this.#conversation.id
			: this.#coordinators.isCoordinator(conversationId);
	}

	/** Search entries, newest first, for the words of `query`, optionally inside an entry-ID range. */
	async search(options: {
		query: string;
		limit: number;
		from?: number;
		to?: number;
		context?: Context;
		conversationId?: number;
	}): Promise<{ hits: HistoryHit[]; scanned: number; truncated: boolean }> {
		const terms = searchTerms(options.query);
		if (terms.length === 0) return { hits: [], scanned: 0, truncated: false };
		const context = options.context ?? BACKGROUND_CONTEXT;
		const conversation = await this.#transcript(options.conversationId, context);
		const hits: HistoryHit[] = [];
		let cursor: Cursor | undefined;
		let scanned = 0;
		let truncated = false;
		while (scanned < MAX_SCANNED_ENTRIES) {
			const page = await conversation.entries(
				{
					...(options.from === undefined ? {} : { minEntryId: options.from as EntryId }),
					...(options.to === undefined ? {} : { maxEntryId: options.to as EntryId }),
					order: "descending",
				},
				SEARCH_PAGE_ENTRIES,
				cursor,
				context,
			);
			scanned += page.items.length;
			for (const hit of hitsOf(page.items, terms)) {
				hits.push(hit);
				if (hits.length >= options.limit) {
					truncated = true;
					break;
				}
			}
			if (truncated || page.next === undefined) break;
			cursor = page.next;
		}
		return { hits, scanned, truncated: truncated || scanned >= MAX_SCANNED_ENTRIES };
	}

	/** Entries of a range, oldest first, so a range reads the way the conversation happened. */
	async read(options: {
		from?: number;
		to?: number;
		limit: number;
		context?: Context;
		conversationId?: number;
	}): Promise<{ entries: readonly EntryRecord[]; more: boolean }> {
		const conversation = await this.#transcript(options.conversationId, options.context ?? BACKGROUND_CONTEXT);
		const page = await conversation.entries(
			{
				...(options.from === undefined ? {} : { minEntryId: options.from as EntryId }),
				...(options.to === undefined ? {} : { maxEntryId: options.to as EntryId }),
				order: "ascending",
			},
			options.limit,
			undefined,
			options.context ?? BACKGROUND_CONTEXT,
		);
		return { entries: page.items, more: page.next !== undefined };
	}
}

function renderSearch(
	query: string,
	result: { hits: readonly HistoryHit[]; scanned: number; truncated: boolean },
): string {
	if (result.hits.length === 0) {
		return `No entry of this conversation contains every word of "${query}" in the ${result.scanned} entries searched. Try fewer or different words, or pass \`from\`/\`to\` to widen the range.`;
	}
	const lines = result.hits.map((hit) => `#${hit.id} ${hit.role} (${hit.kind})\n  ${hit.snippet}`);
	const notes: string[] = [];
	if (result.truncated) {
		const oldest = result.hits.at(-1)?.id;
		notes.push(
			`Stopped here${oldest === undefined ? "" : `; pass \`to: ${oldest - 1}\``} to search further back.`,
		);
	}
	return [
		`Matches for "${query}", newest first (${result.hits.length} of ${result.scanned} entries searched):`,
		...lines,
		...(notes.length === 0 ? [] : ["", ...notes]),
	].join("\n");
}

function renderRange(result: { entries: readonly EntryRecord[]; more: boolean }): string {
	if (result.entries.length === 0) return "No entries in that range.";
	const last = result.entries.at(-1);
	const lines = result.entries.map((entry) => describeEntry(entry));
	if (result.more && last !== undefined) lines.push(`More entries follow; read them with \`from: ${last.id + 1}\`.`);
	return lines.join("\n\n");
}

function toolText(text: string, options: { isError?: boolean; details?: JsonObject } = {}): {
	output: { type: "text"; text: string }[];
	isError?: boolean;
	details?: JsonObject;
} {
	// The answer is clipped as a whole; say so, so the model asks for a narrower range instead of assuming it saw all.
	const clipped =
		text.length <= MAX_OUTPUT_CHARS
			? text
			: `${text.slice(0, MAX_OUTPUT_CHARS)}\n[answer truncated; ask for a smaller range or fewer matches]`;
	return {
		output: [{ type: "text", text: clipped }],
		...(options.isError === true ? { isError: true } : {}),
		...(options.details === undefined ? {} : { details: options.details }),
	};
}

function createHistoryExtension(service: HistoryService): Extension {
	const historyTool = defineTool({
		name: HISTORY_TOOL,
		description:
			"Search this conversation's earlier entries, or read a range of them by entry ID. Compaction only shortens " +
			"what you see: the entries stay, including the ones a summary replaced, so use this to recover a detail a " +
			"summary left out instead of guessing. `query` searches for entries containing every word; `from`/`to` " +
			"read entries (oldest first) or narrow a search to an ID range.",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({ minLength: 1, description: "Words to search for; an entry matches when it has all of them." }),
			),
			from: Type.Optional(
				Type.Integer({ minimum: 1, description: "First entry ID to read, or the oldest ID a search may return." }),
			),
			to: Type.Optional(
				Type.Integer({ minimum: 1, description: "Last entry ID to read, or the newest ID a search may return." }),
			),
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: MAX_SEARCH_LIMIT,
					description: `Most hits or entries to return (default ${DEFAULT_SEARCH_LIMIT}, at most ${MAX_SEARCH_LIMIT}).`,
				}),
			),
		}),
		// A search or a read changes nothing, so a rerun after a crash is harmless.
		replay: "safe",
		execute: async (args, api, context) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(
					`\`${HISTORY_TOOL}\` belongs to the project's coordinator; a worker reads its own conversation, not the coordinator's transcript.`,
					{ isError: true },
				);
			}
			const limit = Math.min(MAX_SEARCH_LIMIT, args.limit ?? DEFAULT_SEARCH_LIMIT);
			try {
				if (args.query !== undefined) {
					const result = await service.search({
						query: args.query,
						limit,
						...(args.from === undefined ? {} : { from: args.from }),
						...(args.to === undefined ? {} : { to: args.to }),
						context,
						conversationId: api.conversationId,
					});
					return toolText(renderSearch(args.query, result), {
						details: { hits: result.hits.map((hit) => hit.id) },
					});
				}
				if (args.from !== undefined || args.to !== undefined) {
					const result = await service.read({
						...(args.from === undefined ? {} : { from: args.from }),
						...(args.to === undefined ? {} : { to: args.to }),
						limit: Math.min(READ_MAX_ENTRIES, limit),
						context,
						conversationId: api.conversationId,
					});
					return toolText(renderRange(result), { details: { entries: result.entries.map((entry) => entry.id) } });
				}
				return toolText(
					"Give `query` to search this conversation's earlier entries, or `from`/`to` to read a range of them.",
					{ isError: true },
				);
			} catch (error) {
				return toolText(`Reading the transcript failed: ${errorMessage(error)}`, { isError: true });
			}
		},
	});

	return defineExtension({
		name: HISTORY_EXTENSION,
		tools: [historyTool] as ToolRegistration[],
	});
}
