/**
 * Shared wire types.
 *
 * Every client request carries `type` (the method) and `id` (chosen by the client). The server answers with the same
 * `type` and `id`, or with `type: "error"` and the same `id`. Server events have their own `type` and no `id`.
 *
 * This package only builds TypeBox schemas (plain JSON Schema), so native clients can generate types from them.
 */
import { type Static, Type } from "typebox";

/** Bumped when a change to the wire format is not backward compatible. */
export const PROTOCOL_VERSION = 1;
export const ProtocolVersionSchema = Type.Literal(PROTOCOL_VERSION);

export const SERVER_NAME = "Aiki";
export const SERVER_VERSION = "0.1.0";

export const RequestIdSchema = Type.String({ minLength: 1, description: "Client-chosen; echoed by the response." });
export type RequestId = Static<typeof RequestIdSchema>;

export const ProjectIdSchema = Type.String({ minLength: 1 });
export type ProjectId = Static<typeof ProjectIdSchema>;

/**
 * A durable entry ID: a positive integer, increasing within a conversation. Numbers (not strings) so a view value is
 * directly the shape pi-durable's `ConversationTranscript` and its entry types expect.
 */
export const EntryIdSchema = Type.Integer({ minimum: 1 });
export type EntryId = Static<typeof EntryIdSchema>;

export const WatchIdSchema = Type.String({ minLength: 1 });
export type WatchId = Static<typeof WatchIdSchema>;

export const ModelRefSchema = Type.Object(
	{
		provider: Type.String({ minLength: 1, description: 'pi-ai provider ID, for example "anthropic" or "opencode-go".' }),
		modelId: Type.String({ minLength: 1 }),
	},
	{ description: "One model, by pi-ai provider and model ID." },
);
export type ModelRef = Static<typeof ModelRefSchema>;

/** pi-ai's `ModelThinkingLevel` values, in increasing effort. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const ThinkingLevelSchema = Type.Union([
	Type.Literal("off"),
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
	Type.Literal("max"),
]);
export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;

/** Machine-readable failure kinds. Clients branch on these, never on the message. */
export const ERROR_CODES = [
	"auth_required",
	"auth_invalid",
	"auth_expired",
	"auth_revoked",
	"rate_limited",
	"pending_limit",
	"not_found",
	"grant_used",
	"claim_exists",
	"claim_pending",
	"migration_closed",
	"batch_mismatch",
	"bad_request",
	"not_ready",
	"unsupported_protocol",
	"unknown_request",
	"unknown_project",
	"unknown_worker",
	"unknown_memory",
	"unknown_schedule",
	"memory_conflict",
	"unknown_task",
	"board_conflict",
	"unknown_thread",
	"unknown_artifact",
	"unknown_model",
	"unknown_provider",
	"unknown_login",
	"invalid_path",
	"permission_denied",
	"no_coordinator_model",
	"conversation_busy",
	"project_busy",
	"unknown_terminal",
	"terminal_unavailable",
	"terminal_limit",
	"harness_failed",
	"internal",
] as const;
export const ErrorCodeSchema = Type.Union([
	Type.Literal("auth_required"),
	Type.Literal("auth_invalid"),
	Type.Literal("auth_expired"),
	Type.Literal("auth_revoked"),
	Type.Literal("rate_limited"),
	Type.Literal("pending_limit"),
	Type.Literal("not_found"),
	Type.Literal("grant_used"),
	Type.Literal("claim_exists"),
	Type.Literal("claim_pending"),
	Type.Literal("migration_closed"),
	Type.Literal("batch_mismatch"),
	Type.Literal("bad_request"),
	Type.Literal("not_ready"),
	Type.Literal("unsupported_protocol"),
	Type.Literal("unknown_request"),
	Type.Literal("unknown_project"),
	Type.Literal("unknown_worker"),
	Type.Literal("unknown_memory"),
	Type.Literal("unknown_schedule"),
	Type.Literal("memory_conflict"),
	Type.Literal("unknown_task"),
	Type.Literal("board_conflict"),
	Type.Literal("unknown_thread"),
	Type.Literal("unknown_artifact"),
	Type.Literal("unknown_model"),
	Type.Literal("unknown_provider"),
	Type.Literal("unknown_login"),
	Type.Literal("invalid_path"),
	Type.Literal("permission_denied"),
	Type.Literal("no_coordinator_model"),
	Type.Literal("conversation_busy"),
	Type.Literal("project_busy"),
	Type.Literal("unknown_terminal"),
	Type.Literal("terminal_unavailable"),
	Type.Literal("terminal_limit"),
	Type.Literal("harness_failed"),
	Type.Literal("internal"),
]);
export type ErrorCode = Static<typeof ErrorCodeSchema>;

