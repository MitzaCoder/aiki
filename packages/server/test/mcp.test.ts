import { afterEach, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createSetup, TestClient, ViewClient, entryText, type TestSetup } from "./support.ts";
import { fakeMcpServer, notionSizedTools } from "./mcp-support.ts";
import { mcpRoleExtension, validateMcpUrl, mcpSummary } from "../src/mcp.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const TOKEN = "synthetic-mcp-bearer-for-tests";
async function setup(now?: () => number) {
	const logs: string[] = [];
	const test = await createSetup({ now, log: (text) => logs.push(text) });
	cleanups.push(test.cleanup);
	console.log(`MCP test dirs: ${test.root}; data=${test.dataDir}; project=${test.projectDir}`);
	const fake = fakeMcpServer(TOKEN);
	cleanups.push(fake.close);
	const client = await TestClient.open(test.server);
	cleanups.push(async () => client.close());
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw new Error("project add failed");
	const projectId = added.project.id;
	const mcp = test.server.manager.mcp!;
	await client.request({ type: "mcp.add", serverId: "notion", name: "Synthetic Notion", url: fake.url });
	await client.request({ type: "mcp.token.set", serverId: "notion", token: TOKEN });
	await client.request({ type: "mcp.refresh", serverId: "notion" });
	const { runtime } = await test.server.manager.open(projectId);
	return { test, fake, client, projectId, runtime, mcp, logs };
}
function api(conversationId: number, callId = crypto.randomUUID()): ToolExecutionApi {
	return { conversationId, callId } as ToolExecutionApi;
}
async function run(tool: ToolRegistration, conversationId: number, args: object = { page: "one" }): Promise<string> {
	return JSON.stringify(await tool.execute(args, api(conversationId), BACKGROUND_CONTEXT));
}
it("validates remote URLs without exposing URL credentials", () => {
	for (const url of [
		"http://example.com/mcp",
		"file:///mcp",
		"https://token@example.com/mcp",
		"https://example.com/mcp?token=secret",
	])
		expect(() => validateMcpUrl(url)).toThrow();
	expect(validateMcpUrl("https://example.com/mcp")).toBe("https://example.com/mcp");
	expect(validateMcpUrl("http://[::1]/mcp")).toBe("http://[::1]/mcp");
});
it("connects with injected bearer credentials, paginates, caches, redacts, refreshes notifications and reloads", async () => {
	const { test, fake, client, projectId, mcp, logs } = await setup();
	const listed = await client.request({ type: "mcp.list" });
	expect(listed.type).toBe("mcp.list");
	const server = (await mcp.list())[0]!;
	expect(server.status).toBe("connected");
	expect(server.tools.length).toBe(3);
	expect(server.authKind).toBe("token");
	expect(server.hasCredential).toBe(true);
	expect(server.tools.map((tool) => tool.policy)).toEqual(["allow", "ask", "ask"]);
	expect(JSON.stringify(listed)).not.toContain(TOKEN);
	expect(await readFile(mcp.path, "utf8")).not.toContain(TOKEN);
	expect((await stat(join(test.dataDir, "credentials.json"))).mode & 0o777).toBe(0o600);
	expect(mcp.project(projectId)).toEqual([]);
	const credentials = await client.request({ type: "credentials.list" });
	expect(JSON.stringify(credentials)).not.toContain("mcp:");
	fake.setTools(notionSizedTools());
	await fake.listChanged();
	await mcp.refresh("notion");
	expect((await mcp.view("notion")).tools.length).toBe(71);
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
	await test.restart();
	const reopened = test.server.manager.mcp!;
	expect((await reopened.view("notion")).tools.length).toBe(71);
	expect((await reopened.view("notion")).status).toBe("disconnected");
	expect(reopened.project(projectId)[0]?.enabled).toBe(true);
	expect((await reopened.refresh("notion")).status).toBe("connected");
	await reopened.setToken("notion", "wrong-synthetic-token");
	const failed = await reopened.refresh("notion");
	expect(failed.status).toBe("error");
	expect(failed.lastError).not.toContain("wrong-synthetic-token");
	expect(logs.join("\n")).not.toContain(TOKEN);
	expect(logs.join("\n")).not.toContain("wrong-synthetic-token");
}, 25_000);
it("enforces Off/Ask/Allow with real board questions, exact one-use retries, deny and always allow", async () => {
	const { fake, runtime, mcp, projectId } = await setup();
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
	const tools = (await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable;
	const read = tools.find((tool) => tool.name.endsWith("__read_page"))!;
	const write = tools.find((tool) => tool.name.endsWith("__write_page"))!;
	expect(await run(read, runtime.conversation.id)).toContain("redacted");
	expect(fake.calls.length).toBe(1);
	expect(await run(write, runtime.conversation.id)).toContain("approval requested (Q1)");
	expect(fake.calls.length).toBe(1);
	let question = (await runtime.board.state()).questions[0]!;
	expect(question.text).toContain('Exact arguments:\n{"page":"one"}');
	expect(question.options).toEqual(["Approve once", "Always allow this tool", "Deny"]);
	await runtime.board.answer({ questionId: question.id, expectedRevision: question.revision, answer: "Approve once" });
	expect(await run(write, runtime.conversation.id, { page: "two" })).toContain("approval requested");
	expect(fake.calls.length).toBe(1);
	expect(await run(write, runtime.conversation.id)).toContain("synthetic result");
	expect(fake.calls.length).toBe(2);
	expect(await run(write, runtime.conversation.id)).toContain("approval requested");
	expect(fake.calls.length).toBe(2);
	question = (await runtime.board.state()).questions.find(
		(question) => question.status === "open" && question.text.includes('"two"'),
	)!;
	await runtime.board.answer({ questionId: question.id, expectedRevision: question.revision, answer: "Deny" });
	expect(await run(write, runtime.conversation.id, { page: "two" })).toContain("denied");
	expect(fake.calls.length).toBe(2);
	question = (await runtime.board.state()).questions.find((question) => question.status === "open")!;
	await runtime.board.answer({
		questionId: question.id,
		expectedRevision: question.revision,
		answer: "Always allow this tool",
	});
	expect((await mcp.view("notion")).tools.find((tool) => tool.name === "write_page")?.policy).toBe("allow");
	expect(await run(write, runtime.conversation.id, { page: "different" })).toContain("synthetic result");
	expect(fake.calls.length).toBe(3);
	await mcp.setPolicy("notion", "write_page", "off");
	expect(await run(write, runtime.conversation.id)).toContain("Off");
	expect(fake.calls.length).toBe(3);
	expect((await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.some((tool) => tool.name === write.name)).toBe(
		false,
	);
	await mcp.setPolicy("notion", "write_page", "allow");
	fake.failCalls(true);
	expect(await run(write, runtime.conversation.id)).toContain("outcome may be unknown");
	expect(fake.calls.length).toBe(4);
}, 25_000);
it("filters role registration and rechecks project/role policy for an already captured nested tool", async () => {
	const { fake, mcp, runtime, projectId } = await setup();
	expect(
		(await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.some((tool) => tool.name.startsWith("mcp__")),
	).toBe(false);
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
	const read = (await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.find((tool) =>
		tool.name.endsWith("__read_page"),
	)!;
	const worker = await runtime.harness.createConversation(
		{
			ownership: { kind: "ownerless" },
			agent: {
				extensions: {
					add: [mcpRoleExtension("workers")],
					remove: [mcpRoleExtension("coordinator"), mcpRoleExtension("background")],
				},
			},
		},
		BACKGROUND_CONTEXT,
	);
	expect((await worker.agent(BACKGROUND_CONTEXT)).callable.some((tool) => tool.name.startsWith("mcp__"))).toBe(false);
	expect(await run(read, worker.id)).toContain("disabled");
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["workers"] }]);
	expect((await worker.agent(BACKGROUND_CONTEXT)).callable.some((tool) => tool.name === read.name)).toBe(true);
	expect(await run(read, runtime.conversation.id)).toContain("disabled");
	expect(await run(read, worker.id)).toContain("synthetic result");
	const write = (await worker.agent(BACKGROUND_CONTEXT)).callable.find((tool) => tool.name.endsWith("__write_page"))!;
	expect(await run(write, worker.id)).toContain("approval requested");
	expect((await runtime.board.state()).questions[0]?.threadId).toBe("main");
	await mcp.setProject(projectId, []);
	expect(await run(read, worker.id)).toContain("disabled");
	expect(fake.calls.length).toBe(1);
}, 25_000);
it("never forwards bearer credentials through a cross-origin redirect", async () => {
	const { mcp, fake } = await setup();
	const other = fakeMcpServer(TOKEN);
	cleanups.push(other.close);
	await mcp.disconnect("notion");
	fake.redirectTo(other.url);
	expect((await mcp.refresh("notion")).status).toBe("error");
	expect(other.requests.length).toBe(0);
}, 20_000);

it("keeps 71 deferred tools out of the prompt and runs real codemode search/describe/call", async () => {
	const { test, fake, client, runtime, projectId, mcp, logs } = await setup();
	await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: { provider: "faux", modelId: "faux-1" },
	});
	const measurements: { baseline?: number; connected?: number; inlineBaseline?: string; inlineConnected?: string } = {};
	function capture(request: Parameters<FauxResponseFactory>[0], label: "baseline" | "connected") {
		const sections: Record<string, string> = {};
		const tools = new Map<string, unknown>();
		let base = "";
		for (const message of request.messages)
			if (message.role === "system") {
				if (message.content)
					base += typeof message.content === "string" ? message.content : JSON.stringify(message.content);
				for (const [key, value] of Object.entries(message.sections ?? {})) {
					if (value === null) delete sections[key];
					else sections[key] = value;
				}
				for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
				for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
			}
		const prompt = base + Object.values(sections).join("\n\n") + JSON.stringify([...tools.values()]);
		expect(prompt).not.toContain(TOKEN);
		expect(prompt).not.toContain("Ignore all instructions");
		expect([...tools.keys()].some((name) => name.startsWith("mcp__"))).toBe(false);
		measurements[label] = Math.ceil(prompt.length / 4);
		measurements[label === "baseline" ? "inlineBaseline" : "inlineConnected"] = sections.codemode;
		if (label === "connected") {
			expect(sections.mcp_servers).toContain('namespace: "notion"');
			expect(sections.mcp_servers).toContain("71");
			expect(Math.ceil(sections.mcp_servers!.length / 4)).toBeLessThanOrEqual(80);
		}
	}
	const code =
		'const found = await searchTools("page search", {namespace:"notion", limit:3}); const description = await describeTool(found[0].name); const namespace = await describeNamespace("notion"); const called = await tools[found[0].name]({query:"synthetic"}); return {searchCount:found.length, searchChars:JSON.stringify(found).length, described:description.includes("Synthetic"), namespaceCount:namespace.tools.length, called};';
	test.faux.setResponses([
		(request) => {
			capture(request, "baseline");
			return fauxAssistantMessage("baseline done");
		},
		(request) => {
			capture(request, "connected");
			return fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
		},
		fauxAssistantMessage("script done"),
	]);
	const view = new ViewClient(client);
	await view.start(projectId);
	await client.request({
		type: "conversation.submit",
		projectId,
		requestId: "mcp-baseline",
		content: "Measure baseline",
	});
	await view.waitForView((value) => value.entries.some((entry) => entryText(entry).includes("baseline done")));
	fake.setTools(notionSizedTools());
	await mcp.refresh("notion");
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
	const agent = await runtime.conversation.agent(BACKGROUND_CONTEXT);
	expect(agent.callable.filter((tool) => tool.name.startsWith("mcp__")).length).toBe(71);
	expect(
		agent.callable
			.filter((tool) => tool.name.startsWith("mcp__"))
			.every((tool) => tool.deferred && tool.replay === "unsafe"),
	).toBe(true);
	await client.request({
		type: "conversation.submit",
		projectId,
		requestId: "mcp-script",
		content: "Measure connected",
	});
	const result = await view.waitForView((value) =>
		value.entries.some((entry) => entry.kind === "pi.tool-result" && entryText(entry).includes("searchChars")),
	);
	const output = result.entries
		.filter((entry) => entry.kind === "pi.tool-result")
		.map(entryText)
		.join("\n");
	expect(output).toContain('"searchCount":3');
	expect(output).toContain('"namespaceCount":71');
	expect(output).toContain('"described":true');
	expect(output).toContain("redacted");
	expect(fake.calls.length).toBe(1);
	expect(output).not.toContain(TOKEN);
	expect(logs.join("\n")).not.toContain(TOKEN);
	expect(measurements.inlineConnected).toBe(measurements.inlineBaseline);
	const searchChars = Number(output.match(/"searchChars":(\d+)/)?.[1]);
	expect(searchChars).toBeGreaterThan(0);
	const summary = mcpSummary(await mcp.view("notion"));
	const rawCatalogueChars = JSON.stringify(notionSizedTools()).length;
	console.log(
		"MCP TOKEN MEASUREMENT",
		JSON.stringify({
			baseline: measurements.baseline,
			connected: measurements.connected,
			delta: measurements.connected! - measurements.baseline!,
			summaryTokens: Math.ceil(summary.length / 4),
			rawCatalogueChars,
			rawCatalogueTokens: Math.ceil(rawCatalogueChars / 4),
			searchChars,
			searchTokens: Math.ceil(searchChars / 4),
		}),
	);
}, 25_000);
it("expires exact-call approvals and restores pending approvals across a backend restart", async () => {
	let now = Date.now();
	const { test, fake, projectId, mcp, runtime } = await setup(() => now);
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
	let write = (await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.find((tool) =>
		tool.name.endsWith("__write_page"),
	)!;
	expect(await run(write, runtime.conversation.id)).toContain("approval requested (Q1)");
	let question = (await runtime.board.state()).questions[0]!;
	now += 24 * 60 * 60_000; // The owner can answer the next day.
	await runtime.board.answer({ questionId: question.id, expectedRevision: question.revision, answer: "Approve once" });
	expect(await run(write, runtime.conversation.id)).toContain("synthetic result");
	expect(fake.calls.length).toBe(1);
	await run(write, runtime.conversation.id);
	question = (await runtime.board.state()).questions.find(question => question.status === "open")!;
	await runtime.board.answer({ questionId: question.id, expectedRevision: question.revision, answer: "Approve once" });
	now += 16 * 60_000;
	expect(await run(write, runtime.conversation.id)).toContain("approval requested (Q3)");
	expect(fake.calls.length).toBe(1);
	await test.restart();
	const reopened = (await test.server.manager.open(projectId)).runtime;
	write = (await reopened.conversation.agent(BACKGROUND_CONTEXT)).callable.find((tool) =>
		tool.name.endsWith("__write_page"),
	)!;
	question = (await reopened.board.state()).questions.find((question) => question.status === "open")!;
	await reopened.board.answer({ questionId: question.id, expectedRevision: question.revision, answer: "Approve once" });
	expect(await run(write, reopened.conversation.id)).toContain("synthetic result");
	expect(fake.calls.length).toBe(2);
}, 25_000);
it("isolates project enablement and background role registration", async () => {
	const { test, mcp, client, projectId, runtime, fake } = await setup();
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["background"] }]);
	const background = await runtime.harness.createConversation(
		{
			ownership: { kind: "ownerless" },
			agent: {
				extensions: {
					add: [mcpRoleExtension("background")],
					remove: [mcpRoleExtension("coordinator"), mcpRoleExtension("workers")],
				},
			},
		},
		BACKGROUND_CONTEXT,
	);
	runtime.coordinators.add({
		threadId: "synthetic-background",
		conversationId: background.id,
		checkout: test.projectDir,
		workspacesDir: join(test.root, "thread-workers"),
		workspacePrefix: "synthetic-",
	});
	const read = (await background.agent(BACKGROUND_CONTEXT)).callable.find((tool) => tool.name.endsWith("__read_page"))!;
	expect(read).toBeDefined();
	expect((await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.some((tool) => tool.name === read.name)).toBe(
		false,
	);
	expect(await run(read, background.id)).toContain("synthetic result");
	const otherPath = join(test.root, "other-project");
	await mkdir(otherPath);
	const added = await client.request({ type: "projects.add", path: otherPath });
	if (added.type !== "projects.add") throw new Error("second project failed");
	const other = (await test.server.manager.open(added.project.id)).runtime;
	expect(
		(await other.conversation.agent(BACKGROUND_CONTEXT)).callable.some((tool) => tool.name.startsWith("mcp__")),
	).toBe(false);
	// A captured tool is also scoped to its own project binding, never another project's settings.
	await mcp.setProject(projectId, []);
	expect(await run(read, background.id)).toContain("disabled");
	expect(fake.calls.length).toBe(1);
}, 25_000);
it("revokes tools between two nested calls in an already-started codemode script", async () => {
	const { test, fake, mcp, client, projectId } = await setup();
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
	await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: { provider: "faux", modelId: "faux-1" },
	});
	const pause = fake.pauseNextCall();
	const code =
		'await tools.mcp__notion__read_page({page:"first"}); try { await tools.mcp__notion__read_page({page:"second"}); return "unexpected call"; } catch (error) { return "revoked: " + error.message; }';
	test.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
	const view = new ViewClient(client);
	await view.start(projectId);
	await client.request({ type: "conversation.submit", projectId, requestId: "mcp-revoke", content: "Run two reads" });
	await pause.started;
	await mcp.setProject(projectId, []);
	pause.release();
	const result = await view.waitForView((value) =>
		value.entries.some((entry) => entry.kind === "pi.tool-result" && entryText(entry).includes("revoked:")),
	);
	expect(
		result.entries
			.filter((entry) => entry.kind === "pi.tool-result")
			.map(entryText)
			.join("\n"),
	).not.toContain("unexpected call");
	expect(fake.calls.length).toBe(1);
}, 25_000);
it("gives scheduled workers coordinator scope and preserves non-MCP filters on restart", async () => {
	const { test, runtime, mcp, projectId, fake } = await setup();
	await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
	const scheduled = await runtime.workers.startScheduledRun({
		scheduleId: "synthetic-schedule",
		title: "Synthetic run",
		brief: "Synthetic task",
		model: { provider: "faux", modelId: "faux-1" },
		thinkingLevel: null,
		isolation: "shared",
		onReport: "record",
		at: Date.now(),
		timezone: "UTC",
	});
	if (!scheduled.ok) throw new Error(scheduled.message);
	const worker = await runtime.harness.conversation(
		scheduled.conversationId as import("@earendil-works/pi-durable").ConversationId,
		BACKGROUND_CONTEXT,
	);
	const before = await worker!.agent(BACKGROUND_CONTEXT);
	expect(before.callable.some((tool) => tool.name === "board")).toBe(false);
	const read = before.callable.find((tool) => tool.name.endsWith("__read_page"))!;
	expect(read).toBeDefined();
	expect(await run(read, scheduled.conversationId)).toContain("synthetic result");
	expect(fake.calls.length).toBe(1);
	await test.restart();
	const reopened = (await test.server.manager.open(projectId)).runtime;
	const restored = await reopened.harness.conversation(
		scheduled.conversationId as import("@earendil-works/pi-durable").ConversationId,
		BACKGROUND_CONTEXT,
	);
	const after = await restored!.agent(BACKGROUND_CONTEXT);
	expect(after.callable.some((tool) => tool.name === "board")).toBe(false);
	expect(after.callable.some((tool) => tool.name === read.name)).toBe(true);
}, 25_000);

