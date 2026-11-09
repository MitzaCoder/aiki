/**
 * Web Push notifications: one VAPID key pair for every backend, devices registered per backend, and one `Notifier` the
 * rest of the server calls. Android devices register an FCM token instead of a subscription and are sent the same
 * payload through `fcm.ts`; everything else (kinds, quiet hours, mutes, presence, dedupe) is shared.
 *
 * Encryption and signing are `web-push`'s (`generateRequestDetails`, RFC 8291 aes128gcm and the RFC 8292 VAPID JWT),
 * which runs unchanged on Bun; only the HTTP POST is ours, through `fetch`, so the push service sees exactly the request
 * the library built. A push never reaches the caller's failure path: every attempt is recorded on the device
 * (`lastDelivery`), a device the push service no longer knows (404/410) is dropped, and everything else is logged.
 *
 * Holding: while some connection is visible (`NotificationPresence.anyVisible`), an event is held for `NOTIFICATION_HOLD_MS`
 * and pushed when the hold ends, unless a connection reports interaction first (`Notifier.interaction`), which drops every
 * held event. Held events are persisted in the state file and carried on after a restart (`Notifier.restore`).
 *
 * No duplicates: events carry a dedupe key (`reply:<project>:<entry>`, `deploy:<commit>:<attempt>`, …) and the keys are
 * persisted, so a restart that replays a watch or re-reads a deploy status notifies nothing twice.
 */
import {
	DEFAULT_NOTIFICATION_KINDS,
	NOTIFICATION_FAILURE_KINDS,
	NOTIFICATION_HOLD_MS,
	type AuthLogin,
	type DeployStatus,
	type NotificationDevice,
	type NotificationKind,
	type NotificationPayload,
	type NotificationPreferences,
	type NotificationTransport,
	type PushSubscription,
	type ScheduleRun,
} from "@mihai-harness/protocol";
import { Buffer } from "node:buffer";
import { chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as webpush from "web-push";
import type { Environment } from "./data-dir.ts";
import { ServerError, errorMessage } from "./errors.ts";
import type { FcmSender } from "./fcm.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";

/** Where the keys, the devices and the dedupe state live, under the data directory. */
export const NOTIFICATIONS_DIR_NAME = "notifications";
export const VAPID_KEY_FILE_NAME = "vapid.json";
export const DEVICES_FILE_NAME = "devices.json";
export const NOTIFICATION_STATE_FILE_NAME = "state.json";
/** Names the VAPID key pair file outright, for a backend whose data directory is not the default. */
export const VAPID_KEY_FILE_ENV = "MIHAI_HARNESS_VAPID_KEY_FILE";
/** The VAPID `sub`, which RFC 8292 wants to be the app's URL; overrides what the allowed origins give. */
export const VAPID_SUBJECT_ENV = "MIHAI_HARNESS_VAPID_SUBJECT";
/** A push nobody picked up is dropped by the push service after this long. */
export const NOTIFICATION_TTL_SECONDS = 12 * 60 * 60;
/** How many dedupe keys are kept; old ones fall off, and an event that far back is never replayed. */
export const KEPT_NOTIFIED_KEYS = 500;
/** The most text one notification carries before an ellipsis. */
export const NOTIFICATION_BODY_LIMIT = 200;

/** When no allowed origin is HTTPS there is still a subject to sign with; a push service is the one that cares. */
export const DEFAULT_VAPID_SUBJECT = "https://localhost";

export type VapidKeys = { publicKey: string; privateKey: string };

type VapidFile = VapidKeys & { version: 1 };
type DevicesFile = { version: 1; devices: StoredDevice[] };
type StateFile = { version: 1; deployAttempt: string | null; notified: string[]; held?: HeldEvent[] };

/** An event waiting out its hold: what it was, when it happened (the payload's `at`) and when the hold ends. */
export type HeldEvent = { id: string; event: NotificationEvent; at: string; dueAt: number };

function parseHeldEvent(raw: unknown): HeldEvent | undefined {
	if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.at !== "string" || typeof raw.dueAt !== "number") {
		return undefined;
	}
	const event = raw.event;
	if (!isRecord(event) || typeof event.kind !== "string" || typeof event.title !== "string") return undefined;
	if (typeof event.body !== "string") return undefined;
	if (event.kind !== "test" && !STORED_KINDS.has(event.kind)) return undefined;
	return { id: raw.id, event: event as NotificationEvent, at: raw.at, dueAt: raw.dueAt };
}

/** `~` is the service user's home, which is what a deploy script would write too. */
function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/** `${MIHAI_HARNESS_VAPID_KEY_FILE}` when set, else `<data>/notifications/vapid.json`. */
export function resolveVapidKeyFile(dataDir: string, env: Environment = process.env): string {
	const override = env[VAPID_KEY_FILE_ENV];
	if (override !== undefined && override.trim().length > 0) return resolve(expandHome(override.trim()));
	return join(dataDir, NOTIFICATIONS_DIR_NAME, VAPID_KEY_FILE_NAME);
}

/**
 * The VAPID `sub`: RFC 8292 wants a `mailto:` or an `https:` URL, and the app's own URL is the one that names this
 * harness. It comes from the allowed-origins configuration rather than a constant, so the deploy and the app agree.
 */
export function resolveVapidSubject(allowedOrigins: readonly string[], env: Environment = process.env): string {
	const override = env[VAPID_SUBJECT_ENV];
	if (override !== undefined && override.trim().length > 0) {
		const trimmed = override.trim();
		try {
			const url = new URL(trimmed);
			if (url.protocol === "https:" || url.protocol === "mailto:") return trimmed;
		} catch {
			// Not a URL at all: fall through rather than sign with something a push service will reject.
		}
	}
	return allowedOrigins.find((origin) => origin.startsWith("https://")) ?? DEFAULT_VAPID_SUBJECT;
}

function base64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

/** Bytes as the WebCrypto types want them: an `ArrayBuffer`-backed copy, not a view onto a pool. */
function bytesOf(source: Uint8Array | null): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(source?.length ?? 0);
	if (source !== null) copy.set(source);
	return copy;
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> | undefined {
	try {
		return bytesOf(Buffer.from(value, "base64url"));
	} catch {
		return undefined;
	}
}

/** An uncompressed P-256 point: `0x04` then the 32-byte x and y, which is what a VAPID public key is. */
function rawPublicKey(jwk: JsonWebKey): string {
	const x = jwk.x === undefined ? undefined : fromBase64url(jwk.x);
	const y = jwk.y === undefined ? undefined : fromBase64url(jwk.y);
	if (x === undefined || y === undefined || x.length !== 32 || y.length !== 32) {
		throw new Error("the generated P-256 key has no usable coordinates");
	}
	const point = new Uint8Array(65);
	point[0] = 0x04;
	point.set(x, 1);
	point.set(y, 33);
	return base64url(point);
}

