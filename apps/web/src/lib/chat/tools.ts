/**
 * How a tool call reads in the transcript: its icon, a one-line summary and the
 * language of a file it touched. Unknown tools still render; they get the
 * generic wrench and their first string argument.
 */
import CodeSquareIcon from '@lucide/svelte/icons/code-square';
import FilePenIcon from '@lucide/svelte/icons/file-pen';
import FilePlusIcon from '@lucide/svelte/icons/file-plus';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import FolderSearchIcon from '@lucide/svelte/icons/folder-search';
import FolderTreeIcon from '@lucide/svelte/icons/folder-tree';
import SearchIcon from '@lucide/svelte/icons/search';
import TerminalIcon from '@lucide/svelte/icons/terminal';
import WrenchIcon from '@lucide/svelte/icons/wrench';
import type { Component } from 'svelte';
import { isCodingTool } from '#lib/transcript.js';

type Args = Record<string, unknown>;

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const TOOL_ICONS: Record<string, Component> = {
	bash: TerminalIcon,
	read: FileTextIcon,
	edit: FilePenIcon,
	write: FilePlusIcon,
	grep: SearchIcon,
	find: FolderSearchIcon,
	ls: FolderTreeIcon,
	codemode: CodeSquareIcon
};

export function toolIcon(name: string): Component {
	return TOOL_ICONS[name] ?? WrenchIcon;
}

/** Shorten absolute paths inside the project directory or the home directory. */
export function shortPath(path: string, cwd?: string): string {
	if (cwd !== undefined && cwd.length > 0 && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
	return path.replace(/^\/home\/[^/]+\//, '~/');
}

/** One line describing a call, for its collapsed header. */
export function toolSummary(name: string, args: Args, cwd?: string): string {
	switch (name) {
		case 'bash':
			return str(args.command)?.split('\n')[0] ?? '';
		case 'read': {
			const path = shortPath(str(args.path) ?? '', cwd);
			const offset = typeof args.offset === 'number' ? args.offset : undefined;
			const limit = typeof args.limit === 'number' ? args.limit : undefined;
			if (offset === undefined && limit === undefined) return path;
			const from = offset ?? 1;
			return `${path}:${from}${limit ? `–${from + limit - 1}` : ''}`;
		}
		case 'edit':
		case 'write':
		case 'ls':
			return shortPath(str(args.path) ?? '', cwd);
		case 'grep':
		case 'find': {
			const pattern = str(args.pattern) ?? '';
			const path = str(args.path);
			return path ? `${pattern}  in ${shortPath(path, cwd)}` : pattern;
		}
		case 'schedule_save':
			// The schedule's own name says more than its ID, which is the first argument a save carries.
			return str(args.title) ?? str(args.id) ?? '';
		default: {
			const first = Object.values(args).find((value) => typeof value === 'string');
			return typeof first === 'string' ? first.split('\n')[0] : '';
		}
	}
}

/**
 * How the tools that are not coding tools read in a card's header: the words of
 * the action rather than its wire name. A `schedule_save` is "Saved a
 * schedule"; a tool this app has never heard of keeps only its underscores
 * dropped (the card's title still carries the exact name).
 */
const TOOL_HEADLINES: Record<string, string> = {
	schedule_list: 'Listed the schedules',
	schedule_save: 'Saved a schedule',
	schedule_delete: 'Deleted a schedule',
	schedule_run: 'Started a scheduled run',
	task_progress: 'Reported progress',
	worker_list: 'Listed the workers',
	worker_peek: 'Peeked at a worker',
	worker_stop: 'Stopped a worker',
	worker_spawn: 'Started a worker',
	worker_send: 'Sent to a worker',
	worker_forget: 'Forgot a worker'
};

/**
 * The words a card's header leads with, or `undefined` to show the tool's own
 * name: the coding tools keep theirs (`bash`, with the command beside it),
 * because a reader recognises them as they are.
 */
export function toolHeadline(name: string): string | undefined {
	if (name.length === 0 || isCodingTool(name)) return undefined;
	const known = TOOL_HEADLINES[name];
	if (known !== undefined) return known;
	const words = name.replace(/[._-]+/g, ' ').trim();
	return words.length === 0 ? undefined : words.charAt(0).toUpperCase() + words.slice(1);
}

const EXTENSIONS: Record<string, string> = {
	ts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'jsx',
	svelte: 'svelte',
	py: 'python',
	rs: 'rust',
	go: 'go',
	nix: 'nix',
	sh: 'bash',
	bash: 'bash',
	fish: 'fish',
	zsh: 'bash',
	md: 'markdown',
	json: 'json',
	jsonl: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	html: 'html',
	css: 'css',
	scss: 'scss',
	sql: 'sql',
	java: 'java',
	kt: 'kotlin',
	swift: 'swift',
	c: 'c',
	h: 'c',
	cpp: 'cpp',
	lua: 'lua',
	dart: 'dart',
	xml: 'xml'
};

/** The highlighter language for a file path, for showing a file's content. */
export function langFromPath(path: string | undefined): string {
	if (path === undefined) return 'plaintext';
	const base = path.split('/').pop()?.toLowerCase() ?? '';
	if (base === 'dockerfile') return 'dockerfile';
	if (base === 'makefile') return 'makefile';
	return EXTENSIONS[base.split('.').pop() ?? ''] ?? 'plaintext';
}

type ContentPart = { type?: string; text?: string };

/** The text of a tool result's content blocks. */
export function resultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.filter((part): part is ContentPart => typeof part === 'object' && part !== null)
		.filter((part) => part.type === 'text' && typeof part.text === 'string')
		.map((part) => part.text ?? '')
		.join('\n');
}

/**
 * Split off the bracketed truncation notice pi's read and bash tools append
 * (e.g. `[Showing lines 1-200 of 900. Use offset=201 to continue.]`).
 */
export function splitNotice(text: string): { body: string; notice?: string } {
	const match = /\n\n\[([^\]\n]+)\]\s*$/.exec(text);
	if (!match) return { body: text };
	return { body: text.slice(0, match.index), notice: match[1] };
}
