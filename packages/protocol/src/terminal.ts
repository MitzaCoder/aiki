/**
 * Terminals: a real PTY on the backend, streamed over the app's WebSocket (feature `terminal`).
 *
 * Every terminal is a zellij session. The server runs `zellij attach --create <session>` in a PTY, so a terminal that is
 * closed, dropped or cut off by a restart only *detaches*: the session and everything running in it carry on, and
 * opening it again reattaches with the screen intact. Control is JSON like every other request. The bytes of the
 * terminal are binary frames (see `encodeTerminalFrame`), so a big `cat` costs no base64 and no parsing, and output is
 * paced by acknowledgements so a slow phone never floods the socket.
 *
 * A terminal is a shell as the backend's user: the same reach as an agent's `bash` tool. See "Terminals" in
 * docs/DESIGN.md.
 */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";

/** What a binary frame carries; the first byte of every frame. */
export const TERMINAL_FRAME = {
	/** Server to client: bytes the PTY wrote. */
	output: 1,
	/** Client to server: bytes to write to the PTY. */
	input: 2,
	/** Client to server: how many output bytes the client has processed since its last ack (a `u32`). */
	ack: 3,
} as const;
export type TerminalFrameKind = (typeof TERMINAL_FRAME)[keyof typeof TERMINAL_FRAME];

/** A frame is `kind u8 | terminalId u32 (big-endian) | payload`. */
export const TERMINAL_HEADER_BYTES = 5;

/** Most bytes one input frame may carry; a larger paste is sent as several frames. */
export const TERMINAL_MAX_INPUT_BYTES = 64 * 1024;
/** Most output bytes the server puts in one frame. */
export const TERMINAL_MAX_OUTPUT_FRAME_BYTES = 32 * 1024;
/** Output the server sends before it waits for acks; a client acks what it has rendered. */
export const TERMINAL_OUTPUT_WINDOW_BYTES = 256 * 1024;
/** Terminal size bounds. */
export const TERMINAL_MAX_COLS = 500;
export const TERMINAL_MAX_ROWS = 200;
/** The longest session name, and what one may contain. It never starts with `-` or `.`, so it cannot be an option or a path. */
export const TERMINAL_SESSION_NAME_MAX = 48;
export const TERMINAL_SESSION_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$";

const SESSION_NAME = new RegExp(TERMINAL_SESSION_NAME_PATTERN);

/** Whether `name` is usable as a session name. */
export function isTerminalSessionName(name: string): boolean {
	return SESSION_NAME.test(name);
}

/**
 * The prefix for new sessions made from `text` (a project's name): lower-case letters, digits and dashes, short, never
 * empty. `Example Core Services` becomes `example-core-services`.
 */
export function terminalPrefix(text: string): string {
	const slug = text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32)
		.replace(/-+$/g, "");
	return slug.length === 0 ? "term" : slug;
}

export type TerminalFrame = { kind: TerminalFrameKind; terminalId: number; payload: Uint8Array };

/** Build a binary frame. */
export function encodeTerminalFrame(kind: TerminalFrameKind, terminalId: number, payload: Uint8Array): Uint8Array {
	const frame = new Uint8Array(TERMINAL_HEADER_BYTES + payload.length);
	const view = new DataView(frame.buffer);
	view.setUint8(0, kind);
	view.setUint32(1, terminalId);
	frame.set(payload, TERMINAL_HEADER_BYTES);
	return frame;
}

/** The ack frame for `bytes` processed output bytes. */
export function encodeTerminalAck(terminalId: number, bytes: number): Uint8Array {
	const payload = new Uint8Array(4);
	new DataView(payload.buffer).setUint32(0, Math.min(bytes, 0xffff_ffff));
	return encodeTerminalFrame(TERMINAL_FRAME.ack, terminalId, payload);
}

/** Read a binary frame; undefined when it is too short or its kind is unknown. */
export function decodeTerminalFrame(data: Uint8Array): TerminalFrame | undefined {
	if (data.length < TERMINAL_HEADER_BYTES) return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const kind = view.getUint8(0);
	if (kind !== TERMINAL_FRAME.output && kind !== TERMINAL_FRAME.input && kind !== TERMINAL_FRAME.ack) return undefined;
	return { kind, terminalId: view.getUint32(1), payload: data.subarray(TERMINAL_HEADER_BYTES) };
}

