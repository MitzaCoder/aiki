/** Decision-oriented totals from recorded requests, including internal calls and cache maintenance. */
import type { UsageAnalysis, UsageGroup } from "@aiki/protocol";
import type { RequestRow } from "./request-log-store.ts";

export function usageRole(row: RequestRow): string {
	if (row.source === "keepWarm") return "keep_warm";
	if (row.purpose) return row.purpose;
	if (row.scheduleId !== null) return "scheduled";
	return ({ main: "coordinator", thread: "thread", worker: "worker", other: "unknown" } as const)[row.kind];
}
const ROLE_LABELS: Record<string, string> = {
	coordinator: "Coordinator",
	worker: "Workers",
	thread: "Background threads",
	scheduled: "Scheduled runs",
	keep_warm: "Keep-warm",
	compaction: "Compaction",
	memory_extraction: "Memory extraction",
	memory_maintenance: "Memory maintenance",
	report_audit: "Report audit",
	unknown: "Unattributed",
};
export function usageRoleLabel(role: string): string {
	return ROLE_LABELS[role] ?? role;
}
function emptyGroup(key: string, label: string): UsageGroup {
	return {
		key,
		label,
		requests: 0,
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0,
		cost: 0,
		maxPromptTokens: 0,
	};
}
function add(group: UsageGroup, row: RequestRow): void {
	group.requests++;
	group.inputTokens += row.input;
	group.cacheReadTokens += row.cacheRead;
	group.cacheWriteTokens += row.cacheWrite;
	group.outputTokens += row.output;
	group.cost += row.cost;
	group.maxPromptTokens = Math.max(group.maxPromptTokens, row.promptTokens);
}
function total(rows: readonly RequestRow[], key: string, label: string): UsageGroup {
	const group = emptyGroup(key, label);
	for (const row of rows) add(group, row);
	return group;
}
function groups(rows: readonly RequestRow[], identify: (row: RequestRow) => [string, string]): UsageGroup[] {
	const grouped = new Map<string, UsageGroup>();
	for (const row of rows) {
		const [key, label] = identify(row);
		let group = grouped.get(key);
		if (!group) grouped.set(key, (group = emptyGroup(key, label)));
		add(group, row);
	}
	return [...grouped.values()].sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));
}
export function usageAnalysis(
	rows: readonly RequestRow[],
	projectNames: ReadonlyMap<string, string>,
	internalSince: number | null,
): UsageAnalysis {
	const name = (id: string) => (id === "backend-maintenance" ? "Backend maintenance" : (projectNames.get(id) ?? id));
	return {
		totals: total(rows, "all", "All recorded requests"),
		byRole: groups(rows, (r) => {
			const role = usageRole(r);
			return [role, usageRoleLabel(role)];
		}),
		byModel: groups(rows, (r) => [JSON.stringify([r.provider, r.model]), `${r.provider} / ${r.model}`]),
		byModelRole: groups(rows, (r) => [
			JSON.stringify([r.provider, r.model, usageRole(r)]),
			`${r.provider} / ${r.model} · ${usageRoleLabel(usageRole(r))}`,
		]),
		byProject: groups(rows, (r) => [r.projectId, name(r.projectId)]),
		byTask: groups(
			rows.filter((r) => r.taskId !== null),
			(r) => [JSON.stringify([r.projectId, r.taskId]), `${name(r.projectId)} · ${r.taskId}`],
		).slice(0, 30),
		conversations: groups(
			rows.filter((r) => !r.purpose),
			(r) => [
				JSON.stringify([r.projectId, r.conversationId]),
				`${name(r.projectId)} · ${r.workerId ?? r.threadId ?? `conversation ${r.conversationId}`} · ${usageRoleLabel(usageRole({ ...r, source: "live" }))}`,
			],
		).slice(0, 30),
		failed: total(
			rows.filter((r) => r.stopReason === "error" || r.stopReason === "aborted"),
			"failed",
			"Failed or stopped responses",
		),
		checkIns: total(
			rows.filter((r) => r.source !== "keepWarm" && r.wake === "check_in"),
			"check_in",
			"Check-in requests",
		),
		retries: total(
			rows.filter((r) => r.source !== "keepWarm" && r.wake === "retry"),
			"retry",
			"Retry requests",
		),
		internalSince: internalSince === null ? null : new Date(internalSince).toISOString(),
	};
}
