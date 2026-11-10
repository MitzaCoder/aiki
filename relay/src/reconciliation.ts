import { Timestamp } from "firebase-admin/firestore";
import { windowStart } from "./budgets";
import { queueAccountCleanup, resumeAccountCleanup } from "./cleanup";
import { createStore } from "./documents";
import { recordRouteRevocation } from "./delete";
import { pruneReservations } from "./admission";
import { DAY, type Dependencies } from "./ports";

/** Reconcile Auth state and resume durable cleanup; expiry is checked in code, not delegated to eventual TTL. */
export async function reconcileRelay(deps: Dependencies): Promise<void> {
	const store = createStore(deps.firestore);
	const accounts = await store.accounts.get();
	for (const row of accounts.docs) {
		const account = row.data();
		let mode: "disable" | "delete" | undefined =
			account.state === "deleting"
				? "delete"
				: account.state === "disabled" && !account.cleanupComplete
					? "disable"
					: undefined;
		try {
			const user = await deps.auth.getUser(row.id);
			if (user.disabled && !(account.state === "disabled" && account.cleanupComplete)) mode ??= "disable";
		} catch (error) {
			if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
			mode = "delete";
		}
		if (mode) await queueAccountCleanup(deps, row.id, mode);
	}
	for (const work of (await store.accountCleanup.get()).docs) await resumeAccountCleanup(deps, work.id);
	for (const row of (await store.routes.get()).docs) {
		/** Expire only the generation observed in this transaction; activation/renewal races are re-read. */
		await deps.firestore.runTransaction(async (transaction) => {
			const route = (await transaction.get(row.ref)).data();
			if (!route) return;
			const now = deps.now();
			if (
				route.leaseExpiresAt <= now ||
				route.absoluteExpiresAt <= now ||
				(route.state === "pending" && route.pendingUntil <= now) ||
				route.purgeAt.toMillis() <= now
			) {
				recordRouteRevocation(store, transaction, row.id, route);
			}
		});
	}
	for (const row of (await store.installations.get()).docs) {
		const installation = row.data();
		const routes = await store.routes.where("installationId", "==", row.id).limit(1).get();
		const expired = installation.state === "pending" && (installation.deadline ?? 0) <= deps.now();
		if (
			expired ||
			(installation.purgeAt && installation.purgeAt.toMillis() <= deps.now()) ||
			(routes.empty && (installation.hadRoutes || installation.createdAt + 30 * DAY <= deps.now()))
		) {
			/** Remove only a still-expired installation and its exact ownership generation. */
			await deps.firestore.runTransaction(async (transaction) => {
				const current = (await transaction.get(row.ref)).data();
				if (
					!current ||
					current.generation !== installation.generation ||
					current.challengeDeadline !== installation.challengeDeadline
				)
					return;
				const currentRoutes = await transaction.get(store.routes.where("installationId", "==", row.id).limit(1));
				const stillExpired =
					(current.state === "pending" && (current.deadline ?? 0) <= deps.now()) ||
					(current.purgeAt && current.purgeAt.toMillis() <= deps.now()) ||
					(currentRoutes.empty && (current.hadRoutes || current.createdAt + 30 * DAY <= deps.now()));
				if (!stillExpired) return;
				const [challenges, operations] = await Promise.all([
					transaction.get(store.challenges.where("installationId", "==", row.id)),
					transaction.get(store.challengeOperations.where("installationId", "==", row.id)),
				]);
				const ownerRef = current.tokenHash ? store.tokenOwners.doc(current.tokenHash) : undefined;
				const owner = ownerRef ? (await transaction.get(ownerRef)).data() : undefined;
				if (ownerRef && owner?.installationId === row.id && owner.generation === current.generation)
					transaction.delete(ownerRef);
				for (const challenge of challenges.docs) transaction.delete(challenge.ref);
				for (const operation of operations.docs) transaction.delete(operation.ref);
				transaction.delete(row.ref);
			});
		}
	}
	for (const row of (await store.tokenOwners.get()).docs) {
		/** Ownership cleanup cannot erase a concurrent completed possession transfer. */
		await deps.firestore.runTransaction(async (transaction) => {
			const owner = (await transaction.get(row.ref)).data();
			if (!owner) return;
			const installation = (await transaction.get(store.installations.doc(owner.installationId))).data();
			if (
				!installation ||
				installation.state !== "active" ||
				installation.tokenHash !== row.id ||
				installation.generation !== owner.generation
			)
				transaction.delete(row.ref);
		});
	}
	for (const collection of [
		store.challenges,
		store.challengeOperations,
		store.sendAttempts,
		store.rateLimits,
		store.routeRevocations,
	]) {
		const due =
			collection.id === "challenges"
				? await store.challenges.where("deadline", "<=", deps.now()).get()
				: await collection.where("purgeAt", "<=", Timestamp.fromMillis(deps.now())).get();
		for (const row of due.docs) {
			/** TTL reconciliation re-reads to avoid deleting a renewed reservation or a new quota window. */
			await deps.firestore.runTransaction(async (transaction) => {
				const current = (await transaction.get(row.ref)).data();
				if (
					current &&
					(current.purgeAt.toMillis() <= deps.now() ||
						("deadline" in current &&
							typeof current.deadline === "number" &&
							current.deadline <= deps.now() &&
							collection.id === "challenges"))
				) {
					transaction.delete(row.ref);
				}
			});
		}
	}
	for (const row of (await store.accounts.get()).docs) {
		/** Prune bounded reservation maps against the current installation set without reviving disabled accounts. */
		await deps.firestore.runTransaction(async (transaction) => {
			const account = (await transaction.get(row.ref)).data();
			if (!account || account.state !== "active") return;
			const runtime = (await transaction.get(store.runtime.doc("state"))).data();
			const live = await transaction.get(store.installations.where("uid", "==", row.id));
			const ids = new Set(live.docs.map((installation) => installation.id));
			pruneReservations(account, deps.now());
			account.phones = Object.fromEntries(Object.entries(account.phones).filter(([id]) => ids.has(id)));
			transaction.set(row.ref, account);
			if (runtime) {
				const day = windowStart(deps.now(), DAY);
				if (runtime.ipDay !== day) {
					runtime.ipDay = day;
					runtime.ipKey = deps.random(32);
				}
				runtime.phones = Object.fromEntries(
					Object.entries(runtime.phones).filter(([id, phone]) => phone.uid !== row.id || ids.has(id)),
				);
				transaction.set(store.runtime.doc("state"), runtime);
			}
		});
	}
}
