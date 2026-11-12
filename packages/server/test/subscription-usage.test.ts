import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, createProvider, type Models, type OAuthAuth } from "@earendil-works/pi-ai";
import { lazyApi } from "@earendil-works/pi-ai/api/lazy";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import type { SubscriptionUsage } from "@aiki/protocol";
import { FileCredentialStore } from "../src/credentials.ts";
import {
	appendSample,
	parseAnthropicRateLimitHeaders,
	parseClaudeProfile,
	parseClaudeUsage,
	parseCodexRateLimitEvent,
	parseCodexRateLimitHeaders,
	parseCodexUsage,
	parseOpenCodeGoUsage,
	SubscriptionUsageService,
	type SubscriptionUsageOptions,
} from "../src/subscription-usage.ts";
import { createSetup, TestClient, type TestSetup } from "./support.ts";
import { CLAUDE_USAGE_USER_AGENT, parseClaudeResets, parseCodexResets } from "../src/subscription-resets.ts";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-04T10:00:00Z");

function jwt(payload: Record<string, unknown>): string {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "none" })}.${part(payload)}.sig`;
}

const CODEX_TOKEN = jwt({
	"https://api.openai.com/auth": { chatgpt_account_id: "acct-123" },
	"https://api.openai.com/profile": { email: "me@example.com" },
});

/** A fake api.anthropic.com and chatgpt.com/backend-api in one server; each test sets the bodies. */
function fakeProviders() {
	const state = {
		claudeUsage: {
			five_hour: { utilization: 12.5, resets_at: new Date(T0 + 3 * HOUR).toISOString() },
			seven_day: { utilization: 40, resets_at: new Date(T0 + 50 * HOUR).toISOString() },
			seven_day_opus: null,
			seven_day_sonnet: { utilization: 5, resets_at: new Date(T0 + 50 * HOUR).toISOString() },
			extra_usage: { is_enabled: false },
		} as unknown,
		claudeProfile: {
			account: { email_address: "claude@example.com", has_claude_max: true },
			organization: { organization_type: "claude_max", rate_limit_tier: "default_claude_max_20x" },
		} as unknown,
		codexUsage: {
			plan_type: "pro",
			rate_limit: {
				allowed: true,
				limit_reached: false,
				primary_window: { used_percent: 30, limit_window_seconds: 18_000, reset_after_seconds: 100, reset_at: T0 / 1000 + 7200 },
				secondary_window: { used_percent: 60, limit_window_seconds: 604_800, reset_after_seconds: 100, reset_at: T0 / 1000 + 86_400 },
			},
			credits: null,
		} as unknown,
		opencodeGoUsage: {
			usage: {
				rolling: { status: "ok", percent: 4, resetsAt: new Date(T0 + 3 * HOUR).toISOString() },
				weekly: { status: "ok", percent: 3, resetsAt: new Date(T0 + 50 * HOUR).toISOString() },
				monthly: { status: "ok", percent: 1, resetsAt: "2026-12-05T15:34:51.000Z" },
			},
		} as unknown,
		status: { claude: 200, codex: 200, opencodeGo: 200 },
		retryAfter: undefined as string | undefined,
		requests: [] as { path: string; headers: Record<string, string> }[],
	};
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			state.requests.push({ path: url.pathname + url.search, headers: Object.fromEntries(request.headers) });
			const json = (status: number, body: unknown) =>
				new Response(JSON.stringify(body), {
					status,
					headers: {
						"content-type": "application/json",
						...(status === 429 && state.retryAfter !== undefined ? { "retry-after": state.retryAfter } : {}),
					},
				});
			if (url.pathname === "/api/oauth/usage") return json(state.status.claude, state.claudeUsage);
			if (url.pathname === "/api/oauth/profile") return json(200, state.claudeProfile);
			if (url.pathname === "/backend-api/wham/usage") return json(state.status.codex, state.codexUsage);
			if (url.pathname === "/v1/usage") return json(state.status.opencodeGo, state.opencodeGoUsage);
			return json(404, { error: "not found" });
		},
	});
	const base = `http://127.0.0.1:${server.port}`;
	return {
		state,
		urls: { anthropicBaseUrl: base, chatgptBaseUrl: `${base}/backend-api`, opencodeGoBaseUrl: base },
		requestsTo: (path: string) => state.requests.filter((request) => request.path === path),
		stop: () => server.stop(true),
	};
}

