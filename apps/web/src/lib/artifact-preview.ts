/**
 * An HTML artifact opened in its own browser tab.
 *
 * The artifact bytes already travel over a signed, short-lived URL, but the browser must not render them on the app's
 * origin: a `blob:` URL made by the page inherits that origin, so an artifact HTML document opened directly from one
 * could read the app's storage or call its backend. Instead the tab shows a small page this app writes, holding the
 * artifact in an `<iframe sandbox>`: an empty `sandbox` attribute gives it an opaque origin, no scripts, no forms and no
 * popups, which is the same restriction the backend puts on these artifacts over HTTP (`Content-Security-Policy:
 * sandbox`). Nothing of the artifact is ever parsed into the app's own document.
 */
import type { Artifact } from "@aiki/protocol";

/**
 * The frame's sandbox tokens: none. An empty attribute is already an opaque origin with scripts, forms, popups and
 * top-level navigation off; adding `allow-same-origin` or `allow-scripts` would hand the artifact the app's origin.
 */
export const ARTIFACT_FRAME_SANDBOX = "";

/** Whether a text artifact is an HTML page, by its type or its name. */
export function isHtmlArtifact(artifact: Pick<Artifact, "name" | "mimeType">): boolean {
	const mimeType = artifact.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (mimeType === "text/html" || mimeType === "application/xhtml+xml") return true;
	return /\.(html|htm|xhtml)$/i.test(artifact.name);
}

/** Text for the wrapper's markup and its title: the artifact's own name is never interpreted. */
export function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/**
 * The page a new tab shows: a bar naming the artifact, and the artifact in a sandboxed frame that fills the window.
 * `frameUrl` is a `blob:` URL of its bytes, so nothing but that frame ever holds them.
 */
export function sandboxedArtifactDocument(frameUrl: string, name: string): string {
	const title = escapeHtml(name);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
	html, body { height: 100%; margin: 0; }
	body { display: flex; flex-direction: column; font: 13px/1.4 system-ui, sans-serif; background: #f4f1ea; color: #1c1a16; }
	header { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem 1rem; padding: .5rem .75rem; border-bottom: 1px solid #d8d2c4; }
	header strong { font-weight: 600; overflow-wrap: anywhere; }
	header span { color: #6b6459; }
	main { flex: 1 1 auto; min-height: 0; }
	iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
	@media (prefers-color-scheme: dark) { body { background: #1c1a16; color: #f4f1ea; } header { border-color: #3a352c; } header span { color: #a89f90; } }
</style>
</head>
<body>
<header><strong>${title}</strong><span>Sandboxed artifact: scripts, forms and pop-ups are off, and this page cannot read the app's storage.</span></header>
<main><iframe title="${title}" sandbox="${ARTIFACT_FRAME_SANDBOX}" referrerpolicy="no-referrer" src="${escapeHtml(frameUrl)}"></iframe></main>
</body>
</html>`;
}

/**
 * Open `content` as an HTML page in a new tab, sandboxed inside the wrapper above. False when the browser refused the
 * tab (a pop-up blocker), which the caller explains. `window` and `URL` are taken as arguments for tests.
 */
export function openArtifactPreview(
	content: string,
	name: string,
	options: { open?: (url: string) => Window | null; createUrl?: (blob: Blob) => string } = {},
): boolean {
	const createUrl = options.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
	const open = options.open ?? ((url: string) => window.open(url, "_blank"));
	const frameUrl = createUrl(new Blob([content], { type: "text/html" }));
	const tab = open(createUrl(new Blob([sandboxedArtifactDocument(frameUrl, name)], { type: "text/html" })));
	if (tab === null) return false;
	// The wrapper may not reach back into the app's window.
	try {
		tab.opener = null;
	} catch {
		// Cross-origin windows refuse it; the wrapper has no script, so nothing can use the handle.
	}
	return true;
}
