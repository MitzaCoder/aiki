<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	/**
	 * A display diff, as pi writes them: lines of `[+- ]<line number> <text>`,
	 * with `...` for the parts that were left out.
	 */
	let { diff }: { diff: string } = $props();

	const lines = $derived(
		diff.split('\n').map((line) => {
			const marker = line[0];
			if (/^\s*\.\.\.\s*$/.test(line)) return { kind: 'gap' as const, number: '', text: '⋯' };
			const match = /^[+\- ](\s*\d+)?\s?(.*)$/.exec(line);
			const kind = marker === '+' ? ('add' as const) : marker === '-' ? ('del' as const) : ('ctx' as const);
			if (match === null) return { kind, number: '', text: line };
			return { kind, number: match[1]?.trim() ?? '', text: match[2] ?? '' };
		})
	);
</script>

<div class="relative">
<div use:overlayScroll={'parent'} class="diff overflow-x-auto font-mono text-[0.78rem] leading-[1.6]">
	{#each lines as line, index (index)}
		<div class="flex min-w-max {line.kind}">
			<span class="w-10 shrink-0 pr-2 text-right text-(--chat-fg-subtle) select-none">{line.number}</span>
			<span class="w-4 shrink-0 text-center select-none"
				>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span
			>
			<span class="pr-4 whitespace-pre">{line.text}</span>
		</div>
	{/each}
</div>
</div>

<style>
	.diff {
		padding: 0.5rem 0;
		tab-size: 4;
	}
	.add {
		background: color-mix(in oklab, var(--chat-success) 13%, transparent);
	}
	.add span:nth-child(2) {
		color: var(--chat-success);
	}
	.del {
		background: color-mix(in oklab, var(--chat-danger) 12%, transparent);
	}
	.del span:nth-child(2) {
		color: var(--chat-danger);
	}
	.gap {
		color: var(--chat-fg-subtle);
	}
</style>
