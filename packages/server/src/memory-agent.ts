/**
 * The memory work a model does on its own: the tool loop both the extraction after a compaction and the maintenance run
 * use, and the editor that turns their writes into one commit per scope.
 *
 * Neither run is a conversation. There is no transcript to keep and nothing to resume, so the loop is a plain
 * `completeSimple` exchange: ask with a system prompt, a user message and the memory tools; run the calls; ask again
 * until the model stops calling tools. Every write is staged in an in-memory copy of the scope's topics, so the model
 * sees its own earlier writes while it works and the scope gets one commit at the end (one per scope, because global and
 * project memory are separate git repositories).
 *
 * The tools are the coordinator's four, narrowed to the scope(s) of the run: an extraction may write to both scopes, a
 * maintenance run only to its own.
 */
import { contentText } from "@earendil-works/pi-ai";
import type { AssistantMessage, Message, Models, Tool } from "@earendil-works/pi-ai";
import type { MemoryScope, ModelRef, ThinkingLevel } from "@mihai-harness/protocol";
import { Type } from "typebox";
import { ServerError, errorMessage } from "./errors.ts";
import {
	type MemoryBatchChange,
	type MemoryBatchOperation,
	type MemoryRetrieval,
	type MemoryScopeStore,
	type MemorySource,
	type MemoryStore,
	type MemoryTarget,
	type MemoryTopic,
	applyArchiveToTopics,
	applyWriteToTopics,
	renderCommitMessage,
	scopeKey,
	searchTopics,
} from "./memory.ts";

/** The longest answer one round of the loop may take, so a model cannot run away with the memory's budget. */
const MAX_ANSWER_TOKENS = 2_000;
/** Rounds of tool calls one run allows before it stops asking. */
export const MAX_MEMORY_AGENT_ROUNDS = 12;

/** The tool names both runs offer, and the executor below answers. */
export const MEMORY_AGENT_TOOLS = ["memory_search", "memory_read", "memory_list", "memory_write", "memory_archive"] as const;
export type MemoryAgentToolName = (typeof MEMORY_AGENT_TOOLS)[number];

/** The tools as pi-ai wants them: a name, a description and a TypeBox schema. */
export function memoryAgentTools(options: { scopes: readonly MemoryScope[]; archives: boolean }): Tool[] {
	const scope = options.scopes.length > 1
		? Type.Optional(
				Type.Union([Type.Literal("global"), Type.Literal("project")], {
					description: 'Which memory. Default "project".',
				}),
			)
		: undefined;
	const tools: Tool[] = [
		{
			name: "memory_list",
			description: "Every topic in the scope with its title, summary, tags, sections and status.",
			parameters: Type.Object({
				includeArchived: Type.Optional(Type.Boolean({ description: "Default false." })),
			}),
		},
		{
			name: "memory_search",
			description: "Search the scope's sections and get the matching ones, best first.",
			parameters: Type.Object({
				query: Type.String({ minLength: 1 }),
				tags: Type.Optional(Type.Array(Type.String())),
				includeArchived: Type.Optional(Type.Boolean()),
			}),
		},
		{
			name: "memory_read",
			description: "Read one topic whole, or only the sections you name.",
			parameters: Type.Object({
				fileId: Type.String({ minLength: 1 }),
				sections: Type.Optional(Type.Array(Type.String())),
				...(scope === undefined ? {} : { scope }),
			}),
		},
		{
			name: "memory_write",
			description:
				"Add or replace one `##` section of a topic, write its intro, or create a topic. Updating an existing " +
				"topic is always better than duplicating it. Every write is staged; the whole run is one commit.",
			parameters: Type.Object({
				fileId: Type.String({ minLength: 1, maxLength: 64 }),
				text: Type.String({ minLength: 1 }),
				heading: Type.Optional(Type.String()),
				title: Type.Optional(Type.String()),
				summary: Type.Optional(Type.String()),
				tags: Type.Optional(Type.Array(Type.String())),
				links: Type.Optional(Type.Array(Type.String())),
				create: Type.Optional(Type.Boolean()),
				...(scope === undefined ? {} : { scope }),
			}),
		},
	];
	if (options.archives) {
		tools.push({
			name: "memory_archive",
			description: "Retire a whole topic that no longer holds. It keeps its history and stays readable on request.",
			parameters: Type.Object({
				fileId: Type.String({ minLength: 1 }),
				reason: Type.Optional(Type.String()),
				...(scope === undefined ? {} : { scope }),
			}),
		});
	}
	return tools;
}

