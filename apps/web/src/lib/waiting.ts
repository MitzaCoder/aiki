/**
 * Messages the user sent that the conversation has not placed yet, and how they join the transcript.
 *
 * A message sent while a run is busy waits in the server's queue (`ConversationView.queued`, feature `queued-inputs`)
 * until the run takes it at a tool boundary (a steer) or when its turn ends (a follow-up). Until then it is drawn at
 * the end of the transcript as the user's own bubble in a waiting state; when the run places it, the same element
 * becomes the real user entry (matched by submission ID, never by text). Pure: the screen's `WaitingMessages` holds the
 * state and the requests.
 */
import type { EntryRecord, QueuedInput } from "@aiki/protocol";
import { parseTaskReference, withTaskReference } from "@aiki/client";
import type { HeldImage } from "./chat/images.ts";
import { isTypedInput, type TranscriptItem, type WaitingInfo } from "./transcript.ts";

/** A message this screen sent: where its request stands. */
export type LocalSend = {
	/** The deduplication key of the request, reused by a retry so a message the server did admit is not sent twice. */
	requestId: string;
	/** What was typed, without the task reference. */
	text: string;
	taskId?: string;
	/** The images that went with it, kept so Retry sends them again and Edit gives them back. */
	images?: HeldImage[];
	/**
	 * `sending`: the request is out. `queued`: the server answered that the run is busy; the view will list it.
	 * `failed`: the request did not go through. `placed`: the run has it (or the server placed it at once).
	 */
	state: "sending" | "queued" | "failed" | "placed";
	submissionId?: number;
	error?: string;
	/** When it was sent, in milliseconds since the epoch. */
	at: number;
	/** Whether a run was busy when it was sent; an idle send needs no bubble while it is on its way. */
	wasBusy: boolean;
	/** Counted in milliseconds since the answer came, for `queued` messages the view never listed. */
	answeredAt?: number;
};

/** A message in the waiting state, with everything its bubble and its actions need. */
export type WaitingMessage = {
	/** The element key; the entry it becomes is built with the same one. */
	key: string;
	state: WaitingInfo["state"];
	/** The text as typed, without the task reference. */
	text: string;
	taskId?: string;
	/** The images, when this screen sent the message and still holds them. */
	images?: HeldImage[];
	/** How many images the message carries, as the server lists it; more than `images` when it came from elsewhere. */
	imageCount?: number;
	mode?: "steer" | "followUp";
	at?: number;
	inputId?: number;
	requestId?: string;
	error?: string;
};

/** The element key of a message this screen sent. */
export function sendKey(requestId: string): string {
	return `msg-${requestId}`;
}

/** The element key of a message from elsewhere (another device, the harness) waiting under its submission. */
export function inputKey(inputId: number): string {
	return `input-${inputId}`;
}

/** How long a message the server said it queued may stay unlisted before its record is dropped: the run took it first. */
export const UNLISTED_GRACE_MS = 4_000;

function queuedMessage(item: QueuedInput, send: LocalSend | undefined): WaitingMessage {
	return {
		key: send === undefined ? inputKey(item.id) : sendKey(send.requestId),
		state: "waiting",
		text: item.text,
		...(item.taskId === undefined ? {} : { taskId: item.taskId }),
		...(send?.images === undefined ? {} : { images: send.images }),
		...(item.images === undefined ? {} : { imageCount: item.images }),
		mode: item.mode,
		...(item.at === undefined ? {} : { at: item.at }),
		inputId: item.id,
		...(item.requestId === undefined ? {} : { requestId: item.requestId }),
	};
}

/** The queued inputs that are the user's typing; the harness's own notes (reports, check-ins) are not drawn waiting. */
export function typedQueue(queued: readonly QueuedInput[] | undefined): QueuedInput[] {
	return (queued ?? []).filter((item) => (item.images ?? 0) === 0 ? isTypedInput(item.text) : true);
}

/**
 * Every message to draw in the waiting state, in the order they sit under the transcript: what was lost, what failed,
 * then what waits in the queue (oldest first), then requests still on their way.
 */
export function waitingMessages(args: {
	queued: readonly QueuedInput[] | undefined;
	sends: readonly LocalSend[];
	lost: readonly WaitingMessage[];
}): WaitingMessage[] {
	const queued = typedQueue(args.queued);
	const byRequest = new Map(args.sends.map((send) => [send.requestId, send]));
	const bySubmission = new Map(args.sends.flatMap((send) => (send.submissionId === undefined ? [] : [[send.submissionId, send] as const])));
	const listed = new Set<string>();

	const waiting: WaitingMessage[] = [];
	for (const item of [...queued].sort((left, right) => left.id - right.id)) {
		const send =
			(item.requestId === undefined ? undefined : byRequest.get(item.requestId)) ?? bySubmission.get(item.id);
		if (send !== undefined) listed.add(send.requestId);
		waiting.push(queuedMessage(item, send));
	}

	const failed: WaitingMessage[] = [];
	const onTheWay: WaitingMessage[] = [];
	for (const send of args.sends) {
		if (listed.has(send.requestId)) continue;
		const base = {
			key: sendKey(send.requestId),
			text: send.text,
			...(send.taskId === undefined ? {} : { taskId: send.taskId }),
			...(send.images === undefined ? {} : { images: send.images, imageCount: send.images.length }),
			at: send.at,
			requestId: send.requestId,
		};
		if (send.state === "failed") {
			failed.push({ ...base, state: "failed", ...(send.error === undefined ? {} : { error: send.error }) });
		} else if (send.state === "sending" && send.wasBusy) {
			onTheWay.push({ ...base, state: "sending" });
		} else if (send.state === "queued") {
			// The server said it waits; the view will list it in a moment, and until then it looks like it will.
			onTheWay.push({
				...base,
				state: "waiting",
				mode: "steer",
				...(send.submissionId === undefined ? {} : { inputId: send.submissionId }),
			});
		}
	}
	const byTime = (left: WaitingMessage, right: WaitingMessage): number => (left.at ?? 0) - (right.at ?? 0);
	return [...args.lost, ...failed.sort(byTime), ...waiting, ...onTheWay.sort(byTime)];
}

