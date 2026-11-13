/**
 * How a memory tool call reads in the transcript. The tools are defined in
 * packages/server/src/memory-tools.ts: their arguments are the call's, their
 * result text is what the model saw, and `details` carries the small facts
 * (scope, file, created) worth trusting over the prose. Parsing is pure so the
 * card can stay a dumb renderer.
 */
import {
	MEMORY_MATCH_END,
	MEMORY_MATCH_START,
	memorySnippetParts,
	type MemorySnippetPart
} from "@kemiri/client";
import type { MemoryScope } from "@kemiri/protocol";
import type { ToolPart } from "#lib/transcript.js";

export const MEMORY_TOOL_NAMES = ["memory_search", "memory_read", "memory_write", "memory_archive"] as const;
export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];

export function isMemoryTool(name: string): name is MemoryToolName {
	return (MEMORY_TOOL_NAMES as readonly string[]).includes(name);
}

export type MemoryCallKind = "search" | "read" | "write" | "archive";
/** A search can cover both scopes; the other calls name exactly one. */
export type MemoryScopeView = MemoryScope | "both";

export function memoryScopeBadge(scope: MemoryScopeView): string {
	return scope === "both" ? "Both" : scope === "global" ? "Global" : "Project";
}

export type MemoryHit = {
	scope: MemoryScope;
	fileId: string;
	title: string;
	/** Null for the topic's introduction. */
	heading: string | null;
	rank: number;
	parts: MemorySnippetPart[];
};

export type MemoryMatch = {
	scope: MemoryScope;
	fileId: string;
	title: string;
	heading: string | null;
	parts: MemorySnippetPart[];
};

export type MemorySection = { heading: string; text: string };

type Common = {
	kind: MemoryCallKind;
	/** One line, in words, for the collapsed card. */
	summary: string;
	scope: MemoryScopeView;
	/** The full tool result, for an error or a fallback. */
	output: string;
	isError: boolean;
};

export type MemorySearchCall = Common & {
	kind: "search";
	query: string;
	hits: MemoryHit[];
	matchCount: number;
};

export type MemoryReadCall = Common & {
	kind: "read";
	fileId: string;
	title?: string;
	summaryText?: string;
	tags: string[];
	status?: string;
	updated?: string;
	intro: string;
	sections: MemorySection[];
	links: MemoryMatch[];
};

export type MemoryWriteOutcome = "created" | "updated" | "unchanged" | "suggested" | "failed";

export type MemoryWriteCall = Common & {
	kind: "write";
	fileId: string;
	heading?: string;
	text: string;
	outcome: MemoryWriteOutcome;
	closeMatches: MemoryMatch[];
};

export type MemoryArchiveCall = Common & {
	kind: "archive";
	fileId: string;
	reason?: string;
};

export type MemoryCallView = MemorySearchCall | MemoryReadCall | MemoryWriteCall | MemoryArchiveCall;

const TOOL_LABELS: Record<MemoryCallKind, string> = {
	search: "Memory search",
	read: "Memory read",
	write: "Memory write",
	archive: "Memory archive"
};

function argsOf(part: ToolPart): Record<string, unknown> {
	return (part.arguments ?? {}) as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function detailsOf(part: ToolPart): Record<string, unknown> {
	return typeof part.details === "object" && part.details !== null ? (part.details as Record<string, unknown>) : {};
}

function scopeOf(value: unknown, fallback: MemoryScopeView): MemoryScopeView {
	return value === "global" || value === "project" || value === "both" ? value : fallback;
}

function scopeFromDetails(details: Record<string, unknown>, fallback: MemoryScope): MemoryScope {
	const value = details.scope;
	return value === "global" || value === "project" ? value : fallback;
}

/**
 * Split a snippet for display. The server's `\u0002`/`\u0003` markers win when they are
 * present; otherwise the query's terms are marked like FTS would match them:
 * case-insensitive, at the start of a word and as a prefix of it.
 */
export function highlightedSnippetParts(snippet: string, query: string): MemorySnippetPart[] {
	if (snippet.includes(MEMORY_MATCH_START) || snippet.includes(MEMORY_MATCH_END)) {
		return memorySnippetParts(snippet);
	}
	const terms = (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((term) => term.length > 0);
	if (terms.length === 0) return memorySnippetParts(snippet);
	const parts: MemorySnippetPart[] = [];
	let cursor = 0;
	for (const word of snippet.matchAll(/[\p{L}\p{N}_]+/gu)) {
		const at = word.index ?? 0;
		if (at > cursor) parts.push({ text: snippet.slice(cursor, at), match: false });
		const token = word[0];
		const lower = token.toLowerCase();
		parts.push({ text: token, match: terms.some((term) => lower.startsWith(term)) });
		cursor = at + token.length;
	}
	if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), match: false });
	return parts;
}

