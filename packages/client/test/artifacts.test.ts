/**
 * The artifact requests, the pushed changes and the list and URL helpers, against a stub socket: their shapes are the
 * client's own contract, so they are pinned here without a server.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { Artifact, ArtifactsChangedEvent } from "@mihai-harness/protocol";
import {
	ARTIFACT_URL_MIN_REFRESH_MS,
	ARTIFACT_URL_REFRESH_MARGIN_MS,
	ClientError,
	HarnessClient,
	applyArtifactChange,
	artifactMatches,
	artifactsChangedIsFor,
	artifactUrlRefreshIn,
	artifactUrlUsable,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = { type: string; id?: string; [key: string]: unknown };

class StubSocket implements HarnessWebSocket {
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly sent: StubMessage[] = [];

	constructor(readonly answer: (message: StubMessage) => unknown) {}

	send(data: string): void {
		const message = JSON.parse(data) as StubMessage;
		this.sent.push(message);
		const response = this.answer(message);
		if (response !== undefined) this.push(response);
	}

	push(message: unknown): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}

	close(): void {
		this.onclose?.({ code: 1000, reason: "stub closed" });
	}
}

const clients: HarnessClient[] = [];

function clientFor(answer: (message: StubMessage) => unknown): { client: HarnessClient; socket: StubSocket } {
	const socket = new StubSocket((message) => {
		if (message.type === "hello") {
			return {
				type: "hello",
				id: message.id,
				protocolVersion: 1,
				server: { name: "stub", version: "0" },
				features: ["projects", "artifacts"],
			};
		}
		return answer(message);
	});
	const client = new HarnessClient({
		url: "ws://stub.invalid/ws",
		clientName: "artifacts-test",
		requestTimeoutMs: 2_000,
		reconnect: false,
		webSocketFactory: () => {
			queueMicrotask(() => socket.onopen?.());
			return socket;
		},
	});
	clients.push(client);
	return { client, socket };
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

function artifact(overrides: Partial<Artifact> = {}): Artifact {
	return {
		id: "a1",
		projectId: "project-1",
		name: "checkout-flow.webm",
		title: "Checkout flow",
		note: null,
		kind: "video",
		mimeType: "video/webm",
		size: 120_000,
		durationSeconds: 12.5,
		threadId: "main",
		workerId: "w2",
		taskId: "T3",
		sourcePath: "/work/checkout-flow.webm",
		createdAt: "2026-11-04T10:00:00.000Z",
		...overrides,
	};
}

function changed(saved: Artifact, deleted = false): ArtifactsChangedEvent {
	return { type: "artifacts.changed", projectId: saved.projectId, artifact: saved, deleted };
}

describe("artifacts.list", () => {
	it("sends only the filters given", async () => {
		const list = [artifact()];
		const { client, socket } = clientFor((message) =>
			message.type === "artifacts.list" ? { type: "artifacts.list", id: message.id, artifacts: list } : undefined,
		);
		client.connect();
		await client.whenReady();

		expect(await client.listArtifacts("project-1")).toEqual(list);
		await client.listArtifacts("project-1", { taskId: "T3", limit: 20 });
		const requests = socket.sent.filter((message) => message.type === "artifacts.list");
		expect(Object.keys(requests[0] ?? {}).sort()).toEqual(["id", "projectId", "type"]);
		expect(requests[1]).toMatchObject({ projectId: "project-1", taskId: "T3", limit: 20 });
		expect(requests[1]?.threadId).toBeUndefined();
	});
});

describe("artifacts.url", () => {
	it("answers the URL and its expiry, asking for an attachment only on request", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "artifacts.url"
				? { type: "artifacts.url", id: message.id, url: "https://b.example/a/a1?t=x", expiresAt: "2026-11-04T13:00:00.000Z" }
				: undefined,
		);
		client.connect();
		await client.whenReady();

		expect(await client.readArtifactUrl("project-1", "a1")).toEqual({
			url: "https://b.example/a/a1?t=x",
			expiresAt: "2026-11-04T13:00:00.000Z",
		});
		await client.readArtifactUrl("project-1", "a1", { download: true });
		const requests = socket.sent.filter((message) => message.type === "artifacts.url");
		expect(requests[0]?.download).toBeUndefined();
		expect(requests[1]).toMatchObject({ artifactId: "a1", download: true });
	});

	it("throws the server's error code for an unknown artifact", async () => {
		const { client } = clientFor((message) =>
			message.type === "artifacts.url"
				? { type: "error", id: message.id, error: { code: "unknown_artifact", message: "No such artifact." } }
				: undefined,
		);
		client.connect();
		await client.whenReady();

		const error = await client.readArtifactUrl("project-1", "gone").catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ClientError);
		expect((error as ClientError).code).toBe("unknown_artifact");
	});
});

describe("artifacts.delete and artifacts.changed", () => {
	it("deletes by ID and hands pushed changes to listeners", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "artifacts.delete" ? { type: "artifacts.delete", id: message.id } : undefined,
		);
		const seen: ArtifactsChangedEvent[] = [];
		client.onArtifactsChanged((event) => seen.push(event));
		client.connect();
		await client.whenReady();

		await client.deleteArtifact("project-1", "a1");
		expect(socket.sent.find((message) => message.type === "artifacts.delete")).toMatchObject({ artifactId: "a1" });
		socket.push(changed(artifact(), true));
		expect(seen).toEqual([changed(artifact(), true)]);
	});
});

describe("artifacts.update", () => {
	it("sends the tags and returns the stored row", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "artifacts.update"
				? { type: "artifacts.update", id: message.id, artifact: { ...artifact(), tags: ["web", "dark"] } }
				: undefined,
		);
		client.connect();
		await client.whenReady();
		const row = await client.updateArtifactTags("project-1", "a1", ["Web", "dark"]);
		expect(socket.sent.find((message) => message.type === "artifacts.update")).toMatchObject({
			projectId: "project-1",
			artifactId: "a1",
			tags: ["Web", "dark"],
		});
		expect(row.tags).toEqual(["web", "dark"]);
	});
});

describe("artifactMatches", () => {
	it("narrows by project, thread, worker and task together", () => {
		const saved = artifact();
		expect(artifactMatches(saved, "project-1")).toBe(true);
		expect(artifactMatches(saved, "project-2")).toBe(false);
		expect(artifactMatches(saved, "project-1", { threadId: "main", workerId: "w2" })).toBe(true);
		expect(artifactMatches(saved, "project-1", { workerId: "w3" })).toBe(false);
		expect(artifactMatches(saved, "project-1", { taskId: "T3" })).toBe(true);
		expect(artifactMatches(saved, "project-1", { taskId: "T4" })).toBe(false);
		expect(artifactsChangedIsFor(changed(saved), "project-1", { threadId: "t-jira" })).toBe(false);
	});
});

describe("applyArtifactChange", () => {
	const older = artifact({ id: "a1", createdAt: "2026-11-04T10:00:00.000Z" });
	const newer = artifact({ id: "a2", createdAt: "2026-11-04T11:00:00.000Z" });

	it("puts a saved artifact in its place, newest first", () => {
		expect(applyArtifactChange([older], changed(newer), "project-1").map((entry) => entry.id)).toEqual(["a2", "a1"]);
		const retitled = artifact({ id: "a1", title: "Renamed" });
		expect(applyArtifactChange([newer, older], changed(retitled), "project-1")).toEqual([newer, retitled]);
	});

	it("removes a deleted one and keeps the list for changes it excludes", () => {
		const list = [newer, older];
		expect(applyArtifactChange(list, changed(older, true), "project-1")).toEqual([newer]);
		expect(applyArtifactChange(list, changed(artifact({ id: "a9" }), true), "project-1")).toBe(list);
		expect(applyArtifactChange(list, changed(artifact({ id: "a3", taskId: "T9" })), "project-1", { taskId: "T3" })).toBe(list);
	});

	it("keeps the list within the limit", () => {
		const newest = artifact({ id: "a3", createdAt: "2026-11-04T12:00:00.000Z" });
		expect(applyArtifactChange([newer, older], changed(newest), "project-1", {}, 2).map((entry) => entry.id)).toEqual([
			"a3",
			"a2",
		]);
	});
});

describe("artifact URL refresh", () => {
	const now = Date.parse("2026-11-04T10:00:00.000Z");

	it("asks again a margin before expiry, never sooner than a few seconds", () => {
		expect(artifactUrlRefreshIn("2026-11-04T13:00:00.000Z", now)).toBe(3 * 3_600_000 - ARTIFACT_URL_REFRESH_MARGIN_MS);
		expect(artifactUrlRefreshIn("2026-11-04T10:01:00.000Z", now)).toBe(ARTIFACT_URL_MIN_REFRESH_MS);
		expect(artifactUrlRefreshIn("not a time", now)).toBe(ARTIFACT_URL_MIN_REFRESH_MS);
	});

	it("hands out a URL only while it has more than a minute left", () => {
		expect(artifactUrlUsable({ url: "u", expiresAt: "2026-11-04T10:05:00.000Z" }, now)).toBe(true);
		expect(artifactUrlUsable({ url: "u", expiresAt: "2026-11-04T10:00:30.000Z" }, now)).toBe(false);
		expect(artifactUrlUsable({ url: "u", expiresAt: "garbage" }, now)).toBe(false);
	});
});
