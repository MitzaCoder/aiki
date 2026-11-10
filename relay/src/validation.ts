import { createHash, timingSafeEqual } from "node:crypto";
export class RelayError extends Error {
	constructor(
		public status: number,
		public code: string,
		public retryAt?: number,
	) {
		super(code);
	}
}
/** Reject a failed public invariant without exposing request or provider error text. */
export function requireCondition(condition: unknown, status = 400, code = "invalid_request"): asserts condition {
	if (!condition) throw new RelayError(status, code);
}
/** Accept only an object with exactly the required and explicitly optional keys. */
export function parseObject(input: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
	requireCondition(input !== null && typeof input === "object" && !Array.isArray(input));
	const record = input as Record<string, unknown>;
	requireCondition(Object.keys(record).every((key) => required.includes(key) || optional.includes(key)));
	requireCondition(required.every((key) => Object.hasOwn(record, key)));
	return record;
}
/** Check canonical, unpadded base64url and, when specified, its decoded byte length. */
export function isBase64url(input: unknown, bytes?: number): input is string {
	if (typeof input !== "string" || !/^[A-Za-z0-9_-]+$/.test(input)) return false;
	const decoded = Buffer.from(input, "base64url");
	return decoded.toString("base64url") === input && (bytes === undefined || decoded.length === bytes);
}
/** Require a canonical random 128-bit identifier. */
export function requireId(input: unknown): asserts input is string {
	requireCondition(isBase64url(input, 16));
}
/** Hash a nonce, token or serialized envelope; capabilities additionally use credentialHash framing. */
export function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}
/** Hash a complete purpose-separated bearer with the frozen v1 UTF-8 compact-JSON domain separator. */
export function credentialHash(bearer: string): string {
	return sha256(JSON.stringify(["aiki-push-v1", "credential", bearer]));
}
/** Require the lowercase hexadecimal representation used for stored SHA-256 digests. */
export function requireDigest(input: unknown): asserts input is string {
	requireCondition(typeof input === "string" && /^[a-f0-9]{64}$/.test(input));
}
/** Compare two digest values without secret-dependent byte comparisons. */
export function constantTimeHashEqual(a: string, b: string): boolean {
	return (
		/^[a-f0-9]{64}$/.test(a) &&
		/^[a-f0-9]{64}$/.test(b) &&
		timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
	);
}
export interface Capability {
	routeId: string;
	digest: string;
}
/** Parse disjoint send/delete schemes before performing any route lookup. */
export function parseCapability(header: string | undefined, scheme: "send" | "delete"): Capability {
	const prefix = scheme === "send" ? "aiki_push1" : "aiki_push_delete1";
	const match = /^Bearer ([^. ]+)\.([^. ]+)\.([^. ]+)$/.exec(header ?? "");
	requireCondition(
		match && match[1] === prefix && isBase64url(match[2], 16) && isBase64url(match[3], 32),
		404,
		"not_found",
	);
	return { routeId: match[2], digest: credentialHash(match[1] + "." + match[2] + "." + match[3]) };
}
/** Validate only the strict outer envelope; ciphertext is opaque and never decoded as JSON. */
export function serializeEnvelope(input: unknown, routeId: string, messageId: string): string {
	requireCondition(typeof input === "string");
	requireCondition(Buffer.byteLength(input) <= 3584, 413, "body_too_large");
	let decoded: unknown;
	try {
		decoded = JSON.parse(input);
	} catch {
		throw new RelayError(400, "invalid_request");
	}
	const record = parseObject(decoded, ["v", "r", "k", "m", "n", "c"]);
	requireCondition(record.v === 1 && record.r === routeId && record.m === messageId);
	requireId(record.r);
	requireId(record.k);
	requireId(record.m);
	requireCondition(isBase64url(record.n, 12));
	requireCondition(isBase64url(record.c));
	const cipherLength = Buffer.from(record.c, "base64url").length;
	requireCondition(cipherLength <= 2064, 413, "body_too_large");
	requireCondition(cipherLength >= 272 && (cipherLength - 16) % 256 === 0);
	const compact = JSON.stringify({ v: 1, r: record.r, k: record.k, m: record.m, n: record.n, c: record.c });
	requireCondition(compact === input);
	requireCondition(Buffer.byteLength(JSON.stringify({ aiki: compact })) <= 3584, 413, "body_too_large");
	return compact;
}
/** Bound an opaque FCM address before reservation or external delivery. */
export function requireFcmToken(input: unknown): asserts input is string {
	requireCondition(typeof input === "string" && input.length > 0 && Buffer.byteLength(input) <= 4096);
	requireCondition(!/[\x00-\x20\x7f]/.test(input));
}
