/**
 * Conversation context: what a conversation's model is given besides the transcript.
 *
 * The coordinator and each worker run with a system prompt, a tool list, AGENTS.md files and skills. Clients read this
 * with `conversation.context` and get it again as a `conversation.context` event whenever it changes (a skill is read,
 * a worker is spawned and gains its tools, AGENTS.md is edited), for as long as they watch that conversation.
 */
import { type Static, Type } from "typebox";
import { ProjectIdSchema, RequestIdSchema } from "./common.ts";

/**
 * What a file folded into the system prompt is: the harness's `SYSTEM.md` (the system prompt override, pi's preamble)
 * and `APPEND_SYSTEM.md` (instructions appended to it, pi's addendum), or an `AGENTS.md`/`CLAUDE.md` (project
 * instructions).
 */
export const ContextFileKindSchema = Type.Union(
	[Type.Literal("system"), Type.Literal("append"), Type.Literal("agents"), Type.Literal("model")],
	{
		description:
			'"system": SYSTEM.md, the base instructions the harness starts from; "append": APPEND_SYSTEM.md, added after them; "agents": an AGENTS.md or CLAUDE.md instructions file; "model": notes for the conversation\'s model from the harness config\'s models/ folder (a file whose name pattern matches provider/model).',
	},
);
export type ContextFileKind = Static<typeof ContextFileKindSchema>;

/** One file folded into the system prompt. */
export const ContextFileSchema = Type.Object({
	path: Type.String({ description: "Absolute path." }),
	scope: Type.Union([Type.Literal("global"), Type.Literal("project")], {
		description:
			'"global": the harness\'s config directory for SYSTEM.md and APPEND_SYSTEM.md, the user\'s agent directory for AGENTS.md; "project": the project directory or one of its ancestors.',
	}),
	kind: Type.Optional(
		Type.Union([ContextFileKindSchema], {
			description: "What the file is; an older backend sends none, and every file it knew is an AGENTS.md.",
		}),
	),
	content: Type.String({ description: "The text as it went into the system prompt." }),
});
export type ContextFile = Static<typeof ContextFileSchema>;

/**
 * Where a skill comes from: the harness's own skills directories, pi's agent directory and `.pi/skills`, or Claude
 * Code's home and `.claude/skills` (its installed plugins included, the skills synced from claude.ai not).
 */
export const SkillSourceSchema = Type.Union(
	[Type.Literal("harness"), Type.Literal("pi"), Type.Literal("claude")],
	{
		description:
			'"harness": the harness\'s config directory or the project\'s .aiki; "pi": pi\'s agent directory or .pi/skills; "claude": Claude Code\'s home, its plugins or .claude/skills.',
	},
);
export type SkillSource = Static<typeof SkillSourceSchema>;

/** A skill offered to the model by name and description; the model reads its SKILL.md when a task matches. */
export const SkillInfoSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	description: Type.String(),
	path: Type.String({ description: "Absolute path of the SKILL.md." }),
	scope: Type.Union([Type.Literal("global"), Type.Literal("project")]),
	source: Type.Optional(
		Type.Union([SkillSourceSchema], {
			description: "Which tool's skills it came from; an older backend sends none, and every skill it knew is pi's.",
		}),
	),
	read: Type.Boolean({ description: "Whether this conversation has read the SKILL.md." }),
});
export type SkillInfo = Static<typeof SkillInfoSchema>;

export const ToolInfoSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	description: Type.String(),
	extension: Type.Union([Type.String(), Type.Null()], { description: "The extension that registered it, when known." }),
});
export type ToolInfo = Static<typeof ToolInfoSchema>;

/**
 * The prompt cache misses a conversation's requests have paid for so far, counted with the rules in `cache-misses.ts`
 * over every entry. `unexplained` ones came with no model switch, no change of instructions and no idle gap past the
 * cache's lifetime: the start of the prompt changed between two requests, which should not happen.
 */
