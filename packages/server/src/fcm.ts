/**
 * Firebase Cloud Messaging for the Android app: the HTTP v1 API, signed in with a service-account key of the app's
 * Firebase project.
 *
 * The key is a file the user puts in the data directory (or names with `MIHAI_HARNESS_FCM_KEY_FILE`); without it FCM is
 * simply off. Its private key never leaves this module: it signs the OAuth 2 JWT-bearer assertion (RFC 7523) that buys a
 * one-hour access token, and only that token goes to FCM. Messages are data-only, carrying the same JSON payload a
 * browser gets through Web Push, so the app draws the notification itself (channel, tap target, presence).
 */
import { Buffer } from "node:buffer";
import { chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Environment } from "./data-dir.ts";
import { errorMessage } from "./errors.ts";
import { readJsonFile } from "./fs-json.ts";

/** Names the service-account key file outright; else `<data>/notifications/fcm-service-account.json`. */
export const FCM_KEY_FILE_ENV = "MIHAI_HARNESS_FCM_KEY_FILE";
export const FCM_KEY_FILE_NAME = "fcm-service-account.json";
export const FCM_ENDPOINT = "https://fcm.googleapis.com";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
/** An access token is used until this long before it expires. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/** `${MIHAI_HARNESS_FCM_KEY_FILE}` when set, else `<data>/notifications/fcm-service-account.json`. */
export function resolveFcmKeyFile(dataDir: string, env: Environment = process.env): string {
	const override = env[FCM_KEY_FILE_ENV];
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	return join(dataDir, "notifications", FCM_KEY_FILE_NAME);
}

/** The parts of a Google service-account key file FCM needs. */
export type FcmServiceAccount = {
	projectId: string;
	clientEmail: string;
	/** PKCS #8 PEM. */
	privateKey: string;
	tokenUri: string;
};

