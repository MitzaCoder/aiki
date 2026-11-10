/** Owner-device authentication. Secrets never belong in ordinary exported backend lists. */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";

export const DeviceAuthModeSchema = Type.Union([
	Type.Literal("off"),
	Type.Literal("optional"),
	Type.Literal("required"),
]);
export type DeviceAuthMode = Static<typeof DeviceAuthModeSchema>;
export const DeviceAuthStateSchema = Type.Object({
	mode: DeviceAuthModeSchema,
	sessionId: Type.Union([Type.String(), Type.Null()]),
	accessExpiresAt: Type.Union([Type.String(), Type.Null()]),
});
export const AuthDeviceSchema = Type.Object({
	id: Type.String(),
	label: Type.String(),
	platform: Type.String(),
	createdAt: Type.String(),
	lastSeenAt: Type.String(),
	connectedCount: Type.Integer(),
	expiresAt: Type.String(),
	current: Type.Boolean(),
});
export type AuthDevice = Static<typeof AuthDeviceSchema>;
export const AuthPairingSchema = Type.Object({
	id: Type.String(),
	expiresAt: Type.String(),
	confirm: Type.Boolean(),
	state: Type.Union([
		Type.Literal("unused"),
		Type.Literal("claimed"),
		Type.Literal("approved"),
		Type.Literal("denied"),
		Type.Literal("cancelled"),
	]),
	claimId: Type.Union([Type.String(), Type.Null()]),
	comparisonCode: Type.Union([Type.String(), Type.Null()]),
	label: Type.Union([Type.String(), Type.Null()]),
	platform: Type.Union([Type.String(), Type.Null()]),
});
export type AuthPairing = Static<typeof AuthPairingSchema>;
export const AuthRenewRequestSchema = Type.Object({
	type: Type.Literal("auth.renew"),
	id: RequestIdSchema,
	accessToken: Type.String(),
});
export const AuthRenewResponseSchema = Type.Object({
	type: Type.Literal("auth.renew"),
	id: RequestIdSchema,
	accessExpiresAt: Type.String(),
});
export const AuthDevicesListRequestSchema = Type.Object({
	type: Type.Literal("auth.devices.list"),
	id: RequestIdSchema,
});
export const AuthDevicesListResponseSchema = Type.Object({
	type: Type.Literal("auth.devices.list"),
	id: RequestIdSchema,
	devices: Type.Array(AuthDeviceSchema),
});
export const AuthDevicesRenameRequestSchema = Type.Object({
	type: Type.Literal("auth.devices.rename"),
	id: RequestIdSchema,
	sessionId: Type.String(),
	label: Type.String({ minLength: 1, maxLength: 120 }),
});
export const AuthDevicesRenameResponseSchema = Type.Object({
	type: Type.Literal("auth.devices.rename"),
	id: RequestIdSchema,
});
export const AuthDevicesRevokeRequestSchema = Type.Object({
	type: Type.Literal("auth.devices.revoke"),
	id: RequestIdSchema,
	sessionId: Type.String(),
});
export const AuthDevicesRevokeResponseSchema = Type.Object({
	type: Type.Literal("auth.devices.revoke"),
	id: RequestIdSchema,
});
export const AuthPairingsCreateRequestSchema = Type.Object({
	type: Type.Literal("auth.pairings.create"),
	id: RequestIdSchema,
	confirm: Type.Optional(Type.Boolean()),
});
export const AuthPairingsCreateResponseSchema = Type.Object({
	type: Type.Literal("auth.pairings.create"),
	id: RequestIdSchema,
	pairing: AuthPairingSchema,
	secret: Type.String(),
});
export const AuthPairingsListRequestSchema = Type.Object({
	type: Type.Literal("auth.pairings.list"),
	id: RequestIdSchema,
});
export const AuthPairingsListResponseSchema = Type.Object({
	type: Type.Literal("auth.pairings.list"),
	id: RequestIdSchema,
	pairings: Type.Array(AuthPairingSchema),
});
export const AuthPairingsCancelRequestSchema = Type.Object({
	type: Type.Literal("auth.pairings.cancel"),
	id: RequestIdSchema,
	grantId: Type.String(),
});
export const AuthPairingsCancelResponseSchema = Type.Object({
	type: Type.Literal("auth.pairings.cancel"),
	id: RequestIdSchema,
});
export const AuthPairingsApproveRequestSchema = Type.Object({
	type: Type.Literal("auth.pairings.approve"),
	id: RequestIdSchema,
	grantId: Type.String(),
	claimId: Type.String(),
});
export const AuthPairingsApproveResponseSchema = Type.Object({
	type: Type.Literal("auth.pairings.approve"),
	id: RequestIdSchema,
});
export const AuthPairingsDenyRequestSchema = Type.Object({
	type: Type.Literal("auth.pairings.deny"),
	id: RequestIdSchema,
	grantId: Type.String(),
	claimId: Type.String(),
});
export const AuthPairingsDenyResponseSchema = Type.Object({
	type: Type.Literal("auth.pairings.deny"),
	id: RequestIdSchema,
});
export const AuthDevicesChangedEventSchema = Type.Object({ type: Type.Literal("auth.devicesChanged") });
export const AuthPairingRequestedEventSchema = Type.Object({
	type: Type.Literal("auth.pairingRequested"),
	pairing: AuthPairingSchema,
});
export const AuthSessionRevokedEventSchema = Type.Object({
	type: Type.Literal("auth.sessionRevoked"),
	sessionId: Type.String(),
});

