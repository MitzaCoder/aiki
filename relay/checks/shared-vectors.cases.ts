import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCapability, serializeEnvelope } from "../src/validation";
import { fixture, call, enroll, random } from "./support";

interface PositiveVector {
	name: string;
	envelope: string;
	messageId: string;
	sendBody?: string;
	fcmData?: string;
}
interface CapabilityVector {
	purpose: "send" | "delete";
	secret: string;
	bearer: string;
	hash: string;
}
interface NegativeVector {
	name: string;
	op: string;
	error: string;
	envelope?: string;
	fcmData?: string;
	purpose?: "send" | "delete";
	bearer?: string;
}
interface SharedVectors {
	version: number;
	context: { routeId: string; keyId: string };
	capabilities: CapabilityVector[];
	encryptions: PositiveVector[];
	receives: PositiveVector[];
	negatives: NegativeVector[];
}
// Test-only fixture read. Production code imports neither this file nor anything under packages/.
const vectors = JSON.parse(
	await readFile(resolve(import.meta.dir, "../../packages/protocol/test-vectors/push-relay-v1.json"), "utf8"),
) as SharedVectors;
const positives = [...vectors.encryptions, ...vectors.receives];
const publicEnvelopeNegatives = new Set([
	"wrong-route",
	"truncated-cipher",
	"truncated-json",
	"version",
	"extra",
	"missing",
	"duplicate-key",
	"padded-base64",
	"short-id",
	"long-id",
	"short-nonce",
	"long-nonce",
	"oversize-envelope",
	"oversize-cipher",
	"plaintext-unpadded",
]);

/** Name exactly why a frozen negative cannot be decided by the keyless relay. Unknown additions fail the check. */
function skipReason(vector: NegativeVector): string | undefined {
	if (["point", "confirm", "sequence", "prepare"].includes(vector.op)) return "phone-only crypto/plaintext input";
	if (vector.name.startsWith("plaintext-") && vector.name !== "plaintext-unpadded") return "encrypted plaintext";
	if (
		["ciphertext", "tag", "nonce", "aad-r", "aad-k", "aad-m", "wrong-key", "wrong-key-id", "wrong-session"].includes(
			vector.name,
		)
	)
		return "AEAD authentication or phone-only key/session context";
	return undefined;
}

/** Stage the frozen hashes directly so the full core must independently reproduce the shared credential digest. */
async function activateVectorRoute() {
	const phone = await enroll();
	const send = vectors.capabilities.find((capability) => capability.purpose === "send")!;
	const deletion = vectors.capabilities.find((capability) => capability.purpose === "delete")!;
	const routeId = vectors.context.routeId;
	const created = await call("routes/create", {
		installationId: phone.installationId,
		routeId,
		operationId: random(),
		sendHash: Buffer.from(send.hash, "base64url").toString("hex"),
		deleteHash: Buffer.from(deletion.hash, "base64url").toString("hex"),
	});
	expect(created.status).toBe(200);
	expect((await call("routes/activate", { installationId: phone.installationId, routeId })).status).toBe(200);
	return { send, deletion, routeId };
}

test("frozen capability bearers and credential digests match byte for byte", () => {
	expect(vectors.version).toBe(1);
	expect(vectors.capabilities.map((capability) => capability.purpose)).toEqual(["send", "delete"]);
	for (const capability of vectors.capabilities) {
		const prefix = capability.purpose === "send" ? "aiki_push1" : "aiki_push_delete1";
		expect(capability.bearer).toBe(prefix + "." + vectors.context.routeId + "." + capability.secret);
		const parsed = parseCapability("Bearer " + capability.bearer, capability.purpose);
		expect(parsed.routeId).toBe(vectors.context.routeId);
		expect(Buffer.from(parsed.digest, "hex").toString("base64url")).toBe(capability.hash);
	}
	for (const vector of vectors.negatives.filter((vector) => vector.op === "bearer")) {
		expect(() => parseCapability("Bearer " + vector.bearer, vector.purpose!)).toThrow();
	}
});

