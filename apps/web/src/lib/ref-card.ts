/**
 * A ticket or pull request's card: which links get one, what it says in words, which tasks name the same thing and
 * where it sits on screen. Pure functions; `RefCardHost.svelte` wires them to the page and `RefCard.svelte` draws them.
 */
import {
	NO_PROJECT_LINKS,
	type ProjectLinks,
	type PullRequestChecks,
	type PullRequestReviews,
	type RefDetails,
	type RefStatus,
	type ResolvedRef,
	refIdentity,
	resolveRef,
} from "@kemiri/protocol";

/** What a card can be about: a GitHub pull request or issue, or a Jira ticket. */
export type CardRef = Exclude<ResolvedRef, { source: "web" }>;

/** The ref a link's address is about when it gets a card; undefined for any other link. */
export function cardRefOf(href: string): CardRef | undefined {
	const resolved = resolveRef(href);
	return resolved === undefined || resolved.source === "web" ? undefined : resolved;
}

/**
 * Whether `target` is inside `container`. Svelte sets a `bind:this` variable to `null` (never `undefined`) when its
 * element is destroyed, so a closed card's box is `null`; this is the check that survives that.
 */
export function containsTarget(container: { contains(node: never): boolean } | null | undefined, target: unknown): boolean {
	return container != null && target != null && container.contains(target as never);
}

/** The card's heading: "acme/platform #12", "EX-1234". */
export function cardRefLabel(ref: CardRef): string {
	return ref.source === "github" ? `${ref.repo} #${ref.number}` : ref.key;
}

/** What it is in a word: "Pull request", "Issue", "Story"; the details know best, a cached state next. */
export function cardKindWords(ref: CardRef, details: RefDetails | undefined, status: RefStatus | undefined): string {
	const kind = details?.kind ?? status?.kind;
	if (kind === "pull") return "Pull request";
	if (kind === "issue") return "Issue";
	if (details?.kind === "jira" && details.type !== null) return details.type;
	if (ref.source === "jira") return "Ticket";
	return ref.kind === "pull" ? "Pull request" : ref.kind === "issue" ? "Issue" : "Pull request or issue";
}

/** "Open in GitHub", "Open in Jira". */
export function openWords(ref: CardRef): string {
	return ref.source === "github" ? "Open in GitHub" : "Open in Jira";
}

const count = new Intl.NumberFormat("en");

/** "12 passed, 2 failing, 1 running"; skipped ones only when nothing else ran. */
export function checksWords(checks: PullRequestChecks): string {
	const parts: string[] = [];
	if (checks.passed > 0) parts.push(`${count.format(checks.passed)} passed`);
	if (checks.failing > 0) parts.push(`${count.format(checks.failing)} failing`);
	if (checks.running > 0) parts.push(`${count.format(checks.running)} running`);
	if (parts.length === 0 && checks.skipped > 0) parts.push(`${count.format(checks.skipped)} skipped`);
	return parts.join(", ");
}

/** The failing checks by name, a few then how many more: "lint, e2e (cancelled) and 3 more". */
export function failingChecksWords(checks: PullRequestChecks, shown = 3): string | undefined {
	if (checks.failingNames.length === 0) return undefined;
	const names = checks.failingNames.slice(0, shown);
	const more = Math.max(checks.failing, checks.failingNames.length) - names.length;
	return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
}

/** The overall colour of the checks: failing, running or passing. */
export function checksTone(checks: PullRequestChecks): "blocked" | "working" | "done" | "todo" {
	if (checks.failing > 0) return "blocked";
	if (checks.running > 0) return "working";
	return checks.passed > 0 ? "done" : "todo";
}

/** A list of names as people say it: "ana", "ana and bob", "ana, bob and 2 others". */
export function namesWords(names: readonly string[], shown = 2): string {
	if (names.length <= shown + 1) {
		return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
	}
	return `${names.slice(0, shown).join(", ")} and ${names.length - shown} others`;
}

export type ReviewLine = { tone: "done" | "blocked" | "review" | "todo"; text: string };

