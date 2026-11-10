/**
 * How notifications read in the app: each kind's words, what one backend's registration says, what the push service
 * answered, and which project a route is looking at. Pure, so the page, the chat header and the tests agree.
 */
import {
	NOTIFICATION_KINDS,
	isNotificationFailure,
	type DeviceNotificationSettings,
	type QuietHours,
} from "@aiki/client";
import {
	NOTIFICATION_FAILURE_KINDS,
	DEFAULT_NOTIFICATION_KINDS,
	type NotificationDevice,
	type NotificationKind,
} from "@aiki/protocol";
import { currentProject } from "./projects.ts";

/** The Notifications page, linked from the sidebar's footer beside Backends. */
export const NOTIFICATIONS_HREF = "/settings/notifications";

export type NotificationKindInfo = {
	kind: NotificationKind;
	label: string;
	/** One line for the toggle's description. */
	description: string;
	/** Whether this kind reports something going wrong; quiet hours may still let those through. */
	failure: boolean;
};

/** The kinds in the protocol's order, each with the words this app uses for it. */
export const NOTIFICATION_KIND_INFO: readonly NotificationKindInfo[] = NOTIFICATION_KINDS.map((kind) => {
	switch (kind) {
		case "reply":
			return { kind, label: "Coordinator replies", description: "An answer finished while you were away.", failure: false };
		case "worker_report":
			return { kind, label: "Worker reports", description: "A worker finished its task and reported. Off by default: Work finished covers a long run.", failure: false };
		case "worker_failed":
			return { kind, label: "Worker failures", description: "A worker failed or stopped without reporting.", failure: true };
		case "schedule_done":
			return { kind, label: "Scheduled runs", description: "A scheduled task started or finished.", failure: false };
		case "schedule_problem":
			return {
				kind,
				label: "Schedule problems",
				description: "A scheduled run failed or was skipped.",
				failure: true,
			};
		case "deploy_problem":
			return {
				kind,
				label: "Deploy problems",
				description: "A deploy failed or rolled back.",
				failure: true,
			};
		case "login_prompt":
			return {
				kind,
				label: "Login prompts",
				description: "A provider login waits for a code or a decision.",
				failure: false,
			};
		case "compaction_failed":
			return {
				kind,
				label: "Compaction failures",
				description: "Summarizing a long conversation failed.",
				failure: true,
			};
		case "maintenance_failed":
			return {
				kind,
				label: "Maintenance failures",
				description: "A nightly memory maintenance run failed.",
				failure: true,
			};
		case "board_question":
			return {
				kind,
				label: "Board questions",
				description: "Main or a background thread asked you something on the board.",
				failure: false,
			};
		case "thread_finished":
			return {
				kind,
				label: "Background work finished",
				description: "A background thread finished; opens its card in main.",
				failure: false,
			};
		case "thread_failed":
			return {
				kind,
				label: "Background work failed",
				description: "A background thread failed; opens its card in main.",
				failure: true,
			};
		case "work_finished":
			return {
				kind,
				label: "Work finished",
				description: "One notification when a project goes quiet.",
				failure: false,
			};
		case "disk_low":
			return {
				kind,
				label: "Low disk space",
				description: "A backend's disk is running low.",
				failure: true,
			};
		case "task_review":
			return {
				kind,
				label: "Tasks ready for review",
				description: "A task is ready for you to look at; opens the task.",
				failure: false,
			};
	}
});

export function kindInfo(kind: NotificationKind): NotificationKindInfo | undefined {
	return NOTIFICATION_KIND_INFO.find((info) => info.kind === kind);
}

/** The kinds a device starts with, which "Reset" restores. */
export const DEFAULT_KIND_INFO = NOTIFICATION_KIND_INFO.filter((info) =>
	(DEFAULT_NOTIFICATION_KINDS as readonly string[]).includes(info.kind),
);

/** Whether the protocol counts this kind as a failure. */
export function kindIsFailure(kind: NotificationKind): boolean {
	return (NOTIFICATION_FAILURE_KINDS as readonly string[]).includes(kind) && isNotificationFailure(kind);
}

/** The browser's push permission, or `unsupported` where it has no Push API at all. */
export type PushPermission = NotificationPermission | "unsupported";

/** Explain the push-service refusal without assuming which Chromium browser is in use. */
export function pushSubscriptionError(error: unknown): { message: string; detail?: string } {
	const message = error instanceof Error ? error.message : String(error);
	if (error instanceof Error && error.name === "AbortError" && message === "Registration failed - push service error") {
		return {
			message: "The browser's push service refused. In Brave, turn on Use Google services for push messaging under Settings → Privacy and security, restart the browser, then try again.",
			detail: message,
		};
	}
	return { message };
}

/** Something the app knows about one backend's registration, without the runes. */
export type BackendNotificationFacts = {
	/** Whether the backend's release advertises the `notifications` feature. */
	supportsFeature: boolean;
	permission: PushPermission;
	/** This browser holds a push subscription. */
	subscribed: boolean;
	/** The registration this backend answered with, or null when it has none. */
	device: NotificationDevice | null;
	/** Whether the backend signs with a different key than the subscription was made with. */
	keyMismatch: boolean;
	/** The last failure, which explains a status the other facts cannot. */
	error?: string;
};

