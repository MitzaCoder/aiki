<script lang="ts">
	import { GRAPH_REASONS, GRAPH_STATUSES, type GraphModel } from '#lib/task-graph-model.js';
	import { quietGraphAge, graphHoldsUp, graphWaitingDate } from '#lib/task-graph-changes.js';
	import { relativeTime } from '#lib/relative-time.js';
	let { taskId, model, now, taskHref, onselect, onclose }: { taskId: string; model: GraphModel; now: number; taskHref: (id: string) => string; onselect: (id: string) => void; onclose: () => void } = $props();
	const details = $derived(model.details.get(taskId));
	let expanded = $state(false);
	const holds=$derived(graphHoldsUp([...model.details.values()].map(d=>d.task),taskId));
</script>
<aside class="task-panel" class:expanded aria-label={`Selected task ${taskId}`}>
	<header><strong>{taskId}</strong><div class="panel-actions"><button class="expand-sheet" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? 'Peek' : 'Expand'}</button><button aria-label="Close task details" onclick={onclose}>×</button></div></header>
	{#if details}
		{@const task = details.task}
		{@const status = GRAPH_STATUSES.find(s => s.key === task.status)!}
		<h3>{task.title}</h3>
		<p class="status"><b style:color={status.tone} aria-hidden="true">{status.mark}</b> {status.label}</p>
		{#if details.reasons.length}<div class="reason-overview" aria-label="Needs you">{#each details.reasons as key}{@const reason = GRAPH_REASONS.find(r => r.key === key)!}<span><b style:color={reason.tone}>{reason.mark}</b> {reason.label}</span>{/each}</div>{/if}
		<a class="open-task" href={taskHref(task.id)}>Open task ↗</a>
		{#if details.reasons.length}<h4>Needs you</h4><ul>{#each details.reasons as key}{@const reason = GRAPH_REASONS.find(r => r.key === key)!}<li><b style:color={reason.tone}>{reason.mark}</b> {reason.label}
			{#if key === 'waiting'}<p>{graphWaitingDate(task.waiting?.until,now)} · {task.waiting?.note ?? 'Waiting, no note'} · {task.waiting?.until ? `until ${new Date(task.waiting.until).toLocaleString()}` : 'no date'}</p>{/if}
			{#if key === 'blocked'}<p>{task.blockedReason ?? (task.blockedBy.length ? 'Waiting on the tasks below.' : 'No blocker detail recorded.')}</p>{/if}
			{#if key === 'question'}{#each details.questions as question}<p>{question.kind === 'warning' ? 'Warning' : 'Question'}: {question.text.slice(0, 240)}</p>{/each}{/if}
			{#if key === 'failed'}{#each details.workers.filter(w => w.status === 'failed') as worker}<p>{worker.id}: {worker.failure ?? 'Worker failed; open the task for more.'}</p>{/each}{/if}
		</li>{/each}</ul>{/if}
		<p class="age">{details.quiet ? `◷ ${quietGraphAge(task.updatedAt,now)} · ` : ''}Last update {relativeTime(task.updatedAt, now)}{details.quiet ? ' (48 h or more)' : ''}</p>
		<h4>Family</h4><button class="task-link" onclick={() => onselect(details.familyId)}>{details.familyTitle}</button><p>{details.progress}</p>
		{#snippet taskList(title: string, ids: string[])}
			<h4>{title} ({ids.length})</h4>
			{#if ids.length}<ul>{#each ids as id}<li><button class="task-link" onclick={() => onselect(id)}>{id} · {model.details.get(id)?.task.title ?? 'Not in this board'}</button></li>{/each}</ul>{:else}<p>None</p>{/if}
		{/snippet}
		{@render taskList('Parent', task.parent ? [task.parent] : [])}
		{@render taskList('Subtasks', details.children)}
		{@render taskList('Blocked by', task.blockedBy)}
		<p>Holds up {holds.direct} tasks ({holds.total} including indirect)</p>
		{@render taskList('Blocks directly', details.blocks)}
		<h4>Workers ({details.workers.length})</h4>
		{#each details.workers as worker}<div class="crew"><strong>{worker.id} · {worker.status === 'running' ? 'Busy' : worker.status === 'idle' ? 'Resting' : worker.status}</strong><p>{worker.title}</p><p>{worker.lastReport?.split('\n').filter(Boolean).at(-1) ?? 'No report yet.'}</p></div>{/each}
		<h4>Threads ({details.threads.length})</h4>
		{#each details.threads as thread}<div class="crew"><strong>{thread.title} · {thread.status === 'running' ? 'Busy' : thread.status === 'idle' ? 'Resting' : thread.status}</strong><p>{thread.current ?? thread.summary ?? thread.failure ?? 'No report yet.'}</p></div>{/each}
	{:else}<h3>{taskId} is no longer in this board.</h3><p>Your selection is kept. It may have been archived or removed.</p><a href={taskHref(taskId)}>Open task</a>{/if}
</aside>
<style>
	.task-panel{position:absolute;right:12px;top:12px;bottom:12px;width:320px;max-width:calc(100% - 24px);padding:16px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--chat-border);border-radius:16px;background:var(--chat-surface);color:var(--chat-fg);box-shadow:var(--tone-shadow);z-index:4;font-size:13px;overflow-wrap:anywhere}header{display:flex;align-items:center;justify-content:space-between;position:sticky;top:-16px;background:var(--chat-surface);z-index:1}.panel-actions{display:flex;gap:6px}.expand-sheet{display:none}.reason-overview{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px;font-size:12px}header button{font-size:22px;min-width:28px;min-height:28px;border:1px solid var(--chat-border);border-radius:7px;background:var(--chat-surface-2)}h3{font-size:18px;line-height:1.3;margin:12px 0 8px}h4{font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin:18px 0 7px;color:var(--chat-fg-muted)}p{margin:4px 0 8px}ul{list-style:none;margin:0;padding:0}li{margin:4px 0}.open-task{display:inline-flex;padding:7px 10px;border:1px solid var(--chat-border);border-radius:8px;min-height:30px}.task-link{text-align:left;color:var(--chat-fg);text-decoration:underline;text-underline-offset:3px;min-height:28px}.age{margin-top:14px;color:var(--chat-fg-muted)}.crew{padding:8px 0;border-top:1px solid var(--chat-border)}.crew p{color:var(--chat-fg-muted)}button:focus-visible,a:focus-visible{outline:3px solid var(--chat-fg);outline-offset:2px}
	@media(max-width:640px){.task-panel{left:0;right:0;top:auto;bottom:0;width:100%;max-width:none;height:40%;max-height:40%;border-radius:18px 18px 0 0;padding:6px 14px 12px;box-shadow:0 -4px 24px #0002}.task-panel.expanded{height:100%;max-height:100%;top:0}.expand-sheet{display:block;font-size:12px;padding:0 10px}header{top:-6px}header button,.task-link,.open-task{min-height:44px;min-width:44px}h3{font-size:16px;line-height:1.25;margin:5px 0}.status{margin:3px 0}.reason-overview{margin:3px 0 6px}.open-task{padding:5px 10px;align-items:center}}
</style>
