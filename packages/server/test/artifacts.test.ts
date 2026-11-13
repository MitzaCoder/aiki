/**
 * Artifacts: `artifact_save` from the coordinator and a worker, what it refuses, the store's cap and filters, the
 * `artifacts.*` requests and push, and the signed HTTP endpoint with ranges and CORS.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import type { JsonObject } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
	ARTIFACT_MAX_TAG_LENGTH,
	ARTIFACT_MAX_TAGS,
	type Artifact,
	type ModelRef,
	type ServerMessage,
	normalizeTag,
	normalizeTags,
} from "@aiki/protocol";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTIFACT_TAG_GUIDANCE, createArtifactExtension, resolveArtifactSource } from "../src/artifact-tools.ts";
import { ArtifactStore, ArtifactUrlSigner, detectMimeType, parseRange, serveArtifact } from "../src/artifacts.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";
import { authSecret } from "../src/device-auth.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];
const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const APP_ORIGIN = "https://app.example";
/** The first bytes of a WebM file: enough for the sniffer, whatever the name says. */
const WEBM_HEAD = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

function lastText(request: TranscriptContext): { role: string; text: string } {
	const last = request.messages.findLast((message) => message.role !== "system");
	const content = (last as { content?: unknown } | undefined)?.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("")
				: "";
	return { role: last?.role ?? "", text };
}

async function start(options: Parameters<typeof createSetup>[0] = {}): Promise<{ test: TestSetup; client: TestClient; projectId: string }> {
	const test = await createSetup({ allowedOrigins: [APP_ORIGIN], ...options });
	cleanups.push(test.cleanup);
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw errorOf(added);
	const configured = await client.request({
		type: "projects.configure",
		projectId: added.project.id,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
		workerModels: [FAUX],
	});
	if (configured.type !== "projects.configure") throw errorOf(configured);
	return { test, client, projectId: added.project.id };
}

/**
 * Has the coordinator make the given `artifact_save` calls, one per turn, and answers with each call's result text.
 */
async function saveThroughTool(
	test: TestSetup,
	client: TestClient,
	projectId: string,
	calls: JsonObject[],
): Promise<string[]> {
	const results: string[] = [];
	for (const [index, args] of calls.entries()) {
		test.faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("artifact_save", args)], { stopReason: "toolUse" }),
			(request: TranscriptContext) => {
				results.push(lastText(request).text);
				return fauxAssistantMessage("Saved.");
			},
		]);
		const submitted = await client.request({ type: "conversation.submit", projectId, requestId: `save-${index}`, content: "Keep it." });
		if (submitted.type !== "conversation.submit") throw errorOf(submitted);
		await until(() => results.length === index + 1);
	}
	return results;
}

async function list(client: TestClient, projectId: string, filter: Record<string, unknown> = {}): Promise<Artifact[]> {
	const response = await client.request({ type: "artifacts.list", projectId, ...filter });
	if (response.type !== "artifacts.list") throw errorOf(response);
	return response.artifacts;
}

async function urlOf(client: TestClient, projectId: string, artifactId: string, download = false): Promise<string> {
	const response = await client.request({ type: "artifacts.url", projectId, artifactId, download });
	if (response.type !== "artifacts.url") throw errorOf(response);
	return response.url;
}

