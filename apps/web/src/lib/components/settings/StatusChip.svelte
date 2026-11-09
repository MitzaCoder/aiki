<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '#lib/utils.js';

	/**
	 * A small state label (connected, configured, signed in, paused). The colour comes from the theme's success,
	 * warning and danger tones, so it reads in every theme, light and dark; the words carry the meaning, the colour
	 * only helps.
	 */
	let {
		tone = 'muted',
		dot = true,
		class: className,
		children
	}: {
		tone?: 'ok' | 'warn' | 'err' | 'info' | 'muted';
		/** A round marker before the words. */
		dot?: boolean;
		class?: string;
		children: Snippet;
	} = $props();

	const COLOR: Record<string, string> = {
		ok: 'var(--chat-success)',
		warn: 'var(--chat-warning)',
		err: 'var(--chat-danger)',
		info: 'var(--accent-2)',
		muted: 'var(--chat-fg-muted)'
	};
</script>

<span
	class={cn(
		'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap',
		className
	)}
	style:--chip={COLOR[tone]}
	style:color="color-mix(in oklab, var(--chip) 78%, var(--chat-fg))"
	style:background="color-mix(in oklab, var(--chip) 11%, transparent)"
	style:border-color="color-mix(in oklab, var(--chip) 30%, transparent)"
	data-tone={tone}
>
	{#if dot}<span class="size-1.5 rounded-full" style:background="var(--chip)" aria-hidden="true"></span>{/if}
	{@render children()}
</span>
