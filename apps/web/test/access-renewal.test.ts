import { expect, test } from 'bun:test';
import { renewBackendAccess } from '../src/lib/access-renewal.ts';
import { AuthHttpError } from '../src/lib/device-auth.ts';

function renewal(refresh: () => Promise<{ accessToken: string }>, rejection?: unknown) {
	let disconnects = 0; let closes = 0; let requests = 0; let connected = true;
	return {
		counts: () => ({ disconnects, closes, requests }),
		stop: () => { connected = false; },
		work: () => renewBackendAccess({ refresh }, {
			get connected() { return connected; },
			request: async () => { requests++; if (rejection) throw rejection; return { type: 'auth.renew' }; },
			disconnect: () => { disconnects++; }, close: () => { closes++; },
		}),
	};
}
test('proactive renewal keeps a healthy socket', async () => {
	const t = renewal(async () => ({ accessToken: 'synthetic' }));
	expect(await t.work()).toEqual({ state: 'renewed' });
	expect(t.counts()).toEqual({ disconnects: 0, closes: 0, requests: 1 });
});
test('network, 5xx, bare HTTP 401 and Host 403 join the transport backoff loop', async () => {
	for (const error of [new TypeError('offline'), new AuthHttpError('http_error', 401, 1), new AuthHttpError('forbidden_host', 403, 1), new AuthHttpError('http_error', 503, 1)]) {
		const t = renewal(async () => { throw error; });
		expect(await t.work()).toEqual({ state: 'reconnecting' });
		expect(t.counts()).toEqual({ disconnects: 1, closes: 0, requests: 0 });
	}
});
test('definitive retained rejection stops renewal and exposes the notice', async () => {
	const error = new AuthHttpError('auth_expired', 401, 1, false);
	const t = renewal(async () => { throw error; });
	expect(await t.work()).toEqual({ state: 'expired', notice: 'Session expired' });
	expect(t.counts()).toEqual({ disconnects: 0, closes: 1, requests: 0 });
});
test('a refresh finishing after disconnect must not send a request that restarts a closed client', async () => {
	const t = renewal(async () => { t.stop(); return { accessToken: 'synthetic' }; });
	expect(await t.work()).toEqual({ state: 'reconnecting' });
	expect(t.counts()).toEqual({ disconnects: 0, closes: 0, requests: 0 });
});
test('access rejection during auth.renew reconnects rather than expiring the retained session', async () => {
	const t = renewal(async () => ({ accessToken: 'synthetic' }), Object.assign(new Error('not signed in'), { code: 'auth_invalid' }));
	expect(await t.work()).toEqual({ state: 'reconnecting' });
	expect(t.counts()).toEqual({ disconnects: 1, closes: 0, requests: 1 });
});
