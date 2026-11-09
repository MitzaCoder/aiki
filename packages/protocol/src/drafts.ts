/**
 * Chat drafts: what a user has typed in a chat's composer and not sent, kept on the backend per chat and synced between
 * devices (feature `chat-drafts`). A chat is a project plus `main` or a thread. The device's own copy is only a cache.
 *
 * `drafts.set` is a compare-and-set on the entry's `revision`; a refused write answers with the current entry and the
 * client decides (see "Chat drafts" in docs/DESIGN.md for the sync rules). Image attachments are references to bytes
 * uploaded once with `drafts.attachment.put`, never inline.
 */
import { type Static, Type } from "typebox";
import { ProjectIdSchema, RequestIdSchema } from "./common.ts";
import { INPUT_IMAGE_MAX_BYTES, INPUT_IMAGE_MIME_TYPES, INPUT_MAX_IMAGES } from "./images.ts";

/** Drafts not changed for this long are dropped by the server (and by a client's cache). */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DRAFT_TEXT_MAX_CHARS = 100_000;
export const DRAFT_QUOTE_MAX_CHARS = 50_000;
export const DRAFT_MAX_QUOTES = 20;
/** Text and quotes together. */
export const DRAFT_TOTAL_MAX_CHARS = 200_000;
/** As many as a message may carry images. */
export const DRAFT_MAX_ATTACHMENTS = INPUT_MAX_IMAGES;
/** One server keeps at most this many entries per project; the least recently changed one goes first. */
export const DRAFTS_MAX_PER_PROJECT = 100;
/** The image types and the size a message accepts (`images.ts`), and so the store. */
export const DRAFT_ATTACHMENT_MIME_TYPES = INPUT_IMAGE_MIME_TYPES;
export const DRAFT_ATTACHMENT_MAX_BYTES = INPUT_IMAGE_MAX_BYTES;
/** The chat of a project's main conversation. */
export const MAIN_DRAFT_THREAD = "main";

/** An image the draft holds by reference: `id` is the SHA-256 of the bytes in lowercase hex. */
export const DraftAttachmentSchema = Type.Object({
	id: Type.String({ pattern: "^[0-9a-f]{64}$" }),
	mimeType: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg"), Type.Literal("image/webp"), Type.Literal("image/gif")]),
	size: Type.Integer({ minimum: 0, maximum: DRAFT_ATTACHMENT_MAX_BYTES, description: "Bytes." }),
	name: Type.Optional(Type.String({ maxLength: 255 })),
});
export type DraftAttachment = Static<typeof DraftAttachmentSchema>;

/** Everything a composer holds before sending. Empty (no text, task, quotes or attachments) is never stored. */
export const DraftContentSchema = Type.Object({
	text: Type.String({ maxLength: DRAFT_TEXT_MAX_CHARS }),
	taskId: Type.Optional(Type.String({ minLength: 1, description: "The board task the message is about." })),
	quotes: Type.Array(Type.String({ maxLength: DRAFT_QUOTE_MAX_CHARS }), { maxItems: DRAFT_MAX_QUOTES }),
	attachments: Type.Optional(Type.Array(DraftAttachmentSchema, { maxItems: DRAFT_MAX_ATTACHMENTS })),
});
export type DraftContent = Static<typeof DraftContentSchema>;

/** Who wrote an entry: the writer's own device ID (the notification device ID) and a name for humans. */
export const DraftAuthorSchema = Type.Object({
	deviceId: Type.String({ minLength: 1, maxLength: 128 }),
	name: Type.Optional(Type.String({ maxLength: 80 })),
});
export type DraftAuthor = Static<typeof DraftAuthorSchema>;

/**
 * What the server keeps for one chat. `content` is null for a cleared draft: the entry stays (a tombstone) so a device
 * that was away can tell "cleared" from "never seen". No `author` on a clear the server made itself on submit.
 */
