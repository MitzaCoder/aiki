<script lang="ts">
  import { MCP_PRESET_GROUPS, parseMcpImport, mcpImportId, type McpImportRow, type McpListResponse, type McpPolicy, type McpServer } from '@aiki/protocol';
  import type { BackendConnection } from '#lib/harness.svelte.js';
  import { filterMcpTools, mcpServerId, mcpStatus } from '#lib/mcp.js';
  import { mcpRequest } from '#lib/mcp-rpc.js';
  import Banner from '#lib/components/Banner.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import SettingsSection from './SettingsSection.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import StatusChip from './StatusChip.svelte';
  import McpToolRow from './McpToolRow.svelte';
  import McpCommandReview from './McpCommandReview.svelte';
  import McpImportReview from './McpImportReview.svelte';
  import McpCliHint from './McpCliHint.svelte';
  import McpOAuthConnection from './McpOAuthConnection.svelte';
  import { DIALOG_FOOTER_CLASS, DIALOG_HEADER_CLASS, DIALOG_SCROLL_CLASS, roomyDialogClass } from '#lib/dialog-layout.js';

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
  let presetSearch = $state('');
  const chosenPreset = $derived(presets.find(p => p.id === presetId));
  const selectedPreset = $derived(presets.find(p => p.id === selected?.presetId));
  const matchingPresets = $derived(presets.filter(p => `${p.name} ${p.description} ${p.group}`.toLowerCase().includes(presetSearch.toLowerCase().trim())));
  let name = $state('');
  let url = $state('');
  let kind = $state('http');
  let command = $state(''); let args = $state('[]'); let cwd = $state(''); let env = $state('{}');
  let editing = $state<string | null>(null);
  let confirmingCommand = $state(false);
  let importText = $state(''); let importing = $state(false);
  let review = $state<McpImportRow[]>([]); let checked = $state<string[]>([]);
  let pending = $state<McpImportRow[]>([]);
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
    if (preset) {
      name = preset.name; url = preset.url; kind = preset.command ? 'command' : 'http';
      command = preset.command?.command ?? ''; args = JSON.stringify(preset.command?.args ?? []);
      env = JSON.stringify(Object.fromEntries((preset.envNames ?? []).map(name => [name, ''])));
    }
  }
  function prepareAdd() {
    error = '';
    try {
      if (kind === 'command') {
        const rows = parseMcpImport(JSON.stringify({ [name]: { command, args: JSON.parse(args), ...(cwd ? { cwd } : {}), env: JSON.parse(env) } }), servers.filter(s => s.id !== editing).map(s => s.id));
        if (rows[0]?.error) throw new Error(rows[0].error);
        if (chosenPreset?.envNames?.some(name => !rows[0]?.env?.[name]?.trim())) throw new Error('Enter the required environment secrets.');
        pending = rows; confirmingCommand = true;
      } else void saveRows([{ name: name.trim(), serverId: mcpServerId(name, servers.map(s => s.id)), kind: 'http', target: url, url: url || presets.find(p => p.id === presetId)?.url, renamed: false }]);
    } catch (failure) { error = failure instanceof Error ? failure.message : 'Invalid command'; }
  }
  function reviewImport() {
    error = '';
    try { review = parseMcpImport(importText, servers.flatMap(s => [s.id, mcpImportId(s.name, [])])); checked = review.filter(row => !row.error).map(row => row.serverId); importText = ''; }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Invalid JSON'; }
  }
  function submitReview() {
    pending = review.filter(row => checked.includes(row.serverId) && !row.error);
    if (pending.some(row => row.command)) confirmingCommand = true;
    else void saveRows(pending);
  }
  async function saveRows(rows: McpImportRow[]) {
    await run(async () => {
      for (const row of rows) {
        const response = await mcpRequest(backend, { type: 'mcp.add', serverId: editing ?? row.serverId, name: row.name,
          ...(row.command ? { command: row.command, ...(editing && env === '{}' ? {} : { env: row.env }), confirmed: true, ...(!importing && presetId ? { presetId } : {}), ...(editing ? { replace: true } : {}) } : { url: row.url, ...(row.transport ? { transport: row.transport } : {}), ...(!importing && presetId ? { presetId } : {}) }) });
        if (editing) replace(response.server); else servers = [...servers, response.server];
        if (row.token) await mcpRequest(backend, { type: 'mcp.token.set', serverId: response.server.id, token: row.token });
        open(response.server);
        review = review.filter(entry => entry.serverId !== row.serverId);
      }
      adding = false; importing = false; confirmingCommand = false;
      pending = []; review = []; checked = []; env = '{}'; importText = '';
    });
  }
  function editCommand() {
    if (!selected?.command) return;
    editing = selected.id; presetId = selected.presetId ?? ''; name = selected.name; kind = 'command'; command = selected.command.command;
    args = JSON.stringify(selected.command.args); cwd = selected.command.cwd ?? ''; env = '{}'; adding = true; confirmingCommand = false;
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
      {#if selectedPreset}
        <div class="my-3 flex flex-col gap-2 text-sm">
          <p>{selectedPreset.description}</p>
          {#if selectedPreset.docsUrl}<a class="underline" href={selectedPreset.docsUrl} target="_blank" rel="noreferrer">Vendor documentation</a>{/if}
          {#if selectedPreset.tokenUrl}<a class="underline" href={selectedPreset.tokenUrl} target="_blank" rel="noreferrer">Create a token</a>{/if}
          {#if selectedPreset.cli}<McpCliHint {backend} cli={selectedPreset.cli} />{/if}
        </div>
      {/if}
      <SettingsGroup title={selected.name}>
        <SettingsRow label="Connection" hint={selected.command ? JSON.stringify([selected.command.command, ...selected.command.args]) : selected.url} control="full">
          {@const status = mcpStatus(selected)}
          <div class="flex flex-wrap items-center gap-2"><StatusChip tone={status.tone}>{status.label}</StatusChip><span class="text-sm">{selected.tools.length} tools</span></div>
          {#if selected.lastError}<p class="text-sm break-words text-destructive">{selected.lastError}</p>{/if}
          <div class="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onclick={() => void changeConnection('mcp.refresh')}>Refresh tools</Button>
            <Button variant="outline" disabled={busy} onclick={() => void changeConnection('mcp.disconnect')}>Disconnect</Button>
          </div>
        </SettingsRow>
        {#if selected.command}
          <SettingsRow label="Backend command" hint="Environment values are stored only on the backend." control="full">
            <p class="text-sm">Working directory: {selected.command.cwd ?? '(backend default)'}</p>
            <p class="text-sm">Environment: {(selected.envNames ?? []).join(', ') || '(none)'}</p>
            <Button variant="outline" onclick={editCommand}>Edit command</Button>
            {#if selected.stderrTail}<pre class="max-h-40 overflow-auto whitespace-pre-wrap text-xs" aria-label="Redacted stderr tail">{selected.stderrTail}</pre>{/if}
          </SettingsRow>
        {:else}
        {#if !selected.command}
          {#key selected.id}<McpOAuthConnection {backend} preset={selectedPreset} server={selected} refresh={refreshCatalogue} onserver={replace} />{/key}
        {/if}
        <SettingsRow label="Connect with a token" hint={selected.hasCredential ? 'A credential is saved on this backend. Paste to replace it.' : 'Paste an MCP bearer token, not an ordinary integration key.'} for="mcp-token" control="full">
          <form class="flex flex-col gap-2 sm:flex-row" onsubmit={(event) => { event.preventDefault(); void connect(); }}>
            <input class="mcp-input min-w-0 flex-1" id="mcp-token" type="password" autocomplete="off" spellcheck="false" bind:value={token} disabled={busy} placeholder="Paste token" />
            <Button type="submit" disabled={busy || !token.trim()}>Connect</Button>
          </form>
          <p class="text-xs text-muted-foreground">Write-only. Never sent back to this browser; cleared when submitted. Disconnect keeps the credential. Remove deletes it.</p>
        </SettingsRow>
        {/if}
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
      <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-sm text-muted-foreground">New servers are off in every project.</p><Button disabled={busy} onclick={() => { adding = true; editing = null; kind = 'http'; confirmingCommand = false; command = ''; args = '[]'; cwd = ''; env = '{}'; presetId = ''; presetSearch = ''; name = ''; url = ''; error = ''; }}>Add server</Button><Button variant="outline" onclick={() => { importing = true; editing = null; review = []; importText = ''; error = ''; }}>Import JSON</Button></div>
      <SettingsGroup title="Servers">
        {#each servers as server (server.id)}
          {@const status = mcpStatus(server)}
          <button class="flex min-h-16 w-full flex-wrap items-center gap-3 px-4 py-4 text-left hover:bg-(--chat-surface-2)/50" onclick={() => open(server)} disabled={busy}>
            <span class="min-w-0 flex-1"><span class="block font-semibold break-all">{server.name}</span><span class="block text-xs break-all text-muted-foreground">{server.command ? JSON.stringify([server.command.command, ...server.command.args]) : server.url}</span>{#if server.lastError}<span class="block text-xs break-words text-destructive">{server.lastError}</span>{/if}</span>
            <span class="flex flex-wrap items-center gap-2"><StatusChip tone={status.tone}>{status.label}</StatusChip><span class="text-xs">{server.tools.length} tools</span></span>
          </button>
        {:else}<p class="p-5 text-sm text-muted-foreground">{loaded ? 'No MCP servers yet. Add a preset or a remote URL.' : 'Loading servers…'}</p>{/each}
      </SettingsGroup>
    {/if}
  {/if}
</SettingsSection>
</div>

<Dialog.Root bind:open={adding}>
  <Dialog.Content class={roomyDialogClass()} data-mcp-dialog="add">
    <!-- One scroll region: the preset catalogue scrolls with the fields, never inside them. -->
    <form class="flex min-h-0 w-full min-w-0 flex-1 flex-col" onsubmit={(event) => { event.preventDefault(); prepareAdd(); }}>
    <Dialog.Header class={DIALOG_HEADER_CLASS}><Dialog.Title>{editing ? 'Edit command server' : 'Add MCP server'}</Dialog.Title><Dialog.Description>Runs on this backend. New servers are disabled in projects.</Dialog.Description></Dialog.Header>
    <div class={DIALOG_SCROLL_CLASS} data-dialog-scroll>
    <div class="flex min-w-0 flex-col gap-4">
      {#if !editing}
        <label class="flex flex-col gap-1 text-sm">Search presets<input aria-label="Search presets" class="mcp-input" bind:value={presetSearch} placeholder="Jira, browser, docs…" /></label>
        <p class="text-xs text-muted-foreground">{matchingPresets.length} presets · select one to see setup details</p>
        <div class="rounded-lg border" aria-label="Preset catalogue">
          {#each MCP_PRESET_GROUPS as group}
            {@const entries = matchingPresets.filter(p => (p.group ?? 'Docs') === group)}
            {#if entries.length}<h3 class="sticky top-0 bg-background px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">{group}</h3>
              {#each entries as preset}<button type="button" class="block w-full min-w-0 border-t px-3 py-2 text-left hover:bg-muted" aria-pressed={presetId === preset.id} data-mcp-preset={preset.id} onclick={() => { presetId = preset.id; choosePreset(); }}>
                <span class="block text-sm font-semibold break-words">{preset.name} · {preset.auth.replaceAll('_', ' ')}</span><span class="block text-xs break-words text-muted-foreground" data-mcp-preset-description>{preset.description}</span>
              </button>{/each}
            {/if}
          {/each}
          {#if !matchingPresets.length}<p class="p-3 text-sm">No matching presets.</p>{/if}
        </div>
        {#if chosenPreset}
          <p class="text-sm break-words">{chosenPreset.description}</p>
          {#if chosenPreset.docsUrl}<a class="text-sm underline" href={chosenPreset.docsUrl} target="_blank" rel="noreferrer">Vendor documentation</a>{/if}
          {#if chosenPreset.tokenUrl}<a class="text-sm underline" href={chosenPreset.tokenUrl} target="_blank" rel="noreferrer">Create a token</a>{/if}
          {#if chosenPreset.cli}<McpCliHint {backend} cli={chosenPreset.cli} />{/if}
          <button type="button" class="text-left text-sm underline" onclick={() => { presetId = ''; url = ''; name = ''; }}>Use custom server instead</button>
        {/if}
      {/if}
      <label class="flex flex-col gap-1 text-sm font-medium">Server kind
        <select class="mcp-input" bind:value={kind} disabled={!!editing || !!presetId}><option value="http">Remote URL</option><option value="command">Command (stdio)</option></select>
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">Server name<input class="mcp-input" bind:value={name} maxlength="120" required disabled={busy} /></label>
      {#if kind === 'command'}
        <label class="flex flex-col gap-1 text-sm">Command<input id="mcp-command" class="mcp-input" bind:value={command} required placeholder="npx" /></label>
        <label class="flex flex-col gap-1 text-sm">Arguments (JSON array)<textarea id="mcp-args" class="mcp-input" bind:value={args} required></textarea></label>
        <label class="flex flex-col gap-1 text-sm">Working directory (optional)<input id="mcp-cwd" class="mcp-input" bind:value={cwd} placeholder="/path/to/project" /></label>
        <label class="flex flex-col gap-1 text-sm">Environment (secret JSON object)<input id="mcp-env" class="mcp-input" type="password" autocomplete="off" bind:value={env} /></label>
        {#if editing}<p class="text-xs">Leave environment as an empty object to keep existing values. Remove and re-add to clear them.</p>{/if}
      {:else}
        {#if !presetId}<label class="flex flex-col gap-1 text-sm font-medium">Server URL<input class="mcp-input" type="url" bind:value={url} placeholder="https://mcp.example.test/mcp" required /></label>{:else}<p class="text-sm break-all">{presets.find(p => p.id === presetId)?.url}</p>{/if}
      {/if}
      {#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
    </div>
    </div>
      <Dialog.Footer class={DIALOG_FOOTER_CLASS}><Button variant="ghost" type="button" onclick={() => { adding = false; env = '{}'; }}>Cancel</Button><Button size="sm" type="submit" disabled={busy || !name.trim()}>{kind === 'command' ? 'Review command' : 'Add server'}</Button></Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={importing}>
 <Dialog.Content class={roomyDialogClass({ wide: true })} data-mcp-dialog="import">
 <Dialog.Header class={DIALOG_HEADER_CLASS}><Dialog.Title>Import MCP servers</Dialog.Title><Dialog.Description>Review before saving. Nothing runs or saves yet. Name clashes are renamed; uncheck to skip.</Dialog.Description></Dialog.Header>
 <div class={DIALOG_SCROLL_CLASS} data-dialog-scroll data-mcp-import-body>
 {#if review.length}
 <McpImportReview entries={review} bind:checked />
 {:else}
 <label class="flex flex-col gap-2 text-sm">Server JSON<textarea id="mcp-import-json" class="mcp-input min-h-48 font-mono" bind:value={importText} autocomplete="off" spellcheck="false"></textarea></label>
 {/if}
 {#if error}<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>{/if}
 </div>
 <Dialog.Footer class={DIALOG_FOOTER_CLASS}>
 {#if review.length}
 <Button disabled={busy || !checked.length} onclick={submitReview}>Import selected</Button>
 {:else}
 <Button onclick={reviewImport} disabled={!importText.trim()}>Review import</Button>
 {/if}
 <Button variant="ghost" onclick={() => { importing = false; review = []; importText = ''; }}>Cancel</Button>
 </Dialog.Footer>
 </Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={confirmingCommand}>
 <Dialog.Content class={roomyDialogClass({ wide: true })} data-mcp-dialog="confirm">
 <Dialog.Header class={DIALOG_HEADER_CLASS}><Dialog.Title>Confirm backend command</Dialog.Title><Dialog.Description>This executes code as the backend user, not on this device. Only confirm commands you trust.</Dialog.Description></Dialog.Header>
 <div class={DIALOG_SCROLL_CLASS} data-dialog-scroll>
 <McpCommandReview entries={pending} retainedEnvNames={editing && env === '{}' ? selected?.envNames : undefined} />
 {#if error}<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>{/if}
 </div>
 <Dialog.Footer class={DIALOG_FOOTER_CLASS}><Button variant="ghost" onclick={() => confirmingCommand = false}>Back</Button><Button size="sm" disabled={busy} onclick={() => void saveRows(pending)}>Confirm and save</Button></Dialog.Footer>
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
  .mcp-input { display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 2.75rem; border: 1px solid var(--chat-border); background: var(--chat-surface); border-radius: .65rem; padding: .5rem .75rem; font-size: .875rem; color: var(--chat-fg); }
</style>

