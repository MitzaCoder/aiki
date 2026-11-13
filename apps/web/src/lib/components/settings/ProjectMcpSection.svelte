<script lang="ts">
  import type { McpProjectServer, McpRole, McpServer } from '@kemiri/protocol';
  import type { BackendConnection } from '#lib/harness.svelte.js';
  import { MCP_ROLE_OPTIONS, mcpProjectServer, mcpStatus } from '#lib/mcp.js';
  import { mcpRequest } from '#lib/mcp-rpc.js';
  import { backendSettingsHref } from '#lib/settings.js';
  import Banner from '#lib/components/Banner.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import Switch from './Switch.svelte';
  import StatusChip from './StatusChip.svelte';
  import SaveStatus from './SaveStatus.svelte';
  import { SaveState } from '#lib/save-state.svelte.js';

  let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();
  let servers = $state<McpServer[]>([]);
  let selections = $state<McpProjectServer[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let savingId = $state<string | null>(null);
  let attempted = $state<McpProjectServer | null>(null);
  const save = new SaveState();
  $effect(() => {
    if (backend.supports('mcp-servers') && backend.connection.status === 'ready') void load();
  });
  async function load() {
    loaded = false; error = '';
    try {
      const catalogue = await mcpRequest(backend, { type: 'mcp.list' });
      const project = await mcpRequest(backend, { type: 'mcp.project.get', projectId });
      servers = catalogue.servers; selections = project.servers; loaded = true;
    } catch (failure) { error = failure instanceof Error ? failure.message : 'Could not load project MCP settings.'; }
  }
  async function change(selection: McpProjectServer) {
    attempted = selection; savingId = selection.serverId;
    await save.run(async () => {
      const next = [...selections.filter(entry => entry.serverId !== selection.serverId), selection];
      selections = (await mcpRequest(backend, { type: 'mcp.project.set', projectId, servers: next })).servers;
    });
    savingId = null;
  }
  function toggleRole(selection: McpProjectServer, role: McpRole, checked: boolean) {
    void change({ ...selection, roles: checked ? [...selection.roles, role] : selection.roles.filter(entry => entry !== role) });
  }
</script>

<div class="min-w-0 [overflow-wrap:anywhere]">
<SettingsSection title="MCP" description="Choose remote tools for this project and its agent roles." icon="server">
  {#if !backend.supports('mcp-servers')}<Banner tone="warning">This backend does not offer MCP servers.</Banner>
  {:else}
    <p class="text-sm text-muted-foreground">Servers and roles start off. Enabling a server grants only its selected roles access, subject to each tool's backend-wide Off / Ask / Allow policy.</p>
    <a href={backendSettingsHref(backend.id, 'mcp')} class="self-start text-sm font-medium underline">Manage backend MCP servers</a>
    {#if error}<Banner tone="error">{error} <button class="underline" onclick={() => void load()}>Try again</button></Banner>
    {:else if !loaded}<p role="status" class="text-sm text-muted-foreground">Loading MCP settings…</p>
    {:else}
      {#each servers as server (server.id)}
        {@const selection = mcpProjectServer(selections, server.id)}
        {@const status = mcpStatus(server)}
        <SettingsGroup title={server.name}>
          <SettingsRow label="Enable {server.name}" hint="Only for this project." control="auto">
            <Switch label="Enable {server.name}" checked={selection.enabled} disabled={savingId !== null} onchange={(enabled) => void change({ ...selection, enabled })} />
            <StatusChip tone={status.tone}>{status.label} · {server.tools.length} tools</StatusChip>
          </SettingsRow>
          {#each MCP_ROLE_OPTIONS as role}
            <SettingsRow label={role.label} hint={selection.enabled ? 'Allow this role to discover and use permitted tools.' : 'Enable the server before choosing roles.'} control="auto">
              <Switch label="{server.name}: {role.label}" checked={selection.roles.includes(role.value)} disabled={!selection.enabled || savingId !== null} onchange={(checked) => toggleRole(selection, role.value, checked)} />
            </SettingsRow>
          {/each}
          {#if attempted?.serverId === server.id}<div class="px-4 pb-3"><SaveStatus state={save} onretry={() => attempted && void change(attempted)} /></div>{/if}
        </SettingsGroup>
      {:else}<SettingsGroup title="Servers"><p class="p-5 text-sm text-muted-foreground">No servers on this backend yet. Add one in backend MCP settings first.</p></SettingsGroup>{/each}
    {/if}
  {/if}
</SettingsSection>
</div>
