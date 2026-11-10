/**
 * The device's own copy of unsent composer drafts, one per chat: backend + project + conversation (main or a thread). A
 * draft is everything the composer holds before sending: the text, the picked task, the waiting quotes and, when another
 * device attached images, references to them (kept as they are, the web composer cannot show them). With the backend's
 * `chat-drafts` this is a cache (instant restore, offline use); the draft itself lives on the backend (`drafts-sync.ts`).
 *
 * They live in one localStorage entry so a reload keeps them. Every call reads and writes the stored entry (nothing is
 * cached), so two tabs never overwrite each other's other chats. Alongside the draft an entry remembers what this device
 * last knew to be on the backend (`rev`, `base`), so text typed offline is found and pushed later. Drafts that are empty
 * (and have nothing unsynced) or older than 30 days are dropped.
 */
import { DRAFT_MAX_AGE_MS, type DraftAttachment } from "@aiki/protocol";

export { DRAFT_MAX_AGE_MS };
export const DRAFTS_STORAGE_KEY = "aiki.drafts.v1";

export interface Draft {
	text: string;
	taskId?: string;
	quotes: string[];
	attachments?: DraftAttachment[];
}

/** What this device last knew the backend held for a chat: its revision (0 for none) and content (null for none). */
export interface SyncedDraft {
	revision: number;
	content: Draft | null;
}

interface StoredDraft extends Draft {
	/** When the draft last changed (ms since the epoch). */
	at: number;
	/** The backend's revision this device last saw, and the content it had then. Absent for a draft never synced. */
	rev?: number;
	base?: Draft;
}

/** The part of `Storage` used here. */
export interface DraftStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** The key of one chat's draft. `threadId` undefined (or "main") is the project's main chat. */
export function draftKey(backendId: string, projectId: string, threadId?: string): string {
	return JSON.stringify([backendId, projectId, threadId === undefined || threadId === "main" ? "main" : threadId]);
}

export function isEmptyDraft(draft: Draft): boolean {
	return (
		draft.text.trim().length === 0 && draft.taskId === undefined && draft.quotes.length === 0 && (draft.attachments?.length ?? 0) === 0
	);
}

const NO_DRAFT: Draft = { text: "", quotes: [] };

function toDraft(value: unknown): Draft | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const entry = value as Record<string, unknown>;
	if (typeof entry.text !== "string") return undefined;
	const quotes = Array.isArray(entry.quotes) ? entry.quotes.filter((quote): quote is string => typeof quote === "string") : [];
	const taskId = typeof entry.taskId === "string" ? entry.taskId : undefined;
	const attachments = Array.isArray(entry.attachments)
		? entry.attachments.filter(
				(item): item is DraftAttachment =>
					typeof item === "object" && item !== null && typeof (item as DraftAttachment).id === "string" && typeof (item as DraftAttachment).mimeType === "string",
			)
		: [];
	return { text: entry.text, quotes, ...(taskId === undefined ? {} : { taskId }), ...(attachments.length === 0 ? {} : { attachments }) };
}

function copy(draft: Draft): Draft {
	return {
		text: draft.text,
		quotes: [...draft.quotes],
		...(draft.taskId === undefined ? {} : { taskId: draft.taskId }),
		...(draft.attachments === undefined || draft.attachments.length === 0 ? {} : { attachments: draft.attachments.map((item) => ({ ...item })) }),
	};
}

function parse(raw: string | null, now: number): Record<string, StoredDraft> {
	if (raw === null) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const result: Record<string, StoredDraft> = {};
		for (const [key, value] of Object.entries(parsed)) {
			const draft = toDraft(value);
			const entry = value as Record<string, unknown>;
			if (draft === undefined || typeof entry.at !== "number") continue;
			if (now - entry.at > DRAFT_MAX_AGE_MS) continue;
			const base = toDraft(entry.base);
			const stored: StoredDraft = {
				...draft,
				at: entry.at,
				...(typeof entry.rev === "number" && base !== undefined ? { rev: entry.rev, base } : {}),
			};
			if (!isEmptyDraft(stored) || (stored.base !== undefined && !isEmptyDraft(stored.base))) result[key] = stored;
		}
		return result;
	} catch {
		return {};
	}
}

function write(storage: DraftStorage, all: Record<string, StoredDraft>): void {
	try {
		storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(all));
	} catch {
		// Storage full or blocked: the draft is only lost on reload.
	}
}

/** The draft saved for a chat, or an empty one. */
export function loadDraft(storage: DraftStorage, key: string, now = Date.now()): Draft {
	return loadDraftState(storage, key, now).draft;
}

/** The draft saved for a chat with what this device last knew the backend held (revision 0 and nothing, if never synced). */
export function loadDraftState(storage: DraftStorage, key: string, now = Date.now()): { draft: Draft; synced: SyncedDraft } {
	const found = parse(storage.getItem(DRAFTS_STORAGE_KEY), now)[key];
	if (found === undefined) return { draft: copy(NO_DRAFT), synced: { revision: 0, content: null } };
	return {
		draft: copy(found),
		synced: { revision: found.rev ?? 0, content: found.base === undefined || isEmptyDraft(found.base) ? null : copy(found.base) },
	};
}

/** Saves a chat's draft and what the backend is known to hold for it. Expired drafts of other chats go too. */
export function saveDraftState(storage: DraftStorage, key: string, draft: Draft, synced: SyncedDraft, now = Date.now()): void {
	const all = parse(storage.getItem(DRAFTS_STORAGE_KEY), now);
	const base = synced.content === null || isEmptyDraft(synced.content) ? undefined : copy(synced.content);
	if (isEmptyDraft(draft) && base === undefined) delete all[key];
	else all[key] = { ...copy(draft), at: now, rev: synced.revision, base: base ?? copy(NO_DRAFT) };
	write(storage, all);
}

/** Saves a chat's draft, keeping what is known of the backend's copy; an empty one removes it (unless that is unsynced). */
export function saveDraft(storage: DraftStorage, key: string, draft: Draft, now = Date.now()): void {
	const known = parse(storage.getItem(DRAFTS_STORAGE_KEY), now)[key];
	if (known?.rev === undefined) {
		const all = parse(storage.getItem(DRAFTS_STORAGE_KEY), now);
		if (isEmptyDraft(draft)) delete all[key];
		else all[key] = { ...copy(draft), at: now };
		write(storage, all);
		return;
	}
	saveDraftState(storage, key, draft, { revision: known.rev, content: known.base ?? null }, now);
}

export function clearDraft(storage: DraftStorage, key: string, now = Date.now()): void {
	saveDraft(storage, key, { text: "", quotes: [] }, now);
}
