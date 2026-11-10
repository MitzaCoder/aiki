import { prepareBudgets } from "./budgets";
import { requireRelayEnabled } from "./control";
import { Timestamp } from "firebase-admin/firestore";
import type { RelayStore, RouteDocument } from "./documents";
import { pruneReservations, requireActiveAccount, requireOwnedInstallation, requireOwnedRoute } from "./admission";
import { DAY, MINUTE, type Dependencies, type RelayResponseBody } from "./ports";
import { constantTimeHashEqual, parseObject, requireCondition, requireDigest, requireId } from "./validation";
interface RouteInput {
	installationId: string;
	routeId: string;
	operationId?: string;
	sendHash?: string;
	deleteHash?: string;
	predecessorId?: string;
}
function parseRouteInput(raw: unknown, create: boolean): RouteInput {
	const input = parseObject(
		raw,
		create ? ["installationId", "routeId", "operationId", "sendHash", "deleteHash"] : ["installationId", "routeId"],
		create ? ["predecessorId"] : [],
	);
	requireId(input.installationId);
	requireId(input.routeId);
	if (!create) return { installationId: input.installationId, routeId: input.routeId };
	requireId(input.operationId);
	requireDigest(input.sendHash);
	requireDigest(input.deleteHash);
	if (input.predecessorId !== undefined) requireId(input.predecessorId);
	return {
		installationId: input.installationId,
		routeId: input.routeId,
		operationId: input.operationId,
		sendHash: input.sendHash,
		deleteHash: input.deleteHash,
		predecessorId: input.predecessorId,
	};
}
function routeResponse(routeId: string, route: RouteDocument): RelayResponseBody {
	return {
		routeId,
		state: route.state,
		leaseExpiresAt: route.leaseExpiresAt,
		absoluteExpiresAt: route.absoluteExpiresAt,
	};
}
/** Create, activate or renew phone-owned routes while preserving capacity and absolute lease bounds. */
export async function manageRoute(
	deps: Dependencies,
	store: RelayStore,
	uid: string,
	action: "create" | "activate" | "renew",
	raw: unknown,
	clientIp: string,
): Promise<RelayResponseBody> {
	const input = parseRouteInput(raw, action === "create");
	const now = deps.now();
	const routeRef = store.routes.doc(input.routeId);
	/** Serialize account capacity, one successor per predecessor, and activation that disables the predecessor. */
	return deps.firestore.runTransaction(async (transaction) => {
		const [accountSnapshot, installationSnapshot, routeSnapshot, revocationSnapshot] = await Promise.all([
			transaction.get(store.accounts.doc(uid)),
			transaction.get(store.installations.doc(input.installationId)),
			transaction.get(routeRef),
			transaction.get(store.routeRevocations.doc(input.routeId)),
		]);
		const account = accountSnapshot.data();
		const installation = installationSnapshot.data();
		const route = routeSnapshot.data();
		requireActiveAccount(account);
		pruneReservations(account, now);
		requireOwnedInstallation(installation, uid);
		if (action === "create" && route) {
			requireOwnedRoute(route, uid, input.installationId);
			requireCondition(
				route.operationId === input.operationId &&
					constantTimeHashEqual(route.sendHash, input.sendHash!) &&
					constantTimeHashEqual(route.deleteHash, input.deleteHash!) &&
					route.predecessorId === (input.predecessorId ?? null),
				409,
				"operation_conflict",
			);
			return routeResponse(input.routeId, route);
		}
		const budgets = await prepareBudgets(deps, store, transaction, clientIp, [], { requireEnabled: true });
		requireRelayEnabled(budgets.control);
		requireCondition(installation.state === "active", 409, "installation_inactive");
		if (action === "create") {
			requireCondition(!revocationSnapshot.exists, 410, "route_inactive");
			const entries = Object.values(account.routes);
			let predecessor: RouteDocument | undefined;
			if (input.predecessorId) {
				predecessor = (await transaction.get(store.routes.doc(input.predecessorId))).data();
				requireOwnedRoute(predecessor, uid, input.installationId);
				requireCondition(
					predecessor.state === "active" &&
						predecessor.leaseExpiresAt > now &&
						!entries.some((entry) => entry.predecessorId === input.predecessorId),
					409,
					"route_limit",
				);
				requireCondition(
					entries.filter((entry) => entry.predecessorId).length < budgets.control.limits.accountRoutes,
					409,
					"route_limit",
				);
			} else {
				const reserved = entries.filter((entry) => !entry.predecessorId);
				requireCondition(
					reserved.length < budgets.control.limits.accountRoutes &&
						reserved.filter((entry) => entry.installationId === input.installationId).length <
							budgets.control.limits.phoneRoutes,
					409,
					"route_limit",
				);
			}
			const created: RouteDocument = {
				uid,
				installationId: input.installationId,
				operationId: input.operationId!,
				sendHash: input.sendHash!,
				deleteHash: input.deleteHash!,
				predecessorId: input.predecessorId ?? null,
				state: "pending",
				createdAt: now,
				pendingUntil: now + 10 * MINUTE,
				leaseExpiresAt: now + 30 * DAY,
				absoluteExpiresAt: now + 90 * DAY,
				generation: (predecessor?.generation ?? 0) + 1,
				purgeAt: Timestamp.fromMillis(now + 31 * DAY),
			};
			account.routes[input.routeId] = {
				installationId: input.installationId,
				deadline: created.pendingUntil,
				predecessorId: created.predecessorId,
			};
			budgets.commit();
			transaction.set(routeRef, created);
			transaction.update(store.installations.doc(input.installationId), { hadRoutes: true });
			transaction.set(store.accounts.doc(uid), { ...account, lastManagementAt: now });
			return routeResponse(input.routeId, created);
		}
		requireOwnedRoute(route, uid, input.installationId);
		requireCondition(route.leaseExpiresAt > now && route.absoluteExpiresAt > now, 410, "route_expired");
		if (action === "activate" && route.state === "active") return routeResponse(input.routeId, route);
		if (action === "activate") {
			requireCondition(route.state === "pending" && route.pendingUntil > now, 409, "route_inactive");
			if (route.predecessorId) {
				const predecessorRef = store.routes.doc(route.predecessorId);
				const predecessor = (await transaction.get(predecessorRef)).data();
				requireOwnedRoute(predecessor, uid, input.installationId);
				requireCondition(predecessor.state === "active", 409, "route_inactive");
				delete account.routes[route.predecessorId];
				transaction.set(predecessorRef, {
					...predecessor,
					state: "disabled",
					purgeAt: Timestamp.fromMillis(now + DAY),
				});
			}
			route.state = "active";
			transaction.update(routeRef, { state: "active" });
		} else {
			requireCondition(route.state === "active", 409, "route_inactive");
			route.leaseExpiresAt =
				route.leaseExpiresAt - now < 7 * DAY ? Math.min(now + 30 * DAY, route.absoluteExpiresAt) : route.leaseExpiresAt;
			transaction.update(routeRef, {
				leaseExpiresAt: route.leaseExpiresAt,
				purgeAt: Timestamp.fromMillis(route.leaseExpiresAt + DAY),
			});
		}
		budgets.commit();
		account.routes[input.routeId] = {
			installationId: input.installationId,
			deadline: route.leaseExpiresAt,
			predecessorId: null,
		};
		transaction.set(store.accounts.doc(uid), { ...account, lastManagementAt: now });
		return routeResponse(input.routeId, route);
	});
}
