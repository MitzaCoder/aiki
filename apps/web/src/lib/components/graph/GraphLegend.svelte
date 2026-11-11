<script lang="ts">
	import { GRAPH_STATUSES } from '#lib/task-graph-model.js';
</script>
{#snippet legend()}
	<div class="legend" aria-label="Relationship legend"><span><i></i>Subtask</span><span><i class="found"></i>Found while</span><span><i class="blocked"></i>Blocked by →</span><span><i class="related"></i>Related</span><span>♧ Crew on cards</span></div>
	<div class="legend" aria-label="Status legend">{#each GRAPH_STATUSES as status}<span><b style:color={status.tone}>{status.mark}</b>{status.label}</span>{/each}</div>
{/snippet}
<footer>
	<div class="desktop-legend">{@render legend()}</div>
	<details class="phone-legend"><summary>Legend</summary><div class="legend-popover">{@render legend()}<p>Tap selects. Open task or Enter opens its sheet.</p></div></details>
	<span class="hint">Tap to select · Enter to open</span>
</footer>
<style>
	footer{position:relative;flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;min-height:30px;padding:5px 16px;font-size:12px;color:var(--chat-fg);border-top:1px solid var(--chat-border)}.desktop-legend{display:flex;flex-wrap:wrap;gap:12px}.legend{display:flex;flex-wrap:wrap;gap:10px}.legend span{display:inline-flex;align-items:center;gap:4px}.legend i{width:15px;border-top:2px solid var(--graph-subtask)}.legend .found{border-top:2px dotted var(--chat-fg)}.legend .blocked{border-top:2px dashed var(--graph-blocked)}.legend .related{border:0;height:2px;background:repeating-linear-gradient(90deg,var(--chat-fg) 0 7px,transparent 7px 10px,var(--chat-fg) 10px 12px,transparent 12px 15px)}.hint{white-space:nowrap}.phone-legend{display:none}
	@media(max-width:640px){footer{padding:0 10px;min-height:44px}.desktop-legend{display:none}.phone-legend{display:block}.phone-legend summary{display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;cursor:pointer;font-size:12px}.phone-legend summary:focus-visible{outline:3px solid var(--chat-fg);outline-offset:-3px}.legend-popover{position:absolute;bottom:calc(100% + 6px);left:8px;right:8px;border:1px solid var(--chat-border);border-radius:12px;background:var(--chat-surface);box-shadow:var(--tone-shadow);padding:14px;z-index:8}.legend-popover .legend{gap:12px;margin-bottom:14px}.legend-popover p{margin:0;color:var(--graph-muted)}.hint{font-size:12px}}
</style>
