/** TEST ONLY. Deliberately absent from the protocol package entry point. Never use for production sends. */
import {
	prepareRelayPlaintext,
	relayAad,
	relayBase64,
	relayUnbase64,
	serializeRelayEnvelope,
	type RelayContext,
	type RelaySendPlaintext,
} from "../src/push-relay.ts";
/** TEST ONLY: encrypt exact fixture bytes with injected IDs/nonce, without a production reuse guarantee. */
export async function encryptRelayVector(
	key: Uint8Array<ArrayBuffer>,
	context: RelayContext,
	plaintext: RelaySendPlaintext,
	messageId: string,
	nonce: string,
	padded = prepareRelayPlaintext(plaintext).padded,
): Promise<string> {
	const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
	const cipher = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: relayUnbase64(nonce, 12),
				additionalData: relayAad(context.routeId, context.keyId, messageId),
				tagLength: 128,
			},
			aes,
			padded,
		),
	);
	return serializeRelayEnvelope({
		v: 1,
		r: context.routeId,
		k: context.keyId,
		m: messageId,
		n: nonce,
		c: relayBase64(cipher),
	});
}
/** TEST ONLY: import a synthetic fixed P-256 scalar for deterministic agreement vectors. */
export async function importRelayVectorPrivate(scalar: string, publicPoint: string): Promise<CryptoKey> {
	const point = relayUnbase64(publicPoint, 65);
	return crypto.subtle.importKey(
		"jwk",
		{ kty: "EC", crv: "P-256", d: scalar, x: relayBase64(point.slice(1, 33)), y: relayBase64(point.slice(33)) },
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		["deriveBits"],
	);
}
