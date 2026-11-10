import { Timestamp } from "firebase-admin/firestore";
import { pruneReservations, requireActiveAccount, requireOwnedInstallation } from "./admission";
import { recordRouteRevocation } from "./delete";
import type { RelayStore } from "./documents";
import { DAY, type Dependencies, type RelayResponseBody } from "./ports";
import { parseObject, requireId } from "./validation";
/** Return bounded account capacity or opaque installation inventory, never tokens or profile. */
export async function readAccountInventory(
	deps: Dependencies,
	store: RelayStore,
	uid: string,
	raw: unknown,
	list: boolean,
): Promise<RelayResponseBody> {
	parseObject(raw, []);
	const storedAccount = (await store.accounts.doc(uid).get()).data();
	if (storedAccount) requireActiveAccount(storedAccount);
	if (!storedAccount) {
		return list ? { installations: [] } : { state: "unenrolled", phones: 0, routes: 0, phoneLimit: 3, routeLimit: 24 };
	}
	const account = pruneReservations(storedAccount, deps.now());
	if (!list) {
		return {
			state: account.state,
			phones: Object.keys(account.phones).length,
			routes: Object.keys(account.routes).length,
			phoneLimit: 3,
			routeLimit: 24,
		};
	}
	const snapshots = await Promise.all(Object.keys(account.phones).map((id) => store.installations.doc(id).get()));
	return {
		installations: snapshots.flatMap((snapshot) => {
			const installation = snapshot.data();
			if (!installation || installation.uid !== uid) return [];
			return [
				{
					installationId: snapshot.id,
					state: installation.state,
					createdAt: installation.createdAt,
					lastManagementAt: installation.lastManagementAt ?? null,
				},
			];
		}),
	};
}
/** Remove one account-owned installation without touching other phones, tokens or routes. */
export async function removeInstallation(
	deps: Dependencies,
	store: RelayStore,
	uid: string,
	raw: unknown,
): Promise<void> {
	const input = parseObject(raw, ["installationId"]);
	requireId(input.installationId);
	const { installationId } = input;
	/** Serialize confirm/create against removal, erase token ownership and cascade the phone's bounded routes. */
	await deps.firestore.runTransaction(async (transaction) => {
		const [accountSnapshot, installationSnapshot] = await Promise.all([
			transaction.get(store.accounts.doc(uid)),
			transaction.get(store.installations.doc(installationId)),
		]);
		const account = accountSnapshot.data();
		const installation = installationSnapshot.data();
		requireActiveAccount(account);
		requireOwnedInstallation(installation, uid);
		const [routes, challenges, operations] = await Promise.all([
			transaction.get(store.routes.where("installationId", "==", installationId)),
			transaction.get(store.challenges.where("installationId", "==", installationId)),
			transaction.get(store.challengeOperations.where("installationId", "==", installationId)),
		]);
		const tokenOwnerRef = installation.tokenHash ? store.tokenOwners.doc(installation.tokenHash) : undefined;
		const tokenOwner = tokenOwnerRef ? (await transaction.get(tokenOwnerRef)).data() : undefined;
		for (const route of routes.docs) {
			recordRouteRevocation(store, transaction, route.id, route.data());
			delete account.routes[route.id];
		}
		for (const challenge of challenges.docs) transaction.delete(challenge.ref);
		for (const operation of operations.docs) transaction.delete(operation.ref);
		if (tokenOwnerRef && tokenOwner?.installationId === installationId) transaction.delete(tokenOwnerRef);
		delete account.phones[installationId];
		transaction.set(store.accounts.doc(uid), account);
		transaction.set(store.installations.doc(installationId), {
			uid,
			state: "deleted",
			generation: installation.generation,
			createdAt: installation.createdAt,
			purgeAt: Timestamp.fromMillis(deps.now() + DAY),
		});
	});
}
