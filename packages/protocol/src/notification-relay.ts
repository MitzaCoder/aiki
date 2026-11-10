import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";
import { NotificationDeviceSchema, NotificationPreferencesSchema, NotificationRelayStatusSchema } from "./notifications.ts";

const Id = Type.String({ pattern: "^[A-Za-z0-9_-]{22}$" });
const Time = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

/** Signed-in, operation-idempotent per-route key agreement. No caller-supplied identity is accepted. */
export const NotificationsRegisterRelayRequestSchema = Type.Object({
	type: Type.Literal("notifications.registerRelay"),
	id: RequestIdSchema,
	operationId: Id,
	routeId: Id,
	keyId: Id,
	sendBearer: Type.String({ maxLength: 128 }),
	deleteBearer: Type.String({ maxLength: 128 }),
	leaseExpiresAt: Time,
	absoluteExpiresAt: Time,
	phonePublicKey: Type.String({ maxLength: 87 }),
	salt: Type.String({ maxLength: 43 }),
	label: Type.String({ maxLength: 256 }),
	backendKey: Type.String({ minLength: 1, maxLength: 128 }),
	preferences: NotificationPreferencesSchema,
	predecessorRouteId: Type.Optional(Id),
});
export type NotificationsRegisterRelayRequest = Static<typeof NotificationsRegisterRelayRequestSchema>;

export const NotificationsRegisterRelayResponseSchema = Type.Object({
	type: Type.Literal("notifications.registerRelay"),
	id: RequestIdSchema,
	backendPublicKey: Type.String(),
	confirmation: Type.String(),
	backendId: Type.String(),
	sessionId: Type.String(),
	deviceId: Type.String(),
	serverTime: Time,
});
export type NotificationsRegisterRelayResponse = Static<typeof NotificationsRegisterRelayResponseSchema>;

export const NotificationsConfirmRelayRequestSchema = Type.Object({
	type: Type.Literal("notifications.confirmRelay"),
	id: RequestIdSchema,
	operationId: Id,
	confirmation: Type.String({ maxLength: 43 }),
});
export type NotificationsConfirmRelayRequest = Static<typeof NotificationsConfirmRelayRequestSchema>;

export const NotificationsConfirmRelayResponseSchema = Type.Object({
	type: Type.Literal("notifications.confirmRelay"),
	id: RequestIdSchema,
	device: NotificationDeviceSchema,
});
export type NotificationsConfirmRelayResponse = Static<typeof NotificationsConfirmRelayResponseSchema>;

/** Sync a phone-authorized lease/preferences change, or durably revoke this session's route. */
export const NotificationsSyncRelayRequestSchema = Type.Object({
	type: Type.Literal("notifications.syncRelay"),
	id: RequestIdSchema,
	routeId: Id,
	leaseExpiresAt: Type.Optional(Time),
	preferences: Type.Optional(NotificationPreferencesSchema),
	unregister: Type.Optional(Type.Boolean()),
});
export type NotificationsSyncRelayRequest = Static<typeof NotificationsSyncRelayRequestSchema>;

export const NotificationsSyncRelayResponseSchema = Type.Object({
	type: Type.Literal("notifications.syncRelay"),
	id: RequestIdSchema,
	relay: NotificationRelayStatusSchema,
	serverTime: Time,
});
export type NotificationsSyncRelayResponse = Static<typeof NotificationsSyncRelayResponseSchema>;
