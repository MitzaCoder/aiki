<script lang="ts">
	/** Product identity only; the assistant's animated activity orb stays separate. */
	let { size = 48 }: { size?: number } = $props();
</script>

<img src="/logo.svg" width={Math.round(size * 504 / 695)} height={size} class="shrink-0 object-contain" alt="" aria-hidden="true" />
