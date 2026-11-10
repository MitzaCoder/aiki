import {
	type NotificationDevice,
	type NotificationPayload,
	type NotificationRelayStatus,
	type NotificationsSyncRelayRequest,
	encryptRelay,
	newRelayId,
	relaySendBody,
	relayUnbase64,
} from "@aiki/protocol";
import { ServerError } from "../errors.ts";
import type { DeliveryOutcome, HoldScheduler, NotificationEvent } from "../notifications.ts";
import { PUSH_RELAY_CLEANUP_MS, PUSH_RELAY_PENDING_MS, PushRelayStore,
	type RelayRegistration, type RelayRegistrationAnswer, type RelayRoute,
	type RelaySendEntry, relayDeviceId } from "./store.ts";

export type PushRelayOptions = {
	store: PushRelayStore;
	endpoint: string;
	backendId: string;
	sessionActive: (sessionId: string) => boolean;
	now?: () => number;
	schedule?: HoldScheduler;
	random?: () => number;
	fetch?: typeof fetch;
	requestTimeoutMs?: number;
};
type HttpResult = { status: number | null; code: string; state: string; retryAfter: number };
const terminalRouteCodes = new Set(["route_expired", "route_inactive", "token_invalid", "account_disabled",
	"account_deleted", "not_found"]);
const safeCodes = new Set(["accepted", "retrying", "rate_limited", "relay_unavailable", "route_expired",
	"token_invalid", "account_disabled", "account_deleted", "route_inactive", "not_found", "message_expired",
	"message_conflict", "rejected", "queue_full", "needs_new_keys", "fcm_rate_limited", "route_rate",
	"account_rate", "ip_rate", "request_rate", "challenge_rate", "enrollment_rate", "relay_capacity",
	"enrollment_capacity", "fcm_unavailable", "relay_disabled", "enrollment_disabled", "client_address_unavailable"]);

/** Independent durable sender/cleanup pumps. HTTP failures are fixed safe outcomes, never payload-bearing errors. */
export class PushRelayTransport {
	readonly store: PushRelayStore;
	readonly #options: PushRelayOptions;
	readonly #now: () => number;
	readonly #schedule: HoldScheduler;
	readonly #random: () => number;
	#allowed: (device: NotificationDevice, event: Pick<NotificationEvent, "kind" | "projectId">) => Promise<boolean> =
		async () => false;
	#cancel: (() => void) | undefined;
	#stopped = false;
	readonly #sending = new Set<string>();
	readonly #deleting = new Set<string>();
	readonly #locallyRevoked = new Set<string>();
	readonly #work = new Set<Promise<unknown>>();

