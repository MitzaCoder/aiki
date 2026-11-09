import { describe, expect, it } from "bun:test";
import {
	CHECK_IN_PREFIX,
	DEFAULT_LONG_PROMPT_CACHE,
	INPUT_IMAGE_MAX_BYTES,
	INPUT_MAX_IMAGES,
	base64ByteLength,
	inputImagesError,
	ClientMessageSchema,
	PROTOCOL_SCHEMAS,
	PROTOCOL_VERSION,
	ServerEventSchema,
	ServerMessageSchema,
	THINKING_LEVELS,
	WORKER_REPORT_PREFIX,
} from "../src/index.ts";
import { Value } from "typebox/value";

describe("protocol schemas", () => {
	it("accepts a complete hello, watch and submit exchange", () => {
		const hello = { type: "hello", id: "1", protocolVersion: PROTOCOL_VERSION };
		expect(Value.Check(ClientMessageSchema, hello)).toBe(true);

		const watch = { type: "conversation.watch", id: "2", projectId: "p1", from: 12, min: 10, max: 20 };
		expect(Value.Check(ClientMessageSchema, watch)).toBe(true);

		const submit = {
			type: "conversation.submit",
			id: "3",
			projectId: "p1",
			requestId: "r1",
			content: [
				{ type: "text", text: "look" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			],
			whenBusy: "steer",
		};
		expect(Value.Check(ClientMessageSchema, submit)).toBe(true);

		const list = { type: "filesystem.list", id: "4", path: "/home/you", showHidden: true };
		expect(Value.Check(ClientMessageSchema, list)).toBe(true);
		expect(Value.Check(ClientMessageSchema, { type: "filesystem.list", id: "4" })).toBe(true);
	});

	it("rejects malformed requests", () => {
		expect(Value.Check(ClientMessageSchema, { type: "projects.add", id: "1" })).toBe(false);
		expect(Value.Check(ClientMessageSchema, { type: "conversation.watch", id: "1", projectId: "p", min: 0 })).toBe(
			false,
		);
		expect(Value.Check(ClientMessageSchema, { type: "conversation.watch", id: "1", projectId: "p", from: "7" })).toBe(
			false,
		);
		expect(Value.Check(ClientMessageSchema, { type: "hello", id: "1" })).toBe(false);
		expect(Value.Check(ClientMessageSchema, { type: "nope", id: "1" })).toBe(false);
	});

	it("validates server responses, view events and errors", () => {
		const view = {
			type: "conversation.watch",
			id: "1",
			watchId: "w1",
			conversationId: 1,
			view: {
				conversation: { id: 1 },
				entries: [
					{
						id: 2,
						conversationId: 1,
						kind: "pi.user",
						model: [{ role: "user", content: "hi", timestamp: 0 }],
					},
				],
				before: 1,
				docs: { "pi.live": {} },
			},
		};
		expect(Value.Check(ServerMessageSchema, view)).toBe(true);

		const ops = { type: "conversation.view", watchId: "w1", ops: [["s", ["entries", 0, "kind"], "pi.user"]] };
		expect(Value.Check(ServerMessageSchema, ops)).toBe(true);

		const error = { type: "error", id: "1", error: { code: "no_coordinator_model", message: "pick one" } };
		expect(Value.Check(ServerMessageSchema, error)).toBe(true);

		const listing = {
			type: "filesystem.list",
			id: "2",
			path: "/home/you",
			parent: "/home",
			home: "/home/you",
			entries: [{ name: "repo", path: "/home/you/repo", isRepo: true, projectId: "repo-1" }],
			truncated: false,
		};
		expect(Value.Check(ServerMessageSchema, listing)).toBe(true);
		expect(Value.Check(ServerMessageSchema, { ...listing, parent: null })).toBe(true);
	});

	it("accepts OAuth login requests and server events", () => {
		const login = {
			id: "login-1",
			providerId: "anthropic",
			status: "prompt",
			prompt: {
				id: "login-1-prompt-1",
				type: "select",
				message: "Select Anthropic login method:",
				options: [{ id: "browser", label: "Browser login" }],
			},
			events: [{ type: "auth_url", url: "https://claude.ai/oauth/authorize", instructions: "Open it" }],
			startedAt: 1,
			updatedAt: 2,
		};

		for (const request of [
			{ type: "credentials.logins", id: "1" },
			{ type: "credentials.loginStart", id: "2", providerId: "anthropic" },
			{ type: "credentials.loginAnswer", id: "3", loginId: "login-1", promptId: "p1", value: "browser" },
			{ type: "credentials.loginCancel", id: "4", loginId: "login-1" },
		]) {
			expect(Value.Check(ClientMessageSchema, request), JSON.stringify(request)).toBe(true);
		}
		expect(Value.Check(ClientMessageSchema, { type: "credentials.loginStart", id: "5" })).toBe(false);

		expect(Value.Check(ServerMessageSchema, { type: "credentials.logins", id: "1", logins: [login] })).toBe(true);
		expect(Value.Check(ServerMessageSchema, { type: "credentials.login", login })).toBe(true);
		expect(
			Value.Check(ServerMessageSchema, { type: "credentials.loginCancel", id: "1", cancelled: true }),
		).toBe(true);
		expect(
			Value.Check(ServerMessageSchema, {
				type: "credentials.login",
				login: { ...login, status: "failed", error: "Login cancelled", prompt: undefined },
			}),
		).toBe(true);
		expect(Value.Check(ServerMessageSchema, { type: "credentials.login", login: { ...login, status: "waiting" } })).toBe(
			false,
		);

		const eventMessage = { type: "credentials.login", login: { ...login, status: "succeeded", prompt: undefined } };
		expect(Value.Check(ServerEventSchema, eventMessage)).toBe(true);
	});

	it("accepts worker requests, statuses and the worker link", () => {
		const list = { type: "workers.list", id: "1", projectId: "p1" };
		expect(Value.Check(ClientMessageSchema, list)).toBe(true);
		expect(Value.Check(ClientMessageSchema, { type: "workers.list", id: "1" })).toBe(false);

		// The coordinator's conversation, or a worker's read-only one.
		expect(Value.Check(ClientMessageSchema, { type: "conversation.watch", id: "2", projectId: "p1", workerId: "reader" })).toBe(
			true,
		);
		expect(Value.Check(ClientMessageSchema, { type: "conversation.page", id: "3", projectId: "p1", workerId: "reader" })).toBe(
			true,
		);

		// A message can pick the worker model the project starts from.
		const submit = {
			type: "conversation.submit",
			id: "4",
			projectId: "p1",
			requestId: "r1",
			content: "hello",
			workerModel: { provider: "anthropic", modelId: "claude-x" },
			workerThinkingLevel: "high",
		};
		expect(Value.Check(ClientMessageSchema, submit)).toBe(true);
		expect(Value.Check(ClientMessageSchema, { ...submit, workerThinkingLevel: "extreme" })).toBe(false);

		const worker = {
			id: "reader",
			title: "Read the README",
			status: "running",
			model: { provider: "anthropic", modelId: "claude-x" },
			thinkingLevel: "high",
			isolation: "workspace",
			workspacePath: "/data/projects/p1/workspaces/reader",
			conversationId: 7,
			spawnedByCallId: "call-1",
			createdAt: "2026-10-30T00:00:00.000Z",
			updatedAt: "2026-10-30T00:00:01.000Z",
			lastReport: null,
			failure: null,
		};
		const defaults = { model: null, thinkingLevel: null };
		expect(Value.Check(ServerMessageSchema, { type: "workers.list", id: "5", workers: [worker], defaults })).toBe(true);
		expect(Value.Check(ServerMessageSchema, { type: "workers.state", projectId: "p1", workers: [worker], defaults })).toBe(
			true,
		);
		expect(
			Value.Check(ServerMessageSchema, {
				type: "workers.state",
				projectId: "p1",
				workers: [{ ...worker, status: "merged" }],
				defaults,
			}),
		).toBe(false);
		expect(
			Value.Check(ServerMessageSchema, {
				type: "workers.state",
				projectId: "p1",
				workers: [{ ...worker, status: "done", workspacePath: null }],
				defaults,
			}),
		).toBe(true);
	});

	it("accepts the check-in settings and documents the harness' input prefixes", () => {
		const project = {
			id: "p1",
			name: "demo",
			path: "/home/you/demo",
			coordinator: { model: null, thinkingLevel: null },
			workerModels: [],
			checkIns: { enabled: true, intervalMinutes: 10 },
			state: "closed",
		};
		expect(Value.Check(ServerMessageSchema, { type: "projects.list", id: "1", projects: [project] })).toBe(true);
		expect(
			Value.Check(ServerMessageSchema, {
				type: "projects.list",
				id: "1",
				projects: [{ ...project, checkIns: { enabled: true, intervalMinutes: 0 } }],
			}),
		).toBe(false);

		expect(
			Value.Check(ClientMessageSchema, {
				type: "projects.configure",
				id: "2",
				projectId: "p1",
				checkIns: { enabled: false, intervalMinutes: 30 },
			}),
		).toBe(true);
		expect(
			Value.Check(ClientMessageSchema, { type: "projects.configure", id: "3", projectId: "p1", checkIns: null }),
		).toBe(true);

		// The one-hour cache setting: optional in a summary (older servers), one of three values, null restores the default.
		expect(Value.Check(ServerMessageSchema, { type: "projects.list", id: "1", projects: [{ ...project, longPromptCache: "all" }] })).toBe(true);
		expect(Value.Check(ServerMessageSchema, { type: "projects.list", id: "1", projects: [{ ...project, longPromptCache: "workers" }] })).toBe(false);
		for (const longPromptCache of ["off", "coordinators", "all", null]) {
			expect(Value.Check(ClientMessageSchema, { type: "projects.configure", id: "4", projectId: "p1", longPromptCache })).toBe(true);
		}
		expect(DEFAULT_LONG_PROMPT_CACHE).toBe("coordinators");

		expect(CHECK_IN_PREFIX).toBe("[check-in]");
		expect(WORKER_REPORT_PREFIX).toBe("[worker ");
	});

	it("carries an optional thinking level on default worker models", () => {
		const project = {
			id: "p1",
			name: "demo",
			path: "/home/you/demo",
			coordinator: { model: null, thinkingLevel: null },
			workerModels: [
				{ provider: "faux", modelId: "faux-1" },
				{ provider: "faux", modelId: "faux-2", thinkingLevel: "high" },
				{ provider: "faux", modelId: "faux-3", thinkingLevel: null },
			],
			checkIns: { enabled: true, intervalMinutes: 10 },
			state: "closed",
		};
		expect(Value.Check(ServerMessageSchema, { type: "projects.list", id: "1", projects: [project] })).toBe(true);
		expect(
			Value.Check(ServerMessageSchema, {
				type: "projects.list",
				id: "1",
				projects: [
					{
						...project,
						workerModels: [{ provider: "faux", modelId: "faux-1", thinkingLevel: "extreme" }],
					},
				],
			}),
		).toBe(false);

		// An older client sends the same list without levels, and a newer one may add fields this version ignores.
		const configure = { type: "projects.configure", id: "2", projectId: "p1" };
		expect(Value.Check(ClientMessageSchema, { ...configure, workerModels: [{ provider: "faux", modelId: "faux-1" }] })).toBe(
			true,
		);
		expect(
			Value.Check(ClientMessageSchema, {
				...configure,
				workerModels: [{ provider: "faux", modelId: "faux-1", thinkingLevel: "low" }],
			}),
		).toBe(true);
		expect(
			Value.Check(ClientMessageSchema, {
				...configure,
				workerModels: [{ provider: "faux", modelId: "faux-1", futureField: true }],
			}),
		).toBe(true);
	});

	it("exports every message schema for code generation", () => {
		expect(PROTOCOL_SCHEMAS.ClientMessage).toBeDefined();
		expect(PROTOCOL_SCHEMAS.ServerMessage).toBeDefined();
		expect(PROTOCOL_SCHEMAS.ConversationView).toBeDefined();
		expect(PROTOCOL_SCHEMAS.WorkerSummary).toBeDefined();
		expect(PROTOCOL_SCHEMAS.WorkersListResponse).toBeDefined();
		expect(PROTOCOL_SCHEMAS.WorkersStateEvent).toBeDefined();
		expect(PROTOCOL_SCHEMAS.ProjectCheckIns).toBeDefined();
		expect(PROTOCOL_SCHEMAS.WorkerModel).toBeDefined();
		for (const [name, schema] of Object.entries(PROTOCOL_SCHEMAS)) {
			expect(typeof schema, name).toBe("object");
			expect(() => JSON.stringify(schema), name).not.toThrow();
		}
		expect(THINKING_LEVELS).toContain("off");
		expect(THINKING_LEVELS).toContain("max");
	});
});

describe("inputImagesError", () => {
	const png = (bytes: number) => ({ type: "image" as const, mimeType: "image/png", data: "A".repeat(Math.ceil((bytes * 4) / 3)) });
	it("lets text and images within the limits through", () => {
		expect(inputImagesError("hello")).toBeUndefined();
		expect(inputImagesError([{ type: "text", text: "hi" }, png(1000), png(INPUT_IMAGE_MAX_BYTES)])).toBeUndefined();
	});
	it("names what is over", () => {
		expect(inputImagesError([{ ...png(10), mimeType: "image/tiff" }])).toContain("image/tiff");
		expect(inputImagesError([png(INPUT_IMAGE_MAX_BYTES + 10)])).toContain("at most");
		expect(inputImagesError(Array.from({ length: INPUT_MAX_IMAGES + 1 }, () => png(10)))).toContain(`${INPUT_MAX_IMAGES} images`);
		expect(inputImagesError(Array.from({ length: 5 }, () => png(INPUT_IMAGE_MAX_BYTES)))).toContain("together");
	});
	it("counts base64 padding", () => {
		expect(base64ByteLength("QQ==")).toBe(1);
		expect(base64ByteLength("QUI=")).toBe(2);
		expect(base64ByteLength("QUJD")).toBe(3);
	});
});
