<script lang="ts">
	import { onMount } from 'svelte';
	import type { BoardReportSection } from '@aiki/protocol';
	import { reportSectionAge, reportSectionReasons } from '#lib/report-freshness.js';
	import { exactTime } from '#lib/relative-time.js';
	let { section, emptyResults = false }: { section: BoardReportSection; emptyResults?: boolean } = $props();
	let now = $state(Date.now());
	const age = $derived(reportSectionAge(section, now, emptyResults));
	const reasons = $derived(reportSectionReasons(section, emptyResults));
	onMount(() => {
		const timer = setInterval(() => { now = Date.now(); }, 30_000);
		return () => clearInterval(timer);
	});
</script>

<div class="mt-1 text-[0.6875rem] text-(--chat-fg-subtle)" title={section.writtenAt ? exactTime(section.writtenAt) : undefined}>
	{age}
	{#if section.stale}
		{#if age}{' · '}{/if}<span class="font-semibold text-(--chat-fg-muted)">needs update</span>
		{#if reasons.length > 0}· {reasons.join('; ')}{/if}
	{/if}
</div>