	constructor(options: PushRelayOptions) {
		this.store = options.store;
		this.#options = options;
		this.#now = options.now ?? Date.now;
		this.#random = options.random ?? Math.random;
		this.#schedule = options.schedule ?? ((run, delay) => {
			const timer = setTimeout(run, delay);
			return () => clearTimeout(timer);
		});
	}

	/** Install the existing Notifier's preference/archive policy; no alternate relay-specific policy. */
	setPolicy(allowed: (device: NotificationDevice, event: Pick<NotificationEvent, "kind" | "projectId">) => Promise<boolean>): void {
		this.#allowed = allowed;
	}

	/** Current backend clock for a fresh monotonic phone anchor, including idempotent registration retries. */
	serverTime(): number {
		return this.#now();
	}

	/** Safe status is session-local and contains no capabilities or key material. */
	status(sessionId?: string): NotificationRelayStatus {
		return this.store.status(sessionId);
	}

	/** Return public active devices only; pending agreements never send. */
	devices(): Array<NotificationDevice & { sessionId: string }> {
		const snapshot = this.store.snapshot();
		return snapshot.routes.filter((r) => r.state !== "pending" &&
			snapshot.selected[r.context.sessionId] === r.context.routeId).map((r) => ({
			...r.device, relay: this.status(r.context.sessionId), sessionId: r.context.sessionId,
		}));
	}

	/** Check ownership on legacy read/test/unregister too, including anonymous optional-mode callers. */
	checkDevice(deviceId: string, sessionId?: string): void {
		const route = this.store.snapshot().routes.find((r) => r.device.deviceId === deviceId);
		if ((route && route.context.sessionId !== sessionId) ||
			(deviceId.startsWith("relay:") && deviceId !== relayDeviceId(sessionId ?? "")))
			throw new ServerError("permission_denied", "Notification registration belongs to another session");
	}

	#checkSession(sessionId: string): void {
		if (!this.#options.sessionActive(sessionId)) throw new ServerError("auth_revoked", "auth_revoked");
	}

	/** Persist a pending agreement before returning; a duplicate operation has the exact original answer. */
	async register(sessionId: string, input: RelayRegistration): Promise<RelayRegistrationAnswer> {
		this.#checkSession(sessionId);
		const answer = await this.store.register(sessionId, this.#options.backendId, input, this.#now());
		if (!this.#options.sessionActive(sessionId)) {
			await this.revoke(sessionId);
			this.#checkSession(sessionId);
		}
		this.#arm();
		return answer;
	}

	/** Activate only for a still-live authenticated session; replacing a route cancels its queued events. */
	async confirm(sessionId: string, operationId: string, confirmation: string): Promise<NotificationDevice> {
		this.#checkSession(sessionId);
		await this.store.confirm(sessionId, operationId, confirmation, this.#now());
		if (!this.#options.sessionActive(sessionId)) {
			await this.revoke(sessionId);
			this.#checkSession(sessionId);
		}
		this.#arm();
		return this.store.device(relayDeviceId(sessionId))!;
	}

	/** Apply phone-authorized lease/preferences; unregister is immediate locally and never waits for HTTP. */
	async sync(sessionId: string, input: Omit<NotificationsSyncRelayRequest, "type" | "id">): Promise<NotificationRelayStatus> {
		this.#checkSession(sessionId);
		if (input.unregister) this.#locallyRevoked.add(input.routeId);
		await this.store.transaction((draft) => {
			const route = draft.routes.find((r) => r.context.routeId === input.routeId && r.context.sessionId === sessionId);
			if (!route) {
				if (input.unregister && Object.values(draft.receipts).some((r) => r.routeId === input.routeId && r.sessionId === sessionId)) return;
				throw new ServerError("bad_request", "Unknown relay route");
			}
			if (input.unregister) {
				this.store.removeRoute(draft, route, this.#now());
				return;
			}
			if (input.leaseExpiresAt !== undefined) {
				if (input.leaseExpiresAt <= this.#now() || input.leaseExpiresAt > route.registration.absoluteExpiresAt)
					throw new ServerError("bad_request", "Invalid relay lease");
				route.registration.leaseExpiresAt = input.leaseExpiresAt;
			}
			if (input.preferences) route.device.preferences = structuredClone(input.preferences);
			if (input.resume) {
				if (route.state === "needs_new_keys" || route.state === "pending")
					throw new ServerError("bad_request", "Relay route requires key confirmation");
				route.state = "active";
			}
		});
		this.#arm();
		return this.status(sessionId);
	}

	/** Replace every route of a session with delete-only work in a single local commit; no relay wait. */
	async revoke(sessionId: string): Promise<void> {
		const routes = this.store.snapshot().routes.filter((r) => r.context.sessionId === sessionId);
		if (!routes.length) return;
		for (const route of routes) this.#locallyRevoked.add(route.context.routeId);
		await this.store.transaction((draft) => {
			for (const route of [...draft.routes])
				if (route.context.sessionId === sessionId) this.store.removeRoute(draft, route, this.#now());
		});
		this.#arm();
	}

	/** Explicit direct registration is the only way to clear a relay selection; never an automatic fallback. */
	async selectDirect(sessionId: string): Promise<void> {
		await this.store.transaction((draft) => {
			delete draft.selected[sessionId];
			delete draft.revoked[sessionId];
			delete draft.cleanupExpired[sessionId];
		});
	}

	/** Consume a durable sequence, encrypt once, persist exact bytes, then submit; newest events drop at capacity. */
	async send(deviceId: string, payload: NotificationPayload, event: NotificationEvent, at: string,
		eventId = newRelayId()): Promise<DeliveryOutcome> {
		const outcome = (message: string): DeliveryOutcome => ({ deviceId, ok: false, status: null, message });
		try {
			const current = this.store.snapshot().routes.find((r) => r.device.deviceId === deviceId && r.state !== "pending");
			if (!current || this.#locallyRevoked.has(current.context.routeId) ||
				!this.#options.sessionActive(current.context.sessionId)) return outcome("auth_revoked");
			if (current.state === "needs_new_keys") return outcome("needs_new_keys");
			if (current.state === "paused") return outcome(current.device.lastDelivery?.message ?? "rejected");
			const now = this.#now();
			const expiresAt = Math.min(Date.parse(at) + 43_200_000, current.registration.leaseExpiresAt,
				current.registration.absoluteExpiresAt);
			if (expiresAt <= now) return outcome("route_expired");
			if (this.store.snapshot().sends.filter((s) => s.routeId === current.context.routeId).length >= 100) {
				await this.#record(current.context.routeId, "queue_full", null);
				return outcome("queue_full");
			}
			const { route, sequence } = await this.store.allocate(current.context.routeId);
			const envelope = await encryptRelay(relayUnbase64(route.keys.notification, 32), route.context, {
				backendId: route.context.backendId, sessionId: route.context.sessionId, sequence,
				createdAt: Date.parse(at), expiresAt, eventId, payload,
			});
			const body = relaySendBody(envelope);
			const messageId = JSON.parse(envelope).m as string;
			const entry: RelaySendEntry = { routeId: route.context.routeId, messageId, body,
				event: { kind: event.kind, projectId: event.projectId }, expiresAt, attempts: 0, dueAt: now };
			const queued = await this.store.transaction((draft) => {
				if (!draft.routes.some((r) => r.context.routeId === entry.routeId && r.state === "active") ||
					draft.sends.filter((s) => s.routeId === entry.routeId).length >= 100) return false;
				draft.sends.push(entry);
				return true;
			});
			if (!queued) return outcome("queue_full");
			return await this.#attempt(entry);
		} catch {
			const route = this.store.snapshot().routes.find((r) => r.device.deviceId === deviceId && r.state !== "pending");
			return outcome(route?.state === "needs_new_keys" ? "needs_new_keys" : "relay_unavailable");
		} finally {
			this.#arm();
		}
	}

	async #http(path: string, bearer: string, body: string): Promise<HttpResult> {
		try {
			const response = await (this.#options.fetch ?? fetch)(`${this.#options.endpoint}${path}`, {
				method: "POST", redirect: "error", signal: AbortSignal.timeout(this.#options.requestTimeoutMs ?? 10_000),
				headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
				body,
			});
			const retry = response.headers.get("Retry-After");
			const seconds = retry === null ? NaN : Number(retry);
			const retryAfter = Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry ?? "") - this.#now());
			// Never retain upstream text/errors. Bounded JSON fields are mapped to a fixed safe vocabulary.
			const text = await response.text();
			let code = "", state = "";
			if (text.length <= 8192) {
				try {
					const json = JSON.parse(text) as { code?: unknown; state?: unknown; error?: unknown };
					if (typeof json.error === "string") code = json.error;
					else if (typeof json.code === "string") code = json.code;
					if (typeof json.state === "string") state = json.state;
				} catch { /* Non-JSON failures are classified by HTTP status only. */ }
			}
			return { status: response.status, code, state, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 };
		} catch {
			return { status: null, code: "", state: "", retryAfter: 0 };
		}
	}

	#delay(attempts: number, retryAfter: number): number {
		return Math.max(retryAfter, Math.min(900_000, 5000 * 2 ** Math.min(attempts, 8) * (1 + this.#random() * 0.2)));
	}

	async #record(routeId: string, message: string, status: number | null): Promise<void> {
		await this.store.transaction((draft) => {
			const route = draft.routes.find((r) => r.context.routeId === routeId);
			if (route) route.device.lastDelivery = { at: new Date(this.#now()).toISOString(),
				ok: message === "accepted", status, message: safeCodes.has(message) ? message : "rejected" };
		});
	}

	async #attempt(entry: RelaySendEntry): Promise<DeliveryOutcome> {
		const snapshot = this.store.snapshot();
		const route = snapshot.routes.find((r) => r.context.routeId === entry.routeId);
		const deviceId = route?.device.deviceId ?? "";
		const outcome = (message: string, status: number | null = null): DeliveryOutcome => ({
			deviceId, ok: message === "accepted", status, message,
		});
		if (!route || this.#sending.has(entry.messageId) || this.#stopped) return outcome("retrying");
		this.#sending.add(entry.messageId);
		try {
			const allowed = !this.#locallyRevoked.has(entry.routeId) && this.#options.sessionActive(route.context.sessionId) &&
				await this.#allowed(route.device, entry.event);
			// Re-read after async policy: unregister/rotation/mute can have committed while archive state was read.
			const latest = this.store.snapshot();
			const active = latest.routes.find((r) => r.context.routeId === entry.routeId);
			if (!allowed || !active || this.#locallyRevoked.has(entry.routeId) || !latest.sends.some((s) => s.messageId === entry.messageId) ||
				!this.#options.sessionActive(route.context.sessionId) ||
				JSON.stringify(active.device.preferences) !== JSON.stringify(route.device.preferences) ||
				entry.expiresAt <= this.#now() || active.registration.leaseExpiresAt <= this.#now()) {
				await this.store.transaction((draft) => {
					draft.sends = draft.sends.filter((s) => s.messageId !== entry.messageId);
					const current = draft.routes.find((r) => r.context.routeId === entry.routeId);
					if (current && entry.expiresAt <= this.#now()) current.device.lastDelivery = {
						at: new Date(this.#now()).toISOString(), ok: false, status: null, message: "message_expired",
					};
				});
				return outcome("message_expired");
			}
			const result = await this.#http("send", route.registration.sendBearer, entry.body);
			const accepted = result.status === 200 && result.state === "accepted";
			const transient = result.status === null || result.status === 429 ||
				(result.status !== null && result.status >= 500) || (result.status === 200 && result.state === "pending");
			const message = accepted ? "accepted" : result.status === 429 ?
				(safeCodes.has(result.code) ? result.code : "rate_limited") :
				transient ? (result.status === 200 ? "retrying" :
					safeCodes.has(result.code) ? result.code : "relay_unavailable") :
				(safeCodes.has(result.code) ? result.code : result.status === 404 ? "not_found" :
					result.status === 410 ? "route_expired" : result.status === 409 ? "message_conflict" : "rejected");
			await this.store.transaction((draft) => {
				const stored = draft.sends.find((s) => s.messageId === entry.messageId);
				const current = draft.routes.find((r) => r.context.routeId === entry.routeId);
				if (!current || !stored) return;
				current.device.lastDelivery = { at: new Date(this.#now()).toISOString(), ok: accepted,
					status: result.status, message };
				if (transient) {
					stored.dueAt = this.#now() + this.#delay(stored.attempts++, result.retryAfter);
				} else {
					draft.sends = draft.sends.filter((s) => s.messageId !== entry.messageId);
					if (terminalRouteCodes.has(message)) {
						// Keep the selection/status, but stop new sends until the phone explicitly repairs the route.
						current.state = "paused";
						draft.sends = draft.sends.filter((s) => s.routeId !== entry.routeId);
					}
				}
			});
			return outcome(message, result.status);
		} finally {
			this.#sending.delete(entry.messageId);
		}
	}

	async #delete(routeId: string): Promise<void> {
		const entry = this.store.snapshot().deletes.find((d) => d.routeId === routeId);
		if (!entry || this.#deleting.has(routeId)) return;
		if (entry.absoluteExpiresAt + PUSH_RELAY_CLEANUP_MS <= this.#now()) {
			await this.store.prune(this.#now());
			return;
		}
		this.#deleting.add(routeId);
		try {
			const result = await this.#http("delete", entry.deleteBearer, JSON.stringify({ routeId }));
			await this.store.transaction((draft) => {
				if (result.status === 204) draft.deletes = draft.deletes.filter((d) => d.routeId !== routeId);
				else {
					const stored = draft.deletes.find((d) => d.routeId === routeId);
					if (stored) stored.dueAt = this.#now() + this.#delay(stored.attempts++, result.retryAfter);
				}
			});
		} finally {
			this.#deleting.delete(routeId);
		}
	}

	/** Resume outboxes and prune expired/revoked sessions; call only after policy is installed. */
	start(): void {
		this.#stopped = false;
		this.#launch(this.#pump());
	}

	#launch(work: Promise<unknown>): void {
		const safe = work.catch(() => undefined);
		this.#work.add(safe);
		void safe.finally(() => { this.#work.delete(safe); this.#arm(); });
	}

	async #pump(): Promise<void> {
		const snapshot = this.store.snapshot();
		for (const route of snapshot.routes) {
			if (!this.#options.sessionActive(route.context.sessionId) ||
				Math.min(route.registration.leaseExpiresAt, route.registration.absoluteExpiresAt,
					snapshot.selected[route.context.sessionId] !== route.context.routeId
						? route.answer.serverTime + PUSH_RELAY_PENDING_MS : Infinity) <= this.#now()) {
				await this.store.transaction((draft) => {
					const current = draft.routes.find((r) => r.context.routeId === route.context.routeId);
					if (current) this.store.removeRoute(draft, current, this.#now());
				});
			}
		}
		await this.store.prune(this.#now());
		for (const entry of this.store.snapshot().sends)
			if (Math.min(entry.dueAt, entry.expiresAt) <= this.#now()) this.#launch(this.#attempt(entry));
		for (const entry of this.store.snapshot().deletes)
			if (entry.dueAt <= this.#now()) this.#launch(this.#delete(entry.routeId));
	}

	#arm(): void {
		this.#cancel?.();
		this.#cancel = undefined;
		if (this.#stopped) return;
		const snapshot = this.store.snapshot();
		if (!snapshot.routes.length && !snapshot.deletes.length && !snapshot.sends.length &&
			!Object.keys(snapshot.receipts).length && !Object.keys(snapshot.revoked).length &&
			!Object.keys(snapshot.cleanupExpired).length) return;
		const times = [this.#now() + 60_000,
			...snapshot.routes.map((r) => Math.min(r.registration.leaseExpiresAt, r.registration.absoluteExpiresAt,
				snapshot.selected[r.context.sessionId] !== r.context.routeId
					? r.answer.serverTime + PUSH_RELAY_PENDING_MS : Infinity)),
			...snapshot.sends.filter((s) => !this.#sending.has(s.messageId)).map((s) => Math.min(s.dueAt, s.expiresAt)),
			...snapshot.deletes.filter((d) => !this.#deleting.has(d.routeId)).map((d) => d.dueAt),
			...snapshot.deletes.map((d) => d.absoluteExpiresAt + PUSH_RELAY_CLEANUP_MS),
			...Object.values(snapshot.receipts).map((r) => r.purgeAt),
			...Object.values(snapshot.revoked).map((r) => r.purgeAt),
			...Object.values(snapshot.cleanupExpired)];
		this.#cancel = this.#schedule(() => { this.#cancel = undefined; this.#launch(this.#pump()); },
			Math.max(0, Math.min(...times) - this.#now()));
	}

	/** Cancel scheduling; exact pending bytes and delete-only secrets remain durable for restart. */
	stop(): void {
		this.#stopped = true;
		this.#cancel?.();
		this.#cancel = undefined;
	}

	/** Settle in-flight work/local commits, not future scheduled retries. */
	async flush(): Promise<void> {
		while (this.#work.size) await Promise.allSettled([...this.#work]);
		await this.store.flush();
	}
}
