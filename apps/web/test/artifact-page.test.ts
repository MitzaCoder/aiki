import { runInNewContext } from "node:vm";
import { expect, test } from "bun:test";
import { openArtifactPreview, sandboxedArtifactDocument } from "../src/lib/artifact-preview.ts";
import { artifactPageDocument, ARTIFACT_CSP, ARTIFACT_TOKEN_NAMES } from "../src/lib/artifact-page.ts";

test("the new-tab shell and its opaque frame receive the same app theme and policy", async () => {
	const blobs: Blob[] = [];
	openArtifactPreview('<h1>Report</h1>', 'Report', { theme, blockRequests: true, createUrl(blob) { blobs.push(blob); return `blob:example-${blobs.length}`; }, open() { return { opener: null } as Window; } });
	expect(await blobs[0]!.text()).toContain('Content-Security-Policy');
	const shell = await blobs[1]!.text();
	expect(shell).toContain('data-theme="dark"');
	expect(shell).toContain('--tone-bg:#09090f');
	expect(shell).not.toContain('allow-same-origin');
	expect(sandboxedArtifactDocument('blob:example', 'Report', theme)).toContain('var(--tone-bg');
});

const theme = { mode: "dark" as const, tokens: { "tone-bg": "#09090f", "tone-fg": "#ecebf5", "tone-radius": ".875rem", "font-sans": "system-ui" } };

test("prelude preserves author HTML, supplies zero-specificity tokens, explicit mode and Print", () => {
	const html = artifactPageDocument('<!doctype html><html lang="en" data-theme="light"><head><style>body{color:red}</style></head><body><h1>Report</h1></body></html>', theme);
	expect(html).toStartWith('<!doctype html><html lang="en" data-theme="dark">');
	expect(html).toContain(":where(:root){--tone-bg:#09090f;");
	expect(html).toContain("--tone-fg:#ecebf5;");
	expect(html).toContain("--tone-radius:.875rem;");
	expect(html).toContain("<style>body{color:red}</style>");
	expect(html).toContain("window.print()");
	expect(html).toContain("Print this artifact");
	expect(html).toContain("@media print");
	expect(html).not.toContain("Content-Security-Policy");
	expect(ARTIFACT_TOKEN_NAMES).toContain("spacing");
});

test("quoted angle brackets and theme-like attribute text cannot swallow the prelude", async () => {
	const source = `<html lang="en" data-note=" data-theme='light' >"><head data-note=">"><script>fetch('https://example.com')</script></head><body>Report</body></html>`;
	const html = artifactPageDocument(source, theme, true);
	let parsedTheme = '', policy = '';
	await new HTMLRewriter().on('html', { element(e) { parsedTheme = e.getAttribute('data-theme') ?? ''; } }).on('meta[http-equiv="Content-Security-Policy"]', { element(e) { policy = e.getAttribute('content') ?? ''; } }).transform(new Response(html)).text();
	expect(parsedTheme).toBe('dark');
	expect(policy).toBe(ARTIFACT_CSP);
	expect(html).toContain(`data-note=" data-theme='light' >"`);
	expect(html.indexOf(ARTIFACT_CSP)).toBeLessThan(html.indexOf("<script>fetch"));
});

test("CSP is opt-in and precedes all artifact content, including an author's attempted policy", () => {
	const html = artifactPageDocument('<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>Example</body></html>', theme, true);
	expect(html).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`);
	expect(ARTIFACT_CSP).toContain("connect-src 'none'");
	expect(ARTIFACT_CSP).toContain("form-action 'none'");
	expect(ARTIFACT_CSP).toContain("https://cdnjs.cloudflare.com");
	expect(ARTIFACT_CSP).not.toContain("'unsafe-eval'");
});

test("fragments, documents without a head and attempted CSS injection retain a first-in-head prelude", () => {
	for (const content of ["<h1>Report</h1>", "<html><body>Report</body></html>", "<html><script>fetch(\"https://example.com\")</script><head></head><body>Report</body></html>"]) {
		const html = artifactPageDocument(content, { mode: "light", tokens: { "tone-bg": "red;</style><script>bad()</script>" } }, true);
		expect(html).toStartWith('<!doctype html><html data-theme="light"><head><meta http-equiv="Content-Security-Policy"');
		expect(html).not.toContain("<script>bad()");
	}
});


test("host controls replace the injected print button without changing author bytes or the policy", () => {
    const source = "<h1>Report</h1><script>window.example = true</script>";
    const html = artifactPageDocument(source, theme, true, true);
    expect(html).toContain(source);
    expect(html).toContain(ARTIFACT_CSP);
    expect(html).not.toContain("document.createElement('button')");
    const listener = html.slice(html.indexOf("window.addEventListener('message'"), html.indexOf("</script>"));
    const listeners = new Map<string, (event: unknown) => void>();
    const messages: unknown[] = [];
    const parent = { postMessage(data: unknown, target: string) { messages.push([data, target]); } };
    let prints = 0;
    runInNewContext(listener, { parent, window: { addEventListener(name: string, callback: (event: unknown) => void) { listeners.set(name, callback); }, print() { prints++; } } });
    const receive = listeners.get('message')!;
    receive({ source: {}, data: "kemiri:print-artifact" });
    receive({ source: parent, data: "unrecognized" });
    expect(prints).toBe(0);
    receive({ source: parent, data: "kemiri:print-artifact" });
    expect(prints).toBe(1);
    const keydown = listeners.get('keydown')!;
    keydown({ key: 'Enter' });
    keydown({ key: 'Escape', defaultPrevented: true });
    expect(messages).toEqual([]);
    keydown({ key: 'Escape', defaultPrevented: false });
    expect(messages).toEqual([['kemiri:close-artifact', '*']]);
});

test("the new-tab wrapper gives the document the viewport, not a title or safety banner", () => {
    const html = sandboxedArtifactDocument("blob:example", "report.html", theme);
    expect(html).not.toContain("<header");
    expect(html).toContain('aria-label="Artifact actions"');
    expect(html).toContain('popover');
    expect(html).toContain("height: 100%");
    expect(html).not.toContain("allow-same-origin");
});
