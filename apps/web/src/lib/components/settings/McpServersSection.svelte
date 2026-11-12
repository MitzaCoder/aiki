<script lang="ts">
  import type { McpListResponse, McpPolicy, McpServer } from '@aiki/protocol';
  import type { BackendConnection } from '#lib/harness.svelte.js';
  import { filterMcpTools, mcpServerId, mcpStatus, mcpSupportsOAuth } from '#lib/mcp.js';
  import { mcpRequest } from '#lib/mcp-rpc.js';
  import Banner from '#lib/components/Banner.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import SettingsSection from './SettingsSection.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import StatusChip from './StatusChip.svelte';
  import McpToolRow from './McpToolRow.svelte';
  import McpOAuthConnection from './McpOAuthConnection.svelte';

  let { backend }: { backend: BackendConnection } = $props();
  let servers = $state<McpServer[]>([]);
  let presets = $state<McpListResponse['presets']>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let selectedId = $state<string | null>(null);
  let adding = $state(false);
  let confirmingRemove = $state(false);
  let presetId = $state('');
  let name = $state('');
  let url = $state('');
  let token = $state('');
  let filter = $state('');
  const selected = $derived(servers.find(server => server.id === selectedId));
  const tools = $derived(filterMcpTools(selected?.tools ?? [], filter));
  const supported = $derived(backend.supports('mcp-servers'));
  $effect(() => {
    if (supported && backend.connection.status === 'ready') void load();
  });
  async function run(action: () => Promise<void>) {
    busy = true; error = ''; notice = '';
    try { await action(); } catch (failure) { error = failure instanceof Error ? failure.message : 'MCP request failed.'; }
    finally { busy = false; }
  }
  let catalogueSequence = 0;
  async function refreshCatalogue() {
    const sequence = ++catalogueSequence;
    const response = await mcpRequest(backend, { type: 'mcp.list' });
    if (sequence !== catalogueSequence) return;
    servers = response.servers; presets = response.presets; loaded = true;
  }
  $effect(() => {
    if (!supported) return;
    return backend.client.onMcpOAuthChanged(flow => {
      servers = servers.map(server => server.id === flow.serverId ? {
        ...server, oauthFlow: flow, ...(flow.status === 'pending' ? { status: 'signing_in' as const } : {})
      } : server);
      // A second succeeded event follows catalogue connection. Ignore older list replies.
      void refreshCatalogue().catch(() => { error = 'Could not update sign-in status. Reload servers to try again.'; });
    });
  });
  async function load() { await run(refreshCatalogue); }
  function replace(server: McpServer) {
    servers = servers.map(entry => entry.id === server.id ? server : entry);
  }
  function open(server: McpServer) {
    selectedId = server.id; filter = ''; token = ''; error = ''; notice = ''; confirmingRemove = false;
  }
  function choosePreset() {
    const preset = presets.find(preset => preset.id === presetId);
    if (preset) { name = preset.name; url = ''; }
  }
  async function add() {
    await run(async () => {
      const response = await mcpRequest(backend, { type: 'mcp.add',
        serverId: mcpServerId(name, servers.map(server => server.id)), name: name.trim(),
        ...(presetId ? { presetId } : { url: url.trim() }) });
      servers = [...servers, response.server]; adding = false; open(response.server);
    });
  }
  async function connect() {
    if (!selected || !token.trim()) return;
    const serverId = selected.id;
    // Clear the write-only field before any network work, including failed requests.
    const pasted = token; token = '';
    await run(async () => {
      replace((await mcpRequest(backend, { type: 'mcp.token.set', serverId, token: pasted })).server);
      replace((await mcpRequest(backend, { type: 'mcp.refresh', serverId })).server);
      notice = 'Token saved on the backend. Connection checked.';
    });
  }
  async function changeConnection(type: 'mcp.refresh' | 'mcp.disconnect') {
    if (!selected) return;
    const serverId = selected.id;
    await run(async () => {
      replace((await mcpRequest(backend, { type, serverId })).server);
      notice = type === 'mcp.refresh' ? 'Tools refreshed.' : 'Disconnected. Saved token retained until removal or replacement.';
    });
  }
  async function remove() {
    if (!selected) return;
    const serverId = selected.id;
    await run(async () => {
      await mcpRequest(backend, { type: 'mcp.remove', serverId });
      servers = servers.filter(server => server.id !== serverId); selectedId = null; confirmingRemove = false;
      notice = 'Server and credentials removed from this backend and all project selections.';
    });
  }
  function onpolicy(serverId: string, tool: string, policy: McpPolicy) {
    const server = servers.find(server => server.id === serverId);
    if (server) replace({ ...server, tools: server.tools.map(entry => entry.name === tool ? { ...entry, policy } : entry) });
  }
