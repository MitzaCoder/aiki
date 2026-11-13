import {
	type NotificationDevice,
	type NotificationRelayStatus,
	type NotificationsRegisterRelayRequest,
	type NotificationsRegisterRelayResponse,
	type RelayContext,
	deriveRelayKeys,
	exportRelayPublicKey,
	generateRelayKeyPair,
	parseRelayBearer,
	relayBase64,
	relayConfirmation,
	relaySharedSecret,
	relaySequence,
	relayTranscript,
	relayUnbase64,
	relayUtf8,
	validateRelayId,
	verifyRelayConfirmation,
} from "@kemiri/protocol";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { ServerError } from "../errors.ts";
import { readJsonFile, writeJsonFile } from "../fs-json.ts";
import type { NotificationEvent } from "../notifications.ts";

/** Relay cleanup and unused-pending-route retention windows, in milliseconds. */
export const PUSH_RELAY_CLEANUP_MS = 24 * 60 * 60 * 1000;
export const PUSH_RELAY_PENDING_MS = 10 * 60 * 1000;
const MAX_RELAY_ROUTE_LIFETIME_MS = 90 * PUSH_RELAY_CLEANUP_MS;

export type RelayRegistration = Omit<NotificationsRegisterRelayRequest, "id" | "type">;
export type RelayRegistrationAnswer = Omit<NotificationsRegisterRelayResponse, "id" | "type">;
export type RelayRoute = {
	context: RelayContext;
	operationId: string;
	registration: RelayRegistration;
	answer: RelayRegistrationAnswer;
	transcript: string;
	keys: { notification: string; "phone-confirm": string; "backend-confirm": string };
	state: "pending" | "active" | "paused" | "needs_new_keys";
	nextSequence: string;
	device: NotificationDevice;
};
export type RelaySendEntry = {
	routeId: string;
	messageId: string;
	body: string;
	event: Pick<NotificationEvent, "kind" | "projectId">;
	expiresAt: number;
	attempts: number;
	dueAt: number;
};
export type RelayDeleteEntry = {
	routeId: string;
	sessionId: string;
	deleteBearer: string;
	absoluteExpiresAt: number;
	attempts: number;
	dueAt: number;
};
type Receipt = {
	sessionId: string;
	fingerprint: string;
	routeId: string;
	keyId: string;
	answer: RelayRegistrationAnswer;
	purgeAt: number;
};
type RevokedStatus = Pick<NotificationRelayStatus, "leaseExpiresAt" | "absoluteExpiresAt" | "lastDelivery"> & {
	purgeAt: number;
};
export type RelayFile = {
	version: 1;
	routes: RelayRoute[];
	receipts: Record<string, Receipt>;
	selected: Record<string, string | null>;
	revoked: Record<string, RevokedStatus>;
	cleanupExpired: Record<string, number>;
	sends: RelaySendEntry[];
	deletes: RelayDeleteEntry[];
};
type CounterFile = { version: 1; counters: Record<string, string> };

function invalid(): never {
	throw new ServerError("bad_request", "Invalid relay registration");
}

/** Server-owned device identifier: caller labels and device IDs cannot bind a route to another session. */
export function relayDeviceId(sessionId: string): string {
	return `relay:${sessionId}`;
}

/** Separate private atomic state and counter witness. A failed commit never publishes its new in-memory state. */
export class PushRelayStore {
	readonly file: string;
	readonly countersFile: string;
	#state: RelayFile = { version: 1, routes: [], receipts: {}, selected: {}, revoked: {}, cleanupExpired: {}, sends: [], deletes: [] };
	#counters: CounterFile = { version: 1, counters: {} };
	#writes: Promise<unknown> = Promise.resolve();

	constructor(dir: string) {
		this.file = join(dir, "push-relay.json");
		this.countersFile = join(dir, "push-relay-counters.json");
	}

