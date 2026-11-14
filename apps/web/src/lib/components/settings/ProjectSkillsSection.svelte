<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { BackendConnection } from '#lib/harness.svelte.js';
  import { ProjectSkillChoices, SKILL_FILTERS, filterProjectSkills, projectSkillGroups, projectSkillLabel, skillOffered, skillSomeRoles, type SkillChoicesSnapshot, type SkillFilter } from '#lib/project-skills.js';
  import Banner from '#lib/components/Banner.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import Switch from './Switch.svelte';
  import StatusChip from './StatusChip.svelte';

  let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();
  let snapshot = $state<SkillChoicesSnapshot>({ skills: [], loaded: false, saving: false, saved: false, error: '' });
  let query = $state('');
  let filter = $state<SkillFilter>('All');
  // The route keys this section by backend and project, so an outgoing save keeps its original target.
  const choices = new ProjectSkillChoices({
    get: async () => (await backend.client.getProjectSkills(projectId)).skills,
    set: async changes => (await backend.client.setProjectSkills(projectId, changes)).skills,
    changed: next => { snapshot = next; },
  });
  const groups = $derived(projectSkillGroups(filterProjectSkills(snapshot.skills, query, filter)));
  const offered = $derived(snapshot.skills.filter(skillOffered).length);
  $effect(() => {
    if (backend.supports('project-skills') && backend.connection.status === 'ready') void choices.refresh();
  });
  $effect(() => backend.client.onProjectSkillsChanged(event => {
    if (event.projectId === projectId) void choices.refresh();
  }));
  onDestroy(() => choices.dispose());
</script>

<div class="min-w-0 [overflow-wrap:anywhere]">
<SettingsSection title="Skills" description="What this project's agents know how to do." icon="key-round">
  {#if !backend.supports('project-skills')}
    <Banner tone="warning">This backend does not offer project Skills settings.</Banner>
  {:else}
    {#if snapshot.error}
      <Banner tone="error">{snapshot.error} {#if snapshot.loaded}Changes that could not be saved were reverted. {/if}<button class="underline" onclick={() => void choices.refresh()}>Refresh</button></Banner>
    {/if}
    {#if !snapshot.loaded}
      <p role="status" class="text-sm text-muted-foreground">{snapshot.error ? 'Skills could not be loaded.' : 'Loading Skills…'}</p>
    {:else}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted-foreground">{snapshot.skills.length} found · {offered} offered</p>
        <p role="status" class="text-xs text-muted-foreground">{snapshot.saving ? 'Saving…' : snapshot.saved && !snapshot.error ? 'Saved' : ''}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Filter skills" placeholder="Filter skills…" bind:value={query} class="h-11 min-w-0 grow rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs" />
        <div role="group" aria-label="Skill filters" class="flex flex-wrap gap-1">
          {#each SKILL_FILTERS as option}
            <button type="button" aria-pressed={filter === option} onclick={() => { filter = option; }} class="min-h-11 rounded-full px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring {filter === option ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}">{option}</button>
          {/each}
        </div>
      </div>
      {#each groups as group (group.origin)}
        <SettingsGroup title={group.title}>
          {#each group.skills as skill (skill.name)}
            <div data-skill={skill.name} class="flex min-w-0 items-start gap-3 p-4">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 class="text-sm font-medium">{skill.name}</h3>
                  {#if !skill.decided}<StatusChip tone="info">New</StatusChip>{/if}
                  {#if skillSomeRoles(skill)}<span class="text-xs text-muted-foreground">Some roles</span>{/if}
                </div>
                <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{skill.description}</p>
                <p class="mt-2 text-xs text-muted-foreground">{projectSkillLabel(skill)}</p>
                {#if skill.hides.length > 0}<p class="mt-1 text-xs text-muted-foreground">also in {skill.hides.length} other folders, hidden by this one</p>{/if}
                <details class="mt-2 text-xs text-muted-foreground">
                  <summary class="w-fit cursor-pointer rounded py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">File details<span class="sr-only"> for {skill.name}</span></summary>
                  <div class="flex flex-col gap-2 py-2">
                    <p class="font-medium">SKILL.md</p><code class="select-text break-all">{skill.path}</code>
                    {#if skill.hides.length > 0}
                      <p class="font-medium">Hidden paths</p>
                      {#each skill.hides as path}<code class="select-text break-all">{path}</code>{/each}
                    {/if}
                  </div>
                </details>
              </div>
              <Switch label="Offer {skill.name}" checked={skillOffered(skill)} onchange={checked => choices.toggle(skill.name, checked)} />
            </div>
          {/each}
        </SettingsGroup>
      {:else}
        <p class="py-4 text-sm text-muted-foreground">{snapshot.skills.length ? 'No skills match these filters.' : 'No skills found on this backend or in this project.'}</p>
      {/each}
      <p class="text-xs leading-relaxed text-muted-foreground">Saved for this project on this backend. A change reaches each conversation at its next turn. Off hides a skill from the agents' list; the file stays readable.</p>
    {/if}
  {/if}
</SettingsSection>
</div>
