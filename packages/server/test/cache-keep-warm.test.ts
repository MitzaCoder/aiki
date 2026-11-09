import { createHarnessModels } from "../src/models.ts";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { cacheWarmAuthFingerprint, cacheWarmHeaders } from "../src/cache-warm-transport.ts";
import { CoordinatorCacheWarm } from "../src/cache-keep-warm.ts";
import type { Conversation, ConversationView as DurableView } from "@earendil-works/pi-durable";
import { describe, expect, it } from "bun:test";
import { CacheWarmSchedule, cacheWarmInterval, type CacheWarmClock } from "../src/cache-warm-schedule.ts";
import { refreshAnthropicCache, supportsCacheWarm, zeroOutputPayload } from "../src/cache-warm-transport.ts";
import { cacheStats, longCacheWhatIf, wakeGroups } from "../src/cache-stats.ts";
import { RequestLogStore, type RequestRow } from "../src/request-log-store.ts";
import type { Model, Models } from "@earendil-works/pi-ai";

class Clock implements CacheWarmClock {
	at = 0; timers = new Map<number, { at: number; callback: () => void }>(); sequence = 0;
	now = () => this.at;
	set = (callback: () => void, delay: number) => { const id = ++this.sequence; this.timers.set(id, { at: this.at + delay, callback }); return id; };
	clear = (id: unknown) => { this.timers.delete(id as number); };
	async advance(ms: number) {
		const end = this.at + ms;
		while (true) { const next = [...this.timers].sort((a,b) => a[1].at-b[1].at)[0]; if (!next || next[1].at > end) break;
			this.at = next[1].at; this.timers.delete(next[0]); next[1].callback(); await Promise.resolve(); await Promise.resolve(); }
		this.at = end;
	}
}
function scenario(ttlMs = 3_600_000, hours = 8, ping?: (signal: AbortSignal) => Promise<boolean>) {
	const clock = new Clock(); let calls = 0; const stops: string[] = [];
	const schedule = new CacheWarmSchedule({ clock, realAt: 0, ttlMs, hours,
		ping: async signal => { calls++; return ping ? ping(signal) : true; }, onStop: reason => stops.push(reason) });
	return { clock, schedule, stops, calls: () => calls };
}
describe("cache keep-warm schedule", () => {
	it("uses the actual cache lifetime", async () => {
		expect(cacheWarmInterval(3_600_000)).toBe(3_000_000); expect(cacheWarmInterval(300_000)).toBe(240_000);
		for (const ttl of [300_000, 3_600_000]) { const s = scenario(ttl); s.schedule.resume(); await s.clock.advance(cacheWarmInterval(ttl)-1); expect(s.calls()).toBe(0); await s.clock.advance(1); expect(s.calls()).toBe(1); }
	});
	it("caps idle from the real request, not from pings", async () => { const s = scenario(3_600_000, 8); s.schedule.resume(); await s.clock.advance(8*3_600_000); expect(s.calls()).toBe(9); expect(s.stops).toEqual(["Idle limit reached"]); });
	it("pauses during a turn and resumes only while warm", async () => { const s = scenario(); s.schedule.resume(); s.schedule.pause(); await s.clock.advance(3_100_000); expect(s.calls()).toBe(0); s.schedule.resume(); await s.clock.advance(0); expect(s.calls()).toBe(1); });
	it("does not catch up a cold cache", async () => { const s = scenario(); await s.clock.advance(4_000_000); s.schedule.resume(); expect(s.calls()).toBe(0); expect(s.stops).toEqual(["Cache expired"]); });
	it("stops at the first cold read or failure", async () => { for (const ping of [async () => false, async () => { throw new Error("429"); }]) { const s = scenario(300_000, 8, ping); s.schedule.resume(); await s.clock.advance(2_000_000); expect(s.calls()).toBe(1); expect(s.stops).toHaveLength(1); } });
	for (const reason of ["Turn started", "Compaction", "Reset", "Model switched", "System prompt changed", "Setting off"]) {
		it(`invalidates and aborts maintenance: ${reason}`, async () => { let signal: AbortSignal | undefined; const s = scenario(300_000, 8, async abort => { signal = abort; return new Promise(() => {}); }); s.schedule.resume(); await s.clock.advance(240_000); s.schedule.stop(reason); expect(signal?.aborted).toBe(true); await s.clock.advance(3_000_000); expect(s.calls()).toBe(1); });
	}
	it("a new process starts unarmed, without catch-up", async () => { const s = scenario(); await s.clock.advance(3_500_000); expect(s.calls()).toBe(0); expect(s.clock.timers.size).toBe(0); });
});

