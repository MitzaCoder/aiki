<script lang="ts">
  import type { McpImportRow } from '@kemiri/protocol';
  let { entries, retainedEnvNames }: { entries: McpImportRow[]; retainedEnvNames?: string[] } = $props();
</script>
{#each entries.filter(row => row.command) as row}
  <div class="min-w-0 space-y-2 text-sm">
    <strong>{row.name}</strong>
    <pre class="whitespace-pre-wrap break-all">Command: {row.command?.command}
Arguments: {JSON.stringify(row.command?.args)}
Working directory: {row.command?.cwd ?? '(backend default)'}</pre>
    <p>Environment: {(retainedEnvNames ?? Object.keys(row.env ?? {})).map(key => key + '=••••').join(', ') || '(none)'}</p>
  </div>
{/each}