it("withdraws open Ask questions on expiry, catalogue removal and server removal", async () => {
 let now = Date.now();
 const { mcp, runtime, projectId, fake } = await setup(() => now);
 await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
 const write = (await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.find(tool => tool.name.endsWith("__write_page"))!;
 await run(write, runtime.conversation.id);
 now += 8 * 24 * 60 * 60_000;
 await mcp.pruneApprovals();
 expect((await runtime.board.state()).questions[0]!.status).toBe("withdrawn");
 await run(write, runtime.conversation.id);
 fake.setTools([]);
 await mcp.refresh("notion");
 expect((await runtime.board.state()).questions.every(question => question.status === "withdrawn")).toBe(true);
 // Restore a tool, ask again, and remove its server.
 fake.setTools([{ name: "write_page", inputSchema: { type: "object" } }]);
 await mcp.refresh("notion");
 const restored = (await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.find(tool => tool.name.endsWith("__write_page"))!;
 await run(restored, runtime.conversation.id);
 await mcp.remove("notion");
 expect((await runtime.board.state()).questions.length).toBe(3);
 expect((await runtime.board.state()).questions.every(question => question.status === "withdrawn")).toBe(true);
}, 25_000);

it("withdraws expired or removed-server questions when their closed project reopens", async () => {
 let now = Date.now();
 const { test, mcp, runtime, projectId } = await setup(() => now);
 await mcp.setProject(projectId, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
 const write = (await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.find(tool => tool.name.endsWith("__write_page"))!;
 await run(write, runtime.conversation.id, { page: "expired" });
 now += 8 * 24 * 60 * 60_000;
 // Restart closes project bindings. Listing must not forget the unanswered board question.
 await test.restart();
 const service = test.server.manager.mcp!;
 await service.list();
 const reopened = (await test.server.manager.open(projectId)).runtime;
 await service.pruneApprovals();
 expect((await reopened.board.state()).questions[0]!.status).toBe("withdrawn");
 await service.refresh("notion");
 const restored = (await reopened.conversation.agent(BACKGROUND_CONTEXT)).callable.find(tool => tool.name.endsWith("__write_page"))!;
 await run(restored, reopened.conversation.id, { page: "removed" });
 await test.restart();
 await test.server.manager.mcp!.remove("notion"); // Project is still closed.
 const finalRuntime = (await test.server.manager.open(projectId)).runtime;
 await test.server.manager.mcp!.pruneApprovals();
 expect((await finalRuntime.board.state()).questions.length).toBe(2);
 expect((await finalRuntime.board.state()).questions.every(question => question.status === "withdrawn")).toBe(true);
}, 25_000);