it("preserves the exact prefix, breakpoints, thinking and tools, changing only stream and output limit", async () => {
	const payload = { model: "claude-test", system: [{ type: "text", text: "Stable", cache_control: { type: "ephemeral", ttl: "1h" } }],
		tools: [{ name: "bash", input_schema: { type: "object" } }], messages: [{ role: "user", content: [{ type: "text", text: "Real user", cache_control: { type: "ephemeral", ttl: "1h" } }] }],
		thinking: { type: "adaptive" }, output_config: { effort: "high" }, tool_choice: { type: "auto" }, stream: true, max_tokens: 8192 };
	const model = { provider: "anthropic", api: "anthropic-messages" } as Model<string>;
	let sent: unknown; let optionsSeen: unknown;
	const models = { streamSimple: (_model: unknown, context: unknown, options: { fetch: typeof fetch }) => {
		optionsSeen = context;
		return { result: async () => { const response = await options.fetch("http://fake.invalid", { method: "POST", headers: { authorization: "fake-only" }, body: "pi forces streaming" }); expect(await response.text()).toContain("message_start"); return { usage: { cacheRead: 100 }, stopReason: "length" }; } };
	} } as unknown as Models;
	const context = { messages: [{ role: "user" as const, content: "Real user", timestamp: 1 }] };
	await refreshAnthropicCache({ models, model, context, payload, signal: new AbortController().signal, admit: () => true,
		requestOptions: { fetch: (async (_url: unknown, init?: RequestInit) => { sent = JSON.parse(init?.body as string); expect(new Headers(init?.headers).get("authorization")).toBe("fake-only"); return Response.json({ id: "fake", model: "claude-test", stop_reason: "max_tokens", usage: { cache_read_input_tokens: 100, output_tokens: 0 } }); }) as typeof fetch } });
	expect(sent).toEqual({ ...payload, stream: false, max_tokens: 0 }); expect(optionsSeen).toBe(context); expect(payload.max_tokens).toBe(8192);
});
it("never pings Codex or an API/provider mismatch; refuses incompatible zero-output shapes", () => {
	expect(supportsCacheWarm({ provider: "openai-codex", api: "openai-codex-responses" })).toBe(false);
	expect(supportsCacheWarm({ provider: "anthropic", api: "openai-responses" })).toBe(false);
	expect(supportsCacheWarm({ provider: "other", api: "anthropic-messages" })).toBe(false);
	for (const payload of [{ thinking: { type: "enabled" } }, { tool_choice: { type: "any" } }, { output_config: { format: {} } }]) expect(zeroOutputPayload(payload)).toBeUndefined();
});

it("keeps refresh spend separate from requests, misses, wakes and what-if", () => {
	const row: RequestRow = { projectId: "p", conversationId: 1, kind: "main", threadId: "main", workerId: null, taskId: null, scheduleId: null,
		at: 1, provider: "anthropic", model: "test", stopReason: "length", input: 2, cacheRead: 100, cacheWrite: 0, cacheWrite1h: 0,
		output: 0, cost: .04, costInput: 0, costOutput: 0, costCacheRead: .04, costCacheWrite: 0, promptTokens: 102,
		idleMs: 100, missTokens: 0, missCost: 0, missReason: null, wake: null, retention: "long", changes: null, source: "keepWarm", durationMs: 10 };
	const stats = cacheStats({ rows: [row], from: 0, to: 100, liveSince: 0, projectNames: new Map() });
	expect(stats.totals.requests).toBe(0); expect(stats.totals.misses).toBe(0); expect(stats.totals.cost).toBe(.04);
	expect(stats.keepWarm).toEqual({ refreshes: 1, cachedTokens: 100, cost: .04, failedWriteCost: 0 });
	expect(wakeGroups([row])).toEqual([]); expect(longCacheWhatIf([row], undefined).requests).toBe(0);
	const store = RequestLogStore.open(":memory:");
	try { store.recordWarm(row, { id: "stretch", anchorEntryId: 12, startedAt: 0, lastAt: 1, attempts: 1, refreshes: 1, cachedTokens: 100, cost: .04 });
		expect(store.warmStretches("p",1)[0]?.anchorEntryId).toBe(12); expect(store.previousRequest("p",1)).toBeUndefined(); expect(store.lastRequestAt("p",1)).toBeUndefined();
	} finally { store.close(); }
});


