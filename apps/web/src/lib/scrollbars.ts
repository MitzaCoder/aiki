import { OverlayScrollbars, type PartialOptions } from 'overlayscrollbars';
import type { Action } from 'svelte/action';

const OPTIONS: PartialOptions = {
	// Every update re-measures the whole subtree; a streaming chat changes it every frame, so measure only now and then.
	update: { debounce: { mutation: [600, 4000], resize: [600, 4000], event: [33, 99], env: [222, 666, true] } },
	scrollbars: { theme: 'os-theme-harness', autoHide: 'scroll', autoHideDelay: 700 }
};

/** What a reader does at a scroller before it matters that it has overlay scrollbars. */
const FIRST_USE = ['pointerover', 'pointermove', 'wheel', 'scroll', 'focusin'] as const;

/** Touch devices already draw native overlay scrollbars; leave those alone. */
export function usesNativeScrollbars(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function overflowOf(value: string): 'scroll' | 'hidden' {
	return value === 'hidden' || value === 'clip' ? 'hidden' : 'scroll';
}

/**
 * Where the scrollbars are drawn. `inside` appends them to the scroller itself, so they scroll with the content and
 * the library moves them back from a scroll handler, one frame late: while the page is busy they visibly jump. `parent`
 * appends them to the scroller's parent, which does not scroll; use it where the parent is `relative` and the scroller
 * wraps it exactly: `relative` on the wrapper, the scroller inside. A scroller that fills a flex area takes
 * `<div class="relative flex min-h-0 flex-1 flex-col">` around it; a content-sized one (`max-h-*`) a plain
 * `<div class="relative">`. Use `inside` only where there is no such parent (`overlayScrollWithin`).
 */
type ScrollbarSlot = 'inside' | 'parent';

/**
 * Sets the overlay scrollbars up on first use rather than on mount: creating one measures the layout, which adds up on
 * a long chat with a scroller in every code block. Until then the native scrollbar is hidden, so nothing flashes.
 * Returns what undoes it.
 */
function attachOnFirstUse(
	element: HTMLElement,
	slot: ScrollbarSlot = 'inside',
	autoHide: 'scroll' | 'leave' = 'scroll'
): () => void {
	if (usesNativeScrollbars()) return () => {};
	element.setAttribute('data-overlayscrollbars-initialize', '');
	let instance: ReturnType<typeof OverlayScrollbars> | undefined;
	const stopListening = (): void => {
		for (const type of FIRST_USE) element.removeEventListener(type, attach, true);
	};
	function attach(): void {
		stopListening();
		const style = getComputedStyle(element);
		instance = OverlayScrollbars(
			{
				target: element,
				elements: { viewport: element },
				// `undefined` means the library's default place; `null` would mean no scrollbars at all.
				scrollbars: { slot: slot === 'parent' && element.parentElement ? element.parentElement : undefined }
			},
			{
				...OPTIONS,
				scrollbars: { ...OPTIONS.scrollbars, autoHide },
				overflow: { x: overflowOf(style.overflowX), y: overflowOf(style.overflowY) }
			}
		);
	}
	for (const type of FIRST_USE) element.addEventListener(type, attach, { capture: true, passive: true });
	return () => {
		stopListening();
		instance?.destroy();
		element.removeAttribute('data-overlayscrollbars-initialize');
	};
}

/**
 * Replaces the native scrollbars of a scroll container with themed overlay ones that take no layout space. The
 * element stays its own scroller (`scrollTop`, `scrollTo` and `onscroll` work on it as before) and which axes scroll
 * is read from its CSS `overflow`.
 */
export const overlayScroll: Action<HTMLElement, ScrollbarSlot | undefined> = (element, slot) => ({
	destroy: attachOnFirstUse(element, slot)
});

/**
 * The same for scroll containers inside rendered HTML (code blocks, tables) that Svelte does not own. `autoHide`
 * `leave` keeps the scrollbar visible while the pointer is over the scroller, for one that scrolls sideways where the
 * wheel does not (code blocks).
 */
export const overlayScrollWithin: Action<HTMLElement, string | { selector: string; autoHide: 'scroll' | 'leave' }> = (
	root,
	parameter
) => {
	const { selector, autoHide } = typeof parameter === 'string' ? { selector: parameter, autoHide: 'scroll' as const } : parameter;
	const detach = new Map<Element, () => void>();
	const sync = (): void => {
		for (const [element, undo] of detach) {
			if (element.isConnected) continue;
			undo();
			detach.delete(element);
		}
		for (const element of root.querySelectorAll<HTMLElement>(selector)) {
			if (!detach.has(element)) detach.set(element, attachOnFirstUse(element, 'inside', autoHide));
		}
	};
	const observer = new MutationObserver(sync);
	observer.observe(root, { childList: true, subtree: true });
	sync();
	return {
		destroy: () => {
			observer.disconnect();
			for (const undo of detach.values()) undo();
			detach.clear();
		}
	};
};
