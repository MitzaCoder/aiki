<script lang="ts">
	import '@xterm/xterm/css/xterm.css';
	import ClipboardPasteIcon from '@lucide/svelte/icons/clipboard-paste';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { onMount } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { KEY_BAR_ROWS, applyModifiers, arrowBytes, type KeyBarKey, type TerminalTab } from '#lib/terminal.js';
	import { currentTerminalColors } from '#lib/terminal-theme.js';
	import { theme } from '#lib/themes/theme.svelte.js';
	import type { TerminalSession, TerminalState } from '@kemiri/client';
	import type { Terminal } from '@xterm/xterm';

	/**
	 * One terminal: an xterm.js screen bound to a zellij session on the backend, with the phone's key bar under it.
	 *
	 * The component owns the client's `TerminalSession`: it opens it once the screen has a size, detaches it when the
	 * tab goes away, and lets the client reattach it by itself when the connection drops. A tab that is not the
	 * active one stays attached but hidden, so what runs in it keeps its place.
	 */
	let {
		backend,
		tab,
		active,
		keyBar,
		onsession,
		onclose,
		onrestart
	}: {
		backend: BackendConnection;
		tab: TerminalTab;
		active: boolean;
		/** The phone's row of keys; shown by the page where there is no physical keyboard. */
		keyBar: boolean;
		/** The session's name, once the backend has made or found it. */
		onsession: (session: string) => void;
		/** Close this tab (the session keeps running). */
		onclose: () => void;
		/** Start a new session where this one ended. */
		onrestart: () => void;
	} = $props();

	const FONT_FAMILY = '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

	let host = $state<HTMLDivElement | null>(null);
	let term: Terminal | undefined;
	let handle: TerminalSession | undefined;
	let fitNow: (() => void) | undefined;
	let terminalReady = $state(false);
	let sessionState = $state<TerminalState>({ status: 'attaching' });
	let hasSelection = $state(false);
	const modifiers = $state({ ctrl: false, alt: false });

	/** Phones get a smaller type so a line is a useful width. */
	function fontSize(): number {
		return window.matchMedia('(max-width: 640px)').matches ? 12 : 13;
	}

	onMount(() => {
		let disposed = false;
		const cleanups: (() => void)[] = [];

		void (async () => {
			const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { ClipboardAddon }, { WebglAddon }] = await Promise.all([
				import('@xterm/xterm'),
				import('@xterm/addon-fit'),
				import('@xterm/addon-web-links'),
				import('@xterm/addon-clipboard'),
				import('@xterm/addon-webgl')
			]);
			// Measuring a font that has not loaded gives the wrong cell size, and so the wrong number of columns.
			await document.fonts?.load(`${fontSize()}px "JetBrains Mono Variable"`).catch(() => undefined);
			if (disposed || host == null) return;

			const screen = new Terminal({
				fontFamily: FONT_FAMILY,
				fontSize: fontSize(),
				lineHeight: 1.15,
				cursorBlink: true,
				scrollback: 5000,
				allowProposedApi: true,
				macOptionIsMeta: true,
				theme: currentTerminalColors()
			});
			const fit = new FitAddon();
			screen.loadAddon(fit);
			// A link in the output opens in a new tab; zellij's own copy (OSC 52) reaches the clipboard.
			screen.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank', 'noopener,noreferrer')));
			screen.loadAddon(new ClipboardAddon());
			screen.open(host);
			term = screen;
			// The GPU renderer draws zellij's powerline separators and box lines itself (the font has none of them), and keeps a
			// flood of output cheap. Where WebGL is missing or lost, the DOM renderer stays.
			try {
				const gpu = new WebglAddon();
				gpu.onContextLoss(() => gpu.dispose());
				screen.loadAddon(gpu);
			} catch {
				// No WebGL: the default renderer is used.
			}

			screen.attachCustomKeyEventHandler((event) => {
				if (event.type !== 'keydown') return true;
				const command = event.ctrlKey || event.metaKey;
				// Copy with Ctrl/Cmd-C when something is selected, and always with Ctrl-Shift-C; otherwise Ctrl-C is the
				// interrupt it has always been.
				if (command && event.key.toLowerCase() === 'c' && (event.shiftKey || screen.hasSelection())) {
					void copySelection();
					return false;
				}
				return true;
			});
			screen.onSelectionChange(() => (hasSelection = screen.hasSelection()));

			let fitTimer: ReturnType<typeof setTimeout> | undefined;
			const refit = (): void => {
				// A hidden tab has no size to fit to.
				if (host == null || host.clientWidth === 0 || host.clientHeight === 0) return;
				fit.fit();
				handle?.resize(screen.cols, screen.rows);
			};
			fitNow = refit;
			const scheduleFit = (): void => {
				clearTimeout(fitTimer);
				fitTimer = setTimeout(refit, 40);
			};
			const observer = new ResizeObserver(scheduleFit);
			observer.observe(host);
			cleanups.push(() => {
				clearTimeout(fitTimer);
				observer.disconnect();
			});
			void document.fonts?.ready.then(scheduleFit);
			refit();

			// What keys type: the key bar's sticky modifiers apply to one real key, never to what the screen answers a
			// program's query with.
			screen.onData((data) => {
				const single = [...data].length === 1;
				handle?.write(single && (modifiers.ctrl || modifiers.alt) ? applyModifiers(data, modifiers) : data);
				if (single) {
					modifiers.ctrl = false;
					modifiers.alt = false;
				}
			});

			handle = backend.client.openTerminal({
				...(tab.session === undefined ? { prefix: tab.prefix ?? 'term' } : { session: tab.session }),
				...(tab.cwd === undefined ? {} : { cwd: tab.cwd }),
				cols: screen.cols,
				rows: screen.rows,
				// The backend paces on what the screen has drawn, not on what the socket has delivered.
				autoAcknowledge: false
			});
			const session = handle;
			sessionState = session.state;
			session.onState((next) => {
				sessionState = next;
				if (next.session !== undefined) onsession(next.session);
			});
			session.onOutput((bytes) => screen.write(bytes, () => session.processed(bytes.length)));
			session.onReset(() => screen.reset());
			terminalReady = true;
			if (active) screen.focus();
		})();

		return () => {
			disposed = true;
			for (const cleanup of cleanups) cleanup();
			void handle?.detach();
			term?.dispose();
			term = undefined;
			handle = undefined;
			terminalReady = false;
		};
	});

	// The theme: the page's own colours, again whenever the theme or the light/dark scheme changes.
	$effect(() => {
		void theme.current;
		if (!terminalReady) return;
		const apply = (): void => {
			if (term !== undefined) term.options.theme = currentTerminalColors();
		};
		apply();
		const observer = new MutationObserver(apply);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
		return () => observer.disconnect();
	});

	// Showing a tab: fit it (it had no size while hidden) and put the cursor in it.
	$effect(() => {
		if (!active || !terminalReady) return;
		const frame = requestAnimationFrame(() => {
			fitNow?.();
			term?.focus();
		});
		return () => cancelAnimationFrame(frame);
	});

	async function copySelection(): Promise<void> {
		const text = term?.getSelection() ?? '';
		if (text === '') return;
		try {
			await navigator.clipboard.writeText(text);
			term?.clearSelection();
		} catch {
			// The page may not be allowed to write the clipboard; the selection stays for a manual copy.
		}
	}

	async function pasteClipboard(): Promise<void> {
		try {
			const text = await navigator.clipboard.readText();
			if (text !== '') term?.paste(text);
		} catch {
			// Reading the clipboard needs the user's permission; without it there is nothing to paste.
		}
		term?.focus();
	}

	/** One key of the bar. A modifier toggles; the others type, with a waiting modifier applied. */
	function press(key: KeyBarKey): void {
		if (key.modifier !== undefined) {
			modifiers[key.modifier] = !modifiers[key.modifier];
			term?.focus();
			return;
		}
		const bytes =
			key.arrow !== undefined ? arrowBytes(key.arrow, term?.modes.applicationCursorKeysMode ?? false) : (key.bytes ?? '');
		handle?.write(key.arrow === undefined && key.bytes !== undefined && key.bytes.length === 1 ? applyModifiers(bytes, modifiers) : bytes);
		modifiers.ctrl = false;
		modifiers.alt = false;
		term?.focus();
	}

	const reconnecting = $derived(sessionState.status === 'reconnecting');
	const opening = $derived(sessionState.status === 'attaching');
	const finished = $derived(sessionState.status === 'ended' || sessionState.status === 'failed');
	const endedText = $derived.by(() => {
		if (sessionState.status === 'failed') return sessionState.error ?? 'This terminal could not be opened.';
		if (sessionState.endedReason === 'killed') return 'This session was ended.';
		if (sessionState.exitCode !== undefined && sessionState.exitCode !== 0) return `This session ended (exit code ${sessionState.exitCode}).`;
		return 'This session ended.';
	});