/** OAuth providers under the real IDs; refresh hands out a new token so the refresh path is visible. */
function subscriptionProvider(id: string, refreshedAccess: string, refreshes: string[]) {
	const oauth: OAuthAuth = {
		name: `${id} (OAuth)`,
		isSubscription: true,
		async login() {
			throw new Error("not in tests");
		},
		async refresh(credential) {
			refreshes.push(id);
			return { ...credential, access: refreshedAccess, expires: Date.now() + HOUR };
		},
		async toAuth(credential) {
			return { apiKey: credential.access };
		},
	};
	return createProvider({
		id,
		name: id,
		auth: { oauth },
		models: [],
		api: lazyApi(async () => {
			throw new Error("no streaming in tests");
		}),
	});
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setupService(overrides?: Partial<SubscriptionUsageOptions> & { expired?: boolean }) {
	const dataDir = await mkdtemp(join(tmpdir(), "subscription-usage-"));
	const fake = fakeProviders();
	cleanups.push(() => rm(dataDir, { recursive: true, force: true }), () => fake.stop());
	const credentials = new FileCredentialStore(join(dataDir, "credentials.json"));
	const expires = overrides?.expired === true ? Date.now() - 1000 : Date.now() + HOUR;
	await credentials.modify("anthropic", async () => ({ type: "oauth", access: "claude-old", refresh: "r", expires }));
	await credentials.modify("openai-codex", async () => ({ type: "oauth", access: CODEX_TOKEN, refresh: "r", expires: Date.now() + HOUR }));
	const refreshes: string[] = [];
	const models = createModels({ credentials });
	models.setProvider(subscriptionProvider("anthropic", "claude-refreshed", refreshes));
	models.setProvider(subscriptionProvider("openai-codex", CODEX_TOKEN, refreshes));
	const changes: SubscriptionUsage[][] = [];
	let clock = T0;
	const make = (extra?: Partial<SubscriptionUsageOptions>) => {
		const service = new SubscriptionUsageService({
			models,
			credentials,
			dataDir,
			...fake.urls,
			now: () => clock,
			onChange: (subscriptions) => changes.push(subscriptions),
			...overrides,
			...extra,
		});
		cleanups.push(() => service.stop());
		return service;
	};
	return {
		dataDir,
		fake,
		credentials,
		models,
		refreshes,
		changes,
		make,
		service: make(),
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out");
		await Bun.sleep(5);
	}
}

function byProvider(list: SubscriptionUsage[], providerId: string): SubscriptionUsage {
	const usage = list.find((entry) => entry.providerId === providerId);
	if (usage === undefined) throw new Error(`no ${providerId} in ${JSON.stringify(list)}`);
	return usage;
}

describe("saved subscription resets (fake HTTP only)", () => {
	it("caches reset discovery separately, discovers without a marker and refreshes after explicit spend", async () => {
		let discoveries = 0, posts = 0, windows = 0;
		const headers: string[] = [];
		const test = await setupService({ fetch: (async (input, init) => {
			const url = String(input);
			if (url.includes("/wham/")) return Response.json({ rate_limit: {} });
			headers.push(new Headers(init?.headers).get("user-agent") ?? "");
			if (init?.method === "POST") { posts++; return Response.json({ result: "reset" }); }
			if (url.endsWith("/profile")) return Response.json({ organization: { uuid: "org-synthetic" } });
			if (url.includes("cedar_ember=1")) { discoveries++; return Response.json({ cedar_ember: { eligible: true, grants: [{ id: "fable", label: "Fable reset", type: "full", resets_left: 3 - posts, usable_now: true, clears: ["five_hour", "seven_day_fable"], gives_back_weekly: true }] } }); }
			windows++; return Response.json({ five_hour: { utilization: posts ? 0 : 90, resets_at: null } });
		}) as typeof fetch });
		const read = () => test.service.usage({ refresh: true });
		expect(byProvider(await read(), "anthropic").manualResets?.credits[0]).toMatchObject({ remaining: 3, givesBackWeekly: true });
		await read(); expect(discoveries).toBe(1); expect(posts).toBe(0);
		test.advance(5 * 60_000); await read(); expect(discoveries).toBe(1);
		test.advance(55 * 60_000); await read(); expect(discoveries).toBe(2);
		const request = { providerId: "anthropic", creditId: "fable", program: "cedar_ember", requestId: crypto.randomUUID(), confirmed: true as const };
		expect(await test.service.reset({ ...request, confirmed: false as never })).toMatchObject({ code: "confirmation_required" });
		expect(posts).toBe(0);
		expect(await test.service.reset(request)).toEqual({ ok: true, code: "reset" });
		expect(posts).toBe(1); expect(discoveries).toBe(4); expect(windows).toBe(5);
		const refreshed = byProvider(await test.service.usage(), "anthropic");
		expect(refreshed.windows[0]?.usedPercent).toBe(0); expect(refreshed.manualResets?.available).toBe(2);
		expect(headers.every(header => header === CLAUDE_USAGE_USER_AGENT)).toBe(true);
	});
	it("retains Codex detailed-credit discovery on ordinary refreshes", async () => {
		const test = await setupService({ fetch: (async (input) => {
			if (String(input).includes("rate-limit-reset-credits")) return Response.json({ available_count: 1, credits: [{ id: "synthetic-codex", status: "available", expires_at: null }] });
			return Response.json({ rate_limit: {}, rate_limit_reset_credits: { available_count: 1 } });
		}) as typeof fetch });
		for (let index = 0; index < 2; index++) {
			const usage = byProvider(await test.service.usage({ refresh: true }), "openai-codex");
			expect(usage.manualResets?.credits[0]?.id).toBe("synthetic-codex");
		}
	});
	it("invalidates a stale discovery that finishes after the confirmed spend", async () => {
		let discoveries = 0, posts = 0;
		let release!: () => void;
		const held = new Promise<void>(resolve => { release = resolve; });
		const test = await setupService({ fetch: (async (input, init) => {
			const url = String(input);
			if (url.includes("/wham/")) return Response.json({ rate_limit: {} });
			if (init?.method === "POST") { posts++; return Response.json({ result: "reset" }); }
			if (url.endsWith("/profile")) return Response.json({ organization: { uuid: "org-synthetic" } });
			if (url.includes("cedar_ember=1")) {
				const remaining = 3 - posts;
				discoveries++;
				if (discoveries === 2) await held;
				return Response.json({ eligible: true, grants: [{ id: "fable", resets_left: remaining, usable_now: true, clears: ["five_hour"] }] });
			}
			return Response.json({ five_hour: { utilization: posts ? 0 : 90, resets_at: null } });
		}) as typeof fetch });
		await test.service.usage({ refresh: true });
		test.advance(HOUR);
		const staleRead = test.service.usage({ refresh: true });
		await until(() => discoveries === 2);
		const spend = test.service.reset({ providerId: "anthropic", creditId: "fable", program: "cedar_ember", requestId: crypto.randomUUID(), confirmed: true });
		await until(() => posts === 1);
		release();
		await staleRead;
		expect(await spend).toEqual({ ok: true, code: "reset" });
		expect(discoveries).toBe(4);
		expect(byProvider(await test.service.usage(), "anthropic").manualResets?.available).toBe(2);
	});
	it("keeps narrower full-type grants and provider unavailability reasons", () => {
		const parsed = parseClaudeResets({ eligible: true, grants: [{ id: "fable", type: "full", label: "Synthetic tenure grant", resets_left: 3, clears: ["five_hour", "seven_day_overage_included"], gives_back_weekly: true, usable_now: false, unavailable_reason: "weekly_limit_not_reached" }] }, "cedar_ember", T0);
		expect(parsed?.credits[0]).toMatchObject({ label: "Fable reset", givesBackWeekly: true, usable: false, unavailableReason: "weekly_limit_not_reached" });
	});
	const credit = {id:"credit-1",status:"available",expires_at:"2027-01-01T00:00:00Z"};
	it("distinguishes unknown, ineligible, expired and available reset grants", () => {
		expect(parseCodexResets({},T0)).toBeNull();
		expect(parseCodexResets({available_count:1,credits:[{...credit,expires_at:"invalid"}]},T0)).toBeNull();
		expect(parseCodexResets({available_count:1,credits:[credit]},T0)?.credits[0]?.usable).toBe(true);
		expect(parseCodexResets({available_count:1,credits:[{...credit,expires_at:"2020-01-01T00:00:00Z"}]},T0)?.credits[0]?.usable).toBe(false);
		expect(parseClaudeResets({eligible:false,ineligible_reason:"surface",grants:[]},"cedar_ember",T0)).toMatchObject({available:0,reason:"surface"});
		expect(parseClaudeResets({eligible:true,grants:[{id:"grant",resets_left:2,clears:["five_hour"],usable_now:true}]},"cedar_ember",T0)?.available).toBe(2);
		expect(parseClaudeResets({eligible:true,arm:"reset",available:true},"juniper_tide",T0)?.credits[0]).toMatchObject({usable:true,remaining:1});
		expect(parseClaudeResets({eligible:true,grants:[{}]},"cedar_ember",T0)).toBeNull();
	});
	it("requires confirmation, rechecks availability, deduplicates a confirmed consume and sends Codex account auth", async () => {
		const posts:{body:any;headers:Headers}[]=[];
		const fakeFetch = (async (input:RequestInfo|URL,init?:RequestInit) => {
			const url=String(input);
			if(init?.method==="POST") {posts.push({body:JSON.parse(String(init.body)),headers:new Headers(init.headers)});return Response.json({code:"reset"});}
			if(url.includes("rate-limit-reset-credits"))return Response.json({available_count:1,credits:[credit]});
			if(url.endsWith("/wham/usage"))return Response.json({rate_limit:{},plan_type:"pro"});
			return Response.json({five_hour:{utilization:30,resets_at:null}});
		}) as typeof fetch;
		const test=await setupService({fetch:fakeFetch});
		const request={providerId:"openai-codex",creditId:"credit-1",program:"codex",requestId:crypto.randomUUID(),confirmed:true as const};
		expect(await test.service.reset({...request,confirmed:false as never})).toMatchObject({ok:false});expect(posts).toHaveLength(0);
		expect(await test.service.reset({...request,creditId:"missing",requestId:crypto.randomUUID()})).toMatchObject({code:"unavailable"});
		const first=test.service.reset(request);
		expect(await test.service.reset({...request,requestId:crypto.randomUUID()})).toMatchObject({code:"reset_in_progress"});
		const answers=await Promise.all([first,test.service.reset(request)]);expect(answers.every(a=>a.ok)).toBe(true);expect(posts).toHaveLength(1);
		expect(posts[0]?.body).toMatchObject({credit_id:"credit-1",redeem_request_id:request.requestId,account_id:"acct-123"});expect(posts[0]?.headers.get("chatgpt-account-id")).toBe("acct-123");
		expect(await test.service.reset({...request,creditId:"different"})).toMatchObject({code:"request_id_reused"});
	});
	it("uses read-only Claude discovery flags and its profile organization; never retries uncertain consumption",async()=>{
		let posts=0;const paths:string[]=[];let sent:any;
		const fakeFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);paths.push(url);
			if(init?.method==="POST"){posts++;sent=JSON.parse(String(init.body));throw Error("response lost");}
			if(url.endsWith("/profile"))return Response.json({organization:{uuid:"org-synthetic"}});
			if(url.includes("cedar_ember=1"))return Response.json({eligible:true,grants:[{id:"grant-1",resets_left:1,usable_now:true,clears:["five_hour"]}]});
			return Response.json({five_hour:{utilization:90,resets_at:null},cedar_ember:null});
		}) as typeof fetch;
		const test=await setupService({fetch:fakeFetch});const request={providerId:"anthropic",creditId:"grant-1",program:"cedar_ember",requestId:crypto.randomUUID(),confirmed:true as const};
		expect(await test.service.reset(request)).toMatchObject({ok:false,code:"unknown_outcome"});expect(await test.service.reset(request)).toMatchObject({ok:false});expect(posts).toBe(1);expect(sent).toEqual({program:"cedar_ember",grant_id:"grant-1",request_id:request.requestId});expect(paths.some(p=>p.includes("skip_spend=1"))).toBe(true);expect(paths.some(p=>p.endsWith("/api/organizations/org-synthetic/reset_rate_limits"))).toBe(true);
	});
});

