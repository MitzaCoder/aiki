/** One-time upgrade of pre-attention projects, before the server accepts connections. No Harness or agent starts. */
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { ConversationId } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { BoardState } from "./board.ts";
import type { WorkersState } from "./workers.ts";
import type { ThreadsState } from "./threads.ts";
import { boardAttention, workerAttention, threadAttention, EMPTY_ATTENTION } from "./sidebar-attention.ts";
import type { ProjectAttention } from "@aiki/protocol";

export async function readStoredAttention(file: string): Promise<ProjectAttention> {
	if (!(await Bun.file(file).exists())) return { ...EMPTY_ATTENTION };
	const storage = await openNodeSqliteStorage(file);
	try {
		const conversations = await storage.scanConversations({ order: "ascending" }, 1, undefined, BACKGROUND_CONTEXT);
		const main = conversations.items[0];
		if (main === undefined) return { ...EMPTY_ATTENTION };
		async function doc<T>(conversationId: ConversationId, kind: string): Promise<T | undefined> {
			const record = await storage.findDocument({ kind, scope: { kind: "conversation", conversationId } }, "current", BACKGROUND_CONTEXT);
			return record === undefined ? undefined : (await storage.document(record.id, "current", BACKGROUND_CONTEXT))?.value as T | undefined;
		}
		const board = await doc<BoardState>(main.id, "aiki.board");
		const threads = Object.values((await doc<ThreadsState>(main.id, "aiki.threads"))?.threads ?? {});
		const workers = [];
		for (const conversationId of [main.id, ...threads.map((thread) => thread.conversationId as ConversationId)]) {
			workers.push(...Object.values((await doc<WorkersState>(conversationId, "aiki.workers"))?.workers ?? {}));
		}
		return {
			...EMPTY_ATTENTION,
			...(board === undefined ? {} : boardAttention(board)),
			...workerAttention(workers),
			...threadAttention(threads.map((thread) => ({ ...thread, main: false }))),
			runningWorkers: 0, // Never trust an in-flight status left by a dead process.
		};
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
}