/** A service-account key as Google's console downloads it, or a reason it is not one (never quoting the key). */
export function parseFcmServiceAccount(raw: unknown): FcmServiceAccount | string {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "not a JSON object";
	const record = raw as Record<string, unknown>;
	if (record.type !== "service_account") return 'its "type" is not "service_account"';
	const projectId = record.project_id;
	const clientEmail = record.client_email;
	const privateKey = record.private_key;
	const tokenUri = record.token_uri ?? GOOGLE_TOKEN_URI;
	if (typeof projectId !== "string" || projectId.length === 0) return "no project_id";
	if (typeof clientEmail !== "string" || clientEmail.length === 0) return "no client_email";
	if (typeof privateKey !== "string" || !privateKey.includes("BEGIN PRIVATE KEY")) return "no PKCS #8 private_key";
	if (typeof tokenUri !== "string" || !/^https?:\/\//.test(tokenUri)) return "no usable token_uri";
	return { projectId, clientEmail, privateKey, tokenUri };
}

/**
 * The service account in `file`, or undefined when there is none (FCM off) or it is unusable (logged, FCM off). Either
 * way the server starts: Android pushes are an addition, not something a backend needs to run.
 */
export async function loadFcmServiceAccount(
	file: string,
	log: (message: string) => void = () => undefined,
): Promise<FcmServiceAccount | undefined> {
	let raw: unknown;
	try {
		raw = await readJsonFile(file);
	} catch (error) {
		// Only the error code: a JSON parser's message may quote the file, and the file holds a private key.
		const code = (error as NodeJS.ErrnoException).code;
		log(`notifications: FCM off; ${file} is ${code === undefined ? "not valid JSON" : `unreadable (${code})`}`);
		return undefined;
	}
	if (raw === undefined) {
		log(`notifications: FCM off (no service-account key at ${file})`);
		return undefined;
	}
	const account = parseFcmServiceAccount(raw);
	if (typeof account === "string") {
		log(`notifications: FCM off; ${file} is not a service-account key: ${account}`);
		return undefined;
	}
	if (!(await importSigningKey(account.privateKey).then(() => true, () => false))) {
		log(`notifications: FCM off; the private key in ${file} cannot be read`);
		return undefined;
	}
	// A key someone copied in readable by others is narrowed here, like the VAPID pair.
	await chmod(file, 0o600).catch(() => undefined);
	log(`notifications: FCM on for Firebase project ${account.projectId} (key ${file})`);
	return account;
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
	const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
	const bytes = Buffer.from(base64, "base64");
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy;
}

function importSigningKey(pem: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("pkcs8", pemBody(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

function base64urlJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** The RS256 JWT a service account trades for an access token (RFC 7523, Google's `jwt-bearer` grant). */
export async function serviceAccountAssertion(account: FcmServiceAccount, nowMs: number): Promise<string> {
	const iat = Math.floor(nowMs / 1000);
	const unsigned = `${base64urlJson({ alg: "RS256", typ: "JWT" })}.${base64urlJson({
		iss: account.clientEmail,
		scope: FCM_SCOPE,
		aud: account.tokenUri,
		iat,
		exp: iat + 3600,
	})}`;
	const key = await importSigningKey(account.privateKey);
	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
	return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
}

/** One data message to one app instance. */
export type FcmMessage = {
	token: string;
	data: Record<string, string>;
	ttlSeconds: number;
};

export type FcmResult = {
	status: number | null;
	message: string | null;
	/** FCM no longer knows the token (app uninstalled, data cleared, token rotated): stop sending to it. */
	unregistered: boolean;
};

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type FcmSenderOptions = {
	account: FcmServiceAccount;
	/** FCM's origin. Default: `https://fcm.googleapis.com`; tests point it at a fake. */
	endpoint?: string;
	fetch?: Fetch;
	now?: () => number;
	log?: (message: string) => void;
};

/** Google's error body: `{ error: { code, message, status, details: [{ errorCode }] } }`. */
function fcmError(text: string): { message: string | null; errorCode: string | null } {
	try {
		const parsed = JSON.parse(text) as { error?: { message?: unknown; status?: unknown; details?: unknown } };
		const error = parsed.error;
		if (error === undefined || error === null) return { message: text.length === 0 ? null : text.slice(0, 300), errorCode: null };
		const details = Array.isArray(error.details) ? (error.details as { errorCode?: unknown }[]) : [];
		const errorCode =
			details.map((detail) => detail.errorCode).find((code): code is string => typeof code === "string") ??
			(typeof error.status === "string" ? error.status : null);
		const message = typeof error.message === "string" ? error.message : null;
		return { message: [errorCode, message].filter((part) => part !== null).join(": ").slice(0, 300) || null, errorCode };
	} catch {
		return { message: text.length === 0 ? null : text.slice(0, 300), errorCode: null };
	}
}

/**
 * Sends data messages through FCM's HTTP v1 API. It keeps one access token and renews it before it expires or when FCM
 * refuses it; it never throws, so a push stays out of the caller's failure path like a Web Push one.
 */
export class FcmSender {
	readonly #account: FcmServiceAccount;
	readonly #endpoint: string;
	readonly #fetch: Fetch;
	readonly #now: () => number;
	readonly #log: (message: string) => void;
	#token: { value: string; expiresAt: number } | undefined;
	#renewing: Promise<string> | undefined;

	constructor(options: FcmSenderOptions) {
		this.#account = options.account;
		this.#endpoint = (options.endpoint ?? FCM_ENDPOINT).replace(/\/+$/, "");
		this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
		this.#now = options.now ?? Date.now;
		this.#log = options.log ?? (() => undefined);
	}

	get projectId(): string {
		return this.#account.projectId;
	}

	async send(message: FcmMessage): Promise<FcmResult> {
		let token: string;
		try {
			token = await this.#accessToken();
		} catch (error) {
			const text = errorMessage(error);
			this.#log(`notifications: FCM sign-in failed: ${text}`);
			return { status: null, message: `FCM sign-in failed: ${text}`, unregistered: false };
		}
		let result = await this.#post(message, token);
		if (result.status === 401) {
			// The token was revoked or the clock jumped: one fresh token, one more try.
			this.#token = undefined;
			try {
				result = await this.#post(message, await this.#accessToken());
			} catch (error) {
				return { status: null, message: `FCM sign-in failed: ${errorMessage(error)}`, unregistered: false };
			}
		}
		return result;
	}

	async #post(message: FcmMessage, accessToken: string): Promise<FcmResult> {
		const body = {
			message: {
				token: message.token,
				data: message.data,
				// High priority wakes the app in Doze to draw the notification; every message here becomes one.
				android: { priority: "HIGH", ttl: `${message.ttlSeconds}s` },
			},
		};
		try {
			const response = await this.#fetch(
				`${this.#endpoint}/v1/projects/${encodeURIComponent(this.#account.projectId)}/messages:send`,
				{
					method: "POST",
					headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
					body: JSON.stringify(body),
				},
			);
			const text = (await response.text().catch(() => "")).trim();
			if (response.ok) return { status: response.status, message: null, unregistered: false };
			const error = fcmError(text);
			const unregistered =
				error.errorCode === "UNREGISTERED" ||
				response.status === 404 ||
				// A token FCM cannot parse will never work; the app registers a fresh one on its next start.
				(response.status === 400 && /registration token/i.test(error.message ?? ""));
			return { status: response.status, message: error.message, unregistered };
		} catch (error) {
			return { status: null, message: errorMessage(error), unregistered: false };
		}
	}

	#accessToken(): Promise<string> {
		const cached = this.#token;
		if (cached !== undefined && cached.expiresAt - TOKEN_MARGIN_MS > this.#now()) return Promise.resolve(cached.value);
		this.#renewing ??= this.#renew().finally(() => {
			this.#renewing = undefined;
		});
		return this.#renewing;
	}

	async #renew(): Promise<string> {
		const now = this.#now();
		const assertion = await serviceAccountAssertion(this.#account, now);
		const response = await this.#fetch(this.#account.tokenUri, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
		});
		const text = await response.text().catch(() => "");
		if (!response.ok) throw new Error(`the token endpoint answered ${response.status}: ${text.slice(0, 200)}`);
		const parsed = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
		if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
			throw new Error("the token endpoint answered without an access_token");
		}
		const lifetime = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
		this.#token = { value: parsed.access_token, expiresAt: now + lifetime * 1000 };
		return parsed.access_token;
	}
}
