<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ListIcon from '@lucide/svelte/icons/list';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import XIcon from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import Banner from '#lib/components/Banner.svelte';
	import ConnectionBadge from '#lib/components/ConnectionBadge.svelte';
	import ProjectsMenuButton from '#lib/components/ProjectsMenuButton.svelte';
	import TerminalView from '#lib/components/terminal/TerminalView.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { projectHref } from '#lib/backends.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import {
		MAX_TERMINAL_TABS,
		TERMINAL_TABS_STORAGE_KEY,
		keyboardVisibleHeight,
		newTabId,
		parseTabs,
		reconcileTabs,
		sessionForPrefix,
		terminalTarget,
		type TerminalTab
	} from '#lib/terminal.js';
	import type { TerminalListResponse } from '@kemiri/protocol';

	/**
	 * A backend's terminals as one page: tabs for the terminals this browser has attached, a list of the backend's other
	 * zellij sessions to attach (or end), and the phone's key bar. Arriving from a project or one of its workers opens
	 * (or finds) that project's session in the right folder. The tabs are remembered per backend, so a reload or a
	 * returning visit reattaches them.
	 */
	let {
		backend,
		projectId,
		workerId,
		sessionName
	}: { backend: BackendConnection; projectId?: string; workerId?: string; sessionName?: string } = $props();

	const project = $derived(projectId === undefined ? undefined : backend.projects.find((entry) => entry.id === projectId));

	let listing = $state<TerminalListResponse | undefined>(undefined);
	let listError = $state<string | undefined>(undefined);
	let tabs = $state<TerminalTab[]>([]);
	let activeId = $state<string | null>(null);
	let restored = $state(false);
	let sessionsOpen = $state(false);
	/** The session whose "End" was pressed once: a second press confirms. */
	let confirmEnd = $state<string | undefined>(undefined);
	let endError = $state<string | undefined>(undefined);
	/** The viewport's visible height while a soft keyboard is up, so the terminal ends above it. */
	let visibleHeight = $state<number | undefined>(undefined);
	let narrow = $state(false);
	let coarse = $state(false);

	/** The phone's key bar: where there is no physical keyboard, or the screen is narrow. */
	const showKeyBar = $derived(narrow || coarse);
	const unavailable = $derived(listing !== undefined && !listing.available);
	const openSessions = $derived(new Set(tabs.map((tab) => tab.session).filter((name): name is string => name !== undefined)));
	const otherSessions = $derived((listing?.sessions ?? []).filter((session) => !openSessions.has(session.name)));
	const backHref = $derived(projectId === undefined ? '/' : projectHref(backend.id, projectId));
	const subtitle = $derived(
		project === undefined ? backend.name : `${backend.name} · ${project.name}${workerId === undefined ? '' : ` · ${workerId}`}`
	);

	function remember(): void {
		try {
			const stored = parseTabs(localStorage.getItem(TERMINAL_TABS_STORAGE_KEY));
			stored[backend.id] = {
				tabs: $state.snapshot(tabs).filter((tab) => tab.session !== undefined),
				active: activeId
			};
			localStorage.setItem(TERMINAL_TABS_STORAGE_KEY, JSON.stringify(stored));
		} catch {
			// Storage can be full or disabled; the tabs still work for this visit.
		}
	}

	async function refreshListing(): Promise<void> {
		try {
			listing = await backend.client.readTerminals();
			listError = undefined;
		} catch (error) {
			listError = error instanceof Error ? error.message : String(error);
		}
	}

	/** First load: what the backend offers, the tabs this browser had, and the one the link asks for. */
	async function restore(): Promise<void> {
		await refreshListing();
		if (listing === undefined || !listing.available) {
			restored = true;
			return;
		}
		const stored = parseTabs(localStorage.getItem(TERMINAL_TABS_STORAGE_KEY))[backend.id] ?? { tabs: [], active: null };
		const kept = reconcileTabs(stored, listing.sessions);
		tabs = kept.tabs;
		activeId = kept.active;

		if (sessionName !== undefined) {
			attachSession(sessionName);
		} else if (projectId !== undefined || tabs.length === 0 && listing.sessions.length === 0) {
			const target = terminalTarget(project, workerId === undefined ? undefined : { id: workerId, workspacePath: workerWorkspace() });
			const existing = sessionForPrefix(listing.sessions, target.prefix);
			if (existing !== undefined) attachSession(existing, target.title);
			else newTab(target);
		}
		restored = true;
		remember();
	}

	/** The worker's folder: it is on the project's worker list, which the page asks for once when the link names a worker. */
	let workspaceOfWorker = $state<string | null | undefined>(undefined);
	function workerWorkspace(): string | null {
		return workspaceOfWorker ?? null;
	}

	async function loadWorker(): Promise<void> {
		if (projectId === undefined || workerId === undefined || !backend.supports('workers')) return;
		try {
			const response = await backend.client.listWorkers(projectId);
			workspaceOfWorker = response.workers.find((worker) => worker.id === workerId)?.workspacePath ?? null;
		} catch {
			workspaceOfWorker = null;
		}
	}

	function add(tab: TerminalTab): void {
		if (tabs.length >= MAX_TERMINAL_TABS) {
			endError = `A page keeps at most ${MAX_TERMINAL_TABS} terminals open; close one first.`;
			return;
		}
		endError = undefined;
		tabs = [...tabs, tab];
		activeId = tab.id;
		remember();
	}

	/** A new session, made from the prefix in the folder. */
	function newTab(target = terminalTarget(project, workerId === undefined ? undefined : { id: workerId, workspacePath: workerWorkspace() })): void {
		add({ id: newTabId(), title: target.title, prefix: target.prefix, ...(target.cwd === undefined ? {} : { cwd: target.cwd }) });
	}

	/** A session that exists, in a tab of its own (or the tab that has it). */
	function attachSession(name: string, title?: string): void {
		const existing = tabs.find((tab) => tab.session === name);
		if (existing !== undefined) {
			activeId = existing.id;
			remember();
			return;
		}
		sessionsOpen = false;
		add({ id: newTabId(), session: name, title: title ?? name });
	}

	function closeTab(id: string): void {
		const index = tabs.findIndex((tab) => tab.id === id);
		if (index < 0) return;
		tabs = tabs.filter((tab) => tab.id !== id);
		if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
		remember();
		void refreshListing();
	}

	/** Where a session ended, start a new one with the same prefix and folder. */
	function restartTab(tab: TerminalTab): void {
		const target = terminalTarget(project, workerId === undefined ? undefined : { id: workerId, workspacePath: workerWorkspace() });
		closeTab(tab.id);
		newTab({ ...target, prefix: tab.prefix ?? target.prefix });
	}

	function nameSession(tab: TerminalTab, session: string): void {
		if (tab.session === session) return;
		tabs = tabs.map((entry) => (entry.id === tab.id ? { ...entry, session } : entry));
		remember();
		void refreshListing();
	}

	async function endSession(name: string): Promise<void> {
		if (confirmEnd !== name) {
			confirmEnd = name;
			return;
		}
		confirmEnd = undefined;
		try {
			await backend.client.killTerminalSession(name);
			endError = undefined;
		} catch (error) {
			endError = error instanceof Error ? error.message : String(error);
		}
		tabs = tabs.filter((tab) => tab.session !== name);
		if (!tabs.some((tab) => tab.id === activeId)) activeId = tabs[0]?.id ?? null;
		remember();
		await refreshListing();
	}

	function selectTab(id: string): void {
		activeId = id;
		remember();
	}

	// The viewport: below the soft keyboard on a phone, by the visual viewport's own height.
	onMount(() => {
		const query = window.matchMedia('(max-width: 640px)');
		const pointer = window.matchMedia('(pointer: coarse)');
		const syncMedia = (): void => {
			narrow = query.matches;
			coarse = pointer.matches;
		};
		syncMedia();
		query.addEventListener('change', syncMedia);
		pointer.addEventListener('change', syncMedia);
		const viewport = window.visualViewport;
		const syncViewport = (): void => {
			if (viewport === null) return;
			visibleHeight = keyboardVisibleHeight(window.innerHeight, viewport.height, viewport.scale);
			// The browser may scroll the page to keep the focused field in view; the terminal sits at the top.
			if (visibleHeight !== undefined) window.scrollTo(0, 0);
		};
		syncViewport();
		viewport?.addEventListener('resize', syncViewport);
		viewport?.addEventListener('scroll', syncViewport);
		void backend.ensureLoaded();
		return () => {
			query.removeEventListener('change', syncMedia);
			pointer.removeEventListener('change', syncMedia);
			viewport?.removeEventListener('resize', syncViewport);
			viewport?.removeEventListener('scroll', syncViewport);
		};
	});

	// Start once the backend answers, and again after a restart: the list is what the backend has now.
	let started = false;
	$effect(() => {
		if (!backend.ready || !backend.supports('terminal')) return;
		if (!started) {
			started = true;
			void loadWorker().then(() => restore());
		} else {
			void refreshListing();
		}
	});
