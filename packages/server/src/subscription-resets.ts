/** Undocumented provider reset contracts. Discovery is GET + skip_spend; mutation is explicit, never retried. */
import type { SubscriptionResetCredit, SubscriptionResets } from "@aiki/protocol";
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const iso = (v: unknown): string | null =>
	typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const count = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
export type ResetTransport = { providerId: string; token: string; baseUrl: string; fetch: typeof fetch; now: number };
export function resetHeaders(providerId: string, token: string): Record<string, string> {
	const headers: Record<string, string> = {
		authorization: `Bearer ${token}`,
		accept: "application/json",
		"content-type": "application/json",
	};
	if (providerId === "anthropic") {
		headers["anthropic-beta"] = "oauth-2025-04-20";
		headers["user-agent"] = "claude-code/2.1.0";
	} else {
		headers["user-agent"] = "codex-cli";
		try {
			const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
			const account = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
			if (typeof account === "string") headers["chatgpt-account-id"] = account;
		} catch {}
	}
	return headers;
}
async function get(t: ResetTransport, path: string): Promise<unknown> {
	const r = await t.fetch(t.baseUrl + path, {
		headers: resetHeaders(t.providerId, t.token),
		signal: AbortSignal.timeout(20000),
	});
	if (!r.ok) throw Error(`Reset discovery HTTP ${r.status}`);
	return r.json();
}
export function parseCodexResets(body: unknown, now: number): SubscriptionResets | null {
	if (!record(body) || !Array.isArray(body.credits) || count(body.available_count) === null) return null;
	const credits: SubscriptionResetCredit[] = [];
	for (const raw of body.credits) {
		if (
			!record(raw) ||
			!id(raw.id) ||
			typeof raw.status !== "string" ||
			(raw.expires_at != null && iso(raw.expires_at) === null)
		)
			return null;
		const expiresAt = iso(raw.expires_at);
		credits.push({
			id: raw.id,
			program: "codex",
			label: typeof raw.title === "string" ? raw.title : "Saved reset",
			remaining: raw.status === "available" ? 1 : 0,
			usable: raw.status === "available" && (expiresAt === null || Date.parse(expiresAt) > now),
			expiresAt,
			clears: ["Codex rate limits"],
		});
	}
	return { available: body.available_count as number, credits, reason: null };
}
export function parseClaudeResets(
	body: unknown,
	program: "cedar_ember" | "juniper_tide",
	now: number,
): SubscriptionResets | null {
	if (!record(body)) return null;
	const status = record(body[program]) ? body[program] : body;
	if (!record(status) || typeof status.eligible !== "boolean") return null;
	const reason = typeof status.ineligible_reason === "string" ? status.ineligible_reason : null;
	if (status.cooldown_until != null && iso(status.cooldown_until) === null) return null;
	const cooldown = iso(status.cooldown_until);
	const cooled = cooldown === null || Date.parse(cooldown) <= now;
	if (program === "juniper_tide") {
		if (status.arm !== "reset") return { available: 0, credits: [], reason: reason ?? "Not offered on this account" };
		if (typeof status.available !== "boolean") return null;
		return {
			available: status.available ? 1 : 0,
			reason,
			credits: [
				{
					id: "juniper_tide",
					program,
					label: "5-hour limit reset",
					remaining: status.available ? 1 : 0,
					usable: status.eligible && status.available && cooled,
					expiresAt: null,
					clears: ["five_hour"],
				},
			],
		};
	}
	if (!Array.isArray(status.grants)) return null;
	const credits: SubscriptionResetCredit[] = [];
	for (const raw of status.grants) {
		if (
			!record(raw) ||
			!id(raw.id) ||
			count(raw.resets_left) === null ||
			!Array.isArray(raw.clears) ||
			!raw.clears.every((x) => typeof x === "string") ||
			typeof raw.usable_now !== "boolean"
		)
			return null;
		if ((raw.ends_at != null && iso(raw.ends_at) === null) || (raw.starts_at != null && iso(raw.starts_at) === null))
			return null;
		const expiresAt = iso(raw.ends_at);
		const startsAt = iso(raw.starts_at);
		credits.push({
			id: raw.id,
			program,
			label: typeof raw.label === "string" ? raw.label : "Saved reset",
			remaining: raw.resets_left as number,
			expiresAt,
			clears: raw.clears as string[],
			usable:
				status.eligible &&
				cooled &&
				!raw.paused &&
				raw.usable_now &&
				(raw.resets_left as number) > 0 &&
				(expiresAt === null || Date.parse(expiresAt) > now) &&
				(startsAt === null || Date.parse(startsAt) <= now),
		});
	}
	return { available: credits.reduce((n, c) => n + c.remaining, 0), credits, reason };
}
export async function discoverResets(t: ResetTransport): Promise<SubscriptionResets | null> {
	try {
		if (t.providerId === "openai-codex") return parseCodexResets(await get(t, "/wham/rate-limit-reset-credits"), t.now);
		if (t.providerId !== "anthropic") return null;
		const cedar = parseClaudeResets(await get(t, "/api/oauth/usage?cedar_ember=1&skip_spend=1"), "cedar_ember", t.now);
		if (cedar?.available) return cedar;
		const juniper = parseClaudeResets(await get(t, "/api/oauth/usage?at_wall=1&skip_spend=1"), "juniper_tide", t.now);
		return juniper?.available ? juniper : (cedar ?? juniper);
	} catch {
		return null;
	}
}
export async function consumeReset(
	t: ResetTransport,
	credit: SubscriptionResetCredit,
	requestId: string,
): Promise<{ ok: boolean; code: string }> {
	let path: string;
	let body: Record<string, unknown>;
	if (t.providerId === "openai-codex") {
		path = "/wham/rate-limit-reset-credits/consume";
		const headers = resetHeaders(t.providerId, t.token);
		body = {
			credit_id: credit.id,
			redeem_request_id: requestId,
			...(headers["chatgpt-account-id"] ? { account_id: headers["chatgpt-account-id"] } : {}),
		};
	} else if (t.providerId === "anthropic") {
		const profile = await get(t, "/api/oauth/profile");
		const org = record(profile) && record(profile.organization) ? profile.organization.uuid : undefined;
		if (!id(org)) return { ok: false, code: "organization_unavailable" };
		path = `/api/organizations/${encodeURIComponent(org)}/reset_rate_limits`;
		body =
			credit.program === "cedar_ember"
				? { program: credit.program, grant_id: credit.id, request_id: requestId }
				: { program: credit.program };
	} else return { ok: false, code: "unsupported" };
	// A timeout may mean the provider spent the reset: do not retry or report success without a positive result.
	try {
		const response = await t.fetch(t.baseUrl + path, {
			method: "POST",
			headers: resetHeaders(t.providerId, t.token),
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(20000),
		});
		const answer: unknown = await response.json();
		const code = record(answer) ? (t.providerId === "anthropic" ? answer.result : answer.code) : undefined;
		return {
			ok: response.ok && code === "reset",
			code: typeof code === "string" ? code : response.ok ? "unknown_outcome" : `http_${response.status}`,
		};
	} catch {
		return { ok: false, code: "unknown_outcome" };
	}
}