</script>

<div class="min-w-0 [overflow-wrap:anywhere]">
<SettingsSection title="MCP servers" description="Remote tools and accounts on {backend.name}." icon="server">
  {#if !supported}
    <Banner tone="warning">This backend does not offer MCP servers.</Banner>
  {:else}
    {#if error}<Banner tone="error">{error} <button class="underline" onclick={() => void load()} disabled={busy}>Reload servers</button></Banner>{/if}
    <p class="text-sm text-muted-foreground" role="status">{busy ? 'Working…' : notice}</p>
    {#if selected}
      <Button variant="outline" class="self-start" disabled={busy} onclick={() => { selectedId = null; token = ''; }}>Back to servers</Button>
      <SettingsGroup title={selected.name}>
        <SettingsRow label="Connection" hint={selected.url} control="full">
          {@const status = mcpStatus(selected)}
          <div class="flex flex-wrap items-center gap-2"><StatusChip tone={status.tone}>{status.label}</StatusChip><span class="text-sm">{selected.tools.length} tools</span></div>
          {#if selected.lastError}<p class="text-sm break-words text-destructive">{selected.lastError}</p>{/if}
          <div class="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onclick={() => void changeConnection('mcp.refresh')}>Refresh tools</Button>
            <Button variant="outline" disabled={busy} onclick={() => void changeConnection('mcp.disconnect')}>Disconnect</Button>
          </div>
        </SettingsRow>
        {#if mcpSupportsOAuth(selected, presets)}
          {#key selected.id}<McpOAuthConnection {backend} server={selected} refresh={refreshCatalogue} onserver={replace} />{/key}
        {/if}
        <SettingsRow label="Connect with a token" hint={selected.hasCredential ? 'A credential is saved on this backend. Paste to replace it.' : 'Paste an MCP bearer token, not an ordinary integration key.'} for="mcp-token" control="full">
          <form class="flex flex-col gap-2 sm:flex-row" onsubmit={(event) => { event.preventDefault(); void connect(); }}>
            <input class="mcp-input min-w-0 flex-1" id="mcp-token" type="password" autocomplete="off" spellcheck="false" bind:value={token} disabled={busy} placeholder="Paste token" />
            <Button type="submit" disabled={busy || !token.trim()}>Connect</Button>
          </form>
          <p class="text-xs text-muted-foreground">Write-only. Never sent back to this browser; cleared when submitted. Disconnect keeps the credential. Remove deletes it.</p>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Tools">
        <SettingsRow label="Filter tools" for="mcp-tool-filter" hint="Names, descriptions and server hints." control="full">
          <input id="mcp-tool-filter" class="mcp-input" type="search" bind:value={filter} placeholder="Search tools" />
          <p class="text-xs text-muted-foreground" role="status">{tools.length} of {selected.tools.length} tools. Hints are supplied by the server, not safety guarantees. Ask requests approval for the exact arguments.</p>
        </SettingsRow>
        {#each tools as tool (tool.name)}
          <McpToolRow {backend} serverId={selected.id} {tool} {onpolicy} />
        {:else}
          <p class="p-4 text-sm text-muted-foreground">{selected.tools.length ? 'No tools match this filter.' : 'Connect or refresh to load tools.'}</p>
        {/each}
      </SettingsGroup>
      <SettingsGroup title="Remove server" tone="danger">
        <SettingsRow label="Remove from this backend" hint="Deletes credentials and disables this server in every project." control="auto">
          <Button variant="destructive" disabled={busy} onclick={() => confirmingRemove = true}>Remove</Button>
        </SettingsRow>
      </SettingsGroup>
    {:else}
      <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-sm text-muted-foreground">New servers are off in every project.</p><Button disabled={busy} onclick={() => { adding = true; presetId = ''; name = ''; url = ''; error = ''; }}>Add server</Button></div>
      <SettingsGroup title="Servers">
        {#each servers as server (server.id)}
          {@const status = mcpStatus(server)}
          <button class="flex min-h-16 w-full flex-wrap items-center gap-3 px-4 py-4 text-left hover:bg-(--chat-surface-2)/50" onclick={() => open(server)} disabled={busy}>
            <span class="min-w-0 flex-1"><span class="block font-semibold break-all">{server.name}</span><span class="block text-xs break-all text-muted-foreground">{server.url}</span>{#if server.lastError}<span class="block text-xs break-words text-destructive">{server.lastError}</span>{/if}</span>
            <span class="flex flex-wrap items-center gap-2"><StatusChip tone={status.tone}>{status.label}</StatusChip><span class="text-xs">{server.tools.length} tools</span></span>
          </button>
        {:else}<p class="p-5 text-sm text-muted-foreground">{loaded ? 'No MCP servers yet. Add a preset or a remote URL.' : 'Loading servers…'}</p>{/each}
      </SettingsGroup>
    {/if}
  {/if}
</SettingsSection>
</div>

<Dialog.Root bind:open={adding}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <Dialog.Header><Dialog.Title>Add MCP server</Dialog.Title><Dialog.Description>Remote Streamable HTTP. Credentials are entered separately.</Dialog.Description></Dialog.Header>
    <form class="flex flex-col gap-4" onsubmit={(event) => { event.preventDefault(); void add(); }}>
      <label class="flex flex-col gap-1 text-sm font-medium">Preset
        <select class="mcp-input" bind:value={presetId} onchange={choosePreset} disabled={busy}>
          <option value="">Custom URL</option>
          {#each presets as preset}<option value={preset.id}>{preset.name} · {preset.auth}</option>{/each}
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">Server name<input class="mcp-input" bind:value={name} maxlength="120" required disabled={busy} /></label>
      {#if !presetId}<label class="flex flex-col gap-1 text-sm font-medium">Server URL<input class="mcp-input" type="url" bind:value={url} placeholder="https://mcp.example.test/mcp" required disabled={busy} /></label>
      {:else}<p class="text-sm break-all text-muted-foreground">{presets.find(preset => preset.id === presetId)?.url}</p>
        {#if presets.find(preset => preset.id === presetId)?.description}<p class="text-sm text-muted-foreground">{presets.find(preset => preset.id === presetId)?.description}</p>{/if}{/if}
      <p class="text-xs text-muted-foreground">HTTPS required (except loopback development). No embedded credentials, query or fragment. New servers are disabled in projects.</p>
      {#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
      <Dialog.Footer><Button variant="outline" type="button" disabled={busy} onclick={() => adding = false}>Cancel</Button><Button type="submit" disabled={busy || !name.trim() || (!presetId && !url.trim())}>{busy ? 'Adding…' : 'Add server'}</Button></Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={confirmingRemove}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>Remove {selected?.name}?</Dialog.Title><Dialog.Description>Deletes its credentials and project selections on this backend. This cannot be undone.</Dialog.Description></Dialog.Header>
    {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
    <Dialog.Footer><Button variant="outline" disabled={busy} onclick={() => confirmingRemove = false}>Keep server</Button><Button variant="destructive" disabled={busy} onclick={() => void remove()}>Remove server</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .mcp-input { min-height: 2.75rem; border: 1px solid var(--chat-border); background: var(--chat-surface); border-radius: .65rem; padding: .5rem .75rem; font-size: .875rem; color: var(--chat-fg); }
</style>

