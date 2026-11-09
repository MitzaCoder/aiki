<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';

	/** A number that counts up to its value when it appears or changes; still under reduced motion. */
	let { value, format = (n: number) => String(Math.round(n)) }: { value: number; format?: (n: number) => string } =
		$props();

	const shown = new Tween(0, { duration: 900, easing: cubicOut });

	$effect(() => {
		void shown.set(value, { duration: prefersReducedMotion.current ? 0 : 900 });
	});
</script>

{format(shown.current)}
