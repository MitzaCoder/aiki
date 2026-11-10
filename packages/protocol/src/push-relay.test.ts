import { describe, expect, test } from "bun:test";
import vectors from "../test-vectors/push-relay-v1.json";
import { encryptRelayVector, importRelayVectorPrivate } from "../test-support/push-relay.ts";
import {
	buildRelayBearer,
	checkRelayExpiry,
	checkRelaySize,
	decryptRelay,
	deriveRelayKeys,
	encryptRelay,
	exportRelayPublicKey,
	generateRelayKeyPair,
	importRelayPublicKey,
	parseRelayBearer,
	parseRelayEnvelope,
	parseRelayFcmData,
	parseRelayPlaintext,
	prepareRelayPlaintext,
	PushRelayError,
	RelayAdmission,
	relayBase64,
	relayConfirmation,
	relayConstantTimeEqual,
	relayCredentialHash,
	relayKeyInfo,
	RelayReplayWindow,
	relaySendBody,
	relaySequence,
	relaySharedSecret,
	relayTranscript,
	relayUnbase64,
	relayUtf8,
	verifyRelayConfirmation,
	type RelayContext,
	type RelaySendPlaintext,
	type RelayPurpose,
} from "./push-relay.ts";

const key = relayUnbase64(vectors.keys.notification);
const context = vectors.context;
const base = vectors.encryptions[0]!.input as RelaySendPlaintext;
function errorCode(run: () => unknown, code: string): void {
	try {
		run();
		throw new Error("Accepted invalid input");
	} catch (e) {
		expect(e).toBeInstanceOf(PushRelayError);
		expect((e as PushRelayError).code as string).toBe(code);
	}
}
async function asyncError(run: () => Promise<unknown>, code: string): Promise<void> {
	try {
		await run();
		throw new Error("Accepted invalid input");
	} catch (e) {
		expect(e).toBeInstanceOf(PushRelayError);
		expect((e as PushRelayError).code as string).toBe(code);
	}
}

