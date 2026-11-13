<script lang="ts">
  import type { McpPolicy } from '@kemiri/protocol';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import type { BackendConnection } from '#lib/harness.svelte.js';
  import { MCP_POLICY_OPTIONS, mcpToolHint, type McpTool } from '#lib/mcp.js';
  import { mcpRequest } from '#lib/mcp-rpc.js';
  import { SaveState } from '#lib/save-state.svelte.js';
  import Segmented from './Segmented.svelte';
  import SaveStatus from './SaveStatus.svelte';
  let { backend, serverId, tool, onpolicy }: { backend: BackendConnection; serverId: string; tool: McpTool; onpolicy: (serverId: string, tool: string, policy: McpPolicy) => void } = $props();
  const save = new SaveState();
  const descriptionId = $props.id();
  let expanded = $state(false);
  let attempted = $state<McpPolicy>('ask');
  let pending = $state<McpPolicy | null>(null);
  async function pick(policy: McpPolicy) {
    if (save.status === 'saving') return;
    attempted = policy;
    pending = policy;
    const id = serverId;
    const name = tool.name;
    await save.run(async () => {
      await mcpRequest(backend, { type: 'mcp.policy.set', serverId: id, tool: name, policy });
      onpolicy(id, name, policy);
    });
    pending = null;
  }
</script>

<div class="grid min-w-0 gap-x-4 gap-y-1 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5" aria-busy={save.status === 'saving'} data-mcp-tool-row>
  <button
    type="button"
    class="min-h-11 min-w-0 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
    aria-label="{expanded ? 'Hide' : 'Show'} description for {tool.name}"
    aria-expanded={expanded}
    aria-controls={descriptionId}
    aria-describedby={`${descriptionId}-hint`}
    onclick={() => expanded = !expanded}
  >
    <span class="flex min-w-0 items-baseline gap-2">
      <span class="min-w-0 truncate text-sm leading-5 font-semibold">{tool.name}</span>
      <span id={`${descriptionId}-hint`} class="shrink-0 text-xs leading-5 text-muted-foreground">{mcpToolHint(tool)}</span>
    </span>
    <span class="flex min-w-0 items-center gap-1 text-xs leading-5 text-muted-foreground">
      <span class="min-w-0 flex-1 truncate" data-mcp-description>{tool.description ?? 'No description supplied.'}</span>
      <ChevronDownIcon class="size-3 shrink-0 transition-transform {expanded ? 'rotate-180' : ''}" aria-hidden="true" />
    </span>
  </button>
  <Segmented compact class="sm:w-44" label="Policy for {tool.name}" options={MCP_POLICY_OPTIONS} value={pending ?? tool.policy} onchange={(policy) => void pick(policy as McpPolicy)} />
  <!-- Full untrusted text stays plain text, in a bounded keyboard-scrollable disclosure. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Expanded long descriptions need keyboard scrolling.) -->
  <p id={descriptionId} hidden={!expanded} tabindex="0" role="region" aria-label="Description for {tool.name}" class="max-h-64 overflow-y-auto overscroll-contain py-1 text-sm leading-5 whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground sm:col-span-2" data-mcp-full-description>{tool.description ?? 'No description supplied.'}</p>
  {#if save.status !== 'idle'}
    <div class="sm:col-span-2 sm:text-right"><SaveStatus state={save} reserve={false} onretry={() => void pick(attempted)} /></div>
  {/if}
</div>
