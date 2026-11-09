/**
 * OAuth subscription logins (Claude Pro/Max, Sign in with ChatGPT).
 *
 * The server runs the provider's login and relays its interaction: prompts go to the client and the client answers
 * them, while notifications (auth URL, device code, progress) are shown as they arrive. The browser usually cannot
 * reach the host's loopback callback, so a `manual_code` prompt takes the pasted code or redirect URL instead.
 *
 * A login lives on the server, not on a connection, so a reloaded page rejoins it. The login's whole state, including
 * earlier notifications, travels in `AuthLogin`, so a client that missed events still shows the auth URL.
 */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";

export const AuthLoginIdSchema = Type.String({
	minLength: 1,
	description: 'Chosen by the server, for example "login-1".',
});
export type AuthLoginId = Static<typeof AuthLoginIdSchema>;

export const AuthPromptTypeSchema = Type.Union(
	[
		Type.Literal("text"),
		Type.Literal("secret"),
		Type.Literal("select"),
		Type.Literal("manual_code", {
			description: "A pasted authorization code or redirect URL; the answer is never echoed back.",
		}),
	],
	{ description: "What kind of answer a prompt expects. `select` answers one of its options' ids." },
);
export type AuthPromptType = Static<typeof AuthPromptTypeSchema>;

export const AuthPromptOptionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	label: Type.String(),
	description: Type.Optional(Type.String()),
});
export type AuthPromptOption = Static<typeof AuthPromptOptionSchema>;

/** One question from a running login. */
export const AuthPromptSchema = Type.Object({
	id: Type.String({ minLength: 1, description: "Identifies this question; echo it with the answer." }),
	type: AuthPromptTypeSchema,
	message: Type.String(),
	placeholder: Type.Optional(Type.String()),
	options: Type.Optional(
		Type.Array(AuthPromptOptionSchema, { description: "The choices of a `select` prompt." }),
	),
});
export type AuthPrompt = Static<typeof AuthPromptSchema>;

export const AuthInfoLinkSchema = Type.Object({
	url: Type.String(),
	label: Type.Optional(Type.String()),
});
export type AuthInfoLink = Static<typeof AuthInfoLinkSchema>;

/** Something a running login reports to the user, with no answer expected. */
export const AuthEventSchema = Type.Union([
	Type.Object({
		type: Type.Literal("info"),
		message: Type.String(),
		links: Type.Optional(Type.Array(AuthInfoLinkSchema)),
	}),
	Type.Object({
		type: Type.Literal("auth_url"),
		url: Type.String({ description: "Open this in a browser to continue signing in." }),
		instructions: Type.Optional(Type.String()),
	}),
	Type.Object({
		type: Type.Literal("device_code"),
		userCode: Type.String(),
		verificationUri: Type.String(),
		intervalSeconds: Type.Optional(Type.Integer()),
		expiresInSeconds: Type.Optional(Type.Integer()),
	}),
	Type.Object({ type: Type.Literal("progress"), message: Type.String() }),
]);
export type AuthEvent = Static<typeof AuthEventSchema>;

/** `prompt` waits for an answer; `working` waits on the provider; the rest are final. */
export const AUTH_LOGIN_STATUSES = ["prompt", "working", "succeeded", "failed", "cancelled"] as const;
export const AuthLoginStatusSchema = Type.Union([
	Type.Literal("prompt"),
	Type.Literal("working"),
	Type.Literal("succeeded"),
	Type.Literal("failed"),
	Type.Literal("cancelled"),
]);
export type AuthLoginStatus = Static<typeof AuthLoginStatusSchema>;

/**
 * A login's complete state. Finished logins are kept briefly so a client that was not connected at the end still sees
 * why a login failed; `credentials.logins` returns them until they are pruned.
 */
export const AuthLoginSchema = Type.Object({
	id: AuthLoginIdSchema,
	providerId: Type.String({ minLength: 1 }),
	status: AuthLoginStatusSchema,
	prompt: Type.Optional(AuthPromptSchema),
	events: Type.Array(AuthEventSchema, {
		description: "Notifications so far, in order, so a reloaded client still shows the auth URL or device code.",
	}),
	error: Type.Optional(Type.String({ description: "Why it failed. Never contains a credential." })),
	startedAt: Type.Integer({ description: "Unix milliseconds." }),
	updatedAt: Type.Integer({ description: "Unix milliseconds." }),
});
export type AuthLogin = Static<typeof AuthLoginSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/** Every login this server knows: the running ones, plus finished ones kept for display. */
export const CredentialsLoginsRequestSchema = Type.Object({
	type: Type.Literal("credentials.logins"),
	id: RequestIdSchema,
});
export type CredentialsLoginsRequest = Static<typeof CredentialsLoginsRequestSchema>;

/**
 * Starts an OAuth login, or returns the one already running for that provider. The response carries the login's state
 * at that moment; later changes arrive as `credentials.login` events.
 */
export const CredentialsLoginStartRequestSchema = Type.Object({
	type: Type.Literal("credentials.loginStart"),
	id: RequestIdSchema,
	providerId: Type.String({ minLength: 1 }),
});
export type CredentialsLoginStartRequest = Static<typeof CredentialsLoginStartRequestSchema>;

/** Answers the login's current prompt. The answer is never echoed back or logged. */
export const CredentialsLoginAnswerRequestSchema = Type.Object({
	type: Type.Literal("credentials.loginAnswer"),
	id: RequestIdSchema,
	loginId: AuthLoginIdSchema,
	promptId: Type.String({ minLength: 1, description: "The id of the prompt being answered." }),
	value: Type.String({ description: "An option id for `select`, otherwise the typed or pasted text." }),
});
export type CredentialsLoginAnswerRequest = Static<typeof CredentialsLoginAnswerRequestSchema>;

/** Aborts a running login, which closes its callback server and waits. */
export const CredentialsLoginCancelRequestSchema = Type.Object({
	type: Type.Literal("credentials.loginCancel"),
	id: RequestIdSchema,
	loginId: AuthLoginIdSchema,
});
export type CredentialsLoginCancelRequest = Static<typeof CredentialsLoginCancelRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const CredentialsLoginsResponseSchema = Type.Object({
	type: Type.Literal("credentials.logins"),
	id: RequestIdSchema,
	logins: Type.Array(AuthLoginSchema),
});
export type CredentialsLoginsResponse = Static<typeof CredentialsLoginsResponseSchema>;

export const CredentialsLoginStartResponseSchema = Type.Object({
	type: Type.Literal("credentials.loginStart"),
	id: RequestIdSchema,
	login: AuthLoginSchema,
});
export type CredentialsLoginStartResponse = Static<typeof CredentialsLoginStartResponseSchema>;

export const CredentialsLoginAnswerResponseSchema = Type.Object({
	type: Type.Literal("credentials.loginAnswer"),
	id: RequestIdSchema,
	login: AuthLoginSchema,
});
export type CredentialsLoginAnswerResponse = Static<typeof CredentialsLoginAnswerResponseSchema>;

export const CredentialsLoginCancelResponseSchema = Type.Object({
	type: Type.Literal("credentials.loginCancel"),
	id: RequestIdSchema,
	cancelled: Type.Boolean({ description: "False when the login had already finished." }),
});
export type CredentialsLoginCancelResponse = Static<typeof CredentialsLoginCancelResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** A login started, changed status, asked a question, reported something, or finished. */
export const CredentialsLoginEventSchema = Type.Object({
	type: Type.Literal("credentials.login"),
	login: AuthLoginSchema,
});
export type CredentialsLoginEvent = Static<typeof CredentialsLoginEventSchema>;
