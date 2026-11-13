import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	ARTIFACT_FRAME_SANDBOX,
	escapeHtml,
	isHtmlArtifact,
	openArtifactPreview,
	sandboxedArtifactDocument,
} from '../src/lib/artifact-preview.ts';
import { artifactDialogSizing, DIALOG_FOOTER_CLASS, DIALOG_HEADER_CLASS, DIALOG_SCROLL_CLASS, roomyDialogClass } from '../src/lib/dialog-layout.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
/** The utilities a class list applies, without Tailwind's variant prefixes. */
const utilities = (classes: string) => classes.split(/\s+/).filter(Boolean).map(name => name.replace(/^[a-z-]+:/, ''));

describe('a roomy dialog holds one scroll region', () => {
	test('stays a narrow dialog, but may use the height the screen has', () => {
		const names = utilities(roomyDialogClass());
		expect(names).toContain('w-[min(32rem,calc(100vw-2rem))]');
		expect(names).toContain('max-h-[min(90dvh,52rem)]');
		expect(names).toContain('flex-col');
		expect(names).toContain('overflow-hidden');
		// No padding of its own: the header, the scroll region and the footer carry it.
		expect(names).toContain('p-0');
		// The shadcn default caps every dialog at 28rem from the small breakpoint up; the width above replaces it.
		expect(roomyDialogClass()).toContain('sm:max-w-none');
		// Never wider than the phone: long text wraps instead.
		expect(roomyDialogClass()).not.toContain('92vw');
		expect(roomyDialogClass()).not.toContain('w-screen');
		expect(utilities(roomyDialogClass({ wide: true }))).toContain('w-[min(36rem,calc(100vw-2rem))]');
	});
	test('keeps the header and footer fixed around the region that scrolls', () => {
		expect(utilities(DIALOG_HEADER_CLASS)).toContain('shrink-0');
		expect(DIALOG_HEADER_CLASS).toContain('border-b');
		expect(utilities(DIALOG_SCROLL_CLASS)).toContain('flex-1');
		expect(utilities(DIALOG_SCROLL_CLASS)).toContain('min-h-0');
		expect(utilities(DIALOG_SCROLL_CLASS)).toContain('overflow-y-auto');
		expect(utilities(DIALOG_FOOTER_CLASS)).toContain('shrink-0');
		expect(DIALOG_FOOTER_CLASS).toContain('border-t');
	});
	test('an HTML artifact is wider than a Markdown one, and other kinds keep their size', () => {
		expect(artifactDialogSizing({ markdown: true })).toContain('max-h-[min(90dvh,64rem)]');
		expect(artifactDialogSizing({ markdown: true })).toContain('w-[min(60rem,92vw)]');
		expect(artifactDialogSizing({ html: true })).toContain('w-[min(75rem,92vw)]');
		// Images, audio and files are untouched.
		expect(artifactDialogSizing({})).toBe('w-[min(56rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] max-w-none sm:max-w-none');
	});
});

describe('the MCP dialogs use the roomy shell', () => {
	const section = source('../src/lib/components/settings/McpServersSection.svelte');
	test('add, import and confirm each have a fixed header, one scroll region and a fixed footer', () => {
		for (const name of ['add', 'import', 'confirm']) expect(section).toContain(`data-mcp-dialog="${name}"`);
		expect(section.match(/class=\{roomyDialogClass\(\)\}/g)?.length).toBe(1);
		expect(section.match(/class=\{roomyDialogClass\(\{ wide: true \}\)\}/g)?.length).toBe(2);
		expect(section.match(/data-dialog-scroll/g)?.length).toBe(3);
		expect(section.match(/class=\{DIALOG_HEADER_CLASS\}/g)?.length).toBe(3);
		expect(section.match(/class=\{DIALOG_FOOTER_CLASS\}/g)?.length).toBe(3);
	});
	test('the preset catalogue scrolls with the fields instead of inside them', () => {
		const catalogue = section.slice(section.indexOf('aria-label="Preset catalogue"') - 200, section.indexOf('aria-label="Preset catalogue"'));
		expect(section).toContain('aria-label="Preset catalogue"');
		expect(catalogue).not.toContain('max-h-64');
		expect(catalogue).not.toContain('overflow-y-auto');
	});
	test('a preset description wraps instead of pushing the dialog wider', () => {
		// A `truncate` span is nowrap, so its min-content width is the whole line and the dialog's column grew to it.
		const description = section.split('\n').find(entry => entry.includes('data-mcp-preset-description')) ?? '';
		expect(description).toContain('break-words');
		expect(description).not.toContain('truncate');
		expect(section).not.toMatch(/data-mcp-preset-description[^>]*truncate/);
		// Fields and the scroll region may shrink below their content.
		expect(section).toMatch(/\.mcp-input \{[^}]*width: 100%/);
		expect(section).toMatch(/\.mcp-input \{[^}]*min-width: 0/);
		// The scroll region itself may shrink below its content too.
		expect(utilities(DIALOG_SCROLL_CLASS)).toContain('min-w-0');
		expect(section).toContain('flex min-w-0 flex-col gap-4');
	});
	test('the cancel buttons are quiet and only the dialog action stays primary', () => {
		expect(section).toContain('<Button variant="ghost" type="button" onclick={() => { adding = false;');
		expect(section).toContain('<Button size="sm" type="submit" disabled={busy || !name.trim()}>');
	});
});

