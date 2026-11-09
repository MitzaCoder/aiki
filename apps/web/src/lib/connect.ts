/**
 * "Connect another device": a link that carries the chosen backends in its fragment, so the user does not type addresses
 * on a phone. The fragment never leaves the browser — no server sees it in a request line — and the app decodes it on
 * `/connect`, shows what it holds and adds it once the user confirms.
 *
 * The payload is `v1.<base64url>`, the base64url being one `name<TAB>origin` line per backend. Decoding is strict: any
 * line that is not a plain HTTPS origin with a sane name rejects the whole link, so a link that arrives damaged adds
 * nothing rather than something surprising.
 */

/** One backend a connect link carries. */
export type ConnectBackend = { name: string; url: string };

/** The decoded link: the backends, or why it cannot be used. */
export type ConnectDecode = { ok: true; backends: ConnectBackend[] } | { ok: false; reason: string };

/** The app's route for a connect link. */
export const CONNECT_PATH = "/connect";

/** The payload's version, so a future link format can be told apart from this one. */
export const CONNECT_PAYLOAD_VERSION = "v1";

/** Limits: enough for every backend one person runs, small enough to fit a QR code. */
export const MAX_CONNECT_BACKENDS = 12;
export const MAX_CONNECT_NAME_LENGTH = 48;
export const MAX_CONNECT_URL_LENGTH = 512;
export const MAX_CONNECT_PAYLOAD_LENGTH = 2048;

/** The encoded fragment, `v1.…`, without the `#`. Throws when a backend is not one the app would accept. */
export function encodeConnectList(backends: readonly ConnectBackend[]): string {
	if (backends.length === 0) throw new Error("Choose at least one backend to pass on.");
	if (backends.length > MAX_CONNECT_BACKENDS) {
		throw new Error(`A connect link carries at most ${MAX_CONNECT_BACKENDS} backends.`);
	}
	const lines = backends.map((backend) => {
		const name = backend.name.trim();
		if (name.length === 0 || name.length > MAX_CONNECT_NAME_LENGTH) {
			throw new Error(`"${name}" is not a usable backend name.`);
		}
		if (hasControlCharacter(name)) throw new Error(`"${name}" is not a usable backend name.`);
		const url = connectOrigin(backend.url);
		if (url === undefined) {
			throw new Error(`"${backend.url}" is not an HTTPS origin, so it cannot go in a connect link.`);
		}
		return `${name}\t${url}`;
	});
	return `${CONNECT_PAYLOAD_VERSION}.${base64UrlEncode(new TextEncoder().encode(lines.join("\n")))}`;
}

/** Whether a backend this browser has could go in a connect link (HTTPS, an origin only). */
export function isConnectUrl(url: string): boolean {
	return connectOrigin(url) !== undefined;
}

/** A backend name as a link carries it: trimmed, without control characters, short, never empty. */
export function shareableName(name: string): string {
	const cleaned = name.replace(CONTROL_CHARACTERS, "").trim().slice(0, MAX_CONNECT_NAME_LENGTH).trim();
	return cleaned.length > 0 ? cleaned : "backend";
}

/** The full link to open on the other device. */
export function connectHref(origin: string, backends: readonly ConnectBackend[]): string {
	return `${origin.replace(/\/+$/, "")}${CONNECT_PATH}#${encodeConnectList(backends)}`;
}

/** Decode an encoded payload (`v1.…`). */
export function decodeConnectPayload(payload: string): ConnectDecode {
	if (payload.length === 0) return fail("This link carries no backends.");
	if (payload.length > MAX_CONNECT_PAYLOAD_LENGTH) return fail("This link is too long to be one of ours.");
	const parts = payload.split(".");
	if (parts.length !== 2) return fail("This link is not complete.");
	const [version, encoded] = parts;
	if (version !== CONNECT_PAYLOAD_VERSION) return fail("This link was made by a different version of the app.");
	if (encoded === undefined || !/^[A-Za-z0-9_-]+$/.test(encoded)) return fail("This link is damaged.");
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlDecode(encoded));
	} catch {
		return fail("This link is damaged.");
	}
	const backends: ConnectBackend[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		const fields = line.split("\t");
		if (fields.length !== 2) return fail("This link is damaged.");
		const name = (fields[0] ?? "").trim();
		if (name.length === 0 || name.length > MAX_CONNECT_NAME_LENGTH || hasControlCharacter(name)) {
			return fail("This link names a backend in a way the app cannot use.");
		}
		const url = connectOrigin(fields[1] ?? "");
		if (url === undefined) {
			return fail("This link holds an address that is not a plain HTTPS origin.");
		}
		// The same backend twice is one backend; the first name wins.
		if (backends.some((backend) => backend.url === url)) continue;
		backends.push({ name, url });
		if (backends.length > MAX_CONNECT_BACKENDS) {
			return fail(`A connect link carries at most ${MAX_CONNECT_BACKENDS} backends.`);
		}
	}
	if (backends.length === 0) return fail("This link carries no backends.");
	return { ok: true, backends };
}

/** Decode what the address bar holds: with or without the leading `#`, nothing else around it. */
export function decodeConnectHash(hash: string): ConnectDecode {
	const trimmed = hash.trim().replace(/^#/, "");
	return decodeConnectPayload(trimmed);
}

function fail(reason: string): ConnectDecode {
	return { ok: false, reason };
}

/**
 * A connect link's address: HTTPS only, an origin and nothing else. Loopback HTTP is deliberately refused here — a link
 * travels between devices, and the app's own add form is where a development backend is typed by hand.
 */
function connectOrigin(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_CONNECT_URL_LENGTH) return undefined;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:") return undefined;
	if (url.username.length > 0 || url.password.length > 0) return undefined;
	if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) return undefined;
	return url.origin;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function hasControlCharacter(value: string): boolean {
	return CONTROL_CHARACTERS.test(value);
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
