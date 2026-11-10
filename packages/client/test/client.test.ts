import { afterEach, describe, expect, it } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import type { AuthLogin, ConversationView, WorkerDefaults, WorkerSummary } from "@aiki/protocol";
import {
	ClientError,
	HarnessClient,
	activeWorkers,
	isCheckInMessage,
	isWorkerReport,
	isWorkerRunning,
	parseWorkerReport,
	workerSpawnedByCall,
	workerWorkspace,
	type BackoffOptions,
	type ConversationWatch,
} from "../src/index.ts";
import {
	FAKE_GOOD_CODE,
	FAKE_PROVIDER_ID,
	fakeOAuthProvider,
} from "../../server/test/fake-oauth-provider.ts";
import { createSetup, entryText, type TestSetup } from "../../server/test/support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: HarnessClient[] = [];
const watches: ConversationWatch[] = [];

async function setup(options?: Parameters<typeof createSetup>[0]): Promise<TestSetup> {
	const created = await createSetup(options);
	cleanups.push(created.cleanup);
	return created;
}

function clientFor(
	server: TestSetup["server"],
	options: { reconnect?: boolean | BackoffOptions } = {},
): HarnessClient {
	const client = new HarnessClient({
		url: `${server.url.replace(/^http/, "ws")}/ws`,
		clientName: "client-test",
		clientVersion: "0",
		requestTimeoutMs: 10_000,
		reconnect: options.reconnect ?? { initialDelayMs: 20, maxDelayMs: 200, jitter: 0 },
	});
	clients.push(client);
	return client;
}

async function connect(server: TestSetup["server"]): Promise<HarnessClient> {
	const client = clientFor(server);
	client.connect();
	await client.whenReady();
	return client;
}

function watchFor(client: HarnessClient, projectId: string, options?: { min?: number; max?: number }): ConversationWatch {
	const watch = client.watchConversation(projectId, { ...options, retry: { initialDelayMs: 20, maxDelayMs: 200, jitter: 0 } });
	watches.push(watch);
	return watch;
}

async function waitFor<T>(what: string, check: () => T | undefined | false, timeoutMs = 10_000): Promise<T> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const value = check();
		if (value !== undefined && value !== false) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`timed out waiting for ${what}`);
}

async function waitForWatchLive(watch: ConversationWatch): Promise<void> {
	await waitFor(`watch ${watch.projectId} to go live`, () => watch.status === "live");
}

/** Like `waitFor`, for checks that ask the server. */
async function waitForAsync<T>(
	what: string,
	check: () => Promise<T | undefined | false>,
	timeoutMs = 10_000,
): Promise<T> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const value = await check();
		if (value !== undefined && value !== false) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`timed out waiting for ${what}`);
}

function textOfEntry(entry: ConversationView["entries"][number]): string {
	return entryText(entry);
}

function messageText(message: { content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part !== "object" || part === null) return "";
			const block = part as { type?: string; text?: string };
			return block.type === "text" ? (block.text ?? "") : "";
		})
		.join("");
}

