/**
 * Tickets and pull requests in the app: where a ref opens, what its live state says in words and colour, and the keys
 * and `#123`s in running text turned into links through the project's link settings. Pure functions; the shared
 * resolution (`resolveRef`, `refMentions`) is in the protocol, so a link here and the status the server read agree.
 */
import {
	NO_PROJECT_LINKS,
	type ProjectLinks,
	type RefStatus,
	type ResolvedRef,
	refMentions,
	resolveRef,
} from "@kemiri/protocol";
import type { TaskStatusTone } from "./tasks.ts";

/** Where a ref opens; undefined for one the settings cannot link (a bare key without a Jira site, say). */
export function refHref(ref: string, links: ProjectLinks | undefined): string | undefined {
	return resolveRef(ref, links ?? NO_PROJECT_LINKS)?.url;
}

/** What kind of thing a ref is, in a word or two, for a tooltip or a screen reader. */
export function refKindWords(resolved: ResolvedRef | undefined, status: RefStatus | undefined): string {
	if (status?.kind === "pull") return "Pull request";
	if (status?.kind === "issue") return "Issue";
	if (status?.kind === "jira" || resolved?.source === "jira") return "Ticket";
	if (resolved?.source === "github") return resolved.kind === "pull" ? "Pull request" : resolved.kind === "issue" ? "Issue" : "Pull request or issue";
	return "Link";
}

/** What a ref the settings cannot link looks like it is. */
function unlinkedKindWords(ref: string): string {
	const text = ref.trim();
	if (/^[A-Z][A-Z0-9_]+-\d+$/.test(text)) return "Ticket";
	if (/#\d+$/.test(text)) return "Pull request or issue";
	return "Ref";
}

/** A pull request's checks are only news while it is open. */
function checksWords(status: RefStatus): string | undefined {
	if (status.kind !== "pull" || (status.state !== "open" && status.state !== "draft") || status.checks === null) return undefined;
	switch (status.checks) {
		case "passing":
			return "checks passing";
		case "failing":
			return "checks failing";
		case "pending":
			return "checks running";
	}
}

/** The state in plain words: "Merged", "Open · checks failing", "Closed", or the Jira status as its project names it. */
export function refStatusWords(status: RefStatus): string {
	if (status.kind === "jira") return status.status;
	const state = status.state === "open" ? "Open" : status.state === "closed" ? "Closed" : status.state === "draft" ? "Draft" : "Merged";
	const checks = checksWords(status);
	return checks === undefined ? state : `${state} · ${checks}`;
}

/**
 * The colour a state wears, from the task tones so it sits with the rows: open and in progress like working, a draft or
 * a ticket not started like to do, merged and done like done, closed unmerged like dropped, and failing checks on an
 * open pull request like blocked.
 */
export function refStatusTone(status: RefStatus): TaskStatusTone {
	switch (status.kind) {
		case "pull":
			if ((status.state === "open" || status.state === "draft") && status.checks === "failing") return "blocked";
			return status.state === "open" ? "working" : status.state === "draft" ? "todo" : status.state === "merged" ? "done" : "dropped";
		case "issue":
			return status.state === "open" ? "working" : "done";
		case "jira":
			return status.category === "done" ? "done" : status.category === "in_progress" ? "working" : "todo";
	}
}

/** The class that hands a state's colour to `--task-status`, like a task's (`base.css`). */
export function refStatusToneClass(status: RefStatus): string {
	return `task-status-${refStatusTone(status)}`;
}

/** A chip's tooltip: what it is and where it stands, then its title. */
export function refTooltip(ref: string, label: string, links: ProjectLinks | undefined, status: RefStatus | undefined): string {
	const resolved = resolveRef(ref, links ?? NO_PROJECT_LINKS);
	const kind = resolved === undefined ? unlinkedKindWords(ref) : refKindWords(resolved, status);
	const head = `${kind} ${label}${status === undefined ? "" : `: ${refStatusWords(status)}`}`;
	const lines = [head];
	if (status !== undefined && status.title.length > 0) lines.push(status.title);
	return lines.join("\n");
}

// --- mentions in text --------------------------------------------------------------------------------------------

/** Code, links (Markdown and HTML), HTML tags and addresses: places a mention must not be linked in. */
const PROTECTED =
	/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|<a\b[^>]*>[\s\S]*?<\/a>|<[^>\n]+>|https?:\/\/\S+/gi;

function linkPlain(text: string, links: ProjectLinks, keepEnd: boolean): string {
	const mentions = refMentions(text, links);
	if (mentions.length === 0) return text;
	let result = "";
	let last = 0;
	for (const mention of mentions) {
		const end = mention.index + mention.text.length;
		if (keepEnd && end === text.length) continue;
		result += `${text.slice(last, mention.index)}[${mention.text}](${mention.resolved.url})`;
		last = end;
	}
	return result + text.slice(last);
}

/**
 * Markdown with each ticket key and PR number the project's settings can link turned into a link, leaving code, links,
 * HTML and addresses alone. While the text is still arriving, a mention at its very end may be half of a longer one, so
 * it waits.
 */
export function linkRefMentions(markdown: string, links: ProjectLinks, options: { streaming?: boolean } = {}): string {
	if (!/[A-Z]-\d|#\d/.test(markdown)) return markdown;
	let result = "";
	let last = 0;
	for (const match of markdown.matchAll(PROTECTED)) {
		result += linkPlain(markdown.slice(last, match.index), links, false) + match[0];
		last = match.index + match[0].length;
	}
	return result + linkPlain(markdown.slice(last), links, options.streaming === true);
}

export type RefPiece = { text: string; href?: string };

/** Plain text (a title, a message typed by the user) cut into text and the mentions that link. */
export function splitRefMentions(text: string, links: ProjectLinks | undefined): RefPiece[] {
	if (links === undefined) return [{ text }];
	const pieces: RefPiece[] = [];
	let last = 0;
	const add = (segment: string, offset: number): void => {
		for (const mention of refMentions(segment, links)) {
			const start = offset + mention.index;
			if (start > last) pieces.push({ text: text.slice(last, start) });
			pieces.push({ text: mention.text, href: mention.resolved.url });
			last = start + mention.text.length;
		}
	};
	// Addresses in the text are left as they are.
	let from = 0;
	for (const match of text.matchAll(/https?:\/\/\S+/g)) {
		add(text.slice(from, match.index), from);
		from = match.index + match[0].length;
	}
	add(text.slice(from), from);
	if (last < text.length) pieces.push({ text: text.slice(last) });
	return pieces;
}
