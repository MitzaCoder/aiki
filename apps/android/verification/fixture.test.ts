import { test, expect } from "bun:test";
import { startFixture } from "./fixture.ts";
import { connect } from "./wire.ts";

const projectId = "android-fixture";
test("contract fixture: hello, IDs/errors, thread-scoped watch/page/context/submit, dedup and events", async () => {
	const server = startFixture({ port: 0 });
	const client = await connect(server.url);
	try {
		expect(
			(await client.request("threads.list", { projectId })).error.code,
		).toBe("not_ready");
		expect(
			(await client.request("hello", { protocolVersion: 2 })).error.code,
		).toBe("unsupported_protocol");
		expect(
			(await client.request("hello", { protocolVersion: 1 })).server.name,
		).toContain("FIXTURE");
		expect((await client.request("projects.list")).projects[0].id).toBe(
			projectId,
		);
		expect((await client.request("board.get", { projectId })).error.code).toBe(
			"unknown_request",
		);
		expect(
			(await client.request("threads.list", { projectId: "absent" })).error
				.code,
		).toBe("unknown_project");
		expect(
			(await client.request("threads.list", { projectId })).threads.map(
				(t: any) => t.id,
			),
		).toEqual(["main", "background"]);
		expect(
			(await client.request("threads.stop", { projectId, threadId: "main" }))
				.error.code,
		).toBe("bad_request");
		expect(
			(await client.request("threads.stop", { projectId, threadId: "missing" }))
				.error.code,
		).toBe("unknown_thread");
		const scope = { projectId, threadId: "background" };
		const watch = await client.request("conversation.watch", {
			...scope,
			min: 1,
		});
		expect(watch.conversationId).toBe(2);
		expect(watch.view.before).toBe(1);
		expect(
			(await client.request("conversation.context", scope)).context.threadId,
		).toBe("background");
		const submit = {
			...scope,
			requestId: "dedup",
			content: "Background input",
			whenBusy: "steer",
		};
		const admitted = await client.request("conversation.submit", submit);
		expect(
			(await client.request("conversation.submit", submit)).submissionId,
		).toBe(admitted.submissionId);
		expect(
			client.events.find((e) => e.type === "conversation.view").ops[0][0],
		).toBe("r");
		const page = await client.request("conversation.page", {
			...scope,
			limit: 1,
			order: "descending",
		});
		expect(page.entries[0].id).toBe(3);
		const next = await client.request("conversation.page", {
			...scope,
			cursor: page.next,
			limit: 1,
		});
		expect(next.entries[0].id).toBe(2);
		expect(
			(await client.request("conversation.page", { projectId })).entries.length,
		).toBe(2);
		expect(
			(await client.request("conversation.page", { ...scope, limit: 501 }))
				.error.code,
		).toBe("bad_request");
		expect((await client.request("threads.stop", scope)).thread.status).toBe(
			"stopped",
		);
		await client.request("threads.archive", { ...scope, archived: true });
		await client.request("threads.list", { projectId });
		expect(
			client.events.filter((e) => e.type === "threads.state").at(-1).threads
				.length,
		).toBe(1);
		expect(
			(
				await client.request("threads.list", {
					projectId,
					includeArchived: true,
				})
			).threads.length,
		).toBe(2);
		await client.request("conversation.unwatch", { watchId: watch.watchId });
		client.close();
		const reconnect = await connect(server.url);
		try {
			await reconnect.request("hello", { protocolVersion: 1 });
			expect(
				(await reconnect.request("conversation.submit", submit)).submissionId,
			).toBe(admitted.submissionId);
		} finally {
			reconnect.close();
		}
	} finally {
		client.close();
		server.stop();
	}
});

test("artifact contracts: filters, signed expiry/refresh, download, Range seeking, delete invalidation", async () => {
	let now = Date.parse("2026-01-01T00:00:00Z");
	const video = new Uint8Array(
		await Bun.file(
			new URL("./media/fixture.mp4", import.meta.url),
		).arrayBuffer(),
	);
	const server = startFixture({ port: 0, now: () => now, ttlMs: 100, video });
	const client = await connect(server.url);
	try {
		await client.request("hello", { protocolVersion: 1 });
		const all = await client.request("artifacts.list", { projectId });
		expect(all.artifacts.length).toBe(3);
		expect(
			(
				await client.request("artifacts.list", { projectId, threadId: "main" })
			).artifacts.map((a: any) => a.id),
		).toEqual(["text"]);
		expect(
			(await client.request("artifacts.list", { projectId, workerId: "none" }))
				.artifacts,
		).toEqual([]);
		const media = await client.request("artifacts.url", {
			projectId,
			artifactId: "video",
		});
		const range = await fetch(media.url, { headers: { Range: "bytes=16-31" } });
		expect(range.status).toBe(206);
		expect(range.headers.get("content-range")).toBe(
			`bytes 16-31/${video.length}`,
		);
		expect(new Uint8Array(await range.arrayBuffer())).toEqual(
			video.slice(16, 32),
		);
		const suffix = await fetch(media.url, { headers: { Range: "bytes=-8" } });
		expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(video.slice(-8));
		expect(
			(await fetch(media.url, { headers: { Range: `bytes=${video.length}-` } }))
				.status,
		).toBe(416);
		expect((await fetch(media.url + "bad")).status).toBe(403);
		now += 100;
		expect((await fetch(media.url)).status).toBe(403);
		const refreshed = await client.request("artifacts.url", {
			projectId,
			artifactId: "video",
			download: true,
		});
		expect(refreshed.url).not.toBe(media.url);
		const head = await fetch(refreshed.url, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-disposition")).toContain("attachment");
		await client.request("artifacts.delete", {
			projectId,
			artifactId: "video",
		});
		await client.request("artifacts.list", { projectId });
		expect(
			client.events.find((e) => e.type === "artifacts.changed").deleted,
		).toBe(true);
		expect((await fetch(refreshed.url)).status).toBe(404);
		expect(
			(
				await client.request("artifacts.url", {
					projectId,
					artifactId: "video",
				})
			).error.code,
		).toBe("unknown_artifact");
	} finally {
		client.close();
		server.stop();
	}
});

test("optional binary fixture supports explicit download without signed URL persistence", async () => {
    const binary = new Uint8Array([0, 255, 1, 128, 65, 0]);
    const server = startFixture({port:0, binary});
    const client = await connect(server.url);
    try {
        await client.request("hello",{protocolVersion:1});
        const listed = await client.request("artifacts.list",{projectId, threadId:"background"});
        expect(listed.artifacts.find((a:any)=>a.id === "file")?.kind).toBe("file");
        const signed = await client.request("artifacts.url",{projectId,artifactId:"file",download:true});
        const response = await fetch(signed.url);
        expect(response.headers.get("content-type")).toBe("application/octet-stream");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(binary);
    } finally { client.close(); server.stop(); }
});
