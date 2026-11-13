/**
 * Dialog shapes the app shares: a roomy dialog with one scroll region, and how big an artifact's dialog grows.
 *
 * `Dialog.Content` is a centred follower of the shadcn defaults (a `grid` with padding, capped at `sm:max-w-md`), so
 * a dialog that holds a form, a catalogue and a footer overrides that: it becomes a column whose header and footer stay
 * put while one region between them scrolls. `cn` (tailwind-merge) drops the conflicting defaults.
 */

/**
 * A roomy dialog: one `min(…rem, calc(100vw - 2rem))` column, at most `min(90dvh, 52rem)` tall, with a single scroll
 * region between a fixed header and footer. It stays a normal, narrow dialog: long text inside wraps instead of forcing
 * it wider (`mcpservers` descriptions, URLs and commands all break). `wide` is for a dialog holding JSON or a review
 * list.
 */
export function roomyDialogClass(options: { wide?: boolean } = {}): string {
	const width = options.wide === true ? "w-[min(36rem,calc(100vw-2rem))]" : "w-[min(32rem,calc(100vw-2rem))]";
	return `flex max-h-[min(90dvh,52rem)] ${width} max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none`;
}

/** The top of a roomy dialog: after it, nothing scrolls. `pr-14` keeps the close button's corner free. */
export const DIALOG_HEADER_CLASS = "shrink-0 gap-1 border-b border-(--chat-border) px-5 pt-4 pr-14 pb-3";
/** The single scroll region of a roomy dialog. */
export const DIALOG_SCROLL_CLASS = "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4";
/** The bottom of a roomy dialog: still there when the scroll region is long. */
export const DIALOG_FOOTER_CLASS = "shrink-0 border-t border-(--chat-border) px-5 py-3";

/**
 * An artifact dialog's size. A Markdown page may grow to `min(90dvh, 64rem)` tall and an HTML page is also wider, up to
 * `min(75rem, 92vw)`; every other kind keeps the size it had.
 */
export function artifactDialogSizing(kind: { markdown?: boolean; html?: boolean }): string {
	if (kind.html === true) return "w-[min(75rem,92vw)] max-h-[min(90dvh,64rem)] max-w-none sm:max-w-none";
	if (kind.markdown === true) return "w-[min(60rem,92vw)] max-h-[min(90dvh,64rem)] max-w-none sm:max-w-none";
	return "w-[min(56rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] max-w-none sm:max-w-none";
}
