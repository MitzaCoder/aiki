import { afterEach, describe, expect, test } from 'bun:test';
import { installPushBrowser } from './push-browser-mock.ts';
import { IDBFactory } from 'fake-indexeddb';
import { HarnessClient } from '@kemiri/client';
import { artifactUrlRefreshIn } from '@kemiri/client';
import { encodePairingFragment } from '@kemiri/protocol';
import { createSetup, type TestSetup } from '../../../packages/server/test/support.ts';
import {
	BackendDeviceAuth,
	AuthHttpError,
	authRequest,
	consumePairFragment,
	renewIn,
	rotationDue,
	type ClaimResult,
} from '../src/lib/device-auth.ts';
import {
	DeviceCredentialStore,
	credentialKey,
	newClaimProof,
	randomSecret,
	withCredentialLock,
} from '../src/lib/device-credentials.ts';
const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(mode: 'required' | 'optional' = 'required') {
	const s = await createSetup({
		auth: { mode },
		allowedOrigins: ['https://app.example.com'],
		terminals: false,
	});
	cleanups.push(s.cleanup);
	return s;
}
async function owner(s: TestSetup, store = new DeviceCredentialStore(new IDBFactory())) {
	const auth = new BackendDeviceAuth(s.server.url, store);
	await auth.discover();
	const bootstrap = s.server.auth.bootstrap();
	const proof = newClaimProof();
	const result = await authRequest<ClaimResult>(s.server.url, '/auth/bootstrap/redeem', {
		requestId: bootstrap.requestId,
		code: bootstrap.secret,
		...proof,
		label: 'Synthetic browser',
		platform: 'web',
	});
	await auth.acceptClaim(result, proof);
	return auth;
}
async function socket(auth: BackendDeviceAuth) {
	const client = new HarnessClient({
		url: auth.origin.replace(/^http/, 'ws') + '/ws',
		prepareHello: () => auth.prepare(),
		reconnect: { initialDelayMs: 20, maxDelayMs: 30, jitter: 0 },
	});
	cleanups.push(() => client.close());
	await client.whenReady(5000);
	return client;
}
async function waitFor(condition: () => boolean) {
	for (let n = 0; n < 100; n++) {
		if (condition()) return;
		await Bun.sleep(20);
	}
	throw new Error('Condition timed out');
}

describe('device credential isolation', () => {
	test('IndexedDB survives reload, scopes secrets by ID and exact origin, never persists access', async () => {
		const factory = new IDBFactory();
		const store = new DeviceCredentialStore(factory);
		await store.write({
			backendId: 'backend-example',
			origin: 'https://backend.example.com',
			advertised: true,
			session: {
				sessionId: 'device',
				sessionToken: 'retained',
				stagedSuccessor: 'successor',
				sessionExpiresAt: '2027-01-01',
				rotateAfter: '2026-12-01',
			},
		});
		const reloaded = new DeviceCredentialStore(factory);
		expect(
			(await reloaded.read('backend-example', 'https://backend.example.com'))?.session?.stagedSuccessor,
		).toBe('successor');
		expect(await reloaded.read('other-backend', 'https://backend.example.com')).toBeUndefined();
		expect(await reloaded.read('backend-example', 'https://other.example.com')).toBeUndefined();
		expect(JSON.stringify(await reloaded.atOrigin('https://backend.example.com'))).not.toContain(
			'accessToken',
		);
		expect(store.memoryOnly).toBe(false);
	});
	test('denied storage falls back to memory, a fresh instance has no retained session', async () => {
		const store = new DeviceCredentialStore(undefined);
		await store.write({
			backendId: 'backend-example',
			origin: 'https://backend.example.com',
			advertised: true,
		});
		expect(store.memoryOnly).toBe(true);
		expect((await store.read('backend-example', 'https://backend.example.com'))?.advertised).toBe(true);
		expect(
			await new DeviceCredentialStore(undefined).read('backend-example', 'https://backend.example.com'),
		).toBeUndefined();
	});
	test('keys cannot collide through delimiters and proof secrets use separate audiences', () => {
		expect(credentialKey('a:b', 'c')).not.toBe(credentialKey('a', 'b:c'));
		expect(newClaimProof().claimSecret).toMatch(/^aiki_c1\.[A-Za-z0-9_-]{43}$/);
	});
});

