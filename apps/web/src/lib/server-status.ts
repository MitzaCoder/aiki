/**
 * What the home page and the chat read from a backend's `server.status`: the release it runs, and a banner when the
 * last deploy needs attention, and how full its disks are. Pure functions plus the per-browser dismissal storage, so the components only lay the
 * text out.
 *
 * A dismissal belongs to one deploy attempt (commit + when it ended) and lives in `localStorage`, like the backend list
 * and the theme: dismissing a failure on a phone must silence it there, and a later deploy must show again.
 */
import {
	deployAttemptKey,
	diskLevel,
	lowDisks,
	shortCommit,
	type DeployProblem,
	type DiskLevel,
} from "@mihai-harness/client";
import type { DeployStatus, DiskStatus, ReleaseInfo, ServerStatus } from "@mihai-harness/protocol";
import { formatBytes } from "./artifacts.ts";
import { relativeTime } from "./relative-time.ts";

/** Per browser, like the backend list. Bumped when the stored shape changes. */
export const DEPLOY_DISMISSALS_STORAGE_KEY = "mihai-harness.dismissed-deploys.v1";

/** How many attempts a browser remembers. Deploys are rare, so a handful covers the open failures. */
export const MAX_DISMISSED_DEPLOYS = 20;

/** Just the fields a row needs, so a missing status draws nothing. */
export type ReleaseView = {
	/** First seven characters of the commit. */
	commit: string;
	description: string;
	/** How long ago the release was deployed. */
	when: string;
	/** Hover text: the release name, full commit and exact time. */
	title: string;
	/**
	 * Set when the last deploy published a newer commit that changes nothing this backend runs, so it was not restarted:
	 * "a1b2c3d deployed, backend unchanged since be84355".
	 */
	unchanged?: string;
	/**
	 * Set while this backend catches up to a commit it missed (a laptop that was away): "waiting to deploy a1b2c3d, back
	 * online, deploying feat: ...". A backend that is still away cannot say so; this shows once it answers again.
	 */
	pending?: string;
};

/**
 * The running release as one row: commit, commit description and when it was deployed. `deploy`, the last attempt, adds
 * the note for a deploy that left this backend running its older release.
 */
export function releaseView(release: ReleaseInfo, now: number, deploy?: DeployStatus | null): ReleaseView {
	const view: ReleaseView = {
		commit: shortCommit(release.commit),
		description: release.description,
		when: relativeTime(release.deployedAt, now),
		title: `${release.name}\n${release.commit}\n${release.description}\nDeployed ${new Date(release.deployedAt).toLocaleString()}`,
	};
	if (deploy?.state === "ok" && deploy.backendUnchanged === true && deploy.commit !== release.commit) {
		view.unchanged = `${shortCommit(deploy.commit)} deployed, backend unchanged since ${view.commit}`;
	}
	if (deploy?.pending !== undefined && deploy.pending.commit !== release.commit) {
		const why = deploy.pending.message.length > 0 ? `: ${deploy.pending.message}` : "";
		view.pending = `Catching up to ${shortCommit(deploy.pending.commit)}${why}`;
	}
	return view;
}

/** What the deploy banner says: a headline, the attempt, the failure and what still runs. */
export type DeployBannerView = {
	tone: "error" | "warning";
	title: string;
	/** The attempted commit, short. */
	commit: string;
	/** The attempted commit's first description line. */
	description: string;
	/** How long ago the attempt ended. */
	when: string;
	/** The attempt's own explanation, or a sentence for the state when the server wrote none. */
	detail: string;
	/** What is running instead. */
	note: string;
};

/** The release a deploy attempt was for. */
function attempted(deploy: DeployStatus): { commit: string; description: string } {
	return { commit: shortCommit(deploy.commit), description: deploy.description };
}

/** What runs now, in a sentence that fits under the failure. */
function runningNote(running: ReleaseInfo | null): string {
	if (running === null) return "This backend runs from a checkout, so no release was published.";
	return `The previous release is still running: ${shortCommit(running.commit)} ${running.description}`.trim();
}

/**
 * The banner for a deploy that needs attention. The wording is here rather than in the component so both screens say the
 * same thing and the sentences are covered by tests.
 */
