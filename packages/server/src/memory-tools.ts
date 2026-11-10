/**
 * The coordinator's memory: four tools and one system prompt section.
 *
 * Memory is read through search, so only two things are always in the prompt: short instructions and a catalog (counts
 * per tag per scope). The tools write topic files through `memory.ts`, which commits and reindexes them.
 *
 * Prompt-cache rule: the catalog's text may change only when a conversation starts and at each compaction, never on a
 * memory write. The section therefore embeds a marker with the transcript key it was rendered at — the newest head
 * marker (a `pi.compaction` summary) or `start` — and returns the text already in effect when that key still matches.
 * A memory write changes the files and the index but not the key, so the next request renders identical section text
 * and pi-durable writes no `pi.system` entry for it; compaction changes the key, so the section is rendered again.
 *
 * Workers get none of this: the project's worker conversations remove this extension, so they have neither the tools nor
 * the section, and reuse the coordinator-only guard pattern of `workers.ts` as a second line of defense.
 */
import type { Context } from "@earendil-works/chord/context";
import {
	type Conversation,
	defineExtension,
	defineTool,
	type Extension,
	type JsonObject,
	type PromptInput,
	section,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { MemoryFileSummary, MemoryScope, MemorySearchHit } from "@mihai-harness/protocol";
import { Type } from "typebox";
import { ServerError } from "./errors.ts";
import {
	type MemoryScopeStats,
	type MemorySource,
	type MemoryStore,
	type MemoryTarget,
	splitSections,
} from "./memory.ts";
import type { Coordinators } from "./coordinators.ts";
import type { Project } from "./projects.ts";

/** The prompt section's key, and the extension's name. */
export const MEMORY_SECTION = "memory";
export const MEMORY_EXTENSION = "memory-tools";

/** What the coordinator is told before every task. Static apart from the catalog it ends with. */
export const MEMORY_INSTRUCTIONS = [
	"You keep durable memory in two scopes: `global` (the user: preferences, habits, how they like to work) and `project` (this project: conventions, decisions and why, gotchas, where things are).",
	"Search memory before planning a task (`memory_search`, trying a few phrasings and tags), read a topic before editing it, and write durable facts as you learn them (`memory_write`).",
	"Update an existing topic instead of starting a near-duplicate, write facts rather than transcripts, and archive a topic that no longer holds instead of deleting it.",
	"A failure is not a durable fact from one attempt: a flaky network, a missing env var, a transient error can look permanent and not be. Retry it, or try another way, before memory_write turns it into \"X doesn't work\" — and when it really is durable, write what you tried and saw, not just the conclusion, so the entry is evidence rather than a guess.",
	"Workers have no memory tools: put the relevant memories into a worker's brief, and write down what its report teaches you.",
].join("\n");

export type MemoryCatalog = { global: MemoryScopeStats; project: MemoryScopeStats };

/** The marker that makes the section's text identifiable in the transcript, so a memory write never changes it. */
export function memorySectionMarker(key: string): string {
	return `<!-- memory-catalog: ${key} -->`;
}

/** The transcript key: the newest compaction's summary entry, or `start` before any. */
export function memorySectionKey(head: { readonly id: number } | undefined): string {
	return head === undefined ? "start" : `context-${head.id}`;
}

function describeStats(stats: MemoryScopeStats): string {
	const topics = `${stats.files} topic${stats.files === 1 ? "" : "s"}`;
	const tags = Object.entries(stats.tags);
	if (tags.length === 0) return `${topics}, no tags`;
	return `${topics}; tags: ${tags.map(([tag, count]) => `${tag} ${count}`).join(", ")}`;
}

/** The section's text at one key: instructions, the catalog, and the key it was rendered at. */
export function renderMemorySection(catalog: MemoryCatalog, key: string): string {
	return [
		"<memory>",
		MEMORY_INSTRUCTIONS,
		"",
		"Memory catalog (counts per tag; refreshed when a conversation starts and after each compaction):",
		`- global: ${describeStats(catalog.global)}`,
		`- project: ${describeStats(catalog.project)}`,
		memorySectionMarker(key),
		"</memory>",
	].join("\n");
}

function toolText(text: string, options: { isError?: boolean; details?: JsonObject } = {}): {
	output: { type: "text"; text: string }[];
	isError?: boolean;
	details?: JsonObject;
} {
	return {
		output: [{ type: "text", text }],
		...(options.isError === true ? { isError: true } : {}),
		...(options.details === undefined ? {} : { details: options.details }),
	};
}

/** A snippet with the protocol's match markers removed, one line, short enough for a tool result. */
function plainSnippet(snippet: string, max: number): string {
	const text = snippet.replace(/[\u0002\u0003]/g, "").replace(/\s+/g, " ").trim();
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function describeHit(hit: MemorySearchHit): string {
	const where = hit.heading === null ? "intro" : `"${hit.heading}"`;
	return `${hit.scope}:${hit.fileId} — ${hit.title} (${where}, rank ${hit.rank.toFixed(2)})\n  ${plainSnippet(hit.snippet, 400)}`;
}

function describeMatch(hit: MemorySearchHit): string {
	return `- ${hit.scope}:${hit.fileId} — ${hit.title}${hit.heading === null ? "" : `, section "${hit.heading}"`}: ${plainSnippet(hit.snippet, 160)}`;
}

export type MemoryServiceOptions = {
	store: MemoryStore;
	/** Read at each use, so a reconfigured project applies to the next tool call. */
	project(): Project;
	/** The coordinator conversation: the only one with memory tools and a memory section. */
	conversation: Conversation;
	/** Every coordinator conversation of the project (main and its background threads); default: main only. */
	coordinators?: Coordinators;
	log?: (message: string) => void;
};

/**
 * One project's coordinator memory: the tools, the prompt section and the source stamp of each write. The project's
 * scope is `projects/<id>/memory/`; the global scope is shared by every project of the backend.
 */
export class MemoryService {
	readonly #options: MemoryServiceOptions;
	#extension: Extension | undefined;

	constructor(options: MemoryServiceOptions) {
		this.#options = options;
	}

	get store(): MemoryStore {
		return this.#options.store;
	}

	get project(): Project {
		return this.#options.project();
	}

	get conversation(): Conversation {
		return this.#options.conversation;
	}

	/** The extension the coordinator selects and workers remove: the four tools and the catalog section. */
	get extension(): Extension {
		this.#extension ??= createMemoryExtension(this);
		return this.#extension;
	}

	/** The scope a tool's `scope` argument addresses; the project's when omitted. */
	target(scope: MemoryScope | undefined): MemoryTarget {
		return scope === "global" ? { scope: "global" } : { scope: "project", projectId: this.project.id };
	}

	/** Where a write came from. The tool call's own entry is committed after it runs, so its ID is not known yet. */
	source(conversationId: number): MemorySource {
		return { projectId: this.project.id, conversationId, entryId: null };
	}

	/** What a memory tool answers outside the coordinator, which only a deliberately re-added extension reaches. */
	notCoordinatorMessage(tool: string): string {
		return `${tool} answers only the project's coordinator conversation. A worker has no memory: report what you learned and let the coordinator decide what to keep.`;
	}

	isCoordinator(conversationId: number): boolean {
		const coordinators = this.#options.coordinators;
		return coordinators === undefined ? conversationId === this.conversation.id : coordinators.isCoordinator(conversationId);
	}

	/** The catalog's transcript key: the newest compaction summary, or `start`. */
	async sectionKey(context: Context, conversationId: number = this.conversation.id): Promise<string> {
		const conversation =
			conversationId === this.conversation.id
				? this.conversation
				: await this.#options.coordinators?.conversation(conversationId, context);
		if (conversation === undefined) return "start";
		const view = await conversation.context(context);
		return memorySectionKey(view.head);
	}

	/** The catalog of the two scopes as they are now. */
	async catalog(): Promise<MemoryCatalog> {
		return this.store.stats(this.project.id);
	}

	/**
	 * The catalog as this conversation saw it, or a fresh one when the key changed. Returning the shown text verbatim is
	 * what keeps the prompt stable across memory writes; the key changes only at a start and at a compaction.
	 */
	async renderSection(input: PromptInput, context: Context): Promise<string | undefined> {
		if (!this.isCoordinator(input.conversationId)) return undefined;
		let key: string;
		try {
			key = await this.sectionKey(context, input.conversationId);
		} catch {
			key = "start";
		}
		const marker = memorySectionMarker(key);
		const shown = input.shown[MEMORY_SECTION];
		if (shown !== undefined && shown.includes(marker)) return shown;
		return renderMemorySection(await this.catalog(), key);
	}

	/** A read topic's links as `global:<id> — <title>: <summary>`, or a plain note when one is missing. */
	async describeLinks(links: readonly string[]): Promise<string[]> {
		const lines: string[] = [];
		for (const link of links.slice(0, 20)) {
			const scope: MemoryScope = link.startsWith("global:") ? "global" : "project";
			const fileId = link.startsWith("global:") ? link.slice("global:".length) : link;
			try {
				const file = await this.store.read(scope, this.project.id, fileId);
				lines.push(`- ${link}: ${file.file.title} — ${file.file.summary}`);
			} catch {
				lines.push(`- ${link}: (no such topic)`);
			}
		}
		return lines;
	}
}

const scopeSchema = (description: string) =>
	Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("project")], { description }));