</script>

<div
	class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
	style:height={visibleHeight === undefined ? undefined : `${visibleHeight}px`}
	style:flex={visibleHeight === undefined ? undefined : 'none'}
>
	<header class="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 pt-[env(safe-area-inset-top)] sm:px-3">
		<ProjectsMenuButton />
		<Button href={backHref} variant="ghost" size="icon-sm" aria-label={projectId === undefined ? 'Back to projects' : 'Back to the project'} title="Back">
			<ArrowLeftIcon />
		</Button>
		<TerminalIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="flex min-w-0 flex-1 flex-col leading-tight">
			<h1 class="truncate text-[0.9375rem] font-semibold">Terminal</h1>
			<span class="truncate text-xs text-(--chat-fg-subtle)">{subtitle}</span>
		</div>
		<Popover.Root bind:open={sessionsOpen}>
			<Popover.Trigger
				class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted"
				aria-label="Sessions on this backend"
				title="Sessions on this backend"
			>
				<ListIcon class="size-4" />
				<span class="hidden sm:inline">Sessions</span>
				{#if otherSessions.length > 0}
					<span class="grid min-w-4 place-items-center rounded-full bg-(--accent-2) px-1 text-[0.625rem] font-semibold text-white">{otherSessions.length}</span>
				{/if}
			</Popover.Trigger>
			<Popover.Content side="bottom" align="end" class="w-80 max-w-[calc(100vw-1rem)] gap-2 p-2">
				<p class="px-1 text-xs font-medium text-muted-foreground">Sessions on {backend.name}</p>
				{#if listing === undefined || listing.sessions.length === 0}
					<p class="px-1 py-2 text-sm text-muted-foreground">No sessions yet. A new terminal makes one.</p>
				{:else}
					<ul class="flex max-h-72 flex-col gap-1 overflow-y-auto">
						{#each listing.sessions as session (session.name)}
							<li class="flex items-center gap-2 rounded-md border border-border px-2 py-1.5" data-session={session.name}>
								<div class="flex min-w-0 flex-1 flex-col leading-tight">
									<span class="truncate font-mono text-sm">{session.name}</span>
									<span class="text-xs text-muted-foreground">
										{openSessions.has(session.name) ? 'Open in a tab' : session.exited ? 'Exited, attaching restarts it' : 'Running'}{session.created === undefined ? '' : ` · ${session.created}`}
									</span>
								</div>
								{#if !openSessions.has(session.name)}
									<Button size="xs" variant="outline" onclick={() => attachSession(session.name)}>Attach</Button>
								{/if}
								<Button
									size="xs"
									variant={confirmEnd === session.name ? 'destructive' : 'ghost'}
									onclick={() => void endSession(session.name)}
									title="Stops everything running in this session"
								>
									{confirmEnd === session.name ? 'Really end?' : 'End'}
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
				<Button size="sm" variant="outline" onclick={() => { sessionsOpen = false; newTab(); }}>
					<PlusIcon /> New terminal
				</Button>
			</Popover.Content>
		</Popover.Root>
		<ConnectionBadge {backend} />
	</header>

	{#if restored && !unavailable && tabs.length > 0}
		<div class="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-card px-1.5" role="tablist" aria-label="Open terminals">
			{#each tabs as tab (tab.id)}
				<div
					class="group flex h-7 shrink-0 items-center rounded-md border text-sm {tab.id === activeId
						? 'border-border bg-background text-foreground shadow-xs'
						: 'border-transparent text-muted-foreground hover:bg-muted'}"
				>
					<button
						type="button"
						role="tab"
						aria-selected={tab.id === activeId}
						class="max-w-44 truncate px-2.5 font-mono text-xs outline-none"
						onclick={() => selectTab(tab.id)}
						title={tab.session ?? tab.title}
					>
						{tab.session ?? tab.title}
					</button>
					<button
						type="button"
						class="mr-1 grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Close {tab.session ?? tab.title}, keeping its session running"
						title="Close the tab; the session keeps running"
						onclick={() => closeTab(tab.id)}
					>
						<XIcon class="size-3" />
					</button>
				</div>
			{/each}
			<Button variant="ghost" size="icon-sm" class="shrink-0" aria-label="New terminal" title="New terminal" onclick={() => newTab()}>
				<PlusIcon />
			</Button>
		</div>
	{/if}

	{#if listing?.available && !listing.survivesRestart}
		<Banner tone="warning" class="m-2 shrink-0">
			Sessions on this backend end when it restarts: it cannot start them outside its own service. {listing.multiplexer === 'none' ? '' : 'Lingering for its user and systemd-run make them survive.'}
		</Banner>
	{/if}
	{#if endError}
		<Banner tone="error" class="m-2 shrink-0">{endError}</Banner>
	{/if}

	{#if !backend.supports('terminal')}
		<div class="grid flex-1 place-items-center p-6 text-center">
			<div class="flex max-w-sm flex-col gap-2">
				<p class="font-medium">This backend has no terminals</p>
				<p class="text-sm text-muted-foreground">
					It is either older than the feature or has it turned off (<code>KEMIRI_TERMINALS=off</code>).
				</p>
			</div>
		</div>
	{:else if unavailable}
		<div class="grid flex-1 place-items-center p-6">
			<div class="flex max-w-md flex-col items-start gap-3 rounded-xl border border-border bg-card p-4" role="alert">
				<p class="font-medium">A terminal cannot be opened on {backend.name}</p>
				<p class="text-sm text-muted-foreground">{listing?.reason}</p>
				<Button size="sm" variant="outline" onclick={() => void refreshListing()}><RotateCwIcon /> Check again</Button>
			</div>
		</div>
	{:else if listError && listing === undefined}
		<div class="grid flex-1 place-items-center p-6">
			<Banner tone="error">{listError}</Banner>
		</div>
	{:else if !restored}
		<div class="grid flex-1 place-items-center text-sm text-muted-foreground">
			<span class="inline-flex items-center gap-2"><Spinner class="size-4" /> {backend.ready ? 'Looking for sessions…' : 'Connecting…'}</span>
		</div>
	{:else if tabs.length === 0}
		<div class="grid flex-1 place-items-center p-6">
			<div class="flex max-w-sm flex-col items-start gap-3">
				<p class="font-medium">No terminal open</p>
				<p class="text-sm text-muted-foreground">
					{#if otherSessions.length > 0}
						{backend.name} has {otherSessions.length} session{otherSessions.length === 1 ? '' : 's'} you can attach, or you can start a new one. Closing a tab only detaches: what runs in a session keeps running.
					{:else}
						Start a terminal. It is a zellij session on {backend.name}: close the page and it keeps running.
					{/if}
				</p>
				<div class="flex flex-wrap gap-2">
					<Button size="sm" onclick={() => newTab()}><PlusIcon /> New terminal</Button>
					{#if otherSessions.length > 0}
						<Button size="sm" variant="outline" onclick={() => (sessionsOpen = true)}><ListIcon /> Sessions</Button>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if restored && !unavailable}
		{#each tabs as tab (tab.id)}
			<TerminalView
				{backend}
				{tab}
				active={tab.id === activeId}
				keyBar={showKeyBar}
				onsession={(name) => nameSession(tab, name)}
				onclose={() => closeTab(tab.id)}
				onrestart={() => restartTab(tab)}
			/>
		{/each}
	{/if}
</div>
