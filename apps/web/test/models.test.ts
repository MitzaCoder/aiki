/**
 * The shared model search: the filter and provider grouping both composer
 * pickers and the settings page use. The components only render it, so the
 * behaviour is pinned here.
 */
import { describe, expect, test } from "bun:test";
import type { ModelInfo, ProviderInfo } from "@kemiri/protocol";
import { contextSize, groupModels, modelKey, modelOptions, providerName, sameModel } from "../src/lib/models.ts";

function model(overrides: Partial<ModelInfo> & { provider: string; modelId: string }): ModelInfo {
	return {
		provider: overrides.provider,
		modelId: overrides.modelId,
		name: `${overrides.provider} ${overrides.modelId}`,
		contextWindow: 200_000,
		maxTokens: 8_192,
		input: ["text"],
		reasoning: false,
		thinkingLevels: ["off"],
		configured: true,
		...overrides,
	};
}

const PROVIDERS: ProviderInfo[] = [
	{ id: "anthropic", name: "Anthropic", configured: true },
	{ id: "openai", name: "OpenAI", configured: false },
];

const MODELS: ModelInfo[] = [
	model({ provider: "openai", modelId: "gpt-5", name: "GPT-5" }),
	model({ provider: "anthropic", modelId: "claude-sonnet", name: "Claude Sonnet" }),
	model({ provider: "anthropic", modelId: "claude-haiku", name: "Claude Haiku" }),
];

describe("model names", () => {
	test("names a model by provider and ID", () => {
		expect(modelKey({ provider: "anthropic", modelId: "claude-sonnet" })).toBe("anthropic/claude-sonnet");
		expect(sameModel({ provider: "a", modelId: "x" }, { provider: "a", modelId: "x" })).toBe(true);
		expect(sameModel({ provider: "a", modelId: "x" }, { provider: "b", modelId: "x" })).toBe(false);
		expect(sameModel({ provider: "a", modelId: "x" }, { provider: "a", modelId: "y" })).toBe(false);
	});

	test("falls back to the provider ID when the backend lists no name", () => {
		expect(providerName(PROVIDERS, "anthropic")).toBe("Anthropic");
		expect(providerName(PROVIDERS, "local")).toBe("local");
	});
});

describe("groupModels", () => {
	test("keeps the whole catalog, grouped by provider and ordered by provider name", () => {
		const groups = groupModels(MODELS, PROVIDERS);
		expect(groups.map((group) => group.id)).toEqual(["anthropic", "openai"]);
		expect(groups.map((group) => group.label)).toEqual(["Anthropic", "OpenAI"]);
		// Within a provider the catalog's order is kept.
		expect(groups[0]?.models.map((entry) => entry.modelId)).toEqual(["claude-sonnet", "claude-haiku"]);
	});

	test("matches a model's name, ID, provider ID or provider name, ignoring case", () => {
		expect(groupModels(MODELS, PROVIDERS, "haiku")[0]?.models.map((entry) => entry.modelId)).toEqual([
			"claude-haiku",
		]);
		expect(groupModels(MODELS, PROVIDERS, "GPT")[0]?.models.map((entry) => entry.modelId)).toEqual(["gpt-5"]);
		expect(groupModels(MODELS, PROVIDERS, "openai")[0]?.id).toBe("openai");
		expect(groupModels(MODELS, PROVIDERS, "anthropic")[0]?.models).toHaveLength(2);
		expect(groupModels(MODELS, PROVIDERS, "  openai  ")[0]?.id).toBe("openai");
	});

	test("returns no groups when nothing matches", () => {
		expect(groupModels(MODELS, PROVIDERS, "gemini")).toEqual([]);
		expect(groupModels([], PROVIDERS)).toEqual([]);
	});
});

describe("settings model options", () => {
	const providers = [
		{ id: "openai", name: "OpenAI", configured: true },
		{ id: "anthropic", name: "Anthropic", configured: false },
	];
	const make = (provider: string, modelId: string, name: string, configured: boolean, contextWindow: number) => ({
		provider,
		modelId,
		name,
		contextWindow,
		maxTokens: 1000,
		input: ["text" as const],
		reasoning: true,
		thinkingLevels: ["off" as const],
		configured,
	});
	const models = [
		make("openai", "gpt-5", "GPT-5", true, 400_000),
		make("anthropic", "sonnet", "Claude Sonnet", false, 1_000_000),
		make("anthropic", "haiku", "Claude Haiku", false, 200_000),
	];

	test("groups by provider name, models by name, with a chip for a missing credential", () => {
		const options = modelOptions(models, providers);
		expect(options.map((option) => option.label)).toEqual(["Claude Haiku", "Claude Sonnet", "GPT-5"]);
		expect(options[0]).toMatchObject({
			value: "anthropic/haiku",
			groupLabel: "Anthropic",
			description: "haiku · 200k context",
			badge: "no credential",
		});
		expect(options[2]?.badge).toBeUndefined();
	});

	test("shows a context window short", () => {
		expect(contextSize(1_000_000)).toBe("1M");
		expect(contextSize(1_500_000)).toBe("1.5M");
		expect(contextSize(128_000)).toBe("128k");
		expect(contextSize(900)).toBe("900");
	});
});