export type MemoryAgentRun = {
	models: Models;
	model: ModelRef;
	thinkingLevel?: ThinkingLevel | null;
	systemPrompt: string;
	prompt: string;
	execute: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
	tools: Tool[];
	log?: (message: string) => void;
};

/**
 * Ask the model, run the tool calls it makes, and ask again until it answers without one. Returns the last text it said.
 * A provider failure is thrown, so the caller can record it as the run's outcome; nothing here retries.
 */
export async function runMemoryAgent(run: MemoryAgentRun): Promise<string> {
	const model = run.models.getModel(run.model.provider, run.model.modelId);
	if (model === undefined) {
		throw new ServerError("unknown_model", `Unknown model ${run.model.provider}/${run.model.modelId}`);
	}
	const messages: Message[] = [{ role: "user", content: run.prompt, timestamp: Date.now() }];
	let text = "";
	for (let round = 0; round < MAX_MEMORY_AGENT_ROUNDS; round += 1) {
		const answer = await run.models.completeSimple(
			model,
			{ systemPrompt: run.systemPrompt, messages, tools: run.tools },
			{
				cacheRetention: "none",
				maxTokens: Math.min(MAX_ANSWER_TOKENS, model.maxTokens > 0 ? model.maxTokens : MAX_ANSWER_TOKENS),
				...(run.thinkingLevel === undefined || run.thinkingLevel === null || run.thinkingLevel === "off"
					? {}
					: { reasoning: run.thinkingLevel }),
			},
		);
		if (answer.stopReason === "error" || answer.stopReason === "aborted") {
			throw new ServerError("harness_failed", answer.errorMessage ?? `The model stopped: ${answer.stopReason}`);
		}
		const calls = answer.content.filter((block) => block.type === "toolCall");
		messages.push(answer);
		const spoken = contentText(answer.content).trim();
		if (spoken.length > 0) text = spoken;
		if (calls.length === 0) return text;
		for (const call of calls) {
			const result = await run.execute(call.name, call.arguments as Record<string, unknown>);
			messages.push({
				role: "toolResult",
				toolCallId: call.id,
				toolName: call.name,
				content: [{ type: "text", text: result.text }],
				isError: result.isError === true,
				timestamp: Date.now(),
			});
		}
	}
	run.log?.(`memory agent stopped after ${MAX_MEMORY_AGENT_ROUNDS} rounds of tool calls`);
	return text;
}

/** One scope's staged state: what the model sees while it works, and the operations the commit replays. */
type StagedScope = {
	target: MemoryTarget;
	store: MemoryScopeStore;
	topics: Map<string, MemoryTopic>;
	operations: MemoryBatchOperation[];
};

export type MemoryEditorOptions = {
	store: MemoryStore;
	/** The project whose memory this is; null for a run of the global scope alone. */
	projectId: string | null;
	/** The scopes this run may write: one for maintenance, both for an extraction. */
	scopes: readonly MemoryScope[];
	source?: MemorySource | null;
	log?: (message: string) => void;
};

/**
 * The memory a run edits: a staged copy of each scope it touches, plus the operations that become one commit per scope.
 * Reads see earlier writes of the same run; the commit replays the operations on fresh state, so a write the coordinator
 * made meanwhile is not overwritten.
 */
export class MemoryEditor {
	readonly #options: MemoryEditorOptions;
	readonly #staged = new Map<string, StagedScope>();

