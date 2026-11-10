import type { NotificationPayload } from "./notifications.ts";

/** Frozen relay v1. Platform WebCrypto only; no runtime, transport or storage integration. */
export const PUSH_RELAY_VERSION = 1;
export const PUSH_RELAY_LIMITS = Object.freeze({
	plaintext: 2048,
	fcmData: 3584,
	sendBody: 4096,
	managementBody: 8192,
	fcmToken: 4096,
});
export const PUSH_RELAY_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const PUSH_RELAY_SKEW_MS = 5 * 60 * 1000;
export const PUSH_RELAY_RETENTION_MS = 13 * 60 * 60 * 1000;
export const PUSH_RELAY_WINDOW_SIZE = 4096;
export type RelayErrorCode =
	| "invalid"
	| "oversize"
	| "version"
	| "authentication"
	| "route"
	| "identity"
	| "confirmation"
	| "expired"
	| "clock"
	| "replay"
	| "event_duplicate";
/** A fixed, content-free validation or authentication failure. */
export class PushRelayError extends Error {
	constructor(readonly code: RelayErrorCode) {
		super(`push_relay_${code}`);
		this.name = "PushRelayError";
	}
}
function fail(code: RelayErrorCode): never {
	throw new PushRelayError(code);
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** Encode UTF-8 without Unicode normalization. */
export const relayUtf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text);
const compact = (value: unknown) => JSON.stringify(value);
/** Reject text exceeding a UTF-8 byte cap before parsing or allocation. */
export function checkRelaySize(text: string, cap: number): void {
	if (text.length > cap || relayUtf8(text).length > cap) fail("oversize");
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid");
	return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
	if (
		required.some((k) => !(k in value)) ||
		Object.keys(value).some((k) => !required.includes(k) && !optional.includes(k))
	)
		fail("invalid");
}
function json(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return fail("invalid");
	}
}
function string(value: unknown, cap: number, nonempty = true): string {
	if (typeof value !== "string" || (nonempty && !value.length) || decoder.decode(relayUtf8(value)) !== value)
		fail("invalid");
	checkRelaySize(value, cap);
	return value;
}
/** Encode canonical unpadded base64url. */
export function relayBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
/** Reject noncanonical base64url and any supplied decoded-length mismatch. */
export function relayUnbase64(value: unknown, length?: number): Uint8Array<ArrayBuffer> {
	if (typeof value !== "string" || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) fail("invalid");
	let bytes: Uint8Array<ArrayBuffer>;
	try {
		bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
	} catch {
		return fail("invalid");
	}
	if ((length !== undefined && bytes.length !== length) || relayBase64(bytes) !== value) fail("invalid");
	return bytes;
}
/** Validate a canonical 128-bit route, key, message or event ID. */
export function validateRelayId(value: unknown): string {
	relayUnbase64(value, 16);
	return value as string;
}
/** Generate a fresh CSPRNG-backed 128-bit ID. */
export function newRelayId(): string {
	return relayBase64(crypto.getRandomValues(new Uint8Array(16)));
}
/** Generate an independent CSPRNG-backed 256-bit secret or salt. */
export function newRelaySecret(): string {
	return relayBase64(crypto.getRandomValues(new Uint8Array(32)));
}
export type RelayCapabilityPurpose = "send" | "delete";
function bearerPrefix(purpose: RelayCapabilityPurpose): string {
	if (purpose === "send") return "aiki_push1";
	if (purpose === "delete") return "aiki_push_delete1";
	return fail("invalid");
}
/** Build one purpose-scoped capability after validating its ID and secret. */
export function buildRelayBearer(purpose: RelayCapabilityPurpose, routeId: string, secret = newRelaySecret()): string {
	validateRelayId(routeId);
	relayUnbase64(secret, 32);
	return `${bearerPrefix(purpose)}.${routeId}.${secret}`;
}
/** Reject malformed capabilities and capabilities for the opposite purpose. */
export function parseRelayBearer(bearer: string, purpose: RelayCapabilityPurpose): { routeId: string; secret: string } {
	checkRelaySize(bearer, 128);
	const parts = bearer.split(".");
	if (parts.length !== 3 || parts[0] !== bearerPrefix(purpose)) fail("invalid");
	const routeId = validateRelayId(parts[1]);
	const secret = parts[2]!;
	relayUnbase64(secret, 32);
	return { routeId, secret };
}
/** Hash the validated full capability with the frozen credential domain separator. */
export async function relayCredentialHash(
	bearer: string,
	purpose: RelayCapabilityPurpose,
): Promise<Uint8Array<ArrayBuffer>> {
	parseRelayBearer(bearer, purpose);
	return new Uint8Array(
		await crypto.subtle.digest("SHA-256", relayUtf8(compact(["aiki-push-v1", "credential", bearer]))),
	);
}
/** Constant work for equal public lengths; JS engines cannot guarantee machine-level constant timing. */
export function relayConstantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	let difference = a.length ^ b.length;
	for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return difference === 0;
}
const fieldPrime = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const curveB = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const integer = (bytes: Uint8Array) =>
	BigInt(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`);
/** Reject wrong length/prefix, infinity, out-of-field coordinates and off-curve P-256 points. */
export function validateRelayPublicPoint(point: Uint8Array): void {
	if (point.length !== 65 || point[0] !== 4) fail("invalid");
	const x = integer(point.slice(1, 33)),
		y = integer(point.slice(33));
	if (x >= fieldPrime || y >= fieldPrime || (y * y - x * x * x + 3n * x - curveB) % fieldPrime !== 0n) fail("invalid");
}
/** Import only a validated uncompressed P-256 public point. */
export async function importRelayPublicKey(encoded: string): Promise<CryptoKey> {
	const point = relayUnbase64(encoded, 65);
	validateRelayPublicPoint(point);
	try {
		return await crypto.subtle.importKey("raw", point, { name: "ECDH", namedCurve: "P-256" }, true, []);
	} catch {
		return fail("invalid");
	}
}
/** Export a validated P-256 public key in the frozen 65-byte uncompressed format. */
export async function exportRelayPublicKey(key: CryptoKey): Promise<string> {
	const point = new Uint8Array(await crypto.subtle.exportKey("raw", key));
	validateRelayPublicPoint(point);
	return relayBase64(point);
}
/** Generate a fresh per-route P-256 key pair with a nonextractable private key. */
export function generateRelayKeyPair(): Promise<CryptoKeyPair> {
	return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}
/** Derive the 32-byte ECDH output only after validating the peer's public point. */
export async function relaySharedSecret(privateKey: CryptoKey, peer: string): Promise<Uint8Array<ArrayBuffer>> {
	const publicKey = await importRelayPublicKey(peer);
	try {
		return new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256));
	} catch {
		return fail("invalid");
	}
}
export type RelayContext = { backendId: string; sessionId: string; routeId: string; keyId: string };
export type RelayPurpose = "notification" | "phone-confirm" | "backend-confirm";
export type RelayKeys = Record<RelayPurpose, Uint8Array<ArrayBuffer>>;
function context(c: RelayContext): void {
	string(c.backendId, 128);
	string(c.sessionId, 128);
	validateRelayId(c.routeId);
	validateRelayId(c.keyId);
}
/** Produce the frozen identity- and purpose-bound HKDF info. */
export function relayKeyInfo(c: RelayContext, purpose: RelayPurpose): string {
	context(c);
	if (!["notification", "phone-confirm", "backend-confirm"].includes(purpose)) fail("invalid");
	return compact(["aiki-push-v1", purpose, c.backendId, c.sessionId, c.routeId, c.keyId]);
}
/** Derive independent 32-byte notification, phone-confirm and backend-confirm keys. */
export async function deriveRelayKeys(
	shared: Uint8Array<ArrayBuffer>,
	salt: string,
	c: RelayContext,
): Promise<RelayKeys> {
	if (shared.length !== 32) fail("invalid");
	const saltBytes = relayUnbase64(salt, 32);
	const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
	const result = {} as RelayKeys;
	for (const purpose of ["notification", "phone-confirm", "backend-confirm"] as const)
		result[purpose] = new Uint8Array(
			await crypto.subtle.deriveBits(
				{ name: "HKDF", hash: "SHA-256", salt: saltBytes, info: relayUtf8(relayKeyInfo(c, purpose)) },
				base,
				256,
			),
		);
	return result;
}
/** Bind both validated public keys, salt and expected route/session identities. */
export async function relayTranscript(
	c: RelayContext,
	salt: string,
	phonePublicKey: string,
	backendPublicKey: string,
): Promise<string> {
	context(c);
	relayUnbase64(salt, 32);
	await importRelayPublicKey(phonePublicKey);
	await importRelayPublicKey(backendPublicKey);
	return compact([
		"aiki-push-v1",
		c.backendId,
		c.sessionId,
		c.routeId,
		c.keyId,
		salt,
		phonePublicKey,
		backendPublicKey,
	]);
}
/** Compute the transcript HMAC with the selected direction's independently derived key. */
export async function relayConfirmation(key: Uint8Array<ArrayBuffer>, transcript: string): Promise<string> {
	if (key.length !== 32) fail("invalid");
	const hmac = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return relayBase64(new Uint8Array(await crypto.subtle.sign("HMAC", hmac, relayUtf8(transcript))));
}
/** Verify the selected direction's HMAC without content-bearing errors. */
export async function verifyRelayConfirmation(
	key: Uint8Array<ArrayBuffer>,
	transcript: string,
	confirmation: string,
): Promise<void> {
	if (
		!relayConstantTimeEqual(
			relayUnbase64(await relayConfirmation(key, transcript), 32),
			relayUnbase64(confirmation, 32),
		)
	)
		fail("confirmation");
}
export type RelayPlaintext<Payload = Record<string, unknown>> = {
	backendId: string;
	sessionId: string;
	sequence: string;
	createdAt: number;
	expiresAt: number;
	eventId: string;
	payload: Payload;
};
export type RelaySendPlaintext = RelayPlaintext<NotificationPayload>;
const routing = ["projectId", "workerId", "scheduleId", "threadId", "artifactId", "taskId"] as const;
/** Accept only canonical decimal unsigned 64-bit strings, including both edge values. */
export function relaySequence(sequence: unknown): bigint {
	if (typeof sequence !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(sequence)) fail("invalid");
	const n = BigInt(sequence);
	if (n > 18446744073709551615n) fail("invalid");
	return n;
}
function timestamp(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("invalid");
	return value;
}
function senderPayload(raw: unknown, bound: boolean): NotificationPayload {
	const p = record(raw);
	const required = ["kind", "title", "body", "backendKey", "projectId", "workerId", "scheduleId", "tag", "at"];
	if (required.some((name) => !Object.hasOwn(p, name))) fail("invalid");
	string(p.kind, Number.MAX_SAFE_INTEGER);
	const result: Record<string, unknown> = {
		kind: p.kind,
		title: string(p.title, bound ? 256 : Number.MAX_SAFE_INTEGER, false),
		body: string(p.body, Number.MAX_SAFE_INTEGER, false),
		backendKey: string(p.backendKey, bound ? 128 : Number.MAX_SAFE_INTEGER, false),
	};
	for (const name of routing) {
		if (name in p) {
			result[name] = p[name] === null ? null : string(p[name], bound ? 128 : Number.MAX_SAFE_INTEGER);
		}
	}
	result.tag = string(p.tag, bound ? 128 : Number.MAX_SAFE_INTEGER, false);
	result.at = string(p.at, bound ? 64 : Number.MAX_SAFE_INTEGER, false);
	const known = [...required, ...routing];
	const extra = Object.fromEntries(Object.entries(p).filter(([name]) => !known.includes(name)));
	return { ...result, ...extra } as NotificationPayload;
}
function plaintext(raw: unknown): RelayPlaintext {
	const p = record(raw);
	keys(p, ["backendId", "sessionId", "sequence", "createdAt", "expiresAt", "eventId", "payload"]);
	const result = {
		backendId: string(p.backendId, 128),
		sessionId: string(p.sessionId, 128),
		sequence: p.sequence as string,
		createdAt: timestamp(p.createdAt),
		expiresAt: timestamp(p.expiresAt),
		eventId: validateRelayId(p.eventId),
		payload: record(p.payload),
	};
	relaySequence(result.sequence);
	if (result.expiresAt < result.createdAt || result.expiresAt - result.createdAt > PUSH_RELAY_LIFETIME_MS)
		fail("invalid");
	return result;
}
function truncatePreview(plaintext: RelaySendPlaintext): void {
	const points = Array.from(plaintext.payload.body);
	let low = 0;
	let high = points.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		plaintext.payload.body = points.slice(0, mid).join("");
		if (relayUtf8(compact(plaintext)).length <= PUSH_RELAY_LIMITS.plaintext) low = mid;
		else high = mid - 1;
	}
	plaintext.payload.body = points.slice(0, low).join("");
}

function safeRoute(route: string | null | undefined): string | null {
	return route && relayUtf8(route).length <= 128 ? route : null;
}

function minimalPayload(original: NotificationPayload): NotificationPayload {
	return {
		kind: original.kind,
		title: "Open the app",
		body: "",
		backendKey: safeRoute(original.backendKey) ?? "",
		projectId: safeRoute(original.projectId),
		workerId: null,
		scheduleId: null,
		tag: "aiki-push",
		at: relayUtf8(original.at).length <= 64 ? original.at : "",
	};
}

/** Bound known sender fields, preserve fitting extensions, truncate the preview and space-pad within the cap. */
export function prepareRelayPlaintext(input: RelaySendPlaintext): {
	plaintext: RelaySendPlaintext;
	padded: Uint8Array<ArrayBuffer>;
} {
	const plaintextToSend: RelaySendPlaintext = {
		...plaintext(input),
		payload: senderPayload(input.payload, false),
	};
	let needsFallback = false;
	try {
		senderPayload(plaintextToSend.payload, true);
	} catch (error) {
		if (!(error instanceof PushRelayError) || error.code !== "oversize") throw error;
		needsFallback = true;
	}
	if (!needsFallback) {
		truncatePreview(plaintextToSend);
		needsFallback = relayUtf8(compact(plaintextToSend)).length > PUSH_RELAY_LIMITS.plaintext;
	}
	if (needsFallback) {
		plaintextToSend.payload = minimalPayload(plaintextToSend.payload);
		// Even bounded optional local routes can exhaust the budget with maximal identities.
		if (relayUtf8(compact(plaintextToSend)).length > PUSH_RELAY_LIMITS.plaintext) {
			plaintextToSend.payload.projectId = null;
		}
	}
	const bytes = relayUtf8(compact(plaintextToSend));
	if (bytes.length > PUSH_RELAY_LIMITS.plaintext) fail("oversize");
	const padded = new Uint8Array(Math.ceil(bytes.length / 256) * 256);
	padded.fill(32);
	padded.set(bytes);
	return { plaintext: plaintextToSend, padded };
}
/** Strip minimal space padding, require canonical wrapper bytes and return an opaque JSON payload object. */
export function parseRelayPlaintext(bytes: Uint8Array): RelayPlaintext {
	if (!bytes.length || bytes.length % 256 || bytes.length > 2048) fail(bytes.length > 2048 ? "oversize" : "invalid");
	let end = bytes.length;
	while (bytes[end - 1] === 32) end--;
	let text: string;
	try {
		text = decoder.decode(bytes.subarray(0, end));
	} catch {
		return fail("invalid");
	}
	const p = plaintext(json(text));
	const { payload: ignoredPayload, ...wrapper } = p;
	const prefix = compact(wrapper).slice(0, -1) + ',"payload":';
	if (!text.startsWith(prefix) || !text.endsWith("}") || Math.ceil(end / 256) * 256 !== bytes.length) fail("invalid");
	const payloadText = text.slice(prefix.length, -1);
	if (!payloadText.startsWith("{") || !payloadText.endsWith("}")) fail("invalid");
	// Parse the slice separately so duplicate wrapper keys cannot hide inside the payload.
	p.payload = record(json(payloadText));
	return p;
}
export type RelayEnvelope = { v: 1; r: string; k: string; m: string; n: string; c: string };
/** Bind all three outer IDs to the AES-GCM authentication tag. */
export function relayAad(r: string, k: string, m: string): Uint8Array<ArrayBuffer> {
	return relayUtf8(compact(["aiki-push-v1", validateRelayId(r), validateRelayId(k), validateRelayId(m)]));
}
/** Serialize the exact compact versioned envelope key order. */
export function serializeRelayEnvelope(e: RelayEnvelope): string {
	return compact({ v: e.v, r: e.r, k: e.k, m: e.m, n: e.n, c: e.c });
}
/** Validate all envelope keys, lengths, encodings and byte caps before invoking AES. */
export function parseRelayEnvelope(text: string): RelayEnvelope {
	checkRelaySize(text, PUSH_RELAY_LIMITS.fcmData);
	const p = record(json(text));
	keys(p, ["v", "r", "k", "m", "n", "c"]);
	if (p.v !== 1) fail("version");
	const e: RelayEnvelope = {
		v: 1,
		r: validateRelayId(p.r),
		k: validateRelayId(p.k),
		m: validateRelayId(p.m),
		n: p.n as string,
		c: p.c as string,
	};
	relayUnbase64(e.n, 12);
	const cipher = relayUnbase64(e.c);
	if (cipher.length > 2064) fail("oversize");
	if (cipher.length < 272 || (cipher.length - 16) % 256) fail("invalid");
	if (serializeRelayEnvelope(e) !== text) fail("invalid");
	checkRelaySize(compact({ aiki: text }), PUSH_RELAY_LIMITS.fcmData);
	return e;
}
/** Accept only the single canonical FCM data key containing a valid serialized envelope. */
export function parseRelayFcmData(text: string): RelayEnvelope {
	checkRelaySize(text, PUSH_RELAY_LIMITS.fcmData);
	const p = record(json(text));
	keys(p, ["aiki"]);
	if (typeof p.aiki !== "string" || compact({ aiki: p.aiki }) !== text) fail("invalid");
	return parseRelayEnvelope(p.aiki);
}
/** Build a byte-capped send body whose outer route/message IDs match the envelope. */
export function relaySendBody(envelope: string): string {
	const e = parseRelayEnvelope(envelope);
	const body = compact({ routeId: e.r, messageId: e.m, envelope });
	checkRelaySize(body, PUSH_RELAY_LIMITS.sendBody);
	return body;
}
/** Encrypt once, persist the returned string, retry only that string. No caller-controlled nonce. */
export async function encryptRelay(
	key: Uint8Array<ArrayBuffer>,
	c: RelayContext,
	input: RelaySendPlaintext,
): Promise<string> {
	context(c);
	if (input.backendId !== c.backendId || input.sessionId !== c.sessionId) fail("identity");
	if (key.length !== 32) fail("invalid");
	const { padded } = prepareRelayPlaintext(input);
	const m = newRelayId(),
		nonce = crypto.getRandomValues(new Uint8Array(12));
	const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
	const cipher = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: nonce, additionalData: relayAad(c.routeId, c.keyId, m), tagLength: 128 },
			aes,
			padded,
		),
	);
	const text = serializeRelayEnvelope({
		v: 1,
		r: c.routeId,
		k: c.keyId,
		m,
		n: relayBase64(nonce),
		c: relayBase64(cipher),
	});
	relaySendBody(text);
	return text;
}
/** Authenticate before parsing plaintext; enforce local context and return the opaque payload object. */
export async function decryptRelay(
	key: Uint8Array<ArrayBuffer>,
	c: RelayContext,
	text: string,
): Promise<RelayPlaintext> {
	context(c);
	const e = parseRelayEnvelope(text);
	if (e.r !== c.routeId || e.k !== c.keyId) fail("route");
	if (key.length !== 32) fail("invalid");
	let clear: Uint8Array;
	try {
		const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
		clear = new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv: relayUnbase64(e.n, 12), additionalData: relayAad(e.r, e.k, e.m), tagLength: 128 },
				aes,
				relayUnbase64(e.c),
			),
		);
	} catch {
		return fail("authentication");
	}
	const p = parseRelayPlaintext(clear);
	if (p.backendId !== c.backendId || p.sessionId !== c.sessionId) fail("identity");
	return p;
}
/** Caller supplies backend time derived from the signed-in, monotonic-anchored offset, not wall time. */
export function checkRelayExpiry(p: RelayPlaintext, backendNow: number, clockTrusted = true): void {
	if (!clockTrusted) fail("clock");
	timestamp(backendNow);
	if (p.createdAt > backendNow + PUSH_RELAY_SKEW_MS) fail("clock");
	if (backendNow > p.expiresAt + PUSH_RELAY_SKEW_MS) fail("expired");
}
const windowMask = (1n << 4096n) - 1n;
/** Persistent 4096-bit window; never reset it while its key remains usable. */
export class RelayReplayWindow {
	#highest: bigint | null = null;
	#bits = 0n;
	constructor(state?: { highest: string | null; bits: string }) {
		if (state) {
			this.#highest = state.highest === null ? null : relaySequence(state.highest);
			if (typeof state.bits !== "string" || !/^(0|[1-9a-f][0-9a-f]{0,1023})$/.test(state.bits)) fail("invalid");
			this.#bits = BigInt(`0x${state.bits}`);
			if (
				(this.#highest === null) !== (this.#bits === 0n) ||
				(this.#highest !== null && !(this.#bits & 1n)) ||
				(this.#highest !== null && this.#highest < 4095n && this.#bits >> (this.#highest + 1n))
			)
				fail("invalid");
		}
	}
	/** Accept an unseen u64 sequence once, allowing reordering only within the sliding window. */
	accept(sequence: string): boolean {
		const n = relaySequence(sequence);
		if (this.#highest === null) {
			this.#highest = n;
			this.#bits = 1n;
			return true;
		}
		if (n > this.#highest) {
			const jump = n - this.#highest;
			this.#bits = jump >= 4096n ? 1n : ((this.#bits << jump) | 1n) & windowMask;
			this.#highest = n;
			return true;
		}
		const age = this.#highest - n;
		if (age >= 4096n || this.#bits & (1n << age)) return false;
		this.#bits |= 1n << age;
		return true;
	}
	/** Export the complete window for exact restoration without resetting a live key. */
	state(): { highest: string | null; bits: string } {
		return { highest: this.#highest?.toString() ?? null, bits: this.#bits.toString(16) };
	}
}
/** One instance per backend/session; serialize access. Persist callback MUST commit atomically before display. */
export class RelayAdmission {
	#windows: Record<string, { highest: string | null; bits: string }> = {};
	#events: Record<string, number> = {};
	constructor(serialized?: string) {
		if (serialized) {
			const s = record(json(serialized));
			keys(s, ["windows", "events"]);
			for (const [k, v] of Object.entries(record(s.windows))) {
				validateRelayId(k);
				const w = record(v);
				keys(w, ["highest", "bits"]);
				this.#windows[k] = new RelayReplayWindow(w as { highest: string | null; bits: string }).state();
			}
			for (const [id, at] of Object.entries(record(s.events))) this.#events[validateRelayId(id)] = timestamp(at);
		}
	}
	/** Export replay and cross-key event-dedupe state without changing it. */
	serialize(): string {
		return compact({ windows: this.#windows, events: this.#events });
	}
	/** Stage admission, durably persist it, then commit memory; only a successful return permits display. */
	admit(
		keyId: string,
		p: RelayPlaintext,
		backendNow: number,
		persist: (state: string) => void,
		clockTrusted = true,
	): void {
		validateRelayId(keyId);
		plaintext(p);
		checkRelayExpiry(p, backendNow, clockTrusted);
		const window = new RelayReplayWindow(this.#windows[keyId]);
		if (!window.accept(p.sequence)) fail("replay");
		const events = Object.fromEntries(
			Object.entries(this.#events).filter(([, at]) => backendNow - at < PUSH_RELAY_RETENTION_MS),
		);
		if (p.eventId in events) fail("event_duplicate");
		events[p.eventId] = backendNow;
		const windows = { ...this.#windows, [keyId]: window.state() };
		persist(compact({ windows, events }));
		this.#windows = windows;
		this.#events = events;
	}
}
