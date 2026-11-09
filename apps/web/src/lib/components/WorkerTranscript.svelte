<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import BotIcon from '@lucide/svelte/icons/bot';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import { onMount } from 'svelte';
	import Banner from '#lib/components/Banner.svelte';
	import ConnectionBadge from '#lib/components/ConnectionBadge.svelte';
	import ContextPanel from '#lib/components/ContextPanel.svelte';
	import ProjectsMenuButton from '#lib/components/ProjectsMenuButton.svelte';
	import ConversationSidebar from '#lib/components/ConversationSidebar.svelte';
	import MemoryPanel from '#lib/components/MemoryPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import TranscriptColumn from '#lib/components/chat/TranscriptColumn.svelte';
	import ArtifactsSection from '#lib/components/artifacts/ArtifactsSection.svelte';
	import { provideArtifactScope } from '#lib/artifacts.svelte.js';
	import { provideRefLinks } from '#lib/ref-links.svelte.js';
	import RefCardHost from '#lib/components/RefCardHost.svelte';
	import WorkerStatusBadge from '#lib/components/chat/WorkerStatusBadge.svelte';
	import { fullTime } from '#lib/chat/time.js';
	import { projectHref, threadHref, workerHref } from '#lib/backends.js';
	import { terminalHref } from '#lib/terminal.js';
	import {
		modelLabel,
		ProjectMemory,
		ProjectWorkers,
		type BackendConnection,
		type ChatSession,
		type ProjectContext
	} from '#lib/harness.svelte.js';
	import { visibleSidebarTabs, type SidebarTab } from '#lib/sidebar.js';
	import type { MemoryScope } from '@mihai-harness/protocol';
	import { CHAT_COLUMN_CLASS } from '#lib/chat/layout.js';
	import { buildTranscript, liveState } from '#lib/transcript.js';
	import { workerPlace } from '#lib/workers.js';

	/**
	 * One worker's conversation, read-only: the same turns, tool cards and markdown
	 * as the coordinator's chat, without a composer. The user talks to the
	 * coordinator, never to a worker. The right sidebar shows this worker's context,
	 * the project's workers and its memory, exactly as the chat's does.
	 */
	let {
		backend,
		projectId,
		workerId,
		threadId
	}: {
		backend: BackendConnection;
		projectId: string;
		workerId: string;
		/** The background thread this worker works for; undefined for main's workers. */
		threadId?: string;
	} = $props();

	/** Where this worker reports: main's chat, or its background thread's. */
	const coordinatorHref = $derived(
		threadId === undefined ? projectHref(backend.id, projectId) : threadHref(backend.id, projectId, threadId)
	);

	const project = $derived(backend.projects.find((entry) => entry.id === projectId));
	provideArtifactScope(() => ({ client: backend.client, projectId, available: backend.supports('artifacts') }));
	provideRefLinks(() => ({ links: project?.links, status: () => undefined }));
	const supportsWorkers = $derived(backend.supports('workers'));
	const supportsMemory = $derived(backend.supports('memory'));

	let session = $state<ChatSession | undefined>(undefined);
	let workers = $state<ProjectWorkers | undefined>(undefined);
	let projectContext = $state<ProjectContext | undefined>(undefined);
	let memory = $state<ProjectMemory | undefined>(undefined);
	/** The right sidebar: open, which tab, and whether it fills the page below the header. */
	let sidebarOpen = $state(false);
	let sidebarTab = $state<SidebarTab>('info');
	let sidebarExpanded = $state(false);

	// The board is the coordinator's: a worker's page has no Board tab.
	const sidebarTabs = $derived(
		visibleSidebarTabs((feature) => backend.supports(feature)).filter((entry) => entry !== 'board')
	);
	const supportsSidebar = $derived(sidebarTabs.length > 0);

	const worker = $derived(workers?.worker(workerId));
	const live = $derived(liveState(session?.view));
	const items = $derived(buildTranscript(session?.entries ?? [], live));
	const busy = $derived(live?.run !== undefined);

	function updatedTitle(worker: { updatedAt: string }): string {
		const ms = Date.parse(worker.updatedAt);
		return Number.isNaN(ms) ? worker.updatedAt : fullTime(ms);
	}

	onMount(() => {
		void backend.ensureLoaded();
	});

	$effect(() => {
		if (!supportsWorkers) {
			workers = undefined;
			return;
		}
		const created = backend.watchWorkers(projectId, threadId);
		workers = created;
		return () => {
			created.stop();
			if (workers === created) workers = undefined;
		};
	});

	$effect(() => {
		const id = workerId;
		if (id.length === 0 || !supportsWorkers || !backend.supports('conversation')) {
			session = undefined;
			return;
		}
		const created = backend.watchWorker(projectId, id, { min: 50, max: 100 }, threadId);
		session = created;
		return () => {
			created.stop();
			if (session === created) session = undefined;
		};
	});

	$effect(() => {
		const id = workerId;
		if (id.length === 0 || !backend.supports('context')) {
			projectContext = undefined;
			return;
		}
		const created = backend.watchContext(projectId, id, threadId);
		projectContext = created;
		return () => {
			created.stop();
			if (projectContext === created) projectContext = undefined;
		};
	});

	// `supportsMemory` is derived, so a reconnect's identical feature list does not recreate the panel and drop the
	// open file and the archived toggle.
	$effect(() => {
		if (!supportsMemory) {
			memory = undefined;
			return;
		}
		const created = backend.watchMemory(projectId);
		memory = created;
		return () => {
			created.stop();
			if (memory === created) memory = undefined;
		};
	});

	/** A memory card's topic opens in the Memory tab, in the scope it was found in. */
	function openMemoryTopic(fileId: string, scope: MemoryScope): void {
		sidebarTab = 'memory';
		sidebarOpen = true;
		sidebarExpanded = false;
		void memory?.open(fileId, scope);
	}

	function toggleSidebar(target: SidebarTab): void {
		if (sidebarOpen && sidebarTab === target) {
			sidebarOpen = false;
			sidebarExpanded = false;
			return;
		}
		sidebarTab = target;
		sidebarOpen = true;
		sidebarExpanded = false;
	}

	async function loadEarlier(): Promise<void> {
		const current = session;
		await current?.loadEarlier();
		if (current?.watch.earlierError) throw new Error(current.watch.earlierError);
	}