describe("subscription usage parsing", () => {
	it("reads Claude's usage windows and plan", () => {
		const windows = parseClaudeUsage({
			five_hour: { utilization: 12.5, resets_at: "2026-11-04T13:00:00.512+00:00" },
			seven_day: { utilization: 40, resets_at: null },
			seven_day_opus: null,
			seven_day_fable: { utilization: 3, resets_at: "2026-11-06T00:00:00Z" },
			extra_usage: { utilization: 99 },
		});
		expect(windows).toEqual([
			{ id: "five_hour", label: "5-hour limit", usedPercent: 12.5, resetsAt: "2026-11-04T13:00:00.512Z", windowMinutes: 300 },
			{ id: "seven_day", label: "Weekly limit", usedPercent: 40, resetsAt: null, windowMinutes: 10_080 },
			{ id: "seven_day_fable", label: "Weekly · Fable", usedPercent: 3, resetsAt: "2026-11-06T00:00:00.000Z", windowMinutes: 10_080 },
		]);
		expect(parseClaudeProfile({ organization: { rate_limit_tier: "default_claude_max_5x" } }).plan).toBe("Max 5x");
		expect(parseClaudeProfile({ account: { email: "a@b", has_claude_pro: true } })).toEqual({ plan: "Pro", account: "a@b" });
		expect(() => parseClaudeUsage("nope")).toThrow();
	});

	it("adds Claude's scoped limits and leaves out null codename keys", () => {
		const resetsAt = "2026-11-10T00:00:00Z";
		const windows = parseClaudeUsage({
			five_hour: { utilization: 88, resets_at: resetsAt },
			seven_day: { utilization: 28, resets_at: resetsAt },
			seven_day_oauth_apps: null,
			seven_day_opus: { utilization: 5, resets_at: resetsAt },
			seven_day_sonnet: null,
			seven_day_cowork: null,
			seven_day_omelette: null,
			seven_day_breakdown: null,
			limits: [
				{ kind: "session", group: "session", percent: 88, severity: "warning", resets_at: resetsAt, scope: null, is_active: true },
				{ kind: "weekly_all", group: "weekly", percent: 28, severity: "normal", resets_at: resetsAt, scope: null, is_active: true },
				{ kind: "weekly_scoped", group: "weekly", percent: 0, resets_at: resetsAt, scope: { model: { id: null, display_name: "Fable" }, surface: null } },
				{ kind: "weekly_scoped", group: "weekly", percent: 5, resets_at: resetsAt, scope: { model: { id: null, display_name: "Opus" }, surface: null } },
				{ kind: "weekly_surface", group: "weekly", percent: 9, resets_at: resetsAt, scope: { model: null, surface: "Claude Code" } },
				{ kind: "weekly_scoped", group: "weekly", percent: 1, scope: null },
			],
		});
		const at = new Date(resetsAt).toISOString();
		expect(windows.map((window) => [window.id, window.label, window.usedPercent])).toEqual([
			["five_hour", "5-hour limit", 88],
			["seven_day", "Weekly limit", 28],
			["seven_day_opus", "Weekly · Opus", 5],
			["weekly_scoped.fable", "Weekly · Fable", 0],
			["weekly_surface.claude_code", "Weekly · Claude Code", 9],
		]);
		expect(windows[3]).toEqual({ id: "weekly_scoped.fable", label: "Weekly · Fable", usedPercent: 0, resetsAt: at, windowMinutes: 10_080 });

		// A codename key shows only when it has a window, with its name as the label; a lone `limits` entry fills a missing key.
		const fallback = parseClaudeUsage({
			seven_day_omelette: { utilization: 4, resets_at: null },
			seven_day_cowork: { utilization: 2, resets_at: null },
			limits: [{ kind: "session", group: "session", percent: 7, resets_at: resetsAt, scope: null }],
		});
		expect(fallback.map((window) => [window.id, window.label, window.usedPercent])).toEqual([
			["seven_day_cowork", "Weekly · Cowork", 2],
			["seven_day_omelette", "Weekly · Omelette", 4],
			["five_hour", "5-hour limit", 7],
		]);
	});

	it("names ChatGPT plans readably", () => {
		expect(parseCodexUsage({ plan_type: "self_serve_business_prolite" }).plan).toBe("Business");
		expect(parseCodexUsage({ plan_type: "prolite" }).plan).toBe("Pro Lite");
		expect(parseCodexUsage({ plan_type: "self_serve_starter_plus" }).plan).toBe("Starter Plus");
		expect(parseCodexUsage({ plan_type: "unknown" }).plan).toBeNull();
	});

	it("reads ChatGPT's primary, secondary and additional windows", () => {
		const reading = parseCodexUsage({
			plan_type: "prolite",
			rate_limit: {
				primary_window: { used_percent: 42, limit_window_seconds: 18_000, reset_after_seconds: 1, reset_at: 1_800_000_000 },
				secondary_window: null,
			},
			additional_rate_limits: [
				{
					limit_name: "GPT-5 Codex Spark",
					metered_feature: "codex_spark",
					rate_limit: { primary_window: { used_percent: 7, limit_window_seconds: 604_800, reset_at: 1_800_000_000 } },
				},
			],
		});
		expect(reading.plan).toBe("Pro Lite");
		expect(reading.windows).toEqual([
			{ id: "primary", label: "5-hour limit", usedPercent: 42, resetsAt: new Date(1_800_000_000_000).toISOString(), windowMinutes: 300 },
			{
				id: "codex_spark.primary",
				label: "Weekly limit · GPT-5 Codex Spark",
				usedPercent: 7,
				resetsAt: new Date(1_800_000_000_000).toISOString(),
				windowMinutes: 10_080,
			},
		]);
	});

	it("reads rate-limit headers and Codex's rate-limit event", () => {
		expect(
			parseAnthropicRateLimitHeaders({
				"Anthropic-Ratelimit-Unified-5h-Utilization": "0.2512",
				"anthropic-ratelimit-unified-5h-reset": "1800000000",
				"anthropic-ratelimit-unified-status": "allowed",
			}),
		).toEqual([
			{ id: "five_hour", label: "5-hour limit", usedPercent: 25.12, resetsAt: new Date(1_800_000_000_000).toISOString(), windowMinutes: 300 },
		]);
		expect(parseAnthropicRateLimitHeaders({ "anthropic-ratelimit-requests-remaining": "10" })).toEqual([]);
		expect(
			parseCodexRateLimitHeaders({
				"x-codex-secondary-used-percent": "61.5",
				"x-codex-secondary-window-minutes": "10080",
				"x-codex-secondary-reset-at": "1800000000",
			}),
		).toEqual([
			{ id: "secondary", label: "Weekly limit", usedPercent: 61.5, resetsAt: new Date(1_800_000_000_000).toISOString(), windowMinutes: 10_080 },
		]);
		const event = parseCodexRateLimitEvent({
			type: "codex.rate_limits",
			plan_type: "plus",
			rate_limits: { primary: { used_percent: 3, window_minutes: 300, reset_at: 1_800_000_000 }, secondary: null },
		});
		expect(event?.plan).toBe("Plus");
		expect(event?.windows.map((window) => [window.id, window.usedPercent])).toEqual([["primary", 3]]);
		expect(parseCodexRateLimitEvent({ type: "codex.rate_limits", metered_limit_name: "codex_other", rate_limits: {} })).toBeUndefined();
		expect(parseCodexRateLimitEvent({ type: "response.created" })).toBeUndefined();
	});

	it("keeps samples bounded and collapses close or flat ones", () => {
		const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
		let samples = appendSample([], { at: at(0), usedPercent: 1 });
		samples = appendSample(samples, { at: at(0.5), usedPercent: 1 });
		expect(samples).toHaveLength(1);
		samples = appendSample(samples, { at: at(5), usedPercent: 2 });
		samples = appendSample(samples, { at: at(10), usedPercent: 2 });
		samples = appendSample(samples, { at: at(15), usedPercent: 2 });
		expect(samples.map((sample) => sample.at)).toEqual([at(0), at(5), at(15)]);
		for (let minute = 20; minute < 20 + 5 * 1100; minute += 5) samples = appendSample(samples, { at: at(minute), usedPercent: minute });
		expect(samples.length).toBeLessThanOrEqual(1000);
		expect(samples.at(-1)?.usedPercent).toBe(20 + 5 * 1099);
	});
});

