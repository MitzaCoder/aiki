<script lang="ts">
  import { page } from '$app/state';
  import McpServersSection from '#lib/components/settings/McpServersSection.svelte';
  import NotFoundNote from '#lib/components/settings/NotFoundNote.svelte';
  import { harness } from '#lib/harness.svelte.js';
  const backend = $derived(harness.backend(page.params.id ?? ''));
</script>

{#if backend}
  {#key backend.id}<McpServersSection {backend} />{/key}
{:else}
  <NotFoundNote title="Unknown backend">This backend is not configured in this browser.</NotFoundNote>
{/if}
