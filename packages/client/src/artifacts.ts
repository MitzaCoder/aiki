/**
 * Helpers on top of the protocol's artifact types: which lists a pushed change belongs to, how a list takes it in, and
 * when a signed URL should be asked for again.
 */
import type { Artifact, ArtifactsChangedEvent } from "@kemiri/protocol";

/** The filters `artifacts.list` takes besides the project; together they narrow the list. */
export type ArtifactFilter = { artifactId?: string; threadId?: string; workerId?: string; taskId?: string };

/** A signed URL as `artifacts.url` answers it. */
export type ArtifactUrl = { url: string; expiresAt: string };

/** How long before its expiry a URL is asked for again, so an element never loads one that just ran out. */
export const ARTIFACT_URL_REFRESH_MARGIN_MS = 5 * 60_000;

/** The shortest wait before asking again, so a URL that is already (nearly) expired does not loop. */
export const ARTIFACT_URL_MIN_REFRESH_MS = 5_000;

/** Whether an artifact belongs in a list of this project with these filters. */
export function artifactMatches(artifact: Artifact, projectId: string, filter: ArtifactFilter = {}): boolean {
	if (artifact.projectId !== projectId) return false;
	if (filter.artifactId !== undefined && artifact.id !== filter.artifactId) return false;
	if (filter.threadId !== undefined && artifact.threadId !== filter.threadId) return false;
	if (filter.workerId !== undefined && artifact.workerId !== filter.workerId) return false;
	if (filter.taskId !== undefined && artifact.taskId !== filter.taskId) return false;
	return true;
}

/** Whether a pushed change concerns a list of this project with these filters, the deleted ones included. */
export function artifactsChangedIsFor(event: ArtifactsChangedEvent, projectId: string, filter: ArtifactFilter = {}): boolean {
	return event.projectId === projectId && artifactMatches(event.artifact, projectId, filter);
}

/** Newest first, as `artifacts.list` answers; equal times fall back to the ID so the order is stable. */
export function compareArtifactsNewestFirst(left: Artifact, right: Artifact): number {
	const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);
	if (byTime !== 0 && Number.isFinite(byTime)) return byTime;
	return right.id.localeCompare(left.id);
}

/**
 * A list with one pushed change taken in: a saved artifact is added or replaced in its place, a deleted one removed. A
 * change the list's filters exclude leaves it as it is (the same array). `limit` keeps the list as long as the server
 * would answer it.
 */
export function applyArtifactChange(
	list: readonly Artifact[],
	event: ArtifactsChangedEvent,
	projectId: string,
	filter: ArtifactFilter = {},
	limit?: number,
): readonly Artifact[] {
	if (event.projectId !== projectId) return list;
	if (!artifactMatches(event.artifact, projectId, filter)) {
		// A new version may have a different saving thread/worker and leave this filtered list.
		const remaining = list.filter((artifact) => artifact.id !== event.artifact.id);
		return remaining.length === list.length ? list : remaining;
	}
	const rest = list.filter((artifact) => artifact.id !== event.artifact.id);
	if (event.deleted) return rest.length === list.length ? list : rest;
	const next = [...rest, event.artifact].sort(compareArtifactsNewestFirst);
	return limit === undefined ? next : next.slice(0, limit);
}

/**
 * Milliseconds until a URL expiring at `expiresAt` should be asked for again: the margin before expiry, or a few seconds
 * when it is closer than that (or the time does not parse).
 */
export function artifactUrlRefreshIn(expiresAt: string, now: number, margin = ARTIFACT_URL_REFRESH_MARGIN_MS): number {
	const expires = Date.parse(expiresAt);
	if (!Number.isFinite(expires)) return ARTIFACT_URL_MIN_REFRESH_MS;
	return Math.max(ARTIFACT_URL_MIN_REFRESH_MS, expires - margin - now);
}

/** Whether a URL can still be handed to an element: it does not expire within the margin's last minute. */
export function artifactUrlUsable(url: ArtifactUrl, now: number): boolean {
	const expires = Date.parse(url.expiresAt);
	return Number.isFinite(expires) && expires - now > 60_000;
}