describe("artifact_save", () => {
	it("updates by name with short version results and pins signed URLs to selected snapshots", async () => {
		const { test, client, projectId } = await start();
		const path = join(test.projectDir, "report.html");
		await writeFile(path, "<h1>First</h1>");
		const outputs = await saveThroughTool(test, client, projectId, [{ path }, { path }, { path }]);
		expect(outputs[0]).toStartWith("Saved artifact ");
		expect(outputs[1]).toBe("Saved version 2 of report.html (text, 14 B).");
		expect(outputs[2]).toBe("Saved version 3 of report.html (text, 14 B).");
		const cards = await list(client, projectId);
		expect(cards).toHaveLength(1);
		const artifact = cards[0]!;
		expect(artifact.versionCount).toBe(3);
		expect(await list(client, projectId, { artifactId: artifact.id })).toEqual([artifact]);
		expect(await list(client, projectId, { artifactId: "missing" })).toEqual([]);
		expect(artifact.versions?.map(v => v.version)).toEqual([1, 2, 3]);
		const latestUrl = await urlOf(client, projectId, artifact.id);
		expect(new URL(latestUrl).pathname).toEndWith(artifact.id + "~3");
		await writeFile(path, "<h1>Fourth</h1>");
		await test.server.artifacts.save({ projectId, sourcePath: path, title: null, note: null, threadId: "main", workerId: null, taskId: null });
		expect(await (await fetch(latestUrl)).text()).toBe("<h1>First</h1>");
		const fourthUrl = await urlOf(client, projectId, artifact.id);
		expect(await (await fetch(fourthUrl)).text()).toBe("<h1>Fourth</h1>");
		const oldUrl = await urlOf(client, projectId, artifact.id + "~1");
		expect(await (await fetch(oldUrl)).text()).toBe("<h1>First</h1>");
		const tampered = oldUrl.replace("~1?", "~4?");
		expect((await fetch(tampered)).status).toBe(403);
		const missing = await client.request({ type: "artifacts.url", projectId, artifactId: artifact.id + "~99" });
		expect(missing.type).toBe("error");
	});

	it("copies a file from the cwd and from an absolute path, and pushes each save", async () => {
		const { test, client, projectId } = await start();
		await mkdir(join(test.projectDir, "out"), { recursive: true });
		await writeFile(join(test.projectDir, "out", "demo.webm"), WEBM_HEAD);
		const outside = await mkdtemp(join(tmpdir(), "artifact-source-"));
		cleanups.push(() => rm(outside, { recursive: true, force: true }));
		await writeFile(join(outside, "notes.md"), "# Notes\n");

		const results = await saveThroughTool(test, client, projectId, [
			{ path: "out/demo.webm", title: "Checkout flow", note: "The **happy** path.", taskId: "T3" },
			{ path: join(outside, "notes.md") },
		]);
		expect(results[0]).toMatch(/^Saved artifact [a-z0-9-]+: demo\.webm \(video, 9 B\)\.$/);
		expect(results[1]).toContain("notes.md (text,");

		const [notes, demo] = await list(client, projectId);
		expect(demo).toMatchObject({
			projectId,
			name: "demo.webm",
			title: "Checkout flow",
			note: "The **happy** path.",
			kind: "video",
			mimeType: "video/webm",
			size: 9,
			threadId: "main",
			workerId: null,
			taskId: "T3",
			sourcePath: join(test.projectDir, "out", "demo.webm"),
		});
		expect(notes).toMatchObject({ name: "notes.md", kind: "text", mimeType: "text/markdown", title: null, taskId: null });
		// A copy: the source stays, and the store has its own bytes.
		expect(existsSync(join(test.projectDir, "out", "demo.webm"))).toBe(true);
		expect(existsSync(join(test.dataDir, "projects", projectId, "artifacts", demo?.id ?? "", "demo.webm"))).toBe(true);

		const pushed = await client.waitFor(
			(message: ServerMessage) => message.type === "artifacts.changed" && message.artifact.id === demo?.id,
		);
		expect(pushed).toMatchObject({ type: "artifacts.changed", projectId, deleted: false });
	}, 30_000);

	it("saves from a code mode script", async () => {
		const { test, client, projectId } = await start();
		let result = "";
		test.faux.setResponses([
			() =>
				fauxAssistantMessage(
					[fauxToolCall("codemode", { code: 'const r = await tools.artifact_save({ path: "README.md", title: "Readme" }); return r;' })],
					{ stopReason: "toolUse" },
				),
			(request: TranscriptContext) => {
				result = lastText(request).text;
				return fauxAssistantMessage("Saved.");
			},
		]);
		await client.request({ type: "conversation.submit", projectId, requestId: "script", content: "Keep the readme." });
		await until(() => result.length > 0);
		expect(result).toContain("Saved artifact");
		expect((await list(client, projectId))[0]).toMatchObject({ name: "README.md", title: "Readme", kind: "text" });
	}, 30_000);

	it("records the worker that saved it", async () => {
		const { test, client, projectId } = await start();
		await writeFile(join(test.projectDir, "shot.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
		const BRIEF = "Take the screenshot.";
		let saved = false;
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				const { role, text } = lastText(request);
				if (role === "toolResult") {
					if (text.startsWith("Saved artifact")) saved = true;
					return fauxAssistantMessage(saved ? "## Report\nOutcome: done" : "Tool call finished.");
				}
				if (text === BRIEF) return fauxAssistantMessage([fauxToolCall("artifact_save", { path: "shot.png" })], { stopReason: "toolUse" });
				if (text.includes("Delegate")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "shooter", task: BRIEF })], { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the screenshot." });
		await until(async () => (await list(client, projectId)).length === 1);
		expect((await list(client, projectId))[0]).toMatchObject({ name: "shot.png", kind: "image", workerId: "shooter", threadId: "main" });
		expect(await list(client, projectId, { workerId: "shooter" })).toHaveLength(1);
		expect(await list(client, projectId, { workerId: "other" })).toHaveLength(0);
	}, 30_000);

	it("refuses directories, missing files and files outside the readable paths", async () => {
		const { test, client, projectId } = await start();
		await mkdir(join(test.projectDir, "dir"));
		await symlink(join(test.dataDir, "artifacts-secret"), join(test.projectDir, "secret-link"));
		const results = await saveThroughTool(test, client, projectId, [
			{ path: "dir" },
			{ path: "missing.txt" },
			{ path: "/etc/hostname" },
			{ path: join(test.dataDir, "artifacts-secret") },
			// A symlink in the project is followed to where it really points.
			{ path: "secret-link" },
		]);
		expect(results[0]).toContain("is a directory");
		expect(results[1]).toContain("does not exist");
		for (const result of results.slice(2)) expect(result).toContain("outside the paths an artifact may come from");
		expect(await list(client, projectId)).toEqual([]);
	}, 30_000);

	it("reads main's and a thread's worker workspaces inside the data directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "artifact-paths-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const dataDir = join(root, "data");
		const workspace = join(dataDir, "projects", "p", "workspaces", "w1");
		await mkdir(workspace, { recursive: true });
		await writeFile(join(workspace, "out.log"), "ok\n");
		await writeFile(join(dataDir, "credentials.json"), "{}");
		const threadsDir = join(dataDir, "projects", "p", "threads");
		const threadWorker = join(threadsDir, "t1", "workers", "w1");
		await mkdir(threadWorker, { recursive: true });
		await writeFile(join(threadWorker, "clip.webm"), "ok\n");
		const options = {
			cwd: workspace,
			projectPath: join(root, "project"),
			dataDir,
			workspaceDirs: [join(dataDir, "projects", "p", "workspaces"), threadsDir],
		};
		expect(await resolveArtifactSource({ ...options, path: "out.log" })).toEqual({ ok: true, path: join(workspace, "out.log") });
		expect((await resolveArtifactSource({ ...options, path: "../../../../credentials.json" })).ok).toBe(false);
		expect(await resolveArtifactSource({ ...options, cwd: threadWorker, path: "clip.webm" })).toEqual({
			ok: true,
			path: join(threadWorker, "clip.webm"),
		});
	});
});

