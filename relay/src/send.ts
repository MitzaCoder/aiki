import { Timestamp } from "firebase-admin/firestore";
import { requireActiveAccount, requireLiveAuthUser } from "./admission";
import type { InstallationDocument, RelayStore, RouteDocument, SendAttemptDocument } from "./documents";
import {
	DAY,
	MINUTE,
	type CoreRequest,
	type Dependencies,
	type EndpointResult,
	type FcmMessage,
	type FcmResult,
} from "./ports";
import {
	constantTimeHashEqual,
	parseCapability,
	parseObject,
	requireCondition,
	requireId,
	serializeEnvelope,
	sha256,
	type Capability,
} from "./validation";
interface SendInput {
	routeId: string;
	messageId: string;
	compactEnvelope?: string;
}
interface ExternalReservation {
	kind: "send";
	message: FcmMessage;
	installationId: string;
	generation: number;
}
type Reservation =
	| ExternalReservation
	| {
			kind: "reply";
			response: EndpointResult;
	  };
function parseSendInput(raw: unknown, statusOnly: boolean): SendInput {
	const input = parseObject(raw, statusOnly ? ["routeId", "messageId"] : ["routeId", "messageId", "envelope"]);
	requireId(input.routeId);
	requireId(input.messageId);
	return {
		routeId: input.routeId,
		messageId: input.messageId,
		...(statusOnly ? {} : { compactEnvelope: serializeEnvelope(input.envelope, input.routeId, input.messageId) }),
	};
}
function requireRouteCapability(
	route: RouteDocument | undefined,
	credential: Capability,
): asserts route is RouteDocument {
	requireCondition(route && constantTimeHashEqual(route.sendHash, credential.digest), 404, "not_found");
}
function requireActiveRoute(route: RouteDocument, now: number): void {
	requireCondition(route.leaseExpiresAt > now && route.absoluteExpiresAt > now, 410, "route_expired");
	requireCondition(route.state === "active", 410, "route_inactive");
}
function requireValidToken(
	installation: InstallationDocument | undefined,
): asserts installation is InstallationDocument & {
	token: string;
} {
	requireCondition(installation?.state === "active" && installation.token, 410, "token_invalid");
}
function attemptResponse(attempt: SendAttemptDocument): EndpointResult {
	if (attempt.state === "retry") {
		return {
			status: attempt.code === "fcm_rate_limited" ? 429 : 503,
			body: { error: attempt.code },
			retryAt: attempt.retryAt,
		};
	}
	if (attempt.state === "pending") {
		return { status: 200, body: { state: "pending" }, retryAt: attempt.leaseUntil };
	}
	return { status: 200, body: { state: attempt.state, code: attempt.code } };
}
function statusResponse(attempt: SendAttemptDocument | undefined): EndpointResult {
	if (!attempt) return { status: 200, body: { state: "unknown" } };
	return {
		status: 200,
		body: {
			state: attempt.state,
			...(attempt.code ? { code: attempt.code } : {}),
			...(attempt.state === "retry" ? { retryAt: attempt.retryAt } : {}),
		},
		...(attempt.state === "pending" ? { retryAt: attempt.leaseUntil } : {}),
	};
}
/** Authorize a route and return only its bounded attempt state; no FCM or budget-consuming send occurs. */
export async function readSendStatus(
	deps: Dependencies,
	store: RelayStore,
	request: CoreRequest,
	raw: unknown,
): Promise<EndpointResult> {
	return reserveOrSend(deps, store, request, raw, true);
}
/** Reserve the digest before FCM, retry only after its lease, and preserve first-reservation message lifetime. */
export async function sendNotification(
	deps: Dependencies,
	store: RelayStore,
	request: CoreRequest,
	raw: unknown,
): Promise<EndpointResult> {
	return reserveOrSend(deps, store, request, raw, false);
}
async function reserveOrSend(
	deps: Dependencies,
	store: RelayStore,
	request: CoreRequest,
	raw: unknown,
	statusOnly: boolean,
): Promise<EndpointResult> {
	const credential = parseCapability(request.authorization, "send");
	// Validate IDs/shape, but authenticate before envelope serialization or external account work.
	const input = parseObject(raw, statusOnly ? ["routeId", "messageId"] : ["routeId", "messageId", "envelope"]);
	requireId(input.routeId);
	requireCondition(credential.routeId === input.routeId, 404, "not_found");
	const routeRef = store.routes.doc(input.routeId);
	const initial = (await routeRef.get()).data();
	requireRouteCapability(initial, credential);
	const parsed = parseSendInput(raw, statusOnly);
	await requireLiveAuthUser(deps, initial.uid);
	const attemptRef = store.sendAttempts.doc(parsed.routeId + "_" + parsed.messageId);
	const attemptId = deps.random(16);
	/** Check account/route state, serialize digest conflicts and fence each external attempt before delivery. */
	const reservation = await deps.firestore.runTransaction<Reservation>(async (transaction) => {
		const route = (await transaction.get(routeRef)).data();
		requireRouteCapability(route, credential);
		const [accountSnapshot, installationSnapshot, previousSnapshot] = await Promise.all([
			transaction.get(store.accounts.doc(route.uid)),
			transaction.get(store.installations.doc(route.installationId)),
			transaction.get(attemptRef),
		]);
		const account = accountSnapshot.data();
		const installation = installationSnapshot.data();
		const previous = previousSnapshot.data();
		requireActiveAccount(account);
		requireActiveRoute(route, deps.now());
		if (statusOnly) return { kind: "reply", response: statusResponse(previous) };
		const compact = parsed.compactEnvelope!;
		if (previous) {
			requireCondition(constantTimeHashEqual(previous.digest, sha256(compact)), 409, "message_conflict");
		}
		const reservedAt = previous?.reservedAt ?? deps.now();
		const ttlMs = Math.min(reservedAt + 12 * 60 * MINUTE, route.leaseExpiresAt) - deps.now();
		requireCondition(ttlMs > 0, 410, "message_expired");
		if (previous) {
			const terminal = previous.state === "accepted" || previous.state === "failed";
			const retryAt = previous.state === "retry" ? previous.retryAt! : previous.leaseUntil;
			if (terminal || retryAt > deps.now()) return { kind: "reply", response: attemptResponse(previous) };
		}
		requireValidToken(installation);
		transaction.set(attemptRef, {
			uid: route.uid,
			routeId: parsed.routeId,
			messageId: parsed.messageId,
			digest: sha256(compact),
			reservedAt,
			state: "pending",
			leaseUntil: deps.now() + MINUTE,
			attemptId,
			purgeAt: Timestamp.fromMillis(reservedAt + DAY),
		});
		return {
			kind: "send",
			message: { token: installation.token, data: { aiki: compact }, priority: "high", ttlMs },
			installationId: route.installationId,
			generation: installation.generation,
		};
	});
	if (reservation.kind === "reply") return reservation.response;
	let result: FcmResult;
	try {
		result = await deps.send(reservation.message);
	} catch {
		// Simulated process loss after acceptance: the persisted reservation remains ambiguous for 60 seconds.
		const attempt = (await attemptRef.get()).data();
		requireCondition(attempt, 503, "relay_unavailable");
		return attemptResponse(attempt);
	}
	/** Fence stale result writers and invalidate only the token generation actually sent, never a replacement. */
	return deps.firestore.runTransaction(async (transaction) => {
		const [attemptSnapshot, installationSnapshot] = await Promise.all([
			transaction.get(attemptRef),
			transaction.get(store.installations.doc(reservation.installationId)),
		]);
		const attempt = attemptSnapshot.data();
		const installation = installationSnapshot.data();
		const ownerRef = installation?.tokenHash ? store.tokenOwners.doc(installation.tokenHash) : undefined;
		const tokenOwner = ownerRef ? (await transaction.get(ownerRef)).data() : undefined;
		requireCondition(attempt, 503, "relay_unavailable");
		if (
			result === "unregistered" &&
			installation?.generation === reservation.generation &&
			installation.state === "active"
		) {
			transaction.update(store.installations.doc(reservation.installationId), {
				token: null,
				tokenHash: null,
				state: "token_invalid",
			});
			if (
				ownerRef &&
				tokenOwner?.installationId === reservation.installationId &&
				tokenOwner.generation === reservation.generation
			)
				transaction.delete(ownerRef);
		}
		if (attempt.attemptId !== attemptId) return attemptResponse(attempt);
		if (result === "accepted" || result === "unregistered") {
			attempt.state = result === "accepted" ? "accepted" : "failed";
			attempt.code = result === "accepted" ? "accepted" : "token_invalid";
			attempt.leaseUntil = 0;
		} else {
			attempt.state = "retry";
			attempt.code = result === "rate_limited" ? "fcm_rate_limited" : "fcm_unavailable";
			// A timeout must never shorten the ambiguous lease established before FCM.
			attempt.retryAt = Math.max(attempt.leaseUntil, deps.now() + MINUTE);
		}
		transaction.set(attemptRef, attempt);
		return attemptResponse(attempt);
	});
}
