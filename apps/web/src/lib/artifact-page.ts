/** Theme defaults for an opaque-origin artifact, never markup in the host document. */
export const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://cdnjs.cloudflare.com; img-src data: blob: https:; font-src data: https://cdnjs.cloudflare.com; media-src data: blob: https:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export const ARTIFACT_TOKEN_NAMES = [
	"tone-bg", "tone-surface", "tone-surface-2", "tone-border", "tone-border-strong", "tone-fg", "tone-fg-muted", "tone-fg-subtle",
	"tone-primary", "tone-primary-fg", "tone-accent-1", "tone-accent-2", "tone-accent-3", "tone-accent-4", "tone-danger", "tone-success", "tone-warning", "tone-ring", "tone-radius",
	"font-sans", "font-mono", "text-task", "text-task-sm", "spacing",
] as const;
export type ArtifactPageTheme = { mode: "light" | "dark"; tokens: Record<string, string> };

/** Only app-owned computed variables are copied, not arbitrary author CSS. */
export function readArtifactTheme(root: HTMLElement = document.documentElement): ArtifactPageTheme {
	const style = getComputedStyle(root);
	return { mode: root.classList.contains("dark") ? "dark" : "light", tokens: Object.fromEntries(ARTIFACT_TOKEN_NAMES.map((name) => [name, style.getPropertyValue(`--${name}`).trim()])) };
}

/** Safe app-owned CSS defaults shared by the frame and its new-tab shell. */
export function artifactThemeCss(theme: ArtifactPageTheme): string {
	const tokens = ARTIFACT_TOKEN_NAMES.map((name) => {
		// Defensive even though these values come from our own computed stylesheet.
		const value = theme.tokens[name]?.replace(/[<>{};]/g, "");
		return value ? `--${name}:${value};` : "";
	}).join("");
	return `:where(:root){${tokens}color-scheme:${theme.mode}}`;
}

/** First-in-head policy, low-specificity defaults, and a Print button; source/copy/download bytes stay untouched. */
export function artifactPageDocument(content: string, theme: ArtifactPageTheme, blockRequests = false): string {
	const prelude = `${blockRequests ? `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">` : ""}
<style data-aiki-artifact-prelude>
${artifactThemeCss(theme)}
:where(body){background:var(--tone-bg);color:var(--tone-fg);font:16px/1.6 var(--font-sans,system-ui,sans-serif)}
:where(a){color:var(--tone-primary)}
#aiki-artifact-print{position:fixed;right:12px;bottom:12px;z-index:2147483647;border:1px solid var(--tone-border,#ccc);border-radius:999px;background:var(--tone-surface,#fff);color:var(--tone-fg,#111);padding:8px 16px;font:14px/1.4 system-ui;cursor:pointer;box-shadow:0 2px 12px #0002}
@media print{#aiki-artifact-print{display:none!important}:where(body){background:white;color:black}img,video,svg{max-width:100%}pre{white-space:pre-wrap}h1,h2,h3{break-after:avoid}figure,tr{break-inside:avoid}}
</style>
<script>(function(){function add(){var b=document.createElement('button');b.id='aiki-artifact-print';b.type='button';b.textContent='Print';b.setAttribute('aria-label','Print this artifact');b.onclick=function(){window.print()};document.body.appendChild(b)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add()})();</script>`;
	const source = content.replace(/^\s*<!doctype[^>]*>/i, "");
	// Only recognize an opening document tag, never an apparent <head> inside author script/text. Even a malformed
	// document with a script before its head receives the CSP before that script can run.
	const opening = /^\s*<html\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/i.exec(source);
	// Consume whole attributes, not a data-theme-looking substring inside another attribute's quoted value.
	const attributes = (opening?.[1] ?? "").replace(/\s+([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g,
		(attribute, name: string) => name.toLowerCase() === "data-theme" ? "" : attribute);
	let remainder = opening ? source.slice(opening[0].length) : source;
	const head = /^\s*<head\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(remainder);
	remainder = head ? `${head[0]}${prelude}${remainder.slice(head[0].length)}` : `<head>${prelude}</head>${remainder}`;
	return `<!doctype html><html${attributes} data-theme="${theme.mode}">${remainder}${opening ? "" : "</html>"}`;
}