function createMemoryExtension(service: MemoryService): Extension {
	const searchTool = defineTool({
		name: "memory_search",
		description:
			"Search durable memory and get matching sections, best first. The files are split into topics and `##` " +
			"sections, so this returns the parts that match instead of whole files. Search before planning a task, and " +
			"try a few phrasings and tags when the first one misses.",
		parameters: Type.Object({
			query: Type.String({ minLength: 1, description: "Words to match; several phrasings work better than one." }),
			scope: Type.Optional(
				Type.Union([Type.Literal("both"), Type.Literal("global"), Type.Literal("project")], {
					description: 'Default "both": the user and this project.',
				}),
			),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Only topics carrying all of these tags." })),
			includeArchived: Type.Optional(Type.Boolean({ description: "Also search archived topics. Default false." })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Default 10." })),
		}),
		replay: "safe",
		execute: async (args, api) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("memory_search"), { isError: true });
			}
			const hits = await service.store.search({
				query: args.query,
				scope: args.scope ?? "both",
				projectId: service.project.id,
				...(args.tags === undefined ? {} : { tags: args.tags }),
				...(args.includeArchived === undefined ? {} : { includeArchived: args.includeArchived }),
				limit: args.limit ?? 10,
			});
			if (hits.length === 0) {
				return toolText(
					`No memory matched "${args.query}". Try other words${args.tags === undefined ? " or tags" : ""}, or search with includeArchived for retired topics.`,
					{ details: { hits: 0 } },
				);
			}
			return toolText(hits.map(describeHit).join("\n\n"), { details: { hits: hits.length } });
		},
	});

	const readTool = defineTool({
		name: "memory_read",
		description:
			"Read one memory topic: its whole body, or only the sections you name. Use it after memory_search, before " +
			"editing a topic, and to follow its links to related topics.",
		parameters: Type.Object({
			fileId: Type.String({ minLength: 1, description: 'The topic name, without ".md".' }),
			scope: scopeSchema("Where the topic is. Default: project, then global."),
			sections: Type.Optional(Type.Array(Type.String(), { description: "Only these `##` headings." })),
		}),
		replay: "safe",
		execute: async (args, api) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("memory_read"), { isError: true });
			}
			const scopes: MemoryScope[] = args.scope === undefined ? ["project", "global"] : [args.scope];
			let found: { scope: MemoryScope; file: MemoryFileSummary; body: string } | undefined;
			for (const scope of scopes) {
				try {
					const read = await service.store.read(scope, service.project.id, args.fileId);
					found = { scope, file: read.file, body: read.body };
					break;
				} catch (error) {
					if (error instanceof ServerError && error.code === "unknown_memory") continue;
					throw error;
				}
			}
			if (found === undefined) {
				return toolText(
					`No memory "${args.fileId}" in ${scopes.join(" or ")}. memory_search finds the topics that exist.`,
					{ isError: true },
				);
			}
			const { scope, file, body } = found;
			const { intro, sections } = splitSections(body);
			const wanted = args.sections?.map((heading) => heading.trim().toLowerCase()).filter((heading) => heading.length > 0);
			const selected =
				wanted === undefined
					? sections
					: sections.filter((section) => wanted.includes(section.heading.toLowerCase()));
			const missing =
				wanted === undefined
					? []
					: args.sections!.filter(
							(heading) => !sections.some((section) => section.heading.toLowerCase() === heading.trim().toLowerCase()),
						);
			const links = await service.describeLinks(file.links);
			const lines = [
				`${scope}:${file.fileId} — ${file.title}`,
				`Summary: ${file.summary}`,
				`Tags: ${file.tags.length === 0 ? "none" : file.tags.join(", ")}; status: ${file.status}${file.supersededBy === null ? "" : `, superseded by ${file.supersededBy}`}`,
				`Updated: ${file.updated}`,
			];
			if (links.length > 0) lines.push("", "Links:", ...links);
			if (wanted === undefined && intro.trim().length > 0) lines.push("", intro.trim());
			for (const section of selected) lines.push("", `## ${section.heading}`, "", section.text.trim());
			if (wanted !== undefined && selected.length === 0) {
				lines.push(
					"",
					`No section matched. The topic has: ${sections.map((section) => section.heading).join(", ") || "no sections"}.`,
				);
			}
			if (missing.length > 0) lines.push("", `Not found: ${missing.join(", ")}.`);
			return toolText(lines.join("\n"), { details: { scope, fileId: file.fileId } });
		},
	});

	const writeTool = defineTool({
		name: "memory_write",
		description:
			"Write durable memory: add or replace one `##` section of a topic, update its front matter, or start a new " +
			"topic. Every write is one git commit. Before a new topic is created it returns close matches, so an existing " +
			"topic is updated instead of duplicated; pass `create: true` to start one anyway. Write facts, not transcripts.",
		parameters: Type.Object({
			fileId: Type.String({
				minLength: 1,
				maxLength: 64,
				description: 'Topic name, lowercase, without ".md" (for example "testing").',
			}),
			text: Type.String({ minLength: 1, description: "The section's markdown, or the file's intro when no heading." }),
			scope: scopeSchema('Default "project".'),
			heading: Type.Optional(
				Type.String({ description: "The `##` section to add or replace. Omit to write the file's intro text." }),
			),
			title: Type.Optional(Type.String({ description: "Shown by search and in the app." })),
			summary: Type.Optional(Type.String({ description: "One line: what this topic is about." })),
			tags: Type.Optional(Type.Array(Type.String(), { description: "For search and the catalog." })),
			links: Type.Optional(
				Type.Array(Type.String(), {
					description: 'Related topics: a fileId in the same scope, or "global:<fileId>".',
				}),
			),
			create: Type.Optional(
				Type.Boolean({ description: "Start a new topic even when close matches exist. Default false." }),
			),
		}),
		replay: "safe",
		execute: async (args, api) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("memory_write"), { isError: true });
			}
			const target = service.target(args.scope);
			const result = await service.store.write({
				target,
				fileId: args.fileId,
				text: args.text,
				...(args.heading === undefined ? {} : { heading: args.heading }),
				...(args.title === undefined ? {} : { title: args.title }),
				...(args.summary === undefined ? {} : { summary: args.summary }),
				...(args.tags === undefined ? {} : { tags: args.tags }),
				...(args.links === undefined ? {} : { links: args.links }),
				...(args.create === undefined ? {} : { create: args.create }),
				source: service.source(api.conversationId),
			});
			const name = `${target.scope}:${args.fileId}`;
			if (result.kind === "suggest") {
				return toolText(
					[
						`Memory close to ${name} already exists, so nothing was created. Update one of these instead:`,
						...result.matches.map(describeMatch),
						"",
						`Call memory_write again with one of those fileIds (and its scope), or pass create: true to start ${name} anyway.`,
					].join("\n"),
					{ details: { created: false, matches: result.matches.length } },
				);
			}
			const commit = result.commit === null ? "" : ` Commit ${result.commit.slice(0, 8)}.`;
			const details = { scope: target.scope, fileId: args.fileId, created: result.kind === "created" };
			if (result.kind === "created") {
				return toolText(
					`Created ${name} — "${result.topic.title}", ${result.topic.sections.length} section${result.topic.sections.length === 1 ? "" : "s"}.${commit} It is searchable now.`,
					{ details },
				);
			}
			if (result.kind === "unchanged") {
				return toolText(`${name} already reads that way; nothing was written.`, { details });
			}
			const what = args.heading === undefined ? "the intro" : `section "${args.heading}"`;
			return toolText(`Updated ${what} of ${name}, ${result.topic.sections.length} sections in all.${commit}`, {
				details,
			});
		},
	});

	const archiveTool = defineTool({
		name: "memory_archive",
		description:
			"Retire a whole topic that no longer holds: it keeps its history, stops appearing in search and the " +
			"catalog, and can still be searched with includeArchived. Outdated facts inside a topic are edited out with " +
			"memory_write instead, because git history keeps them.",
		parameters: Type.Object({
			fileId: Type.String({ minLength: 1, description: "The topic to archive." }),
			scope: scopeSchema('Default "project".'),
			reason: Type.Optional(Type.String({ description: "Why it is retired; goes into the commit message." })),
		}),
		replay: "safe",
		execute: async (args, api) => {
			if (!service.isCoordinator(api.conversationId)) {
				return toolText(service.notCoordinatorMessage("memory_archive"), { isError: true });
			}
			const target = service.target(args.scope);
			const result = await service.store.archive(target, args.fileId, {
				source: service.source(api.conversationId),
				...(args.reason === undefined ? {} : { reason: args.reason }),
			});
			const name = `${target.scope}:${args.fileId}`;
			const commit = result.commit === null ? "" : ` Commit ${result.commit.slice(0, 8)}.`;
			if (result.kind === "unchanged") return toolText(`${name} is already archived.`);
			return toolText(
				`Archived ${name}. It leaves search and the catalog; includeArchived still finds it, and git history has it.${commit}`,
				{ details: { scope: target.scope, fileId: args.fileId } },
			);
		},
	});

	return defineExtension({
		name: MEMORY_EXTENSION,
		tools: [searchTool, readTool, writeTool, archiveTool] as ToolRegistration[],
		sections: [
			section(MEMORY_SECTION, (input, context) => service.renderSection(input, context), { tag: false }),
		],
	});
}
