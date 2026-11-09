/**
 * Notifications: Web Push to the user's devices.
 *
 * Every backend signs with the same VAPID key pair, because a browser holds one push subscription. A device (one browser
 * profile, identified by a client-chosen `deviceId`) subscribes once and registers that subscription with each backend it
 * is connected to, with its preferences. Each backend then pushes its own events to the device directly. Payloads are
 * encrypted end to end (RFC 8291), so the push service cannot read them.
 *
 * An Android app registers a Firebase Cloud Messaging token instead (`notifications.registerFcm`, feature `fcm-push`): the
 * backend sends the same payload as FCM data through the HTTP v1 API, with a service-account key of the app's Firebase
 * project. Kinds, quiet hours, mutes, presence and dedupe are the same for both transports.
 *
 * An open app holds its notifications: each connection reports whether its page is visible (`notifications.presence`),
 * and while any connection on a backend is visible, that backend holds an event for 15 s before pushing it. Interaction
 * on any device (`notifications.interaction`, feature `notification-hold`) drops every held event of that backend: the
 * user is looking at the app, so a system notification would only repeat what is on screen. No visible connection, no
 * hold: the push goes out at once.
 */
import { type Static, Type } from "typebox";
import { ProjectIdSchema, RequestIdSchema } from "./common.ts";

export const NotificationKindSchema = Type.Union(
	[
		Type.Literal("reply"),
		Type.Literal("worker_report"),
		Type.Literal("worker_failed"),
		Type.Literal("schedule_done"),
		Type.Literal("schedule_problem"),
		Type.Literal("deploy_problem"),
		Type.Literal("login_prompt"),
		Type.Literal("compaction_failed"),
		Type.Literal("maintenance_failed"),
		Type.Literal("board_question"),
		Type.Literal("thread_finished"),
		Type.Literal("thread_failed"),
		Type.Literal("work_finished"),
		Type.Literal("disk_low"),
		Type.Literal("task_review"),
	],
	{
		description:
			"reply: the coordinator finished an answer. worker_report / worker_failed: a worker reported or failed. schedule_done: a scheduled run finished; schedule_problem: one failed or was skipped. deploy_problem: a deploy failed or rolled back. login_prompt: a provider login waits for an answer. compaction_failed, maintenance_failed: background work failed. board_question: a thread asked the user a question on the board. thread_finished / thread_failed: a background thread finished or failed. work_finished: a project went quiet (nothing running) after a stretch of work; replaces per-reply and per-report noise during long runs. disk_low: a backend\'s disk is running low.",
	},
);
export type NotificationKind = Static<typeof NotificationKindSchema>;

/** The kinds that count as failures, which quiet hours may still let through. */
export const NOTIFICATION_FAILURE_KINDS: readonly NotificationKind[] = [
	"worker_failed",
	"schedule_problem",
	"deploy_problem",
	"compaction_failed",
	"maintenance_failed",
	"thread_failed",
	"disk_low",
];

/** What a new device starts with. */
export const DEFAULT_NOTIFICATION_KINDS: readonly NotificationKind[] = [
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
	"task_review",
];

const TimeOfDay = Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: '"HH:MM", 24-hour.' });

export const NotificationPreferencesSchema = Type.Object({
	kinds: Type.Array(NotificationKindSchema, { description: "The kinds this device wants." }),
	mutedProjects: Type.Array(ProjectIdSchema, { description: "Projects of this backend the device hears nothing from." }),
	quietHours: Type.Union(
		[
			Type.Object({
				start: TimeOfDay,
				end: TimeOfDay,
				timezone: Type.String({ minLength: 1, description: "The device's IANA timezone." }),
				allowFailures: Type.Boolean({ description: "Failure kinds still come through during quiet hours." }),
			}),
			Type.Null(),
		],
		{ description: "From start to end (crossing midnight when end < start), nothing is pushed." },
	),
});
export type NotificationPreferences = Static<typeof NotificationPreferencesSchema>;

/** A browser `PushSubscription` as `toJSON()` gives it. */
export const PushSubscriptionSchema = Type.Object({
	endpoint: Type.String({ minLength: 1 }),
	expirationTime: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	keys: Type.Object({ p256dh: Type.String({ minLength: 1 }), auth: Type.String({ minLength: 1 }) }),
});
export type PushSubscription = Static<typeof PushSubscriptionSchema>;

/** How a device is reached: a browser's Web Push subscription or an Android app's FCM token. */
export const NotificationTransportSchema = Type.Union([Type.Literal("web-push"), Type.Literal("fcm")]);
export type NotificationTransport = Static<typeof NotificationTransportSchema>;

