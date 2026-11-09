/**
 * Helpers on top of the protocol's server-status types: the release a backend runs, and whether its last deploy needs the
 * reader's attention.
 *
 * The protocol carries the facts. What is shared here is the judgement every consumer has to make the same way: a deploy
 * is a problem when it failed or rolled back, and also when it says `ok` for a commit other than the running release's —
 * the deploy published one commit and the server came back on another, so what runs is not what the deploy claims.
 */
import type { DeployStatus, ReleaseInfo, ServerStatus } from "@mihai-harness/protocol";

/** Release names and git output show this many characters of a commit. */
export const SHORT_COMMIT_LENGTH = 7;

/** The commit as a person reads it: `be84355`. Shorter input stays as it is. */
export function shortCommit(commit: string, length = SHORT_COMMIT_LENGTH): string {
	return commit.slice(0, Math.max(1, Math.trunc(length)));
}

export const DEPLOY_PROBLEM_KINDS = ["failed", "rolled_back", "unexpected_release"] as const;
export type DeployProblemKind = (typeof DEPLOY_PROBLEM_KINDS)[number];

/**
 * The last deploy, when it needs attention.
 *
 * - `failed`: the checks or the build failed; nothing was published.
 * - `rolled_back`: the new release failed its health check and the previous one was restored.
 * - `unexpected_release`: the deploy says `ok`, but the server runs another commit — unless the deploy says the backend was
 *   unchanged and therefore not restarted, which keeps the older release running on purpose.
 */
export type DeployProblem = {
	kind: DeployProblemKind;
	/** The attempt itself: its commit, description, message and time. */
	deploy: DeployStatus;
	/** The release still running; null when the server runs from a checkout. */
	running: ReleaseInfo | null;
};

/**
 * Why the last deploy needs attention, or undefined when it does not. A server that runs from a checkout has no release
 * commit to compare with, so only an explicit failure or rollback is a problem there.
 */
export function deployProblem(status: ServerStatus | null | undefined): DeployProblem | undefined {
	if (status === null || status === undefined) return undefined;
	const deploy = status.deploy;
	if (deploy === null) return undefined;
	if (deploy.state === "failed" || deploy.state === "rolled_back") {
		return { kind: deploy.state, deploy, running: status.release };
	}
	if (status.release !== null && status.release.commit !== deploy.commit && deploy.backendUnchanged !== true) {
		return { kind: "unexpected_release", deploy, running: status.release };
	}
	return undefined;
}

/**
 * One deploy attempt, for remembering that the reader dismissed it: the commit plus when the attempt ended. A new attempt
 * gets a new key, so dismissing one failure does not hide the next.
 */
export function deployAttemptKey(deploy: DeployStatus): string {
	return `${deploy.commit}@${deploy.at}`;
}
