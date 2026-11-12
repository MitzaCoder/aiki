<script lang="ts">
  import type { McpPolicy } from '@aiki/protocol';
  import type { BackendConnection } from '#lib/harness.svelte.js';
  import { MCP_POLICY_OPTIONS, mcpToolHint, type McpTool } from '#lib/mcp.js';
  import { mcpRequest } from '#lib/mcp-rpc.js';
  import { SaveState } from '#lib/save-state.svelte.js';
  import Segmented from './Segmented.svelte';
  import SettingsRow from './SettingsRow.svelte';
  let { backend, serverId, tool, onpolicy }: { backend: BackendConnection; serverId: string; tool: McpTool; onpolicy: (serverId: string, tool: string, policy: McpPolicy) => void } = $props();
  const save = new SaveState();
  let attempted = $state<McpPolicy>('ask');
  async function pick(policy: McpPolicy) {
    attempted = policy;
    const id = serverId;
    const name = tool.name;
    await save.run(async () => {
      await mcpRequest(backend, { type: 'mcp.policy.set', serverId: id, tool: name, policy });
      onpolicy(id, name, policy);
    });
  }
</script>

<SettingsRow label={tool.name} hint={mcpToolHint(tool)} control="full" status={save} onretry={() => void pick(attempted)}>
  <p class="mb-2 line-clamp-3 text-sm break-all text-muted-foreground" data-mcp-description>{tool.description?.slice(0, 600) ?? 'No description supplied.'}</p>
  <Segmented label="Policy for {tool.name}" options={MCP_POLICY_OPTIONS} value={tool.policy} disabled={save.status === 'saving'} onchange={(policy) => void pick(policy as McpPolicy)} />
</SettingsRow>
