import { Timestamp } from "firebase-admin/firestore";
import type { AccountDocument, InstallationDocument, RelayStore } from "./documents";
import { pruneReservations, requireActiveAccount, requireLiveAuthUser, requireOwnedInstallation } from "./admission";
import { DAY, MINUTE, type Dependencies, type RelayResponseBody } from "./ports";
import {
	parseObject,
	requireCondition,
	requireId,
	requireFcmToken,
	isBase64url,
	constantTimeHashEqual,
	sha256,
} from "./validation";
/** Reserve one challenge per phone; a new operation replaces the prior challenge without storing its nonce. */
export async function beginInstallation(
	deps: Dependencies,
	store: RelayStore,
	uid: string,
	raw: unknown,
	replacing: boolean,
): Promise<RelayResponseBody> {
	const input = parseObject(raw, ["installationId", "operationId", "token"]);
	requireId(input.installationId);
	requireId(input.operationId);
	requireFcmToken(input.token);
	const { installationId, operationId, token } = input;
	const now = deps.now();
	const installationRef = store.installations.doc(installationId);
	const challengeRef = store.challenges.doc(installationId + "_" + operationId);
	const operationRef = store.challengeOperations.doc(installationId + "_" + operationId);
	const challengeId = deps.random(16);
	const nonce = deps.random(32);
	const tokenHash = sha256(token);
	/** Serialize phone capacity, operation idempotency and replacement so only one pending challenge can confirm. */
	const outcome = await deps.firestore.runTransaction(async (transaction) => {
		const [accountSnapshot, installationSnapshot, operationSnapshot] = await Promise.all([
			transaction.get(store.accounts.doc(uid)),
			transaction.get(installationRef),
			transaction.get(operationRef),
		]);
		const storedAccount = accountSnapshot.data();
		const installation = installationSnapshot.data();
		if (storedAccount) requireActiveAccount(storedAccount);
		const account = pruneReservations(storedAccount ?? newAccount(uid, now), now);
		if (installation) requireOwnedInstallation(installation, uid);
		const receipt = operationSnapshot.data();
		if (receipt) requireCondition(receipt.uid === uid, 404, "not_found");
		if (receipt) {
			requireCondition(receipt.tokenHash === tokenHash && receipt.replacing === replacing, 409, "operation_conflict");
			return { challengeId: receipt.challengeId, deadline: receipt.deadline, send: false };
		}
		requireCondition(!installation?.completedOperations?.includes(operationId), 409, "operation_conflict");
		if (replacing) {
			requireCondition(
				installation?.state === "active" || installation?.state === "token_invalid",
				409,
				"installation_inactive",
			);
		} else {
			requireCondition(!installation || installation.state === "pending", 409, "installation_exists");
		}
		const pendingOthers = Object.entries(account.phones).filter(
			([id, reservation]) => id !== installationId && reservation.challengeDeadline > now,
		).length;
		requireCondition(pendingOthers < 3, 409, "phone_limit");
		if (!replacing && !account.phones[installationId]) {
			requireCondition(Object.keys(account.phones).length < 3, 409, "phone_limit");
		}
		const deadline = now + 5 * MINUTE;
		account.phones[installationId] = { deadline: replacing ? 0 : deadline, challengeDeadline: deadline };
		if (installation?.pendingOperationId) {
			transaction.delete(store.challenges.doc(installationId + "_" + installation.pendingOperationId));
		}
		const pending: InstallationDocument = {
			...(installation ?? { uid, createdAt: now, generation: 0, state: "pending" }),
			...(!replacing ? { deadline } : {}),
			challengeDeadline: deadline,
			pendingOperationId: operationId,
		};
		transaction.set(store.accounts.doc(uid), { ...account, lastManagementAt: now });
		transaction.set(installationRef, pending);
		transaction.set(operationRef, {
			uid,
			installationId,
			tokenHash,
			replacing,
			challengeId,
			deadline,
			purgeAt: Timestamp.fromMillis(now + DAY),
		});
		transaction.set(challengeRef, {
			uid,
			installationId,
			operationId,
			replacing,
			challengeId,
			nonceHash: sha256(nonce),
			tokenHash,
			stagedToken: token,
			deadline,
			attempts: 0,
			purgeAt: Timestamp.fromMillis(now + DAY),
		});
		return { challengeId, deadline, send: true };
	});
	if (outcome.send) {
		await requireLiveAuthUser(deps, uid);
		requireActiveAccount((await store.accounts.doc(uid).get()).data());
		const installation = (await installationRef.get()).data();
		requireCondition(installation && installation.state !== "deleted", 409, "installation_inactive");
		try {
			await deps.send({
				token,
				priority: "normal",
				ttlMs: Math.max(0, outcome.deadline - deps.now()),
				data: {
					aiki: JSON.stringify({
						v: 1,
						type: "challenge",
						installationId,
						operationId,
						challengeId,
						nonce,
						deadline: outcome.deadline,
					}),
				},
			});
		} catch {
			// Ambiguous delivery grants no authority; a new operation can immediately challenge again.
		}
	}
	return { challengeId: outcome.challengeId, deadline: outcome.deadline };
}
/** Confirm possession atomically; receipt replays never reapply an earlier token-generation switch. */
export async function confirmInstallation(
	deps: Dependencies,
	store: RelayStore,
	uid: string,
	raw: unknown,
	replacing: boolean,
): Promise<RelayResponseBody> {
	const input = parseObject(raw, ["installationId", "operationId", "challengeId", "nonce"]);
	requireId(input.installationId);
	requireId(input.operationId);
	requireId(input.challengeId);
	requireCondition(isBase64url(input.nonce, 32));
	const { installationId, operationId, challengeId, nonce } = input;
	const now = deps.now();
	const installationRef = store.installations.doc(installationId);
	const challengeRef = store.challenges.doc(installationId + "_" + operationId);
	/** Bind every reply to UID/installation/operation, charge failed replies and transfer unique token ownership. */
	const result = await deps.firestore.runTransaction(async (transaction) => {
		const [accountSnapshot, installationSnapshot, challengeSnapshot] = await Promise.all([
			transaction.get(store.accounts.doc(uid)),
			transaction.get(installationRef),
			transaction.get(challengeRef),
		]);
		const account = accountSnapshot.data();
		const installation = installationSnapshot.data();
		const challenge = challengeSnapshot.data();
		requireActiveAccount(account);
		requireOwnedInstallation(installation, uid);
		if (!challenge) {
			const receipt = installation.confirmation;
			requireCondition(
				receipt &&
					receipt.operationId === operationId &&
					receipt.challengeId === challengeId &&
					constantTimeHashEqual(receipt.nonceHash, sha256(nonce)) &&
					receipt.replacing === replacing &&
					installation.state !== "deleted",
				409,
				"challenge_invalid",
			);
			return { generation: receipt.generation };
		}
		requireCondition(
			challenge.uid === uid && challenge.installationId === installationId && challenge.replacing === replacing,
			404,
			"not_found",
		);
		requireCondition(
			challenge.deadline > now &&
				challenge.attempts < 5 &&
				installation.state !== "deleted" &&
				installation.pendingOperationId === operationId,
			409,
			"challenge_expired",
		);
		if (challenge.challengeId !== challengeId || !constantTimeHashEqual(challenge.nonceHash, sha256(nonce))) {
			transaction.update(challengeRef, { attempts: challenge.attempts + 1 });
			return { error: true as const };
		}
		const tokenOwnerRef = store.tokenOwners.doc(challenge.tokenHash);
		const tokenOwner = (await transaction.get(tokenOwnerRef)).data();
		const formerRef =
			tokenOwner && tokenOwner.installationId !== installationId
				? store.installations.doc(tokenOwner.installationId)
				: undefined;
		const former = formerRef ? (await transaction.get(formerRef)).data() : undefined;
		const oldOwnerRef = installation.tokenHash ? store.tokenOwners.doc(installation.tokenHash) : undefined;
		const oldOwner = oldOwnerRef ? (await transaction.get(oldOwnerRef)).data() : undefined;
		requireCondition(account.phones[installationId], 409, "challenge_expired");
		const generation = installation.generation + 1;
		if (
			formerRef &&
			former &&
			former.tokenHash === challenge.tokenHash &&
			former.generation === tokenOwner?.generation
		) {
			transaction.set(formerRef, { ...former, token: null, tokenHash: null, state: "token_invalid" });
		}
		if (oldOwnerRef && oldOwner?.installationId === installationId && oldOwnerRef.path !== tokenOwnerRef.path) {
			transaction.delete(oldOwnerRef);
		}
		transaction.set(tokenOwnerRef, { uid, installationId, generation });
		const { pendingOperationId: _pendingOperationId, ...retained } = installation;
		transaction.set(installationRef, {
			...retained,
			state: "active",
			token: challenge.stagedToken,
			tokenHash: challenge.tokenHash,
			generation,
			deadline: 0,
			challengeDeadline: 0,
			lastManagementAt: now,
			confirmation: { operationId, challengeId, nonceHash: challenge.nonceHash, replacing, generation },
			completedOperations: [...(installation.completedOperations ?? []).slice(-31), operationId],
		});
		account.phones[installationId] = { deadline: 0, challengeDeadline: 0 };
		transaction.set(store.accounts.doc(uid), { ...account, lastManagementAt: now });
		transaction.delete(challengeRef);
		return { generation };
	});
	requireCondition(!result.error, 409, "challenge_invalid");
	return { installationId, generation: result.generation };
}
function newAccount(uid: string, now: number): AccountDocument {
	return { uid, state: "active", phones: {}, routes: {}, createdAt: now, phoneAllowance: 3, routeAllowance: 24 };
}
