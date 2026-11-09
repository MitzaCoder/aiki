<script lang="ts">
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import type { ProjectAttentionLink } from '#lib/sidebar-attention.js';
	let { links, onnavigate }: { links: ProjectAttentionLink[]; onnavigate: () => void } = $props();
	const count = $derived(links.reduce((sum, link) => sum + link.count, 0));
</script>

{#snippet action(link: ProjectAttentionLink)}
	<a href={link.href} onclick={onnavigate} class:review={link.kind === 'review'} title="{link.backendName} · {link.projectName} — {link.label}">
		<span class="action-icon" aria-hidden="true">
			{#if link.kind === 'question'}<CircleHelp size={15} />{:else if link.kind === 'warning'}<TriangleAlert size={15} />{:else if link.kind === 'review'}<CheckCheck size={15} />{:else}<CircleX size={15} />{/if}
		</span>
		<span class="action-label"><strong>{link.label}</strong><small>{link.projectName}<span class="sr-only"> · {link.backendName}</span></small></span>
		<ArrowUpRight size={13} class="jump" aria-hidden="true" />
	</a>
{/snippet}

{#if links.length > 0}
	<section class="needs-you" aria-label="Needs you" data-sidebar-attention>
		<div class="attention-heading"><h3>Needs you</h3><span aria-label="{count} outstanding actions">{count}</span></div>
		{#each links.slice(0, 3) as link (link.key)}{@render action(link)}{/each}
		{#if links.length > 3}
			<details><summary>{links.length - 3} more to check</summary>{#each links.slice(3) as link (link.key)}{@render action(link)}{/each}</details>
		{/if}
	</section>
{/if}

<style>
	.needs-you { margin: 6px 3px 14px; overflow: hidden; border: 1px solid color-mix(in oklab, var(--chat-warning) 30%, var(--chat-border)); border-radius: 13px; background: linear-gradient(125deg, color-mix(in oklab, var(--chat-warning) 7%, var(--chat-surface)), var(--chat-surface) 70%); box-shadow: 0 4px 18px color-mix(in oklab, var(--chat-shadow) 7%, transparent); animation: arrive 200ms ease-out; }
	.attention-heading { display: flex; align-items: center; justify-content: space-between; padding: 10px 11px 7px; font-size: 10px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--chat-fg-muted); }
	.attention-heading > span { display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 7px; background: color-mix(in oklab, var(--chat-warning) 13%, transparent); color: var(--chat-warning); font-size: 11px; letter-spacing: 0; }
	a { display: flex; min-height: 48px; align-items: center; gap: 9px; margin: 0 4px 3px; padding: 7px; border-radius: 9px; transition: background 150ms; }
	a:hover { background: color-mix(in oklab, var(--chat-warning) 9%, transparent); }
	a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
	.action-icon { display: grid; place-items: center; width: 27px; height: 29px; flex-shrink: 0; border-radius: 9px; color: var(--chat-warning); background: color-mix(in oklab, var(--chat-warning) 11%, transparent); }
	.action-label { flex: 1; min-width: 0; }
	strong, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	strong { font-size: 12px; font-weight: 600; color: var(--chat-fg); }
	small { margin-top: 2px; font-size: 10px; color: var(--chat-fg-subtle); }
	:global(.needs-you .jump) { color: var(--chat-fg-subtle); }
	.review .action-icon { background: var(--chat-surface-2); color: var(--chat-fg-muted); }
	.review strong { color: var(--chat-fg-muted); font-weight: 500; }
	summary { padding: 9px 11px; cursor: pointer; color: var(--chat-fg-muted); font-size: 11px; border-top: 1px solid var(--chat-border); }
	@keyframes arrive { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
	@media (prefers-reduced-motion: reduce) { .needs-you { animation: none; } a { transition: none; } }
</style>
