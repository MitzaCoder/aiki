/**
 * One chat's line to the backend's draft store, for the composer: what `DraftSync` needs (`available`, `read`, `write`)
 * plus the pushes for this chat and who this device is. Built in `ProjectChat` for the chat on screen.
 */
import { loadDeviceSettings, deviceNameFromUserAgent } from "@aiki/client";
import { draftThreadId, type ChatDraft, type DraftAuthor } from "@aiki/protocol";
import { imageBytes, UploadTracker } from "./draft-images.ts";
import type { DraftSyncTransport } from "./drafts-sync.ts";
import type { BackendConnection } from "./harness.svelte.ts";

export interface DraftChannel extends DraftSyncTransport {
	/** Calls `listener` for each `drafts.changed` push about this chat. */
	onChanged(listener: (entry: ChatDraft) => void): () => void;
	/** The bytes of an image another device attached to a draft of this project. */
	readAttachment(id: string): Promise<{ mimeType: string; data: string }>;
	/** This device: the one the notification settings use, and its name ("Pixel 8", "Linux"). */
	readonly device: DraftAuthor;
}

/** This browser's own identity, made up the first time and kept (the notification device ID). */
export function thisDevice(): DraftAuthor {
	const name = deviceNameFromUserAgent(typeof navigator === "undefined" ? "" : navigator.userAgent);
	try {
		return { deviceId: loadDeviceSettings().deviceId, name };
	} catch {
		return { deviceId: "unknown-browser", name };
	}
}

export function draftChannel(backend: BackendConnection, projectId: string, threadId: string | undefined): DraftChannel {
	const chat = draftThreadId(threadId);
	const device = thisDevice();
	// The images a write names go up first, so the backend never holds a draft that points at nothing.
	const uploads = new UploadTracker(imageBytes, (attachment, data) =>
		backend.client.uploadDraftAttachment(projectId, attachment.mimeType, data, attachment.name),
	);
	return {
		device,
		available: () => backend.supportsDrafts,
		read: async () => (await backend.client.readDrafts(projectId, chat))[0],
		write: async (content, baseRevision) => {
			try {
				await uploads.ensure(content);
				const result = await backend.client.writeDraft(projectId, chat, content, baseRevision, device);
				if (result.applied) uploads.wrote(content);
				return result;
			} catch (error) {
				uploads.reset();
				throw error;
			}
		},
		readAttachment: async (id) => {
			const { attachment, data } = await backend.client.readDraftAttachment(projectId, id);
			return { mimeType: attachment.mimeType, data };
		},
		onChanged: (listener) =>
			backend.client.onDraftsChanged((event) => {
				if (event.projectId === projectId && event.threadId === chat) listener(event.draft);
			}),
	};
}
