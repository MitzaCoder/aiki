<script lang="ts">
	let {title, status, thread = false, reporting = false}: {title:string; status:string; thread?:boolean; reporting?:boolean} = $props();
</script>
<span class="crew" class:thread class:failed={status==='failed'} class:reporting title={`${thread?'Thread':'Worker'} ${title}: ${status}`}>
	<svg viewBox="-32 -32 64 66" aria-hidden="true">
		<g class="creature" class:busy={status==='running'} class:resting={status==='idle'}>
			<ellipse class="shadow" cy="29" rx="23" ry="5"/>
			<path class="antenna" d="M 0 -20 Q -8 -32 3 -29"/><circle class="tip" cx="3" cy="-29" r="3"/>
			<rect class="body" x="-23" y="-23" width="46" height="46" rx="16"/>
			{#if status==='idle'}<path class="face" d="M -12 -2 q 4 5 8 0 M 4 -2 q 4 5 8 0"/><text class="sleep" x="24" y="-16">z</text>
			{:else}<ellipse class="eye" cx="-8" cy="-3" rx="3" ry="4"/><ellipse class="eye" cx="8" cy="-3" rx="3" ry="4"/>{/if}
			<path class="face" d="M -4 7 Q 0 11 4 7"/><circle class="cheek" cx="-14" cy="6" r="4"/><circle class="cheek" cx="14" cy="6" r="4"/>
			{#if status==='running'}<g class="hands"><path d="M -25 15 l 12 7 M 25 15 l -12 7"/><rect x="-16" y="19" width="32" height="11" rx="3"/><path d="M -9 24 h 5 M 0 24 h 5"/></g>{/if}
		</g>
		{#if status==='failed'}<text class="failure" x="18" y="-10">!</text>{/if}
		{#if reporting}<circle class="spark" cx="3" cy="-29" r="6"/>{/if}
	</svg>
</span>
<style>
	.crew{display:inline-flex;width:36px;height:36px;--crew-tone:var(--graph-working)}.crew.thread{width:40px;--crew-tone:var(--graph-review)}.crew.failed{--crew-tone:var(--graph-blocked)}svg{overflow:visible;width:100%;height:100%}.body{fill:color-mix(in srgb,var(--crew-tone) 45%,var(--chat-bg));stroke:var(--crew-tone);stroke-width:2}.eye{fill:var(--chat-fg);animation:blink 6s infinite;transform-origin:center;transform-box:fill-box}.face,.antenna{fill:none;stroke:var(--chat-fg);stroke-width:2;stroke-linecap:round}.tip{fill:var(--crew-tone)}.cheek{fill:var(--tone-danger);opacity:.6}.shadow{fill:var(--chat-fg);opacity:.08}.hands{stroke:var(--chat-fg);stroke-width:2;fill:var(--chat-surface-2);animation:typing .55s ease-in-out infinite alternate;transform-origin:center}.busy{animation:busy 2.5s ease-in-out infinite}.resting{animation:breathe 5s ease-in-out infinite;transform-origin:center}.sleep,.failure{font-size:22px;fill:var(--chat-fg);font-weight:800}.sleep{font-size:16px}.failure{paint-order:stroke;stroke:var(--chat-bg);stroke-width:4}.spark{fill:var(--crew-tone);animation:spark 1.6s both;filter:drop-shadow(0 0 5px var(--crew-tone))}
	@keyframes busy{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg) translateY(-2px)}}@keyframes typing{to{transform:translateY(1.5px) rotate(2deg)}}@keyframes breathe{50%{transform:scale(1.025) translateY(-1px)}}@keyframes blink{0%,43%,47%,100%{transform:scaleY(1)}45%{transform:scaleY(.15)}}@keyframes spark{0%{opacity:0;transform:translateY(0)}15%{opacity:1}100%{opacity:0;transform:translateY(-35px)}}
	@media(prefers-reduced-motion:reduce){.busy,.resting,.eye,.hands,.spark{animation:none}.spark{display:none}}
</style>
