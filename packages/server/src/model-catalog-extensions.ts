/** Temporary catalog entries until pi-ai ships them. Native entries always win, including their compat flags. */
import type { Api, Model, Provider } from "@earendil-works/pi-ai";

type ModelCatalogExtension = {
	provider: string;
	baseModelId: string;
	model: Pick<Model<Api>, "id" | "name" | "cost" | "contextWindow" | "maxTokens">;
	compat?: Model<Api>["compat"];
};

/** Prices are USD per million tokens. 1h writes are calculated by pi-ai as twice the input price.
 * Source: https://platform.claude.com/docs/en/models/fable-5-2/overview (2026-11-09).
 * Keep native mid-conversation system/tools/effort and always-on adaptive thinking from Fable 5.1.
 * pi-ai already sends thinking-binding-controls + drop_block for prefix edits (e.g. compaction).
 * No classifier fallback is enabled: pi-ai's explicit fallback array isn't the documented `"default"`.
 */
export const MODEL_CATALOG_EXTENSIONS: readonly ModelCatalogExtension[] = [
	{ provider: "anthropic", baseModelId: "claude-fable-5-1", model: { id: "claude-fable-5-2", name: "Claude Fable 5.2", cost: { input: 8, output: 40, cacheRead: 0.20, cacheWrite: 10 }, contextWindow: 1_000_000, maxTokens: 128_000 }, compat: { supportsTemperature: false } },
];

/** Extend the provider, not just models.list: runtime lookup, costs, caches and both clients share this catalog. */
export function withModelCatalogExtensions(provider: Provider): Provider {
	const extensions = MODEL_CATALOG_EXTENSIONS.filter((extension) => extension.provider === provider.id);
	if (extensions.length === 0) return provider;

	const extraModels = (nativeModels: readonly Model<Api>[]): Model<Api>[] => {
		const extra: Model<Api>[] = [];
		for (const extension of extensions) {
			if (nativeModels.some((model) => model.id === extension.model.id)) continue;
			const base = nativeModels.find((model) => model.id === extension.baseModelId);
			if (base === undefined) continue; // A removed base must not break the provider's synchronous catalog.
			extra.push({ ...base, ...extension.model, compat: { ...base.compat, ...extension.compat } });
		}
		return extra;
	};

	return {
		...provider,
		getModels: () => {
			const nativeModels = provider.getModels();
			return [...nativeModels, ...extraModels(nativeModels)];
		},
		getAllModels: () => [...(provider.getAllModels?.() ?? provider.getModels()), ...extraModels(provider.getModels())],
	};
}