/** Where the review stands, one line each: who approved, who asked for changes, whom it waits on. */
export function reviewLines(reviews: PullRequestReviews): ReviewLine[] {
	const lines: ReviewLine[] = [];
	if (reviews.changesRequestedBy.length > 0) lines.push({ tone: "blocked", text: `Changes requested by ${namesWords(reviews.changesRequestedBy)}` });
	if (reviews.approvedBy.length > 0) lines.push({ tone: "done", text: `Approved by ${namesWords(reviews.approvedBy)}` });
	if (reviews.waitingOn.length > 0) lines.push({ tone: "review", text: `Waiting on ${namesWords(reviews.waitingOn)}` });
	if (lines.length === 0) {
		lines.push(
			reviews.decision === "approved"
				? { tone: "done", text: "Approved" }
				: { tone: "todo", text: reviews.decision === "review_required" ? "Needs a review" : "No reviews yet" },
		);
	}
	return lines;
}

/** "+1,173 −98 · 27 files". */
export function changeWords(details: { additions: number; deletions: number; changedFiles: number }): string {
	const files = `${count.format(details.changedFiles)} ${details.changedFiles === 1 ? "file" : "files"}`;
	return `+${count.format(details.additions)} −${count.format(details.deletions)} · ${files}`;
}

/** A pull request's or issue's state as a word: "Draft", "Merged", "Closed as not planned". */
export function githubStateWords(details: Extract<RefDetails, { kind: "pull" | "issue" }>): string {
	if (details.kind === "pull") return details.state === "open" ? "Open" : details.state === "draft" ? "Draft" : details.state === "merged" ? "Merged" : "Closed";
	if (details.state === "open") return "Open";
	return details.closedAs === "not_planned" ? "Closed as not planned" : details.closedAs === "duplicate" ? "Closed as duplicate" : "Closed";
}

export type TaskMention = { id: string; title: string; status: string };

/** The tasks whose refs are about the same ticket or pull request, in board order. */
export function tasksNaming(
	ref: CardRef,
	tasks: readonly { id: string; title: string; status: string; refs?: readonly string[] }[],
	links: ProjectLinks | undefined,
): TaskMention[] {
	const identity = refIdentity(ref);
	return tasks
		.filter((task) =>
			(task.refs ?? []).some((entry) => {
				const resolved = resolveRef(entry, links ?? NO_PROJECT_LINKS);
				return resolved !== undefined && refIdentity(resolved) === identity;
			}),
		)
		.map(({ id, title, status }) => ({ id, title, status }));
}

/** The board ref (as written on a task) about the same thing as `ref`, so its cached state can be found. */
export function boardRefFor(ref: CardRef, refs: readonly string[], links: ProjectLinks | undefined): string | undefined {
	const identity = refIdentity(ref);
	return refs.find((entry) => {
		const resolved = resolveRef(entry, links ?? NO_PROJECT_LINKS);
		return resolved !== undefined && refIdentity(resolved) === identity;
	});
}

// --- placement ---------------------------------------------------------------------------------------------------

export type Box = { left: number; top: number; width: number; height: number };

/** Space kept between the card and the edge of what holds it. */
export const CARD_MARGIN = 8;
const GAP = 6;

/**
 * Where the card goes: under its link when it fits, else over it, else on the side with more room; its left edge
 * lines up with the link's and both stay `CARD_MARGIN` inside `bounds`.
 */
export function placeCard(anchor: Box, card: { width: number; height: number }, bounds: Box): { left: number; top: number; side: "below" | "above" } {
	const minLeft = bounds.left + CARD_MARGIN;
	const maxLeft = bounds.left + bounds.width - CARD_MARGIN - card.width;
	const left = Math.max(minLeft, Math.min(anchor.left, maxLeft));
	const below = bounds.top + bounds.height - CARD_MARGIN - (anchor.top + anchor.height + GAP);
	const above = anchor.top - GAP - (bounds.top + CARD_MARGIN);
	const side = card.height <= below || (card.height > above && below >= above) ? "below" : "above";
	const wanted = side === "below" ? anchor.top + anchor.height + GAP : anchor.top - GAP - card.height;
	const maxTop = bounds.top + bounds.height - CARD_MARGIN - card.height;
	const top = Math.max(bounds.top + CARD_MARGIN, Math.min(wanted, maxTop));
	return { left, top, side };
}

/** The part of the window a box holds; the window itself for none. */
export function visiblePart(box: Box | undefined, viewport: { width: number; height: number }): Box {
	if (box === undefined) return { left: 0, top: 0, width: viewport.width, height: viewport.height };
	const left = Math.max(0, box.left);
	const top = Math.max(0, box.top);
	const right = Math.min(viewport.width, box.left + box.width);
	const bottom = Math.min(viewport.height, box.top + box.height);
	return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
