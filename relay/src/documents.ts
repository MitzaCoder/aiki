import {
	Timestamp,
	type Firestore,
	type FirestoreDataConverter,
	type WithFieldValue,
	type DocumentData,
} from "firebase-admin/firestore";
import type { Limits } from "./limits";
export interface ControlDocument {
	enabled?: boolean;
	enrollmentEnabled?: boolean;
	limits?: Partial<Limits>;
}
export interface RuntimeDocument {
	ipDay: number;
	ipKey: string;
	accounts: Record<string, boolean>;
	phones: Record<string, { uid: string; deadline: number }>;
}
export interface RateWindow {
	count: number;
	startedAt: number;
}
export interface RateLimitDocument {
	uid?: string;
	day: number;
	windows: Record<string, RateWindow>;
	requests: { id: string; at: number }[];
	purgeAt: Timestamp;
}
export type CleanupPhase =
	| "auth_disable"
	| "routes"
	| "installations"
	| "challenges"
	| "operations"
	| "attempts"
	| "owners"
	| "counters"
	| "auth_delete"
	| "finish";
export interface CleanupDocument {
	uid: string;
	operationId: string;
	mode: "disable" | "delete";
	phase: CleanupPhase;
	leaseOwner?: string;
	leaseUntil?: number;
	purgeAt: Timestamp;
}
export interface PhoneReservation {
	deadline: number;
	challengeDeadline: number;
}
export interface RouteReservation {
	installationId: string;
	deadline: number;
	predecessorId: string | null;
}
export interface ActiveAccountDocument {
	uid: string;
	state: "active";
	createdAt: number;
	lastManagementAt?: number;
	phoneAllowance: number;
	routeAllowance: number;
	phones: Record<string, PhoneReservation>;
	routes: Record<string, RouteReservation>;
}
export interface BlockedAccountDocument {
	uid: string;
	state: "disabled" | "deleting";
	cleanupComplete?: boolean;
	createdAt?: number;
	lastManagementAt?: number;
	phoneAllowance?: number;
	routeAllowance?: number;
	phones?: Record<string, PhoneReservation>;
	routes?: Record<string, RouteReservation>;
}
export type AccountDocument = ActiveAccountDocument | BlockedAccountDocument;
export interface ConfirmationReceipt {
	operationId: string;
	challengeId: string;
	nonceHash: string;
	replacing: boolean;
	generation: number;
}
export interface ChallengeOperationDocument {
	uid: string;
	installationId: string;
	purgeAt: Timestamp;
	tokenHash: string;
	replacing: boolean;
	challengeId: string;
	deadline: number;
}
export interface InstallationDocument {
	uid: string;
	state: "pending" | "active" | "token_invalid" | "deleted";
	createdAt: number;
	generation: number;
	token?: string | null;
	tokenHash?: string | null;
	deadline?: number;
	challengeDeadline?: number;
	pendingOperationId?: string;
	hadRoutes?: boolean;
	lastManagementAt?: number;
	confirmation?: ConfirmationReceipt;
	completedOperations?: string[];
	purgeAt?: Timestamp;
}
export interface ChallengeDocument {
	uid: string;
	installationId: string;
	operationId: string;
	replacing: boolean;
	challengeId: string;
	nonceHash: string;
	tokenHash: string;
	stagedToken: string;
	deadline: number;
	attempts: number;
	purgeAt: Timestamp;
}
export interface TokenOwnerDocument {
	uid: string;
	installationId: string;
	generation: number;
}
export interface RouteDocument {
	uid: string;
	installationId: string;
	operationId: string;
	sendHash: string;
	deleteHash: string;
	predecessorId: string | null;
	state: "pending" | "active" | "disabled";
	createdAt: number;
	pendingUntil: number;
	leaseExpiresAt: number;
	absoluteExpiresAt: number;
	generation: number;
	purgeAt: Timestamp;
}
export interface RouteRevocationDocument {
	purgeAt: Timestamp;
}
export interface SendAttemptDocument {
	uid: string;
	routeId: string;
	messageId: string;
	digest: string;
	reservedAt: number;
	state: "pending" | "accepted" | "failed" | "retry";
	code?: "accepted" | "token_invalid" | "fcm_rate_limited" | "fcm_unavailable";
	leaseUntil: number;
	retryAt?: number;
	attemptId: string;
	purgeAt: Timestamp;
}
type Parser<T> = (input: unknown) => T;
type Fields<T> = {
	[Key in keyof T]-?: Parser<T[Key]>;
};
function storedRecord(input: unknown): Record<string, unknown> {
	if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid stored document");
	return input as Record<string, unknown>;
}
function storedString(input: unknown): string {
	if (typeof input !== "string") throw new Error("Invalid stored string");
	return input;
}
function storedNumber(input: unknown): number {
	if (typeof input !== "number" || !Number.isFinite(input)) throw new Error("Invalid stored number");
	return input;
}
function storedBoolean(input: unknown): boolean {
	if (typeof input !== "boolean") throw new Error("Invalid stored boolean");
	return input;
}
function storedTimestamp(input: unknown): Timestamp {
	if (!(input instanceof Timestamp)) throw new Error("Invalid stored timestamp");
	return input;
}
function optional<T>(parse: Parser<T>): Parser<T | undefined> {
	return (input) => (input === undefined ? undefined : parse(input));
}
function nullable<T>(parse: Parser<T>): Parser<T | null> {
	return (input) => (input === null ? null : parse(input));
}
function enumeration<const T extends string>(...allowed: T[]): Parser<T> {
	return (input) => {
		if (typeof input !== "string" || !allowed.includes(input as T)) throw new Error("Invalid stored state");
		return input as T;
	};
}
function array<T>(parse: Parser<T>): Parser<T[]> {
	return (input) => {
		if (!Array.isArray(input)) throw new Error("Invalid stored list");
		return input.map(parse);
	};
}
function map<T>(parse: Parser<T>): Parser<Record<string, T>> {
	return (input) => Object.fromEntries(Object.entries(storedRecord(input)).map(([key, value]) => [key, parse(value)]));
}
function documentParser<T extends object>(fields: Fields<T>): Parser<T> {
	return (input) => {
		const record = storedRecord(input);
		for (const key of Object.keys(fields) as (keyof T & string)[]) fields[key](record[key]);
		// Preserve unknown server fields for forward-compatible T94 transactions; all typed fields were checked.
		return record as T;
	};
}
/** Validate a server document at the SDK boundary rather than trusting an untyped Firestore row. */
export function converter<T extends object>(parse: Parser<T>): FirestoreDataConverter<T> {
	return {
		toFirestore(document: WithFieldValue<T>): DocumentData {
			return document as DocumentData;
		},
		fromFirestore(snapshot): T {
			return parse(snapshot.data());
		},
	};
}
const phoneReservation = documentParser<PhoneReservation>({ deadline: storedNumber, challengeDeadline: storedNumber });
const routeReservation = documentParser<RouteReservation>({
	installationId: storedString,
	deadline: storedNumber,
	predecessorId: nullable(storedString),
});
const confirmation = documentParser<ConfirmationReceipt>({
	operationId: storedString,
	challengeId: storedString,
	nonceHash: storedString,
	replacing: storedBoolean,
	generation: storedNumber,
});
const activeAccount = documentParser<ActiveAccountDocument>({
	uid: storedString,
	state: enumeration("active"),
	createdAt: storedNumber,
	lastManagementAt: optional(storedNumber),
	phoneAllowance: storedNumber,
	routeAllowance: storedNumber,
	phones: map(phoneReservation),
	routes: map(routeReservation),
});
const blockedAccount = documentParser<BlockedAccountDocument>({
	uid: storedString,
	state: enumeration("disabled", "deleting"),
	cleanupComplete: optional(storedBoolean),
	createdAt: optional(storedNumber),
	lastManagementAt: optional(storedNumber),
	phoneAllowance: optional(storedNumber),
	routeAllowance: optional(storedNumber),
	phones: optional(map(phoneReservation)),
	routes: optional(map(routeReservation)),
});
function account(input: unknown): AccountDocument {
	return storedRecord(input).state === "active" ? activeAccount(input) : blockedAccount(input);
}
const challengeOperation = documentParser<ChallengeOperationDocument>({
	uid: storedString,
	installationId: storedString,
	purgeAt: storedTimestamp,
	tokenHash: storedString,
	replacing: storedBoolean,
	challengeId: storedString,
	deadline: storedNumber,
});
const installation = documentParser<InstallationDocument>({
	uid: storedString,
	state: enumeration("pending", "active", "token_invalid", "deleted"),
	createdAt: storedNumber,
	generation: storedNumber,
	token: optional(nullable(storedString)),
	tokenHash: optional(nullable(storedString)),
	deadline: optional(storedNumber),
	challengeDeadline: optional(storedNumber),
	pendingOperationId: optional(storedString),
	hadRoutes: optional(storedBoolean),
	lastManagementAt: optional(storedNumber),
	confirmation: optional(confirmation),
	completedOperations: optional(array(storedString)),
	purgeAt: optional(storedTimestamp),
});
const challenge = documentParser<ChallengeDocument>({
	uid: storedString,
	installationId: storedString,
	operationId: storedString,
	replacing: storedBoolean,
	challengeId: storedString,
	nonceHash: storedString,
	tokenHash: storedString,
	stagedToken: storedString,
	deadline: storedNumber,
	attempts: storedNumber,
	purgeAt: storedTimestamp,
});
const tokenOwner = documentParser<TokenOwnerDocument>({
	uid: storedString,
	installationId: storedString,
	generation: storedNumber,
});
const route = documentParser<RouteDocument>({
	uid: storedString,
	installationId: storedString,
	operationId: storedString,
	sendHash: storedString,
	deleteHash: storedString,
	predecessorId: nullable(storedString),
	state: enumeration("pending", "active", "disabled"),
	createdAt: storedNumber,
	pendingUntil: storedNumber,
	leaseExpiresAt: storedNumber,
	absoluteExpiresAt: storedNumber,
	generation: storedNumber,
	purgeAt: storedTimestamp,
});
const routeRevocation = documentParser<RouteRevocationDocument>({ purgeAt: storedTimestamp });
const sendAttemptFields = documentParser<SendAttemptDocument>({
	uid: storedString,
	routeId: storedString,
	messageId: storedString,
	digest: storedString,
	reservedAt: storedNumber,
	state: enumeration("pending", "accepted", "failed", "retry"),
	code: optional(enumeration("accepted", "token_invalid", "fcm_rate_limited", "fcm_unavailable")),
	leaseUntil: storedNumber,
	retryAt: optional(storedNumber),
	attemptId: storedString,
	purgeAt: storedTimestamp,
});
function sendAttempt(input: unknown): SendAttemptDocument {
	const attempt = sendAttemptFields(input);
	if (attempt.state === "retry") {
		storedNumber(attempt.retryAt);
		enumeration("fcm_rate_limited", "fcm_unavailable")(attempt.code);
	}
	if (attempt.state === "accepted") enumeration("accepted")(attempt.code);
	if (attempt.state === "failed") enumeration("token_invalid")(attempt.code);
	return attempt;
}

