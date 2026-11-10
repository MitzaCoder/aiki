import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { requireActiveAccount, requireOwnedRoute } from "./admission";
import type { RelayStore, RouteDocument } from "./documents";
import { DAY, type CoreRequest, type Dependencies } from "./ports";
import { constantTimeHashEqual, parseCapability, parseObject, requireCondition, requireId } from "./validation";
/** Erase route credentials; a secret-free revocation marker only prevents stale create retries from reviving it. */
export function recordRouteRevocation(
	store: RelayStore,
	transaction: Transaction,
	routeId: string,
	route: RouteDocument,
): void {
	transaction.delete(store.routes.doc(routeId));
	transaction.set(store.routeRevocations.doc(routeId), {
		purgeAt: Timestamp.fromMillis(route.absoluteExpiresAt + DAY),
	});
}
/** Delete using only a well-formed delete capability; absent routes require neither lookup authority nor Auth. */
export async function deleteByCapability(
	deps: Dependencies,
	store: RelayStore,
	request: CoreRequest,
	raw: unknown,
): Promise<void> {
	const credential = parseCapability(request.authorization, "delete");
	const input = parseObject(raw, ["routeId"]);
	requireId(input.routeId);
	requireCondition(credential.routeId === input.routeId, 404, "not_found");
	/** Authenticate existing routes and atomically erase credentials/release capacity; absent routes write nothing. */
	await deps.firestore.runTransaction(async (transaction) => {
		const route = (await transaction.get(store.routes.doc(credential.routeId))).data();
		if (!route) return;
		requireCondition(constantTimeHashEqual(route.deleteHash, credential.digest), 404, "not_found");
		const account = (await transaction.get(store.accounts.doc(route.uid))).data();
		if (account?.state === "active") {
			delete account.routes[credential.routeId];
			transaction.set(store.accounts.doc(route.uid), account);
		}
		recordRouteRevocation(store, transaction, credential.routeId, route);
	});
}
/** Delete a phone-owned route idempotently, retaining no delete credential for future retries. */
export async function deleteOwnedRoute(
	deps: Dependencies,
	store: RelayStore,
	uid: string,
	raw: unknown,
): Promise<void> {
	const input = parseObject(raw, ["installationId", "routeId"]);
	requireId(input.installationId);
	requireId(input.routeId);
	const { installationId, routeId } = input;
	/** Verify owning account before erasing an existing route; absent routes already satisfy deletion. */
	await deps.firestore.runTransaction(async (transaction) => {
		const [accountSnapshot, routeSnapshot] = await Promise.all([
			transaction.get(store.accounts.doc(uid)),
			transaction.get(store.routes.doc(routeId)),
		]);
		const account = accountSnapshot.data();
		const route = routeSnapshot.data();
		requireActiveAccount(account);
		if (!route) return;
		requireOwnedRoute(route, uid, installationId);
		delete account.routes[routeId];
		transaction.set(store.accounts.doc(uid), account);
		recordRouteRevocation(store, transaction, routeId, route);
	});
}
