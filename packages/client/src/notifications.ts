/**
 * Helpers on top of the protocol's notification types: where a payload's notification opens, what this browser calls
 * itself, the preferences a device keeps, and quiet hours read in the device's timezone. Everything here is pure (or
 * takes the storage it writes to), so the app, its tests and the service worker share one decision instead of three.
 */
import {
	DEFAULT_NOTIFICATION_KINDS,
	MAIN_THREAD_ID,
	NOTIFICATION_FAILURE_KINDS,
	type NotificationKind,
	type NotificationPayload,
	type NotificationPreferences,
} from "@mihai-harness/protocol";

/**
 * Every kind the protocol declares, in its order. The protocol exports the type and the two lists but not the schema, so
 * this is the one copy the app keeps; it is typed against `NotificationKind`, and a kind added to the protocol needs a
 * row here (and a label in the app) to be selectable at all.
 */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
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
	"thread_finished",
	"thread_failed",
	"work_finished",
	"disk_low",
	"task_review",
];

/**
 * What a new device started with, by defaults version (the index). A device that still has exactly one version's kinds
 * kept the defaults and follows the next version's; one that changed them keeps its own choice.
 */
const DEFAULT_KINDS_BY_VERSION: readonly (readonly NotificationKind[])[] = [
	["reply", "worker_report", "worker_failed", "schedule_problem", "deploy_problem", "login_prompt"],
	["reply", "worker_report", "worker_failed", "schedule_problem", "deploy_problem", "login_prompt", "board_question"],
	[
		"reply",
		"worker_report",
		"worker_failed",
		"schedule_problem",
		"deploy_problem",
		"login_prompt",
		"board_question",
		"thread_finished",
		"thread_failed",
	],
	[
		"reply",
		"worker_failed",
		"schedule_problem",
		"deploy_problem",
		"login_prompt",
		"board_question",
		"thread_finished",
		"thread_failed",
		"work_finished",
		"disk_low",
	],
	[...DEFAULT_NOTIFICATION_KINDS],
];

/** The defaults version this build writes; settings stored without one are version 0. */
export const NOTIFICATION_DEFAULTS_VERSION = DEFAULT_KINDS_BY_VERSION.length - 1;

/**
 * The kinds a device has after the defaults moved on: each version it missed replaces its kinds when they were exactly
 * that version's defaults. A device that customised its kinds is left alone.
 */
export function migrateDefaultKinds(kinds: readonly NotificationKind[], fromVersion: number): NotificationKind[] {
	let current = [...kinds];
	for (let version = Math.max(0, fromVersion); version < NOTIFICATION_DEFAULTS_VERSION; version += 1) {
		const before = DEFAULT_KINDS_BY_VERSION[version] ?? [];
		const after = DEFAULT_KINDS_BY_VERSION[version + 1] ?? [];
		const keptDefaults = current.length === before.length && before.every((kind) => current.includes(kind));
		if (keptDefaults) current = NOTIFICATION_KINDS.filter((kind) => after.includes(kind));
	}
	return current;
}

/** A kind that reports something going wrong. Quiet hours may still let these through. */
export function isNotificationFailure(kind: NotificationKind | "test"): boolean {
	return (NOTIFICATION_FAILURE_KINDS as readonly string[]).includes(kind);
}

/**
 * Where the app's routes keep a payload: `/b/<backend>/projects/<project>`, then the task's sheet over main's chat
 * (`?task=`), the worker, the background thread's card in main, or the schedule.
 */
export type NotificationTarget = Pick<NotificationPayload, "backendKey" | "projectId" | "workerId" | "scheduleId"> &
	Partial<Pick<NotificationPayload, "threadId" | "taskId">>;

/** The link a notification opens. A payload without a project (a deploy problem) opens the app's home page. */
export function notificationUrl(target: NotificationTarget): string {
	const projectId = target.projectId;
	if (projectId === null) return "/";
	const project = `/b/${encodeURIComponent(target.backendKey)}/projects/${encodeURIComponent(projectId)}`;
	const taskId = target.taskId ?? null;
	if (taskId !== null) return `${project}?task=${encodeURIComponent(taskId)}`;
	const threadId = target.threadId ?? null;
	const background = threadId !== null && threadId !== MAIN_THREAD_ID;
	if (target.workerId !== null) {
		const worker = `workers/${encodeURIComponent(target.workerId)}`;
		return background ? `${project}/threads/${encodeURIComponent(threadId)}/${worker}` : `${project}/${worker}`;
	}
	// A thread's news opens main, where its card is: the user talks to main, not to the thread.
	if (background) return `${project}#${threadAnchor(threadId)}`;
	if (target.scheduleId !== null) return `${project}/settings#${scheduleAnchor(target.scheduleId)}`;
	return project;
}