export const CacheMissTotalsSchema = Type.Object({
	misses: Type.Integer({ minimum: 0 }),
	missedTokens: Type.Integer({ minimum: 0, description: "Prompt tokens billed at the full price that the cache had." }),
	missedCost: Type.Number({ minimum: 0, description: "What they cost over reading them from the cache, in dollars." }),
	unexplained: Type.Integer({ minimum: 0, description: "Misses with no model switch, no change of instructions and no idle gap." }),
	unexplainedTokens: Type.Integer({ minimum: 0 }),
	unexplainedCost: Type.Number({ minimum: 0 }),
	lastUnexplainedAt: Type.Union([Type.String(), Type.Null()], { description: "ISO 8601; null when there was none." }),
});
export type CacheMissTotals = Static<typeof CacheMissTotalsSchema>;

/**
 * How full the conversation's context is and when it compacts, in tokens of the current model. Thresholds are fractions
 * of the model's context window: a background summary starts at `backgroundAt`, the next request waits for one at
 * `blockingAt`.
 */
export const ContextUsageSchema = Type.Object({
	contextTokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], {
		description: "What the next request would send, as of the last answer's usage; null before the first answer.",
	}),
	contextWindow: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], { description: "Null when no model is set." }),
	backgroundAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
	blockingAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
	compactions: Type.Integer({ minimum: 0, description: "Compaction summaries in this conversation so far." }),
	lastCompactionAt: Type.Union([Type.String(), Type.Null()], { description: "ISO 8601." }),
	compacting: Type.Boolean({ description: "A compaction is running now." }),
	cacheMisses: Type.Optional(
		Type.Union([CacheMissTotalsSchema], { description: "Prompt cache misses so far. Absent on older servers." }),
	),
});
export type ContextUsage = Static<typeof ContextUsageSchema>;

export const ConversationContextSchema = Type.Object({
	projectId: ProjectIdSchema,
	workerId: Type.Union([Type.String(), Type.Null()], { description: "Null for the coordinator." }),
	threadId: Type.Optional(Type.String({ description: 'The thread; "main" for main. Absent on older servers.' })),
	cwd: Type.String({ description: "Where the conversation's tools run: the project path or the worker's workspace." }),
	projectPath: Type.String(),
	homeDir: Type.String({ description: "The server's home directory, so a client can show paths as ~ instead of absolute." }),
	systemPrompt: Type.String({ description: "The full system prompt the next request is sent with." }),
	tools: Type.Array(ToolInfoSchema),
	contextFiles: Type.Array(ContextFileSchema, {
		description:
			"In the order they appear in the system prompt: SYSTEM.md, APPEND_SYSTEM.md, then the AGENTS.md files from the agent directory and the filesystem root down to the cwd.",
	}),
	skills: Type.Array(SkillInfoSchema),
	usage: Type.Optional(ContextUsageSchema),
});
export type ConversationContext = Static<typeof ConversationContextSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

export const ConversationContextRequestSchema = Type.Object({
	type: Type.Literal("conversation.context"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	workerId: Type.Optional(Type.String({ minLength: 1, description: "This worker's context instead of the coordinator's." })),
	threadId: Type.Optional(
		Type.String({ minLength: 1, description: "This thread's context instead of main's." }),
	),
});
export type ConversationContextRequest = Static<typeof ConversationContextRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const ConversationContextResponseSchema = Type.Object({
	type: Type.Literal("conversation.context"),
	id: RequestIdSchema,
	context: ConversationContextSchema,
});
export type ConversationContextResponse = Static<typeof ConversationContextResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** The whole context again, pushed to every connection watching that conversation when any part of it changes. */
export const ConversationContextEventSchema = Type.Object({
	type: Type.Literal("conversation.context.changed"),
	context: ConversationContextSchema,
});
export type ConversationContextEvent = Static<typeof ConversationContextEventSchema>;
