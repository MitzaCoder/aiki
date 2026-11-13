/**
 * How the home page and the chat read a backend's status: the release row, the deploy banner's
 * sentences, and the per-browser dismissal of one attempt. Pure functions, tested here.
 */
import { describe, expect, test } from "bun:test";
import { deployProblem, type DeployProblem } from "@kemiri/client";
import type { DeployStatus, ReleaseInfo, ServerStatus } from "@kemiri/protocol";
import {
	DEPLOY_DISMISSALS_STORAGE_KEY,
	MAX_DISMISSED_DEPLOYS,
	addDismissedDeploy,
	deployBanner,
	isDeployDismissed,
	loadDismissedDeploys,
	parseDismissedDeploys,
	releaseView,
	saveDismissedDeploys
} from "../src/lib/server-status.ts";
import { relativeTime } from "../src/lib/relative-time.ts";

const now = Date.parse("2026-10-31T12:00:00Z");

function release(overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
	return {
		name: "20261030T113815Z-be84355",
		commit: "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e",
		description: "feat: give the harness its own SYSTEM.md and APPEND_SYSTEM.md",
		deployedAt: "2026-10-31T11:38:15Z",
		...overrides
	};
}

function deploy(overrides: Partial<DeployStatus> = {}): DeployStatus {
	return {
		state: "ok",
		commit: "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e",
		description: "feat: give the harness its own SYSTEM.md and APPEND_SYSTEM.md",
		message: null,
		at: "2026-10-31T11:39:02Z",
		...overrides
	};
}

function status(overrides: Partial<ServerStatus> = {}): ServerStatus {
	return {
		release: release(),
		deploy: deploy(),
		busy: { conversations: 0, workers: 0 },
		startedAt: "2026-10-31T11:38:20Z",
		...overrides
	};
}

function problem(overrides: Partial<DeployStatus> = {}, running: ReleaseInfo | null = release()): DeployProblem {
	const found = deployProblem(status({ deploy: deploy(overrides), release: running }));
	if (found === undefined) throw new Error("expected a deploy problem");
	return found;
}

class FakeStorage {
	readonly items = new Map<string, string>();
	getItem(key: string): string | null {
		return this.items.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.items.set(key, value);
	}
}

describe("relativeTime", () => {
	test("counts minutes, hours and days, then shows a date", () => {
		expect(relativeTime("2026-10-31T12:00:00Z", now)).toBe("just now");
		expect(relativeTime("2026-10-31T11:59:30Z", now)).toBe("just now");
		expect(relativeTime("2026-10-31T11:55:00Z", now)).toBe("5 min ago");
		expect(relativeTime("2026-10-31T09:00:00Z", now)).toBe("3 h ago");
		expect(relativeTime("2026-10-29T12:00:00Z", now)).toBe("2 d ago");
		expect(relativeTime("2026-08-01T12:00:00Z", now)).toContain("2026");
	});

	test("says so when the timestamp makes no sense", () => {
		expect(relativeTime("not a time", now)).toBe("at an unknown time");
	});
});

describe("releaseView", () => {
	test("shows the short commit, its description and how long ago it went out", () => {
		expect(releaseView(release(), now)).toEqual({
			commit: "be84355",
			description: "feat: give the harness its own SYSTEM.md and APPEND_SYSTEM.md",
			when: "22 min ago",
			title: expect.stringContaining("be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e")
		});
	});

	test("notes a newer deploy that left the backend unchanged, and nothing otherwise", () => {
		const unchanged: DeployStatus = {
			state: "ok",
			commit: "a1b2c3d4e5f6",
			description: "feat(web): a web-only change",
			message: null,
			at: "2026-10-31T11:50:00Z",
			backendUnchanged: true
		};
		expect(releaseView(release(), now, unchanged).unchanged).toBe("a1b2c3d deployed, backend unchanged since be84355");
		const { backendUnchanged: _, ...restarted } = unchanged;
		expect(releaseView(release(), now, restarted).unchanged).toBeUndefined();
		expect(releaseView(release(), now, null).unchanged).toBeUndefined();
	});
});

describe("releaseView pending", () => {
	const caughtUp: DeployStatus = {
		state: "ok",
		commit: "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e",
		description: "feat: running",
		message: null,
		at: "2026-10-31T11:50:00Z",
		pending: {
			commit: "a1b2c3d4e5f6",
			description: "feat: missed while away",
			message: "back online, deploying feat: missed while away",
			since: "2026-10-31T11:59:00Z"
		}
	};

	test("says the backend is catching up to a commit it missed", () => {
		expect(releaseView(release(), now, caughtUp).pending).toBe(
			"Catching up to a1b2c3d: back online, deploying feat: missed while away"
		);
	});

	test("says nothing without a note, or when the note is for what already runs", () => {
		const { pending: _, ...plain } = caughtUp;
		expect(releaseView(release(), now, plain).pending).toBeUndefined();
		expect(releaseView(release(), now, null).pending).toBeUndefined();
		const same = { ...caughtUp, pending: { ...caughtUp.pending!, commit: release().commit } };
		expect(releaseView(release(), now, same).pending).toBeUndefined();
	});
});