/** The text of the transcript's own copy of a message: with its task reference, as the server wrote it. */
function rawText(message: WaitingMessage): string {
	return message.taskId === undefined ? message.text : withTaskReference(message.taskId, message.text);
}

/** Add the waiting messages to the end of a transcript as user items in their waiting state. */
export function withWaiting(
	items: readonly TranscriptItem[],
	waiting: readonly WaitingMessage[],
	pending: ReadonlySet<string> = new Set(),
): TranscriptItem[] {
	if (waiting.length === 0) return items as TranscriptItem[];
	const taken = new Set(items.map((item) => item.key));
	const extra: TranscriptItem[] = [];
	for (const message of waiting) {
		// An entry that already carries this key is the message placed: nothing waits any more.
		if (taken.has(message.key)) continue;
		const info: WaitingInfo = {
			state: message.state,
			...(message.mode === undefined ? {} : { mode: message.mode }),
			...(message.error === undefined ? {} : { error: message.error }),
			...(pending.has(message.key) ? { pending: true } : {}),
		};
		extra.push({
			kind: "user",
			key: message.key,
			text: rawText(message),
			images: (message.images ?? []).map(({ data, mimeType }) => ({ data, mimeType })),
			...(message.imageCount === undefined || message.imageCount <= (message.images?.length ?? 0) ? {} : { imageCount: message.imageCount }),
			...(message.at === undefined ? {} : { timestamp: message.at }),
			waiting: info,
		});
	}
	return extra.length === 0 ? (items as TranscriptItem[]) : [...items, ...extra];
}

/** The text a user entry shows, as `buildTranscript` reads it. */
function entryTypedText(entry: EntryRecord): string {
	const messages = (entry.model ?? []) as { role?: string; content?: unknown }[];
	return messages
		.filter((message) => message.role === "user")
		.map((message) => {
			const content = message.content;
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return "";
			return content
				.map((block) => (typeof block === "object" && block !== null && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
				.join("");
		})
		.join("\n");
}

export type Departures = {
	/** Inputs the run took: their entry is in the transcript. */
	placed: QueuedInput[];
	/** Inputs that left the queue without an entry: withdrawn, by Stop or from another device. */
	withdrawn: QueuedInput[];
};

/**
 * What left the queue between two views. An input is placed when an entry carries its submission ID. For an entry the
 * server could not tag, an untagged user entry newer than `seenEntryId` with the same text counts as the input placed.
 * Anything else was withdrawn.
 */
export function departures(args: {
	previous: readonly QueuedInput[];
	current: readonly QueuedInput[] | undefined;
	entries: readonly EntryRecord[];
	seenEntryId: number;
}): Departures {
	const still = new Set((args.current ?? []).map((item) => item.id));
	const tagged = new Set(args.entries.flatMap((entry) => (entry.submissionId === undefined ? [] : [entry.submissionId])));
	const untagged = args.entries.filter(
		(entry) => entry.kind === "pi.user" && entry.submissionId === undefined && entry.id > args.seenEntryId,
	);
	const claimed = new Set<number>();
	const result: Departures = { placed: [], withdrawn: [] };
	for (const item of args.previous) {
		if (still.has(item.id)) continue;
		if (tagged.has(item.id)) {
			result.placed.push(item);
			continue;
		}
		const match = untagged.find((entry) => {
			if (claimed.has(entry.id)) return false;
			return parseTaskReference(entryTypedText(entry)).text === item.text;
		});
		if (match !== undefined) {
			claimed.add(match.id);
			result.placed.push(item);
		} else {
			result.withdrawn.push(item);
		}
	}
	return result;
}

/** The newest entry ID in a list, or 0. */
export function newestEntryId(entries: readonly EntryRecord[]): number {
	return entries.at(-1)?.id ?? 0;
}

/** How the waiting state reads under the bubble. */
export function waitingStatus(info: WaitingInfo, target: "coordinator" | "thread"): { label: string; detail?: string } {
	switch (info.state) {
		case "sending":
			return { label: "Sending" };
		case "waiting":
			return info.mode === "followUp"
				? { label: "Waiting", detail: `sent when the current turn ends` }
				: { label: "Waiting", detail: `reaches the ${target} at its next step` };
		case "failed":
			return { label: "Not sent", ...(info.error === undefined ? {} : { detail: info.error }) };
		case "withdrawn":
			return { label: "Not sent", detail: "taken out of the queue before it was read" };
	}
}
