<script lang="ts">
	import { page } from '$app/state';
	import Banner from '#lib/components/Banner.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { normalizeBackendUrl } from '#lib/backends.js';
	import { expandBackendAddress, nameFromBackendUrl } from '#lib/published-backends.js';
	import { suggestedBackends } from '#lib/suggested-backends.svelte.js';

	let {
		submitLabel = 'Add backend',
		onsubmit
	}: {
		submitLabel?: string;
		onsubmit: (backend: { name: string; url: string }) => void | Promise<void>;
	} = $props();

	let name = $state('');
	let url = $state('');
	/** Set once the user edits the name, so the automatic fill never overwrites a choice. */
	let nameEdited = $state(false);
	let busy = $state(false);
	let error = $state<string | undefined>(undefined);

	/** What a bare name expands against: the published list first, then the app's own host. */
	const context = $derived({ entries: suggestedBackends.backends, appOrigin: page.url.origin });
	/** The URL as it will be read, shown while typing so the expansion is never a surprise. */
	const expanded = $derived(expandBackendAddress(url, context));

	// An empty name fills itself from the address's first label, and follows it until the user types a name.
	$effect(() => {
		if (nameEdited) return;
		const derived = nameFromBackendUrl(expanded);
		if (name !== derived) name = derived;
	});

	function errorText(value: unknown): string {
		return value instanceof Error ? value.message : String(value);
	}

	function expandNow(): void {
		if (url.trim().length === 0) return;
		const next = expandBackendAddress(url, context);
		if (next !== url) url = next;
	}

	async function submit(): Promise<void> {
		error = undefined;
		let normalized: string;
		try {
			normalized = normalizeBackendUrl(expandBackendAddress(url, context));
		} catch (value) {
			error = errorText(value);
			return;
		}
		busy = true;
		try {
			await onsubmit({ name: name.trim().length > 0 ? name.trim() : nameFromBackendUrl(normalized), url: normalized });
			name = '';
			url = '';
			nameEdited = false;
		} catch (value) {
			error = errorText(value);
		} finally {
			busy = false;
		}
	}
</script>

<form
	class="flex flex-col gap-3"
	onsubmit={(event) => {
		event.preventDefault();
		void submit();
	}}
>
	<div class="flex flex-col gap-3">
		<Field.Group class="grid gap-3 sm:grid-cols-2">
			<Field.Field>
				<Field.Label for="backend-name">Name</Field.Label>
				<Input
					id="backend-name"
					bind:value={name}
					oninput={() => (nameEdited = true)}
					placeholder="harness-pc"
					autocomplete="off"
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label for="backend-url">Address</Field.Label>
				<Input
					id="backend-url"
					bind:value={url}
					onblur={expandNow}
					placeholder="harness-pc or https://harness-pc.example.test"
					autocomplete="off"
					spellcheck="false"
				/>
				{#if expanded !== url.trim() && url.trim().length > 0}
					<Field.Description>
						<span class="font-mono break-all">{expanded}</span>
					</Field.Description>
				{/if}
			</Field.Field>
		</Field.Group>
		<div>
			<Button type="submit" disabled={busy || url.trim().length === 0}>
				{busy ? 'Adding…' : submitLabel}
			</Button>
		</div>
	</div>
	{#if error}
		<Banner tone="error">{error}</Banner>
	{/if}
</form>
