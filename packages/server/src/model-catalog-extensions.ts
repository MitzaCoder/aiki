/** Temporary catalog entries until pi-ai ships them. Native entries always win, including their compat flags. */
import type { Api, Model, Provider } from "@earendil-works/pi-ai";

export type ModelCatalogExtension = {
	provider: string;
	baseModelId: string;
	model: Pick<Model<Api>, "id" | "name" | "cost" | "contextWindow" | "maxTokens">;
	compat?: Model<Api>["compat"];
};

export const MODEL_CATALOG_EXTENSIONS: readonly ModelCatalogExtension[] = [];

/** Extend the provider, not just models.list: runtime lookup, costs, caches and both clients share this catalog. */
export function withModelCatalogExtensions(provider: Provider, catalog: readonly ModelCatalogExtension[] = MODEL_CATALOG_EXTENSIONS): Provider {
	const extensions = catalog.filter((extension) => extension.provider === provider.id);
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