/** A fresh VAPID key pair, in the two base64url strings `web-push` takes. */
export async function createVapidKeys(): Promise<VapidKeys> {
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
	const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
	if (jwk.d === undefined) throw new Error("the generated P-256 key has no private part");
	return { publicKey: rawPublicKey(jwk), privateKey: jwk.d };
}

/** Whether `keys` is a usable pair: a 65-byte point and a 32-byte scalar that sign and verify together. */
export async function vapidKeysWork(keys: VapidKeys): Promise<boolean> {
	const publicBytes = fromBase64url(keys.publicKey);
	const privateBytes = fromBase64url(keys.privateKey);
	if (publicBytes === undefined || privateBytes === undefined) return false;
	if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) return false;
	if (privateBytes.length !== 32) return false;
	try {
		const privateKey = await crypto.subtle.importKey(
			"jwk",
			{
				kty: "EC",
				crv: "P-256",
				d: keys.privateKey,
				x: base64url(publicBytes.subarray(1, 33)),
				y: base64url(publicBytes.subarray(33)),
			},
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["sign"],
		);
		const publicKey = await crypto.subtle.importKey(
			"raw",
			publicBytes,
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);
		const probe = new TextEncoder().encode("mihai-harness vapid key check");
		const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, probe);
		return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, probe);
	} catch {
		return false;
	}
}

function parseVapidFile(raw: unknown): VapidKeys | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const record = raw as Partial<VapidFile>;
	if (typeof record.publicKey !== "string" || typeof record.privateKey !== "string") return undefined;
	if (record.publicKey.length === 0 || record.privateKey.length === 0) return undefined;
	return { publicKey: record.publicKey, privateKey: record.privateKey };
}

/**
 * The key pair every backend signs with, read from `file` or generated and written there (mode 0600) on first start. A
 * file that does not hold a working pair is a configuration error, not something to overwrite: replacing it would
 * silently invalidate every subscription the user already has.
 */
export async function loadOrCreateVapidKeys(file: string): Promise<VapidKeys> {
	const raw = await readJsonFile(file);
	if (raw !== undefined) {
		const keys = parseVapidFile(raw);
		if (keys === undefined || !(await vapidKeysWork(keys))) {
			throw new Error(
				`${file} does not hold a working VAPID key pair; fix or remove it (removing it invalidates existing push subscriptions)`,
			);
		}
		// A file another process or an older copy left readable is narrowed here, like every other file this server owns.
		await chmod(file, 0o600).catch(() => undefined);
		return keys;
	}
	const keys = await createVapidKeys();
	await writeJsonFile(file, { version: 1, ...keys } satisfies VapidFile, 0o600);
	return keys;
}

// --- devices and their persistent state ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A device as this backend keeps it: what the protocol shows (`NotificationDevice`) plus where it is pushed to, a browser's
 * Web Push subscription or an Android app's FCM token. Either stays on the server: the app that registered it holds it.
 */
export type StoredDevice = NotificationDevice &
	({ subscription: PushSubscription; fcmToken?: undefined } | { fcmToken: string; subscription?: undefined });

/** Where a device is reached, as `register` and `registerFcm` take it. */
export type DeviceAddress = { subscription: PushSubscription } | { fcmToken: string };

function transportOf(device: Pick<StoredDevice, "fcmToken">): NotificationTransport {
	return device.fcmToken === undefined ? "web-push" : "fcm";
}

/** The kinds a stored preference may name; anything else in the file is dropped. */
const STORED_KINDS: ReadonlySet<string> = new Set([
	"reply",
	"worker_report",
	"worker_failed",
	"schedule_done",
	"schedule_problem",
	"deploy_problem",
	"login_prompt",
	"compaction_failed",
	"maintenance_failed",
	"board_question",
	"task_review",
	"thread_finished",
	"thread_failed",
	"work_finished",
	"disk_low",
]);

function parseSubscription(raw: unknown): PushSubscription | undefined {
	if (!isRecord(raw) || typeof raw.endpoint !== "string" || raw.endpoint.length === 0) return undefined;
	const keys = raw.keys;
	if (!isRecord(keys) || typeof keys.p256dh !== "string" || keys.p256dh.length === 0) return undefined;
	if (typeof keys.auth !== "string" || keys.auth.length === 0) return undefined;
	const expirationTime = raw.expirationTime;
	return {
		endpoint: raw.endpoint,
		...(typeof expirationTime === "number" || expirationTime === null ? { expirationTime } : {}),
		keys: { p256dh: keys.p256dh, auth: keys.auth },
	};
}

function parsePreferences(raw: unknown): NotificationPreferences | undefined {
	if (!isRecord(raw)) return undefined;
	const kinds = Array.isArray(raw.kinds)
		? raw.kinds.filter((kind): kind is NotificationKind => typeof kind === "string" && STORED_KINDS.has(kind))
		: undefined;
	const mutedProjects = Array.isArray(raw.mutedProjects)
		? raw.mutedProjects.filter((id): id is string => typeof id === "string")
		: undefined;
	if (kinds === undefined || mutedProjects === undefined) return undefined;
	const quiet = raw.quietHours;
	let quietHours: NotificationPreferences["quietHours"] = null;
	if (isRecord(quiet)) {
		const { start, end, timezone, allowFailures } = quiet;
		if (
			typeof start !== "string" ||
			typeof end !== "string" ||
			typeof timezone !== "string" ||
			typeof allowFailures !== "boolean"
		) {
			return undefined;
		}
		quietHours = { start, end, timezone, allowFailures };
	} else if (quiet !== null && quiet !== undefined) {
		return undefined;
	}
	return { kinds, mutedProjects, quietHours };
}

/** A device read back from `devices.json`; anything that does not validate is dropped, like a stored schedule. */
function parseDevice(raw: unknown): StoredDevice | undefined {
	if (!isRecord(raw)) return undefined;
	if (typeof raw.deviceId !== "string" || raw.deviceId.length === 0) return undefined;
	if (typeof raw.backendKey !== "string" || raw.backendKey.length === 0) return undefined;
	const fcmToken = typeof raw.fcmToken === "string" && raw.fcmToken.length > 0 ? raw.fcmToken : undefined;
	const subscription = fcmToken === undefined ? parseSubscription(raw.subscription) : undefined;
	const preferences = parsePreferences(raw.preferences);
	if ((subscription === undefined && fcmToken === undefined) || preferences === undefined) return undefined;
	const address: DeviceAddress = fcmToken === undefined ? { subscription: subscription! } : { fcmToken };
	const last = raw.lastDelivery;
	const lastDelivery: NotificationDevice["lastDelivery"] = isRecord(last)
		? {
				at: typeof last.at === "string" ? last.at : new Date().toISOString(),
				ok: last.ok === true,
				status: typeof last.status === "number" ? last.status : null,
				message: typeof last.message === "string" ? last.message : null,
			}
		: null;
	return {
		deviceId: raw.deviceId,
		label: typeof raw.label === "string" ? raw.label : "",
		backendKey: raw.backendKey,
		...address,
		preferences,
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
		lastDelivery,
	};
}

