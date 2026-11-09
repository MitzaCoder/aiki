/**
 * Artifacts: files a conversation keeps for the user, such as demo videos, screenshots, logs and reports.
 *
 * Any coordinator thread or worker saves one with its `artifact_save` tool, from a file in its working directory; the
 * backend copies it into the project's artifact store in its data directory, so it stays on that backend. Clients list
 * them per project, thread, worker or board task and fetch the bytes over HTTP: `artifacts.url` answers a URL with a
 * signed token valid for a few hours, which a `<video>` or `<img>` element can load directly, with byte ranges for
 * seeking. Publishing them anywhere else is up to the user's instructions.
 */
import { type Static, Type } from "typebox";
import { ProjectIdSchema, RequestIdSchema } from "./common.ts";

export const ArtifactKindSchema = Type.Union(
	[Type.Literal("video"), Type.Literal("image"), Type.Literal("audio"), Type.Literal("text"), Type.Literal("file")],
	{ description: "How the app shows it, from the MIME type: play, view, read, or download." },
);
export type ArtifactKind = Static<typeof ArtifactKindSchema>;

export const ArtifactSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	projectId: ProjectIdSchema,
	name: Type.String({ minLength: 1, description: "File name, e.g. \"checkout-flow.webm\"." }),
	title: Type.Union([Type.String(), Type.Null()], { description: "What it shows, in a few words." }),
	note: Type.Union([Type.String(), Type.Null()], { description: "Longer description, Markdown." }),
	kind: ArtifactKindSchema,
	mimeType: Type.String(),
	size: Type.Integer({ minimum: 0, description: "Bytes." }),
	durationSeconds: Type.Union([Type.Number({ minimum: 0 }), Type.Null()], { description: "Video or audio, when known." }),
	threadId: Type.String({ minLength: 1, description: 'The thread it belongs to; "main" for main and its workers.' }),
	workerId: Type.Union([Type.String(), Type.Null()], { description: "The worker that saved it, if one did." }),
	taskId: Type.Union([Type.String(), Type.Null()], { description: "The board task it is evidence for." }),
	sourcePath: Type.String({ description: "Where the file was when it was saved." }),
	/**
	 * Free-form short lowercase words (`web`, `phone`, `dark`, `before`): what platform and state the media shows. Absent
	 * on servers older than the `artifact-tags` feature, which reads as none. Normalised by the server (`normalizeTags`).
	 */
	tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Normalised: lowercase, unique, in order." })),
	createdAt: Type.String(),
});
export type Artifact = Static<typeof ArtifactSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/** Newest first. Every filter is optional; together they narrow the list. */
export const ArtifactsListRequestSchema = Type.Object({
	type: Type.Literal("artifacts.list"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(Type.String({ minLength: 1 })),
	workerId: Type.Optional(Type.String({ minLength: 1 })),
	taskId: Type.Optional(Type.String({ minLength: 1 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Default 100." })),
});
export type ArtifactsListRequest = Static<typeof ArtifactsListRequestSchema>;

/** A URL the client can load the artifact's bytes from, with `download` asking for an attachment. */
export const ArtifactsUrlRequestSchema = Type.Object({
	type: Type.Literal("artifacts.url"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	artifactId: Type.String({ minLength: 1 }),
	download: Type.Optional(Type.Boolean()),
});
export type ArtifactsUrlRequest = Static<typeof ArtifactsUrlRequestSchema>;

export const ArtifactsDeleteRequestSchema = Type.Object({
	type: Type.Literal("artifacts.delete"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	artifactId: Type.String({ minLength: 1 }),
});
export type ArtifactsDeleteRequest = Static<typeof ArtifactsDeleteRequestSchema>;

/**
 * Replaces an artifact's tags (feature `artifact-tags`). The server normalises them (trim, lowercase, dedupe, length and
 * count caps) and answers with the row as stored; an empty array clears them. Pushed as `artifacts.changed`.
 */
export const ArtifactsUpdateRequestSchema = Type.Object({
	type: Type.Literal("artifacts.update"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	artifactId: Type.String({ minLength: 1 }),
	tags: Type.Array(Type.String(), { maxItems: 100 }),
});
export type ArtifactsUpdateRequest = Static<typeof ArtifactsUpdateRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const ArtifactsListResponseSchema = Type.Object({
	type: Type.Literal("artifacts.list"),
	id: RequestIdSchema,
	artifacts: Type.Array(ArtifactSchema),
});
export type ArtifactsListResponse = Static<typeof ArtifactsListResponseSchema>;

export const ArtifactsUrlResponseSchema = Type.Object({
	type: Type.Literal("artifacts.url"),
	id: RequestIdSchema,
	url: Type.String({ description: "Absolute URL on this backend's origin, token included." }),
	expiresAt: Type.String(),
});
export type ArtifactsUrlResponse = Static<typeof ArtifactsUrlResponseSchema>;

export const ArtifactsDeleteResponseSchema = Type.Object({
	type: Type.Literal("artifacts.delete"),
	id: RequestIdSchema,
});
export type ArtifactsDeleteResponse = Static<typeof ArtifactsDeleteResponseSchema>;

export const ArtifactsUpdateResponseSchema = Type.Object({
	type: Type.Literal("artifacts.update"),
	id: RequestIdSchema,
	artifact: ArtifactSchema,
});
export type ArtifactsUpdateResponse = Static<typeof ArtifactsUpdateResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** One artifact was saved, deleted or had its tags changed (`deleted` false); clients showing a list that could hold it read again. */
export const ArtifactsChangedEventSchema = Type.Object({
	type: Type.Literal("artifacts.changed"),
	projectId: ProjectIdSchema,
	artifact: ArtifactSchema,
	deleted: Type.Boolean(),
});
export type ArtifactsChangedEvent = Static<typeof ArtifactsChangedEventSchema>;

// --- tags ----------------------------------------------------------------------------------------------------------

/** The most tags one artifact keeps; more are dropped from the end. */
export const ARTIFACT_MAX_TAGS = 12;
/** The longest a tag is, in characters; a longer one is cut. */
export const ARTIFACT_MAX_TAG_LENGTH = 24;
/** Suggested in tool descriptions and the app: platform, form factor, theme, and before/after state. */
export const SUGGESTED_ARTIFACT_TAGS = ["web", "android", "phone", "desktop", "tablet", "dark", "light", "before", "after"] as const;

/**
 * One tag in its stored form: trimmed, lowercase, runs of whitespace and separators as one `-`, no characters but
 * letters, digits, `-`, `_`, `.`, `+` and `:`, cut to `ARTIFACT_MAX_TAG_LENGTH`; `undefined` when nothing is left.
 */
export function normalizeTag(tag: string): string | undefined {
	const cleaned = tag
		.normalize("NFKC")
		.trim()
		.toLowerCase()
		.replace(/[\s,;/\\]+/g, "-")
		.replace(/[^\p{L}\p{N}\-_.+:]/gu, "")
		.replace(/^[-_.:+]+|[-_.:+]+$/g, "")
		.slice(0, ARTIFACT_MAX_TAG_LENGTH)
		.replace(/[-_.:+]+$/g, "");
	return cleaned.length === 0 ? undefined : cleaned;
}

/** A list of tags as stored: each normalised, duplicates dropped (first wins), at most `ARTIFACT_MAX_TAGS`. */
export function normalizeTags(tags: readonly string[] | undefined | null): string[] {
	const seen = new Set<string>();
	for (const tag of tags ?? []) {
		const normal = normalizeTag(tag);
		if (normal !== undefined) seen.add(normal);
		if (seen.size >= ARTIFACT_MAX_TAGS) break;
	}
	return [...seen];
}
