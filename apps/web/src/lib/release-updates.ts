import type { ReleaseUpdateState } from "@aiki/protocol";

export const UPDATE_INSTRUCTIONS = "Stop Aiki, then aiki update, then start it.";

/** Dismissal hides only the banner, never the About row. */
export function visibleReleaseUpdate(updates: ReleaseUpdateState | undefined): boolean {
	return updates?.schemaVersion === 1 && updates.enabled && updates.available !== null && updates.available.version !== updates.dismissedVersion;
}
