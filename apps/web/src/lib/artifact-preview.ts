/**
 * An HTML artifact shown as a page, in the viewer's dialog or in a tab of its own.
 *
 * An HTML artifact is a report a worker wrote, so it is meant to be seen rendered, and those reports use scripts for
 * charts and counters. The artifact must still not run on the app's origin: a `blob:` URL or `srcdoc` made by the page
 * inherits that origin, so a document rendered there could read the app's storage or call its backend with its
 * credentials. Every frame therefore gets `ARTIFACT_FRAME_SANDBOX`: scripts and pop-ups are allowed, `allow-same-origin`
 * never is, which leaves the document in an opaque origin — its own storage is empty and thrown away with it, its
 * requests are cross-origin without cookies, and it cannot reach this page's DOM. An optional per-project CSP
 * additionally denies connections and forms (off by default for existing reports). Allowed image/media/CDN requests
 * and external links still have outgoing channels; it is not an offline guarantee. Nothing of the artifact is ever
 * parsed into the app's own document.
 */
import type { Artifact } from "@aiki/protocol";
import { artifactPageDocument, artifactThemeCss, readArtifactTheme, type ArtifactPageTheme } from "./artifact-page.ts";

/**
 * The sandbox both frames carry — the dialog's page and the new tab's. The same tokens in both places, so neither can
 * drift into being more permissive than the other. `allow-same-origin` must never be added: with it the artifact would
 * share the app's origin, and `allow-scripts` would let it read the app's storage and call the backend as the reader.
 */
export const ARTIFACT_FRAME_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

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
export function sandboxedArtifactDocument(frameUrl: string, name: string, theme?: ArtifactPageTheme): string {
	const title = escapeHtml(name);
	return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme.mode}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
	${theme ? artifactThemeCss(theme) : ""}
	html, body { height: 100%; margin: 0; }
	body { display: flex; flex-direction: column; font: 13px/1.4 system-ui, sans-serif; background: var(--tone-bg, #f4f1ea); color: var(--tone-fg, #1c1a16); }
	header { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem 1rem; padding: .5rem .75rem; border-bottom: 1px solid var(--tone-border, #d8d2c4); }
	header strong { font-weight: 600; overflow-wrap: anywhere; }
	header span { color: var(--tone-fg-muted, #6b6459); }
	main { flex: 1 1 auto; min-height: 0; }
	iframe { display: block; width: 100%; height: 100%; border: 0; background: var(--tone-bg, #fff); }
	@media (prefers-color-scheme: dark) { body { background: var(--tone-bg, #1c1a16); color: var(--tone-fg, #f4f1ea); } header { border-color: var(--tone-border, #3a352c); } header span { color: var(--tone-fg-muted, #a89f90); } }
</style>
</head>
<body>
<header><strong>${title}</strong><span>Sandboxed artifact: it runs in its own origin, so it cannot read the app's storage or act as you.</span></header>
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
	options: { open?: (url: string) => Window | null; createUrl?: (blob: Blob) => string; theme?: ArtifactPageTheme; blockRequests?: boolean } = {},
): boolean {
	const createUrl = options.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
	const open = options.open ?? ((url: string) => window.open(url, "_blank"));
	const theme = options.theme ?? (typeof document === "undefined" ? { mode: "light" as const, tokens: {} } : readArtifactTheme());
	const frameUrl = createUrl(new Blob([artifactPageDocument(content, theme, options.blockRequests)], { type: "text/html" }));
	const tab = open(createUrl(new Blob([sandboxedArtifactDocument(frameUrl, name, theme)], { type: "text/html" })));
	if (tab === null) return false;
	// The wrapper may not reach back into the app's window.
	try {
		tab.opener = null;
	} catch {
		// Cross-origin windows refuse it; the wrapper has no script, so nothing can use the handle.
	}
	return true;
}
