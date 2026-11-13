import { describe, expect, test } from 'bun:test';
import { INTERACTION_REPORT_INTERVAL_MS } from '@kemiri/protocol';
import {
	INTERACTION_EVENTS,
	ThrottledReporter,
	reportInteraction,
	startInteractionReporting,
	type InteractionBackend,
	type InteractionClock
} from '../src/lib/interaction.ts';

/** Time that moves when the test says so; timers fire in order as it passes them. */
function fakeClock(): InteractionClock & { advance(ms: number): void; pending(): number } {
	let now = 1_000_000;
	let next = 0;
	const timers = new Map<number, { at: number; run: () => void }>();
	return {
		now: () => now,
		schedule: (run, delayMs) => {
			const id = next++;
			timers.set(id, { at: now + delayMs, run });
			return () => void timers.delete(id);
		},
		advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
				if (due === undefined) break;
				timers.delete(due[0]);
				now = Math.max(now, due[1].at);
				due[1].run();
			}
			now = end;
		},
		pending: () => timers.size
	};
}

describe('ThrottledReporter', () => {
	test('the first interaction goes out at once', () => {
		const clock = fakeClock();
		let sent = 0;
		new ThrottledReporter(() => sent++, { clock }).touch();
		expect(sent).toBe(1);
		expect(clock.pending()).toBe(0);
	});

	test('a burst inside the interval is one trailing send at its end', () => {
		const clock = fakeClock();
		const sentAt: number[] = [];
		const reporter = new ThrottledReporter(() => sentAt.push(clock.now()), { clock });
		const start = clock.now();
		reporter.touch();
		for (let i = 0; i < 200; i++) {
			clock.advance(10);
			reporter.touch();
		}
		expect(sentAt).toEqual([start]);
		clock.advance(INTERACTION_REPORT_INTERVAL_MS);
		expect(sentAt).toEqual([start, start + INTERACTION_REPORT_INTERVAL_MS]);
		// Nothing more without more interaction.
		clock.advance(60_000);
		expect(sentAt).toHaveLength(2);
	});

	test('continuous interaction sends once per interval, never faster', () => {
		const clock = fakeClock();
		const sentAt: number[] = [];
		const reporter = new ThrottledReporter(() => sentAt.push(clock.now()), { clock });
		for (let elapsed = 0; elapsed <= 30_000; elapsed += 100) {
			reporter.touch();
			clock.advance(100);
		}
		expect(sentAt.length).toBeGreaterThanOrEqual(6);
		expect(sentAt.length).toBeLessThanOrEqual(7);
		for (let i = 1; i < sentAt.length; i++) {
			expect(sentAt[i]! - sentAt[i - 1]!).toBeGreaterThanOrEqual(INTERACTION_REPORT_INTERVAL_MS);
		}
	});

	test('an interaction after a quiet spell goes out at once again', () => {
		const clock = fakeClock();
		let sent = 0;
		const reporter = new ThrottledReporter(() => sent++, { clock });
		reporter.touch();
		clock.advance(INTERACTION_REPORT_INTERVAL_MS + 1);
		reporter.touch();
		expect(sent).toBe(2);
	});

	test('stop cancels the trailing send', () => {
		const clock = fakeClock();
		let sent = 0;
		const reporter = new ThrottledReporter(() => sent++, { clock });
		reporter.touch();
		reporter.touch();
		reporter.stop();
		clock.advance(60_000);
		expect(sent).toBe(1);
	});

	test('a send that throws does not stop later ones', () => {
		const clock = fakeClock();
		let calls = 0;
		const reporter = new ThrottledReporter(
			() => {
				calls++;
				throw new Error('socket closed');
			},
			{ clock }
		);
		reporter.touch();
		clock.advance(INTERACTION_REPORT_INTERVAL_MS);
		reporter.touch();
		expect(calls).toBe(2);
	});
});

describe('startInteractionReporting', () => {
	function fakeTarget() {
		const listeners = new Map<string, EventListener>();
		return {
			listeners,
			addEventListener: (type: string, listener: EventListener) => void listeners.set(type, listener),
			removeEventListener: (type: string) => void listeners.delete(type),
			fire: (type: string, trusted = true) =>
				listeners.get(type)?.({ type, isTrusted: trusted } as unknown as Event)
		};
	}

	test('presses, keys, touches, the wheel and typing count; a mouse move or a scroll does not', () => {
		const clock = fakeClock();
		const target = fakeTarget();
		let sent = 0;
		const stop = startInteractionReporting(target, () => sent++, { clock });
		expect([...target.listeners.keys()].sort()).toEqual([...INTERACTION_EVENTS].sort());
		expect(target.listeners.has('mousemove')).toBe(false);
		expect(target.listeners.has('scroll')).toBe(false);
		for (const type of INTERACTION_EVENTS) {
			clock.advance(INTERACTION_REPORT_INTERVAL_MS);
			target.fire(type);
		}
		expect(sent).toBe(INTERACTION_EVENTS.length);
		stop();
		expect(target.listeners.size).toBe(0);
	});

	test('a synthetic event does not count', () => {
		const target = fakeTarget();
		let sent = 0;
		startInteractionReporting(target, () => sent++, { clock: fakeClock() });
		target.fire('keydown', false);
		expect(sent).toBe(0);
	});
});

describe('reportInteraction', () => {
	function backend(options: { ready?: boolean; features?: string[] }): InteractionBackend & { sent: string[] } {
		const sent: string[] = [];
		return {
			sent,
			ready: options.ready ?? true,
			connection: { status: 'ready', features: options.features },
			client: {
				reportNotificationInteraction: async (deviceId) => {
					sent.push(deviceId);
					return 0;
				}
			}
		};
	}

	test('goes to every ready backend that has the feature, and only those', () => {
		const modern = backend({ features: ['notifications', 'notification-hold'] });
		const second = backend({ features: ['notification-hold'] });
		const old = backend({ features: ['notifications'] });
		const unknown = backend({});
		const away = backend({ ready: false, features: ['notification-hold'] });
		reportInteraction([modern, second, old, unknown, away], 'device-1');
		expect(modern.sent).toEqual(['device-1']);
		expect(second.sent).toEqual(['device-1']);
		expect(old.sent).toEqual([]);
		expect(unknown.sent).toEqual([]);
		expect(away.sent).toEqual([]);
	});

	test('a backend that fails does not stop the others', async () => {
		const failing = backend({ features: ['notification-hold'] });
		failing.client.reportNotificationInteraction = () => Promise.reject(new Error('closed'));
		const healthy = backend({ features: ['notification-hold'] });
		reportInteraction([failing, healthy], 'device-1');
		await Promise.resolve();
		expect(healthy.sent).toEqual(['device-1']);
	});
});