	/** Read fail-closed; a missing/mismatched witness requires new keys, never a counter reset. */
	async read(): Promise<void> {
		const raw = await readJsonFile(this.file);
		const counters = await readJsonFile(this.countersFile);
		if (raw === undefined) {
			if (counters !== undefined) throw new Error("Relay state missing; restore requires fresh keys");
			return;
		}
		// Corrupt storage is an operator error, not permission to silently recover under old keys.
		const state = raw as RelayFile;
		if (state.version !== 1 || !Array.isArray(state.routes) || !Array.isArray(state.sends) ||
			!Array.isArray(state.deletes) || !state.selected || !state.receipts || !state.revoked) throw new Error("Invalid relay state");
		state.cleanupExpired ??= {};
		// Upgrade the pre-retention v1 shape conservatively. A missing old route can have lived at most 90 days.
		for (const receipt of Object.values(state.receipts)) {
			const route = state.routes.find((r) => r.context.routeId === receipt.routeId);
			receipt.purgeAt ??= (route
				? state.selected[route.context.sessionId] === route.context.routeId
					? route.registration.absoluteExpiresAt
					: route.answer.serverTime + PUSH_RELAY_PENDING_MS
				: receipt.answer.serverTime + MAX_RELAY_ROUTE_LIFETIME_MS) + PUSH_RELAY_CLEANUP_MS;
		}
		for (const revoked of Object.values(state.revoked))
			revoked.purgeAt ??= (revoked.absoluteExpiresAt ?? 0) + PUSH_RELAY_CLEANUP_MS;
		for (const entry of state.deletes) {
			if (entry.absoluteExpiresAt !== undefined) continue;
			const receipt = Object.values(state.receipts).find((r) => r.routeId === entry.routeId);
			const absolute = receipt ? Math.max(state.revoked[entry.sessionId]?.absoluteExpiresAt ?? 0,
				receipt.answer.serverTime + MAX_RELAY_ROUTE_LIFETIME_MS) : state.revoked[entry.sessionId]?.absoluteExpiresAt;
			if (absolute === undefined || absolute === null) throw new Error("Relay deletion expiry is missing");
			entry.absoluteExpiresAt = absolute;
		}
		this.#state = state;
		if (counters !== undefined) {
			const witness = counters as CounterFile;
			if (witness.version !== 1 || !witness.counters) throw new Error("Invalid relay counters");
			this.#counters = witness;
			await chmod(this.countersFile, 0o600);
		}
		await chmod(this.file, 0o600);
		for (const route of state.routes) {
			const count = this.#counters.counters[route.context.keyId];
			let consistent = count === route.nextSequence;
			try {
				relaySequence(route.nextSequence);
				for (const key of Object.values(route.keys)) relayUnbase64(key, 32);
			} catch {
				consistent = false;
			}
			if (!consistent) route.state = "needs_new_keys";
		}
		// Do not rewrite on read. Exact encrypted pending entries may still be retried without allocating a sequence.
	}

	/** A snapshot; callers cannot mutate state outside a durable transaction. */
	snapshot(): RelayFile {
		return structuredClone(this.#state);
	}

	/** Serialize a transaction and publish only after the mode-0600 replacement succeeds. */
	async transaction<T>(change: (draft: RelayFile) => T | Promise<T>): Promise<T> {
		const run = this.#writes.then(async () => {
			const draft = structuredClone(this.#state);
			const result = await change(draft);
			await writeJsonFile(this.file, draft, 0o600);
			this.#state = draft;
			return result;
		});
		this.#writes = run.catch(() => undefined);
		return await run;
	}

	/** Wait only for local durable writes, never for remote cleanup. */
	async flush(): Promise<void> {
		await this.#writes;
	}