export function deployBanner(problem: DeployProblem, now: number): DeployBannerView {
	const { commit, description } = attempted(problem.deploy);
	const when = relativeTime(problem.deploy.at, now);
	switch (problem.kind) {
		case "failed":
			return {
				tone: "error",
				title: "Deploy failed",
				commit,
				description,
				when,
				detail: problem.deploy.message ?? "The deploy failed before it published anything.",
				note: runningNote(problem.running),
			};
		case "rolled_back":
			return {
				tone: "warning",
				title: "Deploy rolled back",
				commit,
				description,
				when,
				detail: problem.deploy.message ?? "The new release failed its health check after the restart.",
				note: runningNote(problem.running),
			};
		case "unexpected_release":
			return {
				tone: "warning",
				title: "Release does not match the last deploy",
				commit,
				description,
				when,
				detail: `The last deploy reports ${commit} as deployed, but this backend runs ${
					problem.running === null ? "a checkout" : shortCommit(problem.running.commit)
				}.`,
				note: "Dismiss this once you know whether the running release or the deploy record is the stale one.",
			};
	}
}

/** Parse the stored dismissal list: strings only, deduplicated, newest last, at most `MAX_DISMISSED_DEPLOYS`. */
export function parseDismissedDeploys(raw: string | null): string[] {
	if (raw === null) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const keys: string[] = [];
	for (const item of parsed) {
		if (typeof item !== "string") continue;
		const key = item.trim();
		if (key.length === 0 || keys.includes(key)) continue;
		keys.push(key);
	}
	return keys.slice(-MAX_DISMISSED_DEPLOYS);
}

/** The browser's dismissed deploy attempts. */
export function loadDismissedDeploys(
	storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): string[] {
	if (storage === undefined) return [];
	try {
		return parseDismissedDeploys(storage.getItem(DEPLOY_DISMISSALS_STORAGE_KEY));
	} catch {
		return [];
	}
}

export function saveDismissedDeploys(
	keys: readonly string[],
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (storage === undefined) return;
	try {
		storage.setItem(DEPLOY_DISMISSALS_STORAGE_KEY, JSON.stringify(keys.slice(-MAX_DISMISSED_DEPLOYS)));
	} catch {
		// Storage can be full or disabled; the banner still hides for this session.
	}
}

/** Whether this attempt was dismissed on this browser. */
export function isDeployDismissed(dismissed: readonly string[], deploy: DeployStatus): boolean {
	return dismissed.includes(deployAttemptKey(deploy));
}

/** The list after dismissing one attempt, newest last; dismissing twice keeps one entry. */
export function addDismissedDeploy(
	dismissed: readonly string[],
	deploy: DeployStatus,
	limit = MAX_DISMISSED_DEPLOYS,
): string[] {
	const key = deployAttemptKey(deploy);
	const kept = dismissed.filter((entry) => entry !== key);
	kept.push(key);
	return kept.slice(-Math.max(1, limit));
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/** How often an open chat reads `server.status` again, so a disk filling during a long run shows. */
export const SERVER_STATUS_REFRESH_MS = 5 * 60_000;

// --- disks -------------------------------------------------------------------------------------------------------

/** One filesystem on the Backends page's "Machine" line: `Data 42 GB free of 512 GB`, coloured by how full it is. */
export type DiskView = {
	label: string;
	text: string;
	level: DiskLevel;
	/** The tooltip: the path it was measured at and the share free. */
	title: string;
};

function freeShare(disk: DiskStatus): string {
	if (disk.totalBytes <= 0) return "";
	return `${Math.round((disk.freeBytes / disk.totalBytes) * 100)}% free`;
}

export function diskView(disk: DiskStatus): DiskView {
	const share = freeShare(disk);
	return {
		label: disk.label,
		text: `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`,
		level: diskLevel(disk),
		title: share === "" ? disk.path : `${disk.path} · ${share}`,
	};
}

/** The text colour of a disk level: the page's own for ok, amber when tight, red when low. */
export function diskLevelClass(level: DiskLevel): string {
	switch (level) {
		case "low":
			return "text-(--chat-danger)";
		case "tight":
			return "text-(--chat-warning)";
		case "ok":
			return "";
	}
}

/**
 * The short warning under a backend's disks, or undefined while none is low: which filesystems, and what to do. The
 * harness warns and never blocks, so this says what will go wrong rather than that anything stopped.
 */
export function diskWarning(status: ServerStatus | null | undefined): string | undefined {
	const low = lowDisks(status);
	if (low.length === 0) return undefined;
	const names = low.map((disk) => `${disk.label} (${formatBytes(disk.freeBytes)} free)`).join(", ");
	const where = low.length === 1 ? "is" : "are";
	return `${names} ${where} low on space. Builds and new workspaces may fail.`;
}
