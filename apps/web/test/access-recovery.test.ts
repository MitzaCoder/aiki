import { afterEach, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { HarnessClient } from '@aiki/client';
import { createSetup } from '../../../packages/server/test/support.ts';
import { BackendDeviceAuth, authRequest, type ClaimResult } from '../src/lib/device-auth.ts';
import { DeviceCredentialStore, newClaimProof } from '../src/lib/device-credentials.ts';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function paired() {
	let offset = 0;
	const s = await createSetup({ auth: { mode: 'required', controlSocket: false }, terminals: false, now: () => Date.now() + offset });
	cleanups.push(s.cleanup);
	const factory = new IDBFactory();
	const auth = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
	await auth.discover();
	const grant = s.server.auth.bootstrap(); const proof = newClaimProof();
	const result = await authRequest<ClaimResult>(s.server.url, '/auth/bootstrap/redeem', {
		...proof, requestId: grant.requestId, code: grant.secret, label: 'Synthetic browser', platform: 'web',
	});
	await auth.acceptClaim(result, proof);
	return { s, auth, factory, advance: (ms: number) => { offset += ms; } };
}
function failRefresh(status: number, code?: string) {
	const original = globalThis.fetch;
	globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
		if (String(input).endsWith('/auth/session/refresh')) return new Response(JSON.stringify(code ? { error: { code } } : {}), { status });
		return original(input, init);
	}, original);
	cleanups.push(() => { globalThis.fetch = original; });
}
test('expired access reconnects with the retained session, without a reload', async () => {
	const { auth, advance } = await paired();
	let renewals = 0;
	const client = new HarnessClient({ url: auth.origin.replace('http', 'ws') + '/ws', prepareHello: () => { renewals++; return auth.prepare(); }, reconnect: { initialDelayMs: 10, maxDelayMs: 50, jitter: 0 } });
	cleanups.push(() => client.close());
	await client.whenReady();
	const retained = (await auth.record()).session!.sessionToken;
	advance(961_000);
	// An expired ordinary request closes the old socket beyond its 60-second grace.
	await client.listProjects().catch(() => undefined);
	await client.whenReady(2000);
	expect(client.connected).toBe(true);
	expect(renewals).toBe(2);
	expect((await auth.record()).session!.sessionToken).toBe(retained);
});
for (const [status, code] of [[401, 'auth_invalid'], [401, 'auth_expired'], [403, 'auth_revoked']] as const) {
	test(`retained refresh ${status}/${code} clears only this backend and stops retries`, async () => {
		const { auth } = await paired();
		const other = { backendId: 'other', origin: 'https://other.example.com', advertised: true, session: (await auth.record()).session };
		await auth.store.write(other);
		failRefresh(status, code);
		let failure: unknown; try { await auth.refresh(); } catch (error) { failure = error; }
		expect(failure).toMatchObject({ code, retryable: false });
		expect((await auth.record()).session).toBeUndefined();
		expect((await auth.store.read(other.backendId, other.origin))?.session).toBeDefined();
	});
}
for (const [status, code] of [[401, undefined], [403, 'forbidden_host'], [503, 'auth_invalid'], [429, 'rate_limited']] as const) {
	test(`HTTP ${status}/${code ?? 'bare'} preserves retained credentials and remains retryable`, async () => {
		const { auth } = await paired(); const retained = (await auth.record()).session;
		failRefresh(status, code);
		let failure: unknown; try { await auth.refresh(); } catch (error) { failure = error; }
		expect(failure).toMatchObject({ retryable: true });
		expect((await auth.record()).session).toEqual(retained);
	});
}
test('discovery 401 is not a retained-session rejection', async () => {
	const { auth } = await paired(); const retained = (await auth.record()).session;
	const original = globalThis.fetch;
	globalThis.fetch = Object.assign(async () => new Response(JSON.stringify({ error: { code: 'auth_invalid' } }), { status: 401 }), original);
	cleanups.push(() => { globalThis.fetch = original; });
	let failure: unknown; try { await auth.prepare(); } catch (error) { failure = error; }
	expect(failure).toMatchObject({ retryable: true });
	expect((failure as Error).message).not.toBe('Session expired');
	expect((await auth.record()).session).toEqual(retained);
});
test('two tabs refresh the latest stored successor under the same Web Lock', async () => {
	const { auth, s, factory, advance } = await paired();
	let chain = Promise.resolve();
	const locks = { request: (_name: string, work: () => Promise<unknown>) => { const next = chain.then(work); chain = next.then(() => undefined); return next; } };
	const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
	Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
	cleanups.push(() => { if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else delete (navigator as { locks?: unknown }).locks; });
	const tab = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
	await tab.discover();
	const old = (await tab.record()).session!.sessionToken;
	advance(31 * 86400_000);
	// Rotation due according to the browser as well; no global clock mutation.
	const record = await auth.record(); record.session!.rotateAfter = new Date(0).toISOString(); await auth.store.write(record);
	await Promise.all([auth.refresh(), tab.refresh()]);
	const successor = (await auth.record()).session!.sessionToken;
	expect(successor).not.toBe(old);
	expect((await tab.record()).session!.sessionToken).toBe(successor);
	expect((await tab.record()).session!.stagedSuccessor).toBeUndefined();
});