describe("deployBanner", () => {
	test("a failed deploy names the commit, its message and the release still running", () => {
		const view = deployBanner(
			problem({ state: "failed", commit: "1111111aaaa", description: "feat(web): show deploys", message: "checks failed: typecheck" }),
			now
		);
		expect(view.tone).toBe("error");
		expect(view.title).toBe("Deploy failed");
		expect(view.commit).toBe("1111111");
		expect(view.description).toBe("feat(web): show deploys");
		expect(view.detail).toBe("checks failed: typecheck");
		expect(view.note).toContain("The previous release is still running");
		expect(view.note).toContain("be84355");
	});

	test("a rolled back deploy falls back to its own explanation", () => {
		const view = deployBanner(problem({ state: "rolled_back", message: null }), now);
		expect(view.tone).toBe("warning");
		expect(view.title).toBe("Deploy rolled back");
		expect(view.detail).toContain("health check");
		expect(view.note).toContain("still running");
	});

	test("an ok deploy for another commit is flagged against the running release", () => {
		const view = deployBanner(
			problem({ commit: "2222222bbbb" }, release({ commit: "3333333cccc", description: "fix: something else" })),
			now
		);
		expect(view.tone).toBe("warning");
		expect(view.title).toBe("Release does not match the last deploy");
		expect(view.detail).toContain("2222222");
		expect(view.detail).toContain("3333333");
	});

	test("a server that runs from a checkout says no release was published", () => {
		const view = deployBanner(problem({ state: "failed", message: null }, null), now);
		expect(view.detail).toBe("The deploy failed before it published anything.");
		expect(view.note).toContain("checkout");
	});
});

describe("dismissals", () => {
	test("a dismissal belongs to one attempt, so the next deploy shows again", () => {
		const dismissed = addDismissedDeploy([], deploy());
		expect(isDeployDismissed(dismissed, deploy())).toBe(true);
		expect(isDeployDismissed(dismissed, deploy({ at: "2026-10-31T13:00:00Z" }))).toBe(false);
		expect(isDeployDismissed(dismissed, deploy({ commit: "4444444dddd" }))).toBe(false);
	});

	test("dismissing twice keeps one entry and the newest attempt is last", () => {
		const once = addDismissedDeploy([], deploy());
		const twice = addDismissedDeploy(once, deploy());
		expect(twice).toEqual(once);
		const next = addDismissedDeploy(twice, deploy({ at: "2026-10-31T13:00:00Z" }));
		expect(next.length).toBe(2);
		expect(next.at(-1)).toContain("2026-10-31T13:00:00Z");
	});

	test("only the last attempts are kept", () => {
		let keys: string[] = [];
		for (let index = 0; index < MAX_DISMISSED_DEPLOYS + 5; index += 1) {
			keys = addDismissedDeploy(keys, deploy({ at: `2026-10-31T13:00:0${index % 10}Z-${index}` }));
		}
		expect(keys.length).toBe(MAX_DISMISSED_DEPLOYS);
		expect(keys.at(-1)).toContain("-24");
	});

	test("parses what a browser could hold, dropping nonsense", () => {
		expect(parseDismissedDeploys(null)).toEqual([]);
		expect(parseDismissedDeploys("not json")).toEqual([]);
		expect(parseDismissedDeploys('{"a":1}')).toEqual([]);
		expect(parseDismissedDeploys('["a@t", 3, "", " a@t ", "b@t"]')).toEqual(["a@t", "b@t"]);
		const many = JSON.stringify(Array.from({ length: 30 }, (_, index) => `c${index}@t`));
		expect(parseDismissedDeploys(many).length).toBe(MAX_DISMISSED_DEPLOYS);
		expect(parseDismissedDeploys(many).at(-1)).toBe("c29@t");
	});

	test("round-trips through storage under its own key", () => {
		const storage = new FakeStorage();
		expect(loadDismissedDeploys(storage)).toEqual([]);
		const keys = addDismissedDeploy([], deploy());
		saveDismissedDeploys(keys, storage);
		expect(storage.getItem(DEPLOY_DISMISSALS_STORAGE_KEY)).toBe(JSON.stringify(keys));
		expect(loadDismissedDeploys(storage)).toEqual(keys);
	});

	test("works without storage at all", () => {
		expect(loadDismissedDeploys(undefined)).toEqual([]);
		expect(() => saveDismissedDeploys(["a@t"], undefined)).not.toThrow();
	});
});
