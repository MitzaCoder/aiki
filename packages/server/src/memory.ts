/**
 * Memory: durable facts in markdown topic files, one git repository and one FTS5 index per scope.
 *
 * Two scopes per backend, in its data directory: `global/memory/` (about the user) and
 * `projects/<project>/memory/` (about one project). The files are the source of truth: one markdown file per topic, `##`
 * sections, and front matter (`title`, `summary`, `tags`, `links`, `created`, `updated`, `source`, `status`). Every
 * write goes through here and is one git commit with a readable message, so history and undo come with git.
 *
 * The index is derived from the files: one FTS5 row per section (file title, summary, tags, heading, section text), BM25
 * ranked, rebuilt whenever the files change — including edits made by hand outside the harness. It also records when
 * and how often each file and section was retrieved, for the maintenance pass that comes later.
 *
 * Everything a path is built from is validated first: file IDs are model-written text, so they may only be a short name
 * (`^[a-z0-9][a-z0-9._-]*$`) resolved inside the scope's directory, never a path, and symlinks are refused. Git and
 * index writes are serialized per scope, so two writes cannot interleave their commits or rebuilds.
 */
import { createHash } from "node:crypto";
import {
	type FSWatcher,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { childEnvironment } from "./child-environment.ts";
import { DatabaseSync } from "node:sqlite";
import type {
	MemoryChange,
	MemoryChangeKind,
	MemoryFile,
	MemoryFileSummary,
	MemoryScope,
	MemorySearchHit,
	MemoryStatus,
} from "@kemiri/protocol";
import { ServerError, errorMessage } from "./errors.ts";
import { parseFrontmatter } from "./frontmatter.ts";

/** The directory name of a scope's memory files, under `global/` or `projects/<id>/`. */
export const MEMORY_DIR_NAME = "memory";
/** The index lives beside the memory repository, never inside it, so it is never a memory file and never a git change. */
export const MEMORY_INDEX_FILE = "memory-index.sqlite";
/** The global scope's directory under the data directory. */
export const GLOBAL_DIR_NAME = "global";
/** At most this many characters in a file ID: enough for a topic name, short enough to stay a name. */
export const MAX_FILE_ID_LENGTH = 64;
/** The git author every memory commit is made as; a memory repository needs no identity of its own. */
const GIT_AUTHOR = ["-c", "user.name=aiki", "-c", "user.email=memory@aiki.invalid"];
/** No hooks, no signing, no prompts: a memory commit is a mechanical write. */
const GIT_COMMIT_OPTIONS = [...GIT_AUTHOR, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];
/** How long a burst of filesystem events waits for the write that caused it to settle. */
export const MEMORY_WATCH_DEBOUNCE_MS = 150;
/** FTS5 markers around a snippet's matches, as the protocol promises. */
const SNIPPET_START = "\u0002";
const SNIPPET_END = "\u0003";

const FILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const LINK_PATTERN = /^(?:global:)?[a-z0-9][a-z0-9._-]*$/;

export type MemorySource = {
	projectId: string | null;
	conversationId: number | null;
	entryId: number | null;
};

export type MemorySection = { heading: string; text: string };

/** One topic file as this module understands it: front matter, intro text and `##` sections. */
export type MemoryTopic = {
	fileId: string;
	title: string;
	summary: string;
	tags: string[];
	links: string[];
	status: MemoryStatus;
	supersededBy: string | null;
	created: string;
	updated: string;
	source: MemorySource | null;
	/** The body as it is on disk, which `memory.read` returns unchanged. */
	body: string;
	intro: string;
	sections: MemorySection[];
};

export type MemoryTarget = { scope: "global" } | { scope: "project"; projectId: string };

export type MemoryWriteInput = {
	target: MemoryTarget;
	fileId: string;
	/** The section's markdown, or the file's intro text when there is no heading. */
	text: string;
	heading?: string;
	title?: string;
	summary?: string;
	tags?: string[];
	links?: string[];
	/** Create the topic even when close matches exist. Without it, close matches are returned instead. */
	create?: boolean;
	source?: MemorySource | null;
};

export type MemoryWriteOutcome = {
	kind: "created" | "updated" | "unchanged";
	topic: MemoryTopic;
	commit: string | null;
	/** What changed, in words a commit message can use: `the intro`, `section "X"`, or nothing. */
	detail?: string;
};

export type MemoryWriteResult = MemoryWriteOutcome | { kind: "suggest"; matches: MemorySearchHit[] };

export type MemoryScopeStats = {
	scope: MemoryScope;
	/** Active topics (archived ones are left out of the catalog). */
	files: number;
	archived: number;
	/** Active topics per tag, name ascending. */
	tags: Record<string, number>;
};

export type MemoryRetrieval = {
	fileId: string;
	heading: string | null;
	hits: number;
	lastAt: string;
};

// --- file IDs and paths -------------------------------------------------------------------------------------------

export function isMemoryFileId(value: string): boolean {
	return (
		value.length >= 1 &&
		value.length <= MAX_FILE_ID_LENGTH &&
		FILE_ID_PATTERN.test(value) &&
		value !== "." &&
		value !== ".." &&
		!value.endsWith(".md")
	);
}

function isProjectId(value: string): boolean {
	return PROJECT_ID_PATTERN.test(value);
}

/** The file a topic's ID means, or `unknown_memory`: a model-written ID never becomes a path. */
export function memoryFilePath(dir: string, fileId: string): string {
	if (!isMemoryFileId(fileId)) {
		throw new ServerError("unknown_memory", `Unknown memory "${fileId}"`, { fileId });
	}
	const path = join(dir, `${fileId}.md`);
	// Defense in depth: the pattern already excludes separators, and the join must not leave the scope.
	if (dirname(path) !== dir) {
		throw new ServerError("unknown_memory", `Unknown memory "${fileId}"`, { fileId });
	}
	return path;
}

function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

// --- front matter -------------------------------------------------------------------------------------------------

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) return trimmed.slice(1, -1);
	return trimmed;
}

/** A one-line front matter value: no newlines, and empty as `""`. */
function frontMatterValue(value: string): string {
	const line = value.replace(/\s+/g, " ").trim();
	return line.length === 0 ? '""' : line;
}

function parseTags(value: string | undefined): string[] {
	if (value === undefined) return [];
	const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
	return inner
		.split(",")
		.map((part) => unquote(part.trim()))
		.filter((part) => part.length > 0);
}

function parseSource(value: string | undefined): MemorySource | null {
	if (value === undefined || value.trim().length === 0) return null;
	try {
		const parsed = JSON.parse(value) as Partial<MemorySource>;
		if (typeof parsed !== "object" || parsed === null) return null;
		const numberOrNull = (input: unknown): number | null =>
			typeof input === "number" && Number.isInteger(input) && input > 0 ? input : null;
		return {
			projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
			conversationId: numberOrNull(parsed.conversationId),
			entryId: numberOrNull(parsed.entryId),
		};
	} catch {
		return null;
	}
}

export function serializeSource(source: MemorySource | null): string {
	if (source === null) return "none";
	return JSON.stringify({
		projectId: source.projectId,
		conversationId: source.conversationId,
		entryId: source.entryId,
	});
}

function parseStatus(value: string | undefined): MemoryStatus {
	return value === "archived" || value === "superseded" ? value : "active";
}

