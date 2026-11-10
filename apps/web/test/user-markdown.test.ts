import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise the actual DOMPurify path in a browser rather than mocking its sanitiser in Bun's DOM-less runtime.
let directory: string;
let rendered: Record<string, { html: string; text: string; breaks: number; code?: string }>;
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'harness-user-markdown-'));
	const entry = join(directory, 'render.ts');
	await Bun.write(entry, `
		import { toBlocks } from ${JSON.stringify(resolve(import.meta.dir, '../src/lib/markdown/parse.ts'))};
		import { linkTaskMentions } from ${JSON.stringify(resolve(import.meta.dir, '../src/lib/task-chat.ts'))};
		import { linkRefMentions } from ${JSON.stringify(resolve(import.meta.dir, '../src/lib/refs.ts'))};
		const samples = {
			format: ['# Heading\\n\\n- **bold** and *italic*\\n- \`code\` and [link](https://example.com)\\n\\n| A | B |\\n|---|---|\\n| x | y |', true],
			board: ['**Release plan**\\n\\n- **Validate:** run \`bun test\`\\n  - Phone\\n  - Keyboard\\n\\n1. Build\\n2. Read [guide](https://example.com/guide)\\n\\n<b>literal</b>', true],
			user: ['one\\ntwo\\nthree', true],
			assistant: ['one\\ntwo\\nthree', false],
			html: ['<img src=x onerror=alert(1)>\\n<script>alert(1)</script>\\n\\n[bad](javascript:alert(1))', true],
			literal: ['hello <b>world</b>', true],
			tasks: [linkRefMentions(linkTaskMentions('**T12** and EX-7; \`T12\`', {title: id => id === 'T12' ? 'Task twelve' : undefined}), {jiraSite:'https://example.atlassian.net',jiraProjects:['EX'],githubRepos:[]}), true],
			fence: ['', true]
		};
		// Build the fence separately to keep this test's template literal readable.
		samples.fence = [String.fromCharCode(96).repeat(3) + 'ts\\nconst x = 1;\\n' + String.fromCharCode(96).repeat(3), true];
		const results = {};
		for (const [name, [source, user]] of Object.entries(samples)) {
			const blocks = toBlocks(source, false, user);
			const el = document.createElement('div');
			el.innerHTML = blocks.filter(b => b.kind === 'html').map(b => b.html).join('');
			results[name] = {html:el.innerHTML,text:el.textContent,breaks:el.querySelectorAll('br').length,code:blocks.find(b => b.kind === 'code')?.code};
		}
		document.body.innerHTML = '<pre id="results">' + btoa(JSON.stringify(results)) + '</pre>';
	`);
	const bundle = await Bun.build({ entrypoints: [entry], target: 'browser' });
	if (!bundle.success) throw new Error(bundle.logs.join('\n'));
	const html = join(directory, 'render.html');
	await Bun.write(html, `<body><script type="module">${(await bundle.outputs[0]!.text()).replaceAll('</script', '<\\/script')}</script></body>`);
	const browser = Bun.spawn(['timeout', '25', 'setsid', '-f', '--wait', process.env.CHROMIUM_BIN ?? 'chromium', '--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${directory}/profile`, '--dump-dom', `file://${html}`], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
	const output = await new Response(browser.stdout).text();
	const error = await new Response(browser.stderr).text();
	if (await browser.exited !== 0) throw new Error(error);
	const encoded = [...output.matchAll(/<pre id="results">([A-Za-z0-9+/=]+)<\/pre>/g)].at(-1)?.[1];
	if (!encoded) throw new Error(`No browser results: ${output}\n${error}`);
	rendered = JSON.parse(Buffer.from(encoded, 'base64').toString());
}, 60_000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe('user Markdown through the shared renderer', () => {
	test('renders formatting, lists, links, inline code, tables and shared fenced blocks', () => {
		for (const tag of ['h1', 'ul', 'strong', 'em', 'code', 'a', 'table']) expect(rendered.format!.html).toContain(`<${tag}`);
		expect(rendered.fence!.code).toBe('const x = 1;');
	});
	test('renders compact board prose without interpreting agent HTML', () => {
		const board = rendered.board!;
		for (const tag of ['strong', 'ul', 'ol', 'code', 'a']) expect(board.html).toContain(`<${tag}`);
		expect(board.html).toMatch(/<ul>[\s\S]*<ul>/);
		expect(board.html).toContain('rel="noopener noreferrer"');
		expect(board.text).toContain('<b>literal</b>');
		expect(board.html).not.toContain('<b>');
	});
	test('keeps single chat newlines without changing the assistant or its cache', () => {
		expect(rendered.user!.breaks).toBe(2);
		expect(rendered.assistant!.breaks).toBe(0);
	});
	test('never interprets user HTML, or permits executable links', () => {
		expect(rendered.html!.html).not.toMatch(/<(img|script)|onerror="|href="javascript:/);
		expect(rendered.literal!.text).toContain('<b>world</b>');
	});
	test('keeps task chips and project reference links out of code', () => {
		expect(rendered.tasks!.html).toContain('href="?task=T12"');
		expect(rendered.tasks!.html).toContain('href="https://example.atlassian.net/browse/EX-7"');
		expect(rendered.tasks!.html).toContain('<code>T12</code>');
	});
});