describe("SubscriptionUsageService", () => {
	it("reads both usage endpoints with the OAuth bearer and their headers", async () => {
		const test = await setupService();
		const list = await test.service.usage({ refresh: true });
		const claude = byProvider(list, "anthropic");
		expect(claude).toMatchObject({ label: "Claude", plan: "Max 20x", account: "claude@example.com", source: "usage_api", error: null });
		expect(claude.windows.map((window) => [window.id, window.usedPercent, window.windowMinutes])).toEqual([
			["five_hour", 12.5, 300],
			["seven_day", 40, 10_080],
			["seven_day_sonnet", 5, 10_080],
		]);
		expect(claude.windows[0]?.samples).toEqual([{ at: new Date(T0).toISOString(), usedPercent: 12.5 }]);
		const chatgpt = byProvider(list, "openai-codex");
		expect(chatgpt).toMatchObject({ label: "ChatGPT", plan: "Pro", account: "me@example.com", source: "usage_api" });
		expect(chatgpt.windows.map((window) => [window.id, window.label, window.usedPercent])).toEqual([
			["primary", "5-hour limit", 30],
			["secondary", "Weekly limit", 60],
		]);

		const [claudeRequest] = test.fake.requestsTo("/api/oauth/usage");
		expect(claudeRequest?.headers.authorization).toBe("Bearer claude-old");
		expect(claudeRequest?.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
		const [codexRequest] = test.fake.requestsTo("/backend-api/wham/usage");
		expect(codexRequest?.headers.authorization).toBe(`Bearer ${CODEX_TOKEN}`);
		expect(codexRequest?.headers["chatgpt-account-id"]).toBe("acct-123");
		expect(test.refreshes).toEqual([]);
	});

	it("refreshes an expired OAuth token before reading, and stores it", async () => {
		const test = await setupService({ expired: true });
		await test.service.usage({ refresh: true });
		expect(test.refreshes).toEqual(["anthropic"]);
		expect(test.fake.requestsTo("/api/oauth/usage")[0]?.headers.authorization).toBe("Bearer claude-refreshed");
		const stored = await test.credentials.read("anthropic");
		expect(stored?.type === "oauth" ? stored.access : undefined).toBe("claude-refreshed");
	});

	it("keeps samples through a period and clears them when the window resets", async () => {
		const test = await setupService();
		await test.service.usage({ refresh: true });
		test.advance(10 * 60_000);
		(test.fake.state.claudeUsage as { five_hour: { utilization: number } }).five_hour.utilization = 20;
		let claude = byProvider(await test.service.usage({ refresh: true }), "anthropic");
		expect(claude.windows[0]?.samples.map((sample) => sample.usedPercent)).toEqual([12.5, 20]);

		// Past the reset: a new period with a new reset time starts with one sample.
		test.advance(3 * HOUR);
		test.fake.state.claudeUsage = {
			five_hour: { utilization: 1, resets_at: new Date(T0 + 8 * HOUR).toISOString() },
			seven_day: { utilization: 41, resets_at: new Date(T0 + 50 * HOUR).toISOString() },
		};
		claude = byProvider(await test.service.usage({ refresh: true }), "anthropic");
		expect(claude.windows[0]?.samples.map((sample) => sample.usedPercent)).toEqual([1]);
		expect(claude.windows[1]?.samples.map((sample) => sample.usedPercent)).toEqual([40, 40, 41]);
		// The sonnet window is gone from the endpoint, so it is gone here.
		expect(claude.windows.map((window) => window.id)).toEqual(["five_hour", "seven_day"]);
	});

	it("persists the numbers and samples across a restart", async () => {
		const test = await setupService();
		await test.service.usage({ refresh: true });
		await test.service.stop();
		const file = JSON.parse(await readFile(join(test.dataDir, "subscription-usage.json"), "utf8")) as {
			subscriptions: SubscriptionUsage[];
		};
		expect(file.subscriptions.map((usage) => usage.providerId)).toEqual(["anthropic", "openai-codex"]);

		const restarted = test.make();
		const list = await restarted.usage();
		expect(byProvider(list, "anthropic").windows[0]?.samples).toHaveLength(1);
		expect(test.fake.requestsTo("/api/oauth/usage")).toHaveLength(1);
	});

	it("polls while a client is connected and pushes only when the numbers change", async () => {
		const test = await setupService({ pollIntervalMs: 40, minReadGapMs: 0 });
		test.service.clientConnected();
		await until(() => test.changes.some((list) => list.some((usage) => usage.windows.length > 0)));
		const pushes = test.changes.length;
		await until(() => test.fake.requestsTo("/backend-api/wham/usage").length >= 3);
		expect(test.changes).toHaveLength(pushes);

		(test.fake.state.codexUsage as { rate_limit: { primary_window: { used_percent: number } } }).rate_limit.primary_window.used_percent = 31;
		await until(() => test.changes.length > pushes);
		expect(byProvider(test.changes.at(-1) ?? [], "openai-codex").windows[0]?.usedPercent).toBe(31);

		test.service.clientDisconnected();
		await Bun.sleep(20);
		const reads = test.fake.state.requests.length;
		await Bun.sleep(120);
		expect(test.fake.state.requests.length).toBe(reads);
	});

	it("reports a failed read in error, keeps the numbers, and holds off after a 429", async () => {
		const test = await setupService({ pollIntervalMs: 40, minReadGapMs: 0 });
		await test.service.usage({ refresh: true });
		test.fake.state.status.claude = 500;
		let claude = byProvider(await test.service.usage({ refresh: true }), "anthropic");
		expect(claude.error).toContain("HTTP 500");
		expect(claude.windows[0]?.usedPercent).toBe(12.5);

		test.fake.state.status.claude = 429;
		test.fake.state.retryAfter = "600";
		claude = byProvider(await test.service.usage({ refresh: true }), "anthropic");
		expect(claude.error).toContain("Rate limited");
		const before = test.fake.requestsTo("/api/oauth/usage").length;
		test.fake.state.status.claude = 200;
		await test.service.usage({ refresh: true });
		test.service.clientConnected();
		await Bun.sleep(150);
		expect(test.fake.requestsTo("/api/oauth/usage")).toHaveLength(before);
		test.advance(11 * 60_000);
		claude = byProvider(await test.service.usage({ refresh: true }), "anthropic");
		expect(claude.error).toBeNull();
	});

	it("takes numbers from response headers, and reads after a turn goes quiet", async () => {
		const test = await setupService({ afterTurnQuietMs: 30, minReadGapMs: 0 });
		await test.service.usage();
		const resetAt = Math.round((T0 + 2 * HOUR) / 1000);
		const calls: string[] = [];
		const fakeModels = {
			streamSimple(model: { provider: string }, _context: unknown, options: Record<string, Function>) {
				void options.onResponse?.(
					{
						status: 200,
						headers: {
							"anthropic-ratelimit-unified-5h-utilization": "0.25",
							"anthropic-ratelimit-unified-5h-reset": String(resetAt),
						},
					},
					model,
				);
				return "stream";
			},
			getProviders: () => calls.push("getProviders"),
		} as unknown as Models;
		const observed = test.service.observeModels(fakeModels) as unknown as {
			streamSimple(model: unknown, context: unknown, options: unknown): unknown;
			getProviders(): unknown;
		};
		const own: string[] = [];
		expect(observed.streamSimple({ provider: "anthropic" }, {}, { onResponse: () => own.push("caller") })).toBe("stream");
		observed.getProviders();
		expect(calls).toEqual(["getProviders"]);
		expect(own).toEqual(["caller"]);

		await until(() => test.changes.length > 0);
		const claude = byProvider(test.changes.at(-1) ?? [], "anthropic");
		expect(claude.source).toBe("response_headers");
		expect(claude.windows).toEqual([
			{
				id: "five_hour",
				label: "5-hour limit",
				usedPercent: 25,
				resetsAt: new Date(resetAt * 1000).toISOString(),
				windowMinutes: 300,
				samples: [{ at: new Date(T0).toISOString(), usedPercent: 25 }],
			},
		]);
		// The provider went quiet: the usage endpoint is read and its windows take over.
		await until(() => test.fake.requestsTo("/api/oauth/usage").length === 1);
		await until(() => byProvider(test.changes.at(-1) ?? [], "anthropic").source === "usage_api");
		expect(test.fake.requestsTo("/backend-api/wham/usage")).toHaveLength(0);
	});

	it("skips API keys unless headers give them windows, and drops logged-out providers", async () => {
		const test = await setupService();
		await test.credentials.setApiKey("openai", "sk-test");
		let list = await test.service.usage();
		expect(list.map((usage) => usage.providerId)).toEqual(["anthropic", "openai-codex"]);
		await test.credentials.delete("openai-codex");
		list = await test.service.usage();
		expect(list.map((usage) => usage.providerId)).toEqual(["anthropic"]);
	});
});

describe("OpenCode Go usage", () => {
	it("parses the three windows, with the month as long as the calendar month before its reset", () => {
		const reading = parseOpenCodeGoUsage({
			usage: {
				rolling: { status: "ok", percent: 0, resetsAt: "2026-11-08T02:34:57.000Z" },
				weekly: { status: "ok", percent: 9, resetsAt: "2026-11-09T00:00:00.000Z" },
				monthly: { status: "ok", percent: 4.5, resetsAt: "2026-12-05T15:34:51.000Z" },
			},
		});
		expect(reading.source).toBe("usage_api");
		expect(reading.windows).toEqual([
			{ id: "rolling", label: "5-hour limit", usedPercent: 0, resetsAt: "2026-11-08T02:34:57.000Z", windowMinutes: 300 },
			{ id: "weekly", label: "Weekly limit", usedPercent: 9, resetsAt: "2026-11-09T00:00:00.000Z", windowMinutes: 10_080 },
			{ id: "monthly", label: "Monthly limit", usedPercent: 4.5, resetsAt: "2026-12-05T15:34:51.000Z", windowMinutes: 30 * 1440 },
		]);
		// A 31-day month, February, and a reset on the 31st (the previous month's last day is 30 Nov).
		const monthly = (resetsAt: string) =>
			parseOpenCodeGoUsage({ usage: { monthly: { percent: 1, resetsAt } } }).windows[0]?.windowMinutes;
		expect(monthly("2026-01-05T00:00:00.000Z")).toBe(31 * 1440);
		expect(monthly("2026-03-05T00:00:00.000Z")).toBe(28 * 1440);
		expect(monthly("2026-12-31T00:00:00.000Z")).toBe(31 * 1440);
	});

	it("keeps a window with an unknown percent or reset, skips missing ones, and refuses an empty answer", () => {
		const reading = parseOpenCodeGoUsage({ usage: { rolling: { status: "unavailable" }, monthly: { percent: "7", resetsAt: "nope" } } });
		expect(reading.windows.map((window) => [window.id, window.usedPercent, window.resetsAt, window.windowMinutes])).toEqual([
			["rolling", null, null, 300],
			["monthly", 7, null, null],
		]);
		expect(() => parseOpenCodeGoUsage({ usage: {} })).toThrow("no limits");
		expect(() => parseOpenCodeGoUsage({ error: "x" })).toThrow("usage object");
	});

	async function withOpenCodeGo() {
		const test = await setupService();
		test.models.setProvider(opencodeGoProvider());
		test.models.setProvider(opencodeProvider());
		await test.credentials.setApiKey("opencode-go", "go-key-1");
		return test;
	}

	it("lists an opencode-go API key as a subscription and reads /v1/usage with it", async () => {
		const test = await withOpenCodeGo();
		const list = await test.service.usage({ refresh: true });
		expect(list.map((usage) => usage.providerId)).toEqual(["anthropic", "openai-codex", "opencode-go"]);
		const go = byProvider(list, "opencode-go");
		expect(go).toMatchObject({ label: "OpenCode Go", plan: null, source: "usage_api", error: null });
		expect(go.windows.map((window) => [window.id, window.label, window.usedPercent])).toEqual([
			["rolling", "5-hour limit", 4],
			["weekly", "Weekly limit", 3],
			["monthly", "Monthly limit", 1],
		]);
		expect(go.windows[0]?.samples).toEqual([{ at: new Date(T0).toISOString(), usedPercent: 4 }]);
		expect(test.fake.requestsTo("/v1/usage")[0]?.headers.authorization).toBe("Bearer go-key-1");
	});

	it("leaves out pay-as-you-go API keys, such as the Zen provider and OpenAI", async () => {
		const test = await withOpenCodeGo();
		await test.credentials.setApiKey("opencode", "zen-key");
		await test.credentials.setApiKey("openai", "sk-test");
		const list = await test.service.usage({ refresh: true });
		expect(list.map((usage) => usage.providerId)).toEqual(["anthropic", "openai-codex", "opencode-go"]);
		expect(test.fake.requestsTo("/v1/usage")).toHaveLength(1);
	});

	it("shows a failed read as an error with the last numbers, and drops it when the key is removed", async () => {
		const test = await withOpenCodeGo();
		await test.service.usage({ refresh: true });
		test.fake.state.status.opencodeGo = 401;
		test.fake.state.opencodeGoUsage = { type: "error", error: { message: "Unauthorized" } };
		const go = byProvider(await test.service.usage({ refresh: true }), "opencode-go");
		expect(go.error).toContain("HTTP 401");
		expect(go.error).toContain("log in again");
		expect(go.windows[0]?.usedPercent).toBe(4);
		await test.credentials.delete("opencode-go");
		expect((await test.service.usage()).map((usage) => usage.providerId)).toEqual(["anthropic", "openai-codex"]);
	});
});

describe("subscriptions.usage over the protocol", () => {
	let setup: TestSetup | undefined;
	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	it("answers the request and pushes the change after a refresh", async () => {
		const fake = fakeProviders();
		cleanups.push(() => fake.stop());
		const refreshes: string[] = [];
		setup = await createSetup({
			configureModels: (models) => {
				models.setProvider(subscriptionProvider("anthropic", "claude-refreshed", refreshes));
			},
			subscriptionUsage: { ...fake.urls, pollIntervalMs: 60_000 },
		});
		await setup.credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "claude-old",
			refresh: "r",
			expires: Date.now() + HOUR,
		}));
		const client = await TestClient.open(setup.server);
		cleanups.push(() => client.close());
		const hello = await client.hello();
		expect(hello.type === "hello" ? hello.features : []).toContain("subscription-usage");

		const response = await client.request({ type: "subscriptions.usage", refresh: true });
		if (response.type !== "subscriptions.usage") throw new Error(JSON.stringify(response));
		expect(response.subscriptions.map((usage) => [usage.providerId, usage.windows.length])).toEqual([["anthropic", 3]]);
		const event = await client.waitFor(
			(message) => message.type === "subscriptions.usage.changed" && message.subscriptions[0]?.plan != null,
		);
		if (event.type !== "subscriptions.usage.changed") throw new Error("unreachable");
		expect(event.subscriptions[0]?.plan).toBe("Max 20x");
	});
});
