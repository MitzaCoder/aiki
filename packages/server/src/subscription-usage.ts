/**
 * Subscription usage: the rate-limit windows of every logged-in subscription, read from the provider and sampled over
 * each window's current period (`packages/protocol/src/subscription-usage.ts`).
 *
 * Two sources feed one state per provider:
 * - the provider's usage endpoint, the one its own CLI shows: Claude Code's `/usage` (`GET /api/oauth/usage` on
 *   api.anthropic.com), Codex CLI's `/status` (`GET /wham/usage` on chatgpt.com/backend-api) and, for OpenCode Go
 *   (an API-key plan, the only API-key provider here), `GET /v1/usage` on opencode.ai/inference/go with the key. Read every few minutes
 *   while a client is connected, shortly after a provider's requests go quiet, and on `refresh`.
 * - the rate-limit headers of the harness's own model requests (`anthropic-ratelimit-unified-*`, `x-codex-*`) and
 *   Codex's `codex.rate_limits` stream event, seen through `observeModels`. They keep the numbers current between reads
 *   and are the only source for a provider without a usage endpoint.
 *
 * Samples and the last numbers persist in `subscription-usage.json` in the data directory, so a restart keeps the
 * history. A failed read sets `error` and keeps the last numbers; a 429 holds off until its `retry-after`.
 */
import { join } from "node:path";
import type { CredentialStore, Models } from "@earendil-works/pi-ai";
import { PROTOCOL_SCHEMAS, type SubscriptionUsage, type UsageSample, type UsageWindow } from "@aiki/protocol";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { consumeReset, discoverResets, type ResetTransport } from "./subscription-resets.ts";
import type { SubscriptionResets, SubscriptionsResetRequest } from "@aiki/protocol";
import { errorMessage } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";

export const SUBSCRIPTION_USAGE_FILE = "subscription-usage.json";
export const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com";
export const CHATGPT_BACKEND_BASE_URL = "https://chatgpt.com/backend-api";
/** pi-ai's `opencode-go` base URL minus `/v1`; `/v1/usage` answers there and on the older `/zen/go`. */
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/inference/go";
/**
 * API-key providers that are a plan with limits, not pay-as-you-go: only these are listed for an API key. Everything
 * else with a key (anthropic, openai, the `opencode` Zen provider) has no plan windows and stays out.
 */
const API_KEY_PLAN_PROVIDERS: ReadonlySet<string> = new Set(["opencode-go"]);
/** Claude Code's OAuth beta; the usage and profile endpoints refuse a request without it. */
const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const OPENAI_PROFILE_CLAIM = "https://api.openai.com/profile";

const DEFAULT_POLL_MS = 5 * 60_000;
/** How long a provider's requests must be quiet before the read that follows a turn. */
const DEFAULT_AFTER_TURN_QUIET_MS = 15_000;
/** No two reads of one provider closer than this, except `refresh`. */
const DEFAULT_MIN_READ_GAP_MS = 60_000;
const DEFAULT_RATE_LIMITED_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** The plan comes from a second endpoint; it rarely changes. */
const PROFILE_MAX_AGE_MS = 6 * 60 * 60_000;
/** Two samples closer than this collapse into the newer one. */
const MIN_SAMPLE_GAP_MS = 60_000;
const MAX_SAMPLES_PER_WINDOW = 1000;
/** A reset time that moves by more than this starts a new period (the provider's own value jitters by seconds). */
const RESET_TOLERANCE_MS = 5 * 60_000;

/** One window as a source reports it, before samples. */
export type WindowReading = {
	id: string;
	label: string;
	usedPercent: number | null;
	resetsAt: string | null;
	windowMinutes: number | null;
};

export type UsageReading = {
	manualResets?: SubscriptionResets | null;
	source: "usage_api" | "response_headers";
	windows: WindowReading[];
	plan?: string | null;
	account?: string | null;
};

export type SubscriptionUsageOptions = {
	/** The unobserved collection: auth resolves (and refreshes OAuth) through it. */
	models: Models;
	credentials: CredentialStore;
	dataDir: string;
	onChange?: (subscriptions: SubscriptionUsage[]) => void;
	fetch?: typeof fetch;
	now?: () => number;
	anthropicBaseUrl?: string;
	chatgptBaseUrl?: string;
	opencodeGoBaseUrl?: string;
	pollIntervalMs?: number;
	afterTurnQuietMs?: number;
	minReadGapMs?: number;
	log?: (message: string) => void;
};

/** Timers and gaps run on the monotonic clock; `now` only stamps readings and the 429 hold-off. */
type ProviderState = {
	usage: SubscriptionUsage;
	/** `performance.now()` of the last read. */
	lastAttemptAt: number;
	blockedUntil: number;
	profileReadAt: number;
	inFlight: Promise<void> | undefined;
	/** `performance.now()` of the last request or stream event. */
	lastActivityAt: number;
	afterTurnTimer: ReturnType<typeof setTimeout> | undefined;
};

type UsageReader = (auth: { apiKey: string }, state: ProviderState) => Promise<UsageReading>;

class HttpStatusError extends Error {
	constructor(
		readonly status: number,
		readonly retryAfterMs: number | undefined,
		message: string,
	) {
		super(message);
	}
}

const SubscriptionUsageSchema = PROTOCOL_SCHEMAS.SubscriptionUsage as TSchema;

const PROVIDER_LABELS: Record<string, string> = { anthropic: "Claude", "openai-codex": "ChatGPT", "opencode-go": "OpenCode Go" };

