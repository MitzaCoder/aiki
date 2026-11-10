import { afterEach, describe, expect, it } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
	HARNESS_FEATURES,
	type DeployStatus,
	type ModelRef,
	type ReleaseInfo,
	type ServerStatus,
	type ServerStatusEvent,
} from "@aiki/protocol";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import {
	DEPLOY_STATUS_FILE_ENV,
	ServerStatusService,
	findPackageRoot,
	readDeployStatus,
	readRelease,
	resolveDeployStatusFile,
	resolveReleaseRoot,
	type BusyState,
} from "../src/server-status.ts";
import { createSetup, TestClient, ViewClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const BRIEF = "Read the README for me.";

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "aiki-status-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

async function setup(options?: Parameters<typeof createSetup>[0]): Promise<TestSetup> {
	const created = await createSetup(options);
	cleanups.push(created.cleanup);
	return created;
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	return client;
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

/** What a deploy does: write a temp file in the deploy root, then rename it over the status file. */
async function writeDeployStatusAtomically(file: string, value: unknown): Promise<void> {
	const temporary = `${file}.tmp`;
	await writeFile(temporary, JSON.stringify(value));
	await rename(temporary, file);
}

const RELEASE: ReleaseInfo = {
	name: "20261030T113815Z-be84355",
	commit: "be84355d3f7b1d7d3f7b1d7d3f7b1d7d3f7b1d7d",
	description: "feat(server): report release, deploy outcome and busy state",
	deployedAt: "2026-10-30T11:38:20Z",
};

const DEPLOY: DeployStatus = {
	state: "ok",
	commit: "be84355d3f7b1d7d3f7b1d7d3f7b1d7d3f7b1d7d",
	description: "feat(server): report release, deploy outcome and busy state",
	message: null,
	at: "2026-10-30T11:39:02Z",
};

describe("release and deploy files", () => {
	it("finds the root package.json from a module's directory, not the cwd", async () => {
		const root = await tempDir();
		const deep = join(root, "packages", "server", "src");
		await mkdir(deep, { recursive: true });
		await writeFile(join(root, "package.json"), JSON.stringify({ name: "aiki", workspaces: ["packages/*"] }));
		await writeFile(join(root, "packages", "server", "package.json"), JSON.stringify({ name: "@aiki/server" }));

		expect(findPackageRoot(deep)).toBe(root);
		expect(findPackageRoot(root)).toBe(root);
	});

	it("prefers the workspace root over a stray package.json above it, and otherwise takes the nearest", async () => {
		const root = await tempDir();
		// A stray manifest in a home-like ancestor must not become the release root.
		await writeFile(join(root, "package.json"), JSON.stringify({ name: "junk from some other project" }));
		const repo = join(root, "example-project");
		const deep = join(repo, "packages", "server", "src");
		await mkdir(deep, { recursive: true });
		await writeFile(join(repo, "package.json"), JSON.stringify({ name: "aiki", workspaces: ["packages/*"] }));
		await writeFile(join(repo, "packages", "server", "package.json"), JSON.stringify({ name: "@aiki/server" }));
		expect(findPackageRoot(deep)).toBe(repo);

		// Nothing declares workspaces: the nearest manifest is the best answer, still not the stray one.
		await writeFile(join(repo, "package.json"), JSON.stringify({ name: "single-package-repo" }));
		expect(findPackageRoot(deep)).toBe(join(repo, "packages", "server"));
	});

	it("resolves this checkout as the release root when it runs from source", () => {
		const root = resolveReleaseRoot();
		// The workspace root this test file lives under: two directories above `packages/server/src`.
		expect(root).toBe(join(import.meta.dir, "..", "..", ".."));
	});

	it("reads a valid RELEASE.json and tolerates a missing name", async () => {
		const root = await tempDir();
		await writeFile(join(root, "RELEASE.json"), JSON.stringify(RELEASE));
		expect(await readRelease(root)).toEqual(RELEASE);

		const unnamed = { ...RELEASE } as Record<string, unknown>;
		delete unnamed.name;
		await writeFile(join(root, "RELEASE.json"), JSON.stringify(unnamed));
		expect(await readRelease(root)).toEqual({ ...RELEASE, name: root.split("/").at(-1) ?? "" });
	});

	it("reports no release for a checkout, a corrupt file or one that does not describe a release", async () => {
		const root = await tempDir();
		expect(await readRelease(root)).toBeNull();

		await writeFile(join(root, "RELEASE.json"), "{not json");
		expect(await readRelease(root)).toBeNull();

		await writeFile(join(root, "RELEASE.json"), JSON.stringify([RELEASE]));
		expect(await readRelease(root)).toBeNull();

		await writeFile(join(root, "RELEASE.json"), JSON.stringify({ ...RELEASE, commit: 7 }));
		expect(await readRelease(root)).toBeNull();
	});

	it("finds the deploy status one level above releases/, whether or not current is a symlink", async () => {
		const root = await tempDir();
		const release = join(root, "releases", "20261030T113815Z-be84355");
		await mkdir(release, { recursive: true });
		await writeFile(join(root, "deploy-status.json"), JSON.stringify(DEPLOY));
		await symlink(join("releases", "20261030T113815Z-be84355"), join(root, "current"));

		expect(resolveDeployStatusFile(release, {})).toBe(join(root, "deploy-status.json"));
		expect(resolveDeployStatusFile(join(root, "current"), {})).toBe(join(root, "deploy-status.json"));

		// Any other layout, such as a checkout, has no deploy status at all.
		expect(resolveDeployStatusFile(join(root, "release"), {})).toBeNull();
	});

	it("lets AIKI_DEPLOY_STATUS_FILE name the file, expanding ~", () => {
		const root = "/home/someone/.local/share/aiki-deploy/releases/20261030T113815Z-be84355";
		expect(resolveDeployStatusFile(root, { [DEPLOY_STATUS_FILE_ENV]: "/run/status.json" })).toBe("/run/status.json");
		expect(resolveDeployStatusFile(root, { [DEPLOY_STATUS_FILE_ENV]: "~/deploy-status.json" })).toBe(
			join(process.env["HOME"] ?? "/home/someone", "deploy-status.json"),
		);
	});

	it("reads a valid deploy status and rejects anything else instead of crashing", async () => {
		const root = await tempDir();
		const file = join(root, "deploy-status.json");
		await writeFile(file, JSON.stringify(DEPLOY));
		expect(await readDeployStatus(file)).toEqual(DEPLOY);

		await writeFile(
			file,
			JSON.stringify({ ...DEPLOY, state: "rolled_back", message: "health check failed" }),
		);
		expect(await readDeployStatus(file)).toEqual({ ...DEPLOY, state: "rolled_back", message: "health check failed" });

		await writeFile(file, JSON.stringify({ ...DEPLOY, state: "exploded" }));
		expect(await readDeployStatus(file)).toBeNull();

		await writeFile(file, JSON.stringify({ ...DEPLOY, commit: "" }));
		expect(await readDeployStatus(file)).toBeNull();

		await writeFile(file, "{]");
		expect(await readDeployStatus(file)).toBeNull();

		expect(await readDeployStatus(join(root, "absent.json"))).toBeNull();
		expect(await readDeployStatus(null)).toBeNull();
	});

	it("passes backendUnchanged through on an ok attempt only", async () => {
		const root = await tempDir();
		const file = join(root, "deploy-status.json");
		await writeFile(file, JSON.stringify({ ...DEPLOY, state: "ok", backendUnchanged: true }));
		expect(await readDeployStatus(file)).toEqual({ ...DEPLOY, state: "ok", backendUnchanged: true });

		await writeFile(file, JSON.stringify({ ...DEPLOY, state: "ok", backendUnchanged: "yes" }));
		expect(await readDeployStatus(file)).toEqual({ ...DEPLOY, state: "ok" });

		await writeFile(file, JSON.stringify({ ...DEPLOY, state: "failed", message: "x", backendUnchanged: true }));
		expect(await readDeployStatus(file)).toEqual({ ...DEPLOY, state: "failed", message: "x" });
	});
});

describe("deploy status pending note", () => {
	it("passes a catch-up note through, with its text, and drops a malformed one", async () => {
		const root = await tempDir();
		const file = join(root, "deploy-status.json");
		const pending = { commit: "a1b2c3d4e5f6", description: "feat: new", message: "back online", since: "2026-11-08T01:00:00Z" };
		await writeFile(file, JSON.stringify({ ...DEPLOY, state: "ok", pending }));
		expect(await readDeployStatus(file)).toEqual({ ...DEPLOY, state: "ok", pending });

		await writeFile(file, JSON.stringify({ ...DEPLOY, state: "ok", pending: { commit: "", since: "x" } }));
		expect(await readDeployStatus(file)).toEqual({ ...DEPLOY, state: "ok" });
		await writeFile(file, JSON.stringify({ ...DEPLOY, state: "ok", pending: "soon" }));
		expect(await readDeployStatus(file)).toEqual({ ...DEPLOY, state: "ok" });
	});
});

describe("server status service", () => {
	type Harness = {
		service: ServerStatusService;
		pushed: ServerStatus[];
		busyCalls: () => number;
		stop(): void;
	};

	async function service(root: string): Promise<Harness> {
		const pushed: ServerStatus[] = [];
		const busy: BusyState = { conversations: 1, workers: 2 };
		let calls = 0;
		const status = await ServerStatusService.create({
			busy: async () => {
				calls += 1;
				return busy;
			},
			releaseRoot: root,
			deployStatusFile: join(root, "deploy-status.json"),
			onChange: (value) => pushed.push(value),
			log: () => undefined,
		});
		return { service: status, pushed, busyCalls: () => calls, stop: () => status.stop() };
	}

	it("reads the release at start and reports the busy state on demand", async () => {
		const root = await tempDir();
		await writeFile(join(root, "RELEASE.json"), JSON.stringify(RELEASE));
		await writeFile(join(root, "deploy-status.json"), JSON.stringify(DEPLOY));
		const harness = await service(root);
		try {
			// Nothing has changed since start, so nothing was pushed, and `busy` is only asked for by a status.
			expect(harness.pushed).toEqual([]);
			expect(harness.busyCalls()).toBe(0);
			const status = await harness.service.status();
			expect(status.release).toEqual(RELEASE);
			expect(status.deploy).toEqual(DEPLOY);
			expect(status.busy).toEqual({ conversations: 1, workers: 2 });
			expect(Number.isNaN(Date.parse(status.startedAt))).toBe(false);
		} finally {
			harness.stop();
		}
	});

	it("pushes a changed deploy status, including the deploy that rolled back, and stops at an invalid file", async () => {
		const root = await tempDir();
		await writeFile(join(root, "RELEASE.json"), JSON.stringify(RELEASE));
		const harness = await service(root);
		try {
			expect(harness.pushed).toEqual([]);

			await writeDeployStatusAtomically(join(root, "deploy-status.json"), DEPLOY);
			await until(() => harness.pushed.length === 1);
			expect(harness.pushed[0]?.deploy).toEqual(DEPLOY);
			expect(harness.pushed[0]?.release).toEqual(RELEASE);

			// The deploy rewrites the same outcome: no release or deploy change, so no push.
			await writeDeployStatusAtomically(join(root, "deploy-status.json"), DEPLOY);
			await harness.service.refresh();
			expect(harness.pushed).toHaveLength(1);

			const rolledBack: DeployStatus = { ...DEPLOY, state: "rolled_back", message: "health check failed" };
			await writeDeployStatusAtomically(join(root, "deploy-status.json"), rolledBack);
			await until(() => harness.pushed.length === 2);
			expect(harness.pushed[1]?.deploy).toEqual(rolledBack);

			// A deploy that wrote garbage leaves no status, which is a change from the one it replaced.
			await writeFile(join(root, "deploy-status.json"), "{]");
			await until(() => harness.pushed.length === 3);
			expect(harness.pushed[2]?.deploy).toBeNull();
		} finally {
			harness.stop();
		}
	});

	it("keeps working when the deploy root does not exist yet", async () => {
		const root = await tempDir();
		const deploy = join(root, "not-yet");
		const pushed: ServerStatus[] = [];
		const status = await ServerStatusService.create({
			busy: async () => ({ conversations: 0, workers: 0 }),
			releaseRoot: root,
			deployStatusFile: join(deploy, "deploy-status.json"),
			onChange: (value) => pushed.push(value),
			log: () => undefined,
		});
		try {
			await status.refresh();
			expect(pushed).toEqual([]);
			await mkdir(deploy, { recursive: true });
			await writeDeployStatusAtomically(join(deploy, "deploy-status.json"), DEPLOY);
			// The poll attaches the watcher when the directory appears; here the deploy is read on demand instead.
			await status.refresh();
			expect(pushed.map((value) => value.deploy)).toEqual([DEPLOY]);
		} finally {
			status.stop();
		}
	});
});

describe("server.status over the protocol", () => {
	function hasToolCall(request: TranscriptContext, name: string): boolean {
		return request.messages.some(
			(message) =>
				Array.isArray(message.content) &&
				(message.content as { type?: string; name?: string }[]).some(
					(block) => block.type === "toolCall" && block.name === name,
				),
		);
	}

	it("answers with the release, the deploy outcome and an idle count, and advertises the feature", async () => {
		const releases = await tempDir();
		await writeFile(join(releases, "RELEASE.json"), JSON.stringify(RELEASE));
		await writeFile(join(releases, "deploy-status.json"), JSON.stringify(DEPLOY));
		const test = await setup({
			status: { releaseRoot: releases, deployStatusFile: join(releases, "deploy-status.json") },
		});
		const client = await connect(test.server);
		const hello = await client.hello();
		if (hello.type !== "hello") throw new Error(JSON.stringify(hello));
		expect(hello.features).toContain("server-status");
		expect(HARNESS_FEATURES).toContain("server-status");

		const response = await client.request({ type: "server.status" });
		if (response.type !== "server.status") throw new Error(JSON.stringify(response));
		expect(response.status.release).toEqual(RELEASE);
		expect(response.status.deploy).toEqual(DEPLOY);
		expect(response.status.busy).toEqual({ conversations: 0, workers: 0, toolCalls: 0 });
		expect(Number.isNaN(Date.parse(response.status.startedAt))).toBe(false);
	});

	it("pushes a deploy outcome change to every connection", async () => {
		const releases = await tempDir();
		await writeFile(join(releases, "RELEASE.json"), JSON.stringify(RELEASE));
		const test = await setup({
			status: { releaseRoot: releases, deployStatusFile: join(releases, "deploy-status.json") },
		});
		const first = await connect(test.server);
		const second = await connect(test.server);
		await first.hello();
		await second.hello();

		const failed: DeployStatus = { ...DEPLOY, state: "failed", message: "bun test failed" };
		await writeDeployStatusAtomically(join(releases, "deploy-status.json"), failed);

		const event = (await first.waitFor((message) => message.type === "server.status.changed")) as ServerStatusEvent;
		expect(event.status.deploy).toEqual(failed);
		expect(event.status.release).toEqual(RELEASE);
		const other = (await second.waitFor((message) => message.type === "server.status.changed")) as ServerStatusEvent;
		expect(other.status.deploy).toEqual(failed);
	});

	it(
		"counts a coordinator run and a running worker, and reports idle once both finish",
		async () => {
			const test = await setup();
			const client = await connect(test.server);
			await client.hello();
			const added = await client.request({ type: "projects.add", path: test.projectDir });
			if (added.type !== "projects.add") throw new Error(JSON.stringify(added));
			const projectId = added.project.id;
			await client.request({
				type: "projects.configure",
				projectId,
				coordinatorModel: FAUX,
				coordinatorThinkingLevel: "low",
				workerModels: [FAUX],
			});

			// Both the coordinator's turn and the worker's stay in flight until the gate opens.
			const gate = Promise.withResolvers<void>();
			const route = async (request: TranscriptContext, options: { signal?: AbortSignal } | undefined) => {
				const messages = request.messages.filter((message) => message.role !== "system");
				const last = messages.at(-1);
				const text = typeof last?.content === "string" ? last.content : "";
				const held = (): Promise<void> =>
					new Promise<void>((resolve) => {
						options?.signal?.addEventListener("abort", () => resolve(), { once: true });
						void gate.promise.then(() => resolve());
					});
				if (last?.role === "toolResult" && hasToolCall(request, "read")) {
					await held();
					return fauxAssistantMessage("## Report\nOutcome: done");
				}
				if (last?.role === "toolResult") {
					await held();
					return fauxAssistantMessage("Tool call finished.");
				}
				if (text === BRIEF) {
					return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
				}
				if (text.includes("Delegate the reading")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
						stopReason: "toolUse",
					});
				}
				await held();
				return fauxAssistantMessage("Report reviewed.");
			};
			test.faux.setResponses(Array.from({ length: 40 }, () => route));

			const view = new ViewClient(client);
			await view.start(projectId);
			await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
			await until(async () => {
				const workers = await client.request({ type: "workers.list", projectId });
				return workers.type === "workers.list" && workers.workers.some((worker) => worker.status === "running");
			});

			const busy = await client.request({ type: "server.status" });
			if (busy.type !== "server.status") throw new Error(JSON.stringify(busy));
			// toolCalls depends on when the worker's read runs; drain.test.ts covers it.
			expect(busy.status.busy).toMatchObject({ conversations: 1, workers: 1 });

			gate.resolve();
			await until(async () => {
				const status = await client.request({ type: "server.status" });
				return status.type === "server.status" && status.status.busy.workers === 0;
			}, 30_000);
			const after = await client.request({ type: "server.status" });
			if (after.type !== "server.status") throw new Error(JSON.stringify(after));
			expect(after.status.busy).toEqual({ conversations: 0, workers: 0, toolCalls: 0 });
		},
		60_000,
	);
});