	constructor(options: MemoryEditorOptions) {
		this.#options = options;
	}

	/** The scope a tool call addresses; a single-scope run ignores the argument and uses its own. */
	target(scope: unknown): MemoryTarget {
		const allowed = this.#options.scopes;
		if (allowed.length === 1) return this.#targetOf(allowed[0]!);
		if (scope === "global") return { scope: "global" };
		if (scope === "project") {
			if (this.#options.projectId === null) {
				throw new ServerError("bad_request", "This memory run has no project scope");
			}
			return { scope: "project", projectId: this.#options.projectId };
		}
		return allowed.includes("project") && this.#options.projectId !== null
			? { scope: "project", projectId: this.#options.projectId }
			: { scope: "global" };
	}

	#targetOf(scope: MemoryScope): MemoryTarget {
		if (scope === "global") return { scope: "global" };
		if (this.#options.projectId === null) {
			throw new ServerError("bad_request", "This memory run has no project scope");
		}
		return { scope: "project", projectId: this.#options.projectId };
	}

	async #scope(target: MemoryTarget): Promise<StagedScope> {
		const key = scopeKey(target);
		const known = this.#staged.get(key);
		if (known !== undefined) return known;
		const store = this.#options.store.scope(target);
		const topics = new Map((await store.snapshot()).map((topic) => [topic.fileId, topic]));
		const staged: StagedScope = { target, store, topics, operations: [] };
		this.#staged.set(key, staged);
		return staged;
	}

	/** The topics of one scope as the run has them so far. */
	async topics(target: MemoryTarget): Promise<MemoryTopic[]> {
		return [...(await this.#scope(target)).topics.values()];
	}

	/** Retrieval counts of one scope: the maintenance run's evidence for what nobody ever reads. */
	async retrievals(target: MemoryTarget): Promise<MemoryRetrieval[]> {
		return (await this.#scope(target)).store.retrievals();
	}

	async read(target: MemoryTarget, fileId: string): Promise<MemoryTopic | undefined> {
		return (await this.#scope(target)).topics.get(fileId);
	}

	async search(
		target: MemoryTarget,
		options: { query: string; tags?: readonly string[]; includeArchived?: boolean; limit: number },
	) {
		const staged = await this.#scope(target);
		return searchTopics(staged.topics.values(), target.scope, options);
	}

	async stats(target: MemoryTarget): Promise<{ topics: number; archived: number; tags: Record<string, number> }> {
		const staged = await this.#scope(target);
		const tags = new Map<string, number>();
		let topics = 0;
		let archived = 0;
		for (const topic of staged.topics.values()) {
			if (topic.status === "archived") {
				archived += 1;
				continue;
			}
			topics += 1;
			for (const tag of new Set(topic.tags)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
		}
		return { topics, archived, tags: Object.fromEntries([...tags.entries()].sort(([a], [b]) => a.localeCompare(b))) };
	}

	/** Stage one write and answer what it did, exactly as `memory_write` would. */
	async write(
		target: MemoryTarget,
		input: {
			fileId: string;
			text: string;
			heading?: string;
			title?: string;
			summary?: string;
			tags?: string[];
			links?: string[];
			create?: boolean;
		},
	): Promise<{ kind: "created" | "updated" | "unchanged" | "suggest"; topic?: MemoryTopic; matches?: MemoryTopic[] }> {
		const staged = await this.#scope(target);
		const full = {
			target,
			...input,
			source: this.#options.source ?? null,
		};
		const result = applyWriteToTopics(staged.topics, full, new Date().toISOString(), (candidate, text) =>
			searchTopics(staged.topics.values(), target.scope, {
				query: [candidate.title ?? candidate.fileId, candidate.summary ?? "", text.slice(0, 2000)].join(" "),
				limit: 8,
			})
				.filter((hit, index, all) => all.findIndex((other) => other.fileId === hit.fileId) === index)
				.slice(0, 3),
		);
		if (result.kind === "suggest") {
			const matches = result.matches
				.map((hit) => staged.topics.get(hit.fileId))
				.filter((topic): topic is MemoryTopic => topic !== undefined);
			return { kind: "suggest", matches };
		}
		if (result.kind === "unchanged") return { kind: "unchanged", topic: result.topic };
		staged.operations.push({ type: "write", input: full });
		return { kind: result.kind, topic: result.topic };
	}

	/** Stage one archive. */
	async archive(target: MemoryTarget, fileId: string, reason?: string): Promise<{ kind: "archived" | "unchanged" }> {
		const staged = await this.#scope(target);
		const outcome = applyArchiveToTopics(
			staged.topics,
			fileId,
			target.scope,
			{ reason, source: this.#options.source ?? null },
			new Date().toISOString(),
		);
		if (outcome.kind === "unchanged") return { kind: "unchanged" };
		staged.operations.push({
			type: "archive",
			fileId,
			...(reason === undefined ? {} : { reason }),
			...(this.#options.source === undefined ? {} : { source: this.#options.source }),
		});
		return { kind: "archived" };
	}

	/** Whether the run changed anything at all. */
	changed(): boolean {
		return [...this.#staged.values()].some((staged) => staged.operations.length > 0);
	}

	/**
	 * Commit what the run staged: one commit per scope that changed, with the log the caller renders from the changes.
	 * A scope with nothing to change is left alone, so it gets no empty commit.
	 */
	async commit(options: {
		kind: "extraction" | "maintenance";
		render: (scope: MemoryScope, changes: readonly MemoryBatchChange[]) => { subject: string; body?: string };
		source?: MemorySource | null;
	}): Promise<{ commits: { scope: MemoryScope; commit: string; files: string[]; changes: MemoryBatchChange[] }[] }> {
		const commits: { scope: MemoryScope; commit: string; files: string[]; changes: MemoryBatchChange[] }[] = [];
		for (const staged of this.#staged.values()) {
			if (staged.operations.length === 0) continue;
			const trailers = {
				kind: options.kind,
				...(options.source === undefined ? {} : { source: options.source }),
			};
			const result = await staged.store.applyBatch(staged.operations, (changes) => {
				const rendered = options.render(staged.target.scope, changes);
				return renderCommitMessage(rendered.subject, rendered.body ?? null, trailers);
			});
			staged.operations = [];
			if (result.commit !== null) {
				commits.push({
					scope: staged.target.scope,
					commit: result.commit,
					files: result.files,
					changes: result.changes,
				});
			}
		}
		return { commits };
	}
}

/** One change of a run, as its commit message lists it. */
export function describeBatchChanges(changes: readonly MemoryBatchChange[]): string {
	return changes
		.map((change) => {
			if (change.action === "create") return `- create ${change.fileId}`;
			if (change.action === "archive") {
				return `- archive ${change.fileId}${change.detail === undefined ? "" : ` — ${change.detail}`}`;
			}
			return `- update ${change.fileId}${change.detail === undefined ? "" : `, ${change.detail}`}`;
		})
		.join("\n");
}

/** The tool executor a `runMemoryAgent` gets: the editor's own reads and staged writes, as text. */
export function memoryAgentExecutor(
	editor: MemoryEditor,
): (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }> {
	const text = (value: string, isError = false) => ({ text: value, ...(isError ? { isError: true } : {}) });
	return async (name, args) => {
		try {
			const target = editor.target(args["scope"]);
			switch (name) {
				case "memory_list": {
					const includeArchived = args["includeArchived"] === true;
					const topics = (await editor.topics(target))
						.filter((topic) => includeArchived || topic.status !== "archived")
						.sort((left, right) => right.updated.localeCompare(left.updated));
					if (topics.length === 0) return text("No topics in this scope.");
					return text(
						topics
							.map((topic) => {
								const sections = topic.sections.map((part) => part.heading).join(", ") || "no sections";
								return `${topic.fileId} — ${topic.title} (${topic.status})\n  ${topic.summary}\n  tags: ${topic.tags.join(", ") || "none"}; sections: ${sections}; updated ${topic.updated}`;
							})
							.join("\n"),
					);
				}
				case "memory_search": {
					const query = String(args["query"] ?? "");
					const hits = await editor.search(target, {
						query,
						...(Array.isArray(args["tags"]) ? { tags: args["tags"] as string[] } : {}),
						...(args["includeArchived"] === true ? { includeArchived: true } : {}),
						limit: 12,
					});
					if (hits.length === 0) return text(`No memory matched "${query}".`);
					return text(
						hits
							.map(
								(hit) =>
									`${hit.fileId}${hit.heading === null ? "" : ` — section "${hit.heading}"`}: ${hit.title}\n  ${hit.snippet}`,
							)
							.join("\n"),
					);
				}
				case "memory_read": {
					const fileId = String(args["fileId"] ?? "");
					const topic = await editor.read(target, fileId);
					if (topic === undefined) {
						return text(`No memory "${fileId}" in this scope. memory_list shows what exists.`, true);
					}
					const wanted = Array.isArray(args["sections"])
						? (args["sections"] as string[]).map((heading) => heading.trim().toLowerCase())
						: undefined;
					const sections =
						wanted === undefined
							? topic.sections
							: topic.sections.filter((part) => wanted.includes(part.heading.toLowerCase()));
					return text(
						[
							`${fileId} — ${topic.title} (${topic.status})`,
							`Summary: ${topic.summary}`,
							`Tags: ${topic.tags.join(", ") || "none"}; links: ${topic.links.join(", ") || "none"}`,
							`Created ${topic.created}; updated ${topic.updated}`,
							...(topic.intro.trim().length === 0 ? [] : ["", topic.intro.trim()]),
							...sections.flatMap((part) => ["", `## ${part.heading}`, "", part.text.trim()]),
						].join("\n"),
					);
				}
				case "memory_write": {
					const result = await editor.write(target, {
						fileId: String(args["fileId"] ?? ""),
						text: String(args["text"] ?? ""),
						...(typeof args["heading"] === "string" ? { heading: args["heading"] } : {}),
						...(typeof args["title"] === "string" ? { title: args["title"] } : {}),
						...(typeof args["summary"] === "string" ? { summary: args["summary"] } : {}),
						...(Array.isArray(args["tags"]) ? { tags: args["tags"] as string[] } : {}),
						...(Array.isArray(args["links"]) ? { links: args["links"] as string[] } : {}),
						...(args["create"] === true ? { create: true } : {}),
					});
					if (result.kind === "suggest") {
						const names = (result.matches ?? []).map((topic) => topic.fileId);
						return text(
							[
								`A close topic already exists, so nothing was written. Update one of these instead: ${names.join(", ")}.`,
								"If none of them is the right home, call memory_write again with create: true.",
							].join("\n"),
						);
					}
					if (result.kind === "unchanged") return text(`${target.scope}:${result.topic?.fileId} already reads that way.`);
					return text(
						`${result.kind === "created" ? "Created" : "Updated"} ${target.scope}:${result.topic?.fileId}.`,
					);
				}
				case "memory_archive": {
					const fileId = String(args["fileId"] ?? "");
					const reason = typeof args["reason"] === "string" ? args["reason"] : undefined;
					const result = await editor.archive(target, fileId, reason);
					return result.kind === "unchanged"
						? text(`${target.scope}:${fileId} is already archived.`)
						: text(`Archived ${target.scope}:${fileId}.`);
				}
				default:
					return text(`Unknown tool "${name}".`, true);
			}
		} catch (error) {
			// A tool error is the model's to read, not the run's to fail on: it is how memory_write refuses a bad ID.
			return text(`${name} failed: ${errorMessage(error)}`, true);
		}
	};
}