describe("temporary paths and text transport", () => {
	it.each(["off", "optional", "required"] as const)("allows both installed loopback shell origins for text GET/Range/OPTIONS in %s mode", async (mode) => {
		const webDir = await mkdtemp(join(tmpdir(), "artifact-web-"));
		const test = await createSetup({ auth: { mode }, allowedOrigins: [], webDir });
		cleanups.push(test.cleanup, () => rm(webDir, { recursive: true, force: true }));
		const client = await TestClient.open(test.server);
		clients.push(client);
		if (mode === "required") {
			const grant = test.server.auth.bootstrap();
			const result = await test.server.auth.redeem({ grantId: grant.requestId, secret: grant.secret, claimId: crypto.randomUUID(), claimSecret: authSecret("aiki_c1"), label: "Synthetic browser", platform: "web" }, "loopback", true);
			await client.request({ type: "hello", protocolVersion: 1, auth: { accessToken: result.credentials!.accessToken } });
		} else await client.hello();
		const added = await client.request({ type: "projects.add", path: test.projectDir });
		if (added.type !== "projects.add") throw errorOf(added);
		const projectId = added.project.id;
		const content = "# Report\nCafé ✓\n".repeat(900);
		await writeFile(join(test.projectDir, "report.md"), content);
		const artifact = await test.server.artifacts.save({ projectId, sourcePath: join(test.projectDir, "report.md"), title: null, note: null, threadId: "main", workerId: null, taskId: null });
		const url = await urlOf(client, projectId, artifact.id);
		const loopbacks = [test.server.url, test.server.url.replace("127.0.0.1", "localhost")];
		for (const origin of loopbacks) {
			for (const range of [undefined, "bytes=0-262143"]) {
				const response = await fetch(url, { headers: { origin, ...(range ? { range } : {}) } });
				expect(response.status).toBe(range ? 206 : 200);
				expect(response.headers.get("access-control-allow-origin")).toBe(origin);
				expect(response.headers.get("access-control-expose-headers")).toContain("Content-Range");
				expect(await response.text()).toBe(content);
			}
			const preflight = await fetch(url, { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "range" } });
			expect(preflight.status).toBe(204);
			expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
			expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("range");
		}
		for (const origin of ["https://evil.example", "http://localhost:1", "http://127.0.0.1:1", "null"]) {
			const response = await fetch(url, { headers: { origin } });
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
			await response.arrayBuffer();
		}
	}, 30_000);

	it("resolves both spellings of a symlinked system temp root, with or without a trailing slash", async () => {
		const root = await mkdtemp(join(tmpdir(), "artifact-temp-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const real = join(root, "private", "var", "folders", "sample", "T");
		await mkdir(real, { recursive: true });
		await mkdir(join(root, "project"));
		await symlink(join(root, "private", "var"), join(root, "var"));
		const alias = join(root, "var", "folders", "sample", "T");
		await writeFile(join(real, "report.md"), "# café ✓\n");
		const previous = process.env.TMPDIR;
		try {
			for (const suffix of ["", "/"]) {
				process.env.TMPDIR = alias + suffix;
				for (const from of [real, alias]) {
					expect(await resolveArtifactSource({ path: join(from, "report.md"), cwd: join(root, "project"), projectPath: join(root, "project"), dataDir: join(root, "data"), workspaceDirs: [] })).toEqual({ ok: true, path: await realpath(join(real, "report.md")) });
				}
			}
		} finally { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; }
	});

	it("returns readable CORS errors when storage fails before a text response", async () => {
		const signer = new ArtifactUrlSigner({ secret: Buffer.alloc(32) });
		const { path } = signer.sign("p", "a", "inline");
		const logs: string[] = [];
		const response = await serveArtifact(new Request(`http://backend.example${path}`, { headers: { origin: APP_ORIGIN, range: "bytes=0-262143" } }), {
			store: { get: async () => { throw new Error("disk unavailable"); } } as unknown as ArtifactStore,
			signer, allowedOrigins: [APP_ORIGIN], log: line => logs.push(line),
		});
		expect(response?.status).toBe(500);
		expect(response?.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
		expect(await response?.text()).toContain("could not read this artifact");
		expect(logs).toEqual(["artifacts: could not read p/a"]);
	});
});

describe("the store", () => {
	it("refuses a file over the size cap and leaves nothing behind", async () => {
		const root = await mkdtemp(join(tmpdir(), "artifact-store-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const store = new ArtifactStore({ dataDir: root, maxFileBytes: 4, probeDuration: async () => null });
		await writeFile(join(root, "big.txt"), "12345");
		const base = { projectId: "p", title: null, note: null, threadId: "main", workerId: null, taskId: null };
		await expect(store.save({ ...base, sourcePath: join(root, "big.txt") })).rejects.toThrow("over the 4 byte limit");
		expect(await store.list("p")).toEqual([]);
		expect(existsSync(store.dir("p")) ? (await Array.fromAsync(new Bun.Glob("*").scan(store.dir("p")))).length : 0).toBe(0);
	});

	it("lists newest first, filtered and limited, and a rerun with the same ID saves once", async () => {
		const root = await mkdtemp(join(tmpdir(), "artifact-store-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		let clock = Date.parse("2026-11-04T10:00:00Z");
		const store = new ArtifactStore({ dataDir: root, now: () => (clock += 1000), probeDuration: async () => 12.5 });
		await writeFile(join(root, "a.mp4"), "not really a video");
		const base = { projectId: "p", sourcePath: join(root, "a.mp4"), title: null, note: null };
		const one = await store.save({ ...base, threadId: "main", workerId: null, taskId: "T1" });
		const two = await store.save({ ...base, threadId: "t-2", workerId: "w1", taskId: "T1" });
		const three = await store.save({ ...base, threadId: "main", workerId: "w1", taskId: null, artifactId: "fixed-id" });
		expect(await store.save({ ...base, threadId: "main", workerId: "w1", taskId: null, artifactId: "fixed-id" })).toEqual(three);
		expect(one).toMatchObject({ kind: "video", mimeType: "video/mp4", durationSeconds: 12.5 });

		expect((await store.list("p")).map((artifact) => artifact.id)).toEqual([three.id, two.id]);
		expect(two.id).toBe(one.id);
		expect(two.version).toBe(2);
		expect((await store.list("p", { threadId: "main" })).map((artifact) => artifact.id)).toEqual([three.id]);
		expect((await store.list("p", { workerId: "w1", taskId: "T1" })).map((artifact) => artifact.id)).toEqual([two.id]);
		expect((await store.list("p", { limit: 1 })).map((artifact) => artifact.id)).toEqual([three.id]);
		expect(await store.list("other")).toEqual([]);
	});

	it("detects types from the extension and the first bytes", () => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(detectMimeType("shot.jpg", png)).toBe("image/png");
		expect(detectMimeType("recording", WEBM_HEAD)).toBe("video/webm");
		expect(detectMimeType("recording.mkv", WEBM_HEAD)).toBe("video/x-matroska");
		expect(detectMimeType("voice.weba", WEBM_HEAD)).toBe("audio/webm");
		expect(detectMimeType("clip.mov", new TextEncoder().encode("\0\0\0\x14ftypqt  "))).toBe("video/quicktime");
		expect(detectMimeType("film.ogv", new TextEncoder().encode("OggS"))).toBe("video/ogg");
		expect(detectMimeType("README", new TextEncoder().encode("hello"))).toBe("text/plain");
		expect(detectMimeType("blob", new Uint8Array([1, 0, 2]))).toBe("application/octet-stream");
	});
});

describe("signed URLs", () => {
	it("accepts its own token until it expires and refuses a tampered one", () => {
		let now = 1_000_000;
		const signer = new ArtifactUrlSigner({ secret: Buffer.alloc(32, 7), now: () => now, ttlMs: 60_000 });
		const { path, expiresAt } = signer.sign("p", "a1", "inline");
		const token = new URL(path, "http://x").searchParams.get("token") ?? "";
		expect(expiresAt).toBe(new Date(1_060_000).toISOString());
		expect(signer.verify("p", "a1", token)).toBe("inline");
		expect(signer.verify("p", "a2", token)).toBeUndefined();
		expect(signer.verify("q", "a1", token)).toBeUndefined();
		expect(signer.verify("p", "a1", token.replace(".i.", ".a."))).toBeUndefined();
		expect(signer.verify("p", "a1", token.replace(/^\d+/, "99999999"))).toBeUndefined();
		const mac = token.split(".")[2] ?? "";
		expect(signer.verify("p", "a1", token.slice(0, -mac.length) + (mac[0] === "A" ? "B" : "A") + mac.slice(1))).toBeUndefined();
		expect(signer.verify("p", "a1", null)).toBeUndefined();
		expect(new ArtifactUrlSigner({ secret: Buffer.alloc(32, 8), now: () => now }).verify("p", "a1", token)).toBeUndefined();
		now = 1_060_000;
		expect(signer.verify("p", "a1", token)).toBeUndefined();
	});

	it("parses one byte range", () => {
		expect(parseRange(null, 10)).toBeUndefined();
		expect(parseRange("bytes=0-3", 10)).toEqual({ start: 0, end: 3 });
		expect(parseRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
		expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
		expect(parseRange("bytes=5-100", 10)).toEqual({ start: 5, end: 9 });
		expect(parseRange("bytes=10-", 10)).toBeNull();
		expect(parseRange("bytes=0-1,4-5", 10)).toBeUndefined();
	});
});

describe("serving and deleting", () => {
	async function withArtifact(
		options: Parameters<typeof createSetup>[0] = {},
	): Promise<{ test: TestSetup; client: TestClient; projectId: string; artifact: Artifact }> {
		const setup = await start(options);
		await writeFile(join(setup.test.projectDir, "clip ü.webm"), new Uint8Array([...WEBM_HEAD, ...Array.from({ length: 91 }, (_, i) => i)]));
		await saveThroughTool(setup.test, setup.client, setup.projectId, [{ path: "clip ü.webm" }]);
		const [artifact] = await list(setup.client, setup.projectId);
		if (artifact === undefined) throw new Error("not saved");
		return { ...setup, artifact };
	}

	it("serves the bytes with ranges, the right headers and CORS for allowed origins", async () => {
		const { test, client, projectId, artifact } = await withArtifact();
		const url = await urlOf(client, projectId, artifact.id);
		expect(url.startsWith(`${test.server.url}/artifacts/${projectId}/${artifact.id}~1?token=`)).toBe(true);

		const full = await fetch(url, { headers: { origin: APP_ORIGIN } });
		expect(full.status).toBe(200);
		expect(full.headers.get("content-type")).toBe("video/webm");
		expect(full.headers.get("accept-ranges")).toBe("bytes");
		expect(full.headers.get("content-length")).toBe("100");
		expect(full.headers.get("cache-control")).toContain("private");
		expect(full.headers.get("content-disposition")).toBe(`inline; filename="clip _.webm"; filename*=UTF-8''clip%20%C3%BC.webm`);
		expect(full.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
		expect(full.headers.get("access-control-expose-headers")).toContain("Content-Range");
		expect(new Uint8Array(await full.arrayBuffer()).subarray(0, 4)).toEqual(WEBM_HEAD.subarray(0, 4));

		const partial = await fetch(url, { headers: { range: "bytes=10-19" } });
		expect(partial.status).toBe(206);
		expect(partial.headers.get("content-range")).toBe("bytes 10-19/100");
		expect(partial.headers.get("content-length")).toBe("10");
		expect([...new Uint8Array(await partial.arrayBuffer())]).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
		const tail = await fetch(url, { headers: { range: "bytes=-5" } });
		expect(tail.headers.get("content-range")).toBe("bytes 95-99/100");
		await tail.arrayBuffer();
		const beyond = await fetch(url, { headers: { range: "bytes=200-" } });
		expect(beyond.status).toBe(416);
		expect(beyond.headers.get("content-range")).toBe("bytes */100");
		await beyond.arrayBuffer();

		const other = await fetch(url, { headers: { origin: "https://evil.example" } });
		expect(other.status).toBe(200);
		expect(other.headers.get("access-control-allow-origin")).toBeNull();
		await other.arrayBuffer();
		const preflight = await fetch(url, { method: "OPTIONS", headers: { origin: APP_ORIGIN, "access-control-request-headers": "range" } });
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("access-control-allow-headers")).toContain("Range");

		const download = await fetch(await urlOf(client, projectId, artifact.id, true));
		expect(download.headers.get("content-disposition")?.startsWith("attachment;")).toBe(true);
		await download.arrayBuffer();
	}, 30_000);

	it("serves copied Markdown, text and HTML with exact UTF-8 range lengths after temp sources disappear", async () => {
		const { test, client, projectId } = await start();
		const source = join(test.root, "source");
		const alias = join(test.root, "alias");
		await mkdir(source);
		await symlink(source, alias);
		const content = "# Skill evaluation\n\nCafé ✓\n".repeat(500);
		for (const extension of ["md", "txt", "html"]) {
			await writeFile(join(alias, `report.${extension}`), content);
		}
		const results = await saveThroughTool(test, client, projectId, ["md", "txt", "html"].map(extension => ({ path: join(alias, `report.${extension}`) })));
		for (const result of results) expect(result).toContain("Saved artifact");
		await rm(source, { recursive: true });
		const bytes = new TextEncoder().encode(content);
		for (const artifact of await list(client, projectId)) {
			const url = await urlOf(client, projectId, artifact.id);
			for (const range of [undefined, "bytes=0-262143", "bytes=10-99"]) {
				const response = await fetch(url, { headers: { origin: APP_ORIGIN, ...(range ? { range } : {}) } });
				expect(response.status).toBe(range ? 206 : 200);
				const expected = range === "bytes=10-99" ? bytes.slice(10, 100) : bytes;
				expect(response.headers.get("content-length")).toBe(String(expected.length));
				expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
				if (range) expect(response.headers.get("content-range")).toBe(range === "bytes=10-99" ? `bytes 10-99/${bytes.length}` : `bytes 0-${bytes.length - 1}/${bytes.length}`);
				expect(response.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
				expect(response.headers.get("access-control-expose-headers")).toContain("Content-Range");
			}
			const preflight = await fetch(url, { method: "OPTIONS", headers: { origin: APP_ORIGIN, "access-control-request-method": "GET", "access-control-request-headers": "range" } });
			expect(preflight.status).toBe(204);
			expect(preflight.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
			expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("range");
		}
	}, 30_000);

	it("never serves without a valid token", async () => {
		const { test, client, projectId, artifact } = await withArtifact();
		const url = new URL(await urlOf(client, projectId, artifact.id));
		const bare = `${test.server.url}${url.pathname}`;
		expect((await fetch(bare)).status).toBe(403);
		const token = url.searchParams.get("token") ?? "";
		// Change a character in the middle of the MAC, and separately the last one (only 4 of its bits are data).
		const middle = token.length - 20;
		const flip = (c: string) => (c === "A" ? "B" : "A");
		const tampered = `${token.slice(0, middle)}${flip(token[middle] as string)}${token.slice(middle + 1)}`;
		expect((await fetch(`${bare}?token=${tampered}`)).status).toBe(403);
		expect((await fetch(`${bare}?token=${token.replace(/.$/, flip)}`)).status).toBe(403);
		// A token for one artifact does not open another.
		expect((await fetch(`${test.server.url}/artifacts/${projectId}/someone-else${url.search}`)).status).toBe(403);
	}, 30_000);

	it("expires URLs", async () => {
		const { client, projectId, artifact } = await withArtifact({ artifacts: { urlTtlMs: 1_000 } });
		const url = await urlOf(client, projectId, artifact.id);
		const response = await fetch(url);
		expect(response.status).toBe(200);
		await response.arrayBuffer();
		await new Promise((resolve) => setTimeout(resolve, 1_100));
		expect((await fetch(url)).status).toBe(403);
	}, 30_000);

	it("deletes the row and the bytes, and pushes the deletion", async () => {
		const { test, client, projectId, artifact } = await withArtifact();
		const url = await urlOf(client, projectId, artifact.id);
		const deleted = await client.request({ type: "artifacts.delete", projectId, artifactId: artifact.id });
		expect(deleted.type).toBe("artifacts.delete");
		expect(await list(client, projectId)).toEqual([]);
		expect(existsSync(join(test.dataDir, "projects", projectId, "artifacts", artifact.id))).toBe(false);
		expect((await fetch(url)).status).toBe(404);
		await client.waitFor((message) => message.type === "artifacts.changed" && message.deleted);
		const again = await client.request({ type: "artifacts.delete", projectId, artifactId: artifact.id });
		expect(errorOf(again).code).toBe("unknown_artifact");
		expect(errorOf(await client.request({ type: "artifacts.url", projectId, artifactId: artifact.id })).code).toBe("unknown_artifact");
	}, 30_000);
});

describe("tags", () => {
	it("normalises tags: trim, lowercase, dedupe, characters, length and count caps", () => {
		expect(normalizeTags(["  Web ", "PHONE", "web", "Dark Mode", "a/b", "", "  ", "!!!"])).toEqual(["web", "phone", "dark-mode", "a-b"]);
		expect(normalizeTag("x".repeat(40))).toHaveLength(ARTIFACT_MAX_TAG_LENGTH);
		expect(normalizeTag("-before-")).toBe("before");
		expect(normalizeTag("v1.2")).toBe("v1.2");
		expect(normalizeTags(Array.from({ length: 30 }, (_, index) => `tag${index}`))).toHaveLength(ARTIFACT_MAX_TAGS);
		expect(normalizeTags(undefined)).toEqual([]);
	});

	it("saves normalised tags from artifact_save, lists them, and says them in the result", async () => {
		const { test, client, projectId } = await start();
		await writeFile(join(test.projectDir, "shot.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
		await writeFile(join(test.projectDir, "plain.txt"), "hi");
		const results = await saveThroughTool(test, client, projectId, [
			{ path: "shot.png", tags: ["Web", "phone ", "DARK", "web"] },
			{ path: "plain.txt" },
		]);
		expect(results[0]).toContain("tags web, phone, dark");
		const [plain, shot] = await list(client, projectId);
		expect(shot?.tags).toEqual(["web", "phone", "dark"]);
		// No tags means no key: older readers and rows saved before tags look the same.
		expect(plain && "tags" in plain).toBe(false);
	}, 30_000);

	it("keeps the fixed tag guidance in artifact_save's description", () => {
		const extension = createArtifactExtension({
			store: new ArtifactStore({ dataDir: tmpdir() }),
			project: () => ({}) as never,
			workspaceDirs: [],
			workerIdOf: async () => null,
		});
		const tool = extension.tools?.find((candidate) => candidate.name === "artifact_save");
		expect(tool?.description).toContain(ARTIFACT_TAG_GUIDANCE);
		expect(tool?.description).toContain("`web, phone, dark`");
		expect(JSON.stringify(tool?.parameters)).toContain('"tags"');
	});

	it("updates tags with artifacts.update, normalised, pushes the change, and clears them", async () => {
		const { test, client, projectId } = await start();
		expect(test.server.features).toContain("artifact-tags");
		await writeFile(join(test.projectDir, "plain.txt"), "hi");
		await saveThroughTool(test, client, projectId, [{ path: "plain.txt", tags: ["before"] }]);
		const [saved] = await list(client, projectId);

		const updated = await client.request({ type: "artifacts.update", projectId, artifactId: saved?.id ?? "", tags: [" After", "WEB", "after"] });
		if (updated.type !== "artifacts.update") throw errorOf(updated);
		expect(updated.artifact.tags).toEqual(["after", "web"]);
		const pushed = await client.waitFor(
			(message: ServerMessage) =>
				message.type === "artifacts.changed" && message.artifact.id === saved?.id && message.artifact.tags?.[0] === "after",
		);
		expect(pushed).toMatchObject({ deleted: false });
		expect((await list(client, projectId))[0]?.tags).toEqual(["after", "web"]);

		const cleared = await client.request({ type: "artifacts.update", projectId, artifactId: saved?.id ?? "", tags: ["  "] });
		if (cleared.type !== "artifacts.update") throw errorOf(cleared);
		expect("tags" in cleared.artifact).toBe(false);
		expect("tags" in ((await list(client, projectId))[0] as Artifact)).toBe(false);

		const missing = await client.request({ type: "artifacts.update", projectId, artifactId: "nope", tags: ["x"] });
		expect(missing).toMatchObject({ type: "error", error: { code: "unknown_artifact" } });
	}, 30_000);

	it("keeps tags through the store and a restart's re-read", async () => {
		const root = await mkdtemp(join(tmpdir(), "artifact-store-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const store = new ArtifactStore({ dataDir: root, probeDuration: async () => null });
		await writeFile(join(root, "a.txt"), "x");
		const base = { projectId: "p", sourcePath: join(root, "a.txt"), title: null, note: null, threadId: "main", workerId: null, taskId: null };
		const saved = await store.save({ ...base, tags: ["Android", "tablet"] });
		await store.updateTags("p", saved.id, ["android", "dark"]);
		expect((await new ArtifactStore({ dataDir: root }).get("p", saved.id))?.tags).toEqual(["android", "dark"]);
	});
});
