/** ANDROID CONTRACT FIXTURE ONLY. In-memory, not a replacement for the checkout server. */
import { createHmac, randomBytes } from "node:crypto";
import { Value } from "../../../packages/protocol/node_modules/typebox/build/value/index.mjs";
import {
	ClientMessageSchema,
	ServerMessageSchema,
	type Artifact,
	type ThreadSummary,
	type EntryRecord,
} from "../../../packages/protocol/src/index.ts";
import type { ServerWebSocket } from "bun";

const projectId = "android-fixture";
const at = "2026-01-01T00:00:00.000Z";
type Socket = ServerWebSocket<{
	ready: boolean;
	watches: Map<string, { thread: string; min: number; max: number }>;
}>;
export function startFixture(
	options: {
		port?: number;
		now?: () => number;
		ttlMs?: number;
		video?: Uint8Array;
		image?: Uint8Array;
		binary?: Uint8Array;
	} = {},
) {
	const now = options.now ?? Date.now;
	const key = randomBytes(32);
	const sockets = new Set<Socket>();
	let sequence = 0;
	const threads: ThreadSummary[] = ["main", "background"].map((id, i) => ({
		id,
		title: i ? "Background contract fixture" : "Android contract fixture",
		status: i ? "running" : "idle",
		main: !i,
		startedBy: i ? "main" : null,
		scheduleId: null,
		conversationId: i + 1,
		model: null,
		thinkingLevel: null,
		onFinish: "review",
		runningWorkers: 0,
		ownedTasks: [],
		openQuestions: 0,
		current: i ? "Preparing a fixture report" : null,
		summary: null,
		failure: null,
		createdAt: at,
		updatedAt: at,
		finishedAt: null,
		archived: false,
	}));
	const entries = new Map<string, EntryRecord[]>(
		threads.map((t) => [
			t.id,
			[
				{
					id: 1,
					conversationId: t.conversationId,
					kind: "pi.user",
					model: [
						{
							role: "user",
							content: t.main
								? "[thread background finished] Fixture report ready"
								: "[from main] Please inspect the fixture",
							timestamp: 1767225600000,
						},
					],
				},
				{
					id: 2,
					conversationId: t.conversationId,
					kind: "pi.assistant",
					model: [
						{
							role: "assistant",
							content: [
								{
									type: "text",
									text: `# ${t.title}\n\n**Fixture only.** No model or production data used.`,
								},
							],
							timestamp: 1767225600000,
						},
					],
				},
			],
		]),
	);
	const submissions = new Map<string, number>();
	const bytes = new Map<string, Uint8Array>([
		[
			"text",
			new TextEncoder().encode(
				"Android artifact contract fixture\n0123123489\n",
			),
		],
		[
			"image",
			Uint8Array.from(
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
					"base64",
				),
			),
		],
	]);
	if (options.image) bytes.set("image", options.image);
	if (options.video) bytes.set("video", options.video);
	if (options.binary) bytes.set("file", options.binary);
	const artifacts: Artifact[] = [...bytes]
		.reverse()
		.map(([id, data], i) => ({
			id,
			projectId,
			name: `${id}.${id === "text" ? "txt" : id === "image" ? "png" : id === "file" ? "bin" : "mp4"}`,
			title: `Fixture ${id}`,
			note: "Synthetic Android verification media",
			kind: id as Artifact["kind"],
			mimeType:
				id === "text"
					? "text/plain"
					: id === "image"
						? "image/png"
						: id === "file" ? "application/octet-stream" : "video/mp4",
			size: data.length,
			durationSeconds: id === "video" ? 2 : null,
			threadId: id === "text" ? "main" : "background",
			workerId: null,
			taskId: null,
			sourcePath: `/fixture/${id}`,
			createdAt: new Date(Date.parse(at) - i * 1000).toISOString(),
		}));
	const send = (ws: Socket, value: unknown) => {
		if (!Value.Check(ServerMessageSchema, value))
			throw new Error(
				`Fixture emitted invalid wire message: ${JSON.stringify(value)}`,
			);
		ws.send(JSON.stringify(value));
	};
	const broadcast = (value: unknown) => {
		for (const ws of sockets) if (ws.data.ready) send(ws, value);
	};
	const view = (thread: string, min = 50) => {
		const all = entries.get(thread)!;
		const selected = all.slice(-min);
		return {
			conversation: {
				id: threads.find((t) => t.id === thread)!.conversationId,
			},
			entries: selected,
			before:
				all.length > selected.length
					? all[all.length - selected.length - 1]!.id
					: null,
			docs: {},
		};
	};
	const sign = (id: string, expires: string, download: string) =>
		createHmac("sha256", key)
			.update(`${id}:${expires}:${download}`)
			.digest("hex");
	const server = Bun.serve<Socket["data"]>({
		hostname: "127.0.0.1",
		port: options.port ?? 4791,
		fetch(request, server) {
			const url = new URL(request.url);
			if (
				url.pathname === "/ws" &&
				server.upgrade(request, { data: { ready: false, watches: new Map() } })
			)
				return;
			const id = url.pathname.slice("/media/".length);
			if (!url.pathname.startsWith("/media/") || !bytes.has(id))
				return new Response("Not found", { status: 404 });
			const expires = url.searchParams.get("expires") ?? "";
			const download = url.searchParams.get("download") ?? "0";
			if (
				!/^\d+$/.test(expires) ||
				now() >= Number(expires) ||
				url.searchParams.get("signature") !== sign(id, expires, download)
			)
				return new Response("Expired or invalid fixture URL", { status: 403 });
			if (request.method !== "GET" && request.method !== "HEAD")
				return new Response(null, { status: 405 });
			const data = bytes.get(id)!;
			const artifact = artifacts.find((a) => a.id === id)!;
			const headers = new Headers({
				"Content-Type": artifact.mimeType,
				"Accept-Ranges": "bytes",
				"Cache-Control": "no-store",
				"Content-Disposition": `${download === "1" ? "attachment" : "inline"}; filename="${artifact.name}"`,
			});
			let start = 0;
			let end = data.length - 1;
			let status = 200;
			const range = request.headers.get("range");
			if (range) {
				const match = /^bytes=(\d*)-(\d*)$/.exec(range);
				if (!match || (!match[1] && !match[2]))
					return new Response(null, {
						status: 416,
						headers: { "Content-Range": `bytes */${data.length}` },
					});
				start = match[1]
					? Number(match[1])
					: Math.max(0, data.length - Number(match[2]));
				end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
				if (start > end || start >= data.length)
					return new Response(null, {
						status: 416,
						headers: { "Content-Range": `bytes */${data.length}` },
					});
				status = 206;
				headers.set("Content-Range", `bytes ${start}-${end}/${data.length}`);
			}
			headers.set("Content-Length", String(end - start + 1));
			return new Response(
				request.method === "HEAD" ? null : data.slice(start, end + 1),
				{ status, headers },
			);
		},
		websocket: {
			open(ws) {
				sockets.add(ws);
			},
			close(ws) {
				sockets.delete(ws);
			},
			message(ws, raw) {
				let r: any;
				const error = (code: string, message: string) =>
					send(ws, {
						type: "error",
						...(typeof r?.id === "string" && r.id ? { id: r.id } : {}),
						error: { code, message },
					});
				try {
					r = JSON.parse(String(raw));
				} catch {
					error("bad_request", "Invalid JSON");
					return;
				}
				if (!r || typeof r !== "object") {
					error("bad_request", "Expected request");
					return;
				}
				if (r.type === "hello" && r.protocolVersion !== 1) {
					error("unsupported_protocol", "Use version 1");
					return;
				}
				const known = ClientMessageSchema.anyOf.some(
					(s) => s.properties.type.const === r.type,
				);
				if (!known) {
					error("unknown_request", "Not implemented by contract fixture");
					return;
				}
				if (!Value.Check(ClientMessageSchema, r)) {
					error("bad_request", "Request does not match final protocol");
					return;
				}
				const reply = (fields = {}) =>
					send(ws, { type: r.type, id: r.id, ...fields });
				if (r.type === "hello") {
					ws.data.ready = true;
					reply({
						protocolVersion: 1,
						server: { name: "ANDROID CONTRACT FIXTURE", version: "1" },
						features: ["threads", "artifacts"],
					});
					return;
				}
				if (!ws.data.ready) {
					error("not_ready", "Send hello first");
					return;
				}
				if ("projectId" in r && r.projectId !== projectId) {
					error("unknown_project", "Use android-fixture");
					return;
				}
				if ("workerId" in r && r.workerId && !r.type.startsWith("artifacts.")) {
					error("unknown_worker", "No workers in minimal fixture");
					return;
				}
				const thread = threads.find(
					(t) => t.id === ("threadId" in r ? (r.threadId ?? "main") : "main"),
				);
				if (!thread) {
					error("unknown_thread", "Thread not found");
					return;
				}
				switch (r.type) {
					case "projects.list":
						reply({
							projects: [
								{
									id: projectId,
									name: "ANDROID CONTRACT FIXTURE",
									path: "/fixture",
									coordinator: { model: null, thinkingLevel: null },
									workerModels: [],
									checkIns: { enabled: false, intervalMinutes: 10 },
									state: "closed",
								},
							],
						});
						break;
					case "threads.list":
						reply({
							threads: threads.filter((t) => r.includeArchived || !t.archived),
						});
						break;
					case "threads.stop":
					case "threads.archive":
						if (thread.main) {
							error("bad_request", "Main cannot be stopped or archived here");
							break;
						}
						if (r.type === "threads.stop") {
							thread.status = "stopped";
							thread.current = null;
							thread.finishedAt = new Date(now()).toISOString();
						} else thread.archived = r.archived;
						reply({ thread });
						broadcast({
							type: "threads.state",
							projectId,
							threads: threads.filter((t) => !t.archived),
						});
						break;
					case "conversation.watch": {
						const min = r.min ?? 50;
						const max = r.max ?? min * 2;
						if (max < min) {
							error("bad_request", "max must be at least min");
							break;
						}
						const watchId = `fixture-${++sequence}`;
						ws.data.watches.set(watchId, { thread: thread.id, min, max });
						const all = entries.get(thread.id)!;
						const fromIndex = all.findIndex((e) => e.id === r.from);
						reply({
							watchId,
							conversationId: thread.conversationId,
							view: view(
								thread.id,
								fromIndex >= 0 && all.length - fromIndex <= max
									? all.length - fromIndex
									: min,
							),
						});
						break;
					}
					case "conversation.unwatch":
						ws.data.watches.delete(r.watchId);
						reply({ watchId: r.watchId });
						break;
					case "conversation.page": {
						let query = r;
						if (r.cursor) {
							try {
								query = JSON.parse(
									Buffer.from(String(r.cursor.fixture), "base64url").toString(),
								);
								if (query.threadId !== thread.id) throw Error();
							} catch {
								error("bad_request", "Invalid fixture cursor");
								break;
							}
						}
						const desc =
							query.before !== undefined || query.order === "descending";
						let rows = entries
							.get(thread.id)!
							.filter(
								(e) =>
									e.id >= (query.minEntryId ?? 1) &&
									e.id <=
										(query.before !== undefined
											? query.before - 1
											: (query.maxEntryId ?? Infinity)),
							);
						if (desc) rows = rows.toReversed();
						const page = rows.slice(0, r.limit ?? 50);
						const last = page.at(-1);
						reply({
							entries: page,
							...(rows.length > page.length && last
								? {
										next: {
											fixture: Buffer.from(
												JSON.stringify({
													threadId: thread.id,
													order: desc ? "descending" : "ascending",
													minEntryId: desc ? query.minEntryId : last.id + 1,
													maxEntryId: desc ? last.id - 1 : query.maxEntryId,
												}),
											).toString("base64url"),
										},
									}
								: {}),
						});
						break;
					}
					case "conversation.submit": {
						const key = `${thread.id}:${r.requestId}`;
						let submissionId = submissions.get(key);
						if (!submissionId) {
							const all = entries.get(thread.id)!;
							submissionId = all.length + 1;
							submissions.set(key, submissionId);
							all.push({
								id: submissionId,
								conversationId: thread.conversationId,
								kind: "pi.user",
								model: [{ role: "user", content: r.content, timestamp: now() }],
							});
							for (const socket of sockets)
								for (const [watchId, watch] of socket.data.watches)
									if (watch.thread === thread.id)
										send(socket, {
											type: "conversation.view",
											watchId,
											ops: [["r", view(thread.id, watch.min)]],
										});
						}
						reply({ submissionId });
						break;
					}
					case "conversation.context":
						reply({
							context: {
								projectId,
								threadId: thread.id,
								workerId: null,
								cwd: `/fixture/${thread.id}`,
								projectPath: "/fixture",
								homeDir: "/fixture",
								systemPrompt: `Contract fixture context for ${thread.id}`,
								tools: [],
								contextFiles: [],
								skills: [],
							},
						});
						break;
					case "conversation.abort":
						reply();
						break;
					case "artifacts.list":
						reply({
							artifacts: artifacts
								.filter(
									(a) =>
										(!r.threadId || a.threadId === r.threadId) &&
										(!r.taskId || a.taskId === r.taskId) &&
										(!r.workerId || a.workerId === r.workerId),
								)
								.slice(0, r.limit ?? 100),
						});
						break;
					case "artifacts.url":
					case "artifacts.delete": {
						const index = artifacts.findIndex((a) => a.id === r.artifactId);
						const artifact = artifacts[index];
						if (!artifact) {
							error("unknown_artifact", "Artifact not found");
							break;
						}
						if (r.type === "artifacts.delete") {
							artifacts.splice(index, 1);
							bytes.delete(artifact.id);
							reply();
							broadcast({
								type: "artifacts.changed",
								projectId,
								artifact,
								deleted: true,
							});
						} else {
							const expires = String(now() + (options.ttlMs ?? 30_000));
							const download = r.download ? "1" : "0";
							reply({
								url: `http://127.0.0.1:${server.port}/media/${artifact.id}?expires=${expires}&download=${download}&signature=${sign(artifact.id, expires, download)}`,
								expiresAt: new Date(Number(expires)).toISOString(),
							});
						}
						break;
					}
					default:
						error(
							"unknown_request",
							"Use the real checkout server for this API",
						);
				}
			},
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}`,
		stop: () => server.stop(true),
	};
}
if (import.meta.main) {
	const videoPath = new URL("./media/fixture.mp4", import.meta.url);
	const video = (await Bun.file(videoPath).exists())
		? new Uint8Array(await Bun.file(videoPath).arrayBuffer())
		: undefined;
	const server = startFixture({
		port: Number(process.env.PORT ?? 4791),
		video,
		image: new Uint8Array(await Bun.file(new URL("./media/fixture.png", import.meta.url)).arrayBuffer()),
		binary: Uint8Array.from({length:256},(_,i)=>i),
	});
	console.log(
		`ANDROID CONTRACT FIXTURE ONLY ${server.url}; project android-fixture; state in memory; URL TTL 30s`,
	);
	for (const signal of ["SIGINT", "SIGTERM"] as const)
		process.on(signal, () => {
			server.stop();
			process.exit(0);
		});
}
