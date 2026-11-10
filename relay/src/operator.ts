import { createStore, type ControlDocument } from "./documents";
import { queueAccountCleanup, resumeAccountCleanup } from "./cleanup";
import { removeInstallation } from "./installations";
import { readControl } from "./control";
import { windowStart } from "./budgets";
import { DAY } from "./ports";
import type { Dependencies } from "./ports";
import { requireCondition } from "./validation";

/** Disable the marker before Auth or relay cleanup, so an outage never leaves sending authority enabled. */
export async function disableAccount(deps: Dependencies, uid: string): Promise<boolean> {
	await queueAccountCleanup(deps, uid, "disable");
	return resumeAccountCleanup(deps, uid);
}

/** Re-enable only fully cleaned disabled accounts; no installation, route or old credential is restored. */
export async function enableAccount(deps: Dependencies, uid: string): Promise<void> {
	const store = createStore(deps.firestore);
	requireCondition(!(await store.accountCleanup.doc(uid).get()).exists, 409, "cleanup_pending");
	const marker = (await store.accounts.doc(uid).get()).data();
	requireCondition(marker?.state === "disabled", 409, "account_not_disabled");
	requireCondition(marker.cleanupComplete === true, 409, "cleanup_pending");
	await deps.auth.updateUser(uid, { disabled: false });
	/** Recheck cleanup state at commit; a concurrent disable cannot be overwritten by this operator action. */
	await deps.firestore.runTransaction(async (transaction) => {
		const [account, work] = await Promise.all([
			transaction.get(store.accounts.doc(uid)),
			transaction.get(store.accountCleanup.doc(uid)),
		]);
		requireCondition(account.data()?.state === "disabled" && !work.exists, 409, "cleanup_pending");
		transaction.set(store.accounts.doc(uid), {
			uid,
			state: "active",
			createdAt: deps.now(),
			phoneAllowance: 3,
			routeAllowance: 24,
			phones: {},
			routes: {},
		});
	});
}

/** Remove only the selected installation, preserving all other phones and account abuse counters. */
export async function disablePhone(deps: Dependencies, uid: string, installationId: string): Promise<void> {
	await removeInstallation(deps, createStore(deps.firestore), uid, { installationId });
}

/** Create paused control exactly once; never overwrite switches or reset an existing operator's limits. */
export async function seedRelayControl(deps: Dependencies): Promise<void> {
	const ref = createStore(deps.firestore).control.doc("settings");
	/** Concurrent seeders have one winner, without reviving an existing installation. */
	await deps.firestore.runTransaction(async (transaction) => {
		requireCondition(!(await transaction.get(ref)).exists, 409, "control_already_exists");
		transaction.create(ref, { enabled: false, enrollmentEnabled: false });
	});
}

/** Operator erasure has no recent-auth requirement but uses the identical durable relay-before-Auth cascade. */
export async function eraseAccount(deps: Dependencies, uid: string): Promise<boolean> {
	await queueAccountCleanup(deps, uid, "delete");
	return resumeAccountCleanup(deps, uid);
}

/** A bounded consistent snapshot, never account identities, tokens, rotating keys or individual quota buckets. */
export async function operatorStatus(deps: Dependencies) {
	const store = createStore(deps.firestore);
	const now = deps.now();
	const day = windowStart(now, DAY);
	return deps.firestore.runTransaction(async (transaction) => {
		const control = await readControl(store, transaction);
		const [runtimeSnapshot, globalSnapshot] = await Promise.all([
			transaction.get(store.runtime.doc("state")),
			transaction.get(store.rateLimits.doc("global")),
		]);
		const runtime = runtimeSnapshot.data();
		const global = globalSnapshot.data();
		const count = (name: string) => (global?.windows[name]?.startedAt === day ? global.windows[name].count : 0);
		return {
			...control,
			utcDay: new Date(day).toISOString().slice(0, 10),
			counters: {
				sendAttempts: count("sendDay"),
				challenges: count("challengeDay"),
				newAccounts: count("newAccountDay"),
			},
			capacity: {
				accountSlots: Object.keys(runtime?.accounts ?? {}).length,
				phoneSlots: Object.values(runtime?.phones ?? {}).filter((phone) => phone.deadline === 0 || phone.deadline > now)
					.length,
			},
		};
	});
}

/** Change only validated settings; absent switches stay paused and malformed/unknown limits fail closed. */
export async function setRelayControl(deps: Dependencies, patch: ControlDocument): Promise<void> {
	const store = createStore(deps.firestore);
	requireCondition(Object.keys(patch).every((key) => ["enabled", "enrollmentEnabled", "limits"].includes(key)));
	/** Preserve concurrent operator settings while applying validated switches/limit overrides together. */
	await deps.firestore.runTransaction(async (transaction) => {
		const current = (await transaction.get(store.control.doc("settings"))).data() ?? {};
		const next = { ...current, ...patch, limits: { ...current.limits, ...patch.limits } };
		const { DEFAULT_LIMITS } = await import("./limits");
		for (const [key, value] of Object.entries(next.limits)) {
			requireCondition(Object.hasOwn(DEFAULT_LIMITS, key) && Number.isSafeInteger(value) && value >= 0);
		}
		if (next.enabled !== undefined) requireCondition(typeof next.enabled === "boolean");
		if (next.enrollmentEnabled !== undefined) requireCondition(typeof next.enrollmentEnabled === "boolean");
		transaction.set(store.control.doc("settings"), next);
	});
	await readControl(store);
}