export type BackendNotificationStatus =
	| "checking"
	| "no-feature"
	| "unsupported"
	| "denied"
	| "key-mismatch"
	| "off"
	| "not-registered"
	| "registered"
	| "failed";

export type BackendNotificationView = {
	status: BackendNotificationStatus;
	label: string;
	/** What to show under the label: the reason, the subscription, the last delivery. */
	detail?: string;
	tone: "ok" | "warn" | "err" | "muted";
};

/** What one backend's card says, from the facts the page has. */
export function backendNotificationView(facts: BackendNotificationFacts): BackendNotificationView {
	if (!facts.supportsFeature) {
		return {
			status: "no-feature",
			label: "No notifications",
			detail: "This backend runs a release without notifications.",
			tone: "muted",
		};
	}
	if (facts.permission === "unsupported") {
		return {
			status: "unsupported",
			label: "Unsupported browser",
			detail: "This browser has no Push API; on iOS, add the app to the Home Screen first.",
			tone: "muted",
		};
	}
	if (facts.permission === "denied") {
		return {
			status: "denied",
			label: "Blocked",
			detail: "The browser blocks notifications for this site. Allow them in its site settings, then enable again.",
			tone: "err",
		};
	}
	if (facts.keyMismatch) {
		return {
			status: "key-mismatch",
			label: "Key mismatch",
			detail: "This backend signs with a different key than the others. Every backend must use the same pair.",
			tone: "err",
		};
	}
	if (facts.error !== undefined) {
		return { status: "failed", label: "Failed", detail: facts.error, tone: "err" };
	}
	if (!facts.subscribed) {
		return {
			status: "off",
			label: "Off",
			detail: "Notifications are off on this device. Enable them to be told about this backend.",
			tone: "muted",
		};
	}
	if (facts.device === null) {
		return {
			status: "not-registered",
			label: "Not registered",
			detail: "This device is not registered here yet; it registers as soon as this backend is reachable.",
			tone: "warn",
		};
	}
	return {
		status: "registered",
		label: "Registered",
		detail: lastDeliveryText(facts.device),
		tone: "ok",
	};
}

/** The browser's own answer for the last push: when, and whether the push service took it. */
export function lastDeliveryText(device: Pick<NotificationDevice, "lastDelivery">): string {
	const delivery = device.lastDelivery;
	if (delivery === null) return "Registered; nothing pushed yet.";
	const when = new Date(delivery.at);
	const at = Number.isNaN(when.getTime()) ? delivery.at : when.toLocaleString();
	if (delivery.ok) {
		return delivery.status === null
			? `Last push accepted ${at}.`
			: `Last push accepted ${at} (${delivery.status}).`;
	}
	const answer = delivery.status === null ? "" : ` (${delivery.status})`;
	const reason = delivery.message === null ? "" : `: ${delivery.message}`;
	return `Last push failed ${at}${answer}${reason}.`;
}

/** The push service's answer to "Send test notification", in words. */
export function testNotificationText(result: { ok: boolean; status: number | null; message: string | null }): string {
	const status = result.status === null ? "" : ` (${result.status}${result.message === null ? "" : ` ${result.message}`})`;
	if (result.ok) return `The push service accepted it${status}.`;
	if (result.status === 404 || result.status === 410) {
		return `The push service no longer knows this subscription${status}. Disable and enable notifications to subscribe again.`;
	}
	return `The push service refused it${status}.`;
}

/** Whether every backend that signs pushes agrees on the key; two lifetimes would strand one browser's subscription. */
export function publicKeyMismatch(keys: readonly string[]): boolean {
	const distinct = new Set(keys.map((key) => key.trim().replace(/=+$/, "")).filter((key) => key.length > 0));
	return distinct.size > 1;
}

/** The project a route shows, for presence: a worker's transcript and the settings page are that project too. */
export function presenceProjectId(pathname: string): string | null {
	return currentProject(pathname)?.projectId ?? null;
}

/** Presence for a route and a page visibility. */
export function presenceFor(pathname: string, visible: boolean): { projectId: string | null; visible: boolean } {
	return { visible, projectId: presenceProjectId(pathname) };
}

/** A quiet-hours draft from a device's settings: the stored window, or the default a toggle starts from. */
export function quietHoursDraft(settings: Pick<DeviceNotificationSettings, "quietHours">, timezone: string): QuietHours {
	return (
		settings.quietHours ?? {
			start: "22:00",
			end: "07:00",
			timezone,
			allowFailures: true,
		}
	);
}

/** Whether a quiet-hours draft is usable: both ends are times, and they differ. */
export function quietHoursProblem(quietHours: QuietHours): string | undefined {
	const time = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
	if (!time.test(quietHours.start) || !time.test(quietHours.end)) return "Use a time like 22:00.";
	if (quietHours.start === quietHours.end) return "Start and end are the same, so nothing would be quiet.";
	if (quietHours.timezone.trim().length === 0) return "This device has no timezone.";
	return undefined;
}

/** "On" or "Off" for a kind toggle, with the defaults spelled out. */
export function kindsSummary(settings: Pick<DeviceNotificationSettings, "kinds">): string {
	if (settings.kinds.length === 0) return "No events";
	if (settings.kinds.length === NOTIFICATION_KINDS.length) return "Every event";
	return `${settings.kinds.length} of ${NOTIFICATION_KINDS.length} events`;
}
