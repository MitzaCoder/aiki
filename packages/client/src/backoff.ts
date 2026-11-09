/** Exponential reconnect backoff, with jitter so several devices do not retry in lockstep. */
export type BackoffOptions = {
	initialDelayMs?: number;
	maxDelayMs?: number;
	factor?: number;
	/** Fraction of the delay to vary by either side, between 0 and 1. */
	jitter?: number;
	/** Stop reconnecting after this many attempts; omitted means forever. */
	maxAttempts?: number;
};

export const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, "maxAttempts">> = {
	initialDelayMs: 250,
	maxDelayMs: 8_000,
	factor: 2,
	jitter: 0.2,
};

/** Delay before reconnect attempt `attempt` (zero-based). */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
	const initial = options.initialDelayMs ?? DEFAULT_BACKOFF.initialDelayMs;
	const max = options.maxDelayMs ?? DEFAULT_BACKOFF.maxDelayMs;
	const factor = options.factor ?? DEFAULT_BACKOFF.factor;
	const jitter = options.jitter ?? DEFAULT_BACKOFF.jitter;

	const base = Math.min(max, initial * factor ** Math.max(0, attempt));
	if (jitter <= 0) return Math.round(base);
	const spread = base * jitter;
	return Math.round(Math.max(0, base - spread + Math.random() * spread * 2));
}

/** Whether another attempt may run. Omitted `maxAttempts` means always. */
export function canRetry(attempt: number, options: BackoffOptions = {}): boolean {
	return options.maxAttempts === undefined || attempt < options.maxAttempts;
}
