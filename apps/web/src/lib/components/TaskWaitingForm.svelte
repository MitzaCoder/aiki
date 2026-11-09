<script lang="ts">
 import type { BoardTaskWaiting } from '@mihai-harness/protocol';
 import { workDay } from '#lib/work-day.svelte.js';
 import { resolveWaitingDate, localWaitingDate, formatWaitingTime } from '#lib/work-day.js';
 import { waitingDateIn } from '#lib/task-waiting.js';
 import { Button } from './ui/button/index.js';
 let {waiting, busy=false, onsave, oncancel}: {waiting?:BoardTaskWaiting; busy?:boolean; onsave:(note:string,until?:string)=>void; oncancel:()=>void}=$props();
 let note=$state('');let until=$state('');let dateChanged=$state(false);
 $effect(()=>{note=waiting?.note??'';until=waiting?.until ? localWaitingDate(waiting.until) : '';dateChanged=false;});
 const resolved=$derived(!dateChanged && waiting?.until ? waiting.until : resolveWaitingDate(until,workDay.start));
</script>
<form class="flex flex-col gap-2 rounded-xl border border-(--chat-border) bg-(--chat-surface-2) p-3" data-waiting-form onsubmit={(e)=>{e.preventDefault();if(note.trim())onsave(note.trim(),resolved);}}>
 <label class="text-sm font-medium" for="task-waiting-note">Waiting for…</label>
 <input id="task-waiting-note" required maxlength={2000} bind:value={note} placeholder="PR #312 approval from Ana" class="min-w-0 rounded-md border border-(--chat-border) bg-(--chat-bg) p-2 text-base"/>
 <label class="text-xs" for="task-waiting-date">Check again on (optional)</label>
 <div class="flex flex-wrap gap-2">
  {#each [{days:1,label:'Tomorrow'},{days:3,label:'In 3 days'},{days:7,label:'Next week'}] as pick}<Button type="button" size="sm" variant="outline" onclick={()=>{until=waitingDateIn(pick.days);dateChanged=true;}}>{pick.label}</Button>{/each}
  <input type="date" id="task-waiting-date" bind:value={until} onchange={()=>dateChanged=true} class="min-w-0 rounded-md border border-(--chat-border) bg-(--chat-bg) p-1 text-sm"/>
  {#if until}<Button type="button" size="sm" variant="ghost" onclick={()=>{until='';dateChanged=true;}}>No date</Button>{/if}
 </div>
 {#if resolved}<p class="text-sm text-(--chat-fg-muted)" aria-live="polite">Back on {formatWaitingTime(resolved)}</p>{/if}
 <div class="flex gap-2"><Button size="sm" type="submit" disabled={busy||!note.trim()}>Save</Button><Button size="sm" type="button" variant="ghost" disabled={busy} onclick={oncancel}>Cancel</Button></div>
</form>
