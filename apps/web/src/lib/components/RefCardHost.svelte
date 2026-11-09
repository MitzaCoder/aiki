<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { type RefDetails, refIdentity } from '@mihai-harness/protocol';
	import RefCard from '#lib/components/RefCard.svelte';
	import { type CardRef, boardRefFor, cardKindWords, cardRefLabel, cardRefOf, containsTarget, placeCard, tasksNaming, visiblePart } from '#lib/ref-card.js';
	import { useRefLinks } from '#lib/ref-links.svelte.js';
	import { useTaskLinks } from '#lib/task-links.svelte.js';

	/**
	 * The cards of tickets and pull requests on a project screen. One host listens to the whole page, so every link to a
	 * pull request, issue or Jira ticket gets a card wherever it renders: ref chips on rows and board cards, the task
	 * sheet, links in chat replies, reports and user messages. With a mouse the card opens after a short hover and stays
	 * while the pointer is on it; keyboard focus opens it too and Escape closes it; the link's click still opens
	 * GitHub or Jira. On a touch screen a tap opens the card instead, and its Open button goes on. Inside a dialog (the
	 * task sheet) the card is placed in the dialog, so the dialog's focus trap and outside clicks leave it alone.
	 */
	let {
		readDetails,
		tasks = () => []
	}: {
		/** Reads a ref's details from the backend; absent when it cannot (`ref-details`), and the card says what is known. */
		readDetails?: (ref: string) => Promise<RefDetails | null>;
		tasks?: () => readonly { id: string; title: string; status: string; refs?: readonly string[] }[];
	} = $props();

	const refLinks = useRefLinks();
	const taskLinks = useTaskLinks();

	const HOVER_OPEN_MS = 400;
	/** Moving from one link to the next while a card is open swaps sooner. */
	const SWAP_OPEN_MS = 150;
	const FOCUS_OPEN_MS = 250;
	const CLOSE_MS = 250;
	/** How long a read stays good before a card that opens again asks the backend once more (it caches too). */
	const DETAILS_FRESH_MS = 60_000;
	const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	type Shown = { anchor: HTMLAnchorElement; ref: CardRef; href: string; container: HTMLElement; via: 'hover' | 'focus' | 'tap' };

	let shown = $state<Shown | undefined>(undefined);
	/** Svelte sets a `bind:this` back to `null` when the card closes, so test with `== null`, never `=== undefined`. */
	let card = $state<HTMLDivElement | null>(null);
	/** Where the card's box is drawn, in its containing block's coordinates; hidden until first measured. */
	let place = $state<{ x: number; y: number; maxHeight: number; side: 'below' | 'above'; ready: boolean }>({ x: 0, y: 0, maxHeight: 0, side: 'below', ready: false });
	const cache = new SvelteMap<string, { details: RefDetails | null; at: number }>();
	const loading = new SvelteSet<string>();
	const reading = new Set<string>();
	const cardId = `ref-card-${Math.random().toString(36).slice(2, 8)}`;

	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingAnchor: HTMLAnchorElement | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	let lastPointer = { type: '', at: 0 };
	let pointerDownInCardAt = 0;
	/** The link focus goes back to when its card closes, which should not open the card again. */
	let refocusing: HTMLAnchorElement | undefined;
	let frame = 0;

	const identity = $derived(shown === undefined ? undefined : refIdentity(shown.ref));
	const cached = $derived(identity === undefined ? undefined : cache.get(identity));
	const details = $derived(cached?.details ?? undefined);
	const isLoading = $derived(identity !== undefined && loading.has(identity));
	const status = $derived.by(() => {
		if (shown === undefined) return undefined;
		const current = refLinks();
		const boardRef = boardRefFor(shown.ref, tasks().flatMap((task) => task.refs ?? []), current?.links);
		return boardRef === undefined ? undefined : current?.status(boardRef);
	});
	const naming = $derived(shown === undefined ? [] : tasksNaming(shown.ref, tasks(), refLinks()?.links));
	const cardHref = $derived(details?.url ?? status?.url ?? shown?.href ?? '');

	function refAnchor(target: EventTarget | null): HTMLAnchorElement | undefined {
		if (!(target instanceof Element) || target.closest('[data-ref-card]') !== null) return undefined;
		const anchor = target.closest('a[href]');
		if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('data-no-ref-card')) return undefined;
		return cardRefOf(anchor.href) === undefined ? undefined : anchor;
	}

	function inCard(target: EventTarget | null): boolean {
		return target instanceof Node && containsTarget(card, target);
	}

	function clearOpen(): void {
		clearTimeout(openTimer);
		openTimer = undefined;
		pendingAnchor = undefined;
	}

	function clearClose(): void {
		clearTimeout(closeTimer);
		closeTimer = undefined;
	}

	function scheduleOpen(anchor: HTMLAnchorElement, via: Shown['via'], delay: number): void {
		if (pendingAnchor === anchor) return;
		clearOpen();
		pendingAnchor = anchor;
		openTimer = setTimeout(() => {
			pendingAnchor = undefined;
			if (anchor.isConnected) show(anchor, via);
		}, delay);
	}

	function scheduleClose(delay = CLOSE_MS): void {
		clearClose();
		closeTimer = setTimeout(() => close(), delay);
	}

	function show(anchor: HTMLAnchorElement, via: Shown['via']): void {
		const ref = cardRefOf(anchor.href);
		if (ref === undefined) return;
		clearOpen();
		clearClose();
		if (shown?.anchor === anchor) {
			shown = { ...shown, via: shown.via === 'hover' ? via : shown.via };
			return;
		}
		release();
		const container = anchor.closest<HTMLElement>('[data-slot="dialog-content"]') ?? document.body;
		place = { ...place, ready: false };
		shown = { anchor, ref, href: anchor.href, container, via };
		anchor.setAttribute('aria-expanded', 'true');
		anchor.setAttribute('aria-controls', cardId);
		load(ref, anchor.href);
	}

	/** Gives the link back its own attributes. */
	function release(): void {
		shown?.anchor.removeAttribute('aria-expanded');
		shown?.anchor.removeAttribute('aria-controls');
	}

	function close(options: { focusLink?: boolean } = {}): void {
		clearOpen();
		clearClose();
		if (shown === undefined) return;
		const anchor = shown.anchor;
		release();
		shown = undefined;
		if (options.focusLink === true && anchor.isConnected) {
			refocusing = anchor;
			anchor.focus();
			refocusing = undefined;
		}
	}

	function load(ref: CardRef, href: string): void {
		if (readDetails === undefined) return;
		const id = refIdentity(ref);
		const known = cache.get(id);
		if ((known !== undefined && Date.now() - known.at < DETAILS_FRESH_MS) || reading.has(id)) return;
		reading.add(id);
		loading.add(id);
		readDetails(href)
			.then((found) => {
				// A failed read later keeps what an earlier one found; "nothing found" replaces it.
				cache.set(id, { details: found, at: Date.now() });
			})
			.catch(() => {})
			.finally(() => {
				reading.delete(id);
				loading.delete(id);
			});
	}

	/** Puts the card by its link, inside what holds it, and closes it when the link is gone or scrolled away. */
	function reposition(): void {
		frame = 0;
		if (shown === undefined || card == null) return;
		const anchor = shown.anchor;
		if (!anchor.isConnected) return close();
		const rects = anchor.getClientRects();
		const rect = rects.length > 0 ? rects[0]! : anchor.getBoundingClientRect();
		const viewport = { width: window.innerWidth, height: window.innerHeight };
		const holder = shown.container === document.body ? undefined : shown.container.getBoundingClientRect();
		const bounds = visiblePart(holder === undefined ? undefined : { left: holder.left, top: holder.top, width: holder.width, height: holder.height }, viewport);
		const anchorBox = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
		const outside =
			anchorBox.top + anchorBox.height < bounds.top ||
			anchorBox.top > bounds.top + bounds.height ||
			anchorBox.left + anchorBox.width < bounds.left ||
			anchorBox.left > bounds.left + bounds.width;
		if (outside || (rect.width === 0 && rect.height === 0)) return close();
		const maxHeight = Math.max(160, bounds.height - 16);
		// The card is `position: fixed`, but a transformed dialog becomes its containing block: measure where (0, 0) is.
		const drawn = card.getBoundingClientRect();
		const originX = drawn.left - place.x;
		const originY = drawn.top - place.y;
		const target = placeCard(anchorBox, { width: drawn.width, height: Math.min(drawn.height, maxHeight) }, bounds);
		place = { x: Math.round(target.left - originX), y: Math.round(target.top - originY), maxHeight, side: target.side, ready: true };
	}

	function requestReposition(): void {
		if (frame === 0) frame = requestAnimationFrame(reposition);
	}

	// Placed when it opens and whenever its content (the details arriving) changes its size.
	$effect(() => {
		const element = card;
		if (element == null || shown === undefined) return;
		void shown.anchor;
		requestReposition();
		const observer = new ResizeObserver(() => requestReposition());
		observer.observe(element);
		return () => observer.disconnect();
	});

	function portal(node: HTMLElement, target: HTMLElement) {
		target.appendChild(node);
		return {
			update(next: HTMLElement) {
				if (node.parentElement !== next) next.appendChild(node);
			},
			destroy() {
				node.remove();
			}
		};
	}

	function tabbables(root: ParentNode): HTMLElement[] {
		return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => element.getClientRects().length > 0);
	}

	onMount(() => {
		const onPointerOver = (event: PointerEvent): void => {
			if (event.pointerType === 'touch') return;
			if (inCard(event.target)) {
				clearClose();
				return;
			}
			const anchor = refAnchor(event.target);
			if (anchor === undefined) return;
			if (shown?.anchor === anchor) clearClose();
			else if (event.buttons === 0) scheduleOpen(anchor, 'hover', shown === undefined ? HOVER_OPEN_MS : SWAP_OPEN_MS);
		};
		const onPointerOut = (event: PointerEvent): void => {
			if (event.pointerType === 'touch') return;
			const to = event.relatedTarget;
			if (pendingAnchor !== undefined && !(to instanceof Node && pendingAnchor.contains(to)) && pendingAnchor.contains(event.target as Node)) clearOpen();
			if (shown === undefined || shown.via !== 'hover') return;
			const from = event.target as Node;
			const leaving = shown.anchor.contains(from) || inCard(from);
			const staying = (to instanceof Node && shown.anchor.contains(to)) || inCard(to);
			if (leaving && !staying) scheduleClose();
		};
		const onPointerDown = (event: PointerEvent): void => {
			lastPointer = { type: event.pointerType, at: Date.now() };
			if (inCard(event.target)) {
				pointerDownInCardAt = Date.now();
				return;
			}
			if (shown !== undefined && !(event.target instanceof Node && shown.anchor.contains(event.target))) close();
		};
		const onClick = (event: MouseEvent): void => {
			const anchor = refAnchor(event.target);
			if (anchor === undefined) return;
			const type = (event as PointerEvent).pointerType;
			const touch = type === 'touch' || (type === undefined && lastPointer.type === 'touch' && Date.now() - lastPointer.at < 1000);
			if (!touch) {
				// A click opens GitHub or Jira in a new tab, as before; the card has done its job.
				close();
				return;
			}
			event.preventDefault();
			if (shown?.anchor === anchor) close();
			else show(anchor, 'tap');
		};
		const onFocusIn = (event: FocusEvent): void => {
			if (inCard(event.target)) {
				clearClose();
				return;
			}
			const anchor = refAnchor(event.target);
			if (anchor === undefined || anchor === refocusing || shown?.anchor === anchor || !anchor.matches(':focus-visible')) return;
			scheduleOpen(anchor, 'focus', FOCUS_OPEN_MS);
		};
		const onFocusOut = (event: FocusEvent): void => {
			if (pendingAnchor !== undefined && event.target === pendingAnchor) clearOpen();
			if (shown === undefined || shown.via !== 'focus') return;
			const to = event.relatedTarget;
			if (to === shown.anchor || inCard(to) || Date.now() - pointerDownInCardAt < 500) return;
			scheduleClose(120);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (shown === undefined) return;
			const active = document.activeElement;
			if (event.key === 'Escape') {
				// Only the card closes, not a dialog it sits in.
				event.preventDefault();
				event.stopPropagation();
				close({ focusLink: active === shown.anchor || inCard(active) });
				return;
			}
			if (event.key !== 'Tab' || card == null) return;
			const inside = tabbables(card);
			if (active === shown.anchor && !event.shiftKey && inside.length > 0) {
				event.preventDefault();
				shown = { ...shown, via: shown.via === 'hover' ? 'focus' : shown.via };
				inside[0]!.focus();
				return;
			}
			if (!inCard(active)) return;
			if (event.shiftKey && active === inside[0]) {
				event.preventDefault();
				shown.anchor.focus();
			} else if (!event.shiftKey && active === inside.at(-1)) {
				// Past the card's last control, on to whatever follows its link.
				event.preventDefault();
				const anchor = shown.anchor;
				const scope = shown.container === document.body ? document : shown.container;
				const order = tabbables(scope).filter((element) => !inCard(element));
				const next = order[order.indexOf(anchor) + 1];
				close();
				(next ?? anchor).focus();
			}
		};
		const onScroll = (): void => {
			if (shown !== undefined) requestReposition();
		};
		window.addEventListener('pointerover', onPointerOver, true);
		window.addEventListener('pointerout', onPointerOut, true);
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('click', onClick, true);
		window.addEventListener('focusin', onFocusIn, true);
		window.addEventListener('focusout', onFocusOut, true);
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('scroll', onScroll, { capture: true, passive: true });
		window.addEventListener('resize', onScroll);
		return () => {
			close();
			cancelAnimationFrame(frame);
			window.removeEventListener('pointerover', onPointerOver, true);
			window.removeEventListener('pointerout', onPointerOut, true);
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('click', onClick, true);
			window.removeEventListener('focusin', onFocusIn, true);
			window.removeEventListener('focusout', onFocusOut, true);
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('scroll', onScroll, { capture: true });
			window.removeEventListener('resize', onScroll);
		};
	});