test("every frozen positive envelope is accepted as its exact serialized send body and FCM data", async () => {
	const { send, deletion, routeId } = await activateVectorRoute();
	fixture.captures = [];
	expect(positives.length).toBe(22);
	for (const vector of positives) {
		expect(serializeEnvelope(vector.envelope, routeId, vector.messageId)).toBe(vector.envelope);
		const body = vector.sendBody ?? JSON.stringify({ routeId, messageId: vector.messageId, envelope: vector.envelope });
		const reply = await call("send", {}, send.bearer, { body });
		expect({ name: vector.name, status: reply.status, result: reply.body }).toEqual({
			name: vector.name,
			status: 200,
			result: { state: "accepted", code: "accepted" },
		});
		expect(JSON.stringify(fixture.captures.at(-1)!.data)).toBe(
			vector.fcmData ?? JSON.stringify({ aiki: vector.envelope }),
		);
	}
	expect(fixture.captures.length).toBe(22);
	expect((await call("delete", { routeId }, deletion.bearer)).status).toBe(204);
	expect((await call("delete", { routeId }, deletion.bearer)).status).toBe(204);
}, 30_000);

test("all keyless frozen negatives reject before FCM and all skipped crypto vectors are explicitly classified", async () => {
	const { send, routeId } = await activateVectorRoute();
	fixture.captures = [];
	const skipped: string[] = [];
	let rejected = 0;
	for (const vector of vectors.negatives) {
		if (publicEnvelopeNegatives.has(vector.name)) {
			const body = JSON.stringify({ routeId, messageId: vectors.encryptions[0].messageId, envelope: vector.envelope });
			const response = await call("send", {}, send.bearer, { body });
			expect({ name: vector.name, rejected: [400, 413].includes(response.status) }).toEqual({
				name: vector.name,
				rejected: true,
			});
			rejected++;
		} else if (vector.op === "bearer") {
			expect(() => parseCapability("Bearer " + vector.bearer, vector.purpose!)).toThrow();
			rejected++;
		} else if (vector.op === "fcm") {
			// FCM maps are not the POST schema: submit the unmodified map and prove there is no data-map passthrough.
			const response = await call("send", {}, send.bearer, { body: vector.fcmData! });
			expect(response.status).toBe(400);
			rejected++;
		} else {
			const reason = skipReason(vector);
			expect({ name: vector.name, classified: Boolean(reason) }).toEqual({ name: vector.name, classified: true });
			if (vector.envelope) {
				const outer = JSON.parse(vector.envelope) as { r: string; m: string };
				// Well-formed opaque ciphertext/key context must remain acceptable without trying to decrypt it.
				expect(serializeEnvelope(vector.envelope, outer.r, outer.m)).toBe(vector.envelope);
			}
			skipped.push(vector.name);
		}
	}
	expect({ rejected, skipped: skipped.length }).toEqual({ rejected: 21, skipped: 39 });
	expect(vectors.negatives.length).toBe(rejected + skipped.length);
	expect(fixture.captures.length).toBe(0);
}, 30_000);

test("derived canonical encoding and byte boundaries reject legacy objects before FCM", async () => {
	const { send, routeId } = await activateVectorRoute();
	const positive = vectors.encryptions[0];
	const parsed = JSON.parse(positive.envelope) as { v: number; r: string; k: string; m: string; n: string; c: string };
	const nonCanonicalId = parsed.k.slice(0, -1) + String.fromCharCode(parsed.k.charCodeAt(parsed.k.length - 1) + 1);
	const invalid: unknown[] = [
		parsed,
		" " + positive.envelope,
		JSON.stringify({ ...parsed, k: nonCanonicalId }),
		JSON.stringify({ r: parsed.r, v: 1, k: parsed.k, m: parsed.m, n: parsed.n, c: parsed.c }),
		positive.envelope.replace('"v":1', '"v":1.0'),
		...[16, 32, 271, 273, 2063, 2065, 2320].map((length) =>
			JSON.stringify({ ...parsed, c: Buffer.alloc(length, 1).toString("base64url") }),
		),
	];
	fixture.captures = [];
	for (const envelope of invalid) {
		const response = await call("send", { routeId, messageId: positive.messageId, envelope }, send.bearer);
		expect([400, 413]).toContain(response.status);
	}
	expect(fixture.captures.length).toBe(0);
	const body = positive.sendBody!;
	const exact = " ".repeat(4096 - Buffer.byteLength(body)) + body;
	expect((await call("send", {}, send.bearer, { body: exact })).body?.state).toBe("accepted");
	expect((await call("send", {}, send.bearer, { body: " " + exact })).status).toBe(413);
	expect(fixture.captures.length).toBe(1);
});
