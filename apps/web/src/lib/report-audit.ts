import type { ModelInfo, ProviderInfo, ReportAuditStatus } from '@kemiri/protocol';
import { providerName, sameModel } from './models.js';
import { relativeTime } from './relative-time.js';

/** Unlike older capabilities, a missing hello list never implies audit support. */
export function reportAuditSupported(features: readonly string[] | undefined): boolean {
	return features?.includes('report-audit') ?? false;
}

export function parseReportAuditBudget(text: string): number | undefined {
	if (!/^\d+$/.test(text.trim())) return undefined;
	const budget = Number(text);
	return Number.isSafeInteger(budget) && budget >= 0 && budget <= 10_000_000 ? budget : undefined;
}

/** Show the server's effective choice, never predict the automatic model in the client. */
export function reportAuditStatusLines(
	status: ReportAuditStatus | undefined,
	dailyTokens: number,
	models: readonly ModelInfo[],
	providers: readonly ProviderInfo[],
	now: number,
): string[] {
	if (status === undefined) return ['Reading report check status…'];
	const model = status.effectiveModel;
	const modelName = model ? models.find(entry => sameModel(entry, model))?.name ?? model.modelId : undefined;
	const state = ({ idle: 'Idle', running: 'Checking reports…', checked: 'Reports checked', error: 'Report check failed', budget: 'Daily budget spent', off: 'Off', unavailable: 'Unavailable' } as Record<string, string>)[status.state] ?? status.state;
	const count = (tokens: number) => tokens.toLocaleString('en-US');
	const usage = `${count(status.tokensUsed)} of ${count(dailyTokens)} tokens today`;
	const lastRun = status.lastRunAt ? `Last run ${relativeTime(status.lastRunAt, now)}` : 'No checks run yet';
	const reason = status.reason ? status.reason.charAt(0).toUpperCase() + status.reason.slice(1) : state;
	return [
		[model ? `Using ${modelName} via ${providerName(providers, model.provider)}` : undefined, usage].filter(Boolean).join(' · '),
		`${lastRun} · ${reason}`,
	];
}