</script>

<div class="relative flex min-h-0 min-w-0 flex-1 flex-col" class:hidden={!active} data-terminal-tab={tab.id}>
	<div class="terminal-surface relative min-h-0 flex-1 overflow-hidden px-2 pt-1.5 pb-1 sm:px-3" bind:this={host} data-terminal-screen></div>

	{#if opening}
		<div class="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
			<span class="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
				<Spinner class="size-3" /> Opening a terminal…
			</span>
		</div>
	{:else if reconnecting}
		<div class="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
			<span class="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-(--chat-warning) shadow-sm" role="status">
				<Spinner class="size-3" /> Connection lost. Reattaching to the session…
			</span>
		</div>
	{/if}

	{#if finished}
		<!-- z-20: above xterm's own layers (helpers 5, decorations 6–8, scrollbar 11), which would otherwise take the clicks. -->
		<div class="absolute inset-0 z-20 grid place-items-center bg-background/70 p-4 backdrop-blur-[1px]">
			<div class="flex max-w-sm flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-lg" role="alert">
				<p class="text-sm">{endedText}</p>
				<div class="flex flex-wrap gap-2">
					{#if sessionState.status === 'ended'}
						<Button size="sm" onclick={onrestart}>Start a new session</Button>
					{/if}
					<Button size="sm" variant="outline" onclick={onclose}>Close tab</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if keyBar}
		<div
			class="flex shrink-0 flex-col gap-1 border-t border-border bg-card px-1.5 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
			role="toolbar"
			aria-label="Terminal keys"
			data-terminal-keybar
		>
			{#each KEY_BAR_ROWS as row, rowIndex (rowIndex)}
				<div class="flex gap-1">
					{#each row as key (key.id)}
						{@const sticky = key.modifier !== undefined && modifiers[key.modifier]}
						<button
							type="button"
							class="h-9 min-w-0 flex-1 touch-manipulation rounded-md border px-1 font-mono text-sm select-none {sticky
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border bg-background text-foreground active:bg-muted'}"
							aria-label={key.name}
							aria-pressed={key.modifier === undefined ? undefined : sticky}
							onpointerdown={(event) => event.preventDefault()}
							onclick={() => press(key)}
						>
							{key.label}
						</button>
					{/each}
					{#if rowIndex === KEY_BAR_ROWS.length - 1}
						<button
							type="button"
							class="grid h-9 min-w-0 flex-1 touch-manipulation place-items-center rounded-md border border-border bg-background active:bg-muted"
							aria-label="Paste"
							onpointerdown={(event) => event.preventDefault()}
							onclick={() => void pasteClipboard()}
						>
							<ClipboardPasteIcon class="size-4" />
						</button>
						<button
							type="button"
							class="grid h-9 min-w-0 flex-1 touch-manipulation place-items-center rounded-md border border-border bg-background active:bg-muted disabled:opacity-40"
							aria-label="Copy the selection"
							disabled={!hasSelection}
							onpointerdown={(event) => event.preventDefault()}
							onclick={() => void copySelection()}
						>
							<CopyIcon class="size-4" />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* The screen takes the page's own background so the terminal is part of the page, not a box on it. */
	.terminal-surface {
		background: var(--background);
	}
	.terminal-surface :global(.xterm) {
		height: 100%;
	}
	.terminal-surface :global(.xterm-viewport) {
		background-color: transparent !important;
	}
</style>
