<script lang="ts">
 import { onMount } from 'svelte';
 import { harness } from '#lib/harness.svelte.js';
 import { mcpOAuthStorageKey, parseMcpOAuthCallback } from '#lib/mcp-oauth.js';
 import { Button } from '#lib/components/ui/button/index.js';
 let status = $state<'working' | 'done' | 'error' | 'paste'>('working');
 let message = $state('Completing sign-in on your backend…');
 let redirectUrl = $state('');
 let copied = $state(false);
 let pending = $state<ReturnType<typeof parseMcpOAuthCallback> | undefined>(undefined);
 let completing = false;
 onMount(() => {
  // Capture privately, then remove code/state before any async work or rendering.
  const href = location.href;
  history.replaceState(history.state, '', location.pathname);
  let storage: Pick<Storage, 'getItem'> = { getItem: () => null };
  try { storage = localStorage; } catch { /* An unpaired/blocked-storage browser can paste the URL. */ }
  pending = parseMcpOAuthCallback(href, storage);
  if (pending.error) { status = 'error'; message = pending.error; return; }
  if (!pending.backendId || !harness.backend(pending.backendId)) {
   redirectUrl = href; status = 'paste'; return;
  }
  const timer = setTimeout(() => { if (status === 'working') { status = 'error'; message = 'Could not reach your backend. Return to Aiki and try signing in again.'; } }, 20_000);
  return () => clearTimeout(timer);
 });
 $effect(() => {
  const backend = pending?.backendId ? harness.backend(pending.backendId) : undefined;
  if (!backend?.ready || !pending || completing || status !== 'working') return;
  completing = true;
  const callback = pending;
  void backend.client.request({ type: 'mcp.oauth.complete', redirectUrl: callback.redirectUrl }).then(response => {
   if (response.type !== 'mcp.oauth.complete') throw new Error('Sign-in failed');
   try { localStorage.removeItem(mcpOAuthStorageKey(callback.state)); } catch { /* Optional storage. */ }
   if (response.server.status === 'connected') { status = 'done'; message = 'Your MCP server is connected. You can close this tab.'; }
   else { status = 'error'; message = 'Sign-in finished, but the MCP server could not connect. Check its status in settings.'; }
  }).catch(() => {
   status = 'error'; message = 'Sign-in could not be completed. It may have expired, been cancelled, or started on another device. Return to settings and sign in again.';
  });
 });
 async function copy() {
  try { await navigator.clipboard.writeText(redirectUrl); copied = true; }
  catch { message = 'Select and copy the URL below.'; }
 }
</script>

<svelte:head><title>MCP sign-in · Aiki</title><meta name="referrer" content="no-referrer" /></svelte:head>
<main class="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-background p-6 text-foreground">
 <section class="w-full max-w-lg rounded-xl border bg-card p-6 shadow-sm" aria-live="polite">
  <p class="mb-3 text-sm text-muted-foreground">Aiki · MCP servers</p>
  <h1 class="mb-3 text-2xl font-semibold">{status === 'done' ? 'Sign-in complete' : status === 'error' ? 'Could not sign in' : status === 'paste' ? 'Return to Aiki' : 'Signing in'}</h1>
  {#if status === 'paste'}
   <p class="mb-4">Copy this callback URL and paste this into Aiki where you started signing in.</p>
   <label class="mb-2 block text-sm font-medium" for="callback-url">One-use callback URL</label>
   <textarea id="callback-url" readonly value={redirectUrl} rows="5" class="mb-3 w-full resize-none rounded-md border bg-background p-3 text-sm" aria-describedby="callback-warning"></textarea>
   <p id="callback-warning" class="mb-4 text-sm text-muted-foreground">This URL contains a short-lived sign-in code. Do not share it.</p>
   <Button onclick={copy}>{copied ? 'Copied' : 'Copy URL'}</Button>
   {#if message !== 'Completing sign-in on your backend…'}<p class="mt-3 text-sm">{message}</p>{/if}
  {:else}<p class="mb-5 text-muted-foreground">{message}</p>{/if}
  <a href="/settings" class="mt-5 block text-sm underline underline-offset-4">Back to settings</a>
 </section>
</main>
