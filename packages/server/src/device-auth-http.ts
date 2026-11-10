/** Bounded JSON capability exchanges. Never echo request bodies or exception details. */
import { DeviceAuth, DeviceAuthError } from "./device-auth.ts";

export function authJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}
export function authFailure(error: unknown): Response {
	const e = error instanceof DeviceAuthError ? error : new DeviceAuthError("bad_request", 400);
	return authJson({ error: { code: e.code } }, e.status, e.retryAfter ? { "retry-after": String(e.retryAfter) } : {});
}
function string(body: Record<string, unknown>, key: string, max = 256): string {
	const v = body[key];
	if (typeof v !== "string" || !v.length || v.length > max) throw new DeviceAuthError("bad_request", 400);
	return v;
}
export async function readAuthBody(request: Request): Promise<Record<string, unknown>> {
	if (Number(request.headers.get("content-length") ?? 0) > 8192) throw new DeviceAuthError("body_too_large", 413);
	if (!request.headers.get("content-type")?.startsWith("application/json"))
		throw new DeviceAuthError("bad_request", 400);
	const reader = request.body?.getReader();
	let size = 0;
	const chunks: Uint8Array[] = [];
	if (reader)
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > 8192) {
					await reader.cancel();
					throw new DeviceAuthError("body_too_large", 413);
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
	const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
	if (body === null || typeof body !== "object" || Array.isArray(body)) throw new DeviceAuthError("bad_request", 400);
	return body as Record<string, unknown>;
}
export function bearer(request: Request): string {
	const value = request.headers.get("authorization");
	if (!value?.startsWith("Bearer ")) throw new DeviceAuthError("auth_required");
	return value.slice(7);
}
function claimProof(body: Record<string, unknown>) {
	const claimId = string(body, "claimId", 80),
		claimSecret = string(body, "claimSecret", 60);
	if (!/^[A-Za-z0-9_-]{1,80}$/.test(claimId) || !/^mh_c1\.[A-Za-z0-9_-]{43}$/.test(claimSecret))
		throw new DeviceAuthError("bad_request", 400);
	return { claimId, claimSecret };
}
export async function handleAuthHttp(
	request: Request,
	auth: DeviceAuth,
	source: string,
	local: boolean,
): Promise<Response> {
	try {
		const path = new URL(request.url).pathname;
		if (path === "/auth/status" && request.method === "GET") return authJson(auth.status());
		if (request.method !== "POST") return authJson({ error: { code: "not_found" } }, 404);
		// Limit before parsing even when a guessed ID is used.
		auth.limit(`auth-http:${source}`, 120);
		auth.limit("auth-http-global", 600);
		const body = await readAuthBody(request);
		switch (path) {
			case "/auth/session/refresh":
				return authJson(auth.refresh(bearer(request), source));
			case "/auth/session/rotate":
				return authJson(auth.rotate(bearer(request), string(body, "successorToken")));
			case "/auth/claims/poll": {
				const proof = claimProof(body);
				return authJson(auth.poll(proof.claimId, proof.claimSecret));
			}
			case "/auth/claims/ack": {
				const proof = claimProof(body);
				return authJson(auth.ack(proof.claimId, proof.claimSecret));
			}
			case "/auth/migration/claims":
				return authJson(
					await auth.migration(
						{ ...claimProof(body), label: string(body, "label", 120), platform: string(body, "platform", 40) },
						source,
					),
				);
			case "/auth/pairings/redeem":
				return authJson(
					await auth.redeem(
						{
							...claimProof(body),
							grantId: string(body, "grantId", 80),
							secret: string(body, "secret"),
							label: string(body, "label", 120),
							platform: string(body, "platform", 40),
						},
						source,
					),
				);
			case "/auth/bootstrap/redeem":
				return authJson(
					await auth.redeem(
						{
							...claimProof(body),
							grantId: string(body, "requestId", 80),
							secret: string(body, "code"),
							label: string(body, "label", 120),
							platform: string(body, "platform", 40),
						},
						source,
						true,
						local,
					),
				);
			default:
				return authJson({ error: { code: "not_found" } }, 404);
		}
	} catch (error) {
		return authFailure(error);
	}
}