/** The count in an ack frame's payload; undefined when it is not four bytes. */
export function terminalAckBytes(payload: Uint8Array): number | undefined {
	if (payload.length !== 4) return undefined;
	return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0);
}

const TerminalIdSchema = Type.Integer({
	minimum: 1,
	maximum: 0xffff_ffff,
	description: "Scoped to the connection: assigned by `terminal.open`, used in every binary frame and event.",
});

const SizeFields = {
	cols: Type.Integer({ minimum: 1, maximum: TERMINAL_MAX_COLS, description: "Columns." }),
	rows: Type.Integer({ minimum: 1, maximum: TERMINAL_MAX_ROWS, description: "Rows." }),
};

export const TerminalSessionNameSchema = Type.String({
	pattern: TERMINAL_SESSION_NAME_PATTERN,
	description: `A zellij session name: letters, digits, "." "_" "-", at most ${TERMINAL_SESSION_NAME_MAX}, starting with a letter or digit.`,
});

/** One zellij session on the backend. */
export const TerminalSessionInfoSchema = Type.Object({
	name: Type.String({ description: "Session name. A session made elsewhere may have a name `terminal.open` would refuse." }),
	exited: Type.Boolean({
		description: "Its server is gone but zellij kept its layout: attaching resurrects it (commands start again).",
	}),
	attached: Type.Boolean({ description: "This connection has it attached now." }),
	created: Type.Optional(Type.String({ description: 'How long ago zellij says it was created, for example "2h 3m".' })),
});
export type TerminalSessionInfo = Static<typeof TerminalSessionInfoSchema>;

/** One terminal this connection has attached. */
export const TerminalAttachedSchema = Type.Object({
	terminalId: TerminalIdSchema,
	session: Type.String(),
	cols: Type.Integer(),
	rows: Type.Integer(),
});
export type TerminalAttached = Static<typeof TerminalAttachedSchema>;

export const TerminalLimitsSchema = Type.Object({
	perConnection: Type.Integer({ description: "Terminals one connection may have attached." }),
	perServer: Type.Integer({ description: "Terminals attached across every connection." }),
	maxInputBytes: Type.Integer({ description: "Largest input frame." }),
	windowBytes: Type.Integer({ description: "Output bytes in flight before the server waits for an ack." }),
});
export type TerminalLimits = Static<typeof TerminalLimitsSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/**
 * Whether a terminal can be opened here, and the sessions that exist (the reattach list). Needs no terminal to be
 * attached; a client asks before it offers a terminal button's action, and again to refresh the list.
 */
export const TerminalListRequestSchema = Type.Object({ type: Type.Literal("terminal.list"), id: RequestIdSchema });
export type TerminalListRequest = Static<typeof TerminalListRequestSchema>;

/**
 * Attach a terminal. With `session` it attaches to that session, creating it when it does not exist (an exited one is
 * resurrected). Without it a new session `<prefix>-<n>` is created. Output arrives as binary frames from the moment
 * the response is sent, and the client acks them.
 */
export const TerminalOpenRequestSchema = Type.Object({
	type: Type.Literal("terminal.open"),
	id: RequestIdSchema,
	session: Type.Optional(TerminalSessionNameSchema),
	prefix: Type.Optional(
		Type.String({ minLength: 1, maxLength: 32, description: "Prefix for a new session's name (a project's slug). Default `term`." }),
	),
	cwd: Type.Optional(
		Type.String({
			minLength: 1,
			description: "Absolute directory where a new session's first shell starts. Ignored when attaching to an existing session. Default: the user's home.",
		}),
	),
	...SizeFields,
});
export type TerminalOpenRequest = Static<typeof TerminalOpenRequestSchema>;

/** The terminal's size changed (its box, the soft keyboard). */
export const TerminalResizeRequestSchema = Type.Object({
	type: Type.Literal("terminal.resize"),
	id: RequestIdSchema,
	terminalId: TerminalIdSchema,
	...SizeFields,
});
export type TerminalResizeRequest = Static<typeof TerminalResizeRequestSchema>;

