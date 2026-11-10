import { describe, expect, test } from 'bun:test';
import { markdownText } from '@mihai-harness/protocol';
import { readFileSync } from 'node:fs';
import { rowGist } from '../src/lib/tasks.ts';

describe('board Markdown plain previews', () => {
	test('removes emphasis, nested list markers and numbered markers', () => {
		expect(markdownText('**Plan**\n\n- **One**\n  - *Nested*\n\n1. First\n2. Second')).toBe('Plan One Nested First Second');
	});
	test('keeps code content and escaped punctuation rather than deleting it', () => {
		expect(markdownText('Run `dry_run` and \\*literal\\*\n\n```sh\nbun test\n```')).toBe('Run dry_run and *literal* bun test');
	});
	test('keeps nested link labels, image alt text and reference labels, not destinations', () => {
		expect(markdownText('[**Read** `guide`](https://example.com/a_(b)) ![Diagram](https://example.com/a.png) [more][doc]\n\n[doc]: https://example.com')).toBe('Read guide Diagram more');
	});
	test('drops HTML and decodes readable entities without executing anything', () => {
		expect(markdownText('Hello <b>world</b> &amp; &#35;7\n\n<script>alert(1)</script>')).toBe('Hello world & #7');
	});
	test('handles empty input, tables and task checkboxes', () => {
		expect(markdownText('')).toBe('');
		expect(markdownText('| A | B |\n|---|---|\n| x | y |')).toBe('A B x y');
		expect(markdownText('- [x] Done')).toBe('Done');
	});
	test('cleans needs-you rows before the UI ellipsizes them', () => {
		expect(rowGist({ section: 'needs_you', waiting: [{ text: '**Check:** `dry_run`' }], task: { status: 'todo' } } as Parameters<typeof rowGist>[0])).toBe('Check: dry_run');
	});
	test('all expanded board surfaces share the compact safe chat renderer', () => {
		const component = (name: string) => readFileSync(new URL(`../src/lib/components/${name}.svelte`, import.meta.url), 'utf8');
		for (const name of ['BoardQuestionCard', 'BoardPanel', 'TasksPanel', 'TaskSheet', 'chat/BoardCallCard']) expect(component(name)).toContain('CardMarkdown');
		const card = component('markdown/CardMarkdown');
		expect(card).toContain('<Markdown {source} userMessage class="md-card"');
		expect(card).toContain('aria-expanded={expanded}');
		expect(card).not.toContain('source.slice');
		expect(component('BoardQuestionCard')).toContain('onclick={() => send(option)}');
	});
});
