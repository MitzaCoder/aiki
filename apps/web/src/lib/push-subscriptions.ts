/** Persisted routing, never credentials. Subscription objects are read from their browser registration. */
export type BackendPushSubscription = {
	origin: string;
	scope: string;
	publicKey: string;
	enabled: boolean;
	syncNeeded?: boolean;
};
export const PUSH_SUBSCRIPTIONS_STORAGE = "aiki.push-subscriptions.v1";
export const MAX_PUSH_SCOPES = 24;
/** Compare application-server keys independent of base64 padding. */
export function equalPushKey(a: string, b: string): boolean {
	return a.trim().replace(/=+$/, "") === b.trim().replace(/=+$/, "");
}
export type PushSubscriptionDecision = "off" | "root" | "scoped" | "key-changed" | "sync-needed";
/** Keep an existing route and require explicit repair on key changes; only equal keys may share root. */
export function pushSubscriptionDecision(facts: {
	publicKey: string;
	rootKey?: string;
	stored?: BackendPushSubscription;
}): PushSubscriptionDecision {
	if (facts.stored) {
		if (!facts.stored.enabled) return "off";
		if (!equalPushKey(facts.publicKey, facts.stored.publicKey)) return "key-changed";
		if (facts.stored.syncNeeded) return "sync-needed";
		return facts.stored.scope === "/" ? "root" : "scoped";
	}
	return facts.rootKey !== undefined && equalPushKey(facts.publicKey, facts.rootKey) ? "root" : "scoped";
}
/** Opaque, stable per backend origin and app ID. No host names in worker scopes. */
export async function backendPushScope(backendId: string, origin: string): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([backendId, origin])));
	return `/push/${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}/`;
}
/** Return only removed backends or IDs whose configured origin has been replaced. */
export function removedPushBackendIds(
	records: Record<string, BackendPushSubscription>,
	backends: readonly { id: string; url: string }[],
): string[] {
	return Object.keys(records).filter(
		(id) => !backends.some((backend) => backend.id === id && backend.url === records[id]?.origin),
	);
}
/** Validate saved routing without silently dropping a corrupt record and replacing its subscription. */
export function loadPushSubscriptions(storage: Pick<Storage, "getItem">): Record<string, BackendPushSubscription> {
	const raw: unknown = JSON.parse(storage.getItem(PUSH_SUBSCRIPTIONS_STORAGE) ?? "{}");
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid saved push subscriptions.");
	const records: Record<string, BackendPushSubscription> = {};
	for (const [id, value] of Object.entries(raw)) {
		const record = value as BackendPushSubscription | null;
		if (
			!record ||
			typeof record.origin !== "string" ||
			typeof record.publicKey !== "string" ||
			typeof record.enabled !== "boolean" ||
			!(record.scope === "/" || /^\/push\/[a-f0-9]{64}\/$/.test(record.scope))
		)
			throw new Error("Invalid saved push subscription.");
		records[id] = record;
	}
	return records;
}