/** The hash that makes main's transcript scroll to a background thread's newest card and highlight it. */
export function threadAnchor(threadId: string): string {
	return `thread-${threadId}`;
}

/** The thread a hash names, or undefined when the hash is something else. */
export function threadFromAnchor(hash: string): string | undefined {
	const anchor = hash.startsWith("#") ? hash.slice(1) : hash;
	if (!anchor.startsWith("thread-")) return undefined;
	let threadId: string;
	try {
		threadId = decodeURIComponent(anchor.slice("thread-".length));
	} catch {
		return undefined;
	}
	return threadId.length === 0 ? undefined : threadId;
}

/** The id a schedule's card carries in project settings, so a notification can land on it. */
export function scheduleAnchor(scheduleId: string): string {
	return `schedule-${scheduleId}`;
}

/**
 * A push message as the payload the service worker draws, or null when the push carries something else. Push data is
 * remote input, so every field the notification uses is checked; a payload without a title is not shown.
 */
export function parseNotificationPayload(raw: string | null | undefined): NotificationPayload | null {
	if (raw === null || raw === undefined) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const record = parsed as Record<string, unknown>;
	const kind = record.kind;
	const knownKind =
		kind === "test" || (typeof kind === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(kind));
	if (!knownKind) return null;
	if (typeof record.title !== "string" || record.title.length === 0) return null;
	if (typeof record.body !== "string") return null;
	if (typeof record.backendKey !== "string" || record.backendKey.length === 0) return null;
	if (typeof record.tag !== "string" || record.tag.length === 0) return null;
	const projectId = record.projectId;
	const workerId = record.workerId;
	const scheduleId = record.scheduleId;
	if (!nullableString(projectId) || !nullableString(workerId) || !nullableString(scheduleId)) return null;
	const threadId = record.threadId;
	if (threadId !== undefined && !nullableString(threadId)) return null;
	const taskId = record.taskId;
	if (taskId !== undefined && !nullableString(taskId)) return null;
	return {
		kind: kind as NotificationPayload["kind"],
		title: record.title,
		body: record.body,
		backendKey: record.backendKey,
		projectId,
		workerId,
		scheduleId,
		...(threadId === undefined ? {} : { threadId }),
		...(taskId === undefined ? {} : { taskId }),
		tag: record.tag,
		at: typeof record.at === "string" ? record.at : new Date().toISOString(),
	};
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

/** Whether a notification should replace the last one with the same tag and buzz again. */
export function notificationRenotify(kind: NotificationKind | "test"): boolean {
	return isNotificationFailure(kind);
}

/**
 * A base64url VAPID public key as the bytes `pushManager.subscribe` wants. Throws on a key that is not base64url, so a
 * backend that answers nonsense is reported instead of subscribed with garbage.
 */
export function applicationServerKey(publicKey: string): Uint8Array<ArrayBuffer> {
	const trimmed = publicKey.trim();
	if (!/^[A-Za-z0-9_-]+={0,2}$/.test(trimmed)) throw new Error("The backend's notification key is not base64url.");
	const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	let binary: string;
	try {
		binary = atob(padded);
	} catch {
		throw new Error("The backend's notification key is not valid base64.");
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	if (bytes.length !== 65 || bytes[0] !== 4) {
		throw new Error("The backend's notification key is not a P-256 public key.");
	}
	return bytes;
}

/** Two base64url keys for the same point, without padding differences. */
export function samePublicKey(left: string, right: string): boolean {
	return left.trim().replace(/=+$/, "") === right.trim().replace(/=+$/, "");
}

/**
 * The subscription's own key (`getKey("p256dh")` is the endpoint's key, not VAPID's), so the comparison above uses the
 * key the subscription was made with: `PushSubscription.options.applicationServerKey`.
 */
export function subscriptionServerKey(subscription: Pick<PushSubscription, "options">): string | undefined {
	const key = subscription.options?.applicationServerKey;
	if (key === null || key === undefined) return undefined;
	const bytes =
		key instanceof ArrayBuffer
			? new Uint8Array(key)
			: new Uint8Array((key as ArrayBufferView).buffer, (key as ArrayBufferView).byteOffset, (key as ArrayBufferView).byteLength);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A name for this browser in a notification's device list: "Pixel 8 · Chrome", "Mac · Safari". */
export function deviceLabelFromUserAgent(userAgent: string): string {
	return `${deviceNameFromUserAgent(userAgent)} · ${browserNameFromUserAgent(userAgent)}`;
}

export function deviceNameFromUserAgent(userAgent: string): string {
	if (/iPhone/.test(userAgent)) return "iPhone";
	if (/iPad/.test(userAgent)) return "iPad";
	if (/iPod/.test(userAgent)) return "iPod";
	const android = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build[/;]|\))/i.exec(userAgent);
	if (android !== null) {
		const model = (android[1] ?? "").replace(/\s*wv$/, "").trim();
		// Chrome's reduced user agent sends "K" instead of the model.
		if (model.length > 0 && model !== "K" && !/^Android$/.test(model)) return model;
		return "Android";
	}
	if (/Windows/.test(userAgent)) return "Windows";
	if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
	if (/CrOS/.test(userAgent)) return "Chromebook";
	if (/Linux/.test(userAgent)) return "Linux";
	return "Device";
}

export function browserNameFromUserAgent(userAgent: string): string {
	if (/Edg[A-Z]?\//.test(userAgent)) return "Edge";
	if (/OPR\/|Opera/.test(userAgent)) return "Opera";
	if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
	if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
	if (/CriOS\/|Chrome\//.test(userAgent)) return "Chrome";
	if (/Safari\//.test(userAgent)) return "Safari";
	return "Browser";
}

/** This device's own name, from the browser's user agent. */
export function deviceLabel(): string {
	return deviceLabelFromUserAgent(typeof navigator === "undefined" ? "" : navigator.userAgent);
}

/** Where a browser keeps the device identity it made up; it must survive reloads, not reinstalls. */
export const NOTIFICATION_DEVICE_STORAGE_KEY = "mihai-harness.notification-device.v1";

/** Where this browser keeps what it wants to be told about, per device. */
export const NOTIFICATION_SETTINGS_STORAGE_KEY = "mihai-harness.notifications.v1"; // gitleaks:allow -- localStorage namespace, not a credential

/** A time of day a device may be quiet at, in its own timezone. Same shape as the protocol's non-null quiet hours. */
export type QuietHours = {
	start: string;
	end: string;
	timezone: string;
	allowFailures: boolean;
};

/** What this browser (one device) wants, kept in localStorage and pushed to every backend it registers with. */
export type DeviceNotificationSettings = {
	deviceId: string;
	/** The kinds this device wants, from any backend. */
	kinds: NotificationKind[];
	/** Which defaults the kinds were last brought up to; see `migrateDefaultKinds`. */
	defaultsVersion: number;
	quietHours: QuietHours | null;
	/** Muted project IDs, by backend key: a project ID only means something to the backend that made it. */
	mutedProjects: Record<string, string[]>;
};

/** A device ID nobody else uses. `crypto.randomUUID` is available in browsers and Bun; the fallback covers old ones. */
export function newDeviceId(random: () => number = Math.random): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid !== undefined) return uuid;
	let tail = "";
	for (let index = 0; index < 24; index += 1) tail += Math.floor(random() * 16).toString(16);
	return `dev-${tail}`;
}

/** The browser's timezone, e.g. "Europe/Bucharest", or "UTC" where `Intl` gives none. */
export function deviceTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

export function defaultDeviceSettings(deviceId: string, timezone = deviceTimezone()): DeviceNotificationSettings {
	return {
		deviceId,
		kinds: [...DEFAULT_NOTIFICATION_KINDS],
		defaultsVersion: NOTIFICATION_DEFAULTS_VERSION,
		quietHours: null,
		mutedProjects: {},
	};
}

function isTimeOfDay(value: unknown): value is string {
	return typeof value === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
	return items;
}

/** Read stored settings, filling in what is missing. Never throws on a damaged store; only the valid parts survive. */
export function parseDeviceSettings(raw: string | null, deviceId: string, timezone = deviceTimezone()): DeviceNotificationSettings {
	const fallback = defaultDeviceSettings(deviceId, timezone);
	if (raw === null) return fallback;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return fallback;
	}
	if (typeof parsed !== "object" || parsed === null) return fallback;
	const record = parsed as Record<string, unknown>;
	const storedKinds = stringArray(record.kinds);
	const kinds =
		storedKinds === undefined ? undefined : NOTIFICATION_KINDS.filter((kind) => storedKinds.includes(kind));
	const quiet = record.quietHours;
	let quietHours: QuietHours | null = null;
	if (typeof quiet === "object" && quiet !== null) {
		const value = quiet as Record<string, unknown>;
		if (isTimeOfDay(value.start) && isTimeOfDay(value.end) && typeof value.timezone === "string" && value.timezone.length > 0) {
			quietHours = {
				start: value.start,
				end: value.end,
				timezone: value.timezone,
				allowFailures: value.allowFailures === true,
			};
		}
	}
	const mutedProjects: Record<string, string[]> = {};
	const muted = record.mutedProjects;
	if (typeof muted === "object" && muted !== null && !Array.isArray(muted)) {
		for (const [backendKey, projects] of Object.entries(muted as Record<string, unknown>)) {
			const list = stringArray(projects);
			if (backendKey.length > 0 && list !== undefined && list.length > 0) mutedProjects[backendKey] = list;
		}
	}
	const storedDeviceId = typeof record.deviceId === "string" && record.deviceId.length > 0 ? record.deviceId : deviceId;
	const storedVersion =
		typeof record.defaultsVersion === "number" && Number.isInteger(record.defaultsVersion) && record.defaultsVersion >= 0
			? record.defaultsVersion
			: 0;
	return {
		deviceId: storedDeviceId,
		kinds:
			kinds === undefined
				? fallback.kinds
				: storedVersion >= NOTIFICATION_DEFAULTS_VERSION
					? kinds
					: migrateDefaultKinds(kinds, storedVersion),
		defaultsVersion: NOTIFICATION_DEFAULTS_VERSION,
		quietHours,
		mutedProjects,
	};
}

type ReadStorage = Pick<Storage, "getItem"> | undefined;
type WriteStorage = Pick<Storage, "setItem"> | undefined;
/** localStorage, or whatever a test passes: read and written together, so the two keys stay in one place. */
type DeviceStorage = Pick<Storage, "getItem" | "setItem"> | undefined;

/** This browser's notification settings, making up a device ID the first time. */
export function loadDeviceSettings(storage: DeviceStorage = browserStorage(), timezone = deviceTimezone()): DeviceNotificationSettings {
	const storedDeviceId = deviceIdFromStorage(storage);
	const settings = parseDeviceSettings(
		readStorage(storage, NOTIFICATION_SETTINGS_STORAGE_KEY),
		storedDeviceId.length > 0 ? storedDeviceId : newDeviceId(),
		timezone,
	);
	if (storedDeviceId !== settings.deviceId) {
		// The first visit writes the device ID down, so the next one is the same device.
		writeStorage(storage, NOTIFICATION_DEVICE_STORAGE_KEY, settings.deviceId);
	}
	const stored = readStorage(storage, NOTIFICATION_SETTINGS_STORAGE_KEY);
	if (stored !== null && storedDefaultsVersion(stored) < NOTIFICATION_DEFAULTS_VERSION) {
		// Written once, so the next load is already current; the app registers the new kinds on its next connect.
		writeStorage(storage, NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
	}
	return settings;
}

function storedDefaultsVersion(raw: string): number {
	try {
		const version = (JSON.parse(raw) as { defaultsVersion?: unknown } | null)?.defaultsVersion;
		return typeof version === "number" && Number.isInteger(version) && version >= 0 ? version : 0;
	} catch {
		return 0;
	}
}

export function saveDeviceSettings(
	settings: DeviceNotificationSettings,
	storage: DeviceStorage = browserStorage(),
): void {
	writeStorage(storage, NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
	writeStorage(storage, NOTIFICATION_DEVICE_STORAGE_KEY, settings.deviceId);
}

/** The device ID this browser already made up, or an empty string. */
export function deviceIdFromStorage(storage: ReadStorage = browserStorage()): string {
	return readStorage(storage, NOTIFICATION_DEVICE_STORAGE_KEY)?.trim() ?? "";
}

/** The preferences this device registers with one backend: the shared kinds and quiet hours, that backend's mutes. */
export function preferencesForBackend(
	settings: DeviceNotificationSettings,
	backendKey: string,
): NotificationPreferences {
	return {
		kinds: [...settings.kinds],
		mutedProjects: [...(settings.mutedProjects[backendKey] ?? [])],
		quietHours: settings.quietHours === null ? null : { ...settings.quietHours },
	};
}

/** Turn one kind on or off, keeping the protocol's order. */
export function withKind(kinds: readonly NotificationKind[], kind: NotificationKind, on: boolean): NotificationKind[] {
	const next = new Set(kinds);
	if (on) next.add(kind);
	else next.delete(kind);
	return NOTIFICATION_KINDS.filter((entry) => next.has(entry));
}

/** Whether this device currently wants a kind, failures included unless the user turned them off. */
export function wantsKind(kinds: readonly NotificationKind[], kind: NotificationKind): boolean {
	return kinds.includes(kind);
}

/** Mute or unmute one project on the backend that owns it. */
export function withMutedProject(
	settings: DeviceNotificationSettings,
	backendKey: string,
	projectId: string,
	muted: boolean,
): DeviceNotificationSettings {
	const current = settings.mutedProjects[backendKey] ?? [];
	const next = muted ? [...new Set([...current, projectId])] : current.filter((id) => id !== projectId);
	const mutedProjects = { ...settings.mutedProjects };
	if (next.length === 0) delete mutedProjects[backendKey];
	else mutedProjects[backendKey] = next;
	return { ...settings, mutedProjects };
}

export function isProjectMuted(
	settings: DeviceNotificationSettings,
	backendKey: string,
	projectId: string,
): boolean {
	return (settings.mutedProjects[backendKey] ?? []).includes(projectId);
}

/** Muted projects as pairs, so a page can list them without walking the record. */
export function mutedProjectEntries(settings: DeviceNotificationSettings): { backendKey: string; projectId: string }[] {
	return Object.entries(settings.mutedProjects).flatMap(([backendKey, projectIds]) =>
		projectIds.map((projectId) => ({ backendKey, projectId })),
	);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
	const cached = timeFormatters.get(timezone);
	if (cached !== undefined) return cached;
	const formatter = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	timeFormatters.set(timezone, formatter);
	return formatter;
}

/** "HH:MM" as an `Intl` clock in `timezone` reads `at`; the device's own clock when the zone is unknown. */
export function timeOfDayIn(timezone: string, at: Date): string {
	let formatter: Intl.DateTimeFormat;
	try {
		formatter = formatterFor(timezone);
	} catch {
		formatter = formatterFor(deviceTimezone());
	}
	const parts = formatter.formatToParts(at);
	const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
	const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
	// Some engines still answer "24" at midnight.
	return `${hour === "24" ? "00" : hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/**
 * Whether quiet hours cover `at` right now. A window whose end is before its start crosses midnight; equal ends mean no
 * quiet hours at all (rather than every hour of the day). Failures pass through when `allowFailures` is on.
 */
export function quietHoursActive(
	quietHours: QuietHours | null,
	at: Date,
	kind?: NotificationKind | "test",
): boolean {
	if (quietHours === null || quietHours.start === quietHours.end) return false;
	if (kind !== undefined && quietHours.allowFailures && isNotificationFailure(kind)) return false;
	const now = timeOfDayIn(quietHours.timezone, at);
	if (quietHours.start < quietHours.end) return now >= quietHours.start && now < quietHours.end;
	return now >= quietHours.start || now < quietHours.end;
}

/** "22:00–07:00 (Europe/Bucharest)", for a status line. */
export function quietHoursSummary(quietHours: QuietHours): string {
	return `${quietHours.start}–${quietHours.end} (${quietHours.timezone})`;
}

function readStorage(storage: ReadStorage, key: string): string | null {
	if (storage === undefined) return null;
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(storage: WriteStorage, key: string, value: string): void {
	if (storage === undefined) return;
	try {
		storage.setItem(key, value);
	} catch {
		// Storage can be full or disabled; the app keeps working for this session.
	}
}

function browserStorage(): Storage | undefined {
	// Not `window`: the app's service worker imports this module and has no `window` (but no storage of its own either).
	try {
		return (globalThis as { localStorage?: Storage }).localStorage;
	} catch {
		return undefined;
	}
}
