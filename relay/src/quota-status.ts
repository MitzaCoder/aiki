import { createHmac } from "node:crypto";
import type { RelayStore } from "./documents";
import { readControl } from "./control";
import { windowStart } from "./budgets";
import { DAY, MINUTE, type Dependencies } from "./ports";

/** Return bounded scope/reset information only; quota keys, source IP, UID and the rotating key are never exposed. */
export async function quotaStatus(deps: Dependencies, store: RelayStore, uid: string, ip: string) {
	const control = await readControl(store);
	const runtime = (await store.runtime.doc("state").get()).data();
	const accountKey = "account-" + createHmac("sha256", "aiki-quota-id-v1").update(uid).digest("hex");
	const ipKey = runtime
		? "ip-" +
			runtime.ipDay +
			"-" +
			createHmac("sha256", Buffer.from(runtime.ipKey, "base64url")).update(ip).digest("hex")
		: "";
	const [account, source, global] = await Promise.all([
		store.rateLimits.doc(accountKey).get(),
		ipKey ? store.rateLimits.doc(ipKey).get() : undefined,
		store.rateLimits.doc("global").get(),
	]);
	const rows = { account: account.data(), ip: source?.data(), global: global.data() };
	const budgets = [
		["account", "sendDay", "accountDay", DAY, "account_rate"],
		["account", "sendMinute", "accountMinute", MINUTE, "account_rate"],
		["account", "challengeHour", "accountChallengeHour", 60 * MINUTE, "challenge_rate"],
		["account", "challengeDay", "accountChallengeDay", DAY, "challenge_rate"],
		["account", "enrollmentDay", "enrollmentDay", DAY, "enrollment_rate"],
		["ip", "sendDay", "ipDay", DAY, "ip_rate"],
		["ip", "sendMinute", "ipMinute", MINUTE, "ip_rate"],
		["ip", "managementMinute", "managementMinute", MINUTE, "ip_rate"],
		["ip", "managementDay", "managementDay", DAY, "ip_rate"],
		["ip", "challengeHour", "ipChallengeHour", 60 * MINUTE, "challenge_rate"],
		["ip", "challengeDay", "ipChallengeDay", DAY, "challenge_rate"],
		["ip", "newAccountDay", "newAccountIpDay", DAY, "enrollment_capacity"],
		["global", "sendDay", "relaySendDay", DAY, "relay_capacity"],
		["global", "challengeDay", "relayChallengeDay", DAY, "relay_capacity"],
		["global", "newAccountDay", "newAccountDay", DAY, "enrollment_capacity"],
	] as const;
	return budgets.map(([entity, name, budget, duration, scope]) => {
		const start = windowStart(deps.now(), duration);
		const count = rows[entity]?.windows[name]?.startedAt === start ? rows[entity]!.windows[name].count : 0;
		return { scope, budget, remaining: Math.max(0, control.limits[budget] - count), resetAt: start + duration };
	});
}
