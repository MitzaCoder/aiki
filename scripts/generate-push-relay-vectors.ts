/** Synthetic, deterministic interoperability fixtures. bun scripts/generate-push-relay-vectors.ts [--check] */
import {
	deriveRelayKeys,
	prepareRelayPlaintext,
	relayBase64 as b64,
	relayUnbase64 as unb64,
	relayConfirmation,
	relayCredentialHash,
	relayKeyInfo,
	relaySendBody,
	RelayReplayWindow,
	relaySharedSecret,
	relayTranscript,
	relayUtf8,
	buildRelayBearer,
	type RelaySendPlaintext,
	type RelayContext,
} from "../packages/protocol/src/push-relay.ts";
import { encryptRelayVector, importRelayVectorPrivate } from "../packages/protocol/test-support/push-relay.ts";
const hex = (s: string) => Uint8Array.from(s.match(/../g)!, (byte) => Number.parseInt(byte, 16));
const filled = (n: number, byte: number) => b64(new Uint8Array(n).fill(byte));
const phonePublicKey = b64(
	hex(
		"046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296" +
			"4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
	),
);
const backendPublicKey = b64(
	hex(
		"047cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc47669978" +
			"07775510db8ed040293d9ac69f7430dbba7dade63ce982299e04b79d227873d1",
	),
);
const phonePrivateScalar = b64(hex("00".repeat(31) + "01")),
	backendPrivateScalar = b64(hex("00".repeat(31) + "02"));
const context: RelayContext = {
	backendId: "demo-backend",
	sessionId: "demo-session",
	routeId: filled(16, 1),
	keyId: filled(16, 2),
};
const salt = b64(Uint8Array.from({ length: 32 }, (_, i) => i));
const sharedSecret = await relaySharedSecret(
	await importRelayVectorPrivate(phonePrivateScalar, phonePublicKey),
	backendPublicKey,
);
const keys = await deriveRelayKeys(sharedSecret, salt, context);
const transcript = await relayTranscript(context, salt, phonePublicKey, backendPublicKey);
const confirmations = {
	phone: await relayConfirmation(keys["phone-confirm"], transcript),
	backend: await relayConfirmation(keys["backend-confirm"], transcript),
};
const input: RelaySendPlaintext = {
	backendId: context.backendId,
	sessionId: context.sessionId,
	sequence: "42",
	createdAt: 1700000000000,
	expiresAt: 1700043200000,
	eventId: filled(16, 3),
	payload: {
		kind: "reply",
		title: "Synthetic notification",
		body: "",
		backendKey: "demo-local",
		projectId: "demo-project",
		workerId: null,
		scheduleId: null,
		threadId: "demo-thread",
		artifactId: null,
		taskId: "T1",
		tag: "demo-event",
		at: "2023-11-14T22:13:20.000Z",
	},
};
const inputs: { name: string; input: RelaySendPlaintext }[] = [{ name: "empty-preview", input }];
const overhead = relayUtf8(JSON.stringify(input)).length;
for (const size of [511, 512, 513, 767, 768, 769, 2047, 2048, 2049])
	inputs.push({
		name: `json-${size}`,
		input: { ...input, payload: { ...input.payload, body: "x".repeat(size - overhead) } },
	});