/** The device as the protocol shows it: its address is between the device and its push service, not the app. */
export function publicDevice(device: StoredDevice): NotificationDevice {
	const { subscription: _subscription, fcmToken: _fcmToken, transport: _transport, ...rest } = device;
	return { ...rest, transport: transportOf(device) };
}

/** The devices registered with this backend, in `<data>/notifications/devices.json` (mode 0600). */
export class NotificationStore {
	readonly #file: string;
	readonly #log: (message: string) => void;
	readonly #devices = new Map<string, StoredDevice>();
	#writes: Promise<void> = Promise.resolve();
	#loaded = false;

	constructor(options: { dir: string; log?: (message: string) => void }) {
		this.#file = join(options.dir, DEVICES_FILE_NAME);
		this.#log = options.log ?? (() => undefined);
	}

	get file(): string {
		return this.#file;
	}

	/** Read the file once; a corrupt one starts empty rather than stopping the server (devices re-register). */
	async read(): Promise<void> {
		if (this.#loaded) return;
		this.#loaded = true;
		const raw = await readJsonFile(this.#file).catch((error: unknown) => {
			this.#log(`notifications: ${this.#file} is unreadable: ${errorMessage(error)}`);
			return undefined;
		});
		if (raw === undefined) return;
		const devices = isRecord(raw) && Array.isArray(raw.devices) ? raw.devices : undefined;
		if (devices === undefined) {
			this.#log(`notifications: ${this.#file} does not describe devices; starting empty`);
			return;
		}
		for (const entry of devices) {
			const device = parseDevice(entry);
			if (device === undefined) {
				this.#log(`notifications: dropping a device that does not match the protocol from ${this.#file}`);
				continue;
			}
			this.#devices.set(device.deviceId, device);
		}
	}

	list(): StoredDevice[] {
		return [...this.#devices.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	get(deviceId: string): StoredDevice | undefined {
		return this.#devices.get(deviceId);
	}

	/** Register or update one device: its subscription or FCM token, what it calls this backend, and its preferences. */
	async register(
		input: {
			deviceId: string;
			label: string;
			backendKey: string;
			preferences: NotificationPreferences;
			now?: () => number;
		} & DeviceAddress,
	): Promise<StoredDevice> {
		const existing = this.#devices.get(input.deviceId);
		const address: DeviceAddress =
			"fcmToken" in input
				? { fcmToken: input.fcmToken }
				: {
						subscription: {
							endpoint: input.subscription.endpoint,
							...(input.subscription.expirationTime === undefined
								? {}
								: { expirationTime: input.subscription.expirationTime }),
							keys: { p256dh: input.subscription.keys.p256dh, auth: input.subscription.keys.auth },
						},
					};
		const device: StoredDevice = {
			deviceId: input.deviceId,
			label: input.label,
			backendKey: input.backendKey,
			...address,
			preferences: {
				kinds: [...input.preferences.kinds],
				mutedProjects: [...input.preferences.mutedProjects],
				quietHours:
					input.preferences.quietHours === null
						? null
						: {
								start: input.preferences.quietHours.start,
								end: input.preferences.quietHours.end,
								timezone: input.preferences.quietHours.timezone,
								allowFailures: input.preferences.quietHours.allowFailures,
							},
			},
			createdAt: existing?.createdAt ?? new Date((input.now ?? Date.now)()).toISOString(),
			lastDelivery: existing?.lastDelivery ?? null,
		};
		this.#devices.set(device.deviceId, device);
		await this.#persist();
		return device;
	}

	/** Forget a device; false when it was not registered. */
	async unregister(deviceId: string): Promise<boolean> {
		if (!this.#devices.delete(deviceId)) return false;
		await this.#persist();
		return true;
	}

	/** Record the last push attempt to a device, for `notifications.device`. */
	async setLastDelivery(deviceId: string, delivery: StoredDevice["lastDelivery"]): Promise<void> {
		const device = this.#devices.get(deviceId);
		if (device === undefined) return;
		this.#devices.set(deviceId, { ...device, lastDelivery: delivery });
		await this.#persist();
	}

	/** Wait for every write this store queued, so a test (or a shutdown) sees the file settled. */
	async flush(): Promise<void> {
		await this.#writes;
	}

	#persist(): Promise<void> {
		const run = this.#writes.then(async () => {
			const file: DevicesFile = { version: 1, devices: this.list() };
			await writeJsonFile(this.#file, file, 0o600);
		});
		this.#writes = run.catch((error: unknown) => {
			this.#log(`notifications: could not save ${this.#file}: ${errorMessage(error)}`);
		});
		return run;
	}
}

/**
 * What this backend already notified and which deploy attempt it reported: keys are kept, the deploy attempt is one
 * value, so a restart that replays a watch or re-reads the deploy status notifies nothing twice.
 */
export class NotificationStateStore {
	readonly #file: string;
	readonly #log: (message: string) => void;
	readonly keys: Set<string>;
	/** Events in their hold, by ID, in the order they happened. */
	readonly held = new Map<string, HeldEvent>();
	#deployAttempt: string | null = null;
	#writes: Promise<void> = Promise.resolve();
	/** The write that has not started yet, which later claims join. */
	#queued: Promise<void> | undefined;
	#loaded = false;

	constructor(options: { dir: string; log?: (message: string) => void; keys?: Iterable<string> }) {
		this.#file = join(options.dir, NOTIFICATION_STATE_FILE_NAME);
		this.#log = options.log ?? (() => undefined);
		this.keys = new Set(options.keys ?? []);
	}

	get file(): string {
		return this.#file;
	}

	get deployAttempt(): string | null {
		return this.#deployAttempt;
	}

	async read(): Promise<void> {
		if (this.#loaded) return;
		this.#loaded = true;
		const raw = await readJsonFile(this.#file).catch((error: unknown) => {
			this.#log(`notifications: ${this.#file} is unreadable: ${errorMessage(error)}`);
			return undefined;
		});
		if (raw === undefined || !isRecord(raw)) return;
		if (typeof raw.deployAttempt === "string") this.#deployAttempt = raw.deployAttempt;
		if (Array.isArray(raw.notified)) {
			for (const key of raw.notified) if (typeof key === "string") this.keys.add(key);
		}
		if (Array.isArray(raw.held)) {
			for (const entry of raw.held) {
				const held = parseHeldEvent(entry);
				if (held !== undefined) this.held.set(held.id, held);
			}
		}
	}

