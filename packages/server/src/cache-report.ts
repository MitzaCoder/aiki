/**
 * `bun run cache-report`: the request log in a terminal. Reads `request-log.sqlite` read-only and prints what
 * `cache.stats` answers, plus one conversation's requests row by row.
 *
 *   bun run cache-report [--data-dir DIR] [--log FILE] [--days N] [--project ID] [--misses N]
 *                        [--conversation PROJECT:ID] [--json] [--backfill]
 *
 * `--backfill` first reads every project's transcripts into the log (writing it; the server does the same on start),
 * which is how a copy of another backend's data directory gets a log to dig in.
 */
import { join } from "node:path";
import { describePromptChange } from "@kemiri/protocol";
import { cacheStatsRange, kindLabel, missReasonLabel, readCacheStats } from "./cache-stats.ts";
import { FileCredentialStore } from "./credentials.ts";
import { resolveDataDir } from "./data-dir.ts";
import { createHarnessModels } from "./models.ts";
import { ProjectStore } from "./projects.ts";
import { backfillProjects } from "./request-backfill.ts";
import { RequestLog } from "./request-log.ts";
import { REQUEST_LOG_FILE, RequestLogStore, type RequestRow } from "./request-log-store.ts";

type Args = {
	dataDir: string;
	log: string | undefined;
	days: number;
	project: string | undefined;
	misses: number;
	conversation: { projectId: string; conversationId: number } | undefined;
	json: boolean;
	backfill: boolean;
};

function usage(): never {
	console.error(
		"usage: bun run cache-report [--data-dir DIR] [--log FILE] [--days N] [--project ID] [--misses N] [--conversation PROJECT:ID] [--json] [--backfill]",
	);
	process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
	const args: Args = {
		dataDir: resolveDataDir(),
		log: undefined,
		days: 30,
		project: undefined,
		misses: 20,
		conversation: undefined,
		json: false,
		backfill: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = (): string => {
			const next = argv[index + 1];
			if (next === undefined) usage();
			index += 1;
			return next;
		};
		switch (flag) {
			case "--data-dir":
				args.dataDir = value();
				break;
			case "--log":
				args.log = value();
				break;
			case "--days":
				args.days = Number(value());
				break;
			case "--project":
				args.project = value();
				break;
			case "--misses":
				args.misses = Number(value());
				break;
			case "--conversation": {
				const [projectId, id] = value().split(":");
				if (projectId === undefined || id === undefined || !Number.isInteger(Number(id))) usage();
				args.conversation = { projectId, conversationId: Number(id) };
				break;
			}
			case "--json":
				args.json = true;
				break;
			case "--backfill":
				args.backfill = true;
				break;
			default:
				usage();
		}
	}
	if (!Number.isFinite(args.days) || args.days <= 0 || !Number.isFinite(args.misses)) usage();
	return args;
}

const usd = (value: number): string => `$${value.toFixed(value >= 100 ? 0 : 2)}`;
const tokens = (value: number): string =>
	value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