	/** True even for a revoked relay selection; stale direct rows must never become an implicit fallback. */
	selected(sessionId: string): boolean {
		return Object.hasOwn(this.#state.selected, sessionId);
	}

	/** Safe, session-scoped status; no route IDs, transcript, capabilities or keys escape. */
	status(sessionId?: string): NotificationRelayStatus {
		const route = this.#state.routes.find((r) => r.context.sessionId === sessionId && r.state === "pending") ??
			this.#state.routes.find((r) => r.context.sessionId === sessionId);
		const revoked = sessionId ? this.#state.revoked[sessionId] : undefined;
		return {
			available: true,
			state: route?.state ?? (sessionId && this.selected(sessionId) ? "revoked" : "unregistered"),
			leaseExpiresAt: route?.registration.leaseExpiresAt ?? revoked?.leaseExpiresAt ?? null,
			absoluteExpiresAt: route?.registration.absoluteExpiresAt ?? revoked?.absoluteExpiresAt ?? null,
			cleanup: this.#state.deletes.some((r) => r.sessionId === sessionId) ? "pending" : "done",
			lastDelivery: route?.device.lastDelivery?.message ?? revoked?.lastDelivery ??
				(sessionId && this.#state.cleanupExpired[sessionId] ? "cleanup_expired" : null),
		};
	}

	/** Expire receipts/status and delete capabilities at their relay purge horizons, without any HTTP wait. */
	async prune(now: number): Promise<void> {
		const due = Object.values(this.#state.receipts).some((r) => r.purgeAt <= now) ||
			Object.values(this.#state.revoked).some((r) => r.purgeAt <= now) ||
			Object.values(this.#state.cleanupExpired).some((until) => until <= now) ||
			this.#state.deletes.some((d) => d.absoluteExpiresAt + PUSH_RELAY_CLEANUP_MS <= now);
		if (!due) return;
		await this.transaction((draft) => {
			for (const [sessionId, until] of Object.entries(draft.cleanupExpired))
				if (until <= now) delete draft.cleanupExpired[sessionId];
			for (const [operationId, receipt] of Object.entries(draft.receipts))
				if (receipt.purgeAt <= now && !draft.routes.some((r) => r.context.routeId === receipt.routeId))
					delete draft.receipts[operationId];
			for (const [sessionId, revoked] of Object.entries(draft.revoked))
				if (revoked.purgeAt <= now) delete draft.revoked[sessionId];
			draft.deletes = draft.deletes.filter((entry) => {
				if (entry.absoluteExpiresAt + PUSH_RELAY_CLEANUP_MS > now) return true;
				draft.cleanupExpired[entry.sessionId] = now + PUSH_RELAY_CLEANUP_MS;
				return false;
			});
		});
	}

	/** Public pending/active registration, excluding every secret-bearing storage field. */
	device(deviceId: string): NotificationDevice | undefined {
		const route = this.#state.routes.find((r) => r.device.deviceId === deviceId && r.state !== "pending") ??
			this.#state.routes.find((r) => r.device.deviceId === deviceId);
		return route ? { ...structuredClone(route.device), relay: this.status(route.context.sessionId) } : undefined;
	}

	/** Prepare a crash-idempotent agreement, bounded to one pending successor per authenticated session. */
	async register(sessionId: string, backendId: string, input: RelayRegistration, now: number): Promise<RelayRegistrationAnswer> {
		validateRelayId(input.operationId);
		validateRelayId(input.routeId);
		validateRelayId(input.keyId);
		relayUnbase64(input.salt, 32);
		if (parseRelayBearer(input.sendBearer, "send").routeId !== input.routeId ||
			parseRelayBearer(input.deleteBearer, "delete").routeId !== input.routeId) invalid();
		// Hash a fixed field order, not caller JSON order; the receipt retains no duplicate bearer secrets.
		const ordered = [sessionId, backendId, input.operationId, input.routeId, input.keyId, input.sendBearer,
			input.deleteBearer, input.leaseExpiresAt, input.absoluteExpiresAt, input.phonePublicKey, input.salt,
			input.label, input.backendKey, input.preferences.kinds, input.preferences.mutedProjects,
			input.preferences.quietHours, input.predecessorRouteId ?? null];
		const fingerprint = relayBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", relayUtf8(JSON.stringify(ordered)))));
		return await this.transaction(async (draft) => {
			const previous = draft.receipts[input.operationId];
			if (previous) {
				if (previous.sessionId !== sessionId || previous.fingerprint !== fingerprint) invalid();
				return previous.answer;
			}
			if (input.leaseExpiresAt <= now || input.leaseExpiresAt > input.absoluteExpiresAt ||
				!Number.isSafeInteger(input.absoluteExpiresAt)) invalid();
			if (Object.values(draft.receipts).some((r) => r.routeId === input.routeId || r.keyId === input.keyId)) invalid();
			if (draft.routes.some((r) => r.context.sessionId === sessionId && r.state === "pending")) invalid();
			const predecessor = draft.selected[sessionId];
			if (input.predecessorRouteId !== undefined && input.predecessorRouteId !== predecessor) invalid();
			const pair = await generateRelayKeyPair();
			const backendPublicKey = await exportRelayPublicKey(pair.publicKey);
			const context: RelayContext = { backendId, sessionId, routeId: input.routeId, keyId: input.keyId };
			const keys = await deriveRelayKeys(await relaySharedSecret(pair.privateKey, input.phonePublicKey), input.salt, context);
			const transcript = await relayTranscript(context, input.salt, input.phonePublicKey, backendPublicKey);
			const answer: RelayRegistrationAnswer = {
				backendPublicKey, confirmation: await relayConfirmation(keys["backend-confirm"], transcript),
				backendId, sessionId, deviceId: relayDeviceId(sessionId), serverTime: now,
			};
			const route: RelayRoute = {
				context, operationId: input.operationId, registration: structuredClone(input), answer, transcript,
				keys: { notification: relayBase64(keys.notification), "phone-confirm": relayBase64(keys["phone-confirm"]),
					"backend-confirm": relayBase64(keys["backend-confirm"]) },
				state: "pending", nextSequence: "0",
				device: { deviceId: answer.deviceId, label: input.label, backendKey: input.backendKey,
					preferences: structuredClone(input.preferences), createdAt: new Date(now).toISOString(),
					transport: "fcm-relay", lastDelivery: null },
			};
			// Witness first: a crash before the route write cannot cause a reused sequence/key.
			this.#counters.counters[input.keyId] = "0";
			await writeJsonFile(this.countersFile, this.#counters, 0o600);
			draft.routes.push(route);
			draft.receipts[input.operationId] = {
				sessionId, fingerprint, routeId: input.routeId, keyId: input.keyId, answer,
				purgeAt: now + PUSH_RELAY_PENDING_MS + PUSH_RELAY_CLEANUP_MS,
			};
			return answer;
		});
	}

	/** Verify the direction-specific transcript before atomically replacing the session's active route. */
	async confirm(sessionId: string, operationId: string, confirmation: string, now: number): Promise<void> {
		await this.transaction(async (draft) => {
			const route = draft.routes.find((r) => r.context.sessionId === sessionId && r.operationId === operationId);
			if (!route || route.state === "needs_new_keys" || route.registration.leaseExpiresAt <= now) invalid();
			await verifyRelayConfirmation(relayUnbase64(route.keys["phone-confirm"], 32), route.transcript, confirmation);
			if (route.state !== "pending") return;
			for (const old of [...draft.routes])
				if (old.context.sessionId === sessionId && old !== route) this.removeRoute(draft, old, now);
			route.state = "active";
			draft.receipts[operationId]!.purgeAt = route.registration.absoluteExpiresAt + PUSH_RELAY_CLEANUP_MS;
			draft.selected[sessionId] = route.context.routeId;
		});
	}

	/** Atomically erase sends/send secrets/keys and retain only independent delete-only work. */
	removeRoute(draft: RelayFile, route: RelayRoute, now: number): void {
		if (!draft.deletes.some((d) => d.routeId === route.context.routeId)) draft.deletes.push({
			routeId: route.context.routeId, sessionId: route.context.sessionId,
			deleteBearer: route.registration.deleteBearer, absoluteExpiresAt: route.registration.absoluteExpiresAt,
			attempts: 0, dueAt: now,
		});
		draft.revoked[route.context.sessionId] = {
			purgeAt: draft.receipts[route.operationId]?.purgeAt ??
				(route.registration.absoluteExpiresAt + PUSH_RELAY_CLEANUP_MS),
			leaseExpiresAt: route.registration.leaseExpiresAt, absoluteExpiresAt: route.registration.absoluteExpiresAt,
			lastDelivery: route.registration.leaseExpiresAt <= now ? "route_expired" : route.device.lastDelivery?.message ?? null,
		};
		draft.sends = draft.sends.filter((s) => s.routeId !== route.context.routeId);
		draft.routes = draft.routes.filter((r) => r !== route);
		if (draft.selected[route.context.sessionId] === route.context.routeId) draft.selected[route.context.sessionId] = null;
	}

	/** Allocate and persist before encryption; disagreement never silently resets a counter. */
	async allocate(routeId: string): Promise<{ route: RelayRoute; sequence: string }> {
		const allocated = await this.transaction(async (draft) => {
			const route = draft.routes.find((r) => r.context.routeId === routeId);
			if (!route || route.state !== "active") invalid();
			const sequence = route.nextSequence;
			if (this.#counters.counters[route.context.keyId] !== sequence || BigInt(sequence) >= 18446744073709551615n) {
				route.state = "needs_new_keys";
				return undefined;
			}
			route.nextSequence = (BigInt(sequence) + 1n).toString();
			this.#counters.counters[route.context.keyId] = route.nextSequence;
			await writeJsonFile(this.countersFile, this.#counters, 0o600);
			return { route: structuredClone(route), sequence };
		});
		if (!allocated) throw new ServerError("bad_request", "Relay route needs new keys");
		return allocated;
	}
}
