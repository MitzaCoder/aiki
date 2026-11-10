import { createStore } from "./documents";
import { queueAccountCleanup, resumeAccountCleanup } from "./cleanup";
import type { Dependencies, EndpointResult, IdentityClaims } from "./ports";
import { parseObject, requireCondition, requireId } from "./validation";

/** Require recent verified identity, block the whole account, then report completion only after relay/Auth erasure. */
export async function deleteAccount(deps: Dependencies, claims: IdentityClaims, raw: unknown): Promise<EndpointResult> {
	const input = parseObject(raw, ["operationId"]);
	requireId(input.operationId);
	requireCondition(
		typeof claims.auth_time === "number" &&
			claims.auth_time * 1000 <= deps.now() &&
			deps.now() - claims.auth_time * 1000 <= 5 * 60_000,
		401,
		"recent_auth_required",
	);
	await queueAccountCleanup(deps, claims.uid, "delete", input.operationId);
	const complete = await resumeAccountCleanup(deps, claims.uid);
	if (complete) {
		const store = createStore(deps.firestore);
		requireCondition(
			!(await store.accounts.doc(claims.uid).get()).exists &&
				!(await store.accountCleanup.doc(claims.uid).get()).exists,
			503,
			"relay_unavailable",
		);
		return { status: 200, body: { state: "deleted", deletionPending: false } };
	}
	return { status: 202, body: { state: "deleting", deletionPending: true }, retryAt: deps.now() + 60_000 };
}