function snippetParts(snippet: string, query = ""): MemorySnippetPart[] {
	return highlightedSnippetParts(snippet.trim(), query);
}

function plural(count: number, singular: string, pluralForm = singular + "s"): string {
	return count === 1 ? singular : pluralForm;
}

function searchHits(output: string, query: string): MemoryHit[] {
	const hits: MemoryHit[] = [];
	// `scope:file — Title ("Heading", rank -0.42)`: BM25 ranks are negative; older text said `section "Heading"`.
	const blockPattern = /^(global|project):(\S+) — (.+?) \((?:(?:section )?"([^"]*)"|intro), rank (-?[0-9.]+)\)\n?([\s\S]*)$/;
	for (const block of output.split("\n\n")) {
		const match = blockPattern.exec(block.trim());
		if (match === null) continue;
		hits.push({
			scope: match[1] === "global" ? "global" : "project",
			fileId: match[2] ?? "",
			title: match[3] ?? "",
			heading: match[4] === undefined ? null : match[4],
			rank: Number(match[5] ?? 0),
			parts: snippetParts(match[6] ?? "", query)
		});
	}
	return hits;
}

function parseSearch(part: ToolPart): MemorySearchCall {
	const args = argsOf(part);
	const details = detailsOf(part);
	const query = stringArg(args, "query") ?? "";
	const hits = searchHits(part.output ?? "", query);
	const matchCount = typeof details.hits === "number" ? details.hits : hits.length;
	const summary =
		"Searched memory for “" +
		query +
		"” · " +
		(matchCount === 0 ? "no matches" : matchCount + " " + plural(matchCount, "match", "matches"));
	return {
		kind: "search",
		summary,
		scope: scopeOf(args.scope, "both"),
		output: part.output ?? "",
		isError: part.isError === true,
		query,
		hits,
		matchCount
	};
}

function parseLink(line: string, scope: MemoryScope): MemoryMatch | undefined {
	const match = /^- (?:global:)?(\S+): (.*?) — (.*)$/.exec(line.trim());
	if (match === null) return undefined;
	return {
		scope: line.trim().startsWith("- global:") ? "global" : scope,
		fileId: match[1] ?? "",
		title: match[2] ?? "",
		heading: null,
		parts: snippetParts(match[3] ?? "")
	};
}

function parseRead(part: ToolPart): MemoryReadCall {
	const args = argsOf(part);
	const details = detailsOf(part);
	const fallbackScope: MemoryScope = args.scope === "global" ? "global" : "project";
	const lines = (part.output ?? "").split("\n");
	const first = /^(global|project):(\S+) — (.+)$/.exec(lines[0]?.trim() ?? "");
	const scope = scopeFromDetails(details, first?.[1] === "global" ? "global" : fallbackScope);
	const fileId = stringArg(args, "fileId") ?? (typeof details.fileId === "string" ? details.fileId : (first?.[2] ?? ""));
	let title: string | undefined = first?.[3];
	let summaryText: string | undefined;
	let status: string | undefined;
	let updated: string | undefined;
	let tags: string[] = [];
	const links: MemoryMatch[] = [];
	let index = first === null ? 0 : 1;
	for (; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line.startsWith("Summary: ")) summaryText = line.slice("Summary: ".length).trim();
		else if (line.startsWith("Tags: ")) {
			const [tagPart, statusPart] = line.slice("Tags: ".length).split("; status: ");
			tags =
				tagPart === "none" || tagPart === undefined
					? []
					: tagPart
							.split(",")
							.map((tag) => tag.trim())
							.filter((tag) => tag.length > 0);
			status = statusPart?.split(",")[0]?.trim();
		} else if (line.startsWith("Updated: ")) updated = line.slice("Updated: ".length).trim();
		else if (line.startsWith("Links:")) {
			for (index += 1; index < lines.length; index += 1) {
				const linkLine = lines[index] ?? "";
				if (!linkLine.startsWith("- ")) break;
				const link = parseLink(linkLine, scope);
				if (link !== undefined) links.push(link);
			}
			index -= 1;
		} else if (line.trim().length === 0) continue;
		else break;
	}
	const body = lines.slice(index).join("\n");
	const introLines: string[] = [];
	const sections: MemorySection[] = [];
	let current: MemorySection | undefined;
	for (const line of body.split("\n")) {
		if (line.startsWith("## ")) {
			current = { heading: line.slice(3).trim(), text: "" };
			sections.push(current);
		} else if (current !== undefined) {
			current.text += (current.text.length === 0 ? "" : "\n") + line;
		} else {
			introLines.push(line);
		}
	}
	for (const section of sections) section.text = section.text.trim();
	const intro = introLines.join("\n").trim();
	const summary = "Read " + (fileId || "memory") + (sections.length === 0 ? "" : " · " + sections.length + " " + plural(sections.length, "section"));
	return {
		kind: "read",
		summary,
		scope,
		output: part.output ?? "",
		isError: part.isError === true,
		fileId,
		...(title === undefined ? {} : { title }),
		...(summaryText === undefined ? {} : { summaryText }),
		tags,
		...(status === undefined ? {} : { status }),
		...(updated === undefined ? {} : { updated }),
		intro,
		sections,
		links
	};
}