export const NotificationDeviceSchema = Type.Object({
	deviceId: Type.String({ minLength: 1 }),
	label: Type.String({ description: 'For humans, e.g. "Pixel 8 · Chrome".' }),
	backendKey: Type.String({
		minLength: 1,
		description: "What the device calls this backend; echoed in payloads so the device can build links.",
	}),
	preferences: NotificationPreferencesSchema,
	createdAt: Type.String(),
	lastDelivery: Type.Union(
		[
			Type.Object({
				at: Type.String(),
				ok: Type.Boolean(),
				status: Type.Union([Type.Integer(), Type.Null()], { description: "The push service's HTTP status." }),
				message: Type.Union([Type.String(), Type.Null()]),
			}),
			Type.Null(),
		],
		{ description: "The last push attempt to this device." },
	),
	transport: Type.Optional(NotificationTransportSchema),
});
export type NotificationDevice = Static<typeof NotificationDeviceSchema>;

/** What the service worker receives, as JSON, in the push message. */
export const NotificationPayloadSchema = Type.Object({
	kind: Type.Union([NotificationKindSchema, Type.Literal("test")]),
	title: Type.String(),
	body: Type.String(),
	backendKey: Type.String(),
	projectId: Type.Union([ProjectIdSchema, Type.Null()]),
	workerId: Type.Union([Type.String(), Type.Null()]),
	scheduleId: Type.Union([Type.String(), Type.Null()]),
	threadId: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "The background thread it is about; the app opens main and highlights its card." })),
	artifactId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	taskId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], { description: "The board task it is about; the app opens that task." }),
	),
	tag: Type.String({ description: "Notifications with the same tag replace each other." }),
	at: Type.String(),
});
export type NotificationPayload = Static<typeof NotificationPayloadSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

/** The VAPID public key (base64url) this backend signs with; every backend should answer the same key. */
export const NotificationsConfigRequestSchema = Type.Object({
	type: Type.Literal("notifications.config"),
	id: RequestIdSchema,
});
export type NotificationsConfigRequest = Static<typeof NotificationsConfigRequestSchema>;

/** Register or update this device: its subscription, what it calls this backend, and its preferences. */
export const NotificationsRegisterRequestSchema = Type.Object({
	type: Type.Literal("notifications.register"),
	id: RequestIdSchema,
	deviceId: Type.String({ minLength: 1 }),
	label: Type.String(),
	backendKey: Type.String({ minLength: 1 }),
	subscription: PushSubscriptionSchema,
	preferences: NotificationPreferencesSchema,
});
export type NotificationsRegisterRequest = Static<typeof NotificationsRegisterRequestSchema>;

/**
 * Register or update this device as an Android app reached through Firebase Cloud Messaging (feature `fcm-push`). Same
 * as `notifications.register`, with the app's FCM registration token in place of a Web Push subscription; the app sends
 * it again whenever Firebase rotates the token.
 */
export const NotificationsRegisterFcmRequestSchema = Type.Object({
	type: Type.Literal("notifications.registerFcm"),
	id: RequestIdSchema,
	deviceId: Type.String({ minLength: 1 }),
	label: Type.String(),
	backendKey: Type.String({ minLength: 1 }),
	token: Type.String({ minLength: 1, maxLength: 4096, description: "The FCM registration token." }),
	preferences: NotificationPreferencesSchema,
});
export type NotificationsRegisterFcmRequest = Static<typeof NotificationsRegisterFcmRequestSchema>;

export const NotificationsUnregisterRequestSchema = Type.Object({
	type: Type.Literal("notifications.unregister"),
	id: RequestIdSchema,
	deviceId: Type.String({ minLength: 1 }),
});
export type NotificationsUnregisterRequest = Static<typeof NotificationsUnregisterRequestSchema>;

/** This device's registration on this backend, or null. */
export const NotificationsDeviceRequestSchema = Type.Object({
	type: Type.Literal("notifications.device"),
	id: RequestIdSchema,
	deviceId: Type.String({ minLength: 1 }),
});
export type NotificationsDeviceRequest = Static<typeof NotificationsDeviceRequestSchema>;

/** Push a test notification to this device now and say how the push service answered. */
export const NotificationsTestRequestSchema = Type.Object({
	type: Type.Literal("notifications.test"),
	id: RequestIdSchema,
	deviceId: Type.String({ minLength: 1 }),
});
export type NotificationsTestRequest = Static<typeof NotificationsTestRequestSchema>;