inputs.push({
	name: "multibyte-truncation",
	input: { ...input, payload: { ...input.payload, body: "x".repeat(2048 - overhead - 5) + "😀é漢".repeat(20) } },
});
inputs.push({
	name: "escaping",
	input: {
		...input,
		payload: { ...input.payload, title: '\ufeffé漢😀"\\\n\t\u0000\u2028', body: "line\r\n/ slash \b \f" },
	},
});
inputs.push({
	name: "fallback-title",
	input: { ...input, payload: { ...input.payload, title: "漢".repeat(100), body: "preview" } },
});
inputs.push({
	name: "fallback-routing",
	input: { ...input, payload: { ...input.payload, backendKey: "x".repeat(129), projectId: "x".repeat(129) } },
});
inputs.push({
	name: "fallback-total",
	input: {
		...input,
		backendId: "b".repeat(128),
		sessionId: "s".repeat(128),
		payload: {
			...input.payload,
			title: "t".repeat(256),
			backendKey: "b".repeat(128),
			projectId: "p".repeat(128),
			workerId: "w".repeat(128),
			scheduleId: "s".repeat(128),
			threadId: "t".repeat(128),
			artifactId: "a".repeat(128),
			taskId: "q".repeat(128),
			tag: "g".repeat(128),
			at: "a".repeat(64),
		},
	},
});
inputs.push({
	name: "future-field",
	input: { ...input, payload: { ...input.payload, futureFlag: true } } as RelaySendPlaintext,
});
inputs.push({
	name: "future-kind",
	input: { ...input, payload: { ...input.payload, kind: "future-kind" } } as unknown as RelaySendPlaintext,
});
inputs.push({
	name: "nested-extension",
	input: {
		...input,
		payload: {
			...input.payload,
			future: { count: 100.25, small: 0.000001, large: 1e20, nested: [null, true, 'é\\"\n', { route: "x/y" }] },
		},
	} as RelaySendPlaintext,
});
inputs.push({
	name: "fallback-extension",
	input: { ...input, payload: { ...input.payload, future: "x".repeat(3000) } } as RelaySendPlaintext,
});
const encryptions = [];
for (const [i, sample] of inputs.entries()) {
	const m = filled(16, 10 + i),
		nonce = filled(12, 50 + i),
		c = { ...context, backendId: sample.input.backendId, sessionId: sample.input.sessionId };
	const prepared = prepareRelayPlaintext(sample.input);
	const envelope = await encryptRelayVector(keys.notification, c, sample.input, m, nonce);
	encryptions.push({
		...sample,
		context: c,
		messageId: m,
		nonce,
		plaintext: prepared.plaintext,
		plaintextJson: JSON.stringify(prepared.plaintext),
		padded: b64(prepared.padded),
		envelope,
		fcmData: JSON.stringify({ aiki: envelope }),
		sendBody: relaySendBody(envelope),
	});
}
const valid = encryptions[0]!.envelope,
	e = JSON.parse(valid);
const changed = (patch: object) => JSON.stringify({ ...e, ...patch });
const cipher = unb64(e.c),
	tamperCipher = cipher.slice(),
	tamperTag = cipher.slice();
tamperCipher[0]! ^= 1;
tamperTag[tamperTag.length - 1]! ^= 1;
const negatives: Record<string, unknown>[] = [];
const negative = (name: string, op: string, error: string, fields: object) =>
	negatives.push({ name, op, error, ...fields });
negative("ciphertext", "decrypt", "authentication", { envelope: changed({ c: b64(tamperCipher) }) });
negative("tag", "decrypt", "authentication", { envelope: changed({ c: b64(tamperTag) }) });
negative("nonce", "decrypt", "authentication", { envelope: changed({ n: filled(12, 99) }) });
for (const field of ["r", "k", "m"])
	negative(`aad-${field}`, "decrypt", "authentication", {
		envelope: changed({ [field]: filled(16, 99) }),
		context: {
			...context,
			...(field === "r" ? { routeId: filled(16, 99) } : field === "k" ? { keyId: filled(16, 99) } : {}),
		},
	});
negative("wrong-route", "decrypt", "route", { envelope: changed({ r: filled(16, 99) }) });
negative("wrong-key-id", "decrypt", "route", { envelope: changed({ k: filled(16, 99) }) });
negative("wrong-key", "decrypt", "authentication", { envelope: valid, key: filled(32, 99) });
negative("wrong-session", "decrypt", "identity", {
	envelope: valid,
	context: { ...context, sessionId: "other-session" },
});
negative("truncated-cipher", "decrypt", "invalid", { envelope: changed({ c: b64(cipher.slice(0, -1)) }) });
negative("truncated-json", "decrypt", "invalid", { envelope: valid.slice(0, -1) });
negative("version", "decrypt", "version", { envelope: changed({ v: 2 }) });
negative("extra", "decrypt", "invalid", { envelope: changed({ extra: 1 }) });
const missing = { ...e };
delete missing.n;
negative("missing", "decrypt", "invalid", { envelope: JSON.stringify(missing) });
negative("duplicate-key", "decrypt", "invalid", { envelope: valid.replace('"v":1', '"v":1,"v":1') });
negative("padded-base64", "decrypt", "invalid", { envelope: changed({ r: e.r + "==" }) });
negative("short-id", "decrypt", "invalid", { envelope: changed({ m: filled(15, 1) }) });
negative("long-id", "decrypt", "invalid", { envelope: changed({ m: filled(17, 1) }) });
negative("short-nonce", "decrypt", "invalid", { envelope: changed({ n: filled(11, 1) }) });
negative("oversize-envelope", "decrypt", "oversize", { envelope: " ".repeat(3585) });
negative("oversize-cipher", "decrypt", "oversize", { envelope: changed({ c: filled(2320, 1) }) });
for (const [name, point] of Object.entries({
	short: filled(64, 4),
	prefix: b64(Uint8Array.of(3, ...unb64(phonePublicKey).slice(1))),
	infinity: b64(Uint8Array.of(0)),
	offCurve: b64(Uint8Array.of(4, ...new Uint8Array(64))),
	outOfField: filled(65, 255),
}))
	negative(`point-${name}`, "point", "invalid", { point });