/** Detach: stop this terminal's client. The session and its processes keep running. */
export const TerminalCloseRequestSchema = Type.Object({
	type: Type.Literal("terminal.close"),
	id: RequestIdSchema,
	terminalId: TerminalIdSchema,
});
export type TerminalCloseRequest = Static<typeof TerminalCloseRequestSchema>;

/** End a session: its processes are stopped and it is removed from the list. Any client attached to it is closed. */
export const TerminalKillRequestSchema = Type.Object({
	type: Type.Literal("terminal.kill"),
	id: RequestIdSchema,
	session: Type.String({ minLength: 1 }),
});
export type TerminalKillRequest = Static<typeof TerminalKillRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const TerminalListResponseSchema = Type.Object({
	type: Type.Literal("terminal.list"),
	id: RequestIdSchema,
	available: Type.Boolean({ description: "A terminal can be opened. When false, `reason` says why." }),
	multiplexer: Type.Union([Type.Literal("zellij"), Type.Literal("none")], {
		description: '`none` is a plain shell with no sessions to reattach (tests and development).',
	}),
	version: Type.Optional(Type.String({ description: "zellij's version." })),
	reason: Type.Optional(Type.String({ description: 'Why not, in a sentence for the user: "zellij is not installed on this backend".' })),
	survivesRestart: Type.Boolean({
		description: "A restart of the backend leaves the sessions running. False when the backend cannot move zellij out of its own service.",
	}),
	sessions: Type.Array(TerminalSessionInfoSchema),
	attached: Type.Array(TerminalAttachedSchema),
	limits: TerminalLimitsSchema,
});
export type TerminalListResponse = Static<typeof TerminalListResponseSchema>;

export const TerminalOpenResponseSchema = Type.Object({
	type: Type.Literal("terminal.open"),
	id: RequestIdSchema,
	terminalId: TerminalIdSchema,
	session: Type.String(),
	created: Type.Boolean({ description: "The session did not exist and was created." }),
	...SizeFields,
});
export type TerminalOpenResponse = Static<typeof TerminalOpenResponseSchema>;

export const TerminalResizeResponseSchema = Type.Object({
	type: Type.Literal("terminal.resize"),
	id: RequestIdSchema,
	terminalId: TerminalIdSchema,
});
export type TerminalResizeResponse = Static<typeof TerminalResizeResponseSchema>;

export const TerminalCloseResponseSchema = Type.Object({
	type: Type.Literal("terminal.close"),
	id: RequestIdSchema,
	terminalId: TerminalIdSchema,
});
export type TerminalCloseResponse = Static<typeof TerminalCloseResponseSchema>;

export const TerminalKillResponseSchema = Type.Object({
	type: Type.Literal("terminal.kill"),
	id: RequestIdSchema,
	session: Type.String(),
});
export type TerminalKillResponse = Static<typeof TerminalKillResponseSchema>;

// --- events ------------------------------------------------------------------------------------------------------

export const TerminalClosedReasonSchema = Type.Union([
	Type.Literal("exited"),
	Type.Literal("killed"),
	Type.Literal("error"),
]);
export type TerminalClosedReason = Static<typeof TerminalClosedReasonSchema>;

/**
 * A terminal's client ended without the client asking: the session ended or was detached from inside (`Ctrl-o d`),
 * it was killed, or zellij failed. Pushed after the last output frame; the terminal id is gone.
 */
export const TerminalClosedEventSchema = Type.Object({
	type: Type.Literal("terminal.closed"),
	terminalId: TerminalIdSchema,
	reason: TerminalClosedReasonSchema,
	exitCode: Type.Optional(Type.Integer()),
	message: Type.Optional(Type.String()),
});
export type TerminalClosedEvent = Static<typeof TerminalClosedEventSchema>;

/**
 * Output was dropped because the client fell too far behind: reset the screen. The server repaints right after, so the
 * frames that follow are the whole screen again.
 */
export const TerminalResyncEventSchema = Type.Object({
	type: Type.Literal("terminal.resync"),
	terminalId: TerminalIdSchema,
});
export type TerminalResyncEvent = Static<typeof TerminalResyncEventSchema>;