it("the coordinator watch stops real scheduling on turn, compaction, reset, model and instructions changes without a transcript write", async () => {
    for (const change of ["turn", "queue", "compaction", "reset", "model", "system", "disable", "cold"]) {
        const clock = new Clock();
        const store = RequestLogStore.open(":memory:");
        const warming = new CoordinatorCacheWarm(store, clock);
        let enabled = true;
        let callback: (view: DurableView) => Promise<void> = async () => {};
        const view = { conversation: { id: 1 }, entries: [{ id: 2, conversationId: 1, kind: "pi.assistant" }], docs: { "pi.agent": { model: "claude" }, "pi.live": {} } } as unknown as DurableView;
        let close: () => void = () => {};
        const closed = new Promise<void>(resolve => { close = resolve; });
        const conversation = { watch: async () => ({ value: view, start: (f: typeof callback) => { callback = f; }, stop: async () => { close(); }, closed }) } as unknown as Conversation;
        warming.register("p", { settings: () => ({ keepPromptCacheWarm: enabled, promptCacheWarmHours: 8 }), conversation: async () => conversation });
        let sent = 0;
        const models = { streamSimple: (_model: unknown, _context: unknown, options: { fetch: typeof fetch }) => ({ result: async () => {
            await options.fetch("http://fake.invalid", { method: "POST" }); sent++;
            return { usage: { input: 0, output: 0, cacheRead: change === "cold" ? 0 : 100, cacheWrite: 0,
                cost: { input: 0, output: 0, cacheRead: .04, cacheWrite: 0, total: .04 } }, stopReason: "length" };
        } }) } as unknown as Models;
        const row = { projectId: "p", conversationId: 1, kind: "main", at: 0, cacheRead: 0, cacheWrite: 100, cacheWrite1h: 100,
            provider: "anthropic", model: "test", stopReason: "stop" } as RequestRow;
        await warming.real({ row, models, model: { provider: "anthropic", api: "anthropic-messages" } as Model<string>, context: { messages: [] }, payload: { messages: [], thinking: { type: "adaptive" } },
            options: { fetch: (async () => Response.json({ id: "fake", usage: { cache_read_input_tokens: 100 }, stop_reason: "max_tokens" })) as unknown as typeof fetch } });
        await clock.advance(3_000_000);
        for (let n = 0; n < 10; n++) await Promise.resolve();
        expect(sent).toBe(1);
        expect(store.rows({ from: 0, to: clock.at+1 })[0]?.source).toBe("keepWarm");
        const before = JSON.stringify(view.entries);
        if (change === "disable") enabled = false;
        if (change === "queue") (view.docs as Record<string,unknown>)["pi.inbox"] = { items: [{ id: 1, mode: "followUp" }] };
        if (change === "turn") (view.docs as Record<string,unknown>)["pi.live"] = { run: 1 };
        if (change === "model") (view.docs as Record<string,unknown>)["pi.agent"] = { model: "codex" };
        if (["compaction", "reset", "system"].includes(change)) (view.entries as unknown as unknown[]).push({ id: 3, kind: `pi.${change}` });
        await callback(view);
        await clock.advance(8 * 3_600_000);
        expect(sent).toBe(1);
        if (["turn", "disable", "model", "cold"].includes(change)) expect(JSON.stringify(view.entries)).toBe(before);
        warming.close(); store.close();
    }
});


