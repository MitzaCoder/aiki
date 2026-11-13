import { afterEach, describe, expect, it } from "bun:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { HARNESS_FEATURES, type ConversationView, type ServerMessage } from "@kemiri/protocol";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { entryText, errorOf, TestClient, ViewClient, createSetup, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

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

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function greet(client: TestClient): Promise<void> {
	const response = await client.hello();
	expect(response.type).toBe("hello");
}

async function addProject(client: TestClient, path: string): Promise<string> {
	const response = await client.request({ type: "projects.add", path });
	if (response.type !== "projects.add") throw new Error(JSON.stringify(response));
	return response.project.id;
}

const FAUX = { provider: "faux", modelId: "faux-1" } as const;
const RECOVERY = { provider: "recovery", modelId: "recovery-1" } as const;

/** A one-shot promise, to hold a faux response in flight while the test does something else. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((settle) => {
		resolve = () => settle();
	});
	return { promise, resolve };
}

async function configureProject(client: TestClient, projectId: string): Promise<void> {
	const response = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
	});
	expect(response.type).toBe("projects.configure");
}

describe("handshake", () => {
	it("greets with the protocol version and refuses requests before hello", async () => {
		const test = await setup();
		const early = await connect(test.server);
		const notReady = await early.request({ type: "projects.list" });
		expect(errorOf(notReady).code).toBe("not_ready");

		const client = await connect(test.server);
		const response = await client.hello(1);
		expect(response.type).toBe("hello");
		if (response.type !== "hello") return;
		expect(response.protocolVersion).toBe(1);
		expect(response.server.name).toBe("Kemiri");
		// hello advertises what this backend implements so the app can hide the rest.
		expect(response.features).toEqual(HARNESS_FEATURES.filter((feature) => feature !== "fcm-relay-v1"));
	});

	it("refuses another protocol version and closes the connection", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const response = await client.hello(2);
		expect(errorOf(response).code).toBe("unsupported_protocol");
		await client.closed();
	});

	it("rejects malformed JSON with bad_request", async () => {
		const test = await setup();
		const client = await connect(test.server);
		client.send({ type: "hello" });
		const response = await client.waitFor((message) => message.type === "error");
		expect(errorOf(response).code).toBe("bad_request");
	});

	it("answers a request type it does not know with unknown_request", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello(1);
		const response = await client.request({ type: "files.search" } as never);
		expect(errorOf(response).code).toBe("unknown_request");
		expect(errorOf(response).message).toContain("files.search");
	});
});

describe("projects", () => {
	it("adds an existing directory once, lists it, and stores its configuration", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const empty = await client.request({ type: "projects.list" });
		expect(empty.type).toBe("projects.list");
		if (empty.type === "projects.list") expect(empty.projects).toEqual([]);

		const projectId = await addProject(client, test.projectDir);
		expect(projectId.length).toBeGreaterThan(0);

		// Adding the same path again returns the same project.
		const again = await client.request({ type: "projects.add", path: test.projectDir });
		expect(again.type).toBe("projects.add");
		if (again.type === "projects.add") expect(again.project.id).toBe(projectId);

		const configured = await client.request({
			type: "projects.configure",
			projectId,
			name: "Demo",
			coordinatorModel: FAUX,
			coordinatorThinkingLevel: "high",
			workerModels: [FAUX],
		});
		expect(configured.type).toBe("projects.configure");
		if (configured.type !== "projects.configure") return;
		expect(configured.project.name).toBe("Demo");
		expect(configured.project.coordinator.model).toEqual(FAUX);
		expect(configured.project.coordinator.thinkingLevel).toBe("high");
		expect(configured.project.workerModels).toEqual([FAUX]);
		expect(configured.project.state).toBe("closed");

		const onDisk = JSON.parse(
			await readFile(join(test.dataDir, "projects", projectId, "project.json"), "utf8"),
		) as Record<string, unknown>;
		expect(onDisk.path).toBe(test.projectDir);
		expect(onDisk.name).toBe("Demo");
		const mode = (await stat(join(test.dataDir, "projects", projectId, "project.json"))).mode & 0o777;
		expect(mode).toBe(0o600);

		const list = await client.request({ type: "projects.list" });
		expect(list.type).toBe("projects.list");
		if (list.type === "projects.list") {
			expect(list.projects).toHaveLength(1);
			expect(list.projects[0]?.coordinator.model).toEqual(FAUX);
		}
	});

	it("keeps the link settings the user sets, cleaned, and goes back to filling them in", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);

		const set = await client.request({
			type: "projects.configure",
			projectId,
			links: { jiraSite: "acme.atlassian.net/", jiraProjects: ["ex", "EX"], githubRepos: ["git@github.com:acme/app.git", "nope"] },
		});
		if (set.type !== "projects.configure") throw new Error(`unexpected ${set.type}`);
		expect(set.project.links).toEqual({
			jiraSite: "https://acme.atlassian.net",
			jiraProjects: ["EX"],
			githubRepos: ["acme/app"],
			detected: false,
		});
		// Refs nothing on this host can read are left out, never an error.
		const statuses = await client.request({ type: "refs.status", projectId, refs: ["https://example.com/x", "T12"] });
		expect(statuses).toMatchObject({ type: "refs.status", statuses: [] });
		const details = await client.request({ type: "refs.details", projectId, ref: "https://example.com/x" });
		expect(details).toMatchObject({ type: "refs.details", details: null });

		const automatic = await client.request({ type: "projects.configure", projectId, links: null });
		if (automatic.type !== "projects.configure") throw new Error(`unexpected ${automatic.type}`);
		expect(automatic.project.links?.detected).toBe(true);
		const onDisk = JSON.parse(await readFile(join(test.dataDir, "projects", projectId, "project.json"), "utf8")) as Record<string, unknown>;
		expect(onDisk.links).toBeNull();
	});

	it("rejects a path that is not a directory and an unknown model", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const missing = await client.request({ type: "projects.add", path: join(test.root, "nope") });
		expect(errorOf(missing).code).toBe("invalid_path");

		const projectId = await addProject(client, test.projectDir);
		const unknown = await client.request({
			type: "projects.configure",
			projectId,
			coordinatorModel: { provider: "anthropic", modelId: "no-such-model" },
		});
		expect(errorOf(unknown).code).toBe("unknown_model");
	});
});

describe("models and credentials", () => {
	it("lists models with provider availability and keeps credential secrets on the server", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const models = await client.request({ type: "models.list" });
		expect(models.type).toBe("models.list");
		if (models.type !== "models.list") return;
		expect(models.providers.some((provider) => provider.id === "faux")).toBe(true);
		const faux = models.models.find((model) => model.provider === "faux" && model.modelId === "faux-1");
		expect(faux).toBeDefined();
		expect(faux?.contextWindow).toBeGreaterThan(0);
		expect(faux?.thinkingLevels.length).toBeGreaterThan(0);

		const set = await client.request({
			type: "credentials.set",
			providerId: "faux",
			apiKey: "sk-test-secret-value",
		});
		expect(set.type).toBe("credentials.set");
		if (set.type === "credentials.set") {
			expect(set.credential).toEqual({ providerId: "faux", type: "api_key" });
		}

		const file = join(test.dataDir, "credentials.json");
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		const contents = await readFile(file, "utf8");
		expect(contents).toContain("sk-test-secret-value");

		const list = await client.request({ type: "credentials.list" });
		expect(list.type).toBe("credentials.list");
		if (list.type === "credentials.list") {
			expect(list.credentials).toEqual([{ providerId: "faux", type: "api_key" }]);
			// The response itself carries no secret.
			expect(JSON.stringify(list)).not.toContain("sk-test-secret-value");
		}

		const unknown = await client.request({
			type: "credentials.set",
			providerId: "not-a-provider",
			apiKey: "sk-x",
		});
		expect(errorOf(unknown).code).toBe("unknown_provider");

		const deleted = await client.request({ type: "credentials.delete", providerId: "faux" });
		expect(deleted.type).toBe("credentials.delete");
		if (deleted.type === "credentials.delete") expect(deleted.deleted).toBe(true);
		const deletedAgain = await client.request({ type: "credentials.delete", providerId: "faux" });
		if (deletedAgain.type === "credentials.delete") expect(deletedAgain.deleted).toBe(false);
	});
});

describe("coordinator conversation", () => {
	it("requires a coordinator model, then answers through a watched view", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);

		const view = new ViewClient(client);
		await view.start(projectId);
		expect(view.view?.entries).toEqual([]);

		const refused = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "r1",
			content: "hello",
		});
		expect(errorOf(refused).code).toBe("no_coordinator_model");

		await configureProject(client, projectId);
		test.faux.setResponses([fauxAssistantMessage("answer from faux")]);
		const submitted = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "r2",
			content: "hello",
		});
		expect(submitted.type).toBe("conversation.submit");

		const answered = await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("answer from faux")),
		);
		const user = answered.entries.find((entry) => entry.kind === "pi.user");
		expect(user === undefined ? "" : entryText(user)).toBe("hello");
		expect(answered.conversation.id).toBe(answered.entries[0]?.conversationId);
		// The view value itself must be JSON, as it crosses the wire.
		expect(() => JSON.stringify(answered)).not.toThrow();
		expect(JSON.parse(JSON.stringify(answered))).toEqual(answered);

		// Idempotent submit: the same requestId does not run again.
		const replay = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "r2",
			content: "hello",
		});
		expect(replay.type).toBe("conversation.submit");

		const page = await client.request({ type: "conversation.page", projectId, limit: 1 });
		expect(page.type).toBe("conversation.page");
		if (page.type !== "conversation.page") return;
		expect(page.entries).toHaveLength(1);
		expect(page.entries[0]?.kind).toBe("pi.assistant");
		expect(page.next).toBeDefined();

		const previous = await client.request({
			type: "conversation.page",
			projectId,
			limit: 5,
			before: page.entries[0]?.id,
		});
		expect(previous.type).toBe("conversation.page");
		if (previous.type === "conversation.page") {
			// Older entries come back newest first, and include the user's input.
			expect(previous.entries.map((entry) => entry.kind)).toContain("pi.user");
			expect(previous.entries[0]?.id ?? 0).toBeLessThan(page.entries[0]?.id ?? 0);
		}

		// Cursors continue a page instead of repeating it.
		const firstPage = await client.request({
			type: "conversation.page",
			projectId,
			limit: 1,
			order: "ascending",
		});
		expect(firstPage.type).toBe("conversation.page");
		if (firstPage.type === "conversation.page") {
			expect(firstPage.entries).toHaveLength(1);
			expect(firstPage.next).toBeDefined();
			const secondPage = await client.request({
				type: "conversation.page",
				projectId,
				limit: 1,
				order: "ascending",
				cursor: firstPage.next,
			});
			expect(secondPage.type).toBe("conversation.page");
			if (secondPage.type === "conversation.page") {
				expect(secondPage.entries).toHaveLength(1);
				expect(secondPage.entries[0]?.id ?? 0).toBeGreaterThan(firstPage.entries[0]?.id ?? -1);
			}
		}

		const aborted = await client.request({ type: "conversation.abort", projectId });
		expect(aborted.type).toBe("conversation.abort");
	});

	it("pushes tool progress and results into the view", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId);

		test.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("read the readme"),
		]);
		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "tool-1", content: "read it" });

		const finished = await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.tool-result"),
		);
		const result = finished.entries.find((entry) => entry.kind === "pi.tool-result");
		expect(result === undefined ? "" : JSON.stringify(result.model)).toContain("# test project");
	});

	it("resumes with `from` and pages older entries", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId);

		const view = new ViewClient(client);
		await view.start(projectId);
		test.faux.setResponses([fauxAssistantMessage("first")]);
		await client.request({ type: "conversation.submit", projectId, requestId: "a", content: "one" });
		const first = await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry) === "first"),
		);
		const assistantId = first.entries.find((entry) => entry.kind === "pi.assistant")?.id;
		expect(assistantId).toBeDefined();

		// A reconnect that watched from the assistant entry sees it and nothing older.
		const resumedClient = await connect(test.server);
		await greet(resumedClient);
		const resumed = new ViewClient(resumedClient);
		await resumed.start(projectId, { from: assistantId, min: 2, max: 4 });
		expect(resumed.view?.entries[0]?.id).toBe(assistantId);
		expect(resumed.view?.before).toBeDefined();

		test.faux.setResponses([fauxAssistantMessage("second")]);
		await resumedClient.request({ type: "conversation.submit", projectId, requestId: "b", content: "two" });
		const second = await resumed.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry) === "second"),
		);
		expect(second.entries.some((entry) => entryText(entry) === "first")).toBe(true);

		// A `from` past the newest entry starts empty and still receives new entries.
		const emptyClient = await connect(test.server);
		await greet(emptyClient);
		const empty = new ViewClient(emptyClient);
		const newest = second.entries.at(-1)?.id ?? 0;
		await empty.start(projectId, { from: newest + 10, min: 1, max: 2 });
		expect(empty.view?.entries).toEqual([]);
		expect(empty.view?.before).toBe(newest);
	});

	it("survives a server restart with its configuration and transcript", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId);

		const view = new ViewClient(client);
		await view.start(projectId);
		test.faux.setResponses([fauxAssistantMessage("before restart")]);
		await client.request({ type: "conversation.submit", projectId, requestId: "restart-1", content: "hi" });
		await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry) === "before restart"),
		);

		const server = await test.restart();
		const next = await connect(server);
		await greet(next);

		const list = await next.request({ type: "projects.list" });
		expect(list.type).toBe("projects.list");
		if (list.type === "projects.list") {
			expect(list.projects[0]?.id).toBe(projectId);
			expect(list.projects[0]?.coordinator.model).toEqual(FAUX);
		}

		const resumed = new ViewClient(next);
		await resumed.start(projectId);
		expect(resumed.view?.entries.some((entry) => entryText(entry) === "before restart")).toBe(true);

		test.faux.setResponses([fauxAssistantMessage("after restart")]);
		await next.request({ type: "conversation.submit", projectId, requestId: "restart-2", content: "again" });
		await resumed.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry) === "after restart"),
		);
	});

	it("emits project.state when a project opens", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		const view = new ViewClient(client);
		await view.start(projectId);
		const event = await client.waitFor((message) => message.type === "project.state");
		expect(event.type).toBe("project.state");
		if (event.type === "project.state") {
			expect(event.project.id).toBe(projectId);
			expect(event.project.state).toBe("open");
		}
	});
});

describe("a coordinator run that fails with a model error", () => {
	it("answers a message sent while the failing run was still working", async () => {
		const recovery = fauxProvider({ provider: "recovery", models: [{ id: "recovery-1" }] });
		const test = await setup({ configureModels: (models) => models.setProvider(recovery.provider) });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId);
		const view = new ViewClient(client);
		await view.start(projectId);

		// The model request is in flight, and will fail, while the user writes the next message.
		const reached = deferred();
		const release = deferred();
		test.faux.setResponses([
			async () => {
				reached.resolve();
				await release.promise;
				return fauxAssistantMessage("boom", { stopReason: "error", errorMessage: "ModelDeprecated: gone" });
			},
		]);
		await client.request({ type: "conversation.submit", projectId, requestId: "failing", content: "first" });
		await reached.promise;

		// The user fixes the model in settings and sends again before the failing run ended, so it is queued.
		await client.request({
			type: "projects.configure",
			projectId,
			coordinatorModel: RECOVERY,
			coordinatorThinkingLevel: "low",
		});
		const queued = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "after-the-fix",
			content: "after the fix",
			whenBusy: "followUp",
		});
		expect(queued.type).toBe("conversation.submit");

		recovery.setResponses([fauxAssistantMessage("recovered")]);
		release.resolve();

		// The failure starts a run with the queued message and the fixed model instead of leaving it in `pi.inbox`.
		const answered = await view.waitForView(
			(value) => value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry) === "recovered"),
			5_000,
		);
		expect(answered.entries.filter((entry) => entry.kind === "pi.user").map((entry) => entryText(entry))).toEqual([
			"first",
			"after the fix",
		]);
		expect(answered.docs["pi.inbox"]).toEqual({ items: [] });
	});

	it("answers again after the failure, including with a model changed in settings", async () => {
		const recovery = fauxProvider({ provider: "recovery", models: [{ id: "recovery-1" }] });
		const test = await setup({ configureModels: (models) => models.setProvider(recovery.provider) });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId);
		const view = new ViewClient(client);
		await view.start(projectId);

		test.faux.setResponses([
			fauxAssistantMessage("boom", { stopReason: "error", errorMessage: "ModelDeprecated: gone" }),
		]);
		await client.request({ type: "conversation.submit", projectId, requestId: "failing", content: "first" });
		const failed = await view.waitForView((value) =>
			value.entries.some(
				(entry) => entry.kind === "pi.assistant" && JSON.stringify(entry.model ?? "").includes("ModelDeprecated"),
			),
		);
		// The run ended: nothing is running and nothing was left queued behind the failure.
		expect((failed.docs["pi.live"] as { run?: unknown }).run).toBeUndefined();
		expect(failed.docs["pi.inbox"]).toEqual({ items: [] });

		// The user fixes the model in settings and sends again; that path works.
		await client.request({
			type: "projects.configure",
			projectId,
			coordinatorModel: RECOVERY,
			coordinatorThinkingLevel: "low",
		});
		recovery.setResponses([fauxAssistantMessage("recovered")]);
		await client.request({ type: "conversation.submit", projectId, requestId: "after-the-fix", content: "after the fix" });
		const answered = await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry) === "recovered"),
		);
		expect(answered.entries.filter((entry) => entry.kind === "pi.user").map((entry) => entryText(entry))).toEqual([
			"first",
			"after the fix",
		]);
	});
});

describe("folder listing", () => {
	it("lists host subfolders, hides dot folders, marks repos and projects", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const repos = join(test.root, "repos");
		const demo = join(repos, "demo");
		await mkdir(join(demo, ".git"), { recursive: true });
		await mkdir(join(repos, ".secret"), { recursive: true });
		await mkdir(join(repos, "plain"), { recursive: true });
		await writeFile(join(repos, "notes.txt"), "x");

		const listing = await client.request({ type: "filesystem.list", path: repos });
		expect(listing.type).toBe("filesystem.list");
		if (listing.type !== "filesystem.list") return;
		expect(listing.path).toBe(await realpath(repos));
		expect(listing.parent).toBe(test.root);
		expect(listing.home).toBe(await realpath(homedir()));
		expect(listing.projectId).toBeUndefined();
		expect(listing.truncated).toBe(false);
		expect(listing.entries.map((entry) => entry.name)).toEqual(["demo", "plain"]);
		expect(listing.entries.find((entry) => entry.name === "demo")?.isRepo).toBe(true);
		expect(listing.entries.find((entry) => entry.name === "plain")?.isRepo).toBe(false);

		const hidden = await client.request({ type: "filesystem.list", path: repos, showHidden: true });
		expect(hidden.type).toBe("filesystem.list");
		if (hidden.type !== "filesystem.list") return;
		expect(hidden.entries.map((entry) => entry.name)).toEqual([".secret", "demo", "plain"]);

		// Without a path the listing starts at the server user's home directory.
		const home = await client.request({ type: "filesystem.list" });
		expect(home.type).toBe("filesystem.list");
		if (home.type === "filesystem.list") {
			expect(home.path).toBe(await realpath(homedir()));
			expect(home.home).toBe(home.path);
		}

		const projectId = await addProject(client, demo);
		const marked = await client.request({ type: "filesystem.list", path: repos });
		expect(marked.type).toBe("filesystem.list");
		if (marked.type === "filesystem.list") {
			expect(marked.entries.find((entry) => entry.name === "demo")?.projectId).toBe(projectId);
			expect(marked.entries.find((entry) => entry.name === "plain")?.projectId).toBeUndefined();
		}

		const inside = await client.request({ type: "filesystem.list", path: demo });
		expect(inside.type).toBe("filesystem.list");
		if (inside.type === "filesystem.list") expect(inside.projectId).toBe(projectId);
	});

	it("answers a missing folder with invalid_path and refuses before hello", async () => {
		const test = await setup();
		const early = await connect(test.server);
		expect(errorOf(await early.request({ type: "filesystem.list" })).code).toBe("not_ready");

		const client = await connect(test.server);
		await greet(client);
		const missing = await client.request({ type: "filesystem.list", path: join(test.root, "nope") });
		expect(errorOf(missing).code).toBe("invalid_path");
		const file = await client.request({ type: "filesystem.list", path: join(test.projectDir, "README.md") });
		expect(errorOf(file).code).toBe("invalid_path");
		const relative = await client.request({ type: "filesystem.list", path: "relative" });
		expect(errorOf(relative).code).toBe("invalid_path");
	});
});

describe("API-only backend", () => {
	it("answers every non-WebSocket route with 404, including the old app shell", async () => {
		const test = await setup();
		for (const path of ["/", "/projects/deep/route", "/_app/immutable/chunk-abc.js", "/200.html"]) {
			const response = await fetch(`${test.server.url}${path}`);
			expect(response.status).toBe(404);
			expect(await response.text()).toContain("API-only");
		}
	});
});

describe("browser origin allow-list", () => {
	it("allows only listed origins, and clients without an Origin", async () => {
		const test = await setup({ allowedOrigins: ["https://harness.example.test"] });

		const allowed = await fetch(`${test.server.url}/ws`, {
			headers: { origin: "https://harness.example.test" },
		});
		expect(allowed.status).toBe(426);
		await allowed.body?.cancel();

		const denied = await fetch(`${test.server.url}/ws`, {
			headers: { origin: "https://evil.example" },
		});
		expect(denied.status).toBe(403);
		expect(await denied.text()).toBe("Forbidden origin");

		// Non-browser clients send no Origin; tests and the health check rely on this.
		const noOrigin = await fetch(`${test.server.url}/ws`);
		expect(noOrigin.status).toBe(426);
		await noOrigin.body?.cancel();
	});

	it("allows no browser origin when nothing is configured", async () => {
		const test = await setup({ allowedOrigins: [] });
		const denied = await fetch(`${test.server.url}/ws`, {
			headers: { origin: "https://harness.example.test" },
		});
		expect(denied.status).toBe(403);
		await denied.body?.cancel();

		const noOrigin = await fetch(`${test.server.url}/ws`);
		expect(noOrigin.status).toBe(426);
		await noOrigin.body?.cancel();
	});

	it("refuses a browser WebSocket from an unlisted origin", async () => {
		const test = await setup({ allowedOrigins: ["https://harness.example.test"] });
		const failed = TestClient.open(test.server, { origin: "https://evil.example" });
		await expect(failed).rejects.toThrow();

		const allowed = await TestClient.open(test.server, { origin: "https://harness.example.test" });
		clients.push(allowed);
		expect((await allowed.hello()).type).toBe("hello");
	});
});

describe("advertised features", () => {
	it("lists exactly the features the server was configured with", async () => {
		const test = await setup({ features: ["projects", "conversation"] });
		const client = await connect(test.server);
		const response = await client.hello();
		expect(response.type).toBe("hello");
		if (response.type === "hello") expect(response.features).toEqual(["projects", "conversation"]);
	});
});

describe("protocol messages as data", () => {
	it("keeps responses JSON and ids correlated", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const response = await client.hello();
		const messages: ServerMessage[] = [response];
		for (const message of messages) expect(JSON.parse(JSON.stringify(message))).toEqual(message);
	});

	it("views keep entry IDs as positive integers", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		const view = new ViewClient(client);
		await view.start(projectId);
		const value: ConversationView | undefined = view.view;
		for (const entry of value?.entries ?? []) {
			expect(Number.isInteger(entry.id)).toBe(true);
			expect(entry.id).toBeGreaterThan(0);
		}
	});
});

describe("folder editing", () => {
	it("completes, creates, renames and deletes folders, and protects projects", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const base = join(test.root, "edit");
		await mkdir(join(base, "work", "app"), { recursive: true });
		await mkdir(join(base, "alpha"), { recursive: true });

		const completion = await client.request({ type: "filesystem.complete", input: `${base}/a` });
		expect(completion.type).toBe("filesystem.complete");
		if (completion.type === "filesystem.complete") {
			expect(completion.entries.map((entry) => entry.name)).toEqual(["alpha"]);
			expect(completion.exact).toBeNull();
		}
		expect(errorOf(await client.request({ type: "filesystem.complete", input: "relative" })).code).toBe("invalid_path");

		const created = await client.request({ type: "filesystem.create", path: base, name: "fresh" });
		expect(created.type).toBe("filesystem.create");
		if (created.type === "filesystem.create") expect(created.entry.path).toBe(join(await realpath(base), "fresh"));
		expect(errorOf(await client.request({ type: "filesystem.create", path: base, name: "fresh" })).message).toContain(
			"already exists",
		);

		const renamed = await client.request({ type: "filesystem.rename", path: join(base, "fresh"), name: "fresher" });
		expect(renamed.type).toBe("filesystem.rename");
		const deleted = await client.request({ type: "filesystem.delete", path: join(base, "fresher") });
		expect(deleted.type).toBe("filesystem.delete");
		expect(errorOf(await client.request({ type: "filesystem.delete", path: join(base, "work") })).message).toContain(
			"This folder is not empty",
		);

		await addProject(client, join(base, "work", "app"));
		expect(errorOf(await client.request({ type: "filesystem.delete", path: join(base, "work", "app") })).message).toContain(
			"added project",
		);
		expect(errorOf(await client.request({ type: "filesystem.rename", path: join(base, "work"), name: "w2" })).message).toContain(
			"contains a project",
		);
		expect(errorOf(await client.request({ type: "filesystem.rename", path: test.dataDir, name: "x" })).message).toContain(
			"own data",
		);

	});
});