afterEach(async () => {
	for (const watch of watches.splice(0)) watch.stop();
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("client requests", () => {
	it("does the handshake, lists and adds a project, configures models and stores credentials", async () => {
		const test = await setup();
		const client = await connect(test.server);
		expect(client.state.status).toBe("ready");
		expect(client.state.server?.name).toBe("aiki");

		expect(await client.listProjects()).toEqual([]);
		const project = await client.addProject(test.projectDir);
		expect(project.path).toBe(test.projectDir);
		expect(project.coordinator.model).toBeNull();

		const configured = await client.configureProject(project.id, {
			name: "Demo",
			coordinatorModel: { provider: "faux", modelId: "faux-1" },
			coordinatorThinkingLevel: "low",
		});
		expect(configured.name).toBe("Demo");
		expect(configured.coordinator.model).toEqual({ provider: "faux", modelId: "faux-1" });
		expect(configured.coordinator.thinkingLevel).toBe("low");

		const folders = await client.listDirectory({ path: test.root });
		expect(folders.type).toBe("filesystem.list");
		expect(folders.path).toBe(test.root);
		expect(folders.home.length).toBeGreaterThan(0);
		expect(folders.entries.map((entry) => entry.name)).toContain("project");

		const catalog = await client.listModels();
		expect(catalog.models.some((model) => model.provider === "faux" && model.modelId === "faux-1")).toBe(true);
		expect(catalog.providers.some((provider) => provider.id === "faux")).toBe(true);

		expect(await client.listCredentials()).toEqual([]);
		expect(await client.setCredential("faux", "sk-client-test")).toEqual({ providerId: "faux", type: "api_key" });
		expect(await client.listCredentials()).toEqual([{ providerId: "faux", type: "api_key" }]);
		expect(await client.deleteCredential("faux")).toBe(true);
		expect(await client.deleteCredential("faux")).toBe(false);
	});

	it("rejects a bad path and an unconfigured project's submit with protocol error codes", async () => {
		const test = await setup();
		const client = await connect(test.server);

		const badPath = await client.addProject(`${test.root}/does-not-exist`).catch((error: unknown) => error);
		expect(badPath).toBeInstanceOf(ClientError);
		expect((badPath as ClientError).code).toBe("invalid_path");

		const project = await client.addProject(test.projectDir);
		const refused = await client.submit(project.id, "hello").catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(ClientError);
		expect((refused as ClientError).code).toBe("no_coordinator_model");
	});

	it("reports an unsupported protocol as fatal and does not reconnect", async () => {
		const test = await setup();
		const client = new HarnessClient({
			url: `${test.server.url.replace(/^http/, "ws")}/ws`,
			protocolVersion: 99,
			requestTimeoutMs: 5_000,
			reconnect: { initialDelayMs: 20, maxDelayMs: 50, jitter: 0 },
		});
		clients.push(client);
		client.connect();
		await waitFor("the client to close", () => client.state.status === "closed");
		expect(client.state.error).toContain("protocol version");
	});
});

describe("OAuth logins", () => {
	it("starts a login, follows its events, answers prompts and logs out", async () => {
		const fake = fakeOAuthProvider();
		const test = await setup({
			configureModels: (models) => models.setProvider(fake.provider),
			logins: { deviceId: () => "1c0e2f7a-3b46-4d4f-8f4a-2d9f9c0a1b2c", idleTimeoutMs: 0 },
		});
		const client = await connect(test.server);
		const updates: AuthLogin[] = [];
		const unsubscribe = client.onLogin((login) => updates.push(login));

		try {
			expect(await client.listLogins()).toEqual([]);
			const started = await client.startLogin(FAKE_PROVIDER_ID);
			expect(started.providerId).toBe(FAKE_PROVIDER_ID);

			const select = await waitFor("the select prompt", () =>
				updates.find((login) => login.id === started.id && login.prompt?.type === "select"),
			);
			await client.answerLogin(started.id, select.prompt!.id, "browser");

			const manual = await waitFor("the manual code prompt", () =>
				updates.find((login) => login.id === started.id && login.prompt?.type === "manual_code"),
			);
			expect(manual.events.some((event) => event.type === "auth_url")).toBe(true);
			await client.answerLogin(started.id, manual.prompt!.id, FAKE_GOOD_CODE);

			const done = await waitFor("the login to succeed", () =>
				updates.find((login) => login.id === started.id && login.status === "succeeded"),
			);
			expect(done.events.map((event) => event.type)).toContain("progress");
			expect(await client.listCredentials()).toEqual([{ providerId: FAKE_PROVIDER_ID, type: "oauth" }]);
			const provider = (await client.listModels()).providers.find((entry) => entry.id === FAKE_PROVIDER_ID);
			expect(provider?.authType).toBe("oauth");
			expect(provider?.oauth?.loginLabel).toBe("Sign in with Fake");

			expect(await client.deleteCredential(FAKE_PROVIDER_ID)).toBe(true);
			expect(await client.listCredentials()).toEqual([]);
		} finally {
			unsubscribe();
		}
	});

	it("cancels a login from the client", async () => {
		const fake = fakeOAuthProvider();
		const test = await setup({
			configureModels: (models) => models.setProvider(fake.provider),
			logins: { deviceId: () => "1c0e2f7a-3b46-4d4f-8f4a-2d9f9c0a1b2c", idleTimeoutMs: 0 },
		});
		const client = await connect(test.server);
		const updates: AuthLogin[] = [];
		const unsubscribe = client.onLogin((login) => updates.push(login));
		try {
			const started = await client.startLogin(FAKE_PROVIDER_ID);
			await waitFor("the select prompt", () =>
				updates.find((login) => login.id === started.id && login.prompt !== undefined),
			);
			expect(await client.cancelLogin(started.id)).toBe(true);
			await waitFor("the login to end", () =>
				updates.find((login) => login.id === started.id && login.status === "cancelled"),
			);
			expect(await client.cancelLogin(started.id)).toBe(false);
			expect(await client.listCredentials()).toEqual([]);
		} finally {
			unsubscribe();
		}
	});
});

describe("conversation watch", () => {
	it("ends instead of retrying when the project does not exist", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const watch = watchFor(client, "no-such-project");
		await waitFor("the watch to end", () => watch.status === "ended");
		expect(watch.error).toContain("No project");
	});

	it("answers a message from a new client instance, as after a page reload", async () => {
		const test = await setup();
		const admin = await connect(test.server);
		const project = await admin.addProject(test.projectDir);
		await admin.configureProject(project.id, { coordinatorModel: { provider: "faux", modelId: "faux-1" } });
		const watch = watchFor(admin, project.id);
		await waitForWatchLive(watch);
		test.faux.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("second answer")]);

		// Two pages that do the same thing after loading: their request IDs must not collide.
		const first = await connect(test.server);
		await first.submit(project.id, "from the first page");
		await waitFor("the first answer", () => watch.entries.find((entry) => textOfEntry(entry).includes("first answer")));
		const reloaded = await connect(test.server);
		await reloaded.submit(project.id, "from the reloaded page");
		await waitFor("the second answer", () => watch.entries.find((entry) => textOfEntry(entry).includes("second answer")));
	});

	it("streams the answer into the view and keeps the view JSON-shaped", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const project = await client.addProject(test.projectDir);
		await client.configureProject(project.id, {
			coordinatorModel: { provider: "faux", modelId: "faux-1" },
			coordinatorThinkingLevel: "low",
		});

		const watch = watchFor(client, project.id);
		await waitForWatchLive(watch);
		expect(watch.entries).toEqual([]);

		test.faux.setResponses([fauxAssistantMessage("answer from faux")]);
		await client.submit(project.id, "hello");
		const assistant = await waitFor("the assistant entry", () =>
			watch.entries.find(
				(entry) => entry.kind === "pi.assistant" && textOfEntry(entry).includes("answer from faux"),
			),
		);
		expect(assistant.id).toBeGreaterThan(0);
		expect(watch.entries.some((entry) => entry.kind === "pi.user" && textOfEntry(entry) === "hello")).toBe(true);
		expect(() => JSON.stringify(watch.view)).not.toThrow();
		expect(JSON.parse(JSON.stringify(watch.view))).toEqual(watch.view);
	});

	it("shows tool calls and their committed results", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const project = await client.addProject(test.projectDir);
		await client.configureProject(project.id, {
			coordinatorModel: { provider: "faux", modelId: "faux-1" },
			coordinatorThinkingLevel: "low",
		});

		const watch = watchFor(client, project.id);
		await waitForWatchLive(watch);
		test.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("read the readme"),
		]);
		await client.submit(project.id, "read it");
		const result = await waitFor("the tool result", () =>
			watch.entries.find((entry) => entry.kind === "pi.tool-result"),
		);
		expect(JSON.stringify(result.model)).toContain("# test project");
		await waitFor("the final answer", () =>
			watch.entries.some((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "read the readme"),
		);
	});

	it("pages older entries than the window carries", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const project = await client.addProject(test.projectDir);
		await client.configureProject(project.id, {
			coordinatorModel: { provider: "faux", modelId: "faux-1" },
			coordinatorThinkingLevel: "low",
		});

		for (const index of [1, 2, 3]) {
			test.faux.setResponses([fauxAssistantMessage(`answer ${index}`)]);
			await client.submit(project.id, `question ${index}`);
		}

		// The window starts tiny, so most of the transcript must come from paging.
		const watch = watchFor(client, project.id, { min: 1, max: 2 });
		await waitForWatchLive(watch);
		expect(watch.entries.length).toBeLessThanOrEqual(2);
		expect(watch.canLoadEarlier).toBe(true);

		for (let page = 0; page < 10 && watch.canLoadEarlier; page++) {
			const before = watch.entries.length;
			const progressed = await watch.loadEarlier(2);
			if (!progressed) break;
			expect(watch.entries.length).toBeGreaterThan(before);
		}

		const userTexts = watch.entries.filter((entry) => entry.kind === "pi.user").map(textOfEntry);
		expect(userTexts).toEqual(["question 1", "question 2", "question 3"]);
		const ids = watch.entries.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(watch.canLoadEarlier).toBe(false);
	});

	it("reconnects with backoff, reattaches with `from`, and sees what happened while away", async () => {
		const test = await setup();
		const first = clientFor(test.server, {
			reconnect: { initialDelayMs: 1_500, maxDelayMs: 1_500, jitter: 0 },
		});
		const second = await connect(test.server);
		first.connect();
		await first.whenReady();
		const project = await first.addProject(test.projectDir);
		await first.configureProject(project.id, {
			coordinatorModel: { provider: "faux", modelId: "faux-1" },
			coordinatorThinkingLevel: "low",
		});

		const watch = watchFor(first, project.id);
		const otherWatch = watchFor(second, project.id);
		await waitForWatchLive(watch);
		await waitForWatchLive(otherWatch);
		test.faux.setResponses([fauxAssistantMessage("before the drop")]);
		await first.submit(project.id, "first");
		await waitFor("the first answer", () =>
			watch.entries.some((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "before the drop"),
		);
		const lastSeen = Math.max(...watch.entries.map((entry) => entry.id));

		first.disconnect("test drop");
		await waitFor("the client to start reconnecting", () => first.state.status === "reconnecting");

		// Another device submits while the first client is away.
		test.faux.setResponses([fauxAssistantMessage("while away")]);
		await second.submit(project.id, "while away");
		await waitFor("the second client's answer", () =>
			otherWatch.entries.some((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "while away"),
		);

		await waitFor("the client to reconnect and the watch to reattach", () => first.state.status === "ready" && watch.status === "live", 15_000);
		const answerWhileAway = await waitFor("the missed answer", () =>
			watch.entries.find((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "while away"),
		);
		expect(answerWhileAway.id).toBeGreaterThan(lastSeen);
		expect(watch.entries.some((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "before the drop")).toBe(true);
		const ids = watch.entries.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);

		test.faux.setResponses([fauxAssistantMessage("after the drop")]);
		await first.submit(project.id, "after");
		await waitFor("the post-reconnect answer", () =>
			watch.entries.some((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "after the drop"),
		);
	});

	it("keeps a local view across a server restart and reattaches to the new process", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const project = await client.addProject(test.projectDir);
		await client.configureProject(project.id, {
			coordinatorModel: { provider: "faux", modelId: "faux-1" },
			coordinatorThinkingLevel: "low",
		});

		const watch = watchFor(client, project.id);
		await waitForWatchLive(watch);
		test.faux.setResponses([fauxAssistantMessage("survives")]);
		await client.submit(project.id, "restart test");
		await waitFor("the answer before restart", () =>
			watch.entries.some((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "survives"),
		);

		const port = test.server.port;
		await test.server.stop();
		const { startServer } = await import("../../server/src/server.ts");
		const restarted = await startServer({
			dataDir: test.dataDir,
			port,
			models: test.models,
			credentials: test.credentials,
			images: null,
			log: () => undefined,
		});
		try {
			await waitFor("reattaching after the restart", () => client.state.status === "ready" && watch.status === "live", 15_000);
			expect(watch.entries.some((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "survives")).toBe(true);
			test.faux.setResponses([fauxAssistantMessage("after restart")]);
			await client.submit(project.id, "again");
			await waitFor("the answer after restart", () =>
				watch.entries.some((entry) => entry.kind === "pi.assistant" && textOfEntry(entry) === "after restart"),
			);
		} finally {
			await restarted.stop();
		}
	});
});

describe("workers", () => {
	it("lists a project's workers, pushes their changes, and watches a worker's conversation read-only", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const project = await client.addProject(test.projectDir);
		await client.configureProject(project.id, {
			coordinatorModel: { provider: "faux", modelId: "faux-1" },
			coordinatorThinkingLevel: "low",
			workerModels: [{ provider: "faux", modelId: "faux-1" }],
		});

		const pushed: { workers: WorkerSummary[]; defaults: WorkerDefaults }[] = [];
		const stop = client.onWorkersState((state) => {
			if (state.projectId === project.id) pushed.push({ workers: state.workers, defaults: state.defaults });
		});
		cleanups.push(async () => stop());

		expect(await client.listWorkers(project.id)).toEqual({
			workers: [],
			defaults: { model: null, thinkingLevel: null },
		});

		const brief = "Summarize the project's README for me.";
		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				const last = request.messages.findLast((message) => message.role !== "system");
				const text = messageText(last ?? {});
				if (text.includes(brief)) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
				if (last?.role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text.includes("Delegate the reading")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: brief, title: "Read the README" })], {
						stopReason: "toolUse",
					});
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);

		await client.submit(project.id, "Delegate the reading.");
		const listed = await waitForAsync("the worker to appear", async () => {
			const snapshot = await client.listWorkers(project.id);
			return snapshot.workers.length > 0 ? snapshot : undefined;
		});
		const worker = listed.workers[0]!;
		expect(worker.id).toBe("reader");
		expect(worker.title).toBe("Read the README");
		expect(worker.isolation).toBe("shared");
		expect(workerSpawnedByCall(await client.listWorkers(project.id).then((state) => state.workers), "no-such-call")).toBeUndefined();

		// The pushed list replaces what a consumer holds.
		await waitFor("a pushed worker list", () => pushed.length > 0);
		expect(pushed.at(-1)?.workers[0]?.id).toBe("reader");

		// A worker's conversation is watchable and pageable like the coordinator's, but never drivable.
		const watch = client.watchWorkerConversation(project.id, worker.id, {
			retry: { initialDelayMs: 20, maxDelayMs: 200, jitter: 0 },
		});
		watches.push(watch);
		await waitForWatchLive(watch);
		expect(watch.workerId).toBe(worker.id);
		await waitFor("the worker's own transcript", () =>
			watch.entries.some((entry) => entry.kind === "pi.user" && textOfEntry(entry) === brief),
		);
		expect(watch.view?.conversation.id).toBe(worker.conversationId);

		const page = await client.page(project.id, { workerId: worker.id, order: "ascending" });
		expect(page.entries.some((entry) => entry.conversationId === worker.conversationId)).toBe(true);

		const spawner = workerSpawnedByCall(listed.workers, worker.spawnedByCallId ?? "");
		expect(spawner?.id).toBe(worker.id);
		expect(activeWorkers(listed.workers).map((each) => each.id)).toEqual(["reader"]);
		expect(isWorkerRunning(worker.status) || worker.status === "idle").toBe(true);
		expect(workerWorkspace(worker)).toBeUndefined();
	});

	it("records the worker model picked with a message", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const project = await client.addProject(test.projectDir);
		await client.configureProject(project.id, {
			coordinatorModel: { provider: "faux", modelId: "faux-1" },
			coordinatorThinkingLevel: "low",
		});
		test.faux.setResponses([fauxAssistantMessage("noted")]);
		await client.submit(project.id, "hello", {
			workerModel: { provider: "faux", modelId: "faux-1" },
			workerThinkingLevel: "high",
		});
		const listed = await waitForAsync("the picked worker model", async () => {
			const snapshot = await client.listWorkers(project.id);
			return snapshot.defaults.model === null ? undefined : snapshot;
		});
		expect(listed.defaults).toEqual({ model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: "high" });
	});

	it("configures worker check-ins and recognises the harness' own transcript inputs", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const project = await client.addProject(test.projectDir);
		// The defaults: on, every ten minutes.
		expect(project.checkIns).toEqual({ enabled: true, intervalMinutes: 10 });

		const configured = await client.configureProject(project.id, {
			checkIns: { enabled: false, intervalMinutes: 45 },
		});
		expect(configured.checkIns).toEqual({ enabled: false, intervalMinutes: 45 });
		const reset = await client.configureProject(project.id, { checkIns: null });
		expect(reset.checkIns).toEqual({ enabled: true, intervalMinutes: 10 });

		expect(isCheckInMessage("[check-in]\n1 worker is still running.")).toBe(true);
		expect(isCheckInMessage("[worker reader reported]\n## Report")).toBe(false);
		expect(isWorkerReport("[worker reader reported]\n## Report")).toBe(true);
		expect(parseWorkerReport("[worker reader reported]\n## Report\nOutcome: done")).toEqual({
			workerId: "reader",
			body: "## Report\nOutcome: done",
		});
		expect(parseWorkerReport("hello there")).toBeUndefined();
	});
});
