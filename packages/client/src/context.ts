/**
 * Helpers on top of the protocol's conversation-context types: a context describes one conversation (a thread's
 * coordinator or one of its workers), and a consumer that watches several conversations has to tell them apart.
 */
import type { ConversationContext } from "@kemiri/protocol";
import { isMainThread } from "./threads.ts";

/** The conversation a context is about: `workerId` undefined for the coordinator, `threadId` undefined for main. */
export type ContextTarget = {
	projectId: string;
	workerId?: string;
	threadId?: string;
};

/**
 * Whether a context belongs to a conversation. The protocol writes the coordinator's `workerId` as `null`, so a
 * consumer that reads `undefined` for "the coordinator" must normalise before comparing. Main's thread is `"main"` or,
 * on an older server, absent; both match a target without `threadId`.
 */
export function contextIsFor(context: ConversationContext, target: ContextTarget): boolean {
	if (context.projectId !== target.projectId) return false;
	if ((context.workerId ?? undefined) !== target.workerId) return false;
	const contextMain = isMainThread(context.threadId);
	const targetMain = isMainThread(target.threadId);
	if (contextMain || targetMain) return contextMain === targetMain;
	return context.threadId === target.threadId;
}

/** Which conversation a context describes, for grouping pushed contexts. */
export function contextTarget(context: ConversationContext): ContextTarget {
	return {
		projectId: context.projectId,
		...(context.workerId === null ? {} : { workerId: context.workerId }),
		...(isMainThread(context.threadId) ? {} : { threadId: context.threadId as string }),
	};
}