</script>

{#snippet emptyState()}
	<div class="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
		<BotIcon class="size-6 text-(--chat-fg-subtle)" />
		<p class="text-sm font-medium">{worker?.title || workerId}</p>
		<p class="max-w-sm text-sm text-(--chat-fg-subtle)">
			{#if session === undefined}
				Loading the worker's transcript…
			{:else}
				This worker has not written anything yet.
			{/if}
		</p>
	</div>
{/snippet}

<div class="flex h-full w-full overflow-hidden">
	<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<header
				class="flex {CHAT_COLUMN_CLASS} shrink-0 flex-col gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-3"
			>
				<div class="flex h-12 items-center gap-1">
					<ProjectsMenuButton />
					<Button
						href={coordinatorHref}
						variant="ghost"
						size="icon-sm"
						aria-label="Back to the coordinator"
						title="Back to the coordinator"
					>
						<ArrowLeftIcon />
					</Button>
					<span class="worker-icon grid size-7 shrink-0 place-items-center rounded-lg">
						<BotIcon class="size-3.5" />
					</span>
					<div class="flex min-w-0 flex-1 flex-col">
						<h1 class="min-w-0 truncate px-1.5 text-[0.9375rem] font-semibold">
							{worker?.title || workerId}
						</h1>
						<p class="min-w-0 truncate px-1.5 text-xs text-(--chat-fg-subtle)">
							<span class="font-mono">{workerId}</span>
							{#if project}
								· {project.name}
							{/if}
						</p>
					</div>
					<span class="max-sm:hidden"><ConnectionBadge {backend} /></span>
					{#if backend.supports('terminal') && project && worker}
						<Button
							href={terminalHref(backend.id, { projectId: project.id, workerId })}
							variant="ghost"
							size="icon-sm"
							aria-label={worker.workspacePath ? "Open a terminal in this worker's workspace" : 'Open a terminal in the project folder'}
							title={worker.workspacePath ? "Open a terminal in this worker's workspace" : 'Open a terminal in the project folder'}
						>
							<TerminalIcon />
						</Button>
					{/if}
					{#if backend.supports('context')}
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => toggleSidebar('info')}
							aria-label="This worker's context"
							title="Context"
							aria-pressed={sidebarOpen && sidebarTab === 'info'}
						>
							<InfoIcon />
						</Button>
					{/if}
					{#if supportsMemory}
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => toggleSidebar('memory')}
							aria-label="Memory"
							title="Memory"
							aria-pressed={sidebarOpen && sidebarTab === 'memory'}
						>
							<BookOpenIcon />
						</Button>
					{/if}
				</div>

				{#if worker}
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 text-xs text-(--chat-fg-subtle)">
						<WorkerStatusBadge status={worker.status} />
						<span>{modelLabel(worker.model, backend.models)}</span>
						{#if worker.thinkingLevel !== null}
							<span>· thinking {worker.thinkingLevel}</span>
						{/if}
						<span>· {worker.isolation === 'workspace' ? 'own workspace' : 'shared checkout'}</span>
						{#if worker.isolation === 'workspace'}
							<span class="font-mono break-all" title={worker.workspacePath ?? ''}>{workerPlace(worker)}</span>
						{/if}
						<span>· updated <time datetime={worker.updatedAt}>{updatedTitle(worker)}</time></span>
					</div>
				{/if}
			</header>

		{#if !supportsWorkers}
			<div class="{CHAT_COLUMN_CLASS} px-4 sm:px-6">
				<Banner tone="warning">This backend does not advertise workers.</Banner>
			</div>
		{:else}
			{#if !backend.supports('conversation')}
				<div class="{CHAT_COLUMN_CLASS} px-4 sm:px-6">
					<Banner tone="warning">This backend does not advertise conversations.</Banner>
				</div>
			{/if}
	
			{#if session && session.status !== 'live'}
				<div class="{CHAT_COLUMN_CLASS} px-4 pb-2 sm:px-6">
					<Banner tone="warning">
						{#if session.status === 'connecting'}
							Connecting to the worker's transcript…
						{:else if session.status === 'reconnecting'}
							Reconnecting to the worker's transcript…{session.error ? ` ${session.error}` : ''}
						{:else}
							The worker's transcript view stopped.{session.error ? ` ${session.error}` : ''}
						{/if}
					</Banner>
				</div>
			{/if}
	
			{#if worker === undefined && workers?.loaded === true}
				<div class="{CHAT_COLUMN_CLASS} px-4 pb-2 sm:px-6">
					<Banner tone="warning">
						Worker "{workerId}" is not in this project's list any more; its transcript is only history.
					</Banner>
				</div>
			{/if}
	
			{#if worker?.status === 'failed' && worker.failure}
				<div class="{CHAT_COLUMN_CLASS} px-4 pb-2 sm:px-6">
					<Banner tone="error">{worker.failure}</Banner>
				</div>
			{/if}
	
			{#if workers?.error}
				<div class="{CHAT_COLUMN_CLASS} px-4 pb-2 sm:px-6">
					<Banner tone="error">{workers.error}</Banner>
				</div>
			{/if}
	
			{#key session}
			<TranscriptColumn
				{items}
				cwd={worker?.isolation === 'shared' ? project?.path : (worker?.workspacePath ?? project?.path)}
				canLoadEarlier={session?.canLoadEarlier ?? false}
				loadingEarlier={session?.loadingEarlier ?? false}
				onLoadEarlier={loadEarlier}
				working={busy}
				onopentopic={openMemoryTopic}
				empty={emptyState}
			/>
			{/key}
	
			<div
				class="flex {CHAT_COLUMN_CLASS} shrink-0 flex-wrap items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-xs text-(--chat-fg-subtle) sm:px-6"
			>
				<p class="min-w-0 flex-1">
					Read-only. A worker reports to the coordinator, so send it more work by messaging the coordinator.
				</p>
				<Button href={coordinatorHref} variant="outline" size="sm">
					<ArrowLeftIcon data-icon="inline-start" /> {threadId === undefined ? 'Coordinator' : 'Thread'}
				</Button>
			</div>
		{/if}
		</div>

		{#if supportsSidebar}
			<ConversationSidebar
				bind:open={sidebarOpen}
				bind:tab={sidebarTab}
				bind:expanded={sidebarExpanded}
				tabs={sidebarTabs}
				label="Worker sidebar"
			>
				{#snippet infoPanel()}
					<ContextPanel
						context={projectContext?.context}
						loaded={projectContext?.loaded ?? false}
						error={projectContext?.error}
					>
						{#snippet extra()}
							{#if backend.supports('artifacts')}
								<ArtifactsSection client={backend.client} {projectId} filter={{ workerId }} />
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

<RefCardHost readDetails={backend.supports('ref-details') ? (ref) => backend.client.readRefDetails(projectId, ref) : undefined} />

<style>
	.worker-icon {
		color: var(--accent-2);
		background: color-mix(in oklab, var(--accent-2) 12%, transparent);
	}
</style>