describe("relay shared v1 vectors", () => {
	test("fixed ECDH pairs, three HKDF purposes and direction-specific confirmations", async () => {
		const phone = await importRelayVectorPrivate(vectors.phonePrivateScalar, vectors.phonePublicKey);
		const backend = await importRelayVectorPrivate(vectors.backendPrivateScalar, vectors.backendPublicKey);
		const shared = await relaySharedSecret(phone, vectors.backendPublicKey);
		expect(relayBase64(shared)).toBe(vectors.ecdhOutput);
		expect(relayBase64(await relaySharedSecret(backend, vectors.phonePublicKey))).toBe(vectors.ecdhOutput);
		expect(await exportRelayPublicKey(await importRelayPublicKey(vectors.phonePublicKey))).toBe(vectors.phonePublicKey);
		const keys = await deriveRelayKeys(shared, vectors.salt, context);
		const transcript = await relayTranscript(context, vectors.salt, vectors.phonePublicKey, vectors.backendPublicKey);
		expect(transcript).toBe(vectors.transcript);
		for (const purpose of ["notification", "phone-confirm", "backend-confirm"] as const) {
			expect(relayBase64(keys[purpose])).toBe(vectors.keys[purpose]);
			expect(relayKeyInfo(context, purpose)).toBe(vectors.info[purpose]);
		}
		for (const direction of ["phone", "backend"] as const) {
			const confirmation = await relayConfirmation(keys[`${direction}-confirm`], transcript);
			expect(confirmation).toBe(vectors.confirmations[direction]);
			await verifyRelayConfirmation(keys[`${direction}-confirm`], transcript, confirmation);
		}
	});
	test.each(vectors.capabilities)("$purpose bearer hash", async (v) => {
		const purpose = v.purpose as "send" | "delete";
		expect(buildRelayBearer(purpose, context.routeId, v.secret)).toBe(v.bearer);
		expect(parseRelayBearer(v.bearer, purpose)).toEqual({ routeId: context.routeId, secret: v.secret });
		expect(relayBase64(await relayCredentialHash(v.bearer, purpose))).toBe(v.hash);
	});
	test.each(vectors.encryptions)("reproduces and decrypts $name", async (v) => {
		const prepared = prepareRelayPlaintext(v.input as RelaySendPlaintext);
		expect(prepared.plaintext).toEqual(v.plaintext as RelaySendPlaintext);
		expect(JSON.stringify(prepared.plaintext)).toBe(v.plaintextJson);
		expect(relayBase64(prepared.padded)).toBe(v.padded);
		expect(await encryptRelayVector(key, v.context, v.input as RelaySendPlaintext, v.messageId, v.nonce)).toBe(
			v.envelope,
		);
		expect(await decryptRelay(key, v.context, v.envelope)).toEqual(v.plaintext as RelaySendPlaintext);
		expect(parseRelayPlaintext(relayUnbase64(v.padded))).toEqual(v.plaintext as RelaySendPlaintext);
		expect(JSON.stringify({ aiki: v.envelope })).toBe(v.fcmData);
		expect(parseRelayFcmData(v.fcmData)).toEqual(parseRelayEnvelope(v.envelope));
		expect(relaySendBody(v.envelope)).toBe(v.sendBody);
	});
	test.each(vectors.receives)("accepts opaque authenticated $name", async (v) => {
		const padded = relayUnbase64(v.padded);
		expect(await encryptRelayVector(key, context, base, v.messageId, v.nonce, padded)).toBe(v.envelope);
		const expected = JSON.parse(v.plaintextJson);
		expect(parseRelayPlaintext(padded)).toEqual(expected);
		expect(await decryptRelay(key, context, v.envelope)).toEqual(expected);
	});
	test.each(vectors.negatives)("rejects $name ($error)", async (raw) => {
		// Rejection fixture fields are operation-specific. Dispatch once here; no duplicated fixture file.
		const v = raw as {
			name: string;
			op: string;
			error: string;
			envelope?: string;
			fcmData?: string;
			key?: string;
			context?: RelayContext;
			point?: string;
			purpose?: string;
			transcript?: string;
			confirmation?: string;
			bearer?: string;
			sequence?: string;
			input?: RelaySendPlaintext;
		};
		switch (v.op) {
			case "decrypt":
				await asyncError(
					() => decryptRelay(v.key ? relayUnbase64(v.key) : key, v.context ?? context, v.envelope!),
					v.error,
				);
				break;
			case "fcm":
				errorCode(() => parseRelayFcmData(v.fcmData!), v.error);
				break;
			case "point":
				await asyncError(() => importRelayPublicKey(v.point!), v.error);
				break;
			case "confirm":
				await asyncError(
					() =>
						verifyRelayConfirmation(
							relayUnbase64(vectors.keys[v.purpose as RelayPurpose]),
							v.transcript!,
							v.confirmation!,
						),
					v.error,
				);
				break;
			case "bearer":
				errorCode(() => parseRelayBearer(v.bearer!, v.purpose as "send" | "delete"), v.error);
				break;
			case "sequence":
				errorCode(() => relaySequence(v.sequence), v.error);
				break;
			case "prepare":
				errorCode(() => prepareRelayPlaintext(v.input!), v.error);
				break;
			default:
				throw new Error(`Unknown operation ${v.op}`);
		}
	});
	test.each(vectors.replay)("replay window $name survives every restart", (v) => {
		let window = new RelayReplayWindow();
		for (const step of v.steps) {
			expect(window.accept(step.sequence as string)).toBe(step.accept);
			expect(window.state()).toEqual(step.state);
			window = new RelayReplayWindow(JSON.parse(JSON.stringify(window.state())));
		}
	});
	test.each(vectors.expiry)("expiry $name", (v) => {
		const run = () => checkRelayExpiry(base, v.now, "trusted" in v ? v.trusted : true);
		if (v.error) errorCode(run, v.error);
		else expect(run).not.toThrow();
	});
});