describe('invitation fragments', () => {
	const pairing = {
		backendId: 'backend-example',
		backendOrigin: 'https://backend.example.com',
		grantId: 'grant-example',
		secret: `aiki_p1.${'A'.repeat(43)}`,
	};
	function consume(hash: string, origin = 'https://app.example.com') {
		let removed = false;
		const result = consumePairFragment(
			{ hash, origin, pathname: '/pair', search: '' },
			{
				state: { preserved: true },
				replaceState(state, unused, url) {
					expect(state).toEqual({ preserved: true });
					expect(url).toBe('/pair');
					removed = true;
				},
			},
		);
		expect(removed).toBe(true);
		return result;
	}
	test('v2 invitation and local/headless bootstrap', () => {
		expect(consume(encodePairingFragment(pairing))).toEqual({ kind: 'pair', ...pairing });
		const payload = btoa(
			JSON.stringify(['backend-example', 'https://backend.example.com', 'request-example']),
		).replace(/=+$/, '');
		expect(consume('#bootstrap=v1.' + payload)?.kind).toBe('bootstrap');
		expect(consume('#bootstrap=aiki_b1.' + 'A'.repeat(43), 'http://localhost:1234')).toMatchObject({
			kind: 'bootstrap',
			requestId: 'local',
			code: 'aiki_b1.' + 'A'.repeat(43),
		});
	});
	test('removes malformed secrets before decoding and rejects old address imports', () => {
		let removed = false;
		expect(() =>
			consumePairFragment(
				{ hash: '#pair=v1.invalid', origin: 'https://app.example.com', pathname: '/pair', search: '' },
				{
					state: null,
					replaceState() {
						removed = true;
					},
				},
			),
		).toThrow();
		expect(removed).toBe(true);
		expect(consume('')).toBeUndefined();
	});
});

describe('renewal and rotation', () => {
	test('renew one minute before access expiry; rotation only at rotateAfter', () => {
		const now = Date.UTC(2026, 0, 1);
		expect(renewIn(new Date(now + 900_000).toISOString(), now)).toBe(840_000);
		expect(renewIn(new Date(now - 1).toISOString(), now)).toBe(1000);
		expect(rotationDue(new Date(now).toISOString(), now)).toBe(true);
		expect(rotationDue(new Date(now + 1).toISOString(), now)).toBe(false);
	});
	test('Web Locks serialize tabs; missing locks refuses unsafe rotation', async () => {
		let chain = Promise.resolve();
		let running = 0;
		let peak = 0;
		const locks = {
			request: (_name: string, work: () => Promise<unknown>) => {
				const next = chain.then(work);
				chain = next.then(() => {});
				return next;
			},
		} as unknown as LockManager;
		const work = () =>
			withCredentialLock(
				'backend-example',
				async () => {
					peak = Math.max(peak, ++running);
					await Bun.sleep(10);
					running--;
				},
				locks,
			);
		await Promise.all([work(), work(), work()]);
		expect(peak).toBe(1);
		await expect(withCredentialLock('backend-example', async () => {}, undefined)).rejects.toThrow(
			'Web Locks',
		);
	});
	test('staged successor resumes after a server-committed rotation and client crash', async () => {
		const s = await setup();
		const auth = await owner(s);
		const record = await auth.record();
		const session = record.session!;
		const successor = randomSecret(`aiki_s1.${session.sessionId}`);
		session.stagedSuccessor = successor;
		await auth.store.write(record);
		await authRequest(
			s.server.url,
			'/auth/session/rotate',
			{ successorToken: successor },
			session.sessionToken,
		);
		// The browser crashed here, retaining the old token and staged successor only.
		const locks = { request: async (_name: string, work: () => Promise<unknown>) => work() };
		Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
		cleanups.push(() => {
			delete (navigator as unknown as { locks?: unknown }).locks;
		});
		const restarted = new BackendDeviceAuth(s.server.url, auth.store);
		await restarted.discover();
		await restarted.refresh();
		expect((await restarted.record()).session?.sessionToken).toBe(successor);
		expect((await restarted.record()).session?.stagedSuccessor).toBeUndefined();
	});
});

test('legacy discovery only on unpinned 404; advertised backends reject downgrade and changed identity', async () => {
	let mode: 'legacy' | 'auth' | 'changed' = 'legacy';
	const server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch: () =>
			mode === 'legacy'
				? new Response('', { status: 404 })
				: Response.json({
						backendId: mode === 'changed' ? 'different-backend' : 'backend-example',
						mode: 'optional',
						authVersion: 1,
					}),
	});
	cleanups.push(() => server.stop(true));
	const auth = new BackendDeviceAuth(server.url.origin, new DeviceCredentialStore(new IDBFactory()));
	expect(await auth.prepare()).toBeUndefined();
	mode = 'auth';
	expect(await auth.prepare()).toBeUndefined();
	mode = 'legacy';
	await expect(auth.prepare()).rejects.toBeInstanceOf(AuthHttpError);
	mode = 'changed';
	await expect(auth.prepare()).rejects.toThrow('identity changed');
});

