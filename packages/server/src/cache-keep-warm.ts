import type { CacheWarmStretch } from "@aiki/protocol";
import type { Context, Model, Models, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import type { Conversation } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { CacheWarmSchedule, type CacheWarmClock } from "./cache-warm-schedule.ts";
import { refreshAnthropicCache, supportsCacheWarm, zeroOutputPayload, type CacheWarmPayload } from "./cache-warm-transport.ts";
import type { RequestLogStore, RequestRow } from "./request-log-store.ts";

type WarmProject = {
	settings: () => { keepPromptCacheWarm: boolean; promptCacheWarmHours: number; archived?: boolean };
	conversation: (id: number) => Promise<Conversation | undefined>;
	prefixRevision?: (id: number) => Promise<string>;
};
type Armed = { schedule: CacheWarmSchedule; stopWatch: () => Promise<void>; preserveSnapshot: boolean };
type WarmSnapshot = {
    request: Omit<WarmRequest, "models">; summary: CacheWarmStretch; agent: string; head?: number;
    prefixRevision?: string; ttlMs: number;
};
export type WarmRequest = {
	row: RequestRow; model: Model<string>; context: Context; options: ModelsSimpleStreamOptions;
	payload: unknown; models: Models; authFingerprint?: string; prefixRevision?: string; cacheHeaders?: Record<string, string>;
};
/** Owns only private request snapshots and timers. Durable history belongs to the request log. */
export class CoordinatorCacheWarm {
	readonly #store: RequestLogStore;
	readonly #clock: CacheWarmClock | undefined;
	readonly #projects = new Map<string, WarmProject>();
	readonly #armed = new Map<string, Armed>();
	readonly #revision = new Map<string, number>();
	readonly #ttl = new Map<string, number>();
	#models: Models | undefined;
	constructor(store: RequestLogStore, clock?: CacheWarmClock) { this.#store = store; this.#clock = clock; }
    async prefixRevision(projectId: string, conversationId: number): Promise<string | undefined> {
        const project = this.#projects.get(projectId);
        if (!project?.settings().keepPromptCacheWarm || await project.conversation(conversationId) === undefined) return undefined;
        return project.prefixRevision?.(conversationId);
    }
	useModels(models: Models): void { this.#models = models; }
	async restore(projectId: string): Promise<void> {
		if (this.#models === undefined) return;
		for (const saved of this.#store.warmSnapshots(projectId) as WarmSnapshot[]) {
			const model = this.#models.getModel(saved.request.row.provider, saved.request.row.model);
			if (model === undefined || !supportsCacheWarm(model)) { this.#store.deleteWarmSnapshots(projectId, saved.request.row.conversationId); continue; }
			await this.real({ ...saved.request, model, models: this.#models }, saved);
		}
	}
	register(projectId: string, project: WarmProject): void { this.#projects.set(projectId, project); }
	invalidate(projectId: string, reason: string, conversationId?: number, preserveSnapshot = false): void {
		if (!preserveSnapshot) { try { this.#store.deleteWarmSnapshots(projectId, conversationId); } catch {} }
		for (const key of this.#revision.keys()) {
            if (key.startsWith(`${projectId}:`) && (conversationId === undefined || key === `${projectId}:${conversationId}`))
                this.#revision.set(key, (this.#revision.get(key) ?? 0) + 1);
        }
        for (const [key, armed] of this.#armed) {
			if (!key.startsWith(`${projectId}:`) || (conversationId !== undefined && key !== `${projectId}:${conversationId}`)) continue;
			this.#revision.set(key, (this.#revision.get(key) ?? 0) + 1);
			armed.preserveSnapshot = preserveSnapshot;
			armed.schedule.stop(reason);
			void armed.stopWatch();
			this.#armed.delete(key);
		}
	}
	close(): void { for (const project of this.#projects.keys()) this.unregister(project, true); }
	unregister(projectId: string, preserveSnapshot = false): void { this.invalidate(projectId, preserveSnapshot ? "Server stopped" : "Project closed", undefined, preserveSnapshot); this.#projects.delete(projectId); }
	async real(request: WarmRequest, restored?: WarmSnapshot): Promise<void> {
		const { row } = request;
		const key = `${row.projectId}:${row.conversationId}`;
		this.invalidate(row.projectId, "Conversation resumed", row.conversationId);
		const revision = (this.#revision.get(key) ?? 0) + 1;
		this.#revision.set(key, revision);
		if (row.cacheWrite > 0) this.#ttl.set(key, (row.cacheWrite1h ?? 0) > 0 ? 3_600_000 : 300_000);
		const project = this.#projects.get(row.projectId);
		if (project === undefined || !project.settings().keepPromptCacheWarm || project.settings().archived ||
			(row.kind !== "main" && row.kind !== "thread") || !supportsCacheWarm(request.model) ||
			(row.stopReason !== "stop" && row.stopReason !== "length") || row.cacheRead + row.cacheWrite <= 0 ||
			typeof request.payload !== "object" || request.payload === null) return;
		const payload = structuredClone(request.payload) as CacheWarmPayload;
		if (zeroOutputPayload(payload) === undefined) return;
		const conversation = await project.conversation(row.conversationId);
		if (conversation === undefined || this.#revision.get(key) !== revision) return;
		const watch = await conversation.watch(BACKGROUND_CONTEXT);
		if (this.#revision.get(key) !== revision) { await watch.stop(); return; }
		let view = watch.value;
		const initialAgent = JSON.stringify(view.docs["pi.agent"]);
		const initialHead = view.entries.filter(entry => ["pi.compaction", "pi.reset", "pi.system"].includes(entry.kind)).at(-1)?.id;
		const prefixRevision = await project.prefixRevision?.(row.conversationId);
		if (request.prefixRevision !== undefined && request.prefixRevision !== prefixRevision) { await watch.stop(); return; }
		if (restored !== undefined && (restored.agent !== initialAgent || restored.head !== initialHead || restored.prefixRevision !== prefixRevision)) {
			if (restored.summary.attempts > 0) this.#store.saveWarmStretch(row.projectId, row.conversationId, { ...restored.summary, stopped: "Prompt or model changed while offline" });
			await watch.stop(); return;
		}
		const summary: CacheWarmStretch = restored?.summary ?? { id: crypto.randomUUID(), anchorEntryId: 0, startedAt: row.at, lastAt: row.at,
			refreshes: 0, attempts: 0, cachedTokens: 0, cost: 0 };
		const valid = () => this.#revision.get(key) === revision && project.settings().keepPromptCacheWarm && !project.settings().archived;
		const idle = () => !(watch.value.docs["pi.live"] as { run?: unknown } | undefined)?.run &&
			!((watch.value.docs["pi.inbox"] as { items?: unknown[] } | undefined)?.items?.length);
		const save = () => { if (summary.attempts > 0) this.#store.saveWarmStretch(row.projectId, row.conversationId, summary); };
        // Explicit allow-list: neither credentials nor provider callbacks/signals are persisted.
        const options: Record<string, unknown> = {};
        for (const name of ["reasoning", "thinkingBudgets", "cacheRetention", "sessionId", "identity", "temperature", "topP", "maxTokens"])
            if (name in request.options) options[name] = (request.options as Record<string, unknown>)[name];
        const ttlMs = restored?.ttlMs ?? this.#ttl.get(key) ?? this.#store.previousRequest(row.projectId, row.conversationId)?.cacheTtlMs ?? 300_000;
        const { headers: _modelHeaders, ...snapshotModel } = request.model;
        const persist = () => this.#store.saveWarmSnapshot(row.projectId, row.conversationId, {
            request: { row, model: snapshotModel, context: request.context, options, payload, ...(request.authFingerprint === undefined ? {} : { authFingerprint: request.authFingerprint }), ...(request.cacheHeaders === undefined ? {} : { cacheHeaders: request.cacheHeaders }) },
            summary, agent: initialAgent, ...(initialHead === undefined ? {} : { head: Number(initialHead) }),
            ...(prefixRevision === undefined ? {} : { prefixRevision }), ttlMs,
        } satisfies WarmSnapshot);
		const schedule = new CacheWarmSchedule({ ...(this.#clock === undefined ? {} : { clock: this.#clock }), realAt: row.at, ttlMs, ...(restored === undefined ? {} : { touchAt: summary.lastReadAt ?? row.at, resumeDelayMs: 30_000 + Math.floor(Math.random() * 30_000) }),
			hours: project.settings().promptCacheWarmHours,
			onStop: reason => { summary.stopped ??= reason; try { save(); if (!this.#armed.get(key)?.preserveSnapshot) this.#store.deleteWarmSnapshots(row.projectId, row.conversationId); } catch {} this.#armed.delete(key); void watch.stop().catch(() => undefined); },
			ping: async signal => {
				if (!valid() || !idle()) { schedule.stop("Conversation changed"); return false; }
				persist(); // Preflight the log before spending; a broken log disarms maintenance.
				if (await project.prefixRevision?.(row.conversationId) !== prefixRevision) { schedule.stop("System prompt or tools changed"); return false; }
				if (!valid() || !idle() || signal.aborted) return false;
				const at = this.#clock?.now() ?? Date.now();
				const response = await refreshAnthropicCache({ models: request.models, model: request.model, context: request.context,
					requestOptions: request.options, payload, ...(request.authFingerprint === undefined ? {} : { authFingerprint: request.authFingerprint }), ...(request.cacheHeaders === undefined ? {} : { cacheHeaders: request.cacheHeaders }), signal, admit: () => valid() && idle() });
				const usage = response.usage;
				summary.attempts += 1;
				summary.lastAt = at;
				summary.cachedTokens += usage.cacheRead;
				summary.cost += usage.cost.total;
				const warm = response.stopReason !== "error" && response.stopReason !== "aborted" && usage.cacheRead > 0 && usage.cacheWrite === 0;
				if (warm) { summary.refreshes += 1; summary.lastReadAt = at; }
				else summary.stopped = response.stopReason === "error" || response.stopReason === "aborted" ? "Cache refresh stopped: provider request failed" : usage.cacheRead <= 0 ? "Cache refresh stopped: no cache read" : "Cache refresh stopped: unexpected cache write";
				this.#store.recordWarm({ ...row, at, input: usage.input, output: usage.output, cacheRead: usage.cacheRead,
					cacheWrite: usage.cacheWrite, cacheWrite1h: usage.cacheWrite1h ?? null, cost: usage.cost.total,
					costInput: usage.cost.input, costOutput: usage.cost.output, costCacheRead: usage.cost.cacheRead, costCacheWrite: usage.cost.cacheWrite,
					promptTokens: usage.input + usage.cacheRead + usage.cacheWrite, source: "keepWarm", wake: null, changes: null,
					missTokens: 0, missCost: 0, missReason: null, idleMs: at - row.at, stopReason: response.stopReason,
					durationMs: (this.#clock?.now() ?? Date.now()) - at }, summary);
				if (warm && valid()) persist();
				return warm;
			},
		});
		this.#armed.set(key, { schedule, stopWatch: async () => { await watch.stop(); }, preserveSnapshot: false });
		let reachedIdle = false;
		const update = () => {
			if (!valid()) return schedule.stop("Setting changed");
			if ((view.docs["pi.live"] as { compactions?: unknown[] } | undefined)?.compactions?.length) {
				this.invalidate(row.projectId, "Compaction started", row.conversationId); return;
			}
			const head = view.entries.filter(entry => ["pi.compaction", "pi.reset", "pi.system"].includes(entry.kind)).at(-1)?.id;
			if (initialHead !== head || JSON.stringify(view.docs["pi.agent"]) !== initialAgent) {
				this.invalidate(row.projectId, "Prompt or model changed", row.conversationId); return;
			}
			if (!idle()) {
				if (reachedIdle || summary.attempts > 0) this.invalidate(row.projectId, "Conversation resumed", row.conversationId);
				else schedule.pause();
			} else {
				reachedIdle = true;
				summary.anchorEntryId = Number(view.entries.at(-1)?.id ?? 0);
				schedule.resume();
			}
		};
		watch.start(async call => {
			if (call.kind === "failed") { schedule.stop("Conversation watch failed"); throw call.error; }
			view = call.value; update();
		});
		void watch.closed.then(() => { schedule.stop("Conversation closed"); if (this.#armed.get(key)?.schedule === schedule) this.#armed.delete(key); });
		try { persist(); update(); } catch { this.invalidate(row.projectId, "Request log unavailable", row.conversationId); }
	}
}