/** The `##` sections of a body, and the text before the first one. Headings inside a fenced code block do not count. */
export function splitSections(body: string): { intro: string; sections: MemorySection[] } {
	const lines = body.replace(/\r\n?/g, "\n").split("\n");
	const introLines: string[] = [];
	const sections: MemorySection[] = [];
	let fence: string | null = null;
	let heading: string | null = null;
	let current: string[] = [];

	for (const line of lines) {
		const trimmed = line.trimStart();
		const marker = trimmed.startsWith("```") ? "```" : trimmed.startsWith("~~~") ? "~~~" : null;
		if (marker !== null) {
			if (fence === null) fence = marker;
			else if (fence === marker) fence = null;
		}
		const match = fence === null ? /^##[ \t]+(.+?)[ \t]*$/.exec(line) : null;
		if (match !== null) {
			if (heading !== null) sections.push({ heading, text: current.join("\n").trim() });
			heading = match[1]!;
			current = [];
			continue;
		}
		if (heading === null) introLines.push(line);
		else current.push(line);
	}
	if (heading !== null) sections.push({ heading, text: current.join("\n").trim() });
	return { intro: introLines.join("\n").trim(), sections };
}

/** The intro plus every section as markdown, normalized: what `renderTopic` writes after the front matter. */
export function renderBody(intro: string, sections: readonly MemorySection[]): string {
	const parts: string[] = [];
	if (intro.trim().length > 0) parts.push(intro.trim());
	for (const section of sections) parts.push(`## ${section.heading}\n\n${section.text.trim()}`);
	return parts.join("\n\n");
}

function humanizeFileId(fileId: string): string {
	const words = fileId.replace(/[._-]+/g, " ").trim();
	return words.length === 0 ? fileId : words.charAt(0).toUpperCase() + words.slice(1);
}

