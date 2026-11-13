/**
 * Telling the backends that the user is using the app, so they drop the notifications they are holding (feature
 * `notification-hold`; design in `docs/DESIGN.md` "Notifications"). Listening is cheap: a handful of passive listeners
 * that compare two numbers. Sending is throttled: the first interaction goes out at once, later ones as one trailing
 * message when `INTERACTION_REPORT_INTERVAL_MS` has passed, so a user who keeps scrolling costs one tiny message every 5 s
 * per backend, and a user who stops costs nothing.
 *
 * What counts: a pointer press, a key, a touch (start or move), the wheel and typing (`input`, which soft keyboards fire
 * where `keydown` is only a placeholder). A mouse move does not, and neither does a `scroll` event: the transcript
 * scrolls itself while a reply streams, and that is not the user. Synthetic events (`isTrusted` false) are ignored.
 */
import { INTERACTION_REPORT_INTERVAL_MS } from '@kemiri/protocol';

export const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'touchmove', 'wheel', 'input'] as const;
export const NOTIFICATION_HOLD_FEATURE = 'notification-hold';

export type InteractionClock = {
	now: () => number;
	/** Run `run` after `delayMs`; returns what cancels it. */
	schedule: (run: () => void, delayMs: number) => () => void;
};

const browserClock: InteractionClock = {
	now: () => Date.now(),
	schedule: (run, delayMs) => {
		const timer = setTimeout(run, delayMs);
		return () => clearTimeout(timer);
	}
};

/** At most one `send` per interval: the first call now, calls inside the interval as one trailing send at its end. */
export class ThrottledReporter {
	readonly #send: () => void;
	readonly #clock: InteractionClock;
	readonly #intervalMs: number;
	#lastSentAt = Number.NEGATIVE_INFINITY;
	#cancelTrailing: (() => void) | undefined;

	constructor(
		send: () => void,
		options: { clock?: InteractionClock; intervalMs?: number } = {}
	) {
		this.#send = send;
		this.#clock = options.clock ?? browserClock;
		this.#intervalMs = options.intervalMs ?? INTERACTION_REPORT_INTERVAL_MS;
	}

	/** The user interacted. */
	touch(): void {
		if (this.#cancelTrailing !== undefined) return;
		const now = this.#clock.now();
		const wait = this.#lastSentAt + this.#intervalMs - now;
		if (wait <= 0) {
			this.#fire(now);
			return;
		}
		this.#cancelTrailing = this.#clock.schedule(() => {
			this.#cancelTrailing = undefined;
			this.#fire(this.#clock.now());
		}, wait);
	}

	stop(): void {
		this.#cancelTrailing?.();
		this.#cancelTrailing = undefined;
	}

	#fire(at: number): void {
		this.#lastSentAt = at;
		try {
			this.#send();
		} catch {
			// A report that cannot be sent is lost; the next interaction sends another.
		}
	}
}

/** What `reportInteraction` needs of a backend. */
export type InteractionBackend = {
	ready: boolean;
	connection: { status: string; features?: readonly string[] | undefined };
	client: { reportNotificationInteraction(deviceId: string): Promise<number> };
};

/** Tell every connected backend that offers the hold. Backends do not talk to each other, so each hears it itself. */
export function reportInteraction(backends: readonly InteractionBackend[], deviceId: string): void {
	for (const backend of backends) {
		if (!backend.ready || backend.connection.features?.includes(NOTIFICATION_HOLD_FEATURE) !== true) continue;
		backend.client.reportNotificationInteraction(deviceId).catch(() => undefined);
	}
}

/** Listen for interaction on `target` (the window) and call `send` through the throttle; returns what stops it. */
export function startInteractionReporting(
	target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
	send: () => void,
	options: { clock?: InteractionClock; intervalMs?: number } = {}
): () => void {
	const reporter = new ThrottledReporter(send, options);
	const listener = (event: Event): void => {
		if (event.isTrusted) reporter.touch();
	};
	const listenerOptions = { capture: true, passive: true } as const;
	for (const type of INTERACTION_EVENTS) target.addEventListener(type, listener, listenerOptions);
	return () => {
		for (const type of INTERACTION_EVENTS) target.removeEventListener(type, listener, listenerOptions);
		reporter.stop();
	};
}
