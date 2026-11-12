<script lang="ts">
  import type { McpImportRow } from '@aiki/protocol';
  let { entries, checked = $bindable<string[]>([]) }: { entries: McpImportRow[]; checked?: string[] } = $props();
</script>
<div class="flex flex-col gap-4">
  {#each entries as row}
    <label class="flex min-w-0 gap-3 text-sm">
      <input type="checkbox" value={row.serverId} bind:group={checked} disabled={!!row.error} />
      <span class="min-w-0 break-all"><strong>{row.name}</strong> · {row.kind}<br />{row.target}
        {#if row.renamed}<br />Renamed ID: {row.serverId}{/if}
        {#if row.error}<span class="block text-destructive">{row.error}</span>{/if}
      </span>
    </label>
  {/each}
</div>