function firstLine(text: string): string {
	const line = text
		.split("\n")
		.map((part) => part.replace(/^#+\s*/, "").trim())
		.find((part) => part.length > 0);
	return (line ?? "").slice(0, 200);
}

/** One topic file's text as a topic. A file without front matter still reads, from its name and first line. */
export function parseMemoryFile(fileId: string, text: string, mtime: string): MemoryTopic {
	const { frontmatter, body } = parseFrontmatter(text);
	const { intro, sections } = splitSections(body);
	const fallbackSummary = intro.length > 0 ? firstLine(intro) : firstLine(sections[0]?.text ?? "");
	const created = frontmatter["created"]?.trim();
	const updated = frontmatter["updated"]?.trim();
	return {
		fileId,
		title: unquote(frontmatter["title"] ?? "").trim() || humanizeFileId(fileId),
		summary: frontmatter["summary"]?.trim() || fallbackSummary,
		tags: parseTags(frontmatter["tags"]),
		links: parseTags(frontmatter["links"]),
		status: parseStatus(frontmatter["status"]),
		supersededBy: frontmatter["supersededBy"]?.trim() || null,
		created: created !== undefined && created.length > 0 ? created : mtime,
		updated: updated !== undefined && updated.length > 0 ? updated : mtime,
		source: parseSource(frontmatter["source"]),
		body,
		intro,
		sections,
	};
}

/** The whole file, front matter first. Every write rewrites it, so formatting stays one way. */
export function renderTopic(topic: MemoryTopic): string {
	const lines = [
		"---",
		`title: ${frontMatterValue(topic.title)}`,
		`summary: ${frontMatterValue(topic.summary)}`,
		`tags: [${topic.tags.join(", ")}]`,
		`links: [${topic.links.join(", ")}]`,
		`created: ${topic.created}`,
		`updated: ${topic.updated}`,
		`source: ${serializeSource(topic.source)}`,
		`status: ${topic.status}`,
		...(topic.supersededBy === null ? [] : [`supersededBy: ${topic.supersededBy}`]),
		"---",
		"",
	];
	return `${lines.join("\n")}${renderBody(topic.intro, topic.sections)}\n`;
}

export function topicSummary(topic: MemoryTopic, scope: MemoryScope): MemoryFileSummary {
	return {
		scope,
		fileId: topic.fileId,
		title: topic.title,
		summary: topic.summary,
		tags: [...topic.tags],
		links: [...topic.links],
		status: topic.status,
		supersededBy: topic.supersededBy,
		headings: topic.sections.map((section) => section.heading),
		created: topic.created,
		updated: topic.updated,
		source: topic.source,
	};
}

// --- writing rules ------------------------------------------------------------------------------------------------

function validateText(text: string): string {
	if (text.trim().length === 0) throw new ServerError("bad_request", "A memory write needs some text");
	return text.replace(/\r\n?/g, "\n").trim();
}

function validateHeading(heading: string | undefined): string | undefined {
	if (heading === undefined) return undefined;
	const trimmed = heading.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.includes("\n")) throw new ServerError("bad_request", "A section heading is one line");
	return trimmed;
}

function validateTags(tags: readonly string[] | undefined): string[] | undefined {
	if (tags === undefined) return undefined;
	const cleaned = tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
	for (const tag of cleaned) {
		if (tag.length > 40 || tag.includes(",") || tag.includes("[") || tag.includes("]") || tag.includes("\n")) {
			throw new ServerError("bad_request", `Not a usable memory tag: "${tag}"`);
		}
	}
	return [...new Set(cleaned)];
}

function validateLinks(links: readonly string[] | undefined): string[] | undefined {
	if (links === undefined) return undefined;
	const cleaned = links.map((link) => link.trim()).filter((link) => link.length > 0);
	for (const link of cleaned) {
		const target = link.startsWith("global:") ? link.slice("global:".length) : link;
		if (!LINK_PATTERN.test(link) || !isMemoryFileId(target)) {
			throw new ServerError("bad_request", `Not a usable memory link: "${link}"`);
		}
	}
	return [...new Set(cleaned)];
}

function validateTitle(title: string | undefined): string | undefined {
	if (title === undefined) return undefined;
	const trimmed = title.replace(/\s+/g, " ").trim();
	if (trimmed.length === 0) throw new ServerError("bad_request", "A memory title must not be empty");
	return trimmed.slice(0, 120);
}

function validateSummary(summary: string | undefined): string | undefined {
	if (summary === undefined) return undefined;
	const trimmed = summary.replace(/\s+/g, " ").trim();
	if (trimmed.length === 0) throw new ServerError("bad_request", "A memory summary must not be empty");
	return trimmed.slice(0, 300);
}

/** Words FTS5 can search; everything else in a model's query is punctuation it did not mean. */
export function searchTerms(query: string): string[] {
	return [...query.matchAll(/[\p{L}\p{N}_]+/gu)]
		.map((match) => match[0].toLowerCase())
		.filter((term) => term.length > 0)
		.slice(0, 32);
}

/** An FTS5 query that ORs the words, prefix-matching each, so a phrasing with extra words still finds the topic. */
function ftsQuery(query: string): string | undefined {
	const terms = searchTerms(query);
	if (terms.length === 0) return undefined;
	return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(" OR ");
}

// --- git ----------------------------------------------------------------------------------------------------------

type GitResult = { code: number; stdout: string; stderr: string };

async function git(dir: string, args: readonly string[]): Promise<GitResult> {
	const proc = Bun.spawn(["git", "-C", dir, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...childEnvironment(), GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" },
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

/** The commit a scope gets for edits made by hand, before a tool write commits its own change. */
export const HAND_EDITS_COMMIT_MESSAGE = "memory: edits made by hand";

/** Trailer keys: what a commit says about itself, so history and undo need no side table. */
export const COMMIT_KIND_TRAILER = "Memory-Kind";
export const COMMIT_SOURCE_TRAILER = "Memory-Source";
export const COMMIT_UNDO_OF_TRAILER = "Memory-Undo-Of";

export type MemoryCommitTrailers = {
	kind: MemoryChangeKind;
	/** Where the write came from; omitted for a change that has no conversation behind it. */
	source?: MemorySource | null;
	/** For `undo`: the commit this one reverts. */
	undoOf?: string;
};

/** A commit message: a subject, an optional readable body, then the trailer block git keeps at the end. */
export function renderCommitMessage(subject: string, body: string | null, trailers: MemoryCommitTrailers): string {
	const lines = [subject];
	if (body !== null && body.trim().length > 0) lines.push("", body.trim());
	lines.push("", `${COMMIT_KIND_TRAILER}: ${trailers.kind}`);
	if (trailers.source !== undefined && trailers.source !== null) {
		lines.push(`${COMMIT_SOURCE_TRAILER}: ${serializeSource(trailers.source)}`);
	}
	if (trailers.undoOf !== undefined) lines.push(`${COMMIT_UNDO_OF_TRAILER}: ${trailers.undoOf}`);
	return lines.join("\n");
}

/** A commit's subject and body without its trailer block: what a reader (and the app) sees. */
export function commitMessageText(subject: string, body: string): string {
	const text = body.trim();
	return text.length === 0 ? subject : `${subject}\n\n${text}`;
}

const TRAILER_LINE = new RegExp(`^(?:${COMMIT_KIND_TRAILER}|${COMMIT_SOURCE_TRAILER}|${COMMIT_UNDO_OF_TRAILER}): .*$`);

/** Drop the trailer block, which `git log %b` includes with the body. */
function stripTrailers(body: string): string {
	const lines = body.replace(/\r\n?/g, "\n").split("\n");
	while (lines.length > 0) {
		const last = lines[lines.length - 1]!;
		if (last.trim().length !== 0 && !TRAILER_LINE.test(last)) break;
		lines.pop();
	}
	return lines.join("\n").trim();
}

/**
 * `git log --name-only` with the fields this module reads, one record per commit: the header separated by unit
 * separators and terminated by a record separator, then the file names it touched. The body comes last in the header,
 * so the file names are a field of their own and a `.md` line inside a message cannot be mistaken for one.
 */
export const MEMORY_LOG_FORMAT = [
	"%x1e%H",
	"%aI",
	"%s",
	`%(trailers:key=${COMMIT_KIND_TRAILER},valueonly)`,
	`%(trailers:key=${COMMIT_SOURCE_TRAILER},valueonly)`,
	`%(trailers:key=${COMMIT_UNDO_OF_TRAILER},valueonly)`,
	"%b",
].join("%x1f") + "%x1f";

const CHANGE_KINDS: readonly string[] = ["tool", "hand", "extraction", "maintenance", "undo"];

/** The ` — reason` an archive commit's subject carries, when there is a reason. */
function archiveReasonSuffix(reason: string | undefined): string {
	const cleaned = reason?.replace(/\s+/g, " ").trim() ?? "";
	return cleaned.length === 0 ? "" : ` — ${cleaned}`;
}

/**
 * One scope's history, newest first, with each commit's kind and source read back from its trailers, and `undoneBy`
 * filled from the `undo` commits that name an earlier one.
 */
export function parseHistory(stdout: string, limit: number): MemoryChange[] {
	const records: MemoryChange[] = [];
	/** undo commit → the commit it reverted. */
	const undos = new Map<string, string>();
	for (const chunk of stdout.split("\x1e")) {
		if (chunk.trim().length === 0) continue;
		const fields = chunk.split("\x1f");
		const commit = fields[0]?.trim() ?? "";
		if (!/^[0-9a-f]{40}$/.test(commit)) continue;
		const at = fields[1]?.trim() ?? "";
		const subject = fields[2] ?? "";
		const kindText = fields[3]?.trim() ?? "";
		const source = parseSource(fields[4]?.trim());
		const undoOf = fields[5]?.trim() ?? "";
		const body = stripTrailers(fields[6] ?? "");
		const files = (fields[7] ?? "")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.endsWith(".md"))
			.map((line) => line.slice(0, -".md".length))
			.filter((fileId) => isMemoryFileId(fileId))
			.filter((fileId, index, all) => all.indexOf(fileId) === index);
		if (kindText === "undo" && undoOf.length > 0) undos.set(commit, undoOf);
		records.push({
			commit,
			message: commitMessageText(subject, body),
			at,
			files,
			...(CHANGE_KINDS.includes(kindText) ? { kind: kindText as MemoryChangeKind } : {}),
			...(source === null ? {} : { source }),
		});
	}
	const undoneBy = new Map<string, string>();
	for (const [undoCommit, target] of undos) undoneBy.set(target, undoCommit);
	return records.slice(0, limit).map((change) => {
		const by = undoneBy.get(change.commit) ?? null;
		if (change.kind === undefined) return change;
		return {
			...change,
			undoable:
				change.kind === "extraction" || change.kind === "maintenance" ? by === null : false,
			...(by === null ? {} : { undoneBy: by }),
		};
	});
}

// --- the scope ----------------------------------------------------------------------------------------------------

type SearchOptions = {
	query: string;
	tags?: readonly string[];
	includeArchived?: boolean;
	limit: number;
};

type ListOptions = { includeArchived?: boolean };

// --- applying writes in memory -------------------------------------------------------------------------------------

/** Finds topics close to a proposed new one, so a writer updates an existing topic instead of duplicating it. */
export type CloseMatchFinder = (input: MemoryWriteInput, text: string) => MemorySearchHit[];

/** A write's outcome before anything is committed: `commit` is filled in by the caller that writes the file(s). */
export type MemoryApplyResult = MemoryWriteOutcome | { kind: "suggest"; matches: MemorySearchHit[] };

/**
 * Apply one write to a topic map. The live write path uses it and then commits the one file; a batch uses it over its own
 * copy and commits every changed file once. Nothing here touches the disk, the index or git.
 */
export function applyWriteToTopics(
	topics: Map<string, MemoryTopic>,
	input: MemoryWriteInput,
	now: string,
	findClose: CloseMatchFinder,
): MemoryApplyResult {
	const text = validateText(input.text);
	const heading = validateHeading(input.heading);
	const tags = validateTags(input.tags);
	const links = validateLinks(input.links);
	const title = validateTitle(input.title);
	const summary = validateSummary(input.summary);
	const existing = topics.get(input.fileId);

	if (existing === undefined) {
		// Before a new topic exists, close matches are the answer: the writer updates an existing topic instead.
		if (input.create !== true) {
			const matches = findClose(input, text);
			if (matches.length > 0) return { kind: "suggest", matches };
		}
		const sections: MemorySection[] = heading === undefined ? [] : [{ heading, text }];
		const topic: MemoryTopic = {
			fileId: input.fileId,
			title: title ?? heading ?? humanizeFileId(input.fileId),
			summary: summary ?? firstLine(text),
			tags: tags ?? [],
			links: links ?? [],
			status: "active",
			supersededBy: null,
			created: now,
			updated: now,
			source: input.source ?? null,
			body: "",
			intro: heading === undefined ? text : "",
			sections,
		};
		topics.set(topic.fileId, topic);
		return { kind: "created", topic, commit: null, detail: "create" };
	}

	const next: MemoryTopic = {
		...existing,
		title: title ?? existing.title,
		summary: summary ?? existing.summary,
		tags: tags ?? existing.tags,
		links: links ?? existing.links,
		updated: now,
		source: input.source ?? existing.source,
		intro: existing.intro,
		sections: [...existing.sections],
	};
	let detail: string;
	if (heading === undefined) {
		next.intro = text;
		detail = "the intro";
	} else {
		const index = next.sections.findIndex((section) => section.heading === heading);
		if (index === -1) next.sections.push({ heading, text });
		else next.sections[index] = { heading, text };
		detail = `section "${heading}"`;
	}
	if (renderTopic(existing) === renderTopic(next)) {
		return { kind: "unchanged", topic: existing, commit: null };
	}
	topics.set(next.fileId, next);
	return { kind: "updated", topic: next, commit: null, detail };
}

/** Apply one archive to a topic map, with the same rules the live path uses. */
export function applyArchiveToTopics(
	topics: Map<string, MemoryTopic>,
	fileId: string,
	scope: MemoryScope,
	options: { source?: MemorySource | null; reason?: string },
	now: string,
): MemoryWriteOutcome {
	const topic = topics.get(fileId);
	if (topic === undefined) {
		throw new ServerError("unknown_memory", `No memory "${fileId}" in the ${scope} scope`, { fileId });
	}
	if (topic.status === "archived") return { kind: "unchanged", topic, commit: null };
	const next: MemoryTopic = {
		...topic,
		status: "archived",
		updated: now,
		source: options.source ?? topic.source,
	};
	topics.set(fileId, next);
	const reason = options.reason?.replace(/\s+/g, " ").trim() ?? "";
	return {
		kind: "updated",
		topic: next,
		commit: null,
		detail: reason.length === 0 ? undefined : reason,
	};
}

/**
 * Search a topic map without the index: the same OR-of-prefixes rule the FTS query follows, as a linear scan. A batch
 * searches its uncommitted topics with it, so a writer sees what it has already written in the same run.
 */
export function searchTopics(
	topics: Iterable<MemoryTopic>,
	scope: MemoryScope,
	options: { query: string; tags?: readonly string[]; includeArchived?: boolean; limit: number },
): MemorySearchHit[] {
	const terms = searchTerms(options.query);
	if (terms.length === 0) return [];
	const tags = (options.tags ?? []).map((tag) => tag.toLowerCase()).filter((tag) => tag.length > 0);
	const hits: (MemorySearchHit & { score: number })[] = [];
	for (const topic of topics) {
		if (topic.status === "archived" && options.includeArchived !== true) continue;
		if (tags.length > 0) {
			const own = new Set(topic.tags.map((tag) => tag.toLowerCase()));
			if (!tags.every((tag) => own.has(tag))) continue;
		}
		const candidates: { heading: string | null; text: string }[] = [
			{ heading: null, text: topic.intro },
			...topic.sections.map((part) => ({ heading: part.heading, text: part.text })),
		];
		const header = [topic.title, topic.summary, topic.tags.join(" ")].join(" ").toLowerCase();
		for (const candidate of candidates) {
			const haystack = `${header}\n${candidate.heading ?? ""}\n${candidate.text}`.toLowerCase();
			const matched = terms.filter((term) => haystack.includes(term));
			if (matched.length === 0) continue;
			const body = candidate.heading === null ? topic.intro : candidate.text;
			const flat = `${
				candidate.heading === null ? "" : `${candidate.heading}: `
			}${body}`.replace(/\s+/g, " ").trim();
			const at = Math.max(0, flat.toLowerCase().indexOf(matched[0]!));
			const start = Math.max(0, at - 60);
			hits.push({
				scope,
				fileId: topic.fileId,
				title: topic.title,
				heading: candidate.heading,
				snippet: `${start > 0 ? "…" : ""}${flat.slice(start, start + 200)}${start + 200 < flat.length ? "…" : ""}`,
				rank: 1 - matched.length / terms.length,
				score: matched.length,
			});
		}
	}
	return hits
		.sort((left, right) => right.score - left.score || left.fileId.localeCompare(right.fileId))
		.slice(0, options.limit)
		.map(({ score: _score, ...hit }) => hit);
}

/** What one batch operation did, in words its commit message can list. */
export type MemoryBatchChange = {
	action: "create" | "update" | "archive";
	fileId: string;
	/** `create`, `the intro`, `section "X"`, or an archive's reason. */
	detail?: string;
};

/** One staged change of a batch: applied in order, on fresh topics, when the batch commits. */
export type MemoryBatchOperation =
	| { type: "write"; input: MemoryWriteInput }
	| { type: "archive"; fileId: string; reason?: string; source?: MemorySource | null };

export type MemoryBatchResult = {
	commit: string | null;
	files: string[];
	changes: MemoryBatchChange[];
};

export type MemoryScopeOptions = {
	scope: MemoryScope;
	projectId: string | null;
	/** Where the topic files live; the git repository and the source of truth. */
	dir: string;
	/** Where the derived FTS5 index lives, outside `dir`. */
	indexFile: string;
	log?: (message: string) => void;
	/** Called after a write, and after a hand edit was indexed, so clients can read again. */
	onChange?: () => void;
};

/**
 * One memory scope: its files, its git history, its FTS5 index and its retrieval counts. All work is serialized through
 * one queue, so a commit and the index rebuild that follows it cannot interleave with another write or a watch refresh.
 */
export class MemoryScopeStore {
	readonly scope: MemoryScope;
	readonly projectId: string | null;
	readonly dir: string;
	readonly indexFile: string;

	readonly #log: (message: string) => void;
	readonly #onChange: (() => void) | undefined;
	#queue: Promise<unknown> = Promise.resolve();
	#db: DatabaseSync | undefined;
	#topics = new Map<string, MemoryTopic>();
	#signature: string | undefined;
	#ensured = false;
	#watcher: FSWatcher | undefined;
	#watchTimer: ReturnType<typeof setTimeout> | undefined;
	#closed = false;

	constructor(options: MemoryScopeOptions) {
		this.scope = options.scope;
		this.projectId = options.projectId;
		this.dir = options.dir;
		this.indexFile = options.indexFile;
		this.#log = options.log ?? (() => undefined);
		this.#onChange = options.onChange;
	}

	#run<T>(work: () => Promise<T> | T): Promise<T> {
		const run = this.#queue.then(work, work);
		this.#queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/** Every public operation ensures the directory, the repository and the index before it touches them. */
	#runReady<T>(work: () => Promise<T> | T): Promise<T> {
		return this.#run(async () => {
			if (this.#closed) throw new ServerError("internal", "This memory scope is closed");
			await this.#ensureNow();
			return work();
		});
	}

	/** Create the directory and its repository, open the index and start watching for hand edits. Idempotent. */
	async ensure(): Promise<void> {
		return this.#run(() => this.#ensureNow());
	}

	async #ensureNow(): Promise<void> {
		if (this.#closed) throw new ServerError("internal", "This memory scope is closed");
		if (this.#ensured) return;
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		mkdirSync(dirname(this.indexFile), { recursive: true, mode: 0o700 });
		await this.#ensureRepository();
		this.#openIndex();
		this.#refresh();
		this.#ensured = true;
		this.#startWatch();
	}

	async close(): Promise<void> {
		this.#closed = true;
		if (this.#watchTimer !== undefined) clearTimeout(this.#watchTimer);
		this.#watchTimer = undefined;
		this.#watcher?.close();
		this.#watcher = undefined;
		await this.#run(() => {
			this.#db?.close();
			this.#db = undefined;
		}).catch(() => undefined);
	}

	// --- files and index ---------------------------------------------------------------------------------------

	async #ensureRepository(): Promise<void> {
		if (existsSync(join(this.dir, ".git"))) return;
		const result = await git(this.dir, ["init", "-q", "-b", "main"]);
		if (result.code !== 0) {
			// Memory must still work without git; only the history and undo are lost, and that is worth a log line.
			this.#log(`memory: git init in ${this.dir} failed: ${result.stderr.trim() || result.code}`);
		}
	}

	#openIndex(): void {
		if (this.#db !== undefined) return;
		const db = new DatabaseSync(this.indexFile);
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA busy_timeout = 5000");
		db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS sections USING fts5(
				file_id UNINDEXED,
				title,
				summary,
				tags,
				heading,
				body,
				tokenize = 'unicode61'
			);
			CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS retrieval (
				file_id TEXT NOT NULL,
				heading TEXT NOT NULL,
				hits INTEGER NOT NULL,
				last_at TEXT NOT NULL,
				PRIMARY KEY (file_id, heading)
			);
		`);
		this.#db = db;
	}

	#database(): DatabaseSync {
		this.#openIndex();
		const db = this.#db;
		if (db === undefined) throw new Error("memory index is not open");
		return db;
	}

	/** Read the files, and rebuild the index when any of them changed since the last look. */
	#refresh(): void {
		const topics = new Map<string, MemoryTopic>();
		const hash = createHash("sha256");
		let names: string[];
		try {
			names = readdirSync(this.dir)
				.filter((name) => name.endsWith(".md") && !name.startsWith("."))
				.sort();
		} catch (error) {
			this.#log(`memory: cannot read ${this.dir}: ${errorMessage(error)}`);
			names = [];
		}
		for (const name of names) {
			const fileId = name.slice(0, -".md".length);
			if (!isMemoryFileId(fileId)) continue;
			const path = join(this.dir, name);
			if (isSymlink(path)) continue;
			let text: string;
			let mtime: string;
			try {
				text = readFileSync(path, "utf8");
				mtime = statSync(path).mtime.toISOString();
			} catch {
				continue;
			}
			hash.update(name);
			hash.update("\0");
			hash.update(text);
			hash.update("\0");
			topics.set(fileId, parseMemoryFile(fileId, text, mtime));
		}
		const signature = hash.digest("hex");
		if (signature === this.#signature) return;
		this.#topics = topics;
		this.#signature = signature;
		this.#rebuild(topics);
	}

	#rebuild(topics: ReadonlyMap<string, MemoryTopic>): void {
		const db = this.#database();
		const insert = db.prepare(
			"INSERT INTO sections(file_id, title, summary, tags, heading, body) VALUES (?, ?, ?, ?, ?, ?)",
		);
		db.exec("BEGIN");
		try {
			db.exec("DELETE FROM sections");
			for (const topic of topics.values()) {
				const shared = [topic.fileId, topic.title, topic.summary, topic.tags.join(" ")] as const;
				insert.run(...shared, "", topic.intro);
				for (const section of topic.sections) insert.run(...shared, section.heading, section.text);
			}
			// A file that is gone loses its retrieval counters too; a file that stayed keeps them.
			const placeholders = [...topics.keys()].map(() => "?").join(", ");
			if (topics.size === 0) db.exec("DELETE FROM retrieval");
			else db.prepare(`DELETE FROM retrieval WHERE file_id NOT IN (${placeholders})`).run(...topics.keys());
			db.prepare("INSERT INTO meta(key, value) VALUES ('signature', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
				this.#signature ?? "",
			);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}

	#startWatch(): void {
		if (this.#closed || this.#watcher !== undefined) return;
		try {
			this.#watcher = watch(this.dir, { persistent: false }, (_event, filename) => {
				// The index lives outside the directory, so only topic files can arrive here.
				if (filename !== null && typeof filename === "string" && filename.length > 0) {
					if (!filename.endsWith(".md")) return;
				}
				if (this.#watchTimer !== undefined) clearTimeout(this.#watchTimer);
				this.#watchTimer = setTimeout(() => {
					this.#watchTimer = undefined;
					if (this.#closed) return;
					void this.#run(async () => {
						this.#refresh();
						this.#emit();
					}).catch((error: unknown) => {
						this.#log(`memory: indexing ${this.dir} after an external edit failed: ${errorMessage(error)}`);
					});
				}, MEMORY_WATCH_DEBOUNCE_MS);
				this.#watchTimer.unref?.();
			});
			this.#watcher.on("error", (error) => {
				this.#log(`memory: watching ${this.dir} failed: ${errorMessage(error)}`);
				this.#watcher?.close();
				this.#watcher = undefined;
			});
		} catch (error) {
			this.#log(`memory: cannot watch ${this.dir}: ${errorMessage(error)}`);
		}
	}

	#emit(): void {
		if (this.#onChange === undefined) return;
		try {
			this.#onChange();
		} catch (error) {
			this.#log(`memory: change listener failed: ${errorMessage(error)}`);
		}
	}

	#recordRetrieval(entries: readonly { fileId: string; heading: string | null }[], at: string): void {
		if (entries.length === 0) return;
		const db = this.#database();
		const statement = db.prepare(
			`INSERT INTO retrieval(file_id, heading, hits, last_at) VALUES (?, ?, 1, ?)
			 ON CONFLICT(file_id, heading) DO UPDATE SET hits = hits + 1, last_at = excluded.last_at`,
		);
		for (const entry of entries) statement.run(entry.fileId, entry.heading ?? "", at);
	}

	// --- queries -----------------------------------------------------------------------------------------------

	/** Search the section index, best first. Archived topics only when asked for. */
	async search(options: SearchOptions): Promise<MemorySearchHit[]> {
		return this.#runReady(() => this.#searchNow(options));
	}

	#searchNow(options: SearchOptions): MemorySearchHit[] {
		this.#refresh();
		const query = ftsQuery(options.query);
		if (query === undefined) return [];
		const db = this.#database();
		// Tag filtering happens after the match, so ask for more rows than the caller wants.
		const candidateLimit = Math.max(options.limit * 5, 40);
		const rows = db
			.prepare(
				`SELECT file_id, title, heading, rank, snippet(sections, -1, ?, ?, '…', 16) AS snippet
				 FROM sections WHERE sections MATCH ? ORDER BY rank LIMIT ?`,
			)
			.all(SNIPPET_START, SNIPPET_END, query, candidateLimit) as {
			file_id: string;
			title: string;
			heading: string;
			rank: number;
			snippet: string;
		}[];
		const tags = (options.tags ?? []).map((tag) => tag.toLowerCase()).filter((tag) => tag.length > 0);
		const hits: MemorySearchHit[] = [];
		const retrieved: { fileId: string; heading: string | null }[] = [];
		for (const row of rows) {
			const topic = this.#topics.get(row.file_id);
			if (topic === undefined) continue;
			if (topic.status === "archived" && options.includeArchived !== true) continue;
			if (tags.length > 0) {
				const own = new Set(topic.tags.map((tag) => tag.toLowerCase()));
				if (!tags.every((tag) => own.has(tag))) continue;
			}
			const heading = row.heading.length === 0 ? null : row.heading;
			hits.push({
				scope: this.scope,
				fileId: topic.fileId,
				title: topic.title,
				heading,
				snippet: row.snippet,
				rank: row.rank,
			});
			retrieved.push({ fileId: topic.fileId, heading });
			if (hits.length >= options.limit) break;
		}
		this.#recordRetrieval(retrieved, new Date().toISOString());
		return hits;
	}

	async list(options: ListOptions = {}): Promise<MemoryFileSummary[]> {
		return this.#runReady(() => this.#listNow(options));
	}

	#listNow(options: ListOptions): MemoryFileSummary[] {
		this.#refresh();
		return [...this.#topics.values()]
			.filter((topic) => options.includeArchived === true || topic.status !== "archived")
			.sort((left, right) => right.updated.localeCompare(left.updated) || left.fileId.localeCompare(right.fileId))
			.map((topic) => topicSummary(topic, this.scope));
	}

	async read(fileId: string): Promise<MemoryFile> {
		return this.#runReady(() => {
			memoryFilePath(this.dir, fileId);
			this.#refresh();
			const topic = this.#topics.get(fileId);
			if (topic === undefined) {
				throw new ServerError("unknown_memory", `No memory "${fileId}" in the ${this.scope} scope`, { fileId });
			}
			this.#recordRetrieval(
				[{ fileId, heading: null }, ...topic.sections.map((section) => ({ fileId, heading: section.heading }))],
				new Date().toISOString(),
			);
			return { file: topicSummary(topic, this.scope), body: topic.body };
		});
	}

	async history(limit: number): Promise<MemoryChange[]> {
		return this.#runReady(() => this.#historyNow(limit));
	}

	async #historyNow(limit: number): Promise<MemoryChange[]> {
		const result = await git(this.dir, [
			"log",
			"-n",
			String(limit),
			"--name-only",
			`--format=${MEMORY_LOG_FORMAT}`,
		]);
		if (result.code !== 0) {
			// An empty repository has no commits yet; that is a history of zero, not an error.
			if (/does not have any commits|unknown revision|bad default revision|ambiguous argument/i.test(result.stderr)) {
				return [];
			}
			throw new ServerError("internal", `Could not read the memory history: ${result.stderr.trim()}`);
		}
		return parseHistory(result.stdout, limit);
	}

	/** The commit `HEAD` names, or null before the first one. */
	async head(): Promise<string | null> {
		return this.#runReady(async () => {
			const result = await git(this.dir, ["rev-parse", "HEAD"]);
			return result.code === 0 ? result.stdout.trim() : null;
		});
	}

	/** How many commits were made after `since` (the scope's whole history when it is null). */
	async commitsSince(since: string | null): Promise<number> {
		return this.#runReady(async () => {
			const result = await git(
				this.dir,
				since === null ? ["rev-list", "--count", "HEAD"] : ["rev-list", "--count", `${since}..HEAD`],
			);
			if (result.code !== 0) return 0;
			const count = Number(result.stdout.trim());
			return Number.isFinite(count) ? count : 0;
		});
	}

	/** The topics as they are now, for a batch to start from. */
	async snapshot(): Promise<MemoryTopic[]> {
		return this.#runReady(() => {
			this.#refresh();
			return [...this.#topics.values()].map((topic) => ({ ...topic, sections: [...topic.sections] }));
		});
	}

	async stats(): Promise<MemoryScopeStats> {
		return this.#runReady(() => this.#statsNow());
	}

	#statsNow(): MemoryScopeStats {
		this.#refresh();
		const tags = new Map<string, number>();
		let files = 0;
		let archived = 0;
		for (const topic of this.#topics.values()) {
			if (topic.status === "archived") {
				archived += 1;
				continue;
			}
			files += 1;
			for (const tag of new Set(topic.tags)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
		}
		return {
			scope: this.scope,
			files,
			archived,
			tags: Object.fromEntries([...tags.entries()].sort(([left], [right]) => left.localeCompare(right))),
		};
	}

	/** How often each file and section was retrieved: the input the maintenance pass will work from. */
	async retrievals(): Promise<MemoryRetrieval[]> {
		return this.#runReady(() => {
			const rows = this.#database()
				.prepare("SELECT file_id, heading, hits, last_at FROM retrieval ORDER BY hits DESC, file_id, heading")
				.all() as { file_id: string; heading: string; hits: number; last_at: string }[];
			return rows.map((row) => ({
				fileId: row.file_id,
				heading: row.heading.length === 0 ? null : row.heading,
				hits: row.hits,
				lastAt: row.last_at,
			}));
		});
	}

	// --- writes ------------------------------------------------------------------------------------------------

	async write(input: MemoryWriteInput): Promise<MemoryWriteResult> {
		return this.#runReady(() => this.#writeNow(input));
	}

	async archive(
		fileId: string,
		options: { source?: MemorySource | null; reason?: string } = {},
	): Promise<MemoryWriteOutcome> {
		return this.#runReady(async () => {
			memoryFilePath(this.dir, fileId);
			this.#refresh();
			const topic = this.#topics.get(fileId);
			if (topic === undefined) {
				throw new ServerError("unknown_memory", `No memory "${fileId}" in the ${this.scope} scope`, { fileId });
			}
			const outcome = applyArchiveToTopics(this.#topics, fileId, this.scope, options, new Date().toISOString());
			if (outcome.kind === "unchanged") return outcome;
			const commit = await this.#writeTopic(outcome.topic, `memory: archive ${fileId}${archiveReasonSuffix(options.reason)}`, {
				kind: "tool",
				source: options.source ?? null,
			});
			this.#refresh();
			this.#emit();
			return { ...outcome, commit };
		});
	}

	async #writeNow(input: MemoryWriteInput): Promise<MemoryWriteResult> {
		memoryFilePath(this.dir, input.fileId);
		this.#refresh();
		const result = applyWriteToTopics(this.#topics, input, new Date().toISOString(), (candidate) =>
			this.#closeMatches(candidate),
		);
		if (result.kind === "suggest" || result.kind === "unchanged") return result;
		const message =
			result.kind === "created"
				? `memory: create ${input.fileId}`
				: `memory: update ${result.detail ?? "a section"} in ${input.fileId}`;
		const commit = await this.#writeTopic(result.topic, message, { kind: "tool", source: input.source ?? null });
		this.#refresh();
		this.#emit();
		return { ...result, commit };
	}

	/** Close topics for a proposed new one: the index's answer, one row per topic. */
	#closeMatches(input: MemoryWriteInput): MemorySearchHit[] {
		return this.#searchNow({
			query: [input.title ?? humanizeFileId(input.fileId), input.summary ?? "", input.text.slice(0, 2000)].join(" "),
			limit: 8,
		})
			.filter((hit, index, all) => all.findIndex((other) => other.fileId === hit.fileId) === index)
			.slice(0, 3);
	}

	/**
	 * Apply a batch of writes and archives to fresh state and commit it as one commit. The operations are replayed here
	 * rather than taken from a caller's copy, so a write that landed meanwhile is not overwritten; a `.md` file that a
	 * batch no longer touches is left alone.
	 */
	async applyBatch(
		operations: readonly MemoryBatchOperation[],
		renderMessage: (changes: readonly MemoryBatchChange[]) => string,
	): Promise<MemoryBatchResult> {
		return this.#runReady(async () => {
			this.#refresh();
			const topics = new Map(this.#topics);
			const changes: MemoryBatchChange[] = [];
			const files = new Set<string>();
			const now = new Date().toISOString();
			for (const operation of operations) {
				if (operation.type === "write") {
					const result = applyWriteToTopics(topics, operation.input, now, (candidate, text) =>
						searchTopics(topics.values(), this.scope, {
							query: [candidate.title ?? humanizeFileId(candidate.fileId), candidate.summary ?? "", text.slice(0, 2000)]
								.join(" "),
							limit: 8,
						}).filter(
							(hit, index, all) => all.findIndex((other) => other.fileId === hit.fileId) === index,
						).slice(0, 3),
					);
					if (result.kind === "suggest" || result.kind === "unchanged") continue;
					files.add(result.topic.fileId);
					changes.push({
						action: result.kind === "created" ? "create" : "update",
						fileId: result.topic.fileId,
						...(result.detail === undefined ? {} : { detail: result.detail }),
					});
					continue;
				}
				const outcome = applyArchiveToTopics(topics, operation.fileId, this.scope, operation, now);
				if (outcome.kind === "unchanged") continue;
				files.add(operation.fileId);
				changes.push({ action: "archive", fileId: operation.fileId, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) });
			}
			if (changes.length === 0) return { commit: null, files: [], changes: [] };
			// The hand-edit commit comes first, as it does for a single write: the batch's commit holds only the batch.
			await this.#commit(renderCommitMessage(HAND_EDITS_COMMIT_MESSAGE, null, { kind: "hand" }));
			for (const fileId of files) {
				const topic = topics.get(fileId);
				if (topic !== undefined) this.#writeFile(topic);
			}
			const commit = await this.#commit(renderMessage(changes));
			this.#refresh();
			this.#emit();
			return { commit, files: [...files], changes };
		});
	}

	/**
	 * Revert one `extraction` or `maintenance` commit. Refused with `memory_conflict` when a later commit touched the same
	 * files, or when it was already undone; anything else that is not undoable is a `bad_request`.
	 */
	async undo(target: string): Promise<MemoryChange> {
		return this.#runReady(async () => {
			if (!/^[0-9a-f]{7,40}$/.test(target)) {
				throw new ServerError("unknown_memory", `Not a memory commit: "${target}"`, { commit: target });
			}
			const shown = await git(this.dir, [
				"show",
				"-s",
				`--format=%H%x1f%an%x1f%(trailers:key=${COMMIT_KIND_TRAILER},valueonly)`,
				target,
			]);
			if (shown.code !== 0) {
				throw new ServerError("unknown_memory", `No memory commit "${target}" in the ${this.scope} scope`, {
					commit: target,
				});
			}
			const [sha] = shown.stdout.split("\x1f");
			const kind = shown.stdout.split("\x1f")[2]?.trim() ?? "";
			if (kind !== "extraction" && kind !== "maintenance") {
				throw new ServerError("bad_request", `Only an extraction or a maintenance change can be undone, not a ${kind || "changed"} change`, { commit: target });
			}
			const full = sha?.trim() ?? target;
			const present = (await this.#historyNow(200)).find((change) => change.commit === full);
			if (present?.undoneBy !== undefined && present.undoneBy !== null) {
				throw new ServerError("memory_conflict", `That change was already undone by ${present.undoneBy.slice(0, 8)}`, {
					commit: full,
					undoneBy: present.undoneBy,
				});
			}
			const touched = await this.#touchedSince(full);
			const overlap = (present?.files ?? []).filter((fileId) => touched.has(fileId));
			if (overlap.length > 0) {
				throw new ServerError(
					"memory_conflict",
					`Later changes touched ${overlap.join(", ")}, so this change cannot be reverted cleanly`,
					{ commit: full, files: overlap },
				);
			}
			const reverted = await git(this.dir, ["revert", "--no-commit", full]);
			if (reverted.code !== 0) {
				await git(this.dir, ["revert", "--abort"]).catch(() => undefined);
				throw new ServerError("memory_conflict", `Reverting that change failed: ${reverted.stderr.trim()}`, {
					commit: full,
				});
			}
			const subject = present?.message.split("\n")[0] ?? full.slice(0, 8);
			await this.#commit(
				renderCommitMessage(`memory: undo ${full.slice(0, 8)}`, `Reverts ${full.slice(0, 8)}: ${subject}`, {
					kind: "undo",
					undoOf: full,
				}),
			);
			this.#refresh();
			this.#emit();
			const change = (await this.#historyNow(20)).find((entry) => entry.kind === "undo" && entry.undoneBy !== undefined);
			const undoCommit = (await this.#historyNow(20))[0];
			if (undoCommit === undefined) {
				throw new ServerError("internal", "The undo commit could not be read back");
			}
			return change ?? undoCommit;
		});
	}

	/** The files any commit after `since` touched, so an undo never reverts over someone else's edit. */
	async #touchedSince(since: string): Promise<Set<string>> {
		const result = await git(this.dir, ["log", "--name-only", "--format=", `${since}..HEAD`]);
		const files = new Set<string>();
		if (result.code !== 0) return files;
		for (const line of result.stdout.split("\n")) {
			const name = line.trim();
			if (!name.endsWith(".md")) continue;
			const fileId = name.slice(0, -".md".length);
			if (isMemoryFileId(fileId)) files.add(fileId);
		}
		return files;
	}

	async #writeTopic(topic: MemoryTopic, message: string, trailers: MemoryCommitTrailers): Promise<string | null> {
		// Edits made by hand are history of their own: the commit below must hold only the tool's change.
		await this.#commit(renderCommitMessage(HAND_EDITS_COMMIT_MESSAGE, null, { kind: "hand" }));
		this.#writeFile(topic);
		return this.#commit(`${message}\n\n${renderCommitMessage(message, null, trailers).slice(message.length + 2)}`);
	}

	/** Write one topic beside its file and rename, so a reader never sees half a topic. */
	#writeFile(topic: MemoryTopic): void {
		const path = memoryFilePath(this.dir, topic.fileId);
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		if (isSymlink(path)) {
			throw new ServerError("unknown_memory", `Refusing to write through the symlink ${topic.fileId}.md`, {
				fileId: topic.fileId,
			});
		}
		const temporary = join(this.dir, `.${topic.fileId}.md.tmp`);
		writeFileSync(temporary, renderTopic(topic), { mode: 0o600 });
		renameSync(temporary, path);
	}

	async #commit(message: string): Promise<string | null> {
		const added = await git(this.dir, ["add", "-A", "--", "."]);
		if (added.code !== 0) {
			this.#log(`memory: git add in ${this.dir} failed: ${added.stderr.trim() || added.code}`);
			return null;
		}
		const status = await git(this.dir, ["status", "--porcelain"]);
		if (status.code !== 0 || status.stdout.trim().length === 0) return null;
		const commit = await git(this.dir, [...GIT_COMMIT_OPTIONS, "commit", "-q", "-m", message]);
		if (commit.code !== 0) {
			this.#log(`memory: git commit in ${this.dir} failed: ${commit.stderr.trim() || commit.code}`);
			return null;
		}
		const rev = await git(this.dir, ["rev-parse", "HEAD"]);
		return rev.code === 0 ? rev.stdout.trim() : null;
	}
}

// --- the store ----------------------------------------------------------------------------------------------------

export type MemoryStoreOptions = {
	/** The data directory: `global/memory/` and `projects/<id>/memory/` live under it. */
	dataDir: string;
	log?: (message: string) => void;
	/** Called whenever a scope's files changed, a tool write or an edit by hand. */
	onChange?: (scope: MemoryScope, projectId: string | null) => void;
};

/** Both scopes of one backend: one instance per scope, so their locks are shared by every caller. */
export class MemoryStore {
	readonly dataDir: string;
	readonly #log: (message: string) => void;
	readonly #onChange: ((scope: MemoryScope, projectId: string | null) => void) | undefined;
	readonly #scopes = new Map<string, MemoryScopeStore>();

	constructor(options: MemoryStoreOptions) {
		this.dataDir = options.dataDir;
		this.#log = options.log ?? (() => undefined);
		this.#onChange = options.onChange;
	}

	/** The global scope's directory. */
	get globalDir(): string {
		return join(this.dataDir, GLOBAL_DIR_NAME, MEMORY_DIR_NAME);
	}

	projectDir(projectId: string): string {
		if (!isProjectId(projectId)) throw new ServerError("unknown_project", `No project with ID "${projectId}"`);
		return join(this.dataDir, "projects", projectId, MEMORY_DIR_NAME);
	}

	scope(target: MemoryTarget): MemoryScopeStore {
		const key = target.scope === "global" ? "global" : `project:${target.projectId}`;
		const known = this.#scopes.get(key);
		if (known !== undefined) return known;
		const projectId = target.scope === "global" ? null : target.projectId;
		const dir = target.scope === "global" ? this.globalDir : this.projectDir(target.projectId);
		const store = new MemoryScopeStore({
			scope: target.scope,
			projectId,
			dir,
			indexFile: join(dirname(dir), MEMORY_INDEX_FILE),
			log: this.#log,
			onChange: () => this.#onChange?.(target.scope, projectId),
		});
		this.#scopes.set(key, store);
		return store;
	}

	/** Create the global repository and watch it, so hand edits are indexed before any request asks. */
	async start(): Promise<void> {
		await this.scope({ scope: "global" }).ensure();
	}

	async close(): Promise<void> {
		const scopes = [...this.#scopes.values()];
		this.#scopes.clear();
		for (const scope of scopes) await scope.close().catch(() => undefined);
	}

	/** The scopes a request addresses; `both` needs the project for its project half. */
	#targets(scope: MemoryScope | "both", projectId: string | undefined): MemoryTarget[] {
		if (scope === "global") return [{ scope: "global" }];
		if (scope === "project") return [{ scope: "project", projectId: this.#requireProject(projectId) }];
		return [
			{ scope: "global" },
			{ scope: "project", projectId: this.#requireProject(projectId) },
		];
	}

	#requireProject(projectId: string | undefined): string {
		if (projectId === undefined) {
			throw new ServerError("bad_request", "projectId is required for the project memory scope");
		}
		if (!isProjectId(projectId)) throw new ServerError("unknown_project", `No project with ID "${projectId}"`);
		return projectId;
	}

	async list(
		scope: MemoryScope,
		projectId: string | undefined,
		options: ListOptions = {},
	): Promise<MemoryFileSummary[]> {
		const target = this.#targets(scope, projectId)[0]!;
		return this.scope(target).list(options);
	}

	async read(scope: MemoryScope, projectId: string | undefined, fileId: string): Promise<MemoryFile> {
		const target = this.#targets(scope, projectId)[0]!;
		return this.scope(target).read(fileId);
	}

	async search(options: {
		query: string;
		scope: MemoryScope | "both";
		projectId?: string;
		tags?: readonly string[];
		includeArchived?: boolean;
		limit: number;
	}): Promise<MemorySearchHit[]> {
		const targets = this.#targets(options.scope, options.projectId);
		const groups = await Promise.all(
			targets.map((target) =>
				this.scope(target).search({
					query: options.query,
					...(options.tags === undefined ? {} : { tags: options.tags }),
					...(options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived }),
					limit: options.limit,
				}),
			),
		);
		return groups
			.flat()
			.sort((left, right) => left.rank - right.rank)
			.slice(0, options.limit);
	}

	async history(scope: MemoryScope, projectId: string | undefined, limit: number): Promise<MemoryChange[]> {
		const target = this.#targets(scope, projectId)[0]!;
		return this.scope(target).history(limit);
	}

	/** Revert one `extraction` or `maintenance` change in the scope it belongs to. */
	async undo(scope: MemoryScope, projectId: string | undefined, commit: string): Promise<MemoryChange> {
		const target = this.#targets(scope, projectId)[0]!;
		return this.scope(target).undo(commit);
	}

	async write(input: MemoryWriteInput): Promise<MemoryWriteResult> {
		return this.scope(input.target).write(input);
	}

	async archive(
		target: MemoryTarget,
		fileId: string,
		options: { source?: MemorySource | null; reason?: string } = {},
	): Promise<MemoryWriteOutcome> {
		return this.scope(target).archive(fileId, options);
	}

	/** The catalog: how many topics and tags each scope has, for the coordinator's prompt and its tools. */
	async stats(projectId: string): Promise<{ global: MemoryScopeStats; project: MemoryScopeStats }> {
		const global = this.scope({ scope: "global" });
		const project = this.scope({ scope: "project", projectId: this.#requireProject(projectId) });
		const [globalStats, projectStats] = await Promise.all([global.stats(), project.stats()]);
		return { global: globalStats, project: projectStats };
	}
}

/** A scope's key in a persisted per-scope record: `global`, or `project:<id>`. */
export function scopeKey(target: MemoryTarget): string {
	return target.scope === "global" ? "global" : `project:${target.projectId}`;
}

/**
 * The scopes that already exist in a data directory, without creating or opening any project: the maintenance clock
 * walks these, so a project nobody opened costs one directory check.
 */
export function memoryScopesOnDisk(dataDir: string): MemoryTarget[] {
	const targets: MemoryTarget[] = [];
	if (existsSync(join(dataDir, GLOBAL_DIR_NAME, MEMORY_DIR_NAME))) targets.push({ scope: "global" });
	let names: string[];
	try {
		names = readdirSync(join(dataDir, "projects"));
	} catch {
		names = [];
	}
	for (const name of names.sort()) {
		if (!isProjectId(name)) continue;
		if (existsSync(join(dataDir, "projects", name, MEMORY_DIR_NAME))) {
			targets.push({ scope: "project", projectId: name });
		}
	}
	return targets;
}