negative("transcript", "confirm", "confirmation", {
	transcript: transcript.replace("demo-session", "other-session"),
	purpose: "phone-confirm",
	confirmation: confirmations.phone,
});
negative("swapped-direction", "confirm", "confirmation", {
	transcript,
	purpose: "backend-confirm",
	confirmation: confirmations.phone,
});
for (const purpose of ["send", "delete"] as const) {
	const other = purpose === "send" ? "delete" : "send";
	negative(`bearer-${purpose}-direction`, "bearer", "invalid", {
		purpose,
		bearer: buildRelayBearer(other, context.routeId, filled(32, 9)),
	});
}
for (const sequence of ["-1", "01", "18446744073709551616", "1.0", "", "1e3"])
	negative(`sequence-${sequence}`, "sequence", "invalid", { sequence });
negative("identity-overflow", "prepare", "oversize", { input: { ...input, backendId: "b".repeat(129) } });
for (const [name, bytes] of Object.entries({
	invalidUtf8: new Uint8Array(512).fill(255),
	unpadded: relayUtf8(JSON.stringify(input)),
	excessivePadding: new Uint8Array(768)
		.fill(32)
		.map((v, i) => (i < relayUtf8(JSON.stringify(input)).length ? relayUtf8(JSON.stringify(input))[i]! : v)),
}))
	negative(`plaintext-${name}`, "decrypt", "invalid", {
		envelope: await encryptRelayVector(keys.notification, context, input, filled(16, 100), filled(12, 100), bytes),
	});
for (const [name, fcmData, error] of [
	["extra", JSON.stringify({ aiki: valid, other: "x" }), "invalid"],
	["missing", "{}", "invalid"],
	["duplicate", `{"aiki":${JSON.stringify(valid)},"aiki":${JSON.stringify(valid)}}`, "invalid"],
	["oversize", " ".repeat(3585), "oversize"],
] as const)
	negative(`fcm-${name}`, "fcm", error, { fcmData });
