<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { TaskGraphSession } from '#lib/task-graph-session.svelte.js';
	import { graphChangeText } from '#lib/task-graph-changes.js';
	import { relativeTime } from '#lib/relative-time.js';
	let {session,now,onselect}:{session:TaskGraphSession;now:number;onselect:(id:string)=>void}=$props();
	let toggle:HTMLButtonElement|null=$state(null), dialog:HTMLDivElement|null=$state(null);
	$effect(()=>{if(session.changesOpen)untrack(()=>{void tick().then(()=>dialog?.focus({preventScroll:true}));});});
	function close(){session.changesOpen=false;toggle?.focus({preventScroll:true});}
	function select(id:string){close();onselect(id);}
</script>
<button bind:this={toggle} class="changes-toggle" aria-label={`Changes${session.unseen?`, ${session.unseen} new`:''}`} aria-expanded={session.changesOpen} aria-controls="graph-changes" onclick={()=>session.toggleChanges()}>Changes{#if session.unseen}<b>{session.unseen} new</b>{/if}</button>
{#if session.changesOpen}
	<div bind:this={dialog} id="graph-changes" class="changes" role="dialog" tabindex="-1" aria-label="Recent graph changes" onkeydown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
		<header><strong>What changed</strong><button aria-label="Close changes" onclick={close}>×</button></header>
		<p>While this graph is open · latest 50</p>
		{#if !session.changes.length}<p>No changes yet. Reconnecting starts a fresh baseline.</p>{/if}
		<ol>{#each session.changes as entry (entry.id)}<li><button onclick={()=>select(entry.taskIds[0]!)}>{graphChangeText(entry)}<small>{relativeTime(new Date(entry.at).toISOString(),now)}</small></button>{#if entry.taskIds.length>1}<div class="task-links">{#each entry.taskIds as id}<button onclick={()=>select(id)}>{id}</button>{/each}</div>{/if}</li>{/each}</ol>
	</div>
{/if}
<style>
	.changes-toggle{display:flex;align-items:center;gap:5px;min-height:32px;padding:4px 8px;border:1px solid var(--chat-border);border-radius:9px;background:var(--chat-surface);color:var(--chat-fg);font-size:12px;white-space:nowrap}.changes-toggle b{border-radius:5px;background:var(--chat-surface-2);padding:2px 4px}.changes{position:absolute;right:12px;top:100%;margin-top:8px;width:360px;max-width:calc(100vw - 24px);max-height:65vh;overflow:auto;padding:12px;border:1px solid var(--chat-border);border-radius:14px;background:var(--chat-surface);color:var(--chat-fg);box-shadow:var(--tone-shadow);font-size:14px;z-index:12}.changes header{display:flex;align-items:center;justify-content:space-between}.changes header button{font-size:22px;min-width:32px;min-height:32px}.changes p{font-size:12px;margin:8px 0}.changes ol{list-style:none;padding:0;margin:0}.changes li{border-top:1px solid var(--chat-border);padding:4px 0}.changes li>button{display:block;text-align:left;width:100%;padding:8px 4px;min-height:44px;overflow-wrap:anywhere}.changes small{display:block;color:var(--graph-muted);font-size:12px;margin-top:3px}.task-links{display:flex;flex-wrap:wrap;gap:6px}.task-links button{min-height:28px;min-width:28px;text-decoration:underline}.changes button:focus-visible,.changes-toggle:focus-visible{outline:3px solid var(--chat-fg);outline-offset:2px}
	.changes:focus-visible{outline:3px solid var(--chat-fg);outline-offset:2px}
	@media (hover:none) and (pointer:coarse){.changes-toggle,.changes header button,.task-links button{min-height:44px;min-width:44px}}
	@media(max-width:640px){.changes-toggle{min-height:44px}.changes{position:fixed;top:auto;bottom:0;left:0;right:0;width:100%;max-width:none;max-height:65dvh;border-radius:18px 18px 0 0;padding:12px 16px}.changes header button,.task-links button{min-height:44px;min-width:44px}}
</style>
