/**
 * pi-ai model access for the harness: the providers from the design, credential-backed, plus a catalog for the
 * client. No model defaults live here or anywhere else: the client picks every model.
 */
import {
	type Api,
	type AuthCheck,
	type CredentialStore,
	createModels,
	type Models,
	type Model,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { withModelCatalogExtensions } from "./model-catalog-extensions.ts";
import {
	THINKING_LEVELS,
	type ModelInfo,
	type ModelRef,
	type ProviderInfo,
	type ThinkingLevel,
} from "@aiki/protocol";

/** The providers the harness exposes to clients. */
/**
 * `openai-codex` is the Codex CLI's ChatGPT login, which pi-ai calls legacy. It stays because a ChatGPT workspace
 * account gets "Your organization hasn't enabled access for this app" from Sign in with ChatGPT (`openai`).
 */
export const HARNESS_PROVIDERS = ["opencode-go", "anthropic", "openai", "openai-codex"] as const;

export function createHarnessModels(options: { credentials: CredentialStore }): Models {
	const models = createModels({ credentials: options.credentials });
	// Side-effect free factories: their API SDKs load lazily on the first request.
	models.setProvider(opencodeGoProvider());
	const anthropic = withModelCatalogExtensions(anthropicProvider());
	// Provider-side model switches require an explicit product choice, not a catalog upgrade.
	const withoutFallbacks = <T extends Model<Api>>(model: T): T => model.compat && "allowedFallbackModels" in model.compat && model.compat.allowedFallbackModels?.length
		? { ...model, compat: { ...model.compat, allowedFallbackModels: [] } } : model;
	models.setProvider({
		...anthropic,
		getModels: () => anthropic.getModels().map(withoutFallbacks),
		getAllModels: () => (anthropic.getAllModels?.() ?? anthropic.getModels()).map(model =>
			model.type === undefined || model.type === "chat" ? withoutFallbacks(model) : model),
	});
	models.setProvider(openaiProvider());
	models.setProvider(openaiCodexProvider());
	return models;
}

export type ModelCatalog = {
	providers: ProviderInfo[];
	models: ModelInfo[];
};

function thinkingLevelsOf(model: Model<string>): ThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return THINKING_LEVELS.filter((level) => model.thinkingLevelMap?.[level] !== null);
}

/** Every chat model of the registered providers, with whether its provider has a credential. */
export async function describeModels(models: Models): Promise<ModelCatalog> {
	const providers = models.getProviders();
	const auth = new Map<string, AuthCheck | undefined>();
	await Promise.all(
		providers.map(async (provider) => {
			try {
				auth.set(provider.id, await models.checkAuth(provider.id));
			} catch {
				// A credential store failure means "not configured" for listing; request paths report it in detail.
				auth.set(provider.id, undefined);
			}
		}),
	);

	const providerInfos: ProviderInfo[] = providers.map((provider) => {
		const check = auth.get(provider.id);
		const oauth = provider.auth.oauth;
		return {
			id: provider.id,
			name: provider.name,
			configured: check !== undefined,
			...(check === undefined ? {} : { authType: check.type }),
			...(oauth === undefined
				? {}
				: {
						oauth: {
							name: oauth.name,
							loginLabel: oauth.loginLabel ?? oauth.name,
							isSubscription: oauth.isSubscription === true,
						},
					}),
		};
	});

	const modelInfos: ModelInfo[] = [];
	for (const provider of providers) {
		const configured = auth.get(provider.id) !== undefined;
		for (const model of provider.getModels()) {
			modelInfos.push({
				provider: provider.id,
				modelId: model.id,
				api: model.api,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				input: [...model.input],
				reasoning: model.reasoning,
				thinkingLevels: thinkingLevelsOf(model),
				configured,
			});
		}
	}

	return { providers: providerInfos, models: modelInfos };
}

/** A model is usable only when a provider lists it; the protocol rejects unknown refs at configure time. */
export function findModel(models: Models, ref: ModelRef): Model<string> | undefined {
	return models.getModel(ref.provider, ref.modelId);
}