export class SubscriptionUsageService {
	readonly file: string;
	readonly #models: Models;
	readonly #credentials: CredentialStore;
	readonly #onChange: (subscriptions: SubscriptionUsage[]) => void;
	readonly #fetch: typeof fetch;
	readonly #now: () => number;
	readonly #anthropicBaseUrl: string;
	readonly #chatgptBaseUrl: string;
	readonly #opencodeGoBaseUrl: string;
	readonly #pollIntervalMs: number;
	readonly #afterTurnQuietMs: number;
	readonly #minReadGapMs: number;
	readonly #log: (message: string) => void;
	readonly #readers: Record<string, UsageReader>;
	readonly #states = new Map<string, ProviderState>();
	readonly #resetAttempts = new Map<string, { signature: string; answer: Promise<{ ok: boolean; code: string }> }>();
	readonly #resetting = new Set<string>();
	#clients = 0;
	#pollTimer: ReturnType<typeof setInterval> | undefined;
	#lastSignature = "";
	#writeChain: Promise<void> = Promise.resolve();
	#writeQueued = false;
	#loaded: Promise<void> | undefined;
	#stopped = false;

	constructor(options: SubscriptionUsageOptions) {
		this.file = join(options.dataDir, SUBSCRIPTION_USAGE_FILE);
		this.#models = options.models;
		this.#credentials = options.credentials;
		this.#onChange = options.onChange ?? (() => {});
		this.#fetch = options.fetch ?? fetch;
		this.#now = options.now ?? Date.now;
		this.#anthropicBaseUrl = options.anthropicBaseUrl ?? ANTHROPIC_API_BASE_URL;
		this.#chatgptBaseUrl = options.chatgptBaseUrl ?? CHATGPT_BACKEND_BASE_URL;
		this.#opencodeGoBaseUrl = options.opencodeGoBaseUrl ?? OPENCODE_GO_BASE_URL;
		this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
		this.#afterTurnQuietMs = options.afterTurnQuietMs ?? DEFAULT_AFTER_TURN_QUIET_MS;
		this.#minReadGapMs = options.minReadGapMs ?? DEFAULT_MIN_READ_GAP_MS;
		this.#log = options.log ?? (() => {});
		this.#readers = {
			anthropic: (auth, state) => this.#readClaude(auth.apiKey, state),
			"openai-codex": (auth) => this.#readChatGpt(auth.apiKey),
			"opencode-go": (auth) => this.#readOpenCodeGo(auth.apiKey),
		};
	}

	/** Every subscription's usage as last read. `refresh` reads every provider with a usage endpoint first. */
	async usage(options?: { refresh?: boolean }): Promise<SubscriptionUsage[]> {
		await this.#load();
		const providers = await this.#sync();
		if (options?.refresh === true) {
			await Promise.all(providers.map((providerId) => this.#read(providerId, { force: true })));
		}
		return this.#list();
	}

	/** Confirmed reset; fresh discovery gates the action. Mutation is never automatically retried. */
 async reset(request: Pick<SubscriptionsResetRequest, "providerId" | "creditId" | "program" | "requestId" | "confirmed">): Promise<{ok:boolean;code:string}> {
  if(request.confirmed!==true || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId)) return {ok:false,code:"confirmation_required"};
  const key=request.providerId+":"+request.requestId;
  const signature=JSON.stringify([request.creditId,request.program]);
  const previous=this.#resetAttempts.get(key);
  if(previous)return previous.signature===signature?previous.answer:{ok:false,code:"request_id_reused"};
  if(this.#resetting.has(request.providerId))return {ok:false,code:"reset_in_progress"};
  if(this.#resetAttempts.size>=128)return {ok:false,code:"too_many_attempts"};
  this.#resetting.add(request.providerId);
  const answer=(async()=>{
   try {
    const auth=await this.#models.getAuth(request.providerId);
    const token=auth?.auth.apiKey;
    const transport=this.#resetTransport(request.providerId,token);
    if(!transport)return {ok:false,code:"unsupported"};
    const resets=await discoverResets(transport);
    const credit=resets?.credits.find(c=>c.id===request.creditId&&c.program===request.program);
    if(!credit?.usable || credit.remaining<=0)return {ok:false,code:"unavailable"};
    const result=await consumeReset(transport,credit,request.requestId);
    await this.#read(request.providerId,{force:true});
    return result;
   } catch { return {ok:false,code:"unknown_outcome"}; }
   finally { this.#resetting.delete(request.providerId); }
  })();
  this.#resetAttempts.set(key,{signature,answer});
  return answer;
 }
 #resetTransport(providerId:string,token:string|undefined):ResetTransport|undefined {
  if(!token || (providerId!=="anthropic"&&providerId!=="openai-codex"))return undefined;
  return {providerId,token,baseUrl:providerId==="anthropic"?this.#anthropicBaseUrl:this.#chatgptBaseUrl,fetch:this.#fetch,now:this.#now()};
 }

	/** A client connected: poll while any is. The first one reads whatever is older than the poll interval. */
	clientConnected(): void {
		this.#clients += 1;
		if (this.#clients !== 1 || this.#stopped) return;
		this.#pollTimer = setInterval(() => void this.#poll(), this.#pollIntervalMs);
		this.#pollTimer.unref?.();
		void this.#poll();
	}

	clientDisconnected(): void {
		this.#clients = Math.max(0, this.#clients - 1);
		if (this.#clients > 0 || this.#pollTimer === undefined) return;
		clearInterval(this.#pollTimer);
		this.#pollTimer = undefined;
	}

	/** A login or logout changed the credentials: pick up the new set and read the new ones. */
	credentialsChanged(): void {
		void this.#poll();
	}

	/**
	 * The same collection with every request observed: rate-limit headers and Codex's `codex.rate_limits` event update
	 * the numbers, and a provider's requests going quiet schedules a read (the end of a turn).
	 */
	observeModels(models: Models): Models {
		const observe = <T extends object | undefined>(options: T): T => {
			const given = options as
				| {
						onResponse?: (response: { headers: Record<string, string> }, model: { provider: string }) => unknown;
						onProviderStreamEvent?: (data: unknown, model: { provider: string }) => unknown;
				  }
				| undefined;
			return {
				...given,
				onResponse: async (response: { headers: Record<string, string> }, model: { provider: string }) => {
					this.noteResponseHeaders(model.provider, response.headers);
					await given?.onResponse?.(response, model);
				},
				onProviderStreamEvent: async (data: unknown, model: { provider: string }) => {
					this.noteStreamEvent(model.provider, data);
					await given?.onProviderStreamEvent?.(data, model);
				},
			} as T;
		};
		const wrapped = new Set(["stream", "streamSimple", "complete", "completeSimple"]);
		return new Proxy(models, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver) as unknown;
				if (typeof value !== "function") return value;
				if (typeof property === "string" && wrapped.has(property)) {
					return (model: unknown, context: unknown, options?: object) =>
						(value as (...args: unknown[]) => unknown).call(target, model, context, observe(options));
				}
				return (value as (...args: unknown[]) => unknown).bind(target);
			},
		});
	}

	noteResponseHeaders(providerId: string, headers: Record<string, string>): void {
		this.#noteActivity(providerId);
		const windows =
			providerId === "anthropic"
				? parseAnthropicRateLimitHeaders(headers)
				: providerId === "openai-codex"
					? parseCodexRateLimitHeaders(headers)
					: [];
		if (windows.length > 0) void this.#applyFromHeaders(providerId, { source: "response_headers", windows });
	}

	noteStreamEvent(providerId: string, data: unknown): void {
		this.#noteActivity(providerId);
		if (providerId !== "openai-codex") return;
		const reading = parseCodexRateLimitEvent(data);
		if (reading !== undefined) void this.#applyFromHeaders(providerId, reading);
	}

	async stop(): Promise<void> {
		this.#stopped = true;
		if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
		this.#pollTimer = undefined;
		for (const state of this.#states.values()) {
			if (state.afterTurnTimer !== undefined) clearTimeout(state.afterTurnTimer);
			state.afterTurnTimer = undefined;
		}
		await Promise.all([...this.#states.values()].map((state) => state.inFlight?.catch(() => undefined)));
		await this.#writeChain;
	}

	// --- reading -------------------------------------------------------------------------------------------------

	async #poll(): Promise<void> {
		try {
			await this.#load();
			const providers = await this.#sync();
			await Promise.all(providers.map((providerId) => this.#read(providerId, { force: false })));
			this.#publishIfChanged();
		} catch (error) {
			this.#log(`subscription usage: poll failed: ${errorMessage(error)}`);
		}
	}

	/** One read of a provider's usage endpoint; concurrent callers share it. Never throws. */
	#read(providerId: string, options: { force: boolean }): Promise<void> {
		const state = this.#states.get(providerId);
		const reader = this.#readers[providerId];
		if (state === undefined || reader === undefined || this.#stopped) return Promise.resolve();
		if (state.inFlight !== undefined) return state.inFlight;
		if (this.#now() < state.blockedUntil) return Promise.resolve();
		const now = performance.now();
		const gap = options.force ? 0 : Math.min(this.#minReadGapMs, this.#pollIntervalMs - 1_000);
		if (state.lastAttemptAt > 0 && now - state.lastAttemptAt < gap) return Promise.resolve();
		state.lastAttemptAt = now;
		state.inFlight = (async () => {
			try {
				const auth = await this.#models.getAuth(providerId);
				const apiKey = auth?.auth.apiKey;
				if (apiKey === undefined) throw new Error("No credential to read usage with; log in again");
				const reading = await reader({ apiKey }, state);
				const transport = this.#resetTransport(providerId, apiKey);
				if (providerId !== "anthropic") reading.manualResets = (transport ? await discoverResets(transport) : null) ?? reading.manualResets ?? null;
				this.#apply(providerId, reading);
			} catch (error) {
				const message = this.#describeFailure(state, error);
				if (this.#states.get(providerId) === state) state.usage = { ...state.usage, error: message };
			} finally {
				state.inFlight = undefined;
			}
			this.#persist();
			this.#publishIfChanged();
		})();
		return state.inFlight;
	}

	#describeFailure(state: ProviderState, error: unknown): string {
		if (error instanceof HttpStatusError) {
			if (error.status === 429) {
				state.blockedUntil = this.#now() + (error.retryAfterMs ?? DEFAULT_RATE_LIMITED_MS);
				return `Rate limited by the usage endpoint; next read after ${new Date(state.blockedUntil).toISOString()}`;
			}
			if (error.status === 401 || error.status === 403) return `${error.message}; log in again`;
		}
		return errorMessage(error);
	}

	async #readClaude(token: string, state: ProviderState): Promise<UsageReading> {
		const headers = {
			authorization: `Bearer ${token}`,
			"anthropic-beta": ANTHROPIC_OAUTH_BETA,
			accept: "application/json",
			"user-agent": "claude-code/2.1.0",
		};
		const usage = await this.#getJson(`${this.#anthropicBaseUrl}/api/oauth/usage`, headers);
		const hasResetPrograms = isRecord(usage) && ("cedar_ember" in usage || "juniper_tide" in usage);
		const transport = this.#resetTransport("anthropic", token);
		const reading: UsageReading = { source: "usage_api", windows: parseClaudeUsage(usage), manualResets: hasResetPrograms && transport ? await discoverResets(transport) : null };
		if (this.#now() - state.profileReadAt > PROFILE_MAX_AGE_MS) {
			// The plan and email are extras: a failed profile read leaves the usage standing.
			try {
				const profile = parseClaudeProfile(await this.#getJson(`${this.#anthropicBaseUrl}/api/oauth/profile`, headers));
				state.profileReadAt = this.#now();
				reading.plan = profile.plan;
				reading.account = profile.account;
			} catch (error) {
				this.#log(`subscription usage: Claude profile read failed: ${errorMessage(error)}`);
			}
		}
		return reading;
	}

	async #readChatGpt(token: string): Promise<UsageReading> {
		const claims = decodeJwtPayload(token);
		const auth = claims?.[OPENAI_AUTH_CLAIM] as { chatgpt_account_id?: unknown } | undefined;
		const accountId = typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined;
		const headers: Record<string, string> = {
			authorization: `Bearer ${token}`,
			accept: "application/json",
			"user-agent": "codex-cli",
		};
		if (accountId !== undefined) headers["chatgpt-account-id"] = accountId;
		const body = await this.#getJson(`${this.#chatgptBaseUrl}/wham/usage`, headers);
		const reading = parseCodexUsage(body);
		const profile = claims?.[OPENAI_PROFILE_CLAIM] as { email?: unknown } | undefined;
		if (typeof profile?.email === "string") reading.account = profile.email;
		return reading;
	}

	async #readOpenCodeGo(apiKey: string): Promise<UsageReading> {
		const headers = { authorization: `Bearer ${apiKey}`, accept: "application/json", "user-agent": "aiki" };
		const body = await this.#getJson(`${this.#opencodeGoBaseUrl}/v1/usage`, headers);
		return parseOpenCodeGoUsage(body);
	}

	async #getJson(url: string, headers: Record<string, string>): Promise<unknown> {
		const response = await this.#fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			const detail = text.trim().slice(0, 200);
			throw new HttpStatusError(
				response.status,
				retryAfterMs(response.headers.get("retry-after"), this.#now()),
				`${new URL(url).pathname} answered HTTP ${response.status}${detail === "" ? "" : `: ${detail}`}`,
			);
		}
		return (await response.json()) as unknown;
	}

	#noteActivity(providerId: string): void {
		const state = this.#states.get(providerId);
		if (state === undefined || this.#readers[providerId] === undefined || this.#stopped) return;
		state.lastActivityAt = performance.now();
		if (state.afterTurnTimer === undefined) this.#armAfterTurn(providerId, state);
	}

	/** Read once the provider's requests have been quiet for a while (a turn ended), but not sooner than the gap. */
	#armAfterTurn(providerId: string, state: ProviderState): void {
		const now = performance.now();
		const at = Math.max(state.lastActivityAt + this.#afterTurnQuietMs, state.lastAttemptAt + this.#minReadGapMs);
		state.afterTurnTimer = setTimeout(
			() => {
				state.afterTurnTimer = undefined;
				if (this.#stopped || this.#states.get(providerId) !== state) return;
				if (performance.now() < state.lastActivityAt + this.#afterTurnQuietMs) {
					this.#armAfterTurn(providerId, state);
					return;
				}
				void this.#read(providerId, { force: false });
			},
			Math.max(0, at - now),
		);
		state.afterTurnTimer.unref?.();
	}

	// --- state ---------------------------------------------------------------------------------------------------

	/**
	 * Match the states to the stored credentials: OAuth logins of known providers, API keys of the plan providers
	 * (OpenCode Go), plus anything headers fed.
	 */
	async #sync(): Promise<string[]> {
		const credentials = await this.#credentials.list();
		const oauth = new Set(
			credentials
				.filter(
					(credential) =>
						(credential.type === "oauth" || API_KEY_PLAN_PROVIDERS.has(credential.providerId)) &&
						this.#models.getProvider(credential.providerId),
				)
				.map((credential) => credential.providerId),
		);
		const stored = new Set(credentials.map((credential) => credential.providerId));
		let changed = false;
		for (const [providerId, state] of this.#states) {
			// A plain API key has no plan limits; it stays only while headers give it windows.
			const keep = oauth.has(providerId) || (stored.has(providerId) && state.usage.windows.length > 0);
			if (keep) continue;
			if (state.afterTurnTimer !== undefined) clearTimeout(state.afterTurnTimer);
			this.#states.delete(providerId);
			changed = true;
		}
		for (const providerId of oauth) {
			if (this.#states.has(providerId)) continue;
			this.#states.set(providerId, this.#newState(this.#emptyUsage(providerId)));
			changed = true;
		}
		if (changed) {
			this.#persist();
			this.#publishIfChanged();
		}
		return [...oauth];
	}

	async #applyFromHeaders(providerId: string, reading: UsageReading): Promise<void> {
		try {
			await this.#load();
			if (!this.#states.has(providerId)) {
				const credentials = await this.#credentials.list();
				if (!credentials.some((credential) => credential.providerId === providerId)) return;
				this.#states.set(providerId, this.#newState(this.#emptyUsage(providerId)));
			}
			this.#apply(providerId, reading);
			this.#persist();
			this.#publishIfChanged();
		} catch (error) {
			this.#log(`subscription usage: header reading failed: ${errorMessage(error)}`);
		}
	}

	#apply(providerId: string, reading: UsageReading): void {
		const state = this.#states.get(providerId);
		if (state === undefined) return;
		state.usage = applyReading(state.usage, reading, new Date(this.#now()).toISOString());
	}

	#newState(usage: SubscriptionUsage): ProviderState {
		return {
			usage,
			lastAttemptAt: 0,
			blockedUntil: 0,
			profileReadAt: 0,
			inFlight: undefined,
			lastActivityAt: 0,
			afterTurnTimer: undefined,
		};
	}

	#emptyUsage(providerId: string): SubscriptionUsage {
		return {
			providerId,
			label: PROVIDER_LABELS[providerId] ?? this.#models.getProvider(providerId)?.name ?? providerId,
			plan: null,
			account: null,
			windows: [],
			source: "none",
			updatedAt: null,
			error: null,
		};
	}

	#list(): SubscriptionUsage[] {
		return [...this.#states.values()]
			.map((state) => state.usage)
			.sort((a, b) => a.providerId.localeCompare(b.providerId));
	}

	#publishIfChanged(): void {
		const subscriptions = this.#list();
		const signature = JSON.stringify(subscriptions.map(usageSignature));
		if (signature === this.#lastSignature) return;
		this.#lastSignature = signature;
		this.#onChange(subscriptions);
	}

	#load(): Promise<void> {
		this.#loaded ??= (async () => {
			try {
				const value = (await readJsonFile(this.file)) as { subscriptions?: unknown } | undefined;
				const list = Array.isArray(value?.subscriptions) ? value.subscriptions : [];
				for (const value of list) {
					if (!Value.Check(SubscriptionUsageSchema, value)) continue;
					const usage = value as SubscriptionUsage;
					if (this.#states.has(usage.providerId)) continue;
					this.#states.set(usage.providerId, this.#newState(usage));
				}
			} catch (error) {
				this.#log(`subscription usage: ${this.file} is unreadable, starting empty: ${errorMessage(error)}`);
			}
			this.#lastSignature = JSON.stringify(this.#list().map(usageSignature));
		})();
		return this.#loaded;
	}

	/** Write the current list; calls while a write is queued fold into it. */
	#persist(): void {
		if (this.#writeQueued) return;
		this.#writeQueued = true;
		this.#writeChain = this.#writeChain
			.then(() => {
				this.#writeQueued = false;
				return writeJsonFile(this.file, { subscriptions: this.#list() });
			})
			.catch((error: unknown) => this.#log(`subscription usage: writing ${this.file} failed: ${errorMessage(error)}`));
	}
}

/** What a push compares: the numbers and status, not when they were read or the samples that follow from them. */
function usageSignature(usage: SubscriptionUsage): unknown {
	return {
		...usage,
		updatedAt: undefined,
		windows: usage.windows.map((window) => ({ ...window, samples: undefined })),
	};
}

// --- applying a reading ------------------------------------------------------------------------------------------

/**
 * Apply one reading. The usage endpoint names the whole set of windows; headers update the windows they carry and
 * leave the others. Each window keeps its samples while the period continues and starts over when it resets.
 */
export function applyReading(usage: SubscriptionUsage, reading: UsageReading, at: string): SubscriptionUsage {
	const previous = new Map(usage.windows.map((window) => [window.id, window]));
	const updated = new Map<string, UsageWindow>();
	for (const window of reading.windows) updated.set(window.id, applyWindow(previous.get(window.id), window, at));
	const windows =
		reading.source === "usage_api"
			? reading.windows.map((window) => updated.get(window.id) as UsageWindow)
			: [
					...usage.windows.map((window) => updated.get(window.id) ?? window),
					...reading.windows.filter((window) => !previous.has(window.id)).map((window) => updated.get(window.id) as UsageWindow),
				];
	return {
		...usage,
		windows,
		source: reading.source,
		updatedAt: at,
		error: null,
		...(reading.manualResets === undefined ? {} : { manualResets: reading.manualResets }),
		...(reading.plan == null ? {} : { plan: reading.plan }),
		...(reading.account == null ? {} : { account: reading.account }),
	};
}

function applyWindow(previous: UsageWindow | undefined, reading: WindowReading, at: string): UsageWindow {
	let samples = previous?.samples ?? [];
	if (previous !== undefined && periodEnded(previous, reading, at)) samples = [];
	const resetsAt = reading.resetsAt ?? null;
	const windowMinutes = reading.windowMinutes ?? previous?.windowMinutes ?? null;
	// Samples from before this period began (a restart across a reset) do not belong to it.
	if (resetsAt !== null && windowMinutes !== null) {
		const start = Date.parse(resetsAt) - windowMinutes * 60_000;
		samples = samples.filter((sample) => Date.parse(sample.at) >= start);
	}
	if (reading.usedPercent !== null) samples = appendSample(samples, { at, usedPercent: reading.usedPercent });
	return {
		id: reading.id,
		label: reading.label,
		usedPercent: reading.usedPercent,
		resetsAt,
		windowMinutes,
		samples,
	};
}

function periodEnded(previous: UsageWindow, reading: WindowReading, at: string): boolean {
	if (previous.resetsAt === null) return reading.resetsAt !== null && previous.samples.length > 0;
	const previousReset = Date.parse(previous.resetsAt);
	if (Date.parse(at) >= previousReset) return true;
	if (reading.resetsAt === null) return false;
	return Math.abs(Date.parse(reading.resetsAt) - previousReset) > RESET_TOLERANCE_MS;
}

/**
 * Append, oldest first. A sample within a minute of the last one replaces it, and a run of equal values keeps only its
 * ends, so frequent header readings do not flood the history. Past the cap, every other sample of the older half goes.
 */
export function appendSample(samples: UsageSample[], sample: UsageSample): UsageSample[] {
	const last = samples.at(-1);
	const beforeLast = samples.at(-2);
	const next = [...samples];
	if (last === undefined) {
		next.push(sample);
	} else {
		const sinceLast = Date.parse(sample.at) - Date.parse(last.at);
		if (sinceLast < 0) return samples;
		const close = sinceLast < MIN_SAMPLE_GAP_MS;
		if (close && last.usedPercent === sample.usedPercent) return samples;
		const flat = last.usedPercent === sample.usedPercent && beforeLast?.usedPercent === sample.usedPercent;
		if ((close && beforeLast !== undefined) || flat) next[next.length - 1] = sample;
		else next.push(sample);
	}
	if (next.length <= MAX_SAMPLES_PER_WINDOW) return next;
	const half = Math.floor(next.length / 2);
	return [...next.slice(0, half).filter((_, index) => index % 2 === 0), ...next.slice(half)];
}

// --- parsing -----------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
	return null;
}

function isoFromUnixSeconds(value: unknown): string | null {
	const seconds = finiteNumber(value);
	return seconds === null || seconds <= 0 ? null : new Date(seconds * 1000).toISOString();
}

function isoFromString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const time = Date.parse(value);
	return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function clampPercent(value: number | null): number | null {
	return value === null ? null : Math.max(0, value);
}

/** "5-hour limit", "Weekly limit", "30-day limit". */
export function windowLabel(minutes: number | null): string {
	if (minutes === null) return "Limit";
	if (minutes === 7 * 24 * 60) return "Weekly limit";
	if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}-day limit`;
	if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
	return `${minutes}-minute limit`;
}

const CLAUDE_WINDOWS: Record<string, { label: string; minutes: number }> = {
	five_hour: { label: "5-hour limit", minutes: 5 * 60 },
	seven_day: { label: "Weekly limit", minutes: 7 * 24 * 60 },
	seven_day_opus: { label: "Weekly · Opus", minutes: 7 * 24 * 60 },
	seven_day_sonnet: { label: "Weekly · Sonnet", minutes: 7 * 24 * 60 },
	seven_day_oauth_apps: { label: "Weekly · OAuth apps", minutes: 7 * 24 * 60 },
	seven_day_cowork: { label: "Weekly · Cowork", minutes: 7 * 24 * 60 },
};

/** The unscoped `limits` kinds, which repeat a keyed window. */
const CLAUDE_UNSCOPED_LIMITS: Record<string, string> = { session: "five_hour", weekly_all: "seven_day" };

function capitalize(text: string): string {
	return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/** The model or surface a scoped limit applies to: `{ model: { id, display_name }, surface }`. */
function claudeScopeName(scope: unknown): string | null {
	if (!isRecord(scope)) return null;
	for (const part of [scope.model, scope.surface]) {
		if (typeof part === "string" && part !== "") return part;
		if (!isRecord(part)) continue;
		const name = [part.display_name, part.name, part.id].find((value) => typeof value === "string" && value !== "");
		if (typeof name === "string") return name;
	}
	return null;
}

/**
 * `limits: [{ kind, group, percent, severity, resets_at, scope, is_active }]`: the same windows as the keys plus the
 * scoped ones (`weekly_scoped` with `scope: { model: { display_name } }`). An unscoped entry fills in its keyed
 * window only when the key is missing; a scoped one whose label a keyed window already has is skipped.
 */
function parseClaudeLimits(limits: unknown, keyed: WindowReading[]): WindowReading[] {
	const windows: WindowReading[] = [];
	const ids = new Set(keyed.map((window) => window.id));
	const labels = new Set(keyed.map((window) => window.label.toLowerCase()));
	for (const limit of Array.isArray(limits) ? limits : []) {
		if (!isRecord(limit) || typeof limit.kind !== "string") continue;
		const group = typeof limit.group === "string" ? limit.group : limit.kind;
		const minutes = group === "weekly" ? 7 * 24 * 60 : group === "session" ? 5 * 60 : null;
		const scope = claudeScopeName(limit.scope);
		const unscopedId = CLAUDE_UNSCOPED_LIMITS[limit.kind];
		let id: string;
		let label: string;
		if (scope !== null) {
			const prefix = group === "weekly" ? "Weekly" : group === "session" ? "5-hour" : capitalize(group.replaceAll("_", " "));
			id = `${limit.kind}.${scope.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
			label = `${prefix} · ${scope}`;
		} else if (unscopedId !== undefined) {
			id = unscopedId;
			label = CLAUDE_WINDOWS[unscopedId]?.label ?? windowLabel(minutes);
		} else {
			continue;
		}
		if (ids.has(id) || labels.has(label.toLowerCase())) continue;
		ids.add(id);
		labels.add(label.toLowerCase());
		windows.push({
			id,
			label,
			usedPercent: clampPercent(finiteNumber(limit.percent ?? limit.utilization)),
			resetsAt: isoFromString(limit.resets_at) ?? isoFromUnixSeconds(limit.resets_at),
			windowMinutes: minutes,
		});
	}
	return windows;
}

/**
 * `GET /api/oauth/usage`: `{ five_hour, seven_day, seven_day_opus, seven_day_sonnet, …: { utilization, resets_at } |
 * null, extra_usage, limits, … }`. `utilization` is a percentage (0–100) and `resets_at` an ISO time, null before the
 * window starts. Null keys (most `seven_day_*` ones, some of them codenames) are left out; unknown `five_hour`/
 * `seven_day*` keys of the window shape are kept with their suffix as the label. Scoped `limits` entries follow.
 */
export function parseClaudeUsage(body: unknown): WindowReading[] {
	if (!isRecord(body)) throw new Error("The Claude usage endpoint did not answer a JSON object");
	const windows: WindowReading[] = [];
	for (const [id, value] of Object.entries(body)) {
		const known = CLAUDE_WINDOWS[id];
		if (known === undefined && !/^(five_hour|seven_day)(_|$)/.test(id)) continue;
		if (!isRecord(value) || !("utilization" in value)) continue;
		const minutes = known?.minutes ?? (id.startsWith("five_hour") ? 5 * 60 : 7 * 24 * 60);
		const suffix = id.replace(/^(five_hour|seven_day)_?/, "").replaceAll("_", " ");
		const prefix = minutes === 5 * 60 ? "5-hour" : "Weekly";
		windows.push({
			id,
			label: known?.label ?? (suffix === "" ? windowLabel(minutes) : `${prefix} · ${capitalize(suffix)}`),
			usedPercent: clampPercent(finiteNumber(value.utilization)),
			resetsAt: isoFromString(value.resets_at),
			windowMinutes: minutes,
		});
	}
	const order = Object.keys(CLAUDE_WINDOWS);
	const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
	windows.sort((a, b) => rank(a.id) - rank(b.id));
	return [...windows, ...parseClaudeLimits(body.limits, windows)];
}

const CLAUDE_TIERS: [RegExp, string][] = [
	[/max_20x/, "Max 20x"],
	[/max_5x/, "Max 5x"],
	[/max/, "Max"],
	[/enterprise/, "Enterprise"],
	[/team/, "Team"],
	[/pro/, "Pro"],
];

/**
 * `GET /api/oauth/profile`: `{ account: { email_address | email, has_claude_max, has_claude_pro }, organization: {
 * organization_type, rate_limit_tier } }`. The plan comes from `rate_limit_tier` (e.g. `default_claude_max_20x`),
 * then `organization_type` (e.g. `claude_max`), then the account flags.
 */
export function parseClaudeProfile(body: unknown): { plan: string | null; account: string | null } {
	const account = isRecord(body) && isRecord(body.account) ? body.account : {};
	const organization = isRecord(body) && isRecord(body.organization) ? body.organization : {};
	const email = [account.email_address, account.email, account.emailAddress].find((value) => typeof value === "string");
	let plan: string | null = null;
	for (const hint of [organization.rate_limit_tier, organization.organization_type]) {
		if (typeof hint !== "string") continue;
		plan = CLAUDE_TIERS.find(([pattern]) => pattern.test(hint.toLowerCase()))?.[1] ?? null;
		if (plan !== null) break;
	}
	if (plan === null && account.has_claude_max === true) plan = "Max";
	if (plan === null && account.has_claude_pro === true) plan = "Pro";
	return { plan, account: typeof email === "string" ? email : null };
}

/**
 * `GET /v1/usage` on OpenCode Go (undocumented, found through opencode#31084 and cc-switch#6433; Bearer API key, no
 * cookie): `{ usage: { rolling, weekly, monthly: { status: "ok", percent, resetsAt } } }`. `percent` is of the plan's
 * dollar limit (rolling 5 hours, weekly, monthly), `resetsAt` an ISO time. The monthly period runs from the
 * subscription's anniversary, so its length is the calendar month before `resetsAt`.
 */
export function parseOpenCodeGoUsage(body: unknown): UsageReading {
	const usage = isRecord(body) && isRecord(body.usage) ? body.usage : undefined;
	if (usage === undefined) throw new Error("The OpenCode Go usage endpoint did not answer a usage object");
	const windows: WindowReading[] = [];
	for (const [id, label, minutes] of [
		["rolling", "5-hour limit", 5 * 60],
		["weekly", "Weekly limit", 7 * 24 * 60],
		["monthly", "Monthly limit", null],
	] as const) {
		const value = usage[id];
		if (!isRecord(value)) continue;
		const resetsAt = isoFromString(value.resetsAt);
		windows.push({
			id,
			label,
			usedPercent: clampPercent(finiteNumber(value.percent)),
			resetsAt,
			windowMinutes: minutes ?? (resetsAt === null ? null : monthBefore(resetsAt)),
		});
	}
	if (windows.length === 0) {
		throw new Error("The OpenCode Go usage endpoint reported no limits; does this key have a Go plan?");
	}
	return { source: "usage_api", windows };
}

/** Minutes in the calendar month ending at `iso` (UTC), e.g. 5 Nov to 5 Dec is 30 days. */
function monthBefore(iso: string): number | null {
	const end = new Date(iso);
	const start = new Date(end);
	start.setUTCMonth(end.getUTCMonth() - 1);
	// A 31st minus one month overflows into the next month; clamp to the last day of the month before.
	if (start.getUTCDate() !== end.getUTCDate()) start.setUTCDate(0);
	const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
	return minutes > 0 ? minutes : null;
}

const CODEX_PLANS: Record<string, string> = {
	free: "Free",
	go: "Go",
	plus: "Plus",
	pro: "Pro",
	prolite: "Pro Lite",
	promax: "Pro Max",
	team: "Team",
	business: "Business",
	enterprise: "Enterprise",
	edu: "Edu",
};

/** Plans that win when a compound `plan_type` names several (`self_serve_business_prolite` is Business). */
const CODEX_PLAN_PRECEDENCE = ["enterprise", "business", "team", "edu"];

export function codexPlanLabel(plan: unknown): string | null {
	if (typeof plan !== "string" || plan === "" || plan === "unknown") return null;
	const known = CODEX_PLANS[plan];
	if (known !== undefined) return known;
	const words = plan.toLowerCase().replace(/^self_serve_/, "").split(/[_\s-]+/).filter((word) => word !== "");
	const main = CODEX_PLAN_PRECEDENCE.find((word) => words.includes(word));
	if (main !== undefined) return CODEX_PLANS[main] ?? capitalize(main);
	const joined = words.join("_");
	return CODEX_PLANS[joined] ?? words.map(capitalize).join(" ");
}

function codexWindow(id: string, label: string | undefined, value: unknown): WindowReading | undefined {
	if (!isRecord(value)) return undefined;
	const seconds = finiteNumber(value.limit_window_seconds);
	const minutes = seconds === null || seconds <= 0 ? null : Math.max(1, Math.round(seconds / 60));
	return {
		id,
		label: label === undefined ? windowLabel(minutes) : `${windowLabel(minutes)} · ${label}`,
		usedPercent: clampPercent(finiteNumber(value.used_percent)),
		resetsAt: isoFromUnixSeconds(value.reset_at),
		windowMinutes: minutes,
	};
}

/**
 * `GET /wham/usage` (Codex CLI's `RateLimitStatusPayload`): `{ plan_type, rate_limit: { allowed, limit_reached,
 * primary_window, secondary_window }, credits, additional_rate_limits: [{ limit_name, metered_feature, rate_limit }]
 * }`, each window `{ used_percent, limit_window_seconds, reset_after_seconds, reset_at }` with `reset_at` in Unix
 * seconds.
 */
export function parseCodexUsage(body: unknown): UsageReading {
	if (!isRecord(body)) throw new Error("The ChatGPT usage endpoint did not answer a JSON object");
	const windows: WindowReading[] = [];
	const limits = isRecord(body.rate_limit) ? body.rate_limit : {};
	for (const [id, key] of [
		["primary", "primary_window"],
		["secondary", "secondary_window"],
	] as const) {
		const window = codexWindow(id, undefined, limits[key]);
		if (window !== undefined) windows.push(window);
	}
	for (const extra of Array.isArray(body.additional_rate_limits) ? body.additional_rate_limits : []) {
		if (!isRecord(extra) || !isRecord(extra.rate_limit)) continue;
		const name = typeof extra.limit_name === "string" ? extra.limit_name : undefined;
		const feature = typeof extra.metered_feature === "string" ? extra.metered_feature : name;
		if (feature === undefined) continue;
		for (const [suffix, key] of [
			["primary", "primary_window"],
			["secondary", "secondary_window"],
		] as const) {
			const window = codexWindow(`${feature}.${suffix}`, name ?? feature, extra.rate_limit[key]);
			if (window !== undefined) windows.push(window);
		}
	}
	const resetBlock = isRecord(body.rate_limit_reset_credits) ? body.rate_limit_reset_credits : undefined;
	const available = resetBlock?.available_count;
	const manualResets = typeof available === "number" && Number.isSafeInteger(available) && available >= 0
		? { available, credits: [], reason: "Credit details not reported" } : null;
	return { source: "usage_api", windows, plan: codexPlanLabel(body.plan_type), manualResets };
}

/**
 * Claude's unified limits on every OAuth reply: `anthropic-ratelimit-unified-{5h,7d}-utilization` (a fraction, 0–1)
 * and `…-reset` (Unix seconds).
 */
export function parseAnthropicRateLimitHeaders(headers: Record<string, string>): WindowReading[] {
	const lower = lowerCaseKeys(headers);
	const windows: WindowReading[] = [];
	for (const [claim, id] of [
		["5h", "five_hour"],
		["7d", "seven_day"],
	] as const) {
		const utilization = finiteNumber(lower[`anthropic-ratelimit-unified-${claim}-utilization`]);
		if (utilization === null) continue;
		const known = CLAUDE_WINDOWS[id] as { label: string; minutes: number };
		windows.push({
			id,
			label: known.label,
			usedPercent: clampPercent(Math.round(utilization * 10_000) / 100),
			resetsAt: isoFromUnixSeconds(lower[`anthropic-ratelimit-unified-${claim}-reset`]),
			windowMinutes: known.minutes,
		});
	}
	return windows;
}

/** Codex replies over SSE: `x-codex-{primary,secondary}-{used-percent,window-minutes,reset-at}` (Unix seconds). */
export function parseCodexRateLimitHeaders(headers: Record<string, string>): WindowReading[] {
	const lower = lowerCaseKeys(headers);
	const windows: WindowReading[] = [];
	for (const id of ["primary", "secondary"] as const) {
		const used = finiteNumber(lower[`x-codex-${id}-used-percent`]);
		if (used === null) continue;
		const minutes = finiteNumber(lower[`x-codex-${id}-window-minutes`]);
		windows.push({
			id,
			label: windowLabel(minutes),
			usedPercent: clampPercent(used),
			resetsAt: isoFromUnixSeconds(lower[`x-codex-${id}-reset-at`]),
			windowMinutes: minutes === null || minutes <= 0 ? null : Math.round(minutes),
		});
	}
	return windows;
}

/**
 * Codex's WebSocket transport has no response headers; the same numbers come as a stream event: `{ type:
 * "codex.rate_limits", plan_type, rate_limits: { primary, secondary: { used_percent, window_minutes, reset_at } } }`.
 * Only the default limit (no `metered_limit_name`/`limit_name`, or "codex") maps to the primary/secondary windows.
 */
export function parseCodexRateLimitEvent(data: unknown): UsageReading | undefined {
	if (!isRecord(data) || data.type !== "codex.rate_limits") return undefined;
	const limit = data.metered_limit_name ?? data.limit_name;
	if (typeof limit === "string" && limit.toLowerCase() !== "codex") return undefined;
	const limits = isRecord(data.rate_limits) ? data.rate_limits : {};
	const windows: WindowReading[] = [];
	for (const id of ["primary", "secondary"] as const) {
		const value = limits[id];
		if (!isRecord(value)) continue;
		const used = finiteNumber(value.used_percent);
		if (used === null) continue;
		const minutes = finiteNumber(value.window_minutes);
		windows.push({
			id,
			label: windowLabel(minutes),
			usedPercent: clampPercent(used),
			resetsAt: isoFromUnixSeconds(value.reset_at),
			windowMinutes: minutes === null || minutes <= 0 ? null : Math.round(minutes),
		});
	}
	if (windows.length === 0) return undefined;
	return { source: "response_headers", windows, plan: codexPlanLabel(data.plan_type) };
}

function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
	const lower: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
	return lower;
}

function retryAfterMs(value: string | null, now: number): number | undefined {
	if (value === null) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.max(seconds * 1000, DEFAULT_MIN_READ_GAP_MS);
	const date = Date.parse(value);
	return Number.isNaN(date) ? undefined : Math.max(date - now, DEFAULT_MIN_READ_GAP_MS);
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const part = token.split(".")[1];
	if (part === undefined) return undefined;
	try {
		const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}
