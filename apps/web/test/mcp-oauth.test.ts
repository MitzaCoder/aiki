import { expect, it } from 'bun:test';
import { mcpOAuthStorageKey, parseMcpOAuthCallback } from '../src/lib/mcp-oauth.ts';
it('parses callback and routes only through the saved backend ID', () => {
 const storage = { getItem: (key: string) => key === 'aiki.mcpOAuth.synthetic-state' ? 'synthetic-backend' : null };
 const callback = parseMcpOAuthCallback('https://example.com/mcp/oauth/callback?state=synthetic-state&code=synthetic-code&backend=https://evil.example', storage);
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