export const ChatDraftSchema = Type.Object({
	projectId: ProjectIdSchema,
	threadId: Type.String({ minLength: 1, description: 'The thread, or "main".' }),
	revision: Type.Integer({ minimum: 1, description: "Up by one for every change of this chat." }),
	updatedAt: Type.String(),
	author: Type.Optional(DraftAuthorSchema),
	content: Type.Union([DraftContentSchema, Type.Null()]),
});
export type ChatDraft = Static<typeof ChatDraftSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/** One chat's entry (`threadId` given; an empty list when it has none) or every entry of the project, tombstones included. */
export const DraftsGetRequestSchema = Type.Object({
	type: Type.Literal("drafts.get"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.Optional(Type.String({ minLength: 1 })),
});
export type DraftsGetRequest = Static<typeof DraftsGetRequestSchema>;

/**
 * Replace a chat's draft (`content`) or clear it (null), if `baseRevision` is the entry's revision (0 when the chat has no
 * entry). Otherwise nothing is written and the answer carries the current entry.
 */
export const DraftsSetRequestSchema = Type.Object({
	type: Type.Literal("drafts.set"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	threadId: Type.String({ minLength: 1 }),
	content: Type.Union([DraftContentSchema, Type.Null()]),
	baseRevision: Type.Integer({ minimum: 0 }),
	device: Type.Optional(DraftAuthorSchema),
});
export type DraftsSetRequest = Static<typeof DraftsSetRequestSchema>;

/** Upload an image once; a draft then names it by the returned `attachment`. The same bytes twice are one file. */
export const DraftsAttachmentPutRequestSchema = Type.Object({
	type: Type.Literal("drafts.attachment.put"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	mimeType: Type.String({ minLength: 1 }),
	data: Type.String({ description: "Base64-encoded image bytes." }),
	name: Type.Optional(Type.String({ maxLength: 255 })),
});
export type DraftsAttachmentPutRequest = Static<typeof DraftsAttachmentPutRequestSchema>;

export const DraftsAttachmentGetRequestSchema = Type.Object({
	type: Type.Literal("drafts.attachment.get"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	attachmentId: Type.String({ pattern: "^[0-9a-f]{64}$" }),
});
export type DraftsAttachmentGetRequest = Static<typeof DraftsAttachmentGetRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const DraftsGetResponseSchema = Type.Object({
	type: Type.Literal("drafts.get"),
	id: RequestIdSchema,
	drafts: Type.Array(ChatDraftSchema),
});
export type DraftsGetResponse = Static<typeof DraftsGetResponseSchema>;

export const DraftsSetResponseSchema = Type.Object({
	type: Type.Literal("drafts.set"),
	id: RequestIdSchema,
	applied: Type.Boolean({ description: "False when `baseRevision` was not the current one; nothing was written." }),
	draft: Type.Union([ChatDraftSchema, Type.Null()], {
		description: "The entry now stored (the current one when refused); null when the chat has none.",
	}),
});
export type DraftsSetResponse = Static<typeof DraftsSetResponseSchema>;

export const DraftsAttachmentPutResponseSchema = Type.Object({
	type: Type.Literal("drafts.attachment.put"),
	id: RequestIdSchema,
	attachment: DraftAttachmentSchema,
});
export type DraftsAttachmentPutResponse = Static<typeof DraftsAttachmentPutResponseSchema>;

export const DraftsAttachmentGetResponseSchema = Type.Object({
	type: Type.Literal("drafts.attachment.get"),
	id: RequestIdSchema,
	attachment: DraftAttachmentSchema,
	data: Type.String({ description: "Base64-encoded image bytes." }),
});
export type DraftsAttachmentGetResponse = Static<typeof DraftsAttachmentGetResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/**
 * A chat's draft changed: another device wrote it, or a message sent to the chat cleared it. Pushed to every connection
 * but the writer's (the clear on submit goes to all). Needs `chat-drafts`.
 */
export const DraftsChangedEventSchema = Type.Object({
	type: Type.Literal("drafts.changed"),
	projectId: ProjectIdSchema,
	threadId: Type.String({ minLength: 1 }),
	draft: ChatDraftSchema,
});
export type DraftsChangedEvent = Static<typeof DraftsChangedEventSchema>;

// --- helpers -----------------------------------------------------------------------------------------------------

/** The thread a draft is about: `main` when none is given. */
export function draftThreadId(threadId: string | undefined): string {
	return threadId === undefined ? MAIN_DRAFT_THREAD : threadId;
}

/** No text (after trimming), task, quotes or attachments. */
export function isEmptyDraftContent(content: DraftContent): boolean {
	return (
		content.text.trim().length === 0 &&
		content.taskId === undefined &&
		content.quotes.length === 0 &&
		(content.attachments === undefined || content.attachments.length === 0)
	);
}

/** Same text, task, quotes and attachments (a missing attachment list is an empty one); the `mimeType`/`name` of a ref does not count. */
export function sameDraftContent(left: DraftContent | null, right: DraftContent | null): boolean {
	if (left === null || right === null) return left === right;
	if (left.text !== right.text || left.taskId !== right.taskId) return false;
	if (left.quotes.length !== right.quotes.length || left.quotes.some((quote, index) => quote !== right.quotes[index])) return false;
	const leftFiles = left.attachments ?? [];
	const rightFiles = right.attachments ?? [];
	return leftFiles.length === rightFiles.length && leftFiles.every((file, index) => file.id === rightFiles[index]?.id);
}

/** Why a draft is over the caps (the one `drafts.set` refuses with), or undefined. Clients check before writing. */
export function draftLimitError(content: DraftContent): string | undefined {
	if (content.text.length > DRAFT_TEXT_MAX_CHARS) return `A draft's text is at most ${DRAFT_TEXT_MAX_CHARS} characters`;
	if (content.quotes.length > DRAFT_MAX_QUOTES) return `A draft holds at most ${DRAFT_MAX_QUOTES} quotes`;
	if (content.quotes.some((quote) => quote.length > DRAFT_QUOTE_MAX_CHARS)) {
		return `A quote in a draft is at most ${DRAFT_QUOTE_MAX_CHARS} characters`;
	}
	const total = content.text.length + content.quotes.reduce((sum, quote) => sum + quote.length, 0);
	if (total > DRAFT_TOTAL_MAX_CHARS) return `A draft's text and quotes together are at most ${DRAFT_TOTAL_MAX_CHARS} characters`;
	if ((content.attachments?.length ?? 0) > DRAFT_MAX_ATTACHMENTS) return `A draft holds at most ${DRAFT_MAX_ATTACHMENTS} attachments`;
	return undefined;
}
