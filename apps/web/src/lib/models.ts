/**
 * The model catalog as the app's pickers show it: a search over every model a
 * backend offers, grouped by provider. Pure, so the composer's pickers and the
 * project settings page share one search and it can be tested without a
 * component.
 */
import type { ModelInfo, ModelRef, ProviderInfo } from "@mihai-harness/protocol";
import type { ComboOption } from "./combobox.ts";

/** How a model is named on the wire and in a list key: `provider/modelId`. */
export function modelKey(model: ModelRef): string {
	return `${model.provider}/${model.modelId}`;
}

export function sameModel(left: ModelRef, right: ModelRef): boolean {
	return left.provider === right.provider && left.modelId === right.modelId;
}

/** A provider's display name, or its ID when the backend did not list it. */
export function providerName(providers: readonly ProviderInfo[], id: string): string {
	return providers.find((provider) => provider.id === id)?.name ?? id;
}

export type ModelGroup = {
	id: string;
	label: string;
	models: ModelInfo[];
};

/**
 * The models matching `query` (matched against name, ID and provider), grouped by
 * provider and ordered by the provider's display name. No query means the whole
 * catalog, in the order the backend listed it.
 */
export function groupModels(
	models: readonly ModelInfo[],
	providers: readonly ProviderInfo[],
	query = "",
): ModelGroup[] {
	const needle = query.trim().toLowerCase();
	const matches = models.filter(
		(model) =>
			needle.length === 0 ||
			`${model.name} ${model.modelId} ${model.provider} ${providerName(providers, model.provider)}`
				.toLowerCase()
				.includes(needle)
	);
	const byProvider = new Map<string, ModelInfo[]>();
	for (const model of matches) {
		const list = byProvider.get(model.provider) ?? [];
		list.push(model);
		byProvider.set(model.provider, list);
	}
	return [...byProvider.entries()]
		.map(([id, list]) => ({ id, label: providerName(providers, id), models: list }))
		.sort((left, right) => left.label.localeCompare(right.label));
}

/** A context window the way a list shows it: "200k", "1M". */
export function contextSize(tokens: number): string {
	if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
	return String(tokens);
}

/**
 * The catalog as combobox options: one group per provider (ordered by the provider's name), models by name, the
 * model's ID and context window under its name and a chip when its provider has no credential yet.
 */
export function modelOptions(models: readonly ModelInfo[], providers: readonly ProviderInfo[]): ComboOption[] {
	return [...models]
		.sort(
			(left, right) =>
				providerName(providers, left.provider).localeCompare(providerName(providers, right.provider)) ||
				left.name.localeCompare(right.name),
		)
		.map((model) => ({
			value: modelKey(model),
			label: model.name,
			description: `${model.modelId} · ${contextSize(model.contextWindow)} context`,
			group: model.provider,
			groupLabel: providerName(providers, model.provider),
			keywords: model.provider,
			...(model.configured ? {} : { badge: "no credential", badgeTone: "warn" as const }),
		}));
}
