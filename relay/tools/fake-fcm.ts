import { appendFileSync, writeFileSync } from "node:fs";
import type { FcmMessage, FcmResult } from "../src/ports";

export interface CapturedMessage extends FcmMessage {
	index: number;
	time: number;
}
const modes: FcmResult[] = ["accepted", "unregistered", "rate_limited", "unavailable", "timeout"];

/** Standalone, synthetic-only loopback transport; never forwards a token/message to Google. */
export function startFakeFcm(port: number, captureFile: string) {
	writeFileSync(captureFile, "", { flag: "wx", mode: 0o600 });
	const messages: CapturedMessage[] = [];
	let mode: FcmResult = "accepted";
	return Bun.serve({
		hostname: "127.0.0.1",
		port,
		maxRequestBodySize: 16_384,
		async fetch(request) {
			const url = new URL(request.url);
			const json = (body: unknown, status = 200) =>
				Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
			try {
				if (request.method === "GET" && url.pathname === "/captured") {
					const afterText = url.searchParams.get("after") ?? "0";
					const after = Number(afterText);
					if (!/^(0|[1-9]\d*)$/.test(afterText) || !Number.isSafeInteger(after)) throw new Error();
					return json({ messages: messages.slice(after), next: messages.length });
				}
				if (request.method !== "POST") return json({ error: "not_found" }, 404);
				if (request.headers.get("content-type") !== "application/json") return json({ error: "content_type" }, 415);
				const body = (await request.json()) as Record<string, unknown>;
				if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
				if (url.pathname === "/mode") {
					if (Object.keys(body).length !== 1 || !modes.includes(body.mode as FcmResult)) throw new Error();
					mode = body.mode as FcmResult;
					return json({ mode });
				}
				if (url.pathname !== "/send") return json({ error: "not_found" }, 404);
				if (
					Object.keys(body).sort().join(",") !== "data,priority,token,ttlMs" ||
					typeof body.token !== "string" ||
					!body.data ||
					typeof body.data !== "object" ||
					Array.isArray(body.data) ||
					Object.values(body.data).some((value) => typeof value !== "string") ||
					!["high", "normal"].includes(body.priority as string) ||
					typeof body.ttlMs !== "number" ||
					!Number.isSafeInteger(body.ttlMs) ||
					body.ttlMs < 0
				)
					throw new Error();
				const message: CapturedMessage = {
					index: messages.length + 1,
					time: Date.now(),
					token: body.token,
					data: body.data as Record<string, string>,
					priority: body.priority as "high" | "normal",
					ttlMs: body.ttlMs,
				};
				appendFileSync(captureFile, JSON.stringify(message) + "\n");
				messages.push(message);
				// "timeout" is a deterministic ambiguous result, not an unbounded open HTTP connection.
				return new Response(mode, { headers: { "Cache-Control": "no-store" } });
			} catch {
				return json({ error: "invalid_fake_fcm_request" }, 400);
			}
		},
	});
}