const minutes = (ms: number | null): string => (ms === null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`);
const time = (at: number | string): string => new Date(at).toISOString().replace("T", " ").slice(0, 16);

function table(rows: string[][]): string {
	const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length))) ?? [];
	return rows
		.map((row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0))).join("  "))
		.join("\n");
}

function who(row: { kind: string; threadId: string | null; workerId: string | null; taskId: string | null }): string {
	const parts = [kindLabel(row.kind).replace(/s$/, "").toLowerCase()];
	if (row.kind !== "main" && row.threadId !== null && row.threadId !== "main") parts.push(`thread ${row.threadId}`);
	if (row.workerId !== null) parts.push(row.workerId);
	if (row.taskId !== null) parts.push(row.taskId);
	return parts.join(" ");
}

function printConversation(rows: readonly RequestRow[]): void {
	console.log(
		table([
			["time", "model", "prompt", "read", "write", "out", "idle", "cost", "missed", "reason", "wake", "changes"],
			...rows.map((row) => [
				time(row.at),
				row.model,
				tokens(row.promptTokens),
				tokens(row.cacheRead),
				tokens(row.cacheWrite),
				tokens(row.output),
				minutes(row.idleMs),
				usd(row.cost),
				row.missTokens > 0 ? `${tokens(row.missTokens)} ${usd(row.missCost)}` : "",
				row.missReason ?? "",
				row.wake ?? "",
				row.changes === null ? "" : row.changes.join(" "),
			]),
		]),
	);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const file = args.log ?? join(args.dataDir, REQUEST_LOG_FILE);
	const projects = new ProjectStore(args.dataDir);
	const models = createHarnessModels({ credentials: new FileCredentialStore(join(args.dataDir, "credentials.json")) });
	if (args.backfill) {
		const store = RequestLogStore.open(file);
		const requestLog = new RequestLog({ store, log: (message) => console.error(message) });
		const list = await projects.list();
		await backfillProjects({
			requestLog,
			projects: list.map((project) => ({ id: project.id, sessionPath: projects.sessionPath(project.id) })),
			log: (message) => console.error(message),
			cacheReadPerToken: (provider, modelId) => {
				const perMillion = models.getModel(provider, modelId)?.cost.cacheRead;
				return perMillion === undefined ? undefined : perMillion / 1_000_000;
			},
		});
		store.close();
	}
	const store = RequestLogStore.open(file, { readonly: true });
	try {
		if (args.conversation !== undefined) {
			const { from, to } = cacheStatsRange(Date.now(), args.days);
			const rows = store
				.rows({ from, to, projectId: args.conversation.projectId })
				.filter((row) => row.conversationId === args.conversation?.conversationId);
			printConversation(rows);
			return;
		}
		const stats = await readCacheStats({
			store,
			projects,
			models,
			days: args.days,
			...(args.project === undefined ? {} : { projectId: args.project }),
			utcOffsetMinutes: -new Date().getTimezoneOffset(),
		});
		if (args.json) {
			console.log(JSON.stringify(stats, null, 2));
			return;
		}
		const { totals } = stats;
		const prompt = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
		console.log(`Requests ${time(stats.from)} to ${time(stats.to)} (UTC); live log since ${stats.liveSince === null ? "—" : time(stats.liveSince)}`);
		console.log(
			`${totals.requests} requests, ${usd(totals.cost)}; prompt ${tokens(prompt)} tokens, ${prompt > 0 ? Math.round((100 * totals.cacheReadTokens) / prompt) : 0}% read from cache`,
		);
		console.log(
			`${totals.misses} cache misses re-billed ${tokens(totals.missedTokens)} tokens: ${usd(totals.missedCost)} (${totals.cost > 0 ? ((100 * totals.missedCost) / totals.cost).toFixed(1) : 0}% of the cost)\n`,
		);
		const groupTable = (title: string, groups: typeof stats.byReason, withRequests = true): void => {
			if (groups.length === 0) return;
			console.log(
				table([
					[title, ...(withRequests ? ["requests", "cost"] : []), "misses", "tokens", "wasted"],
					...groups.map((group) => [
						group.label,
						...(withRequests ? [String(group.requests), usd(group.cost)] : []),
						String(group.misses),
						tokens(group.missedTokens),
						usd(group.missedCost),
					]),
				]),
			);
			console.log("");
		};
		groupTable("Why", stats.byReason, false);
		groupTable("Project", stats.byProject);
		groupTable("Conversation", stats.byKind);
		groupTable("Model", stats.byModel);
		if (stats.byWake.length > 0) {
			console.log(
				table([
					["Woken by", "wakes", "turn cost", "per wake", "misses", "wasted"],
					...stats.byWake.map((wake) => [
						wake.wake,
						String(wake.wakes),
						usd(wake.turnCost),
						usd(wake.wakes > 0 ? wake.turnCost / wake.wakes : 0),
						String(wake.misses),
						usd(wake.missedCost),
					]),
				]),
			);
			console.log("");
		}
		const busyDays = stats.days.filter((day) => day.requests > 0);
		if (busyDays.length > 0) {
			console.log(
				table([
					["Day", "requests", "cost", "misses", "wasted"],
					...busyDays.map((day) => [day.day, String(day.requests), usd(day.cost), String(day.misses), usd(day.missedCost)]),
				]),
			);
			console.log("");
		}
		if (stats.conversations.length > 0) {
			console.log(
				table([
					["Worst conversations", "id", "requests", "cost", "misses", "wasted"],
					...stats.conversations.map((conversation) => [
						`${conversation.projectName} ${who(conversation)}`,
						`${conversation.projectId}:${conversation.conversationId}`,
						String(conversation.requests),
						usd(conversation.cost),
						String(conversation.misses),
						usd(conversation.missedCost),
					]),
				]),
			);
			console.log("");
		}
		const misses = [...stats.misses].sort((a, b) => b.missedCost - a.missedCost).slice(0, args.misses);
		if (misses.length > 0) {
			console.log(`Costliest misses (${misses.length} of ${totals.misses}):`);
			for (const miss of misses) {
				console.log(
					`  ${time(miss.at)}  ${usd(miss.missedCost).padStart(6)}  ${tokens(miss.missedTokens).padStart(5)}  ${missReasonLabel(miss.reason)} after ${minutes(miss.idleMs)}; woken by ${miss.wake ?? "?"}; ${miss.projectName} ${who(miss)} (${miss.projectId}:${miss.conversationId}) ${miss.model}`,
				);
				if (miss.changes === null) console.log("      what changed: not recorded (read back from the transcript)");
				else if (miss.changes.length === 0) console.log("      what changed: nothing we sent; the provider dropped its cache");
				else for (const change of miss.changes) console.log(`      ${describePromptChange(change)}`);
			}
			console.log("");
		}
		const long = stats.longCache;
		if ((long.alreadyLong ?? 0) > 0) console.log(`One-hour cache: on for ${long.alreadyLong} Claude requests.`);
		if (long.requests > 0) {
			console.log(
				`One-hour cache (Claude requests without it: ${long.requests}): would avoid ${long.missesAvoided} idle misses, saving ${usd(long.saved)}; its dearer writes would cost ${usd(long.extraWriteCost)} more; net ${long.net >= 0 ? "saving" : "cost"} ${usd(Math.abs(long.net))}. ${long.stillMissed} idle misses came after more than an hour.`,
			);
		}
	} finally {
		store.close();
	}
}

await main();