const control = documentParser<ControlDocument>({
	enabled: optional(storedBoolean),
	enrollmentEnabled: optional(storedBoolean),
	limits: optional((input) => {
		const record = storedRecord(input);
		for (const value of Object.values(record)) {
			if (storedNumber(value) < 0 || !Number.isSafeInteger(value)) throw new Error("Invalid stored limit");
		}
		return record as Partial<Limits>;
	}),
});
const runtime = documentParser<RuntimeDocument>({
	ipDay: storedNumber,
	ipKey: storedString,
	accounts: map(storedBoolean),
	phones: map(documentParser({ uid: storedString, deadline: storedNumber })),
});
const rateLimit = documentParser<RateLimitDocument>({
	uid: optional(storedString),
	day: storedNumber,
	windows: map(documentParser<RateWindow>({ count: storedNumber, startedAt: storedNumber })),
	requests: array(documentParser({ id: storedString, at: storedNumber })),
	purgeAt: storedTimestamp,
});
const cleanup = documentParser<CleanupDocument>({
	uid: storedString,
	operationId: storedString,
	mode: enumeration("disable", "delete"),
	phase: enumeration(
		"auth_disable",
		"routes",
		"installations",
		"challenges",
		"operations",
		"attempts",
		"owners",
		"counters",
		"auth_delete",
		"finish",
	),
	leaseOwner: optional(storedString),
	leaseUntil: optional(storedNumber),
	purgeAt: storedTimestamp,
});

/** Create typed Firestore collections whose converters validate every document read at the boundary. */
export function createStore(firestore: Firestore) {
	return {
		control: firestore.collection("relayControl").withConverter(converter(control)),
		runtime: firestore.collection("relayRuntime").withConverter(converter(runtime)),
		rateLimits: firestore.collection("relayRateLimits").withConverter(converter(rateLimit)),
		accountCleanup: firestore.collection("relayAccountCleanup").withConverter(converter(cleanup)),
		accounts: firestore.collection("relayAccounts").withConverter(converter(account)),
		installations: firestore.collection("relayInstallations").withConverter(converter(installation)),
		challenges: firestore.collection("relayChallenges").withConverter(converter(challenge)),
		challengeOperations: firestore.collection("relayChallengeOperations").withConverter(converter(challengeOperation)),
		tokenOwners: firestore.collection("relayTokenOwners").withConverter(converter(tokenOwner)),
		routes: firestore.collection("relayRoutes").withConverter(converter(route)),
		routeRevocations: firestore.collection("relayRouteRevocations").withConverter(converter(routeRevocation)),
		sendAttempts: firestore.collection("relaySendAttempts").withConverter(converter(sendAttempt)),
	};
}
export type RelayStore = ReturnType<typeof createStore>;