test('migration reuses persisted proof across reload, remains anonymous until approval, stores then acks', async () => {
	const s = await setup('optional');
	const store = new DeviceCredentialStore(new IDBFactory());
	const a = new BackendDeviceAuth(s.server.url, store);
	expect(await a.prepare()).toBeUndefined();
	const proof = await a.proof('migration');
	const register = (auth: BackendDeviceAuth) =>
		authRequest<ClaimResult>(auth.origin, '/auth/migration/claims', {
			...proof,
			label: 'Synthetic browser',
			platform: 'web',
		});
	const pending = await register(a);
	expect(pending.state).toBe('pending');
	expect(pending.credentials).toBeNull();
	const reloaded = new BackendDeviceAuth(s.server.url, store);
	await reloaded.discover();
	expect(await reloaded.proof('migration')).toEqual(proof);
	expect((await register(reloaded)).comparisonCode).toBe(pending.comparisonCode);
	s.server.auth.approveMigration('synthetic-batch', [proof.claimId]);
	expect(await reloaded.acceptMigration(await register(reloaded), proof)).toBe('waiting');
	const delivery = await authRequest<ClaimResult>(reloaded.origin, '/auth/claims/poll', proof);
	expect(await reloaded.acceptMigration(delivery, proof)).toBe('approved');
	expect((await reloaded.record()).migration).toBeUndefined();
	expect((await reloaded.record()).session).toBeDefined();
	expect(await reloaded.prepare()).toMatch(/^aiki_a1\./);
});

test('real server: pair → compare → approve → authenticated hello → renew same socket → revoke stops reconnect', async () => {
	const s = await setup();
	const a = await owner(s);
	const clientA = await socket(a);
	const b = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(new IDBFactory()));
	await b.discover();
	const grant = await clientA.request({ type: 'auth.pairings.create' });
	if (grant.type !== 'auth.pairings.create') throw new Error('No grant');
	const requested: string[] = [];
	clientA.onDeviceAuth((e) => {
		if (e.type === 'auth.pairingRequested') requested.push(e.pairing.comparisonCode!);
	});
	const proof = await b.proof('pairing');
	const pending = await authRequest<ClaimResult>(b.origin, '/auth/pairings/redeem', {
		...proof,
		grantId: grant.pairing.id,
		secret: grant.secret,
		label: 'Synthetic phone',
		platform: 'web',
	});
	expect(pending.state).toBe('pending');
	await waitFor(() => requested.length > 0);
	expect(requested[0]).toBe(pending.comparisonCode);
	await clientA.request({ type: 'auth.pairings.approve', grantId: grant.pairing.id, claimId: proof.claimId });
	const approved = await authRequest<ClaimResult>(b.origin, '/auth/claims/poll', proof);
	expect(await b.acceptClaim(approved, proof)).toBe(true);
	const clientB = await socket(b);
	const sessionId = clientB.state.auth!.sessionId!;
	expect(sessionId).toBe((await b.record()).session!.sessionId);
	const access = await b.refresh();
	expect((await clientB.request({ type: 'auth.renew', accessToken: access.accessToken })).type).toBe(
		'auth.renew',
	);
	expect(s.server.auth.connected.get(sessionId)).toBe(1);
	await clientA.request({ type: 'auth.devices.revoke', sessionId });
	await waitFor(() => clientB.state.status === 'closed');
	expect(clientB.state.error).toBe('This device was signed out');
	await Bun.sleep(100);
	expect(clientB.state.status).toBe('closed');
	expect(JSON.stringify(clientB.state)).not.toContain('aiki_a1.');
	expect(JSON.stringify(clientB.state)).not.toContain('aiki_s1.');
});

test('artifact remint timing supports ten-minute session URLs without refreshing other state', () => {
	const now = Date.UTC(2026, 0, 1);
	const delay = artifactUrlRefreshIn(new Date(now + 600_000).toISOString(), now);
	expect(delay).toBeGreaterThan(0);
	expect(delay).toBeLessThan(600_000);
	expect(artifactUrlRefreshIn(new Date(now - 1).toISOString(), now)).toBeGreaterThan(0);
});