</script>

{#if shown !== undefined}
	<div
		bind:this={card}
		use:portal={shown.container}
		id={cardId}
		data-ref-card
		role="dialog"
		aria-label="{cardKindWords(shown.ref, details, status)} {cardRefLabel(shown.ref)}"
		class="ref-card fixed z-[60] w-[22rem] max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-(--chat-border) bg-popover text-popover-foreground shadow-lg ring-1 ring-black/5"
		style="left: {place.x}px; top: {place.y}px; max-height: {place.maxHeight > 0 ? `${place.maxHeight}px` : 'calc(100dvh - 1rem)'}; visibility: {place.ready
			? 'visible'
			: 'hidden'}"
		data-side={place.side}
	>
		{#key shown.anchor}
			<div class="ref-card-in" class:ref-card-ready={place.ready}>
				<RefCard
					cardRef={shown.ref}
					href={cardHref}
					{details}
					{status}
					loading={isLoading}
					tasks={naming}
					taskHref={taskLinks()?.href}
					onleave={() => close()}
				/>
			</div>
		{/key}
	</div>
{/if}

<style>
	.ref-card-in {
		opacity: 0;
	}
	.ref-card-in.ref-card-ready {
		animation: ref-card-in 120ms ease-out both;
	}
	:global([data-side='above']) > .ref-card-in.ref-card-ready {
		animation-name: ref-card-in-above;
	}
	@keyframes ref-card-in {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes ref-card-in-above {
		from {
			opacity: 0;
			transform: translateY(3px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
