import { describe, expect, it } from "bun:test";
import { calculateCost, createModels, InMemoryCredentialStore, type Model, type Usage } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { withModelCatalogExtensions } from "../src/model-catalog-extensions.ts";
import { createHarnessModels, describeModels, findModel } from "../src/models.ts";
import { createSetup, TestClient } from "./support.ts";

const ref = { provider: "anthropic", modelId: "claude-fable-5-2" };
const credentials = () => new InMemoryCredentialStore();
const fable = () => findModel(createHarnessModels({ credentials: credentials() }), ref)! as Model<"anthropic-messages">;

const usage = (hour = false): Usage => ({
	input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000,
	cacheWrite1h: hour ? 1_000_000 : 0, totalTokens: 4_000_000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

describe("local model catalog extensions", () => {
	it("registers Fable 5.2 for runtime lookup, availability and both client catalogs", async () => {
		const store = credentials();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "not-a-real-key" }));
		const models = createHarnessModels({ credentials: store });
		const model = findModel(models, ref)!;
		expect(model).toMatchObject({ id: ref.modelId, name: "Claude Fable 5.2", api: "anthropic-messages", contextWindow: 1_000_000, maxTokens: 128_000, promptCache: { short: 300, long: 3600 } });
		expect(models.getAllModels("anthropic").filter((entry) => entry.id === ref.modelId)).toEqual([model]);
		expect((await models.getAvailable("anthropic")).filter((entry) => entry.id === ref.modelId)).toEqual([model]);
		const catalog = await describeModels(models);
		expect(catalog.models.find((entry) => entry.modelId === ref.modelId)).toMatchObject({ ...ref, name: "Claude Fable 5.2", configured: true, contextWindow: 1_000_000, maxTokens: 128_000, input: ["text", "image"], thinkingLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] });
	});

	it("prices input/output and both cache TTLs through pi-ai's cost calculator", () => {
		expect(calculateCost(fable(), usage())).toEqual({ input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10, total: 58.2 });
		expect(calculateCost(fable(), usage(true)).cacheWrite).toBe(16);
	});

	it("keeps native thinking/system/tool/effort support and disables unsupported sampling", () => {
		expect(fable().compat).toMatchObject({ forceAdaptiveThinking: true, supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true, supportsMidConvoEffort: true, supportsTemperature: false });
		expect(fable().thinkingLevelMap).toMatchObject({ off: null, xhigh: "xhigh", max: "max" });
		expect(fable().compat?.allowedFallbackModels).toBeUndefined();
	});

	it("automatically yields to upstream without duplicates or overriding metadata", () => {
		const provider = anthropicProvider();
		let native = [...provider.getModels()];
		const extended = withModelCatalogExtensions({ ...provider, getModels: () => native, getAllModels: () => native });
		expect(extended.getModels().filter((entry) => entry.id === ref.modelId)).toHaveLength(1);
		const upstream = { ...fable(), name: "Upstream Fable", cost: { input: 7, output: 35, cacheRead: 0.1, cacheWrite: 9 }, compat: { supportsTemperature: true } } as Model<"anthropic-messages">;
		native = [...native, upstream];
		for (const catalog of [extended.getModels(), extended.getAllModels!()]) {
			expect(catalog.filter((entry) => entry.id === ref.modelId)).toEqual([upstream]);
			expect(catalog.find((entry) => entry.id === ref.modelId)).toBe(upstream);
		}
	});

	it("does not mutate Fable 5.1 or unrelated providers", () => {
		const provider = anthropicProvider();
		const base = provider.getModels().find((model) => model.id === "claude-fable-5-1")!;
		const before = structuredClone(base);
		withModelCatalogExtensions(provider).getModels();
		expect(base).toEqual(before);
		const unrelated = { ...provider, id: "unrelated" };
		expect(withModelCatalogExtensions(unrelated)).toBe(unrelated);
	});

	it("returns the model through models.list on a throwaway WebSocket server", async () => {
		const setup = await createSetup({ configureModels: (models) => models.setProvider(withModelCatalogExtensions(anthropicProvider())) });
		const client = await TestClient.open(setup.server);
		try {
			await client.hello();
			const catalog = await client.request({ type: "models.list" });
			if (catalog.type !== "models.list") throw new Error(`Unexpected ${catalog.type}`);
			expect(catalog.models.find((model) => model.modelId === ref.modelId)).toMatchObject({ ...ref, name: "Claude Fable 5.2", contextWindow: 1_000_000, maxTokens: 128_000 });
		} finally {
			client.close();
			await setup.cleanup();
		}
	});

	it("builds adaptive, prefix-safe requests without sending any network request", async () => {
		const models = createModels();
		models.setProvider(withModelCatalogExtensions(anthropicProvider()));
		let payload: Record<string, unknown> | undefined;
		let fetches = 0;
		await models.completeSimple(fable(), {
			messages: [
				{ role: "system", timestamp: 0, content: "Stable instructions", toolsAdded: [{ name: "read", description: "Read", parameters: { type: "object", properties: {} } }] },
				{ role: "user", content: "Hello", timestamp: 0 },
				{ role: "system", timestamp: 1, content: "New instructions", toolsAdded: [{ name: "write", description: "Write", parameters: { type: "object", properties: {} } }] },
			],
		}, {
			apiKey: "not-a-real-key", reasoning: "xhigh", temperature: 0.5, cacheRetention: "long",
			onPayload: (body) => { payload = body as Record<string, unknown>; throw new Error("Captured locally; never send"); },
			fetch: Object.assign(async () => { fetches++; throw new Error("Network forbidden"); }, { preconnect: () => undefined }),
		});
		expect(fetches).toBe(0);
		expect(payload).toMatchObject({ model: ref.modelId, max_tokens: 128_000, thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } }, output_config: { effort: "high" } });
		expect(payload?.betas).toEqual(expect.arrayContaining(["thinking-binding-controls-2026-08-01", "inline-tools-2026-09-15", "mid-conversation-output-config-2026-07-01"]));
		expect(payload?.temperature).toBeUndefined();
		expect(payload?.fallbacks).toBeUndefined();
		expect(payload?.tool_choice).toBeUndefined();
		const wire = JSON.stringify(payload);
		expect(wire).toContain('"effort":"xhigh"');
		expect(wire).toContain('"tool_addition"');
		expect(wire).toContain("New instructions");
		expect(wire).toContain('"ttl":"1h"');
	});
});