	/** Remember an event in its hold, so a restart does not lose it. */
	hold(held: HeldEvent): void {
		this.held.set(held.id, held);
		void this.#persist();
	}

	/** Forget held events (pushed or dropped); returns how many were held. */
	release(ids: Iterable<string>): number {
		let released = 0;
		for (const id of ids) if (this.held.delete(id)) released += 1;
		if (released > 0) void this.#persist();
		return released;
	}

	/** Whether this event key was already notified; records it when it was not. */
	claim(key: string): boolean {
		if (this.keys.has(key)) return false;
		this.keys.add(key);
		while (this.keys.size > KEPT_NOTIFIED_KEYS) {
			const oldest = this.keys.values().next().value;
			if (oldest === undefined) break;
			this.keys.delete(oldest);
		}
		void this.#persist();
		return true;
	}

	/** Whether this deploy attempt was already reported; records it when it was not. */
	claimDeployAttempt(attempt: string): boolean {
		if (this.#deployAttempt === attempt) return false;
		this.#deployAttempt = attempt;
		void this.#persist();
		return true;
	}

	async flush(): Promise<void> {
		await this.#writes;
	}

	/**
	 * Save the state after the write in flight. Claims made while a write waits to start join it, since it reads the state
	 * when it starts: a burst of claims costs one or two writes, not one each.
	 */
	#persist(): Promise<void> {
		if (this.#queued !== undefined) return this.#queued;
		const run = this.#writes.then(async () => {
			this.#queued = undefined;
			const file: StateFile = {
				version: 1,
				deployAttempt: this.#deployAttempt,
				notified: [...this.keys],
				...(this.held.size === 0 ? {} : { held: [...this.held.values()] }),
			};
			await writeJsonFile(this.#file, file, 0o600);
		});
		this.#queued = run;
		this.#writes = run.catch((error: unknown) => {
			this.#log(`notifications: could not save ${this.#file}: ${errorMessage(error)}`);
		});
		return run;
	}
}

// --- presence -----------------------------------------------------------------------------------------------------

export type ConnectionPresence = {
	deviceId: string;
	/** Whether the page is visible (or the app in the foreground); a hidden tab is not open. */
	visible: boolean;
	/** What the connection shows. Kept for the record; the hold does not depend on it. */
	projectId: string | null;
};

/**
 * Which connections to this backend are open: visible, on any device, showing any project. One entry per connection,
 * forgotten when the socket closes. A connection that never reported is not counted (it is not known to be open).
 */
export class NotificationPresence {
	readonly #byConnection = new Map<object, ConnectionPresence>();

	set(connection: object, presence: ConnectionPresence): void {
		this.#byConnection.set(connection, presence);
	}

	remove(connection: object): void {
		this.#byConnection.delete(connection);
	}