test("random key agreements and production encryptions use fresh nonces and message IDs", async () => {
	const nonces = new Set<string>(),
		messages = new Set<string>();
	for (let i = 0; i < 8; i++) {
		const phone = await generateRelayKeyPair(),
			backend = await generateRelayKeyPair();
		const shared = await relaySharedSecret(phone.privateKey, await exportRelayPublicKey(backend.publicKey));
		expect(shared).toEqual(await relaySharedSecret(backend.privateKey, await exportRelayPublicKey(phone.publicKey)));
		const keys = await deriveRelayKeys(shared, vectors.salt, context);
		for (let n = 0; n < 2; n++) {
			const envelope = await encryptRelay(keys.notification, context, base);
			const e = parseRelayEnvelope(envelope);
			expect(nonces.has(e.n)).toBe(false);
			expect(messages.has(e.m)).toBe(false);
			nonces.add(e.n);
			messages.add(e.m);
			expect(await decryptRelay(keys.notification, context, envelope)).toEqual(base);
		}
	}
});
test("size guards and strict FCM key set", () => {
	for (const cap of [2048, 3584, 4096, 8192]) {
		checkRelaySize("a".repeat(cap), cap);
		errorCode(() => checkRelaySize("a".repeat(cap + 1), cap), "oversize");
		errorCode(() => checkRelaySize("é".repeat(cap), cap), "oversize");
	}
	errorCode(() => parseRelayFcmData(JSON.stringify({ aiki: vectors.encryptions[0]!.envelope, other: "x" })), "invalid");
	errorCode(() => parseRelayFcmData(" ".repeat(3585)), "oversize");
	expect(relayConstantTimeEqual(key, key.slice())).toBe(true);
	expect(relayConstantTimeEqual(key, key.slice(1))).toBe(false);
	expect(relayConstantTimeEqual(key, new Uint8Array(32))).toBe(false);
});
test("canonical encodings, malformed input and lifetime reject without crypto", async () => {
	for (const s of ["AA=", "AA+", "AB", " A", "", "_", "a".repeat(4097)]) errorCode(() => relayUnbase64(s), "invalid");
	for (const p of [
		{ ...base, expiresAt: base.createdAt - 1 },
		{ ...base, expiresAt: base.createdAt + 43200001 },
		{ ...base, createdAt: 1.5 },
		{ ...base, backendId: "\ud800" },
	])
		errorCode(() => prepareRelayPlaintext(p as RelaySendPlaintext), "invalid");
	await asyncError(() => encryptRelay(key, { ...context, sessionId: "other" }, base), "identity");
});
test("cross-key event dedupe, atomic persistence, restart and 13-hour boundary", () => {
	let stored = "";
	const persist = (s: string) => {
		stored = s;
	};
	const admission = new RelayAdmission();
	const before = admission.serialize();
	expect(() =>
		admission.admit(context.keyId, base, base.createdAt, () => {
			throw new Error("disk full");
		}),
	).toThrow("disk full");
	expect(admission.serialize()).toBe(before);
	admission.admit(context.keyId, base, base.createdAt, persist);
	const restarted = new RelayAdmission(stored);
	expect(restarted.serialize()).toBe(stored);
	errorCode(() => restarted.admit(context.keyId, base, base.createdAt, persist), "replay");
	const successor = relayBase64(new Uint8Array(16).fill(77));
	errorCode(() => restarted.admit(successor, { ...base, sequence: "1" }, base.createdAt, persist), "event_duplicate");
	const event = relayBase64(new Uint8Array(16).fill(88));
	restarted.admit(successor, { ...base, sequence: "1", eventId: event }, base.createdAt, persist);
	const now = base.createdAt + 46800000;
	const fresh = { ...base, sequence: "2", createdAt: now, expiresAt: now + 43200000 };
	errorCode(
		() => restarted.admit(successor, { ...fresh, createdAt: now - 1, expiresAt: now + 43200000 - 1 }, now - 1, persist),
		"event_duplicate",
	);
	restarted.admit(successor, fresh, now, persist);
	expect(new RelayAdmission(stored).serialize()).toBe(stored);
});
test("padding is reversible at all byte bucket edges and Unicode boundaries", () => {
	for (const v of vectors.encryptions) {
		const p = prepareRelayPlaintext(v.input as RelaySendPlaintext);
		expect(p.padded.length % 256).toBe(0);
		expect(p.padded.length).toBeLessThanOrEqual(2048);
		expect(relayUtf8(JSON.stringify(p.plaintext)).length).toBeLessThanOrEqual(2048);
		expect(parseRelayPlaintext(p.padded)).toEqual(p.plaintext);
	}
});
