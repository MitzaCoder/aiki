import type { BackendConnection } from './harness.svelte.js';

export const MCP_OAUTH_CALLBACK_PATH = '/mcp/oauth/callback';
export const mcpOAuthStorageKey = (state: string): string => `aiki.mcpOAuth.${state}`;

/** Route only through the starting tab's trusted backend ID, never through callback query URLs. */
export function parseMcpOAuthCallback(href: string, storage: Pick<Storage, 'getItem'>): {
 redirectUrl: string; state: string; backendId: string | null; flowId?: string; error?: string;
} {
 const url = new URL(href);
 const state = url.searchParams.get('state') ?? '';
 const code = url.searchParams.get('code');
 const invalid = url.pathname !== MCP_OAUTH_CALLBACK_PATH || url.searchParams.getAll('state').length !== 1 ||
  url.searchParams.getAll('code').length !== 1 || !state || !code || url.searchParams.has('error');
 let backendId: string | null = null;
 let flowId: string | undefined;
 try {
  const saved = state ? storage.getItem(mcpOAuthStorageKey(state)) : null;
  if (saved) {
   const route = JSON.parse(saved);
   if (typeof route.backendId === 'string' && typeof route.flowId === 'string') {
    backendId = route.backendId; flowId = route.flowId;
   }
  }
 } catch { /* Missing, old or disabled storage: paste fallback, never guess a route. */ }
 return { redirectUrl: href, state, backendId, flowId,
  ...(invalid ? { error: 'The sign-in response is missing or invalid. Return to settings and sign in again.' } : {}),
 };
}

/** Call directly from the Connect click so browsers permit the authorization tab. */
export async function startMcpOAuth(backend: BackendConnection, serverId: string, openBrowser = true) {
 const popup = openBrowser ? window.open('about:blank', '_blank') : null;
 if (popup) popup.opener = null;
 try {
  const flow = await backend.client.request({ type: 'mcp.oauth.start', serverId,
   redirectUri: `${location.origin}${MCP_OAUTH_CALLBACK_PATH}` });
  if (flow.type !== 'mcp.oauth.start') throw new Error('Could not start MCP sign-in. Check the server status in settings.');
  if (flow.authorizationUrl) {
   const state = new URL(flow.authorizationUrl).searchParams.get('state');
   if (!state) throw new Error('The server returned an invalid authorization URL.');
   try { localStorage.setItem(mcpOAuthStorageKey(state), JSON.stringify({ backendId: backend.id, flowId: flow.flowId })); } catch { /* Callback offers paste fallback. */ }
   if (popup) popup.location.href = flow.authorizationUrl;
   else if (openBrowser) window.location.assign(flow.authorizationUrl);
  } else popup?.close(); // Existing grant was refreshed without browser consent.
  return flow;
 } catch (error) { popup?.close(); throw error; }
}
