<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import BellIcon from '@lucide/svelte/icons/bell';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import InfoIcon from '@lucide/svelte/icons/info';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import { onMount, untrack, type Component } from 'svelte';
	import { page } from '$app/state';
	import ArchivedBanner from '#lib/components/ArchivedBanner.svelte';
	import Banner from '#lib/components/Banner.svelte';
	import ConnectionBadge from '#lib/components/ConnectionBadge.svelte';
	import ContextPanel from '#lib/components/ContextPanel.svelte';
	import BoardPanel from '#lib/components/BoardPanel.svelte';
	import BackgroundPanel from '#lib/components/BackgroundPanel.svelte';
	import ArtifactStrip from '#lib/components/artifacts/ArtifactStrip.svelte';
	import ThreadStatusBadge from '#lib/components/chat/ThreadStatusBadge.svelte';
	import BoardQuestionPin from '#lib/components/BoardQuestionPin.svelte';
	import TaskSheet from '#lib/components/TaskSheet.svelte';
	import RefCardHost from '#lib/components/RefCardHost.svelte';
	import TasksPanel from '#lib/components/TasksPanel.svelte';
	import TasksView from '#lib/components/TasksView.svelte';
	import { taskFilter, tasksView } from '#lib/tasks-view.svelte.js';
	import ConversationSidebar from '#lib/components/ConversationSidebar.svelte';
	import ReleaseUpdateBanner from '#lib/components/ReleaseUpdateBanner.svelte';
	import DeployBanner from '#lib/components/DeployBanner.svelte';
	import DiskBanner from '#lib/components/DiskBanner.svelte';
	import { SERVER_STATUS_REFRESH_MS } from '#lib/server-status.js';
	import MemoryPanel from '#lib/components/MemoryPanel.svelte';
	import ProjectsMenuButton from '#lib/components/ProjectsMenuButton.svelte';
	import ReleaseLine from '#lib/components/ReleaseLine.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import Composer from '#lib/components/chat/Composer.svelte';
	import { provideFileDownload } from '#lib/chat/file-scope.js';
	import type { ChatFile } from '@aiki/protocol';
	import { draftKey } from '#lib/drafts.js';
	import { draftChannel } from '#lib/draft-channel.js';
	import EmptyState from '#lib/components/chat/EmptyState.svelte';
	import TranscriptColumn from '#lib/components/chat/TranscriptColumn.svelte';
	import ArtifactsSection from '#lib/components/artifacts/ArtifactsSection.svelte';
	import { provideArtifactScope } from '#lib/artifacts.svelte.js';
	import { taskOptions } from '#lib/task-chat.js';
	import { boardTaskLinks, provideTaskLinks } from '#lib/task-links.svelte.js';
	import { ProjectRefStatus, provideRefLinks } from '#lib/ref-links.svelte.js';
	import { projectHref, threadHref, workerHref } from '#lib/backends.js';
	import { projectSettingsHref } from '#lib/settings.js';
	import { terminalHref } from '#lib/terminal.js';
	import {
		harness,
		modelLabel,
		ProjectMemory,
		ProjectSchedules,
		ProjectWorkers,
		type BackendConnection,
		type ChatSession,
		type ProjectContext
	} from '#lib/harness.svelte.js';
	import { visibleSidebarTabs, type SidebarTab } from '#lib/sidebar.js';
	import { questionBadgeText, questionsWaitingLabel } from '#lib/board.js';
	import type { ProjectBoard } from '#lib/board.svelte.js';
	import { taskRefs, withTask } from '#lib/tasks.js';
	import { notifications } from '#lib/notifications.svelte.js';
	import { connectionDotClass, connectionView } from '#lib/connection.js';
	import { headerActionShowsLabel, headerLayout, visibleHeaderActions } from '#lib/chat/header.js';
	import { memoryExtractionFor, type MemoryExtraction } from '#lib/memory.js';
	import { elapsedFor } from '#lib/relative-time.js';
	import { CHAT_COLUMN_CLASS } from '#lib/chat/layout.js';
	import { buildTranscript, liveState } from '#lib/transcript.js';
	import { inputContent, type HeldImage } from '#lib/chat/images.js';
	import { WaitingMessages } from '#lib/waiting.svelte.js';
	import { withWaiting } from '#lib/waiting.js';
	import { threadActivityLine, type ThreadCards } from '#lib/threads.js';
	import type { ProjectThreads } from '#lib/threads.svelte.js';
	import { isMainThread, isThreadActive, shouldSendWorkerDefaults, threadFromAnchor } from '@aiki/client';
	import type { MemoryScope, ModelInfo, ThinkingLevel } from '@aiki/protocol';

	/**
	 * One project's coordinator conversation: the transcript, the composer, the
	 * model and thinking level the composer changes, the workers it delegates to,
	 * the conversation's context and the project's memory. All three live in one
	 * resizable right sidebar (a full-screen sheet below 72rem).
	 *
	 * With `threadId` this is a background thread's chat instead: the same transcript and composer, typed into
	 * directly, under a header that says it is a background thread of main and leads back to main. It has its own
	 * Workers and Info tabs and shares the project's Board and Memory; the Background tab is main's alone.
	 */
	let {
		backend,
		projectId,
		threadId: threadParam
	}: { backend: BackendConnection; projectId: string; threadId?: string } = $props();

	/** The background thread this chat is; undefined for main ("main" in the route reads as main too). */
	const threadId = $derived(isMainThread(threadParam) ? undefined : threadParam);
	const isThread = $derived(threadId !== undefined);
	$effect(() => tasksView.useProject(`${backend.id}:${projectId}`));

	/** The parts of the transcript column the chat drives: following new output. */
	type TranscriptHandle = {
		scrollToBottom(behavior?: ScrollBehavior): void;
		follow(): void;
	};

	const project = $derived(backend.projects.find((entry) => entry.id === projectId));
	provideFileDownload(async file => {
		const response = await backend.attachmentRequest(file.url);
		const url = URL.createObjectURL(await response.blob());
		const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	});
	async function uploadFile(file: File): Promise<ChatFile> {
		const query = new URLSearchParams({ name: file.name, ...(threadId ? { threadId } : {}) });
		return (await backend.attachmentRequest(`/attachments/${projectId}?${query}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file })).json();
	}
	provideArtifactScope(() => ({ client: backend.client, projectId, available: backend.supports('artifacts') }));

	let session = $state<ChatSession | undefined>(undefined);
	let workers = $state<ProjectWorkers | undefined>(undefined);
	let projectContext = $state<ProjectContext | undefined>(undefined);
	let memory = $state<ProjectMemory | undefined>(undefined);
	let schedules = $state<ProjectSchedules | undefined>(undefined);
	let board = $state<ProjectBoard | undefined>(undefined);
	let threads = $state<ProjectThreads | undefined>(undefined);
	let aborting = $state(false);
	let sendError = $state<string | undefined>(undefined);
	let modelError = $state<string | undefined>(undefined);
	let transcript = $state<TranscriptHandle | undefined>(undefined);
	let composer = $state<{ addQuote(quote: string): void; restore(text: string, taskId?: string, images?: HeldImage[], files?: ChatFile[]): void } | undefined>(undefined);
	/** The right sidebar: open, which tab, and whether it fills the chat area. */
	let sidebarOpen = $state(false);
	let sidebarTab = $state<SidebarTab>('info');
	let sidebarExpanded = $state(false);

	const supportsWorkers = $derived(backend.supports('workers'));
	const supportsMemory = $derived(backend.supports('memory'));
	const supportsBoard = $derived(backend.supports('board'));
	// With task reports the Board tab is the Tasks view, and `?task=<id>` opens a task's sheet over the chat.
	const supportsTasks = $derived(supportsBoard && backend.supports('task-reports'));
	const boardTabName = $derived(supportsTasks ? 'Tasks' : 'Board');
	/** Task links in the chat, and the composer's task reference, need the board and the server's task reports. */
	const supportsTaskReports = $derived(backend.supports('task-reports'));
	const taskLinks = $derived(supportsTaskReports && board !== undefined ? boardTaskLinks(() => board?.board?.tasks ?? []) : undefined);
	provideTaskLinks(() => taskLinks);
	/** Keys and PR numbers link through the project's settings; the board's refs show the state the backend reads. */
	let refStatus = $state<ProjectRefStatus | undefined>(undefined);
	const supportsRefStatus = $derived(backend.supports('ref-status'));
	provideRefLinks(() => ({ links: project?.links, status: (ref) => refStatus?.status(ref) }));
	const taskChoices = $derived(!isThread && supportsTaskReports && board !== undefined ? taskOptions(board.board?.tasks ?? []) : undefined);
	const questionsWaiting = $derived(board?.openQuestionCount ?? 0);
	/** A mute toggle belongs in the header when this backend can push to this device at all. */
	const supportsNotifications = $derived(backend.supports('notifications'));
	const muted = $derived(notifications.isMuted(backend.id, projectId));
	/** A worker a schedule started says which schedule; the names come from the project's schedule list. */
	const supportsSchedules = $derived(backend.supports('schedules'));
	/** Info needs the `context` feature, Workers the `workers` one, Memory the `memory` one. */
	const supportsThreads = $derived(backend.supports('threads'));
	const sidebarTabs = $derived(visibleSidebarTabs((feature) => backend.supports(feature), { background: !isThread }));
	/** This thread as the list has it; undefined on main's chat and while the list loads. */
	const thread = $derived(threadId === undefined ? undefined : threads?.thread(threadId));
	const threadList = $derived(threads?.threads ?? []);
	const backgroundActive = $derived(threadList.filter((entry) => !entry.main && isThreadActive(entry)).length);
	const threadCards = $derived<ThreadCards | undefined>(
		supportsThreads
			? {
					threads: threadList,
					href: (id) => threadHref(backend.id, projectId, id),
					scheduleName: scheduleTitle,
					artifacts: threadArtifacts
				}
			: undefined
	);
	const supportsSidebar = $derived(sidebarTabs.length > 0);
	const canPickModel = $derived(
		project !== undefined && backend.ready && backend.supports('projects') && backend.supports('models')
	);
	const currentModel = $derived(
		project?.coordinator.model === null || project?.coordinator.model === undefined
			? undefined
			: backend.models.find(
					(model) =>
						model.provider === project?.coordinator.model?.provider &&
						model.modelId === project?.coordinator.model?.modelId
				)
	);
	const thinkingLevels = $derived<readonly ThinkingLevel[]>(currentModel?.thinkingLevels ?? []);

	const workerList = $derived(workers?.workers ?? []);
	const workerDefaults = $derived(workers?.defaults ?? { model: null, thinkingLevel: null });

	const live = $derived(liveState(session?.view));
	const busy = $derived(live?.run !== undefined);
	/** Messages sent while a run was busy, drawn at the end of the transcript until the run places them. */
	let waiting = $state<WaitingMessages | undefined>(undefined);
	const waitingList = $derived(waiting?.supported === true ? waiting.messages(session?.view?.queued) : []);
	const items = $derived(
		withWaiting(
			buildTranscript(session?.entries ?? [], live, { inputKeys: waiting?.inputKeys, keepWarm: session?.view?.keepWarm }),
			waitingList,
			waiting?.pending
		)
	);
	/** A turn is being written, so its own orb and shimmer already say so. */
	const working = $derived(busy && !items.some((item) => item.kind === 'turn' && item.live === true));
	const empty = $derived(session !== undefined && session.status === 'live' && items.length === 0);
	const canChat = $derived(project !== undefined && (isThread || project.coordinator.model !== null));
	const canSend = $derived(canChat && backend.ready && backend.supports('conversation'));

	/** The coordinator's current tool call, for the header's "Running bash · 3m"; ticks with `now`. */
	let now = $state(Date.now());
	const runningTool = $derived(project?.activity?.runningTool ?? null);
	const runningToolLabel = $derived(
		isThread
			? thread === undefined
				? undefined
				: threadActivityLine(thread)
			: runningTool === null ? undefined : `Running ${runningTool.name}${elapsedFor(runningTool.startedAt, now) ? ` \u00b7 ${elapsedFor(runningTool.startedAt, now)}` : ''}`
	);

	function errorText(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	/** Mute this project for this device, or unmute it; stored in this browser's preferences on this backend. */
	async function toggleProjectMute(): Promise<void> {
		if (project === undefined) return;
		await notifications.toggleProject(harness.backends, backend.id, project.id);
	}

	/** One control in the chat header: a tab of the right sidebar, or the mute and settings buttons. */
	type HeaderAction = {
		id: string;
		/** A sidebar tab (it has a label where the row shows labels) or one of the icons after the connection badge. */
		kind: 'tab' | 'utility';
		/** What the button is called, count included: its aria-label. */
		name: string;
		/** Its tooltip, when saying what the button does is not the same thing; the name stands in for it. */
		title?: string;
		/** The text beside its icon where the row has room for labels; a control without one stays an icon. */
		label?: string;
		/** What the overflow menu calls it, when that reads better than the header's label. */
		menuLabel?: string;
		icon: Component;
		/** The count on the button: beside its label on a wide row, over its icon's corner without one. */
		count?: string;
		tone?: 'primary' | 'accent';
		/** Tasks and Workers stay in the row when the rest fold into the menu. */
		primary?: boolean;
		pressed?: boolean;
		href?: string;
		onclick?: () => void;
	};

	/** The header row, measured: the chat column narrows when the sidebar opens, so the row, not the window, decides. */
	let headerRow = $state<HTMLDivElement | null>(null);
	let headerWidth = $state(0);
	let headerMenuOpen = $state(false);

	$effect(() => {
		if (headerRow == null) return;
		const element = headerRow;
		headerWidth = element.clientWidth;
		const observer = new ResizeObserver(() => (headerWidth = element.clientWidth));
		observer.observe(element);
		return () => observer.disconnect();
	});

	/** The right sidebar's tabs as header buttons; the board and the workers are the two a phone keeps in the row. */
	const tabActions = $derived.by((): HeaderAction[] => {
		const actions: HeaderAction[] = [];
		if (supportsBoard) {
			actions.push({
				id: 'board',
				kind: 'tab',
				name: `${boardTabName}${questionsWaiting > 0 ? ` (${questionsWaitingLabel(questionsWaiting)})` : ''}`,
				label: boardTabName,
				icon: ClipboardListIcon,
				count: questionBadgeText(questionsWaiting),
				tone: 'primary',
				primary: true,
				pressed: sidebarOpen && sidebarTab === 'board',
				onclick: () => toggleSidebar('board')
			});
		}
		if (supportsThreads && !isThread) {
			actions.push({
				id: 'background',
				kind: 'tab',
				name: `Background${backgroundActive > 0 ? ` (${backgroundActive} running)` : ''}`,
				label: 'Background',
				icon: LayersIcon,
				count: backgroundActive > 0 ? String(backgroundActive) : undefined,
				tone: 'accent',
				pressed: sidebarOpen && sidebarTab === 'background',
				onclick: () => toggleSidebar('background')
			});
		}
		if (backend.supports('context')) {
			actions.push({
				id: 'info',
				kind: 'tab',
				name: 'Conversation info',
				label: 'Info',
				icon: InfoIcon,
				pressed: sidebarOpen && sidebarTab === 'info',
				onclick: () => toggleSidebar('info')
			});
		}
		if (supportsMemory) {
			actions.push({
				id: 'memory',
				kind: 'tab',
				name: 'Memory',
				label: 'Memory',
				icon: BookOpenIcon,
				pressed: sidebarOpen && sidebarTab === 'memory',
				onclick: () => toggleSidebar('memory')
			});
		}
		// A shell on this backend in the project's folder, on a page of its own (zellij sessions, tabs, a phone key bar).
		if (project && backend.supports('terminal')) {
			actions.push({
				id: 'terminal',
				kind: 'tab',
				name: 'Terminal',
				title: 'A terminal on this backend, in the project folder',
				label: 'Terminal',
				icon: TerminalIcon,
				href: terminalHref(backend.id, { projectId: project.id })
			});
		}
		return actions;
	});

	/** The mute bell and the settings gear: icons at every width, and the first things the menu takes over. */
	const utilityActions = $derived.by((): HeaderAction[] => {
		const actions: HeaderAction[] = [];
		if (project && supportsNotifications) {
			actions.push({
				id: 'mute',
				kind: 'utility',
				name: muted ? 'Unmute notifications for this project' : 'Mute notifications for this project',
				title: muted ? 'Notifications muted for this project' : 'Notifications are on for this project',
				menuLabel: muted ? 'Unmute notifications' : 'Mute notifications',
				icon: muted ? BellOffIcon : BellIcon,
				pressed: muted,
				onclick: () => void toggleProjectMute()
			});
		}
		if (project && (backend.supports('models') || backend.supports('credentials') || backend.supports('logins'))) {
			actions.push({
				id: 'settings',
				kind: 'utility',
				name: 'Project settings',
				menuLabel: 'Project settings',
				icon: SettingsIcon,
				href: projectSettingsHref(backend.id, project.id),
				onclick: () => (headerMenuOpen = false)
			});
		}
		return actions;
	});

	const headerActions = $derived([...tabActions, ...utilityActions]);
	/** Labels where they fit beside the project's name, icons where they do not, and a menu when even those are too many. */
	const headerRowLayout = $derived(headerLayout(headerWidth, headerActions));
	const shownHeaderActions = $derived(visibleHeaderActions(headerRowLayout, headerActions));
	const shownTabActions = $derived(shownHeaderActions.inline.filter((action) => action.kind === 'tab'));
	const shownUtilityActions = $derived(shownHeaderActions.inline.filter((action) => action.kind === 'utility'));
	/** A dropped connection is worth a mark on the menu, which is the only place it shows on a phone. */
	const connectionTone = $derived(connectionView(backend.connection).tone);

	function pickHeaderAction(action: HeaderAction): void {
		headerMenuOpen = false;
		action.onclick?.();
	}

	onMount(() => {
		void backend.ensureLoaded();
		const timer = setInterval(() => (now = Date.now()), 15_000);
		// The server does not push its status, and a disk fills during a long run: read it again now and then.
		const statusTimer = setInterval(() => {
			if (backend.ready && backend.supports('server-status')) void backend.refreshServerStatus();
		}, SERVER_STATUS_REFRESH_MS);
		return () => {
			clearInterval(timer);
			clearInterval(statusTimer);
		};
	});

	$effect(() => {
		const id = projectId;
		if (id.length === 0 || !backend.supports('conversation')) {
			session = undefined;
			return;
		}
		const created = backend.watchProject(id, { min: 50, max: 100 }, threadId);
		session = created;
		const held = new WaitingMessages({
			client: backend.client,
			projectId: id,
			...(threadId === undefined ? {} : { threadId }),
			supported: () => backend.supports('queued-inputs'),
			busy: () => busy,
			restore: (text, task, images, files) => composer?.restore(text, task, images, files),
			notify: (message) => (sendError = message)
		});
		waiting = held;
		return () => {
			created.stop();
			held.stop();
			if (session === created) session = undefined;
			if (waiting === held) waiting = undefined;
		};
	});

	// What the run placed and what left the queue unplaced, from each new view.
	$effect(() => {
		const current = session;
		const held = waiting;
		if (current === undefined || held === undefined) return;
		const view = current.view;
		const entries = current.entries;
		const live = current.status === 'live';
		untrack(() => held.observe(view, entries, live));
	});

	function onWaiting(key: string, action: 'edit' | 'cancel' | 'retry'): void {
		if (action === 'retry') void waiting?.retry(key);
		else void waiting?.withdraw(key, action === 'edit');
	}

	$effect(() => {
		const id = projectId;
		if (id.length === 0 || !backend.supports('workers')) {
			workers = undefined;
			return;
		}
		const created = backend.watchWorkers(id, threadId);
		workers = created;
		return () => {
			created.stop();
			if (workers === created) workers = undefined;
		};
	});

	$effect(() => {
		const id = projectId;
		if (id.length === 0 || !backend.supports('context')) {
			projectContext = undefined;
			return;
		}
		const created = backend.watchContext(id, undefined, threadId);
		projectContext = created;
		return () => {
			created.stop();
			if (projectContext === created) projectContext = undefined;
		};
	});

	// `supportsMemory` is derived, so a reconnect's identical feature list does not recreate the panel and drop the
	// open file and the archived toggle.
	$effect(() => {
		const id = projectId;
		if (id.length === 0 || !supportsMemory) {
			memory = undefined;
			return;
		}
		const created = backend.watchMemory(id, { maintenance: backend.supports('memory-maintenance') });
		memory = created;
		return () => {
			created.stop();
			if (memory === created) memory = undefined;
		};
	});

	// `supportsBoard` is derived, so a reconnect's identical feature list does not recreate the board.
	$effect(() => {
		const id = projectId;
		if (id.length === 0 || !supportsBoard) {
			board = undefined;
			return;
		}
		const created = backend.watchBoard(id);
		board = created;
		return () => {
			created.stop();
			if (board === created) board = undefined;
		};
	});

	$effect(() => {
		const id = projectId;
		if (id.length === 0 || !supportsRefStatus) {
			refStatus = undefined;
			return;
		}
		const created = new ProjectRefStatus(backend.client, id);
		refStatus = created;
		return () => {
			created.stop();
			if (refStatus === created) refStatus = undefined;
		};
	});

	$effect(() => {
		refStatus?.want((board?.tasks ?? []).flatMap((task) => taskRefs(task)));
	});

	// `supportsThreads` is derived, so a reconnect's identical feature list does not recreate the list.
	$effect(() => {
		const id = projectId;
		if (id.length === 0 || !supportsThreads) {
			threads = undefined;
			return;
		}
		const created = backend.watchThreads(id);
		threads = created;
		return () => {
			created.stop();
			if (threads === created) threads = undefined;
		};
	});

	function openBoard(): void {
		sidebarTab = 'board';
		sidebarOpen = true;
		sidebarExpanded = false;
	}

	// `supportsSchedules` is derived, so a reconnect's identical feature list does not recreate the list.
	$effect(() => {
		const id = projectId;
		if (id.length === 0 || !supportsSchedules) {
			schedules = undefined;
			return;
		}
		const created = backend.watchSchedules(id);
		schedules = created;
		return () => {
			created.stop();
			if (schedules === created) schedules = undefined;
		};
	});

	function scheduleTitle(scheduleId: string): string | undefined {
		return schedules?.title(scheduleId);
	}

	/** The memories a compaction saved: read from the scope histories the Memory tab already holds, never a request. */
	function extractionFor(entryId: number): MemoryExtraction | undefined {
		if (memory === undefined || !memory.maintenanceEnabled) return undefined;
		// Only the shown scope's files are loaded, so a topic in the other scope shows its file ID until it is opened.
		const filesOf = (scope: MemoryScope) => (memory?.scope === scope ? memory.files : []);
		return memoryExtractionFor(
			[
				{ scope: 'global', changes: memory.history.global, files: filesOf('global') },
				{ scope: 'project', changes: memory.history.project, files: filesOf('project') }
			],
			entryId
		);
	}

	/** A topic a compaction saved opens in the Memory tab, in the scope it was written in. */
	function openMemoryTopic(fileId: string, scope: MemoryScope): void {
		sidebarTab = 'memory';
		sidebarOpen = true;
		sidebarExpanded = false;
		void memory?.open(fileId, scope);
	}

	/** Undo takes the whole extraction commit; the row or the marker says why when it is refused. */
	function undoMemory(scope: MemoryScope, commit: string): void {
		void memory?.undo(scope, commit);
	}

	function undoErrorFor(commit: string): string | undefined {
		return memory?.undoError?.commit === commit ? memory.undoError.message : undefined;
	}

	// A history row's "compaction at entry #N" link lands on that marker: `#entry-<id>` is its id in the transcript.
	$effect(() => {
		const jump = (): void => {
			const match = /^#entry-(\d+)$/.exec(window.location.hash);
			if (match === null) return;
			requestAnimationFrame(() => {
				document.getElementById(`entry-${match[1]}`)?.scrollIntoView({ block: 'center' });
			});
		};
		jump();
		window.addEventListener('hashchange', jump);
		return () => window.removeEventListener('hashchange', jump);
	});

	/**
	 * A notification about a background thread opens main at `#thread-<id>`: scroll its newest card into view and make
	 * it glow. A card older than the loaded window is paged in, a few pages at most.
	 */
	let highlightedThread = $state<string | undefined>(undefined);
	$effect(() => {
		if (isThread) return;
		const jump = (): void => {
			const target = threadFromAnchor(window.location.hash);
			if (target !== undefined) highlightedThread = target;
		};
		jump();
		window.addEventListener('hashchange', jump);
		return () => window.removeEventListener('hashchange', jump);
	});
	$effect(() => {
		const target = highlightedThread;
		const current = session;
		if (target === undefined || current === undefined || current.status !== 'live') return;
		let cancelled = false;
		let pages = 0;
		const find = async (): Promise<void> => {
			while (!cancelled) {
				await new Promise((resolve) => requestAnimationFrame(resolve));
				const cards = document.querySelectorAll<HTMLElement>(`[data-thread-card="${CSS.escape(target)}"]`);
				const card = cards[cards.length - 1];
				if (card !== undefined) {
					card.scrollIntoView({ block: 'center', behavior: 'smooth' });
					card.classList.remove('thread-glow');
					void card.offsetWidth;
					card.classList.add('thread-glow');
					setTimeout(() => card.classList.remove('thread-glow'), 2600);
					break;
				}
				if (!current.canLoadEarlier || pages >= 4) break;
				pages += 1;
				await current.loadEarlier();
			}
			if (!cancelled) highlightedThread = undefined;
		};
		void find();
		return () => {
			cancelled = true;
		};
	});

	function toggleSidebar(target: SidebarTab): void {
		if (sidebarOpen && sidebarTab === target) {
			sidebarOpen = false;
			sidebarExpanded = false;
			return;
		}
		sidebarTab = target;
		sidebarOpen = true;
		// Tasks open the way this device last looked at them: the list beside the chat, or the board full width.
		sidebarExpanded = target === 'board' && supportsTasks && tasksView.mode !== 'list';
	}

	/** The task sheet's "Show with linked": the task list, filtered to that task and everything linked to it. */
	function showLinkedTasks(taskId: string): void {
		taskFilter.focusOn(taskId);
		sidebarTab = 'board';
		sidebarOpen = true;
		sidebarExpanded = supportsTasks && tasksView.mode !== 'list';
	}

	/** A reason for a move on a backend whose saves carry no note: it goes to main as a message about the task. */
	async function sendTaskReason(taskId: string, text: string): Promise<void> {
		await backend.client.submit(projectId, text, { whenBusy: 'steer', taskId });
	}

	function workerLink(worker: { id: string }): string {
		return workerHref(backend.id, projectId, worker.id, threadId);
	}

	function taskLink(taskId: string): string {
		return withTask(page.url, taskId);
	}

	/** Text selected in the transcript or a task, quoted in the message being written. */
	function quote(text: string): void {
		composer?.addQuote(text);
	}

	async function send(text: string, taskId?: string, images: HeldImage[] = [], files: ChatFile[] = []): Promise<boolean> {
		const body = text.trim();
		if (body.length === 0 && images.length === 0 && files.length === 0) return true;
		if (!canChat) {
			sendError = 'Choose a coordinator model in the composer before sending.';
			return false;
		}
		if (!canSend) {
			sendError = 'The backend connection is not ready; waiting to reconnect.';
			return false;
		}
		sendError = undefined;
		transcript?.follow();
		// The pick rides on the message until the backend confirms it stores one; without a loaded list it would clear the
		// choice another device made.
		const defaults =
			!isThread && workers !== undefined && shouldSendWorkerDefaults(workers.loaded, workers.defaultsSupport)
				? workers.defaults
				: undefined;
		try {
			// Reaches a busy coordinator at its next tool boundary instead of waiting for the whole turn to end, so the
			// user is never stuck behind a long-running tool call.
			const options = {
				whenBusy: 'steer' as const,
				...(threadId === undefined ? {} : { threadId }),
				...(defaults === undefined
					? {}
					: { workerModel: defaults.model, workerThinkingLevel: defaults.thinkingLevel }),
			};
			if (waiting?.supported === true) {
				// A failure stays on the message's own bubble with its text and a Retry, not in the composer.
				await waiting.send(body, taskId, { ...options, fileIds: files.map(file => file.id) }, images, files);
				return true;
			}
			await backend.client.submit(projectId, inputContent(body, images), { ...options, fileIds: files.map(file => file.id), ...(taskId === undefined ? {} : { taskId }) });
			return true;
		} catch (error) {
			sendError = errorText(error);
			return false;
		}
	}

	async function stop(): Promise<void> {
		aborting = true;
		sendError = undefined;
		try {
			await backend.client.abort(projectId, threadId === undefined ? {} : { threadId });
		} catch (error) {
			sendError = errorText(error);
		} finally {
			aborting = false;
		}
	}

	async function loadEarlier(): Promise<void> {
		const current = session;
		await current?.loadEarlier();
		if (current?.watch.earlierError) throw new Error(current.watch.earlierError);
	}

	/** Changing the model drops a thinking level the new model does not offer. */
	async function changeModel(model: ModelInfo): Promise<void> {
		if (project === undefined) return;
		modelError = undefined;
		const level = project.coordinator.thinkingLevel;
		const keep = level !== null && model.thinkingLevels.includes(level);
		try {
			await backend.configureProject(projectId, {
				coordinatorModel: { provider: model.provider, modelId: model.modelId },
				...(keep ? {} : { coordinatorThinkingLevel: null }),
			});
		} catch (error) {
			modelError = errorText(error);
		}
	}

	async function changeThinkingLevel(level: ThinkingLevel | null): Promise<void> {
		modelError = undefined;
		try {
			await backend.configureProject(projectId, { coordinatorThinkingLevel: level });
		} catch (error) {
			modelError = errorText(error);
		}
	}

	/**
	 * The worker picker is optimistic and saves at once (`workers.defaults.set`); a backend from before that request
	 * keeps the choice on the next message instead. The server pushes the stored choice back to every device.
	 */
	function changeWorkerModel(model: ModelInfo | null): void {
		if (workers === undefined) return;
		const level = workers.defaults.thinkingLevel;
		const keep = model !== null && level !== null && model.thinkingLevels.includes(level);
		void workers.pick(
			model === null ? null : { provider: model.provider, modelId: model.modelId },
			keep ? level : null
		);
	}

	function changeWorkerThinking(level: ThinkingLevel | null): void {
		void workers?.pick(workers.defaults.model, level);
	}
</script>

{#snippet emptyState()}
	{#if isThread}
		<EmptyState
			title={thread?.title || 'Background thread'}
			subtitle="A background thread of main. It reports to main when it finishes; type here to steer it directly."
		/>
	{:else}
		<EmptyState
			title={project?.name ?? 'Ready'}
			subtitle="Send a message to start the coordinator. It plans, delegates and reviews."
		/>
	{/if}
{/snippet}

{#snippet threadArtifacts(id: string, finishedAt: number | undefined)}
	{#if backend.supports('artifacts')}
		<ArtifactStrip {backend} {projectId} filters={{ threadId: id }} savedUntil={finishedAt} class="mt-2" />
	{/if}
{/snippet}

{#snippet headerButton(action: HeaderAction)}
	{@const labelled = headerActionShowsLabel(headerRowLayout, action)}
	{@const badgeClass =
		'grid min-w-4 place-items-center rounded-full px-1 text-[0.625rem] font-semibold text-white'}
	<Button
		variant="ghost"
		size={labelled ? 'sm' : 'icon-sm'}
		class={labelled ? 'shrink-0' : 'relative shrink-0'}
		href={action.href}
		onclick={action.onclick}
		aria-label={action.name}
		title={action.title ?? action.name}
		aria-pressed={action.pressed}
	>
		<action.icon class="size-4" />
		{#if action.count !== undefined}
			<span
				class={labelled ? `h-4 ${badgeClass}` : `absolute -top-0.5 -right-0.5 ${badgeClass}`}
				style:background={action.tone === 'primary' ? 'var(--primary)' : 'var(--accent-2)'}
			>
				{action.count}
			</span>
		{/if}
		{#if labelled && action.label}{action.label}{/if}
	</Button>
{/snippet}

{#snippet headerMenuRow(action: HeaderAction)}
	<Button
		variant="ghost"
		size="sm"
		class="h-8 w-full justify-start gap-2 px-2 font-normal"
		href={action.href}
		onclick={() => pickHeaderAction(action)}
		aria-label={action.name}
		aria-pressed={action.pressed}
	>
		<action.icon class="size-4 shrink-0 text-(--chat-fg-subtle)" />
		<span class="min-w-0 flex-1 truncate text-left">{action.menuLabel ?? action.label ?? action.name}</span>
		{#if action.count !== undefined}
			<span
				class="grid min-w-4 place-items-center rounded-full px-1 text-[0.625rem] font-semibold text-white"
				style:background={action.tone === 'primary' ? 'var(--primary)' : 'var(--accent-2)'}
			>
				{action.count}
			</span>
		{/if}
	</Button>
{/snippet}

<div class="flex h-full w-full overflow-hidden">
	<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<header
				class="relative z-10 flex {CHAT_COLUMN_CLASS} shrink-0 flex-col gap-0.5 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1 sm:px-3"
			>
				<div class="flex h-12 min-w-0 items-center gap-1" bind:this={headerRow}>
					<ProjectsMenuButton />
					{#if isThread}
						<Button
							href={projectHref(backend.id, projectId)}
							variant="ghost"
							size="icon-sm"
							aria-label="Back to main"
							title="Back to main"
						>
							<ArrowLeftIcon />
						</Button>
						<span class="thread-icon hidden size-7 shrink-0 place-items-center rounded-lg sm:grid" aria-hidden="true">
							<LayersIcon class="size-3.5" />
						</span>
						<h1 class="min-w-0 flex-1 truncate px-1.5 text-[0.9375rem] font-semibold">
							{thread?.title || threadId}
						</h1>
						{#if thread}
							<ThreadStatusBadge status={thread.status} class="hidden shrink-0 sm:inline-flex" />
						{/if}
					{:else}
						<h1 class="min-w-0 flex-1 truncate px-1.5 text-[0.9375rem] font-semibold">
							{project?.name ?? 'Project'}
						</h1>
					{/if}
					{#each shownTabActions as action (action.id)}
						{@render headerButton(action)}
					{/each}
					{#if headerRowLayout !== 'menu'}
						<ConnectionBadge {backend} />
					{:else}
						<!-- The rest of the row, one tap away: every tab but the board and the workers, the bell and the gear. -->
						<Popover.Root bind:open={headerMenuOpen}>
							<Popover.Trigger
								class="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground"
								aria-label="More actions"
								title="More actions"
							>
								<EllipsisIcon class="size-4" />
								{#if connectionTone !== 'ok'}
									<span class="absolute top-1 right-1 size-1.5 rounded-full {connectionDotClass(connectionTone)}"></span>
								{/if}
							</Popover.Trigger>
							<Popover.Content side="bottom" align="end" class="w-60 gap-1 p-1">
								{#each shownHeaderActions.menu as action (action.id)}
									{@render headerMenuRow(action)}
								{/each}
								<Separator class="my-1" />
								<div class="flex flex-col items-start gap-1 px-2 py-1 text-xs text-(--chat-fg-subtle)">
									<ConnectionBadge {backend} />
									{#if backend.supports('server-status') && backend.status?.release !== undefined}
										<ReleaseLine release={backend.status.release} deploy={backend.status.deploy} compact />
									{/if}
								</div>
							</Popover.Content>
						</Popover.Root>
					{/if}
					{#each shownUtilityActions as action (action.id)}
						{@render headerButton(action)}
					{/each}
				</div>
				<div class="flex min-w-0 items-center gap-x-2 overflow-hidden px-2 text-xs text-(--chat-fg-subtle)">
					{#if isThread}
						<span class="min-w-0 truncate">
							Background thread of
							<a class="font-medium text-(--chat-fg-muted) underline-offset-2 hover:underline" href={projectHref(backend.id, projectId)}
								>main</a
							>{project ? ` · ${project.name}` : ''}
						</span>
						{#if thread?.model}
							<span class="shrink-0">·</span>
							<span class="min-w-0 truncate">{modelLabel(thread.model, backend.models)}</span>
						{/if}
					{:else}
						<span class="min-w-0 truncate">{backend.name}</span>
						{#if project}
							<span class="shrink-0">·</span>
							<span class="min-w-0 truncate">{modelLabel(project.coordinator.model, backend.models)}</span>
						{/if}
					{/if}
					{#if runningToolLabel !== undefined}
						<span class="shrink-0">·</span>
						<span class="min-w-0 truncate text-(--chat-fg-muted)" title={isThread ? "What this thread does now" : "The coordinator's current tool call"}
							>{runningToolLabel}</span
						>
					{/if}
					<!-- The release is in the menu on a phone: the line stays one line, and its commit is still one tap away. -->
					{#if headerRowLayout !== 'menu' && backend.supports('server-status') && backend.status?.release !== undefined}
						<span class="shrink-0">·</span>
						<ReleaseLine release={backend.status.release} deploy={backend.status.deploy} compact class="shrink-0" />
					{/if}
					{#if session && session.status !== 'live'}
						<span class="shrink-0">·</span>
						<span class="text-(--chat-warning)">{session.status}</span>
					{/if}
				</div>
			</header>

				{#key session}
				<TranscriptColumn
					bind:this={transcript}
					{items}
					cwd={project?.path}
					workers={workerList}
					workerHref={(worker) => workerLink(worker)}
					scheduleName={scheduleTitle}
					reportHref={(workerId) => workerHref(backend.id, projectId, workerId, threadId)}
					{threadCards}
					canLoadEarlier={session?.canLoadEarlier ?? false}
					loadingEarlier={session?.loadingEarlier ?? false}
					onLoadEarlier={loadEarlier}
					{working}
					{extractionFor}
					onopentopic={openMemoryTopic}
					onopenboard={supportsBoard ? openBoard : undefined}
					onundo={undoMemory}
					{undoErrorFor}
					empty={empty ? emptyState : undefined}
					onquote={backend.supports('conversation') ? quote : undefined}
					onwaiting={onWaiting}
					waitingTarget={isThread ? 'thread' : 'coordinator'}
				/>
				{/key}

				<div class="{CHAT_COLUMN_CLASS} shrink-0 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:px-4 sm:pb-4">
					<div class="mb-2 flex flex-col gap-2">
						{#if backend.supports('server-status')}
							<ReleaseUpdateBanner {backend} />
							<DeployBanner
								status={backend.status}
								dismissed={harness.dismissedDeploys}
								ondismiss={(deploy) => harness.dismissDeploy(deploy)}
							/>
							<DiskBanner
								status={backend.status}
								settingsHref={backend.supports('storage') ? projectSettingsHref(backend.id, projectId, 'storage') : undefined}
							/>
						{/if}

						{#if backend.lastError}
							<Banner tone="error">{backend.lastError}</Banner>
						{/if}

						{#if !backend.supports('conversation')}
							<Banner tone="warning">This backend does not advertise conversations.</Banner>
						{/if}

						{#if project?.archived === true}
							<ArchivedBanner {backend} {projectId} />
						{/if}

						{#if project?.state === 'failed'}
							<Banner tone="error">{project.failure ?? 'The project failed to open.'}</Banner>
						{/if}

						{#if !isThread && project !== undefined && project.coordinator.model === null && backend.supports('models')}
							<Banner tone="warning">
								This project has no coordinator model. Pick one in the composer, or
								<a class="underline" href={projectSettingsHref(backend.id, project.id, 'coordinator')}>choose one in settings</a>, before sending
								a message.
							</Banner>
						{/if}

						{#if session && session.status !== 'live'}
							<Banner tone="warning">
								{#if session.status === 'connecting'}
									Connecting to the transcript…
								{:else if session.status === 'reconnecting'}
									Reconnecting to the transcript…{session.error ? ` ${session.error}` : ''}
								{:else if session.status === 'ended'}
									The transcript view stopped.{session.error ? ` ${session.error}` : ''}
								{:else}
									The transcript view is stopped.
								{/if}
							</Banner>
						{/if}

						{#if modelError}
							<Banner tone="error">{modelError}</Banner>
						{/if}
						{#if workers?.defaultsError}
							<Banner tone="error">{workers.defaultsError}</Banner>
						{/if}
						{#if sendError}
							<Banner tone="error">{sendError}</Banner>
						{/if}
						{#if board !== undefined && questionsWaiting > 0 && !(sidebarOpen && sidebarTab === 'board')}
							<BoardQuestionPin
								{board}
								threads={threadList}
								{threadId}
								tasksView={supportsTasks}
								taskHref={supportsTasks ? taskLink : undefined}
								onopenboard={openBoard}
							/>
						{/if}
					</div>

					{#if backend.supports('conversation')}
						<!-- Keyed by chat: the page stays mounted when the route changes to another project or thread. -->
						{#key draftKey(backend.id, projectId, threadId)}
						<Composer
							bind:this={composer}
							draftKey={draftKey(backend.id, projectId, threadId)}
							draftChannel={draftChannel(backend, projectId, threadId)}
							models={backend.models}
							providers={backend.providers}
							model={project?.coordinator.model ?? null}
							thinkingLevel={project?.coordinator.thinkingLevel ?? null}
							{thinkingLevels}
							workerModels={backend.models}
							workerProviders={backend.providers}
							workerModel={workerDefaults.model}
							workerThinkingLevel={workerDefaults.thinkingLevel}
							showWorkerPicker={supportsWorkers && canPickModel && !isThread}
							showModelPicker={!isThread}
							modelNote={isThread && thread?.model ? `Runs on ${modelLabel(thread.model, backend.models)}` : undefined}
							workerPickerDisabled={workers?.loaded !== true}
							tasks={taskChoices}
							busy={busy || aborting}
							disabled={!canSend}
							placeholder={!canChat
								? 'Choose a coordinator model first'
								: !backend.ready
									? 'Reconnecting…'
									: isThread
										? 'Message this thread directly…'
										: undefined}
							onModelChange={changeModel}
							onThinkingChange={changeThinkingLevel}
							onWorkerModelChange={changeWorkerModel}
							onWorkerThinkingChange={changeWorkerThinking}
							uploadFile={backend.supports('chat-files-v1') ? uploadFile : undefined}
							onsend={send}
							onstop={stop}
						/>
						{/key}
					{/if}
				</div>
			</div>

			{#if supportsSidebar}
				<ConversationSidebar
					bind:open={sidebarOpen}
					bind:tab={sidebarTab}
					bind:expanded={sidebarExpanded}
					tabs={sidebarTabs}
					badges={{ board: questionsWaiting, background: backgroundActive }}
					labels={{ board: boardTabName }}
					label="Project sidebar"
				>
					{#snippet boardPanel(fullWidth: boolean)}
						{#if supportsTasks && fullWidth}
							<TasksView
								{board}
								workers={workerList}
								graphWorkers={workers?.allWorkers ?? []}
								scope={`${backend.id}:${projectId}`}
								threads={threadList}
								workerHref={(worker) => workerLink(worker)}
								taskHref={taskLink}
								canNote={backend.supports('board-moves')}
								onsendreason={backend.supports('conversation') ? sendTaskReason : undefined}
							/>
						{:else if supportsTasks}
							<TasksPanel {board} threads={threadList} workers={workerList} workerHref={(worker) => workerLink(worker)} taskHref={taskLink} />
						{:else}
							<BoardPanel {board} workers={workerList} threads={threadList} hrefOf={(worker) => workerLink(worker)} />
						{/if}
					{/snippet}
					{#snippet backgroundPanel()}
						<BackgroundPanel
							{threads}
							hrefOf={(id) => threadHref(backend.id, projectId, id)}
							scheduleName={scheduleTitle}
							{now}
						/>
					{/snippet}
					{#snippet infoPanel()}
						<ContextPanel
							context={projectContext?.context}
							loaded={projectContext?.loaded ?? false}
							error={projectContext?.error}
							canCompact={project !== undefined &&
								project.coordinator.model !== null &&
								backend.supports('conversation')}
							compacting={projectContext?.compacting ?? false}
							compactError={projectContext?.compactError}
							oncompact={(instructions) => projectContext?.compact(instructions)}
						>
							{#snippet extra()}
								{#if backend.supports('artifacts')}
									<ArtifactsSection client={backend.client} {projectId} filter={{ threadId: threadId ?? 'main' }} />
								{/if}
							{/snippet}
						</ContextPanel>
					{/snippet}
					{#snippet memoryPanel()}
						<MemoryPanel {memory} hrefForProject={(id) => projectHref(backend.id, id)} />
					{/snippet}
			</ConversationSidebar>
		{/if}
	</div>

	<RefCardHost
		readDetails={backend.supports('ref-details') ? (ref) => backend.client.readRefDetails(projectId, ref) : undefined}
		tasks={() => board?.tasks ?? []}
	/>

	{#if supportsTasks}
		<TaskSheet {backend} {projectId} {board} workers={workerList} threads={threadList} workerHref={(worker) => workerLink(worker)} onquote={backend.supports('conversation') ? quote : undefined} onshowlinked={showLinkedTasks} />
	{/if}

<style>
	.thread-icon {
		color: var(--primary);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
	}
</style>