it("restores a still-live schedule from its private snapshot, without a startup burst or changing the idle cap", async () => {
    const clock = new Clock(); const store = RequestLogStore.open(":memory:");
    let prefix = "same-system-and-tools"; let sent = 0;
    const model = { id: "test", provider: "anthropic", api: "anthropic-messages" } as Model<string>;
    const models = { getModel: () => model, streamSimple: () => ({ result: async () => { sent++; return { usage: { input: 0, output: 0, cacheRead: 100, cacheWrite: 0,
        cost: { input: 0, output: 0, cacheRead: .04, cacheWrite: 0, total: .04 } }, stopReason: "length" }; } }) } as unknown as Models;
    const project = { settings: () => ({ keepPromptCacheWarm: true, promptCacheWarmHours: 8 }), prefixRevision: async () => prefix,
        conversation: async () => ({ watch: async () => ({ value: { conversation: { id: 1 }, entries: [{ id: 2, kind: "pi.assistant" }], docs: { "pi.agent": {}, "pi.live": {} } },
            start: () => {}, stop: async () => {}, closed: new Promise(() => {}) }) } as unknown as Conversation) };
    const first = new CoordinatorCacheWarm(store, clock); first.useModels(models); first.register("p", project);
    await first.real({ models, model, row: { projectId: "p", conversationId: 1, kind: "main", provider: "anthropic", model: "test", at: 0,
        stopReason: "stop", cacheRead: 0, cacheWrite: 100, cacheWrite1h: 100 } as RequestRow, context: { messages: [] }, options: {}, payload: { messages: [] } });
    await clock.advance(3_000_000); for (let n=0;n<10;n++) await Promise.resolve(); expect(sent).toBe(1);
    first.unregister("p", true);
    expect(store.warmSnapshots("p")).toHaveLength(1);
    await clock.advance(3_200_000);
    const restarted = new CoordinatorCacheWarm(store, clock); restarted.useModels(models); restarted.register("p", project);
    await restarted.restore("p"); expect(sent).toBe(1);
    await clock.advance(29_999); expect(sent).toBe(1);
    await clock.advance(30_002); for(let n=0;n<10;n++) await Promise.resolve(); expect(sent).toBe(2);
    expect(store.warmStretches("p",1)).toHaveLength(1);
    expect(store.warmStretches("p",1)[0]?.refreshes).toBe(2);
    restarted.unregister("p", true);
    prefix = "edited-AGENTS";
    const changed = new CoordinatorCacheWarm(store, clock); changed.useModels(models); changed.register("p", project);
    await changed.restore("p"); await clock.advance(4_000_000); expect(sent).toBe(2); expect(store.warmSnapshots("p")).toHaveLength(0);
    changed.close(); store.close();
});


it("adapts the real pi-ai Anthropic auth/build/parser stack with fake HTTP only", async () => {
    const models = createHarnessModels({ credentials: { read: async () => ({ type: "api_key", key: "fake-test-only" }) } as unknown as CredentialStore });
    const model = models.getModels("anthropic")[0]!;
    const context = { messages: [{ role: "system" as const, content: "Exact stable system", timestamp: 0 }, { role: "user" as const, content: "Real input", timestamp: 1 }] };
    let original: Record<string,unknown> = {}; let fingerprint = ""; let cacheHeaders: Record<string,string> = {};
    const event = (type: string, payload: unknown) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    const requestOptions = { sessionId: "cache-warm-unit-test", cacheRetention: "long" as const, reasoning: "low" as const };
    const first = await models.streamSimple(model, context, { ...requestOptions,
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init); original = JSON.parse(await request.text()); fingerprint = cacheWarmAuthFingerprint(request.headers); cacheHeaders = cacheWarmHeaders(request.headers);
            expect(request.headers.get("x-api-key")).toBe("fake-test-only");
            return new Response(event("message_start", { type: "message_start", message: { id: "fake-real", model: model.id, role: "assistant", content: [],
                usage: { input_tokens: 2, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 100 } } } }) +
                event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } }) + event("message_stop", { type: "message_stop" }), { headers: { "content-type": "text/event-stream" } });
        }) as typeof fetch }).result();
    expect(first.stopReason).toBe("stop"); expect(first.usage.cacheWrite).toBe(100);
    const response = await refreshAnthropicCache({ models, model, context, requestOptions: { ...requestOptions,
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init); const body = JSON.parse(await request.text());
            expect(body).toEqual({ ...original, stream: false, max_tokens: 0 });
            expect(cacheWarmAuthFingerprint(request.headers)).toBe(fingerprint);
            return Response.json({ id: "fake-maintenance", model: model.id, role: "assistant", type: "message", content: [], stop_reason: "max_tokens",
                usage: { input_tokens: 2, output_tokens: 0, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } });
        }) as typeof fetch }, payload: original, authFingerprint: fingerprint, cacheHeaders, signal: new AbortController().signal, admit: () => true });
    expect(response.errorMessage).toBeUndefined(); expect(response.stopReason).toBe("length"); expect(response.content).toEqual([]); expect(response.usage.cacheRead).toBe(100); expect(response.usage.cacheWrite).toBe(0); expect(response.usage.output).toBe(0);
    expect(response.usage.cost.cacheRead).toBeGreaterThan(0);
});
