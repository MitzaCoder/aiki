<script lang="ts">
  import type { McpServer } from '@aiki/protocol';
  import type { BackendConnection } from '#lib/harness.svelte.js';
  import { startMcpOAuth } from '#lib/mcp-oauth.js';
  import { mcpRequest } from '#lib/mcp-rpc.js';
  import { mcpOAuthFlowLabel } from '#lib/mcp.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import SettingsRow from './SettingsRow.svelte';
  let { backend, server, refresh, onserver }: {
    backend: BackendConnection; server: McpServer; refresh: () => Promise<void>; onserver: (server: McpServer) => void;
  } = $props();
  let busy = $state(false);
  let error = $state('');
  let redirectUrl = $state('');
  let authorization = $state<{ flowId: string; url: string } | undefined>();
  let copied = $state(false);
  let manualCopy = $state(false);
  const flow = $derived(server.oauthFlow);
  const pending = $derived(flow?.status === 'pending');
  $effect(() => {
    if (!pending) redirectUrl = '';
    if (authorization && (!pending || flow?.flowId !== authorization.flowId)) { authorization = undefined; copied = false; manualCopy = false; }
    if (server.status === 'connected') error = '';
  });
  async function run(action: () => Promise<void>) {
    busy = true; error = '';
    try { await action(); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Could not complete MCP sign-in.'; }
    finally { busy = false; }
  }
  function signIn() {
    redirectUrl = '';
    // No await before this helper: its popup must open in the click's user activation.
    void run(async () => {
      const started = await startMcpOAuth(backend, server.id);
      await refresh();
      authorization = started.authorizationUrl ? { flowId: started.flowId, url: started.authorizationUrl } : undefined;
      copied = false; manualCopy = false;
    });
  }
  async function copySignInLink() {
    await run(async () => {
      let link = authorization?.url;
      if (!link) {
        const started = await startMcpOAuth(backend, server.id, false);
        await refresh();
        authorization = started.authorizationUrl ? { flowId: started.flowId, url: started.authorizationUrl } : undefined;
        link = authorization?.url;
      }
      if (!link) return;
      try { await navigator.clipboard.writeText(link); copied = true; manualCopy = false; }
      catch { manualCopy = true; error = 'Clipboard unavailable. Select and copy the sign-in link below.'; }
    });
  }
  async function cancel() {
    if (!flow) return;
    const flowId = flow.flowId; redirectUrl = '';
    await run(async () => { await mcpRequest(backend, { type: 'mcp.oauth.cancel', flowId }); await refresh(); });
  }
  async function complete() {
    if (!pending || !flow || !redirectUrl.trim()) return;
    const callback = redirectUrl.trim(); const flowId = flow.flowId;
    redirectUrl = ''; // Treat the one-use code like a write-only token, even on failure.
    await run(async () => {
      onserver((await mcpRequest(backend, { type: 'mcp.oauth.complete', flowId, redirectUrl: callback })).server);
      await refresh();
    });
  }
</script>

<SettingsRow label="Sign in with OAuth" hint="Consent opens in your browser. Credentials stay on this backend." control="full">
  <div class="flex flex-wrap items-center gap-2">
    <Button data-mcp-oauth-sign-in onclick={signIn} disabled={busy || pending}>{server.authKind === 'oauth' && server.hasCredential ? 'Sign in again' : 'Sign in'}</Button>
    <Button data-mcp-oauth-copy variant="outline" onclick={() => void copySignInLink()} disabled={busy || (pending && !authorization)}>Copy sign-in link</Button>
    {#if pending}<Button data-mcp-oauth-cancel variant="outline" onclick={() => void cancel()} disabled={busy}>Cancel sign-in</Button>{/if}
  </div>
  {#if copied && pending}<p class="text-sm text-muted-foreground" role="status">Copied — open it in the browser where you're signed in, then come back.</p>{/if}
  {#if manualCopy && authorization && pending}<input class="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" aria-label="Sign-in link" readonly value={authorization.url} />{/if}
  {#if flow}
    <p class="text-sm {flow.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}" role="status">{mcpOAuthFlowLabel(flow)}{pending ? '. Finish consent in your browser, then paste the callback below if needed.' : '.'}</p>
    {#if flow.error}<p class="text-sm break-words text-destructive" role="alert">{flow.error}</p>{/if}
  {/if}
  {#if pending}
    <form class="mt-2 flex flex-col gap-2" onsubmit={(event) => { event.preventDefault(); void complete(); }}>
      <label class="text-sm font-medium" for="mcp-callback-url">Paste callback URL</label>
      <input id="mcp-callback-url" class="min-h-11 min-w-0 rounded-lg border bg-background px-3 text-sm" type="password" autocomplete="off" spellcheck="false" bind:value={redirectUrl} disabled={busy} aria-describedby="mcp-callback-hint" placeholder="Paste the one-use callback URL" />
      <p id="mcp-callback-hint" class="text-xs text-muted-foreground">Opened in another browser? Copy its callback URL and paste it here, on the device that started sign-in. The URL contains a short-lived code; do not share it.</p>
      <Button type="submit" class="self-start" disabled={busy || !redirectUrl.trim()}>Complete sign-in</Button>
    </form>
  {/if}
  {#if busy}<p role="status" class="text-xs text-muted-foreground">Updating sign-in…</p>{/if}
  {#if error}<p role="alert" class="text-sm break-words text-destructive">{error}</p>{/if}
</SettingsRow>
