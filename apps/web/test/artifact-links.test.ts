import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { ARTIFACT_LINK_PRELUDE, artifactLinkDecision } from "../src/lib/artifact-links.ts";
import { artifactPageDocument } from "../src/lib/artifact-page.ts";
import { openArtifactPreview, ARTIFACT_FRAME_SANDBOX } from "../src/lib/artifact-preview.ts";

test("artifact link policy resolves only supported schemes and history-free fragments", () => {
	for (const base of ["about:srcdoc", "blob:https://example.com/report", "https://example.org/reports/"]) {
		expect(artifactLinkDecision("#update%20one", base)).toEqual({ kind: "scroll", id: "update one" });
		expect(artifactLinkDecision("#", base)).toEqual({ kind: "scroll", id: "" });
		expect(artifactLinkDecision("#%zz", base)).toEqual({ kind: "block" });
		expect(artifactLinkDecision("https://example.com", base)).toEqual({ kind: "open", url: "https://example.com/" });
		expect(artifactLinkDecision("mailto:support@example.com", base)).toEqual({ kind: "mailto", url: "mailto:support@example.com" });
		expect(artifactLinkDecision("tel:+12025550123", base)).toEqual({ kind: "tel", url: "tel:+12025550123" });
		for (const href of ["javascript:alert(1)", "data:text/html,hi", "file:///tmp/page", "content://media/1", "intent://open", "kemiri://connect"]) expect(artifactLinkDecision(href, base)).toEqual({ kind: "block" });
	}
	expect(artifactLinkDecision("next", "about:srcdoc")).toEqual({ kind: "block" });
	expect(artifactLinkDecision("next", "https://example.org/reports/")).toEqual({ kind: "open", url: "https://example.org/reports/next" });
});

/** Exercise the actual serialized prelude, not a second test-only implementation. */
function sandbox() {
	const opens: unknown[][] = [];
	const scrolls: string[] = [];
	let click: (event: any) => void = () => {};
	class Element {
		constructor(readonly href: string) {}
		matches(selector: string) { return selector === "a[href]"; }
		getAttribute() { return this.href; }
	}
	const document = {
		// srcdoc's implicit base URI is the host URL, not a base the artifact may use.
		baseURI: "https://app.example.test/private/",
		querySelector() { return null; },
		addEventListener(name: string, listener: typeof click, capture: boolean) { expect(name).toBe("click"); expect(capture).toBe(true); click = listener; },
		getElementById(id: string) { return id === "update" ? { scrollIntoView() { scrolls.push(id); } } : null; },
		getElementsByName() { return []; },
	};
	runInNewContext(ARTIFACT_LINK_PRELUDE, { document, Element, URL, location: { href: "about:srcdoc" }, window: { open: (...args: unknown[]) => opens.push(args), scrollTo: () => scrolls.push("top") } });
	return { opens, scrolls, activate(href: string, overrides = {}) {
		const event = { defaultPrevented: false, button: 0, composedPath: () => [{}, new Element(href)], preventDefault() { this.defaultPrevented = true; }, ...overrides };
		click(event); return event.defaultPrevented;
	} };
}

test("capture handles nested content and keyboard-generated clicks without changing history or target", () => {
	const frame = sandbox();
	expect(frame.activate("#update")).toBe(true);
	expect(frame.activate("#")).toBe(true);
	expect(frame.scrolls).toEqual(["update", "top"]);
	expect(frame.activate("https://example.com")).toBe(true);
	expect(frame.opens).toEqual([["https://example.com/", "_blank", "noopener"]]);
	expect(frame.activate("file:///tmp/page")).toBe(true);
	expect(frame.activate("relative-app-route")).toBe(true);
	expect(frame.opens).toHaveLength(1);
});

test("cancelled and modified activations belong to the author/browser", () => {
	const frame = sandbox();
	for (const overrides of [{ defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) frame.activate("https://example.com", overrides);
	expect(frame.opens).toEqual([]);
	expect(frame.scrolls).toEqual([]);
});

test("both web component paths carry the identical policy without adding sandbox grants", async () => {
	const theme = { mode: "light" as const, tokens: {} };
	const source = '<base target="_top"><a href="#update">Update</a>';
	const page = artifactPageDocument(source, theme);
	expect(page).toContain(ARTIFACT_LINK_PRELUDE);
	expect(page).toContain(source);
	const blobs: Blob[] = [];
	openArtifactPreview(source, "links.html", { theme, createUrl(blob) { blobs.push(blob); return "blob:test"; }, open() { return { opener: null } as Window; } });
	expect(await blobs[0]!.text()).toBe(page);
	expect(await blobs[1]!.text()).toContain(`sandbox="${ARTIFACT_FRAME_SANDBOX}"`);
	const component = readFileSync(new URL('../src/lib/components/artifacts/ArtifactText.svelte', import.meta.url), 'utf8');
	expect(component).toContain('srcdoc={pageDocument}');
	expect(component).toContain('artifactPageDocument(content, artifactTheme, blockRequests)');
	expect(component).toContain('openArtifactPreview(content, artifact.name, { theme: artifactTheme, blockRequests })');
	expect(ARTIFACT_FRAME_SANDBOX).not.toMatch(/allow-same-origin|allow-top-navigation/);
});
