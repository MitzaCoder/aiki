<script lang="ts">
	import { workDay } from '#lib/work-day.svelte.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { MediaQuery } from 'svelte/reactivity';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/settings/SettingsRow.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import ThemePreview from '#lib/components/settings/ThemePreview.svelte';
	import { theme } from '#lib/themes/theme.svelte.js';
	import { THEMES } from '#lib/themes/themes.js';

	/**
	 * General → Appearance. The theme is a palette: each card draws the app in it, light and dark side by side. Light
	 * or dark itself follows the device. Saved in this browser at once, so there is nothing to confirm.
	 */
	const systemDark = new MediaQuery('(prefers-color-scheme: dark)');

	function onkeydown(event: KeyboardEvent): void {
		const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
		const step = keys[event.key];
		if (step === undefined) return;
		event.preventDefault();
		const at = THEMES.findIndex((entry) => entry.id === theme.current);
		const next = THEMES[(at + step + THEMES.length) % THEMES.length];
		if (next === undefined) return;
		theme.set(next.id);
		queueMicrotask(() =>
			(event.currentTarget as HTMLElement).querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
		);
	}
</script>

<SettingsSection title="Appearance" description="How the app looks in this browser." icon="palette">
	<SettingsGroup title="Theme">
		<div class="px-4 py-4 sm:px-5">
			<div
				role="radiogroup"
				aria-label="Theme"
				tabindex="-1"
				{onkeydown}
				class="grid gap-3 sm:grid-cols-2"
			>
				{#each THEMES as entry (entry.id)}
					{@const chosen = theme.current === entry.id}
					<button
						type="button"
						role="radio"
						aria-checked={chosen}
						tabindex={chosen ? 0 : -1}
						data-theme-card={entry.id}
						onclick={() => theme.set(entry.id)}
						class="group flex flex-col overflow-hidden rounded-xl text-left outline-none transition-[box-shadow,transform] focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:hover:-translate-y-px {chosen
							? 'shadow-md ring-2 ring-(--accent-2)'
							: 'shadow-xs ring-1 ring-foreground/15 hover:shadow-md hover:ring-foreground/30'}"
					>
						<div class="grid grid-cols-2">
							<ThemePreview id={entry.id} />
							<ThemePreview id={entry.id} dark />
						</div>
						<div class="flex items-center gap-2 border-t border-(--chat-border) bg-card px-3 py-2.5">
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="text-sm font-semibold">{entry.name}</span>
								<span class="truncate text-xs text-muted-foreground">{entry.description}</span>
							</span>
							<span
								class="grid size-5 shrink-0 place-items-center rounded-full {chosen
									? 'bg-primary text-primary-foreground'
									: 'ring-1 ring-foreground/20'}"
							>
								{#if chosen}<CheckIcon class="size-3" aria-hidden="true" />{/if}
							</span>
						</div>
					</button>
				{/each}
			</div>
		</div>
		<SettingsRow label="Light or dark" hint="Follows your device's setting.">
			<StatusChip tone="info" dot={false}>
				{#if systemDark.current}
					<MoonIcon class="size-3.5" aria-hidden="true" /> Dark now
				{:else}
					<SunIcon class="size-3.5" aria-hidden="true" /> Light now
				{/if}
			</StatusChip>
		</SettingsRow>
	</SettingsGroup>
	<SettingsGroup title="Waiting tasks">
		<SettingsRow label="Work day starts at" hint="Return dates use this device’s local time zone. Saved in this browser.">
			<input aria-label="Work day starts at" type="time" value={workDay.start} onchange={(event)=>workDay.set(event.currentTarget.value)} class="min-h-11 rounded-md border border-(--chat-border) bg-(--chat-bg) px-3 text-base" />
		</SettingsRow>
	</SettingsGroup>
	<p class="px-1 text-xs text-(--chat-fg-subtle)">The theme is kept in this browser, not on a backend.</p>
</SettingsSection>
