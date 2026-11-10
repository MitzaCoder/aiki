import { afterEach, expect, test } from 'bun:test';
import { HarnessClient } from '../src/client.ts';
import type { HarnessWebSocket } from '../src/websocket.ts';

const clients: HarnessClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
async function until(check: () => boolean) {
	const end = Date.now() + 1500;
	while (!check() && Date.now() < end) await Bun.sleep(2);
	expect(check()).toBe(true);
}
function transport(prepareHello?: () => Promise<string | undefined>, rejectHello = false) {
	const sockets: HarnessWebSocket[] = [];
	const tokens: string[] = [];
	const opened: number[] = [];
	const client = new HarnessClient({
		url: 'ws://backend.example.com/ws', prepareHello,
		reconnect: { initialDelayMs: 20, maxDelayMs: 160, jitter: 0 },
		webSocketFactory: () => {
			const socket: HarnessWebSocket = {
				onopen: null, onmessage: null, onclose: null, onerror: null,
				close(code, reason) { queueMicrotask(() => socket.onclose?.({ code, reason })); },
				send(raw) {
					const hello = JSON.parse(String(raw));
					tokens.push(hello.auth?.accessToken);
					queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify(rejectHello
						? { type: 'error', id: hello.id, error: { code: 'auth_invalid', message: 'Not signed in' } }
						: { type: 'hello', id: hello.id, server: { name: 'test', version: '0' }, features: [] }) }));
				},
			};
			opened.push(Date.now()); sockets.push(socket);
			queueMicrotask(() => socket.onopen?.());
			return socket;
		},
	});
	clients.push(client);
	return { client, sockets, tokens, opened };
}
test('4401 prepares a fresh access token once before reconnecting', async () => {
	let renewals = 0;
	const t = transport(async () => `access-${++renewals}`);
	await t.client.whenReady();
	t.sockets[0]!.close(4401, 'auth_expired');
	await until(() => t.tokens.length === 2 && t.client.connected);
	expect(t.tokens).toEqual(['access-1', 'access-2']);
	expect(renewals).toBe(2);
});
test('transient prepare failures preserve the retry loop, definite rejection stops it', async () => {
	let renewals = 0;
	const t = transport(async () => {
		if (++renewals === 1) throw Object.assign(new Error('temporary HTTP failure'), { status: 401, retryable: true });
		if (renewals === 2) return 'access';
		throw Object.assign(new Error('Session expired'), { status: 401, retryable: false });
	});
	await t.client.whenReady();
	t.sockets[0]!.close(4401);
	await until(() => t.client.state.status === 'closed');
	await Bun.sleep(60);
	expect(renewals).toBe(3);
});
test('repeated short successful hellos do not reset access-rejection backoff', async () => {
	const t = transport(async () => 'access');
	await t.client.whenReady();
	for (let i = 0; i < 3; i++) {
		t.sockets[i]!.close(4401);
		await until(() => t.sockets.length === i + 2 && t.client.connected);
	}
	expect(t.opened[2]! - t.opened[1]!).toBeGreaterThanOrEqual(35);
	expect(t.opened[3]! - t.opened[2]!).toBeGreaterThanOrEqual(70);
});
test('hello access rejection is retryable with preparation and backs off', async () => {
	let renewals = 0;
	const t = transport(async () => `access-${++renewals}`, true);
	t.client.connect();
	await until(() => t.tokens.length >= 3);
	expect(t.opened[2]! - t.opened[1]!).toBeGreaterThanOrEqual(35);
	expect(renewals).toBe(t.tokens.length);
});
test('clients without retained credential preparation still stop on 4401', async () => {
	const t = transport();
	await t.client.whenReady(); t.sockets[0]!.close(4401);
	await until(() => t.client.state.status === 'closed');
	await Bun.sleep(40); expect(t.sockets).toHaveLength(1);
});
