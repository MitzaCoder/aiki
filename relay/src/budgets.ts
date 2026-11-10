import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Timestamp, type Transaction } from "firebase-admin/firestore";
import type { RateLimitDocument, RelayStore, RuntimeDocument } from "./documents";
import { readControl, requireRelayEnabled, type RelayControl } from "./control";
import type { LimitName } from "./limits";
import { DAY, MINUTE, type Dependencies } from "./ports";
import { RelayError } from "./validation";

export interface Charge {
	entity: "ip" | "global" | "account" | "route";
	id?: string;
	uid?: string;
	name: string;
	limit: LimitName;
	window: number;
	scope: string;
}
export interface BudgetPlan {
	control: RelayControl;
	runtime: RuntimeDocument;
	requireAvailable(names?: string[]): void;
	commitOnly(names: string[]): void;
	commit(): void;
}
export interface RequestReservation {
	bucketId: string;
	id: string;
}

/** UTC-aligned windows bound each calendar window by N and every rolling window of the same width by at most 2N. */
export function windowStart(now: number, duration: number): number {
	return Math.floor(now / duration) * duration;
}
function ipDigest(key: string, ip: string): string {
	if (!isIP(ip)) throw new RelayError(503, "client_address_unavailable");
	return createHmac("sha256", Buffer.from(key, "base64url")).update(ip).digest("hex");
}
async function readRuntime(deps: Dependencies, store: RelayStore, transaction: Transaction): Promise<RuntimeDocument> {
	const runtime = (await transaction.get(store.runtime.doc("state"))).data() ?? {
		ipDay: -1,
		ipKey: "",
		accounts: {},
		phones: {},
	};
	const day = windowStart(deps.now(), DAY);
	if (runtime.ipDay !== day) {
		runtime.ipDay = day;
		runtime.ipKey = deps.random(32);
	}
	runtime.phones = Object.fromEntries(
		Object.entries(runtime.phones).filter(([, phone]) => phone.deadline === 0 || phone.deadline > deps.now()),
	);
	return runtime;
}
function bucketId(entity: Charge["entity"], ipId: string, id?: string): string {
	if (entity === "ip") return ipId;
	if (entity === "global") return "global";
	if (!id) throw new Error("Missing authorized quota identity");
	return entity + "-" + createHmac("sha256", "aiki-quota-id-v1").update(id).digest("hex");
}
function freshBucket(now: number, previous?: RateLimitDocument, uid?: string): RateLimitDocument {
	const day = windowStart(now, DAY);
	return {
		day,
		windows: previous?.windows ?? {},
		requests: previous?.requests ?? [],
		...(uid ? { uid } : {}),
		purgeAt: Timestamp.fromMillis(day + DAY),
	};
}
function spend(bucket: RateLimitDocument, name: string, start: number): void {
	const previous = bucket.windows[name];
	bucket.windows[name] = { count: previous?.startedAt === start ? previous.count + 1 : 1, startedAt: start };
}

/** Read every applicable quota before any caller writes; the returned commit joins its caller's durable reservation. */
export async function prepareBudgets(
	deps: Dependencies,
	store: RelayStore,
	transaction: Transaction,
	ip: string,
	charges: Charge[],
	options: { deferValidation?: boolean; requireEnabled?: boolean } = {},
): Promise<BudgetPlan> {
	const control = await readControl(store, transaction);
	if (options.requireEnabled) requireRelayEnabled(control);
	const runtime = await readRuntime(deps, store, transaction);
	const now = deps.now();
	const ipId = "ip-" + runtime.ipDay + "-" + ipDigest(runtime.ipKey, ip);
	const ids = [...new Set(charges.map((charge) => bucketId(charge.entity, ipId, charge.id)))];
	const buckets = new Map<string, RateLimitDocument>();
	for (const id of ids) {
		const previous = (await transaction.get(store.rateLimits.doc(id))).data();
		const uid = charges.find((charge) => bucketId(charge.entity, ipId, charge.id) === id)?.uid;
		buckets.set(id, freshBucket(now, previous, uid));
	}
	const before = new Map(
		[...buckets].map(([id, bucket]) => [id, { ...bucket, windows: structuredClone(bucket.windows) }]),
	);
	const exhausted = charges
		.flatMap((charge) => {
			const bucket = buckets.get(bucketId(charge.entity, ipId, charge.id))!;
			const start = windowStart(now, charge.window);
			const count = bucket.windows[charge.name]?.startedAt === start ? bucket.windows[charge.name].count : 0;
			return count >= control.limits[charge.limit]
				? [{ name: charge.name, scope: charge.scope, resetAt: start + charge.window }]
				: [];
		})
		.sort((a, b) => b.resetAt - a.resetAt);
	const requireAvailable = (names?: string[]) => {
		const failure = exhausted.find((exhausted) => !names || names.includes(exhausted.name));
		if (failure) throw new RelayError(429, failure.scope, failure.resetAt);
	};
	if (!options.deferValidation) requireAvailable();
	for (const charge of charges)
		spend(buckets.get(bucketId(charge.entity, ipId, charge.id))!, charge.name, windowStart(now, charge.window));
	return {
		control,
		runtime,
		requireAvailable,
		commitOnly(names) {
			const selected = charges.filter((charge) => names.includes(charge.name));
			for (const charge of selected)
				spend(before.get(bucketId(charge.entity, ipId, charge.id))!, charge.name, windowStart(now, charge.window));
			for (const id of new Set(selected.map((charge) => bucketId(charge.entity, ipId, charge.id)))) {
				transaction.set(store.rateLimits.doc(id), before.get(id)!);
			}
		},
		commit() {
			for (const [id, bucket] of buckets) transaction.set(store.rateLimits.doc(id), bucket);
			transaction.set(store.runtime.doc("state"), runtime);
		},
	};
}

