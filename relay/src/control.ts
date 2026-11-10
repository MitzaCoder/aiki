import type { Transaction } from "firebase-admin/firestore";
import type { RelayStore } from "./documents";
import { DEFAULT_LIMITS, type Limits } from "./limits";
import type { Dependencies } from "./ports";
import { RelayError } from "./validation";

export interface RelayControl {
	enabled: boolean;
	enrollmentEnabled: boolean;
	limits: Limits;
}

/** Missing switches are paused; only numeric limits have defaults. Read/parse failures never become permission. */
export async function readControl(store: RelayStore, transaction?: Transaction): Promise<RelayControl> {
	const ref = store.control.doc("settings");
	const control = (transaction ? await transaction.get(ref) : await ref.get()).data();
	for (const key of Object.keys(control?.limits ?? {})) {
		if (!Object.hasOwn(DEFAULT_LIMITS, key)) throw new Error("Unknown relay limit");
	}
	return {
		enabled: control?.enabled ?? false,
		enrollmentEnabled: control?.enrollmentEnabled ?? false,
		limits: { ...DEFAULT_LIMITS, ...control?.limits },
	};
}

/** The kill switch is checked transactionally and again immediately before handing bytes to FCM. */
export function requireRelayEnabled(control: RelayControl): void {
	if (!control.enabled) throw new RelayError(503, "relay_disabled");
}

/** Recheck uncached control and account state immediately before an external attempt. */
export async function requireExternalPermission(deps: Dependencies, store: RelayStore, uid: string): Promise<void> {
	requireRelayEnabled(await readControl(store));
	const account = (await store.accounts.doc(uid).get()).data();
	if (!account || account.state !== "active") throw new RelayError(403, "account_disabled");
}