test('hello advertisement also pins a previously unknown legacy-discovery origin', async () => {
	const server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch: () => new Response('', { status: 404 }),
	});
	cleanups.push(() => server.stop(true));
	const auth = new BackendDeviceAuth(server.url.origin, new DeviceCredentialStore(new IDBFactory()));
	expect(await auth.prepare()).toBeUndefined();
	await auth.pinHello('backend-example');
	await expect(auth.prepare()).rejects.toBeInstanceOf(AuthHttpError);
});

test('two tabs rotate under one lock and read the committed successor, not stale in-memory copies', async () => {
	const s = await setup();
	const factory = new IDBFactory();
	const a = await owner(s, new DeviceCredentialStore(factory));
	const record = await a.record();
	const oldToken = record.session!.sessionToken;
	record.session!.rotateAfter = new Date(0).toISOString();
	await a.store.write(record);
	const b = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
	await b.discover();
	let chain = Promise.resolve();
	Object.defineProperty(navigator, 'locks', {
		configurable: true,
		value: {
			request: (_name: string, work: () => Promise<unknown>) => {
				const next = chain.then(work);
				chain = next.then(() => {});
				return next;
			},
		},
	});
	cleanups.push(() => {
		delete (navigator as unknown as { locks?: unknown }).locks;
	});
	await Promise.all([a.refresh(), b.refresh()]);
	const sessionA = (await a.record()).session!;
	const sessionB = (await b.record()).session!;
	expect(sessionA.sessionToken).toBe(sessionB.sessionToken);
	expect(sessionA.sessionToken).not.toBe(oldToken);
	expect(sessionA.stagedSuccessor).toBeUndefined();
});

test('migration denied/expired/pending never installs credentials or interrupts anonymous access', async () => {
	const s = await setup('optional');
	const auth = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(new IDBFactory()));
	expect(await auth.prepare()).toBeUndefined();
	const proof = await auth.proof('migration');
	for (const state of ['pending', 'denied', 'expired'] as const) {
		expect(
			await auth.acceptClaim(
				{ state, claimId: proof.claimId, comparisonCode: 'AAAA-AAAA', credentials: null },
				proof,
			),
		).toBe(false);
		expect((await auth.record()).session).toBeUndefined();
	}
	const client = await socket(auth);
	expect(client.state.auth?.sessionId).toBeNull();
});

test('HTTP 429 supplies Retry-After without leaking the raw response body', async () => {
	const server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch: () =>
			Response.json(
				{ error: { code: 'rate_limited' }, private: 'not-for-errors' },
				{ status: 429, headers: { 'retry-after': '12' } },
			),
	});
	cleanups.push(() => server.stop(true));
	try {
		await authRequest(server.url.origin, '/auth/claims/poll', newClaimProof());
		throw new Error('Expected rate limit');
	} catch (error) {
		expect(error).toBeInstanceOf(AuthHttpError);
		expect((error as AuthHttpError).retryAfter).toBe(12);
		expect(String(error)).not.toContain('not-for-errors');
	}
});

test('ack loss keeps a durable delivery proof and resumed pairing survives reload', async () => {
	const s = await setup();
	const auth = await owner(s);
	const proof = newClaimProof();
	const record = await auth.record();
	record.pairing = { ...proof, grantId: 'grant-example', started: true, label: 'Synthetic backend' };
	delete record.session;
	await auth.store.write(record);
	expect((await auth.store.pendingPairing())?.pairing?.claimId).toBe(proof.claimId);
	const boot = s.server.auth.bootstrap();
	const delivered = await authRequest<ClaimResult>(auth.origin, '/auth/bootstrap/redeem', {
		...proof,
		requestId: boot.requestId,
		code: boot.secret,
		label: 'Synthetic browser',
		platform: 'web',
	});
	await auth.save(delivered.credentials!); // Simulate crashing before ack.
	expect((await auth.record()).pairing?.claimId).toBe(proof.claimId);
	expect(await auth.prepare()).toMatch(/^aiki_a1\./);
	expect((await auth.record()).pairing).toBeUndefined();
});

test('backend address persistence whitelists fields even when given an extended object', async () => {
	const { saveBackends } = await import('../src/lib/backends.ts');
	let serialized = '';
	saveBackends(
		[
			{
				id: 'backend-example',
				name: 'Synthetic backend',
				url: 'https://backend.example.com',
				sessionToken: 'must-not-export',
			} as { id: string; name: string; url: string },
		],
		{
			setItem(_key, value) {
				serialized = value;
			},
		},
	);
	expect(serialized).not.toContain('sessionToken');
	expect(serialized).not.toContain('must-not-export');
});