/**
 * Whether this connection's page is visible (and which project it shows, which the server no longer acts on). Sent on
 * connect and whenever the page's visibility or route changes; the server forgets it when the connection closes. A
 * visible connection makes the backend hold notifications for 15 s (see `notifications.interaction`).
 */
export const NotificationsPresenceRequestSchema = Type.Object({
	type: Type.Literal("notifications.presence"),
	id: RequestIdSchema,
	deviceId: Type.String({ minLength: 1 }),
	visible: Type.Boolean(),
	projectId: Type.Union([ProjectIdSchema, Type.Null()]),
});
export type NotificationsPresenceRequest = Static<typeof NotificationsPresenceRequestSchema>;

/** How long a backend holds a notification while some connection is visible, unless someone interacts. */
export const NOTIFICATION_HOLD_MS = 15_000;
/** The most often a client reports interaction to one backend while the user keeps interacting. */
export const INTERACTION_REPORT_INTERVAL_MS = 5_000;

/**
 * The user touched the app on this device (a pointer press, a key, a touch, the wheel, typing; not a mere mouse move).
 * Needs the `notification-hold` feature. The backend drops every notification it is holding, for every device, because
 * someone is using the app. Clients send it at most once per `INTERACTION_REPORT_INTERVAL_MS` per backend (the first
 * interaction at once, later ones as one trailing message), and to every backend they are connected to: backends do not
 * talk to each other. A client that never sends it is an open app nobody touches, whose pushes arrive after the hold.
 */
export const NotificationsInteractionRequestSchema = Type.Object({
	type: Type.Literal("notifications.interaction"),
	id: RequestIdSchema,
	deviceId: Type.String({ minLength: 1 }),
});
export type NotificationsInteractionRequest = Static<typeof NotificationsInteractionRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const NotificationsConfigResponseSchema = Type.Object({
	type: Type.Literal("notifications.config"),
	id: RequestIdSchema,
	publicKey: Type.String({ minLength: 1 }),
	fcm: Type.Optional(
		Type.Union([Type.Object({ projectId: Type.String({ minLength: 1 }) }), Type.Null()], {
			description:
				"The Firebase project this backend sends FCM through; null when it has no service-account key (FCM off). Absent on backends without fcm-push.",
		}),
	),
});
export type NotificationsConfigResponse = Static<typeof NotificationsConfigResponseSchema>;

export const NotificationsRegisterResponseSchema = Type.Object({
	type: Type.Literal("notifications.register"),
	id: RequestIdSchema,
	device: NotificationDeviceSchema,
});
export type NotificationsRegisterResponse = Static<typeof NotificationsRegisterResponseSchema>;

export const NotificationsRegisterFcmResponseSchema = Type.Object({
	type: Type.Literal("notifications.registerFcm"),
	id: RequestIdSchema,
	device: NotificationDeviceSchema,
});
export type NotificationsRegisterFcmResponse = Static<typeof NotificationsRegisterFcmResponseSchema>;

export const NotificationsUnregisterResponseSchema = Type.Object({
	type: Type.Literal("notifications.unregister"),
	id: RequestIdSchema,
});
export type NotificationsUnregisterResponse = Static<typeof NotificationsUnregisterResponseSchema>;

export const NotificationsDeviceResponseSchema = Type.Object({
	type: Type.Literal("notifications.device"),
	id: RequestIdSchema,
	device: Type.Union([NotificationDeviceSchema, Type.Null()]),
});
export type NotificationsDeviceResponse = Static<typeof NotificationsDeviceResponseSchema>;

export const NotificationsTestResponseSchema = Type.Object({
	type: Type.Literal("notifications.test"),
	id: RequestIdSchema,
	ok: Type.Boolean(),
	status: Type.Union([Type.Integer(), Type.Null()]),
	message: Type.Union([Type.String(), Type.Null()]),
});
export type NotificationsTestResponse = Static<typeof NotificationsTestResponseSchema>;

export const NotificationsPresenceResponseSchema = Type.Object({
	type: Type.Literal("notifications.presence"),
	id: RequestIdSchema,
});
export type NotificationsPresenceResponse = Static<typeof NotificationsPresenceResponseSchema>;

export const NotificationsInteractionResponseSchema = Type.Object({
	type: Type.Literal("notifications.interaction"),
	id: RequestIdSchema,
	dropped: Type.Integer({ minimum: 0, description: "How many held notifications this interaction dropped." }),
});
export type NotificationsInteractionResponse = Static<typeof NotificationsInteractionResponseSchema>;
