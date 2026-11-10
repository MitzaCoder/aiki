import { createStore, type ControlDocument } from "./documents";
import { queueAccountCleanup, resumeAccountCleanup } from "./cleanup";
import { removeInstallation } from "./installations";
import { readControl } from "./control";
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

/** Change only validated settings; missing settings use defaults and unknown or malformed limits fail closed. */
export async function setRelayControl(deps: Dependencies, patch: ControlDocument): Promise<void> {
	const store = createStore(deps.firestore);
	requireCondition(Object.keys(patch).every((key) => ["enabled", "enrollmentEnabled", "limits"].includes(key)));
	/** Preserve concurrent operator settings while applying validated switches/limit overrides together. */
	await deps.firestore.runTransaction(async (transaction) => {
		const current = (await transaction.get(store.control.doc("settings"))).data() ?? {};
		const next = { ...current, ...patch, limits: { ...current.limits, ...patch.limits } };
		const { DEFAULT_LIMITS } = await import("./limits");
		for (const [key, value] of Object.entries(next.limits)) {
			requireCondition(key in DEFAULT_LIMITS && Number.isSafeInteger(value) && value >= 0);
		}
		if (next.enabled !== undefined) requireCondition(typeof next.enabled === "boolean");
		if (next.enrollmentEnabled !== undefined) requireCondition(typeof next.enrollmentEnabled === "boolean");
		transaction.set(store.control.doc("settings"), next);
	});
	await readControl(store);
}
