/**
 * `cache.stats` and `bun run cache-report`: the request log's rows over a range, summed by miss reason, project, kind
 * of conversation, model, wake and day, with the costliest conversations and misses, and what a one-hour cache would
 * have saved and cost. Pure over the rows plus pi-ai's prices.
 */
import type {
	CacheConversation,
	CacheDay,
	CacheGroup,
	CacheMissDetail,
	CacheStats,
	CacheTotals,
	CacheWake,
	LongCacheWhatIf,
	WakeReason,
} from "@aiki/protocol";
import { calculateCost, type Model, type Models, type Usage } from "@earendil-works/pi-ai";
import { usageAnalysis } from "./usage-analysis.ts";
import type { ProjectStore } from "./projects.ts";
import { REQUEST_LOG_KEEP_DAYS, type RequestLogStore, type RequestRow } from "./request-log-store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_CACHE_STATS_DAYS = 30;
const TOP_CONVERSATIONS = 20;
const TOP_MISSES = 100;

const REASON_LABELS: Record<string, string> = {
	model_switch: "Model switched",
	instructions_changed: "Instructions changed",
	idle: "Idle past the cache lifetime",
	unexplained: "No visible reason",
};

const KIND_LABELS: Record<string, string> = { main: "Main", thread: "Threads", worker: "Workers", other: "Other" };

export function missReasonLabel(reason: string): string {
	return REASON_LABELS[reason] ?? reason;
}

export function kindLabel(kind: string): string {
	return KIND_LABELS[kind] ?? kind;
}

type Sum = { requests: number; cost: number; misses: number; missedTokens: number; missedCost: number };

function emptySum(): Sum {
	return { requests: 0, cost: 0, misses: 0, missedTokens: 0, missedCost: 0 };
}

function add(sum: Sum, row: RequestRow): void {
	if (row.source !== "keepWarm") sum.requests += 1;
	sum.cost += row.cost;
	if (row.missTokens > 0) {
		sum.misses += 1;
		sum.missedTokens += row.missTokens;
		sum.missedCost += row.missCost;
	}
}

function groups(rows: readonly RequestRow[], keyOf: (row: RequestRow) => string, labelOf: (key: string) => string): CacheGroup[] {
	const sums = new Map<string, Sum>();
	for (const row of rows) {
		const key = keyOf(row);
		let sum = sums.get(key);
		if (sum === undefined) sums.set(key, (sum = emptySum()));
		add(sum, row);
	}
	return [...sums.entries()]
		.map(([key, sum]) => ({ key, label: labelOf(key), ...sum }))
		.sort((a, b) => b.missedCost - a.missedCost || b.cost - a.cost);
}

function dayOf(at: number, offsetMs: number): string {
	return new Date(at + offsetMs).toISOString().slice(0, 10);
}

/** Whether pi-ai can ask this model for the one-hour cache, priced as such: Anthropic's Messages API. */
function supportsHourCache(model: Model<string> | undefined): model is Model<string> {
	if (model === undefined || model.api !== "anthropic-messages") return false;
	return (model.compat as { supportsLongCacheRetention?: boolean } | undefined)?.supportsLongCacheRetention !== false;
}

