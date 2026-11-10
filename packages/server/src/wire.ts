/** Durable records carry branded numeric IDs; the wire uses plain numbers. */
import type {
	ConversationRecord as DurableConversationRecord,
	EntryRecord as DurableEntryRecord,
} from "@earendil-works/pi-durable";
import type { ConversationRecord, EntryRecord } from "@aiki/protocol";

export function wireEntry(entry: DurableEntryRecord): EntryRecord {
	return {
		id: entry.id,
		conversationId: entry.conversationId,
		kind: entry.kind,
		...(entry.model === undefined ? {} : { model: entry.model as unknown[] }),
		...(entry.data === undefined ? {} : { data: entry.data }),
		...(entry.head === undefined ? {} : { head: entry.head }),
		...(entry.edits === undefined ? {} : { edits: entry.edits as unknown[] }),
		...(entry.byTaskId === undefined ? {} : { byTaskId: entry.byTaskId }),
	};
}

export function wireConversation(record: DurableConversationRecord): ConversationRecord {
	return {
		id: record.id,
		...(record.parent === undefined
			? {}
			: { parent: { conversationId: record.parent.conversationId, at: record.parent.at } }),
		...(record.owner === undefined
			? {}
			: {
					owner: {
						conversationId: record.owner.conversationId,
						taskId: record.owner.taskId,
					},
				}),
	};
}