test('web push sync rebinds an unreadable legacy row after migration', async () => {
	const s = await setup('optional');
	const auth = await owner(s);
	const client = await socket(auth);
	const sessionId = (await auth.refresh()).sessionId;
	const deviceId = 'synthetic-migrating-browser';
	const subscription = {
		endpoint: 'https://push.example.invalid/migration',
		keys: { p256dh: 'synthetic-key', auth: 'synthetic-auth' },
	};
	await s.server.notifications.register({
		deviceId, label: 'Synthetic browser', backendKey: 'fixture', subscription,
		preferences: { kinds: [], mutedProjects: [], quietHours: null },
		allowLegacyRegistration: true,
	});
	await expect(client.readNotificationDevice(deviceId)).rejects.toThrow('another session');

	// Bun executes the class's ordinary TS directly. installPushBrowser supplies the rune stub
	// and restores its descriptor without reading Svelte's throwing dev-mode $state getter.
	// SSR component tests may install that getter first, depending on test discovery order.
	const { applicationServerKey } = await import('@kemiri/client');
	const browserSubscription = {
		options: { applicationServerKey: applicationServerKey(await client.readNotificationsConfig()).buffer },
		toJSON: () => subscription,
	} as unknown as PushSubscription;
	const restoreBrowser = installPushBrowser(browserSubscription);
	try {
		const { NotificationCenter } = await import('../src/lib/notifications.svelte.ts');
		const center = new NotificationCenter();
		center.load();
		center.settings = { ...center.settings, deviceId };

		const backend = {
			id: 'fixture', url: s.server.url, ready: true, authSessionId: sessionId,
			features: ['notifications'], supports: (feature: string) => feature === 'notifications', client,
		} as unknown as import('../src/lib/harness.svelte.ts').BackendConnection;
		await center.sync([backend]);
		expect(center.backends.fixture?.error).toBeUndefined();
		expect(center.backends.fixture?.device?.deviceId).toBe(deviceId);
		expect((await client.readNotificationDevice(deviceId))?.deviceId).toBe(deviceId);
		expect((await Bun.file(s.dataDir + '/notifications/devices.json').json()).devices[0].sessionId).toBe(sessionId);
	} finally {
		restoreBrowser();
	}
});


test('migration expiry, acknowledged response and network failure preserve one IndexedDB proof across reloads', async () => {
	const s = await setup('optional');
	const factory = new IDBFactory();
	const auth = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
	await auth.discover();
	const proof = await auth.proof('migration');
	for (const state of ['pending', 'expired', 'acknowledged'] as const) {
		expect(await auth.acceptMigration({ claimId: proof.claimId, comparisonCode: 'ABCD-EFGH', state, credentials: null }, proof)).toBe('waiting');
		const reloaded = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
		await reloaded.discover();
		expect(await reloaded.proof('migration')).toEqual(proof);
		expect((await reloaded.record()).migrationDenied).toBeUndefined();
	}
	await expect(authRequest(s.server.url, '/auth/claims/poll', proof)).rejects.toBeInstanceOf(AuthHttpError);
	expect(await auth.proof('migration')).toEqual(proof);
	expect(await auth.prepare()).toBeUndefined();
});

test('migration denial is durable and never drops the denied proof or blocks anonymous work', async () => {
	const s = await setup('optional');
	const factory = new IDBFactory();
	const auth = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
	await auth.discover();
	const proof = await auth.proof('migration');
	expect(await auth.acceptMigration({ claimId: proof.claimId, comparisonCode: 'ABCD-EFGH', state: 'denied', credentials: null }, proof)).toBe('denied');
	const reloaded = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
	expect(await reloaded.prepare()).toBeUndefined();
	expect(await reloaded.proof('migration')).toEqual(proof);
	expect((await reloaded.record()).migrationDenied).toBe(true);
});


test('an offline approved migration collects during prepare after required-mode cutover', async () => {
	const s = await setup('optional');
	const factory = new IDBFactory();
	const auth = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
	await auth.discover();
	const proof = await auth.proof('migration');
	await authRequest(auth.origin, '/auth/migration/claims', { ...proof, label: 'Offline browser', platform: 'web' });
	s.server.auth.approveMigration('offline-browser', [proof.claimId]);
	s.server.auth.setMode('required');
	const reloaded = new BackendDeviceAuth(s.server.url, new DeviceCredentialStore(factory));
	expect(await reloaded.prepare()).toMatch(/^aiki_a1\./);
	expect((await reloaded.record()).session).toBeDefined();
	expect((await reloaded.record()).migration).toBeUndefined();
});