function parseMatch(line: string): MemoryMatch | undefined {
	const match = /^- (global|project):(\S+) — (.+?)(?:, section "([^"]*)")?: ([\s\S]*)$/.exec(line.trim());
	if (match === null) return undefined;
	return {
		scope: match[1] === "global" ? "global" : "project",
		fileId: match[2] ?? "",
		title: match[3] ?? "",
		heading: match[4] === undefined ? null : match[4],
		parts: snippetParts(match[5] ?? "")
	};
}

function parseWrite(part: ToolPart): MemoryWriteCall {
	const args = argsOf(part);
	const details = detailsOf(part);
	const output = part.output ?? "";
	const fallbackScope: MemoryScope = args.scope === "global" ? "global" : "project";
	const scope = scopeFromDetails(details, fallbackScope);
	const fileId = stringArg(args, "fileId") ?? (typeof details.fileId === "string" ? details.fileId : "");
	const heading = stringArg(args, "heading");
	const text = stringArg(args, "text") ?? "";
	const closeMatches: MemoryMatch[] = [];
	for (const line of output.split("\n")) {
		if (!line.startsWith("- ")) continue;
		const match = parseMatch(line);
		if (match !== undefined) closeMatches.push(match);
	}
	let outcome: MemoryWriteOutcome;
	if (part.isError === true) outcome = "failed";
	else if (output.startsWith("Memory close to ")) outcome = "suggested";
	else if (details.created === true || output.startsWith("Created ")) outcome = "created";
	else if (output.includes("already reads that way")) outcome = "unchanged";
	else outcome = "updated";
	const target = fileId || "memory";
	const where = heading === undefined ? "" : " › " + heading;
	const summary =
		outcome === "created"
			? "Created " + target + where
			: outcome === "unchanged"
				? "No change to " + target + where
				: outcome === "suggested"
					? "Didn't create " +
						target +
						(closeMatches.length === 0 ? "" : " · " + closeMatches.length + " close " + plural(closeMatches.length, "match", "matches"))
					: "Saved to " + target + where;
	return {
		kind: "write",
		summary,
		scope,
		output,
		isError: part.isError === true,
		fileId,
		...(heading === undefined ? {} : { heading }),
		text,
		outcome,
		closeMatches
	};
}

function parseArchive(part: ToolPart): MemoryArchiveCall {
	const args = argsOf(part);
	const details = detailsOf(part);
	const fallbackScope: MemoryScope = args.scope === "global" ? "global" : "project";
	const scope = scopeFromDetails(details, fallbackScope);
	const fileId = stringArg(args, "fileId") ?? (typeof details.fileId === "string" ? details.fileId : "memory");
	const reason = stringArg(args, "reason");
	return {
		kind: "archive",
		summary: "Archived " + fileId + (reason === undefined ? "" : " — " + reason),
		scope,
		output: part.output ?? "",
		isError: part.isError === true,
		fileId,
		...(reason === undefined ? {} : { reason })
	};
}

/** What one memory tool call says, in the card's terms. */
export function memoryCallView(part: ToolPart): MemoryCallView {
	let view: MemoryCallView;
	if (part.name === "memory_search") view = parseSearch(part);
	else if (part.name === "memory_read") view = parseRead(part);
	else if (part.name === "memory_write") view = parseWrite(part);
	else view = parseArchive(part);
	if (part.isError === true) view.summary = TOOL_LABELS[view.kind] + " failed";
	return view;
}
