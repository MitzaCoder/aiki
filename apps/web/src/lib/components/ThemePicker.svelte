<script lang="ts">
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { theme } from '#lib/themes/theme.svelte.js';
	import { THEMES, isThemeId } from '#lib/themes/themes.js';

	/** A small picker for the app's palette; light/dark still follows the system. */
	let { class: className = '' }: { class?: string } = $props();

	function choose(value: string): void {
		if (isThemeId(value)) theme.set(value);
	}
</script>

<label class="flex items-center gap-1.5 text-xs text-muted-foreground {className}">
	<span class="sr-only sm:not-sr-only">Theme</span>
	<NativeSelect.Root
		size="sm"
		class="w-28"
		value={theme.current}
		onchange={(event) => choose(event.currentTarget.value)}
	>
		{#each THEMES as entry (entry.id)}
			<NativeSelect.Option value={entry.id}>{entry.name}</NativeSelect.Option>
		{/each}
	</NativeSelect.Root>
</label>
