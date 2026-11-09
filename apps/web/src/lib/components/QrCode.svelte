<script lang="ts">
	import { encode } from 'uqr';

	/** A QR code for `value`, drawn as an SVG so it scales on a phone and prints without a bitmap. */
	let { value, class: className = '' }: { value: string; class?: string } = $props();

	/** Undefined when the value is longer than a QR code holds; the caller still has the link itself. */
	const code = $derived.by(() => {
		try {
			return encode(value, { ecc: 'M', border: 2 });
		} catch {
			return undefined;
		}
	});
</script>

{#if code}
	<svg
		class="block h-auto w-full {className}"
		viewBox="0 0 {code.size} {code.size}"
		role="img"
		aria-label="QR code for the connection link"
		shape-rendering="crispEdges"
	>
		<rect width={code.size} height={code.size} fill="#ffffff" />
		{#each code.data as row, y}
			{#each row as dark, x}
				{#if dark}<rect x={x} y={y} width="1" height="1" fill="#000000" />{/if}
			{/each}
		{/each}
	</svg>
{:else}
	<p class="text-sm text-muted-foreground">Too long for a QR code. Copy the link instead.</p>
{/if}