describe('the update controls are small and quiet', () => {
	const component = source('../src/lib/components/SelfUpdate.svelte');
	test('every action is a shared Button variant instead of a hand-made tall button', () => {
		expect(component).not.toMatch(/<button[^>]*min-h-11/);
		expect(component).toContain('import { Button } from \'#lib/components/ui/button/index.js\'');
		for (const action of ['cancel', 'force', 'start']) expect(component).toContain(`data-update-action="${action}"`);
	});
	test('only Update now keeps the primary emphasis', () => {
		/** The line that renders one action, so a variant cannot be read off a neighbour. */
		const line = (marker: string) => component.split('\n').find(entry => entry.includes(marker)) ?? '';
		expect(line('data-update-action="start"')).toContain('size="sm"');
		expect(line('data-update-action="start"')).toContain('>Update now</Button>');
		expect(line('data-update-action="start"')).not.toContain('variant="ghost"');
		for (const quiet of ['data-update-action="cancel"', 'data-update-action="force"', 'data-update-confirm="cancel"']) {
			expect(line(quiet)).toContain('variant="ghost"');
			expect(line(quiet)).not.toContain('bg-(--primary)');
		}
		expect(line('data-update-confirm="accept"')).toContain('size="sm"');
	});
	test('About dismisses the notice with a labelled icon button', () => {
		const about = source('../src/lib/components/settings/AboutSection.svelte');
		expect(about).toContain('data-update-dismiss');
		expect(about).toContain('aria-label="Dismiss the update notice"');
		expect(about).toContain('title="Hide the update notice until a newer release appears"');
		expect(about).not.toContain('min-h-11 self-start underline');
	});
});

describe('an HTML artifact opens in a sandboxed tab', () => {
	const page = '<!doctype html><html><body><h1>Report</h1></body></html>';
	test('recognises HTML by MIME type and by name', () => {
		expect(isHtmlArtifact({ name: 'report.bin', mimeType: 'text/html; charset=utf-8' })).toBe(true);
		expect(isHtmlArtifact({ name: 'report.html', mimeType: '' })).toBe(true);
		expect(isHtmlArtifact({ name: 'report.HTM', mimeType: 'text/plain' })).toBe(true);
		expect(isHtmlArtifact({ name: 'report.md', mimeType: 'text/markdown' })).toBe(false);
		expect(isHtmlArtifact({ name: 'report.txt', mimeType: 'text/plain' })).toBe(false);
	});
	test('the frame has no sandbox tokens at all: an opaque origin without scripts', () => {
		expect(ARTIFACT_FRAME_SANDBOX).toBe('');
		const document = sandboxedArtifactDocument('blob:http://localhost:5186/synthetic', 'report.html');
		expect(document).toContain('<iframe title="report.html" sandbox=""');
		expect(document).toContain('src="blob:http://localhost:5186/synthetic"');
		expect(document).not.toContain('allow-same-origin');
		expect(document).not.toContain('allow-scripts');
		expect(document).not.toContain('allow-popups');
		// The app's own origin appears nowhere as a document of the artifact.
		expect(document).toContain('cannot read the app');
	});
	test('a hostile artifact name cannot become markup in the wrapper', () => {
		const document = sandboxedArtifactDocument('blob:x', '<script>alert(1)</script>"');
		expect(document).not.toContain('<script>');
		expect(document).toContain('&lt;script&gt;');
		expect(escapeHtml('a & b "c"')).toBe('a &amp; b &quot;c&quot;');
	});
	test('opening the tab wraps the artifact in its own blob and clears the opener', () => {
		const urls: string[] = [];
		const blobs: Blob[] = [];
		const opened: { url: string; opener: unknown }[] = [];
		const result = openArtifactPreview(page, 'report.html', {
			createUrl: (blob) => {
				blobs.push(blob);
				const url = `blob:synthetic-${urls.length}`;
				urls.push(url);
				return url;
			},
			open: (url) => {
				const tab = { url, opener: {} as unknown };
				opened.push(tab);
				return tab as unknown as Window;
			}
		});
		expect(result).toBe(true);
		// First the artifact's bytes, then the wrapper that frames them.
		expect(blobs.map(blob => blob.type.split(';')[0])).toEqual(['text/html', 'text/html']);
		expect(opened[0]!.url).toBe(urls[1]!);
		expect(opened[0]!.opener).toBeNull();
	});
	test('a blocked pop-up reports failure instead of pretending', () => {
		expect(openArtifactPreview(page, 'report.html', { createUrl: () => 'blob:x', open: () => null })).toBe(false);
	});
});

describe('the viewers wire the new sizing and button up', () => {
	test('the artifact dialog sizes itself by kind and hands the text the dialog scroll', () => {
		const dialog = source('../src/lib/components/artifacts/ArtifactDialog.svelte');
		expect(dialog).toContain('class="artifact-dialog flex {sizing} flex-col gap-0 overflow-hidden p-0"');
		expect(dialog).toContain('artifactDialogSizing({');
		expect(dialog).toContain("markdown: artifact.kind === 'text' && isMarkdownArtifact(artifact)");
		expect(dialog).toContain("html: artifact.kind === 'text' && isHtmlArtifact(artifact)");
		expect(dialog).toContain('<ArtifactPlayer {artifact} {client} {autoplay} roomy />');
	});
	test('a roomy text body does not scroll inside the dialog', () => {
		const text = source('../src/lib/components/artifacts/ArtifactText.svelte');
		expect(text).toContain('class:roomy');
		expect(text).toMatch(/\.text-body\.roomy \{[^}]*max-height: none/);
		expect(text).toMatch(/\.text-body\.roomy \{[^}]*overflow: visible/);
		expect(text).toContain('aria-label="Open in a new tab"');
		expect(text).toContain('title="Open in a new tab"');
		expect(text).toContain('data-artifact-new-tab');
		expect(text).toContain('{#if html && content !== undefined}');
	});
});
