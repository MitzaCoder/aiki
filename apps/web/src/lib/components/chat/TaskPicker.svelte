<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import { taskStatusClass, taskStatusLabel } from '#lib/board.js';
	import type { TaskOption } from '#lib/task-chat.js';

	/** The tasks the composer can attach, as big rows a thumb can hit; the highlighted one is what Enter picks. */
	let {
		choices,
		active,
		searching,
		onpick,
		onhover
	}: {
		choices: readonly TaskOption[];
		active: number;
		/** The user is typing after `#`, so an empty list means no match rather than no open tasks. */
		searching: boolean;
		onpick: (option: TaskOption) => void;
		onhover: (index: number) => void;
	} = $props();

	let list = $state<HTMLDivElement | undefined>(undefined);

	$effect(() => {
		list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	});
</script>

<div class="absolute inset-x-0 bottom-full z-20 mb-2">
<div
	bind:this={list}
	role="listbox"
	aria-label="Tasks"
	data-task-picker
	use:overlayScroll={'parent'}
	class="max-h-[min(18rem,40dvh)] overflow-y-auto overscroll-contain rounded-2xl border border-(--chat-border) bg-(--chat-bg) p-1 shadow-(--chat-shadow)"
>
	{#each choices as option, index (option.id)}
		<button
			type="button"
			role="option"
			aria-selected={index === active}
			class="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-sm transition-colors {index === active
				? 'bg-(--chat-surface-2)'
				: ''}"
			onmousedown={(event) => event.preventDefault()}
			onmouseenter={() => onhover(index)}
			onclick={() => onpick(option)}
		>
			<span class="w-9 shrink-0 font-mono text-xs font-semibold text-(--accent-2)">{option.id}</span>
			<span class="min-w-0 flex-1 truncate">{option.title}</span>
			<span class="shrink-0 rounded-full border px-1.5 py-px text-[0.6875rem] {taskStatusClass(option.status)}">
				{taskStatusLabel(option.status)}
			</span>
		</button>
	{:else}
		<p class="px-3 py-3 text-sm text-(--chat-fg-subtle)">{searching ? 'No task matches.' : 'No open tasks.'}</p>
	{/each}
</div>
</div>