export type PairingFragment = { backendId: string; backendOrigin: string; grantId: string; secret: string };
/** #pair=v2.<unpadded base64url UTF-8 JSON array [backendId,origin,grantId,secret]>. */
export function encodePairingFragment(pairing: PairingFragment): string {
	validatePairing(pairing);
	const bytes = new TextEncoder().encode(
		JSON.stringify([pairing.backendId, pairing.backendOrigin, pairing.grantId, pairing.secret]),
	);
	return `#pair=v2.${btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")}`;
}
export function decodePairingFragment(fragment: string): PairingFragment {
	const match = /^#?pair=v2\.([A-Za-z0-9_-]+)$/.exec(fragment);
	if (!match || match[1]!.length > 4096) throw new Error("Invalid pairing fragment");
	const encoded = match[1]!.replace(/-/g, "+").replace(/_/g, "/");
	const array: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))),
	);
	if (!Array.isArray(array) || array.length !== 4 || !array.every((x) => typeof x === "string"))
		throw new Error("Invalid pairing fragment");
	const pairing = {
		backendId: array[0],
		backendOrigin: array[1],
		grantId: array[2],
		secret: array[3],
	} as PairingFragment;
	validatePairing(pairing);
	if (encodePairingFragment(pairing) !== `#pair=v2.${match[1]}`) throw new Error("Noncanonical pairing fragment");
	return pairing;
}
function validatePairing(pairing: PairingFragment): void {
	const url = new URL(pairing.backendOrigin);
	if (
		url.origin !== pairing.backendOrigin ||
		url.username ||
		url.password ||
		!(
			url.protocol === "https:" ||
			(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
		) ||
		!pairing.backendId ||
		!pairing.grantId ||
		!/^mh_p1\.[A-Za-z0-9_-]{43}$/.test(pairing.secret)
	)
		throw new Error("Invalid pairing fragment");
}
/** First 40 digest bits as 8 RFC4648 uppercase base32 characters, displayed XXXX-XXXX. */
export async function deviceComparisonCode(
	backendId: string,
	grantId: string,
	claimId: string,
	claimSecret: string,
): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(`aiki-device-claim-v1\n${backendId}\n${grantId}\n${claimId}\n${claimSecret}`),
		),
	);
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = 0,
		buffer = 0,
		code = "";
	for (const byte of digest.slice(0, 5)) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			code += alphabet[(buffer >>> bits) & 31];
		}
	}
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}
