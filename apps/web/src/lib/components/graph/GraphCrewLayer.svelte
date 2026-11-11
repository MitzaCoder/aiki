<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { GraphModel } from '#lib/task-graph-model.js';
	import type { FamilyCard } from '#lib/task-graph-families.js';
	import GraphCreature from './GraphCreature.svelte';
	let {cards,model,reports,now,reduced,tabVisible}:{cards:readonly FamilyCard[];model:GraphModel;reports:Readonly<Record<string,number>>;now:number;reduced:boolean;tabVisible:boolean}=$props();
	const crew=$derived(cards.flatMap(card=>{
		const d=model.details.get(card.id);if(!d)return [];
		const members=[...d.workers.filter(w=>!['done','stopped'].includes(w.status)).map(w=>({id:'worker:'+w.id,workerId:w.id,title:w.title,status:w.status,thread:false})),...d.threads.filter(t=>!t.main&&!t.archived&&t.status!=='done').map(t=>({id:'thread:'+t.id,workerId:'',title:t.title,status:t.status,thread:true}))];
		return members.slice(0,3).map((member,index)=>({...member,taskId:card.id,x:card.box.x+card.box.width-8-(members.length>3?30:0)-(Math.min(3,members.length)-index)*40,y:card.box.y-36}));
	}).filter((member,index,all)=>all.findIndex(other=>other.id===member.id)===index));
	let visible=$state<Record<string,boolean>>({});
	let observer:IntersectionObserver|undefined;
	function observe(node:HTMLElement){observer?.observe(node);return{destroy:()=>observer?.unobserve(node)}}
	onMount(()=>{
		observer=new IntersectionObserver(entries=>{for(const entry of entries)visible[entry.target.getAttribute('data-crew-id')!]=entry.isIntersecting;});
		for(const node of document.querySelectorAll('[data-crew-id]'))observer.observe(node);
		return()=>observer?.disconnect();
	});
</script>
{#each crew as member (member.id)}
	<span class="crew-position" class:paused={!tabVisible||visible[member.id]===false} class:reduced data-crew-id={member.id} data-crew-task={member.taskId} style="left:{member.x}px;top:{member.y}px" use:observe in:fade={{duration:reduced?0:220}} out:fade={{duration:reduced?0:250}} aria-hidden="true">
		{#key reports[member.workerId]??0}<GraphCreature title={member.title} status={member.status} thread={member.thread} reporting={(reports[member.workerId]??0)>now}/>{/key}
	</span>
{/each}
<style>
	.crew-position{position:absolute;display:flex;width:36px;height:36px;pointer-events:none;transition:left 400ms ease,top 400ms ease;z-index:2}.paused{transition:none}.paused :global(*){animation-play-state:paused!important}.reduced{transition:none}
	@media(prefers-reduced-motion:reduce){.crew-position{transition:none}}
</style>
