<script lang="ts">
	import type { BoardTaskActivity } from '@aiki/protocol';
	import { activityMinute } from '#lib/activity-minute.js';
	import { taskActivityAge, taskActivityTone } from '#lib/task-activity.js';
	import { exactTime } from '#lib/relative-time.js';
	let { activity, compact = false }: { activity: BoardTaskActivity; compact?: boolean } = $props();
	const tone = $derived(taskActivityTone(activity.kind));
	const age = $derived(taskActivityAge(activity, $activityMinute));
</script>

<span class="activity-line inline-flex max-w-full items-start gap-1.5" class:text-task={ !compact } class:text-task-sm={compact} data-activity-kind={activity.kind}>
	<span class="activity-dot mt-[0.5em] size-1.5 shrink-0 rounded-full" class:active={tone === 'active'} data-tone={tone} aria-hidden="true"></span>
	<span class="min-w-0 break-words text-(--chat-fg-muted)">{activity.text}{#if age}<span class="text-[0.6875rem] text-(--chat-fg-subtle)" title={exactTime(activity.since)}>{' · '}{age}</span>{/if}</span>
</span>

<style>
	.activity-dot { background: var(--chat-fg-subtle); }
	.activity-dot[data-tone='error'] { background: var(--destructive); }
	.activity-dot[data-tone='attention'] { background: var(--chat-warning); }
	.activity-dot[data-tone='active'] { background: var(--task-status-working); }
	.activity-dot[data-tone='review'] { background: var(--task-status-review); }
	@media (prefers-reduced-motion: no-preference) {
		.activity-dot.active { animation: activity-pulse 2s ease-in-out infinite; }
	}
	@keyframes activity-pulse { 50% { opacity: 0.4; } }
</style>