/** What the cache writes of `row` cost, with `hourTokens` of them written for an hour, at pi-ai's current prices. */
function writeCost(model: Model<string>, row: RequestRow, writeTokens: number, hourTokens: number): number {
	const usage: Usage = {
		input: row.input,
		output: row.output,
		cacheRead: row.cacheRead,
		cacheWrite: writeTokens,
		cacheWrite1h: hourTokens,
		totalTokens: row.input + row.output + row.cacheRead + writeTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	return calculateCost(model, usage).cacheWrite;
}

/** The request asked for the one-hour cache, or the provider says it wrote to it (rows read back have no retention). */
function usedHourCache(row: RequestRow): boolean {
	return row.retention === "long" || (row.cacheWrite1h ?? 0) > 0;
}

/**
 * A one-hour cache over the same requests: idle misses under an hour become reads (the miss's cost is saved, and its
 * tokens are not written again), and every other cache write is written for an hour at its higher price. Requests that
 * used it already are only counted (`alreadyLong`): their misses were judged by the hour already.
 */
export function longCacheWhatIf(rows: readonly RequestRow[], models: Pick<Models, "getModel"> | undefined): LongCacheWhatIf {
	const result = { requests: 0, missesAvoided: 0, saved: 0, extraWriteCost: 0, net: 0, stillMissed: 0, alreadyLong: 0 };
	if (models === undefined) return result;
	for (const row of rows) {
		if (row.source === "keepWarm" || row.retention === "none") continue;
		const model = models.getModel(row.provider, row.model) as Model<string> | undefined;
		if (!supportsHourCache(model)) continue;
		if (usedHourCache(row)) {
			result.alreadyLong += 1;
			continue;
		}
		result.requests += 1;
		let writes = row.cacheWrite;
		if (row.missReason === "idle" && row.idleMs !== null) {
			if (row.idleMs < HOUR_MS) {
				result.missesAvoided += 1;
				result.saved += row.missCost;
				writes = Math.max(0, writes - row.missTokens);
			} else {
				result.stillMissed += 1;
			}
		}
		if (writes <= 0) continue;
		const alreadyHour = Math.min(writes, row.cacheWrite1h ?? 0);
		result.extraWriteCost += writeCost(model, row, writes, writes) - writeCost(model, row, writes, alreadyHour);
	}
	result.net = result.saved - result.extraWriteCost;
	return result;
}

/** Each wake, what its turn cost until the next wake of the same conversation, and the misses on the woken requests. */
export function wakeGroups(rows: readonly RequestRow[]): CacheWake[] {
	const byWake = new Map<WakeReason, CacheWake>();
	const group = (wake: WakeReason): CacheWake => {
		let found = byWake.get(wake);
		if (found === undefined) byWake.set(wake, (found = { wake, wakes: 0, turnCost: 0, misses: 0, missedCost: 0 }));
		return found;
	};
	/** The wake whose turn each conversation is in. */
	const current = new Map<string, CacheWake>();
	for (const row of rows) {
		if (row.source === "keepWarm") continue;
		const key = `${row.projectId}:${row.conversationId}`;
		const wake = row.wake ?? "unknown";
		if (wake === "continue" || wake === "retry") {
			const turn = current.get(key);
			if (turn !== undefined) turn.turnCost += row.cost;
			if (wake === "retry") {
				const retries = group("retry");
				retries.wakes += 1;
				if (turn === undefined) retries.turnCost += row.cost;
				if (row.missTokens > 0) {
					retries.misses += 1;
					retries.missedCost += row.missCost;
				}
			}
			continue;
		}
		const turn = group(wake);
		turn.wakes += 1;
		turn.turnCost += row.cost;
		if (row.missTokens > 0) {
			turn.misses += 1;
			turn.missedCost += row.missCost;
		}
		current.set(key, turn);
	}
	return [...byWake.values()].sort((a, b) => b.turnCost - a.turnCost);
}

export type CacheStatsInput = {
	rows: readonly RequestRow[];
	from: number;
	to: number;
	liveSince: number | null;
	internalSince?: number | null;
	projectNames: ReadonlyMap<string, string>;
	models?: Pick<Models, "getModel">;
	utcOffsetMinutes?: number;
};

export function cacheStats(input: CacheStatsInput): CacheStats {
	const rows = input.rows.filter(row => row.source !== "keepWarm");
    const refreshes = input.rows.filter(row => row.source === "keepWarm");
    const keepWarm = { refreshes: refreshes.length, cachedTokens: 0, cost: 0, failedWriteCost: 0 };
    for (const row of refreshes) { keepWarm.cachedTokens += row.cacheRead; keepWarm.cost += row.cost; keepWarm.failedWriteCost += row.costCacheWrite; }
	const nameOf = (projectId: string): string => input.projectNames.get(projectId) ?? projectId;
	const totals: CacheTotals = {
		requests: 0,
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0,
		cost: 0,
		misses: 0,
		missedTokens: 0,
		missedCost: 0,
	};
	for (const row of rows) {
		totals.requests += 1;
		totals.inputTokens += row.input;
		totals.cacheReadTokens += row.cacheRead;
		totals.cacheWriteTokens += row.cacheWrite;
		totals.outputTokens += row.output;
		totals.cost += row.cost;
		if (row.missTokens > 0) {
			totals.misses += 1;
			totals.missedTokens += row.missTokens;
			totals.missedCost += row.missCost;
		}
	}

	const offsetMs = (input.utcOffsetMinutes ?? 0) * 60_000;
	const days = new Map<string, CacheDay>();
	for (let at = input.from; at < input.to + DAY_MS; at += DAY_MS) {
		const day = dayOf(Math.min(at, input.to), offsetMs);
		if (!days.has(day)) days.set(day, { day, requests: 0, cost: 0, misses: 0, missedCost: 0 });
	}
	for (const row of input.rows) {
		const day = dayOf(row.at, offsetMs);
		let point = days.get(day);
		if (point === undefined) days.set(day, (point = { day, requests: 0, cost: 0, misses: 0, missedCost: 0 }));
		if (row.source !== "keepWarm") point.requests += 1;
		point.cost += row.cost;
		if (row.missTokens > 0) {
			point.misses += 1;
			point.missedCost += row.missCost;
		}
	}

	const conversations = new Map<string, CacheConversation>();
	for (const row of rows) {
		const key = `${row.projectId}:${row.conversationId}`;
		let conversation = conversations.get(key);
		if (conversation === undefined) {
			conversation = {
				projectId: row.projectId,
				projectName: nameOf(row.projectId),
				conversationId: row.conversationId,
				kind: row.kind,
				threadId: row.threadId,
				workerId: row.workerId,
				taskId: row.taskId,
				requests: 0,
				cost: 0,
				misses: 0,
				missedTokens: 0,
				missedCost: 0,
				lastAt: new Date(row.at).toISOString(),
			};
			conversations.set(key, conversation);
		}
		conversation.requests += 1;
		conversation.cost += row.cost;
		conversation.lastAt = new Date(row.at).toISOString();
		if (row.missTokens > 0) {
			conversation.misses += 1;
			conversation.missedTokens += row.missTokens;
			conversation.missedCost += row.missCost;
		}
	}

	const misses: CacheMissDetail[] = rows
		.filter((row) => row.missTokens > 0 && row.missReason !== null)
		.sort((a, b) => b.missCost - a.missCost)
		.slice(0, TOP_MISSES)
		.sort((a, b) => b.at - a.at)
		.map((row) => ({
			at: new Date(row.at).toISOString(),
			projectId: row.projectId,
			projectName: nameOf(row.projectId),
			conversationId: row.conversationId,
			kind: row.kind,
			threadId: row.threadId,
			workerId: row.workerId,
			taskId: row.taskId,
			provider: row.provider,
			model: row.model,
			idleMs: row.idleMs,
			missedTokens: row.missTokens,
			missedCost: row.missCost,
			reason: row.missReason as CacheMissDetail["reason"],
			wake: row.wake,
			changes: row.changes,
			source: row.source,
		}));

	const missed = rows.filter((row) => row.missTokens > 0);
	return {
		usage: usageAnalysis(input.rows, input.projectNames, input.internalSince ?? null),
		from: new Date(input.from).toISOString(),
		to: new Date(input.to).toISOString(),
		keptDays: REQUEST_LOG_KEEP_DAYS,
		liveSince: input.liveSince === null ? null : new Date(input.liveSince).toISOString(),
		keepWarm,
		totals: { ...totals, cost: totals.cost + keepWarm.cost },
		byReason: groups(missed, (row) => row.missReason ?? "unexplained", missReasonLabel),
		byProject: groups(input.rows, (row) => row.projectId, nameOf),
		byKind: groups(input.rows, (row) => row.kind, kindLabel),
		byModel: groups(input.rows, (row) => `${row.provider}/${row.model}`, (key) => key.slice(key.indexOf("/") + 1)),
		byWake: wakeGroups(rows),
		days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
		conversations: [...conversations.values()]
			.filter((conversation) => conversation.misses > 0)
			.sort((a, b) => b.missedCost - a.missedCost)
			.slice(0, TOP_CONVERSATIONS),
		misses,
		longCache: longCacheWhatIf(rows, input.models),
	};
}

/** The range `days` back from `now`. */
export function cacheStatsRange(now: number, days: number = DEFAULT_CACHE_STATS_DAYS): { from: number; to: number } {
	return { from: now - days * DAY_MS, to: now + 1 };
}

/** `cache.stats`: the last `days` of the log (default 30), every project's or one's, named from the project store. */
export async function readCacheStats(options: {
	store: RequestLogStore;
	projects: Pick<ProjectStore, "list">;
	models?: Pick<Models, "getModel">;
	days?: number;
	projectId?: string;
	utcOffsetMinutes?: number;
	calendarToday?: boolean;
	now?: number;
}): Promise<CacheStats> {
	const now = options.now ?? Date.now();
	const offset = (options.utcOffsetMinutes ?? 0) * 60_000;
	const { from, to } = options.calendarToday
		? { from: Math.floor((now + offset) / DAY_MS) * DAY_MS - offset, to: now + 1 }
		: cacheStatsRange(now, options.days);
	const projects = await options.projects.list().catch(() => []);
	return cacheStats({
		rows: options.store.rows({ from, to, ...(options.projectId === undefined ? {} : { projectId: options.projectId }) }),
		from,
		to,
		liveSince: options.store.liveSince(),
		internalSince: options.store.internalSince(),
		projectNames: new Map(projects.map((project) => [project.id, project.name])),
		...(options.models === undefined ? {} : { models: options.models }),
		...(options.utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes: options.utcOffsetMinutes }),
	});
}
