<script lang="ts">
	import { visibleReleaseUpdate } from '#lib/release-updates.js';
	import Banner from '#lib/components/Banner.svelte';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	let { backend }: { backend: BackendConnection } = $props();
	let error = $state('');
	const updates = $derived(backend.supports('release-updates') ? backend.status?.updates : undefined);
	const available = $derived(updates?.schemaVersion === 1 && updates.enabled ? updates.available : null);
	async function dismiss() {
		if (!available) return;
		try {
			const response = await backend.client.request({ type: 'server.updates.set', dismissVersion: available.version });
			if (response.type === 'server.updates.set' && backend.status) backend.status = { ...backend.status, updates: response.updates };
		} catch { error = 'Could not dismiss. Try again when connected.'; }
	}
</script>

{#if available && visibleReleaseUpdate(updates)}
	<Banner>
		<div class="flex items-start gap-2" data-release-update-banner>
			<div class="min-w-0 flex-1">
				<p>Aiki <strong>{available.version}</strong> is available. <a class="underline" href={available.notesUrl} target="_blank" rel="noopener noreferrer">Release notes</a></p>
				<p>Stop Aiki, then <code>aiki update</code>, then start it.</p>
				{#if error}<p role="status">{error}</p>{/if}
			</div>
			<button type="button" class="min-h-11 shrink-0 px-2 underline" aria-label="Dismiss update notice" onclick={dismiss}>Dismiss</button>
		</div>
	</Banner>
{/if}
