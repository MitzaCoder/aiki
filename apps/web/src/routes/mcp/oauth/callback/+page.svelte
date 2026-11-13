<script lang="ts">
 import { onMount } from 'svelte';
 import { harness } from '#lib/harness.svelte.js';
 import { mcpOAuthStorageKey, parseMcpOAuthCallback } from '#lib/mcp-oauth.js';
 import McpOAuthCopyBack from '#lib/components/McpOAuthCopyBack.svelte';
 let status = $state<'working' | 'done' | 'error' | 'paste'>('working');
 let message = $state('Completing sign-in on your backend…');
 let redirectUrl = $state('');
 let pending = $state<ReturnType<typeof parseMcpOAuthCallback> | undefined>(undefined);
 let completing = false;
 onMount(() => {
  // Capture privately, then remove code/state before any async work or rendering.
  const href = location.href;
  history.replaceState(history.state, '', location.pathname);
  let storage: Pick<Storage, 'getItem'> = { getItem: () => null };
  try { storage = localStorage; } catch { /* An unpaired/blocked-storage browser can paste the URL. */ }
  redirectUrl = href;
  pending = parseMcpOAuthCallback(href, storage);
  if (pending.error) { status = 'error'; message = pending.error; return; }
  if (!pending.backendId || !harness.backend(pending.backendId)) {
   status = 'paste'; return;
  }
  const timer = setTimeout(() => { if (status === 'working') status = 'paste'; }, 20_000);
  return () => clearTimeout(timer);
 });
 $effect(() => {
  const backend = pending?.backendId ? harness.backend(pending.backendId) : undefined;
  if (!backend?.ready || !pending || completing || status !== 'working') return;
  if (!backend.authSessionId) { status = 'paste'; return; }
  completing = true;
  const callback = pending;
  void (async () => {
   // A local route alone is not evidence of a still-pending sign-in. In an
   // unpaired/stale browser never submit the code, even to a saved backend.
   const listed = await backend.client.request({ type: 'mcp.list' });
   if (status !== 'working') return;
   if (listed.type !== 'mcp.list' || !listed.servers.some(server => server.oauthFlow?.flowId === callback.flowId && server.oauthFlow?.status === 'pending')) {
    status = 'paste'; return;
   }
   return backend.client.request({ type: 'mcp.oauth.complete', flowId: callback.flowId, redirectUrl: callback.redirectUrl });
  })().then(response => {
   if (!response) return;
   if (response.type !== 'mcp.oauth.complete') throw new Error('Sign-in failed');
   try { localStorage.removeItem(mcpOAuthStorageKey(callback.state)); } catch { /* Optional storage. */ }
   if (response.server.status === 'connected') { status = 'done'; message = 'Your MCP server is connected. You can close this tab.'; }
   else { status = 'error'; message = 'Sign-in finished, but the MCP server could not connect. Check its status in settings.'; }
  }).catch(() => {
   status = 'paste';
  });
 });
</script>

<svelte:head><title>MCP sign-in · Kemiri</title><meta name="referrer" content="no-referrer" /></svelte:head>
<main class="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-background p-6 text-foreground">
 <section class="w-full max-w-lg rounded-xl border bg-card p-6 shadow-sm" aria-live="polite">
  <p class="mb-3 text-sm text-muted-foreground">Kemiri · MCP servers</p>
  {#if status === 'paste'}
   <McpOAuthCopyBack {redirectUrl} />
  {:else}
   <h1 class="mb-3 text-2xl font-semibold">{status === 'done' ? 'Sign-in complete' : status === 'error' ? 'Could not sign in' : 'Signing in'}</h1>
   <p class="mb-5 text-muted-foreground">{message}</p>
  {/if}
  <a href="/settings" class="mt-5 block text-sm underline underline-offset-4">Back to settings</a>
 </section>
</main>
