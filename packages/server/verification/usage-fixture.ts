/** Throwaway T78 demo. Only synthetic rows and a fake subscription; no provider requests. */
import { createSetup } from "../test/support.ts";
import { ConversationRequests } from "../src/request-log.ts";
import { createProvider } from "@earendil-works/pi-ai";
import { lazyApi } from "@earendil-works/pi-ai/api/lazy";
import { writeFile } from "node:fs/promises";
const now = Date.now();
let resetsRemaining = 3;
let fullRemaining = 1;
let posts = 0;
const spent = new Set<string>();
const fake = Bun.serve({
	port: 0,
	fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;
		if (path === "/fixture-stats") return Response.json({ posts, resetsRemaining, fullRemaining });
		if (req.method === "POST") {
			if (path !== "/api/organizations/org-synthetic/reset_rate_limits") return new Response("Unexpected spend", { status: 400 });
			return req.json().then((body) => {
				if (body.program !== "cedar_ember" || !body.request_id) return new Response("Invalid spend", { status: 400 });
				if (body.grant_id === "synthetic-full") fullRemaining--;
				else if (/^synthetic-fable-[0-2]$/.test(body.grant_id) && !spent.has(body.grant_id)) {
					spent.add(body.grant_id);
					resetsRemaining--;
				}
				else return new Response("Unknown grant", { status: 400 });
				posts++;
				return Response.json({ result: "reset" });
			});
		}
		if (path.endsWith("/profile"))
			return Response.json({
				account: { has_claude_pro: true },
				organization: { organization_type: "claude_pro", uuid: "org-synthetic" },
			});
		if (url.searchParams.has("cedar_ember"))
			return Response.json({
				eligible: req.headers.get("user-agent") !== "claude-code/2.1.0",
				ineligible_reason: req.headers.get("user-agent") === "claude-code/2.1.0" ? "surface" : null,
				grants: req.headers.get("user-agent") === "claude-code/2.1.0" ? [] : [
					{ id: "synthetic-full", label: "Full reset", resets_left: fullRemaining, usable_now: true, clears: ["five_hour", "seven_day", "seven_day_overage_included"], ends_at: "2026-12-10T22:00:00Z" },
					...Array.from({ length: 3 }, (_, index) => ({
						id: `synthetic-fable-${index}`,
						label: `Synthetic Fable grant ${index + 1}`,
						type: "full",
						gives_back_weekly: true,
						resets_left: spent.has(`synthetic-fable-${index}`) ? 0 : 1,
						usable_now: true,
						clears: ["five_hour", "seven_day_overage_included"],
						ends_at: "2027-03-09T07:59:00Z",
					})),
				],
			});
		return Response.json({
			cedar_ember: null,
			five_hour: { utilization: posts ? 0 : 62, resets_at: new Date(now + 7200000).toISOString() },
			seven_day: { utilization: fullRemaining === 0 ? 0 : posts ? 20 : 34, resets_at: new Date(now + 3 * 86400000).toISOString() },
		});
	},
});
const setup = await createSetup({
	allowedOrigins: ["http://localhost:5288"],
	configureModels(models) {
		models.setProvider(
			createProvider({
				id: "anthropic",
				name: "Claude (synthetic)",
				models: [],
				auth: {
					oauth: {
						name: "Synthetic subscription",
						isSubscription: true,
						async login() {
							throw Error("No login");
						},
						async refresh(c) {
							return c;
						},
						async toAuth(c) {
							return { apiKey: c.access };
						},
					},
				},
				api: lazyApi(async () => {
					throw Error("No inference");
				}),
			}),
		);
	},
	subscriptionUsage: {
		anthropicBaseUrl: `http://localhost:${fake.port}`,
		fetch: ((input, init) => {
			if (new URL(String(input)).origin !== `http://localhost:${fake.port}`) throw Error("Fixture refuses non-local provider traffic");
			return fetch(input, init);
		}) as typeof fetch,
	},
});
await setup.credentials.modify("anthropic", async () => ({
	type: "oauth",
	access: "synthetic",
	refresh: "synthetic",
	expires: now + 86400000,
}));
await setup.server.requestLogBackfill;
const store = setup.server.requestLog!.store;
const roles = ["main", "worker", "thread", "worker"] as const;
for (let project = 0; project < 2; project++)
	for (let conversation = 0; conversation < 4; conversation++) {
		const kind = roles[conversation]!;
		const requests = new ConversationRequests({
			projectId: ["sample-garden", "sample-library"][project]!,
			conversationId: project * 10 + conversation + 1,
			identity: {
				kind,
				threadId: kind === "thread" ? "research" : null,
				workerId: kind === "worker" ? `worker-${conversation}` : null,
				taskId: kind === "worker" ? `T${conversation + 1}` : null,
				scheduleId: conversation === 3 ? "nightly" : null,
			},
		});
		for (let index = 0; index < 18; index++) {
			const cacheRead = index % 4 === 0 ? 0 : 40000;
			const row = requests.request(
				{
					provider: conversation % 2 ? "openai-codex" : "anthropic",
					model: conversation % 2 ? "gpt-5.4" : "claude-sonnet-4-6",
					timestamp: now - (17 - index) * 6 * 3600000 - project * 60000,
					stopReason: index === 13 ? "aborted" : "stop",
					usage: {
						input: 6000,
						cacheRead,
						cacheWrite: cacheRead ? 2000 : 42000,
						output: 2500,
						cost: {
							input: 0.018,
							cacheRead: cacheRead * 0.0000003,
							cacheWrite: cacheRead ? 0.0075 : 0.1575,
							output: 0.0375,
							total: cacheRead ? 0.075 : 0.213,
						},
					},
				},
				{
					wake: kind === "main" ? "check_in" : index === 0 ? "brief" : "continue",
					retention: "short",
					changes: index % 4 === 0 ? ["section:skills"] : [],
					source: "live",
				},
			);
			store.insert(row);
			if (index % 5 === 0 && kind === "main")
				store.insert({
					...row,
					at: row.at + 1000,
					source: "keepWarm",
					input: 0,
					cacheRead: 48000,
					cacheWrite: 0,
					output: 0,
					cost: 0.0144,
					costInput: 0,
					costCacheRead: 0.0144,
					costCacheWrite: 0,
					costOutput: 0,
					missTokens: 0,
					missCost: 0,
					missReason: null,
				});
		}
	}
for (const purpose of ["compaction", "memory_extraction", "memory_maintenance"] as const) {
	const requests = new ConversationRequests({
		projectId: purpose === "memory_maintenance" ? "backend-maintenance" : "sample-garden",
		conversationId: 0,
		identity: { kind: "other", threadId: null, workerId: null, taskId: null, scheduleId: null },
	});
	const row = requests.request(
		{
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			timestamp: now - 3600000,
			stopReason: "stop",
			usage: { input: 50000, output: 5000, cost: { input: 0.15, output: 0.075, total: 0.225 } },
		},
		{ wake: null, retention: "none", changes: null, source: "live" },
	);
	store.insert({ ...row, purpose });
}
console.log("Temporary fixture paths", setup.dataDir, setup.configDir);
await writeFile(Bun.argv[2] ?? "/tmp/aiki-t78-fixture.json", JSON.stringify({ url: setup.server.url, fakeUrl: `http://localhost:${fake.port}`, pid: process.pid }));
console.log("Synthetic usage fixture ready", setup.server.url);
process.on("SIGTERM", async () => {
	fake.stop(true);
	await setup.cleanup();
	process.exit(0);
});
await new Promise(() => {});
