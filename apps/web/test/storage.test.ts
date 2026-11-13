/** Project settings' Storage section: the words for each workspace, the cleanup summary and what a cleanup did. */
import { describe, expect, test } from "bun:test";
import type { StorageItem } from "@kemiri/protocol";
import { cleanupNotice, cleanupSummary, storageKindLabel, storageSize, storageStateLabel } from "../src/lib/storage.ts";

function item(overrides: Partial<StorageItem> = {}): StorageItem {
	return {
		id: "worker:main/w1",
		kind: "worker",
		label: "Android build",
		path: "/data/w1",
		bytes: 2_500_000_000,
		removable: true,
		updatedAt: "2026-11-05T10:00:00.000Z",
		...overrides,
	};
}

describe("storage rows", () => {
	test("say what a workspace is and whether it is finished", () => {
		expect(storageKindLabel("worker")).toBe("Worker");
		expect(storageKindLabel("thread")).toBe("Background thread");
		expect(storageStateLabel({ removable: true })).toBe("finished");
		expect(storageStateLabel({ removable: false })).toBe("running");
		expect(storageSize(0)).toBe("empty");
		expect(storageSize(2_500_000_000)).toBe("2.5 GB");
	});
});

describe("cleanup", () => {
	test("sums the finished workspaces only", () => {
		expect(cleanupSummary([item(), item({ id: "t", removable: false }), item({ id: "w2", bytes: 500_000_000 })])).toEqual({
			count: 2,
			bytes: 3_000_000_000,
			text: "2 finished workspaces, 3 GB",
		});
		expect(cleanupSummary([item({ removable: false })]).text).toBe("Nothing finished to clean up.");
		expect(cleanupSummary([item()]).text).toBe("1 finished workspace, 2.5 GB");
	});

	test("says what it freed and why anything was kept", () => {
		expect(cleanupNotice({ removed: ["a", "b"], freedBytes: 1_200_000, refused: [] })).toEqual({
			tone: "info",
			text: "Removed 2 workspaces and freed 1.2 MB.",
		});
		expect(cleanupNotice({ removed: [], freedBytes: 0, refused: [{ id: "a", reason: "still running" }] })).toEqual({
			tone: "warning",
			text: "Nothing was removed. 1 was kept: still running.",
		});
	});
});