/** Reserve bounded coarse-request storage before auth/route lookups; random receipt IDs are not Firestore keys. */
export async function reserveRequest(
	deps: Dependencies,
	store: RelayStore,
	ip: string,
	requireEnabled = false,
): Promise<RequestReservation> {
	const id = deps.random(16);
	/** Reserve at most requestMinute in-flight or non-delivery requests per trusted IP before expensive lookups. */
	return deps.firestore.runTransaction(async (transaction) => {
		const control = await readControl(store, transaction);
		if (requireEnabled) requireRelayEnabled(control);
		const runtime = await readRuntime(deps, store, transaction);
		const bucket = "ip-" + runtime.ipDay + "-" + ipDigest(runtime.ipKey, ip);
		const previous = (await transaction.get(store.rateLimits.doc(bucket))).data();
		const row = freshBucket(deps.now(), previous);
		const start = windowStart(deps.now(), MINUTE);
		row.requests = row.requests.filter((request) => request.at >= start);
		if (row.requests.length >= control.limits.requestMinute) throw new RelayError(429, "request_rate", start + MINUTE);
		row.requests.push({ id, at: deps.now() });
		transaction.set(store.rateLimits.doc(bucket), row);
		transaction.set(store.runtime.doc("state"), runtime);
		return { bucketId: bucket, id };
	});
}

/** Refund only a validated new external send or successful non-status management request, never a failed proof. */
export async function releaseRequest(
	deps: Dependencies,
	store: RelayStore,
	receipt: RequestReservation,
): Promise<void> {
	/** Remove only this request's reservation, preserving concurrent requests and accrued IP counters. */
	await deps.firestore.runTransaction(async (transaction) => {
		const ref = store.rateLimits.doc(receipt.bucketId);
		const row = (await transaction.get(ref)).data();
		if (!row) return;
		row.requests = row.requests.filter((request) => request.id !== receipt.id);
		transaction.set(ref, row);
	});
}

/** Charge source-IP management admission without depending on send/enrollment budgets. */
export async function chargeManagement(deps: Dependencies, store: RelayStore, ip: string): Promise<void> {
	/** Compose minute and daily management limits atomically. */
	await deps.firestore.runTransaction(async (transaction) => {
		const plan = await prepareBudgets(deps, store, transaction, ip, [
			{ entity: "ip", name: "managementMinute", limit: "managementMinute", window: MINUTE, scope: "ip_rate" },
			{ entity: "ip", name: "managementDay", limit: "managementDay", window: DAY, scope: "ip_rate" },
		]);
		plan.commit();
	});
}

/** Expand the route/account/IP/global dimensions charged before every external delivery attempt. */
export function sendCharges(uid: string, routeId: string): Charge[] {
	return [
		{
			entity: "route",
			id: routeId,
			uid,
			name: "sendMinute",
			limit: "routeMinute",
			window: MINUTE,
			scope: "route_rate",
		},
		{ entity: "route", id: routeId, uid, name: "sendDay", limit: "routeDay", window: DAY, scope: "route_rate" },
		{
			entity: "account",
			id: uid,
			uid,
			name: "sendMinute",
			limit: "accountMinute",
			window: MINUTE,
			scope: "account_rate",
		},
		{ entity: "account", id: uid, uid, name: "sendDay", limit: "accountDay", window: DAY, scope: "account_rate" },
		{ entity: "ip", name: "sendMinute", limit: "ipMinute", window: MINUTE, scope: "ip_rate" },
		{ entity: "ip", name: "sendDay", limit: "ipDay", window: DAY, scope: "ip_rate" },
		{ entity: "global", name: "sendDay", limit: "relaySendDay", window: DAY, scope: "relay_capacity" },
	];
}

/** A replacement challenge is a new external challenge and consumes all applicable dimensions. */
export function challengeCharges(uid: string, newAccount: boolean, replacing = false): Charge[] {
	const charges: Charge[] = [
		{
			entity: "account",
			id: uid,
			uid,
			name: "challengeHour",
			limit: "accountChallengeHour",
			window: 60 * MINUTE,
			scope: "challenge_rate",
		},
		{
			entity: "account",
			id: uid,
			uid,
			name: "challengeDay",
			limit: "accountChallengeDay",
			window: DAY,
			scope: "challenge_rate",
		},
		{ entity: "ip", name: "challengeHour", limit: "ipChallengeHour", window: 60 * MINUTE, scope: "challenge_rate" },
		{ entity: "ip", name: "challengeDay", limit: "ipChallengeDay", window: DAY, scope: "challenge_rate" },
		{ entity: "global", name: "challengeDay", limit: "relayChallengeDay", window: DAY, scope: "relay_capacity" },
	];
	if (!replacing)
		charges.push({
			entity: "account",
			id: uid,
			uid,
			name: "enrollmentDay",
			limit: "enrollmentDay",
			window: DAY,
			scope: "enrollment_rate",
		});
	if (newAccount)
		charges.push(
			{ entity: "ip", name: "newAccountDay", limit: "newAccountIpDay", window: DAY, scope: "enrollment_capacity" },
			{ entity: "global", name: "newAccountDay", limit: "newAccountDay", window: DAY, scope: "enrollment_capacity" },
		);
	return charges;
}
