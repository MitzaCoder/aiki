/**
 * How Project settings' Storage section reads: what each workspace is, what a cleanup would free, and what it did. Pure,
 * so the section and the tests agree.
 */
import { removableStorage, type StorageCleanResult } from "@aiki/client";
import type { StorageItem } from "@aiki/protocol";
import { formatBytes } from "./artifacts.ts";

/** "Worker" or "Background thread": the kind of workspace a row is. */
export function storageKindLabel(kind: StorageItem["kind"]): string {
	return kind === "worker" ? "Worker" : "Background thread";
}

/** "finished" for one a cleanup may remove, "running" for one still in use. */
export function storageStateLabel(item: Pick<StorageItem, "removable">): string {
	return item.removable ? "finished" : "running";
}

/** Bytes as the section reads them; 0 is "empty", not a blank. */
export function storageSize(bytes: number): string {
	return bytes === 0 ? "empty" : formatBytes(bytes);
}

/** What the "Clean up finished" button and its confirmation say about the finished workspaces. */
export function cleanupSummary(items: readonly StorageItem[]): { count: number; bytes: number; text: string } {
	const removable = removableStorage(items);
	const count = removable.items.length;
	const what = count === 1 ? "1 finished workspace" : `${count} finished workspaces`;
	return { count, bytes: removable.bytes, text: count === 0 ? "Nothing finished to clean up." : `${what}, ${storageSize(removable.bytes)}` };
}

/** What a cleanup did, in one line: how much it freed, and why the server kept any it was asked to remove. */
export function cleanupNotice(result: StorageCleanResult): { tone: "info" | "warning"; text: string } {
	const removed = result.removed.length;
	const freed =
		removed === 0
			? "Nothing was removed."
			: `Removed ${removed === 1 ? "1 workspace" : `${removed} workspaces`} and freed ${storageSize(result.freedBytes)}.`;
	if (result.refused.length === 0) return { tone: "info", text: freed };
	const reasons = result.refused.map((entry) => entry.reason).filter((reason, index, all) => all.indexOf(reason) === index);
	const kept = result.refused.length === 1 ? "1 was kept" : `${result.refused.length} were kept`;
	return { tone: "warning", text: `${freed} ${kept}: ${reasons.join("; ")}.` };
}
