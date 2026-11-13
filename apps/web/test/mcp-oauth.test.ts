import { expect, it } from 'bun:test';
import { mcpOAuthStorageKey, parseMcpOAuthCallback, startMcpOAuth } from '../src/lib/mcp-oauth.ts';
it('parses callback and routes only through the saved backend ID', () => {
 const storage = { getItem: (key: string) => key === 'aiki.mcpOAuth.synthetic-state' ? JSON.stringify({ backendId: 'synthetic-backend', flowId: 'synthetic-flow' }) : null };
 const callback = parseMcpOAuthCallback('https://example.com/mcp/oauth/callback?state=synthetic-state&code=synthetic-code&backend=https://evil.example', storage);
 expect(callback.flowId).toBe('synthetic-flow');
 expect(callback.backendId).toBe('synthetic-backend'); expect(callback.error).toBeUndefined();
 expect(mcpOAuthStorageKey('s')).toBe('aiki.mcpOAuth.s');
 expect(parseMcpOAuthCallback('https://example.com/mcp/oauth/callback?state=else&code=c', storage).backendId).toBeNull();
});
it('rejects missing, duplicate and failed callbacks and tolerates unavailable storage', () => {
 const storage = { getItem: () => null };
 for (const query of ['', '?state=s', '?state=s&code=c&state=other', '?state=s&code=c&code=other', '?error=access_denied&state=s']) {
  expect(parseMcpOAuthCallback('https://example.com/mcp/oauth/callback' + query, storage).error).toBeTruthy();
 }
 expect(parseMcpOAuthCallback('https://example.com/wrong?state=s&code=c', storage).error).toBeTruthy();
 expect(parseMcpOAuthCallback('https://example.com/mcp/oauth/callback?state=s&code=c', { getItem() { throw new Error('blocked'); } }).backendId).toBeNull();
});

it('copy-only start saves a trusted flow route without opening or navigating a browser', async () => {
 const names = ['window', 'location', 'localStorage'] as const;
 const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
 const saved = new Map<string, string>();
 const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, value });
 define('window', { open() { throw new Error('Copy must not open a browser'); } });
 define('location', { origin: 'https://app.example.test', assign() { throw new Error('Copy must keep settings open'); } });
 define('localStorage', { setItem: (key: string, value: string) => saved.set(key, value) });
 const calls: unknown[] = [];
 const backend = { id: 'synthetic-backend', client: { request: async (request: unknown) => {
  calls.push(request); return { type: 'mcp.oauth.start', flowId: 'synthetic-flow', authorizationUrl: 'https://issuer.example.test/authorize?state=synthetic-state', expiresAt: 123 };
 } } };
 try {
  const started = await startMcpOAuth(backend as never, 'notion', false);
  expect(started.authorizationUrl).toContain('state=synthetic-state');
  expect(calls).toEqual([{ type: 'mcp.oauth.start', serverId: 'notion', redirectUri: 'https://app.example.test/mcp/oauth/callback' }]);
  expect(JSON.parse(saved.get(mcpOAuthStorageKey('synthetic-state'))!)).toEqual({ backendId: 'synthetic-backend', flowId: 'synthetic-flow' });
  expect(JSON.stringify([...saved])).not.toContain('authorize');
 } finally {
  names.forEach((name, index) => { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
 }
});
it('no-session, stale and malformed local routes do not provide a completion destination', () => {
 const href = 'https://app.example.test/mcp/oauth/callback?state=s&code=synthetic';
 for (const saved of [null, 'legacy-backend', '{}', '{"backendId":"b"}']) {
  const parsed = parseMcpOAuthCallback(href, { getItem: () => saved });
  expect(parsed.backendId).toBeNull(); expect(parsed.redirectUrl).toBe(href); expect(parsed.error).toBeUndefined();
 }
});
it('the no-session callback screen offers full URL copy-back, not an error or network submission', async () => {
 const { createServer } = await import('vite');
 const vite = await createServer({ root: import.meta.dir + '/..', server: { middlewareMode: true }, logLevel: 'error' });
 try {
  const { default: CopyBack } = await vite.ssrLoadModule('/src/lib/components/McpOAuthCopyBack.svelte');
  const { render } = await vite.ssrLoadModule('svelte/server');
  const html = render(CopyBack, { props: { redirectUrl: 'https://app.example.test/mcp/oauth/callback?state=s&code=synthetic' } }).body;
  expect(html).toContain('Sign-in almost done'); expect(html).toContain('Copy this link and paste it in Kemiri where you started.');
  expect(html).toContain('Copy URL'); expect(html).toContain('code=synthetic'); expect(html).not.toContain('Could not sign in');
  expect(html).not.toContain('<form');
 } finally { await vite.close(); }
}, 20_000);


it('shows the safe backend reason when starting fails and closes the blank consent tab', async () => {
 const names = ['window', 'location'] as const;
 const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
 let closed = 0;
 Object.defineProperty(globalThis, 'window', { configurable: true, value: { open: () => ({ close() { closed++; }, opener: null }) } });
 Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'http://localhost:7317' } });
 try {
  for (const message of ['MCP callback must use an allowed web origin and /mcp/oauth/callback', 'MCP server refused OAuth client registration (HTTP 400; invalid_redirect_uri).']) {
   const backend = { client: { request: async () => ({ type: 'error', error: { code: 'bad_request', message } }) } };
   await expect(startMcpOAuth(backend as never, 'notion')).rejects.toThrow(message);
  }
  expect(closed).toBe(2);
 } finally {
  names.forEach((name, index) => { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
 }
});
