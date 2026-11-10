import { Timestamp, type Query } from "firebase-admin/firestore";
import { createStore, type CleanupDocument, type CleanupPhase, type RelayStore } from "./documents";
import { recordRouteRevocation } from "./delete";
import { DAY, MINUTE, type Dependencies } from "./ports";
import { requireCondition } from "./validation";

const PHASES: CleanupPhase[] = [
	"auth_disable",
	"routes",
	"installations",
	"challenges",
	"operations",
	"attempts",
	"owners",
	"counters",
	"auth_delete",
	"finish",
];
function nextPhase(work: CleanupDocument): CleanupPhase {
	let index = PHASES.indexOf(work.phase) + 1;
	if (work.mode === "disable" && PHASES[index] === "counters") index += 2;
	return PHASES[index];
}
function missingUser(error: unknown): boolean {
	return (error as { code?: string }).code === "auth/user-not-found";
}

/** Block authority before cleanup starts; repeated requests reuse durable work and deletion dominates disable. */
export async function queueAccountCleanup(
	deps: Dependencies,
	uid: string,
	mode: "disable" | "delete",
	operationId = deps.random(16),
): Promise<void> {
	const store = createStore(deps.firestore);
	/** The account marker and work item commit together; every send/enrollment observes the marker immediately. */
	await deps.firestore.runTransaction(async (transaction) => {
		const [accountSnapshot, workSnapshot] = await Promise.all([
			transaction.get(store.accounts.doc(uid)),
			transaction.get(store.accountCleanup.doc(uid)),
		]);
		const account = accountSnapshot.data();
		const work = workSnapshot.data();
		if (work?.mode === "delete" || work?.mode === mode) return;
		const created = account ?? {
			uid,
			state: "active" as const,
			createdAt: deps.now(),
			phoneAllowance: 3,
			routeAllowance: 24,
			phones: {},
			routes: {},
		};
		transaction.set(store.accounts.doc(uid), {
			...created,
			state: mode === "delete" ? "deleting" : "disabled",
			cleanupComplete: false,
		});
		transaction.set(store.accountCleanup.doc(uid), {
			uid,
			operationId,
			mode,
			phase: mode === "disable" ? "auth_disable" : "routes",
			purgeAt: Timestamp.fromMillis(deps.now() + 30 * DAY),
		});
	});
}

/** Resume bounded, leased cleanup phases; an outage/crash leaves a blocked account and durable retryable work. */
export async function resumeAccountCleanup(deps: Dependencies, uid: string): Promise<boolean> {
	const store = createStore(deps.firestore);
	const owner = deps.random(16);
	const workRef = store.accountCleanup.doc(uid);
	/** Only one worker owns a phase lease; a killed process can be replaced after sixty seconds. */
	const acquired = await deps.firestore.runTransaction(async (transaction) => {
		const work = (await transaction.get(workRef)).data();
		if (!work) return "absent";
		if (work.leaseUntil && work.leaseUntil > deps.now()) return "busy";
		transaction.update(workRef, { leaseOwner: owner, leaseUntil: deps.now() + MINUTE });
		return "acquired";
	});
	if (acquired !== "acquired") return acquired === "absent";
	try {
		for (let step = 0; step < 100; step++) {
			const work = (await workRef.get()).data();
			if (!work) return true;
			if (work.leaseOwner !== owner) return false;
			await deps.checkpoint?.(work.phase);
			if (work.phase === "auth_disable") {
				try {
					await deps.auth.updateUser(uid, { disabled: true });
					await deps.auth.revokeRefreshTokens(uid);
				} catch (error) {
					if (!missingUser(error)) throw error;
				}
			} else if (work.phase === "auth_delete") {
				try {
					await deps.auth.deleteUser(uid);
				} catch (error) {
					if (!missingUser(error)) throw error;
				}
			}
			const complete = await cleanupPhase(deps, store, work, owner);
			if (complete) return true;
		}
	} catch {
		// Fixed pending status only: never log a UID, provider error, token or cleanup payload.
	} finally {
		/** Release only our own lease; never clear a lease or phase installed by a newer cleanup operation. */
		await deps.firestore.runTransaction(async (transaction) => {
			const work = (await transaction.get(workRef)).data();
			if (work?.leaseOwner === owner) transaction.update(workRef, { leaseUntil: 0 });
		});
	}
	return false;
}

async function cleanupPhase(
	deps: Dependencies,
	store: RelayStore,
	expected: CleanupDocument,
	owner: string,
): Promise<boolean> {
	/** Erase one bounded batch and advance its phase atomically; repeating a committed phase is harmless. */
	return deps.firestore.runTransaction(async (transaction) => {
		const workRef = store.accountCleanup.doc(expected.uid);
		const work = (await transaction.get(workRef)).data();
		requireCondition(work?.operationId === expected.operationId && work.leaseOwner === owner, 409, "cleanup_busy");
		if (work.phase === "finish") {
			const runtime = (await transaction.get(store.runtime.doc("state"))).data();
			if (runtime) {
				delete runtime.accounts[work.uid];
				runtime.phones = Object.fromEntries(
					Object.entries(runtime.phones).filter(([, phone]) => phone.uid !== work.uid),
				);
				transaction.set(store.runtime.doc("state"), runtime);
			}
			if (work.mode === "delete") transaction.delete(store.accounts.doc(work.uid));
			else
				transaction.set(store.accounts.doc(work.uid), {
					uid: work.uid,
					state: "disabled",
					cleanupComplete: true,
				});
			transaction.delete(workRef);
			return true;
		}
		let fullBatch = false;
		if (work.phase === "routes") {
			const rows = await transaction.get(store.routes.where("uid", "==", work.uid).limit(50));
			for (const row of rows.docs) recordRouteRevocation(store, transaction, row.id, row.data());
			fullBatch = rows.size === 50;
		} else {
			const collections = {
				installations: store.installations,
				challenges: store.challenges,
				operations: store.challengeOperations,
				attempts: store.sendAttempts,
				owners: store.tokenOwners,
				counters: store.rateLimits,
			};
			if (work.phase in collections) {
				const collection = collections[work.phase as keyof typeof collections];
				const query = collection.where("uid", "==", work.uid).limit(50) as Query<{ uid?: string }>;
				const rows = await transaction.get(query);
				for (const row of rows.docs) transaction.delete(row.ref);
				fullBatch = rows.size === 50;
			}
		}
		transaction.update(workRef, { phase: fullBatch ? work.phase : nextPhase(work), leaseUntil: deps.now() + MINUTE });
		return false;
	});
}