export const ErrorInfoSchema = Type.Object({
	code: ErrorCodeSchema,
	message: Type.String({ description: "For humans. Never contains credentials." }),
	data: Type.Optional(
		Type.Unknown({ description: "Optional structured detail; the shape depends on the code (for example a version)." }),
	),
});
export type ErrorInfo = Static<typeof ErrorInfoSchema>;

export const ErrorResponseSchema = Type.Object({
	type: Type.Literal("error"),
	id: Type.Optional(RequestIdSchema),
	error: ErrorInfoSchema,
});
export type ErrorResponse = Static<typeof ErrorResponseSchema>;

/**
 * A Chord delta operation, as produced by `@earendil-works/chord/delta`. Ops are decoded (paths inline, no path ID
 * table), so a client applies them in order with `applyImmutable`.
 */
export const ChordPathSchema = Type.Array(
	Type.Union([Type.String(), Type.Number()]),
	{ description: "Object key or array index." },
);
export const NonEmptyChordPathSchema = Type.Array(Type.Union([Type.String(), Type.Number()]), { minItems: 1 });
export type ChordPath = Static<typeof ChordPathSchema>;

export const ChordOpSchema = Type.Union(
	[
		Type.Tuple([Type.Literal("r"), Type.Unknown()], { description: "Replace the whole value." }),
		Type.Tuple([Type.Literal("s"), NonEmptyChordPathSchema, Type.Unknown()], { description: "Set a field." }),
		Type.Tuple([Type.Literal("d"), NonEmptyChordPathSchema], { description: "Delete a field." }),
		Type.Tuple([Type.Literal("a"), NonEmptyChordPathSchema, Type.String()], { description: "Append a string." }),
		Type.Tuple([Type.Literal("t"), NonEmptyChordPathSchema, Type.Number()], { description: "Truncate a string." }),
		Type.Tuple(
			[Type.Literal("p"), ChordPathSchema, Type.Number(), Type.Number(), Type.Array(Type.Unknown())],
			{ description: "Splice array items in." },
		),
		Type.Tuple([Type.Literal("m"), ChordPathSchema, Type.Array(Type.Number())], {
			description: "Reorder array items by permutation.",
		}),
	],
	{ description: "A decoded Chord operation. The tuple's first item is the verb." },
);
export type ChordOp = Static<typeof ChordOpSchema>;

/** Opaque storage cursor, round-tripped by the client unchanged. */
export const CursorSchema = Type.Record(Type.String(), Type.Unknown());
export type Cursor = Static<typeof CursorSchema>;

export const ScanOrderSchema = Type.Union([Type.Literal("ascending"), Type.Literal("descending")]);
export type ScanOrder = Static<typeof ScanOrderSchema>;

export const WhenBusySchema = Type.Union(
	[Type.Literal("followUp"), Type.Literal("steer"), Type.Literal("reject")],
	{ description: '"followUp" queues after the current run; "steer" joins it; "reject" fails with conversation_busy.' },
);
export type WhenBusy = Static<typeof WhenBusySchema>;

/** A text or image input block, matching pi-ai's `UserMessage` content. */
export const TextContentSchema = Type.Object({ type: Type.Literal("text"), text: Type.String() });
export type TextContent = Static<typeof TextContentSchema>;
export const ImageContentSchema = Type.Object({
	type: Type.Literal("image"),
	data: Type.String({ description: "Base64-encoded image bytes." }),
	mimeType: Type.String({ minLength: 1 }),
});
export type ImageContent = Static<typeof ImageContentSchema>;
export const ContentBlockSchema = Type.Union([TextContentSchema, ImageContentSchema]);
export type ContentBlock = Static<typeof ContentBlockSchema>;

export const InputContentSchema = Type.Union([Type.String(), Type.Array(ContentBlockSchema)]);
export type InputContent = Static<typeof InputContentSchema>;
