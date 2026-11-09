<script lang="ts">
	import { overlayScrollWithin } from '#lib/scrollbars.js';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import WrapToggle from '#lib/components/WrapToggle.svelte';
	import { codeWrap } from '#lib/code-wrap.svelte.js';
	import { scrollFade } from '#lib/code-wrap.js';
	import { highlight, normalizeLang } from '#lib/markdown/highlight.js';

	/**
	 * A fenced code block with shiki highlighting, a language label and a copy
	 * button. While the code is still streaming, highlighting is throttled so it
	 * does not run on every token.
	 */
	let {
		code,
		lang = '',
		streaming = false,
		bare = false,
		wrapByDefault = false
	}: {
		code: string;
		lang?: string;
		/** Highlighting is throttled while the code is still arriving. */
		streaming?: boolean;
		/** Without the header, e.g. inside tool cards that have their own. */
		bare?: boolean;
		/** Wraps until the reader chooses otherwise (a bash command); fenced code scrolls. */
		wrapByDefault?: boolean;
	} = $props();

	const wrapped = $derived(codeWrap.wraps(wrapByDefault));
	let body = $state<HTMLElement>();
	let fade = $state({ start: false, end: false });

	let html = $state<string>();
	let running = false;
	let dirty = false;

	const label = $derived(normalizeLang(lang));

	async function run(): Promise<void> {
		if (running) {
			dirty = true;
			return;
		}
		running = true;
		try {
			do {
				dirty = false;
				const source = code;
				const language = lang;
				const result = await highlight(source, language);
				if (source === code && language === lang) html = result;
				else dirty = true;
				if (streaming && dirty) await new Promise((resolve) => setTimeout(resolve, 120));
			} while (dirty);
		} catch {
			html = undefined;
		} finally {
			running = false;
		}
	}

	/** Which edges of the sideways scroller have more behind them; read on scroll, resize and new content. */
	function updateFade(): void {
		const scroller = body?.querySelector('pre');
		if (!scroller || wrapped) {
			// Wrapped text has nothing to scroll; a left-over offset would show a blank block.
			if (scroller && scroller.scrollLeft !== 0) scroller.scrollLeft = 0;
			fade = { start: false, end: false };
			return;
		}
		const next = scrollFade(scroller.scrollLeft, scroller.clientWidth, scroller.scrollWidth);
		if (next.start !== fade.start || next.end !== fade.end) fade = next;
	}

	$effect(() => {
		if (!body) return;
		let frame = 0;
		const schedule = (): void => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(updateFade);
		};
		body.addEventListener('scroll', schedule, { capture: true, passive: true });
		const observer = new ResizeObserver(schedule);
		observer.observe(body);
		return () => {
			cancelAnimationFrame(frame);
			body?.removeEventListener('scroll', schedule, true);
			observer.disconnect();
		};
	});

	$effect(() => {
		void html;
		void code;
		void wrapped;
		const frame = requestAnimationFrame(updateFade);
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		void code;
		void lang;
		void run();
	});
</script>

<div
	class="code-block"
	class:bare
	class:wrap={wrapped}
	use:overlayScrollWithin={{ selector: 'pre', autoHide: 'leave' }}
>
	{#if !bare}
		<div class="code-head">
			<span class="code-lang">{label === 'plaintext' ? 'text' : label}</span>
			<span class="code-actions">
				<WrapToggle defaultWrap={wrapByDefault} />
				<CopyButton text={() => code} />
			</span>
		</div>
	{/if}
	<div class="code-body" bind:this={body} data-fade-start={fade.start} data-fade-end={fade.end}>
		{#if html}
			<!-- Shiki's output: the code inside is escaped by the highlighter. -->
			{@html html}
		{:else}
			<pre class="shiki plain"><code>{code}</code></pre>
		{/if}
	</div>
</div>