negative("long-nonce", "decrypt", "invalid", { envelope: changed({ n: filled(13, 1) }) });
for (const [name, patch] of Object.entries({
	extra: { extra: 1 },
	sequenceOverflow: { sequence: "184467440737095516150" },
	eventIdLength: { eventId: filled(17, 1) },
	negativeTime: { createdAt: -1 },
	tooLongLived: { expiresAt: input.createdAt + 43200001 },
})) {
	const bytes = relayUtf8(JSON.stringify({ ...input, ...patch }));
	const padded = new Uint8Array(Math.ceil(bytes.length / 256) * 256).fill(32);
	padded.set(bytes);
	negative(`plaintext-${name}`, "decrypt", "invalid", {
		envelope: await encryptRelayVector(keys.notification, context, input, filled(16, 101), filled(12, 101), padded),
	});
}
const receives = [];
for (const [index, payloadJson] of [
	'{ "future": {"number":1e+02,"negativeZero":-0,"small":1.00e-7}, "escaped":"\\u0061\\/b", "kind":"future-kind" }',
	"{}",
	'{"nested":[[1.0],{"text":"\\u6f22","extra":false}]}',
].entries()) {
	const plaintextJson = JSON.stringify(input).replace(JSON.stringify(input.payload), payloadJson);
	const bytes = relayUtf8(plaintextJson);
	const padded = new Uint8Array(Math.ceil(bytes.length / 256) * 256).fill(32);
	padded.set(bytes);
	const messageId = filled(16, 120 + index);
	const nonce = filled(12, 120 + index);
	const envelope = await encryptRelayVector(keys.notification, context, input, messageId, nonce, padded);
	receives.push({ name: `opaque-payload-${index}`, plaintextJson, padded: b64(padded), messageId, nonce, envelope });
}
for (const [name, plaintextJson] of Object.entries({
	duplicateWrapper: JSON.stringify(input).replace('"sequence":"42"', '"sequence":"42","sequence":"42"'),
	duplicatePayloadWrapper: JSON.stringify(input).slice(0, -1) + ',"payload":{}}',
	wrapperNumber: JSON.stringify(input).replace('"createdAt":1700000000000', '"createdAt":1.7e12'),
	wrapperWhitespace: JSON.stringify(input).replace('"payload":', '"payload": '),
	payloadArray: JSON.stringify({ ...input, payload: [] }),
	payloadNull: JSON.stringify({ ...input, payload: null }),
	payloadString: JSON.stringify({ ...input, payload: "not an object" }),
	payloadInvalidLiteral: JSON.stringify(input).replace(JSON.stringify(input.payload), '{"future":unquoted}'),
	payloadInvalidNumber: JSON.stringify(input).replace(JSON.stringify(input.payload), '{"future":01}'),
})) {
	const bytes = relayUtf8(plaintextJson);
	const padded = new Uint8Array(Math.ceil(bytes.length / 256) * 256).fill(32);
	padded.set(bytes);
	negative(`plaintext-${name}`, "decrypt", "invalid", {
		envelope: await encryptRelayVector(keys.notification, context, input, filled(16, 110), filled(12, 110), padded),
	});
}
const replay = [
	{
		name: "normal",
		steps: [
			["10", true],
			["10", false],
			["8", true],
			["8", false],
			["12", true],
			["11", true],
			["0", true],
			["4096", true],
			["0", false],
			["1", true],
			["8192", true],
			["4096", false],
			["4097", true],
		],
	},
	{
		name: "u64",
		steps: [
			["0", true],
			["18446744073709551615", true],
			["18446744073709551615", false],
			["18446744073709551614", true],
			["18446744073709547520", true],
			["18446744073709547519", false],
		],
	},
];
const expiry = [
	{ name: "created-skew-edge", now: input.createdAt - 300000, error: null },
	{ name: "created-too-future", now: input.createdAt - 300001, error: "clock" },
	{ name: "expires-edge", now: input.expiresAt, error: null },
	{ name: "expiry-skew-edge", now: input.expiresAt + 300000, error: null },
	{ name: "expired", now: input.expiresAt + 300001, error: "expired" },
	{ name: "uncertain-clock", now: input.createdAt, trusted: false, error: "clock" },
];
const capabilities = await Promise.all(
	(["send", "delete"] as const).map(async (purpose) => {
		const secret = filled(32, purpose === "send" ? 8 : 9),
			bearer = buildRelayBearer(purpose, context.routeId, secret);
		return { purpose, secret, bearer, hash: b64(await relayCredentialHash(bearer, purpose)) };
	}),
);
const vectors = {
	version: 1,
	context,
	phonePrivateScalar,
	phonePublicKey,
	backendPrivateScalar,
	backendPublicKey,
	salt,
	ecdhOutput: b64(sharedSecret),
	keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, b64(v)])),
	info: Object.fromEntries(Object.keys(keys).map((k) => [k, relayKeyInfo(context, k as keyof typeof keys)])),
	transcript,
	confirmations,
	capabilities,
	encryptions,
	receives,
	negatives,
	replay: replay.map((batch) => {
		const window = new RelayReplayWindow();
		return {
			name: batch.name,
			steps: batch.steps.map(([sequence, accept]) => {
				if (window.accept(sequence as string) !== accept) throw new Error("Replay oracle mismatch");
				return { sequence, accept, state: window.state() };
			}),
		};
	}),
	expiry,
};
const text = JSON.stringify(vectors, null, 2) + "\n";
const path = new URL("../packages/protocol/test-vectors/push-relay-v1.json", import.meta.url);
if (process.argv.includes("--check")) {
	if (!(await Bun.file(path).exists()) || (await Bun.file(path).text()) !== text) {
		console.error("Push relay vectors drifted");
		process.exit(1);
	}
	console.log("Push relay vectors match");
} else {
	await Bun.write(path, text);
	console.log(`Wrote ${encryptions.length} encryption and ${negatives.length} rejection vectors`);
}
