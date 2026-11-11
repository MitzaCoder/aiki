import { taskNowText } from './task-activity.js';
import { page } from '$app/state';
import { untrack } from 'svelte';
import type { BoardTask } from '@aiki/protocol';
import type { ProjectBoard } from './board.svelte.js';
import { useRefLinks } from './ref-links.svelte.js';
import { refLabel } from './tasks.js';
import { TaskSearchIndex } from './task-search.js';

const queries = $state<Record<string, string>>({});
export function useTaskSearch(tasks: () => readonly BoardTask[], board: () => ProjectBoard | undefined) {
	const refs = useRefLinks();
	const key = $derived(`aiki.task-search.v1:${page.params.backend ?? ''}:${page.params.id ?? ''}`);
	const index = new TaskSearchIndex();
	let feedback = $state<Record<string, { revision: number; text: string }>>({});
	let feedbackBoard: ProjectBoard | undefined;
	$effect(() => {
		const storageKey = key;
		untrack(() => {
			if (queries[storageKey] !== undefined) return;
			try { queries[storageKey] = localStorage.getItem(storageKey) ?? ''; } catch { queries[storageKey] = ''; }
		});
	});
	// Feedback lives in timelines, not BoardTask. Read only tasks with feedback, four at a time,
	// on timeline revisions, never on typing. Cancel stale responses on board/project replacement.
	$effect(() => {
		const current = board();
		if (current !== feedbackBoard) { feedbackBoard = current; feedback = {}; }
		const wanted = tasks().filter(task => task.feedback && Object.values(task.feedback).some(count => count > 0));
		const cache = untrack(() => feedback);
		const pending = wanted.filter(task => cache[task.id]?.revision !== (task.timelineRevision ?? 0));
		let cancelled = false;
		if (current) for (let worker = 0; worker < Math.min(4, pending.length); worker++) void (async () => {
			while (pending.length && !cancelled) {
				const task = pending.shift()!;
				try {
					const timeline = await current.timeline(task.id);
					if (!cancelled) feedback = { ...feedback, [task.id]: { revision: task.timelineRevision ?? 0, text: timeline.feedback.map(entry => entry.text).join('\n') } };
				} catch { /* A later board update/reconnect retries. Title/body search stays available. */ }
			}
		})();
		return () => { cancelled = true; };
	});
	const updated = $derived.by(() => {
		index.update(tasks().map(task => ({ id: task.id, title: task.title, parent: task.parent,
			refs: task.refs.flatMap(ref => { const status = refs()?.status(ref); return [ref, refLabel(ref, refs()?.links), ...(status && 'title' in status ? [status.title] : [])]; }),
			body: [task.description, taskNowText(task, board()?.activityEnabled === true), task.report.results, task.report.next, task.feedback && Object.values(task.feedback).some(count => count > 0) ? feedback[task.id]?.text ?? '' : ''].join('\n') })));
		return index;
	});
	return {
		get query() { return queries[key] ?? ''; },
		setQuery(query: string) { queries[key] = query; try { localStorage.setItem(key, query); } catch { /* memory fallback */ } },
		search(eligible: ReadonlySet<string>) { return updated.search(queries[key] ?? '', eligible); }
	};
}
