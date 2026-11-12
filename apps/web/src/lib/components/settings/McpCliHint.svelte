<script lang="ts">
 import { goto } from '$app/navigation';
 import { page } from '$app/state';
 import type { BackendConnection } from '#lib/harness.svelte.js';
 import { projectHref } from '#lib/backends.js';
 import { Button } from '#lib/components/ui/button/index.js';
 import { askCoordinatorForMcpCli } from '#lib/mcp-cli.js';
 let { backend, cli }: { backend: BackendConnection; cli: string } = $props();
 let projectId = $state(page.url.pathname.startsWith('/b/') ? page.params.id ?? '' : '');
 let busy = $state(false); let error = $state('');
 const projects = $derived(backend.projects.filter(p => !p.archived));
 async function ask() {
  busy = true; error = '';
  try { await askCoordinatorForMcpCli(backend.client, projectId, cli, () => goto(projectHref(backend.id, projectId))); }
  catch (failure) { error = failure instanceof Error ? failure.message : 'Could not send setup request.'; }
  finally { busy = false; }
 }
</script>
<div class="flex flex-col gap-2 rounded-lg border p-3" data-mcp-cli-hint>
 <p class="text-sm">Agents often work better with the official CLI (acli for Jira, gh for GitHub) than with MCP.</p>
 <label class="flex flex-col gap-1 text-sm">Project for CLI setup
  <select aria-label="Project for CLI setup" class="min-h-11 rounded-lg border bg-background px-3" bind:value={projectId} disabled={busy}>
   <option value="">Choose a project</option>{#each projects as project}<option value={project.id}>{project.name}</option>{/each}
  </select>
 </label>
 {#if !projects.length}<p class="text-sm">Add a project on this backend first.</p>{/if}
 <p class="text-xs text-muted-foreground">Sends to the coordinator and opens chat. Nothing is installed by this button.</p>
 <Button type="button" variant="outline" class="h-auto min-h-11 whitespace-normal" disabled={busy || !projectId} onclick={() => void ask()}>Ask the coordinator to set up {cli}</Button>
 {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
</div>