	/** Whether any connection is visible: the app is open somewhere, so events are held before they are pushed. */
	anyVisible(): boolean {
		for (const presence of this.#byConnection.values()) if (presence.visible) return true;
		return false;
	}

	/** Every presence a device has, for tests and for `notifications.device`. */
	of(deviceId: string): ConnectionPresence[] {
		return [...this.#byConnection.values()].filter((presence) => presence.deviceId === deviceId);
	}

	clear(): void {
		this.#byConnection.clear();
	}
}

// --- filtering ----------------------------------------------------------------------------------------------------

export type BlockedReason = "kind" | "muted" | "quiet";

function parseTimeOfDay(value: string): number | undefined {
	const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
	if (match === null) return undefined;
	return Number(match[1]) * 60 + Number(match[2]);
}

/** The wall-clock minute of `at` in `timezone`, or undefined for a zone `Intl` does not know. */
export function minutesInTimezone(at: Date, timezone: string): number | undefined {
	try {
		const parts = new Intl.DateTimeFormat("en-GB", {
			timeZone: timezone,
			hourCycle: "h23",
			hour: "2-digit",
			minute: "2-digit",
		}).formatToParts(at);
		const hour = Number(parts.find((part) => part.type === "hour")?.value);
		const minute = Number(parts.find((part) => part.type === "minute")?.value);
		if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
		return hour * 60 + minute;
	} catch {
		return undefined;
	}
}

/**
 * Whether `at` falls in the device's quiet hours, in its own timezone. A window whose end is earlier than its start
 * crosses midnight (`22:00`–`07:00` is quiet at 23:30 and at 06:59). Identical ends mean no quiet hours, and a zone
 * `Intl` does not know is no quiet hours either: a device must not go silent over a bad setting.
 */
export function inQuietHours(quiet: NonNullable<NotificationPreferences["quietHours"]>, at: Date): boolean {
	const start = parseTimeOfDay(quiet.start);
	const end = parseTimeOfDay(quiet.end);
	if (start === undefined || end === undefined || start === end) return false;
	const now = minutesInTimezone(at, quiet.timezone);
	if (now === undefined) return false;
	return start < end ? now >= start && now < end : now >= start || now < end;
}

export type NotificationEvent = {
	kind: NotificationKind | "test";
	title: string;
	body: string;
	projectId?: string | null;
	workerId?: string | null;
	scheduleId?: string | null;
	/** The background thread it is about ("main" for main's own); the app opens main and highlights its card. */
	threadId?: string | null;
	/** The board task it is about; the app opens that task. */
	taskId?: string | null;
	/** Notifications that share a tag replace each other on the device. Default: one per event kind and target. */
	tag?: string;
	/** Persisted dedupe key: an event with a key this backend already sent is not sent again, even after a restart. */
	key?: string;
};

export function notificationTag(event: Pick<NotificationEvent, "kind" | "projectId" | "workerId" | "scheduleId">): string {
	const parts: string[] = [event.kind];
	if (event.projectId !== null && event.projectId !== undefined) parts.push(event.projectId);
	if (event.workerId !== null && event.workerId !== undefined) parts.push(event.workerId);
	if (event.scheduleId !== null && event.scheduleId !== undefined) parts.push(event.scheduleId);
	return parts.join(":");
}

/**
 * Why this device does not get this event, or undefined when it does: the kind is off, the project is muted, or it is in
 * quiet hours (which `allowFailures` lets the failure kinds through).
 */
export function notificationBlocked(
	device: Pick<StoredDevice, "deviceId" | "preferences">,
	event: Pick<NotificationEvent, "kind" | "projectId">,
	options: { at: Date },
): BlockedReason | undefined {
	// A test push is the user asking for one right now: no preference can silence it.
	if (event.kind === "test") return undefined;
	const preferences = device.preferences;
	if (!preferences.kinds.includes(event.kind)) return "kind";
	if (
		event.projectId !== null &&
		event.projectId !== undefined &&
		preferences.mutedProjects.includes(event.projectId)
	) {
		return "muted";
	}
	const quiet = preferences.quietHours;
	if (quiet !== null && inQuietHours(quiet, options.at)) {
		const failure = NOTIFICATION_FAILURE_KINDS.includes(event.kind);
		if (!(quiet.allowFailures && failure)) return "quiet";
	}
	return undefined;
}

// --- payloads from events -----------------------------------------------------------------------------------------

/** One line of text, trimmed and cut to what a notification can show. */
export function notificationLine(text: string | null | undefined, limit = NOTIFICATION_BODY_LIMIT): string {
	const first = (text ?? "").trim().split("\n")[0]?.trim() ?? "";
	if (first.length <= limit) return first;
	return `${first.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/** The payload one device gets: its own `backendKey`, so a deep link lands on the backend that pushed it. */
export function notificationPayload(
	device: Pick<NotificationDevice, "backendKey">,
	event: NotificationEvent,
	at: string,
): NotificationPayload {
	return {
		kind: event.kind,
		title: notificationLine(event.title, 80),
		body: event.body,
		backendKey: device.backendKey,
		projectId: event.projectId ?? null,
		workerId: event.workerId ?? null,
		scheduleId: event.scheduleId ?? null,
		...(event.threadId === undefined ? {} : { threadId: event.threadId }),
		...(event.taskId === undefined ? {} : { taskId: event.taskId }),
		tag: event.tag ?? notificationTag(event),
		at,
	};
}

/** The coordinator finished an answer: the body is the first line of it. */
export function replyNotification(input: {
	projectId: string;
	projectName: string;
	entryId: number;
	at: string;
	text: string;
}): NotificationEvent {
	return {
		kind: "reply",
		title: `${input.projectName} replied`,
		body: notificationLine(input.text) || "The coordinator finished an answer.",
		projectId: input.projectId,
		tag: `reply:${input.projectId}`,
		key: `reply:${input.projectId}:${input.entryId}`,
	};
}

/** A worker's answer came back to the coordinator, or it could not finish. */
export function workerNotification(input: {
	projectId: string;
	projectName: string;
	workerId: string;
	callId: string;
	kind: "worker_report" | "worker_failed";
	text: string | null;
	failure: string | null;
	/** The background thread that started the worker; absent for main's. */
	threadId?: string;
}): NotificationEvent {
	const failed = input.kind === "worker_failed";
	const thread = input.threadId === undefined || input.threadId === "main" ? undefined : input.threadId;
	return {
		kind: input.kind,
		title: failed ? `Worker failed · ${input.projectName}` : `Worker reported · ${input.projectName}`,
		body: failed
			? notificationLine(input.failure) || "A worker could not finish."
			: notificationLine(input.text) || "A worker reported.",
		projectId: input.projectId,
		workerId: input.workerId,
		...(thread === undefined ? {} : { threadId: thread }),
		tag: thread === undefined ? `worker:${input.workerId}` : `worker:${thread}:${input.workerId}`,
		key:
			thread === undefined
				? `worker:${input.projectId}:${input.workerId}:${input.callId}`
				: `worker:${input.projectId}:${thread}:${input.workerId}:${input.callId}`,
	};
}

/** A background thread finished with a summary: the body is its first line. */
export function threadFinishedNotification(input: {
	projectId: string;
	projectName: string;
	threadId: string;
	title: string;
	summary: string;
	/** The finish's tool call, so a rerun after a restart notifies nobody twice. */
	callId: string;
	scheduleId?: string | null;
}): NotificationEvent {
	return {
		kind: "thread_finished",
		title: `Finished · ${input.title}`,
		body: notificationLine(input.summary) || `${input.projectName}: a background thread finished.`,
		projectId: input.projectId,
		threadId: input.threadId,
		...(input.scheduleId === undefined || input.scheduleId === null ? {} : { scheduleId: input.scheduleId }),
		tag: `thread:${input.projectId}:${input.threadId}`,
		key: `thread-finished:${input.projectId}:${input.threadId}:${input.callId}`,
	};
}

/** A background thread's turn failed; `key` names the failure (its error entry), so it is sent once. */
export function threadFailedNotification(input: {
	projectId: string;
	projectName: string;
	threadId: string;
	title: string;
	failure: string;
	key: string;
	scheduleId?: string | null;
}): NotificationEvent {
	return {
		kind: "thread_failed",
		title: `Thread failed · ${input.title}`,
		body: notificationLine(input.failure) || `${input.projectName}: a background thread failed.`,
		projectId: input.projectId,
		threadId: input.threadId,
		...(input.scheduleId === undefined || input.scheduleId === null ? {} : { scheduleId: input.scheduleId }),
		tag: `thread:${input.projectId}:${input.threadId}`,
		key: `thread-failed:${input.projectId}:${input.key}`,
	};
}

/** A scheduled run that started and has now reported back, so the schedule did its job. */
export function scheduleDoneNotification(input: {
	projectId: string;
	projectName: string;
	scheduleId: string;
	scheduleTitle: string;
	workerId: string;
	callId: string;
	text: string | null;
}): NotificationEvent {
	return {
		kind: "schedule_done",
		title: `Scheduled task done · ${input.scheduleTitle}`,
		body: notificationLine(input.text) || `${input.projectName}: the scheduled run finished.`,
		projectId: input.projectId,
		workerId: input.workerId,
		scheduleId: input.scheduleId,
		tag: `schedule:${input.scheduleId}`,
		key: `schedule-done:${input.projectId}:${input.scheduleId}:${input.callId}`,
	};
}

/** A scheduled run that started and then could not finish: its worker failed instead of reporting. */
export function scheduleFailureNotification(input: {
	projectId: string;
	projectName: string;
	scheduleId: string;
	scheduleTitle: string;
	workerId: string;
	callId: string;
	failure: string;
}): NotificationEvent {
	return {
		kind: "schedule_problem",
		title: `Scheduled task failed · ${input.scheduleTitle}`,
		body: notificationLine(input.failure) || "The scheduled run could not finish.",
		projectId: input.projectId,
		workerId: input.workerId,
		scheduleId: input.scheduleId,
		tag: `schedule:${input.scheduleId}`,
		key: `schedule-failed:${input.projectId}:${input.scheduleId}:${input.callId}`,
	};
}

/** A schedule that failed or was skipped; a run that started is not a problem. */
export function scheduleProblemNotification(input: {
	projectId: string;
	projectName: string;
	scheduleId: string;
	scheduleTitle: string;
	run: ScheduleRun;
}): NotificationEvent | undefined {
	if (input.run.outcome === "started") return undefined;
	const skipped = input.run.outcome === "skipped";
	return {
		kind: "schedule_problem",
		title: skipped ? `Scheduled task skipped · ${input.scheduleTitle}` : `Scheduled task failed · ${input.scheduleTitle}`,
		body: notificationLine(input.run.message) || (skipped ? "It was skipped." : "It could not start."),
		projectId: input.projectId,
		scheduleId: input.scheduleId,
		tag: `schedule:${input.scheduleId}`,
		key: `schedule:${input.projectId}:${input.scheduleId}:${input.run.at}${input.run.ref == null ? "" : `:${input.run.ref}`}:${input.run.outcome}`,
	};
}

/** The deploy attempt a `server.status.deploy` describes, as the dedupe key of one attempt. */
export function deployAttemptKey(deploy: DeployStatus): string {
	return `${deploy.commit}:${deploy.at}:${deploy.state}`;
}

/** A deploy that failed before publishing or rolled back after the restart; reported once per attempt. */
export function deployProblemNotification(deploy: DeployStatus | null): NotificationEvent | undefined {
	if (deploy === null || deploy.state === "ok") return undefined;
	const rolledBack = deploy.state === "rolled_back";
	const short = deploy.commit.slice(0, 7);
	return {
		kind: "deploy_problem",
		title: rolledBack ? "Deploy rolled back" : "Deploy failed",
		body: notificationLine(
			`${short}${deploy.description.length === 0 ? "" : ` ${deploy.description}`}${deploy.message === null ? "" : `: ${deploy.message}`}`,
		),
		projectId: null,
		tag: "deploy",
		key: `deploy:${deployAttemptKey(deploy)}`,
	};
}

/** A provider login waits for an answer that only the user can give. */
export function loginPromptNotification(login: AuthLogin): NotificationEvent | undefined {
	const prompt = login.prompt;
	if (prompt === undefined || prompt.id.length === 0) return undefined;
	const message = prompt.message.trim().length === 0 ? "Sign in needs an answer." : prompt.message;
	return {
		kind: "login_prompt",
		title: `Sign in · ${login.providerId}`,
		body: notificationLine(message),
		projectId: null,
		tag: `login:${login.id}`,
		key: `login:${login.id}:${prompt.id}`,
	};
}

/** A compaction of the coordinator failed; `pi.live.n` reports it once per failed task. */
export function compactionFailureNotification(input: {
	projectId: string;
	projectName: string;
	taskId: number | string;
	reason?: string | undefined;
	error: string;
}): NotificationEvent {
	return {
		kind: "compaction_failed",
		title: `Compaction failed · ${input.projectName}`,
		body: notificationLine(input.error) || "Compacting the coordinator's conversation failed.",
		projectId: input.projectId,
		tag: `compaction:${input.projectId}`,
		key: `compaction:${input.projectId}:${input.taskId}`,
	};
}

/** The coordinator asked the user a question on the board; one notification per question. */
export function boardQuestionNotification(input: {
	projectId: string;
	projectName: string;
	questionId: string;
	text: string;
	/** The thread that asked; "main" for main. */
	threadId?: string;
	/** The task it is about, if it names one. */
	taskId?: string | null;
	/** A warning, not a question: the user must acknowledge it. */
	warning?: boolean;
}): NotificationEvent {
	return {
		kind: "board_question",
		title: `${input.warning === true ? "Warning" : "Question"} · ${input.projectName}`,
		body: notificationLine(input.text),
		projectId: input.projectId,
		...(input.threadId === undefined ? {} : { threadId: input.threadId }),
		...(input.taskId === undefined || input.taskId === null ? {} : { taskId: input.taskId }),
		tag: `board-question:${input.projectId}:${input.questionId}`,
		key: `board-question:${input.projectId}:${input.questionId}`,
	};
}

/** The coordinator (or a thread) moved a task to review: it is ready for the user. One per move. */
export function taskReviewNotification(input: {
	projectId: string;
	projectName: string;
	taskId: string;
	title: string;
	/** The task's revision after the move, so each move to review is told once. */
	revision: number;
	/** The thread that holds the task, if it is a background thread. */
	threadId?: string;
}): NotificationEvent {
	return {
		kind: "task_review",
		title: `Ready for review · ${input.projectName}`,
		body: notificationLine(`${input.taskId} ${input.title}`),
		projectId: input.projectId,
		...(input.threadId === undefined || input.threadId === "main" ? {} : { threadId: input.threadId }),
		taskId: input.taskId,
		tag: `task-review:${input.projectId}:${input.taskId}`,
		key: `task-review:${input.projectId}:${input.taskId}@${input.revision}`,
	};
}

/** Memory maintenance failed; the run is recorded, and the devices hear about it once. */
export function maintenanceFailureNotification(input: {
	scope: "global" | "project";
	projectId: string | null;
	projectName?: string | null;
	at: string;
	message: string | null;
}): NotificationEvent {
	const where =
		input.scope === "global" ? "global memory" : `${input.projectName ?? input.projectId ?? "project"} memory`;
	return {
		kind: "maintenance_failed",
		title: "Memory maintenance failed",
		body: notificationLine(`${where}: ${input.message ?? "the run failed"}`),
		projectId: input.projectId,
		tag: `maintenance:${input.scope}:${input.projectId ?? ""}`,
		key: `maintenance:${input.scope}:${input.projectId ?? ""}:${input.at}`,
	};
}

/** What `notifications.test` pushes: it says nothing about the backend's work, only that this device hears it. */
export function testNotification(): NotificationEvent {
	return { kind: "test", title: "Test notification", body: "Notifications reach this device.", projectId: null, tag: "test" };
}

// --- sending ------------------------------------------------------------------------------------------------------

/** The POST a push service gets: what `web-push` built, handed to `fetch` (or to a test's fake endpoint). */
export type PushRequest = { endpoint: string; headers: Record<string, string>; body: Uint8Array<ArrayBuffer> };
export type PushResponse = { status: number | null; message: string | null };
export type PushTransport = (request: PushRequest) => Promise<PushResponse>;

/** The default transport: the request `web-push` built, sent as it is. */
export const fetchPush: PushTransport = async (request) => {
	try {
		const response = await fetch(request.endpoint, {
			method: "POST",
			headers: request.headers,
			body: request.body,
		});
		const text = (await response.text().catch(() => "")).trim();
		return { status: response.status, message: text.length === 0 ? null : text.slice(0, 300) };
	} catch (error) {
		return { status: null, message: errorMessage(error) };
	}
};

export type DeliveryOutcome = {
	deviceId: string;
	ok: boolean;
	status: number | null;
	message: string | null;
};

export type NotifyResult = {
	/** Undefined when the event was delivered to at least one device, or deliberately not sent. */
	skipped?: "duplicate" | "no-devices" | "filtered" | "held";
	deliveries: DeliveryOutcome[];
};

export type NotifierOptions = {
	store: NotificationStore;
	state: NotificationStateStore;
	vapid: VapidKeys;
	/** The VAPID `sub`: the app's URL. */
	subject: string;
	presence?: NotificationPresence;
	now?: () => number;
	log?: (message: string) => void;
	send?: PushTransport;
	ttlSeconds?: number;
	/** FCM for Android devices; undefined when this backend has no service-account key (FCM off). */
	fcm?: FcmSender;
	/** Whether a project is archived: its events are dropped. Default: none is. */
	isArchived?: (projectId: string) => Promise<boolean>;
	/** How long an event is held while the app is open. Default: `NOTIFICATION_HOLD_MS` (15 s). */
	holdMs?: number;
	/** Runs `run` after `delayMs` and returns what cancels it. Default: `setTimeout` (a test passes a fake clock). */
	schedule?: HoldScheduler;
};

export type HoldScheduler = (run: () => void, delayMs: number) => () => void;

const timeoutScheduler: HoldScheduler = (run, delayMs) => {
	const timer = setTimeout(run, delayMs);
	return () => clearTimeout(timer);
};

/** What an FCM device's delivery says while this backend cannot send through FCM. */
export const FCM_OFF_MESSAGE = "FCM is off on this backend (no service-account key)";

/**
 * The one thing the rest of the server calls to notify: it decides which devices hear about an event, encrypts and
 * signs one payload per device, posts it to the push service, and records what happened. Nothing here throws at a
 * caller; `notify` is fire and forget, and `deliver` is the awaitable form tests and `notifications.test` use.
 */
export class Notifier {
	readonly presence: NotificationPresence;
	readonly #store: NotificationStore;
	readonly #state: NotificationStateStore;
	readonly #vapid: VapidKeys;
	readonly #subject: string;
	readonly #now: () => number;
	readonly #log: (message: string) => void;
	readonly #send: PushTransport;
	readonly #ttlSeconds: number;
	readonly #fcm: FcmSender | undefined;
	readonly #isArchived: ((projectId: string) => Promise<boolean>) | undefined;
	readonly #pending = new Set<Promise<unknown>>();
	readonly #holdMs: number;
	readonly #schedule: HoldScheduler;
	/** The timer of every held event, by the held event's ID. */
	readonly #holdTimers = new Map<string, () => void>();

	constructor(options: NotifierOptions) {
		this.#store = options.store;
		this.#state = options.state;
		this.#vapid = options.vapid;
		this.#subject = options.subject;
		this.#now = options.now ?? Date.now;
		this.#log = options.log ?? (() => undefined);
		this.#send = options.send ?? fetchPush;
		this.#ttlSeconds = options.ttlSeconds ?? NOTIFICATION_TTL_SECONDS;
		this.#fcm = options.fcm;
		this.#isArchived = options.isArchived;
		this.#holdMs = options.holdMs ?? NOTIFICATION_HOLD_MS;
		this.#schedule = options.schedule ?? timeoutScheduler;
		this.presence = options.presence ?? new NotificationPresence();
	}

	/** The device's registration on this backend, or null. */
	device(deviceId: string): NotificationDevice | null {
		const device = this.#store.get(deviceId);
		return device === undefined ? null : publicDevice(device);
	}

	/** Register or update a device from `notifications.register` (a subscription) or `notifications.registerFcm` (a token). */
	async register(
		input: {
			deviceId: string;
			label: string;
			backendKey: string;
			preferences: NotificationPreferences;
		} & DeviceAddress,
	): Promise<NotificationDevice> {
		const device = await this.#store.register({ ...input, now: this.#now });
		await this.#store.flush();
		return publicDevice(device);
	}

	/** Forget a device; false when it was not registered. */
	async unregister(deviceId: string): Promise<boolean> {
		const removed = await this.#store.unregister(deviceId);
		await this.#store.flush();
		return removed;
	}

	/** The key pair every backend shares; `notifications.config` answers it. */
	get vapid(): VapidKeys {
		return this.#vapid;
	}

	get subject(): string {
		return this.#subject;
	}

	get publicKey(): string {
		return this.#vapid.publicKey;
	}

	/** The Firebase project FCM pushes go through, or null when FCM is off here. */
	get fcmProjectId(): string | null {
		return this.#fcm?.projectId ?? null;
	}

	/** Fire and forget: the caller's work must never wait for, or fail with, a push. */
	notify(event: NotificationEvent): void {
		const run = this.deliver(event).catch((error: unknown) => {
			this.#log(`notifications: ${event.kind} could not be sent: ${errorMessage(error)}`);
		});
		this.#pending.add(run);
		void run.finally(() => this.#pending.delete(run));
	}

	/**
	 * Send one event and say what each device's push service answered. While some connection is visible the event is
	 * held instead (`skipped: "held"`): `interaction` drops it, the end of the hold pushes it. The key is claimed first
	 * either way, so a dropped event never comes back.
	 */
	async deliver(event: NotificationEvent): Promise<NotifyResult> {
		if (event.key !== undefined && !this.#state.claim(event.key)) return { skipped: "duplicate", deliveries: [] };
		// An archived project is silent. The key was claimed above, so nothing replays when it comes back.
		if (event.projectId !== null && event.projectId !== undefined && (await this.#isArchived?.(event.projectId)) === true) {
			return { skipped: "filtered", deliveries: [] };
		}
		const at = new Date(this.#now());
		if (this.presence.anyVisible() && this.#wanted(event, at)) {
			this.#hold({ id: crypto.randomUUID(), event, at: at.toISOString(), dueAt: at.getTime() + this.#holdMs });
			return { skipped: "held", deliveries: [] };
		}
		return await this.#deliverNow(event, at.toISOString());
	}

	/** Some device would be pushed this event now; with none, holding it would only keep a record nobody reads. */
	#wanted(event: NotificationEvent, at: Date): boolean {
		return this.#store.list().some((device) => notificationBlocked(device, event, { at }) === undefined);
	}

	/** Filter at the moment of sending (a mute or quiet hours changed during the hold count) and push to each device. */
	async #deliverNow(event: NotificationEvent, atIso: string): Promise<NotifyResult> {
		const at = new Date(this.#now());
		const deliveries: DeliveryOutcome[] = [];
		for (const device of this.#store.list()) {
			if (notificationBlocked(device, event, { at }) !== undefined) continue;
			deliveries.push(await this.#push(device, event, atIso));
		}
		return { ...(deliveries.length === 0 ? { skipped: "filtered" as const } : {}), deliveries };
	}

	#hold(held: HeldEvent): void {
		this.#state.hold(held);
		this.#armHold(held);
	}

	#armHold(held: HeldEvent): void {
		const cancel = this.#schedule(() => {
			this.#holdTimers.delete(held.id);
			if (this.#state.release([held.id]) === 0) return;
			const run = this.#deliverNow(held.event, held.at).catch((error: unknown) => {
				this.#log(`notifications: ${held.event.kind} could not be sent: ${errorMessage(error)}`);
			});
			this.#pending.add(run);
			void run.finally(() => this.#pending.delete(run));
		}, Math.max(0, held.dueAt - this.#now()));
		this.#holdTimers.set(held.id, cancel);
	}

	/**
	 * Someone is using the app, on any device: every held event is dropped, for every device (their keys stay claimed).
	 * Returns how many were dropped.
	 */
	interaction(): number {
		const ids = [...this.#state.held.keys()];
		for (const id of ids) {
			this.#holdTimers.get(id)?.();
			this.#holdTimers.delete(id);
		}
		return this.#state.release(ids);
	}

	/** How many events wait in their hold. */
	get heldCount(): number {
		return this.#state.held.size;
	}

	/**
	 * After a restart: carry on with the events that were in their hold. A hold that ran out while the server was down
	 * pushes at once; the others wait the rest of their time, so a client that reconnects can still drop them.
	 */
	restore(): void {
		for (const held of this.#state.held.values()) if (!this.#holdTimers.has(held.id)) this.#armHold(held);
	}

	/** Cancel the hold timers (a shutdown); held events stay in the state file for `restore`. */
	stop(): void {
		for (const cancel of this.#holdTimers.values()) cancel();
		this.#holdTimers.clear();
	}

	/** Push a test notification to one device and report what the push service answered. */
	async test(deviceId: string): Promise<DeliveryOutcome> {
		const device = this.#store.get(deviceId);
		if (device === undefined) {
			throw new ServerError("bad_request", `No device "${deviceId}" is registered with this backend`);
		}
		const outcome = await this.#push(device, testNotification(), new Date(this.#now()).toISOString());
		await this.#store.flush();
		return outcome;
	}

	/** Report the last deploy attempt when it failed or rolled back, once per attempt, across restarts too. */
	async deployProblem(deploy: DeployStatus | null): Promise<void> {
		const event = deployProblemNotification(deploy);
		if (deploy === null || event === undefined) return;
		if (!this.#state.claimDeployAttempt(deployAttemptKey(deploy))) return;
		// The key claim above is the deploy marker; the generic key would only duplicate it.
		await this.deliver({ ...event, key: undefined });
		await this.#state.flush();
	}

	/** Wait for everything `notify` started: a shutdown or a test can then read the devices' last deliveries. */
	async flush(): Promise<void> {
		while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
		await this.#store.flush();
		await this.#state.flush();
	}

	async #push(device: StoredDevice, event: NotificationEvent, at: string): Promise<DeliveryOutcome> {
		const payload = notificationPayload(device, event, at);
		if (device.fcmToken !== undefined) return await this.#pushFcm(device, device.fcmToken, event, payload, at);
		const subscription = device.subscription!;
		let details: webpush.RequestDetails;
		try {
			details = webpush.generateRequestDetails(
				{
					endpoint: subscription.endpoint,
					keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
				},
				JSON.stringify(payload),
				{
					vapidDetails: {
						subject: this.#subject,
						publicKey: this.#vapid.publicKey,
						privateKey: this.#vapid.privateKey,
					},
					TTL: this.#ttlSeconds,
					...(event.kind !== "test" && NOTIFICATION_FAILURE_KINDS.includes(event.kind)
						? { urgency: "high" as const }
						: {}),
					topic: pushTopic(payload.tag),
				},
			);
		} catch (error) {
			// A subscription the library cannot encrypt for is this device's problem, not the caller's.
			const message = errorMessage(error);
			this.#log(`notifications: ${device.deviceId} has an unusable subscription: ${message}`);
			await this.#store.setLastDelivery(device.deviceId, { at, ok: false, status: null, message });
			return { deviceId: device.deviceId, ok: false, status: null, message };
		}
		const response = await this.#send({
			endpoint: subscription.endpoint,
			headers: details.headers,
			body: bytesOf(details.body),
		});
		// The push service forgot the subscription (uninstalled, permission revoked, profile gone): stop trying.
		return await this.#record(device, event, at, response, response.status === 404 || response.status === 410);
	}

	/** The same payload as FCM data (`payload`: its JSON), which the Android app draws itself. */
	async #pushFcm(
		device: StoredDevice,
		token: string,
		event: NotificationEvent,
		payload: NotificationPayload,
		at: string,
	): Promise<DeliveryOutcome> {
		if (this.#fcm === undefined) {
			// Kept registered: the key may be added later, and the device then hears from this backend again.
			await this.#store.setLastDelivery(device.deviceId, { at, ok: false, status: null, message: FCM_OFF_MESSAGE });
			return { deviceId: device.deviceId, ok: false, status: null, message: FCM_OFF_MESSAGE };
		}
		const result = await this.#fcm.send({
			token,
			data: { payload: JSON.stringify(payload) },
			ttlSeconds: this.#ttlSeconds,
		});
		return await this.#record(device, event, at, result, result.unregistered);
	}

	/** Record what the push service answered; a device it no longer knows is dropped. */
	async #record(
		device: StoredDevice,
		event: NotificationEvent,
		at: string,
		response: PushResponse,
		gone: boolean,
	): Promise<DeliveryOutcome> {
		const ok = response.status !== null && response.status >= 200 && response.status < 300;
		if (gone) {
			await this.#store.unregister(device.deviceId);
			const address = device.fcmToken === undefined ? "subscription" : "FCM token";
			this.#log(`notifications: dropping ${device.deviceId}; its ${address} is gone (${response.status})`);
		} else {
			await this.#store.setLastDelivery(device.deviceId, {
				at,
				ok,
				status: response.status,
				message: ok ? null : response.message,
			});
			if (!ok) {
				this.#log(
					`notifications: ${event.kind} to ${device.deviceId} failed (${response.status ?? "no answer"}): ${response.message ?? "no message"}`,
				);
			}
		}
		return { deviceId: device.deviceId, ok, status: response.status, message: response.message };
	}
}

/** A push `Topic` header: base64url of the tag, cut to the 32 characters RFC 8030 allows. */
export function pushTopic(tag: string): string {
	return Buffer.from(tag, "utf8").toString("base64url").slice(0, 32);
}

/** What a device that registers without preferences starts with. */
export function defaultNotificationPreferences(): NotificationPreferences {
	return { kinds: [...DEFAULT_NOTIFICATION_KINDS], mutedProjects: [], quietHours: null };
}
