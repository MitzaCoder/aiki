/**
 * Helpers on top of the protocol's memory types: which scope and project an event or a request addresses, and how a
 * search snippet's highlighted matches are read.
 *
 * The protocol carries the facts. What is shared here is what every consumer has to read the same way: a `memory.changed`
 * event names a scope and, for a project, its project; a snippet puts every match between `\u0002` and `\u0003`.
 */
import type { MemoryChangedEvent, MemoryScope } from "@kemiri/protocol";

/** The marker the server puts before a matching run in a search snippet. */
export const MEMORY_MATCH_START = "\u0002";
/** The marker the server puts after a matching run in a search snippet. */
export const MEMORY_MATCH_END = "\u0003";

/** One memory scope: global (about the user) or one project's. `projectId` is set for `project` only. */
export type MemoryTarget = {
	scope: MemoryScope;
	projectId?: string;
};

/** A run of snippet text, and whether the server matched it. */
export type MemorySnippetPart = {
	text: string;
	match: boolean;
};

/**
 * A snippet split into plain and matched runs, in order, for rendering: the markers are consumed and never shown.
 *
 * The markers pair up left to right. A `\u0002` while already matching is dropped, so an unclosed match runs to the end;
 * a `\u0003` while not matching is dropped. Empty runs are left out, so there are no zero-length parts.
 */
export function memorySnippetParts(snippet: string): MemorySnippetPart[] {
	const parts: MemorySnippetPart[] = [];
	let matching = false;
	let run = "";
	const flush = (): void => {
		if (run.length === 0) return;
		parts.push({ text: run, match: matching });
		run = "";
	};
	for (const character of snippet) {
		if (character === MEMORY_MATCH_START) {
			if (matching) continue;
			flush();
			matching = true;
			continue;
		}
		if (character === MEMORY_MATCH_END) {
			if (!matching) continue;
			flush();
			matching = false;
			continue;
		}
		run += character;
	}
	flush();
	return parts;
}

/** The scope and project a `memory.changed` event is about: the protocol writes a global event's project as `null`. */
export function memoryTargetOf(event: Pick<MemoryChangedEvent, "scope" | "projectId">): MemoryTarget {
	return event.projectId === null ? { scope: event.scope } : { scope: event.scope, projectId: event.projectId };
}

/** Whether a `memory.changed` event concerns one target; a global event never concerns a project's files. */
export function memoryChangedIsFor(
	event: Pick<MemoryChangedEvent, "scope" | "projectId">,
	target: MemoryTarget,
): boolean {
	if (event.scope !== target.scope) return false;
	if (event.scope === "global") return true;
	return event.projectId !== null && event.projectId === target.projectId;
}

/** The server's error code for `memory.undo` refusing a change that later writes touched. */
export const MEMORY_CONFLICT_CODE = "memory_conflict";

/**
 * Whether an error is `memory.undo` refusing the change because later commits touched the same files. Nothing was
 * reverted then; the server's other errors (`unknown_memory`) are not this.
 */
export function memoryUndoConflict(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === MEMORY_CONFLICT_CODE
	);
}
