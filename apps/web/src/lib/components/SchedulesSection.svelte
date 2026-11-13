<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { onMount } from 'svelte';
	import Banner from '#lib/components/Banner.svelte';
	import ScheduleEditor from '#lib/components/ScheduleEditor.svelte';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import SettingsGroup from '#lib/components/settings/SettingsGroup.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import StatusChip from '#lib/components/settings/StatusChip.svelte';
	import Switch from '#lib/components/settings/Switch.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { projectHref, threadHref, workerHref } from '#lib/backends.js';
	import { taskHref } from '#lib/task-chat.js';
	import { runHasWorker, scheduleAnchor } from '@kemiri/client';
	import { isEventSpec } from '@kemiri/protocol';
	import { ProjectSchedules, type BackendConnection } from '#lib/harness.svelte.js';
	import { relativeTime } from '#lib/relative-time.js';
	import {
		absoluteTime,
		describeSchedule,
		lastRunText,
		runHasThread,
		runRefLabel,
		runOutcomeLabel,
		runReason,
		runTriggerLabel,
		scheduleInput,
		scheduleRunsAs,
		timezoneNote,
		whenText
	} from '#lib/schedules.js';
	import type { Schedule, ScheduleInput, ScheduleRun } from '@kemiri/protocol';

	/**
	 * Project settings' "Scheduled tasks": the briefs the harness runs as workers of the project's coordinator on a
	 * schedule. The list shows each schedule in plain words, its next and last run, a pause switch, and run/edit/delete;
	 * an editor dialog writes one, and each row's run history says what the last 20 runs did. Only shown when the
	 * backend advertises the `schedules` feature.
	 */
	let { backend, projectId }: { backend: BackendConnection; projectId: string } = $props();

	let schedules = $state<ProjectSchedules | undefined>(undefined);
	let editorOpen = $state(false);
	/** The schedule the editor is editing; absent for a new one. */
	let editing = $state<Schedule | undefined>(undefined);
	let deleteOpen = $state(false);
	let deleting = $state<Schedule | undefined>(undefined);
	let deleteBusy = $state(false);
	let deleteError = $state<string | undefined>(undefined);
	/** The rows whose run history is open. */
	let expanded = $state<string[]>([]);
	let runningId = $state<string | undefined>(undefined);
	/** What the last "Run now" did: started a worker, or was skipped or failed. */
	let runNotice = $state<
		{ scheduleId: string; tone: 'info' | 'warning' | 'error'; text: string; workerId?: string; threadId?: string } | undefined
	>(undefined);
	let switchError = $state<string | undefined>(undefined);

	const list = $derived(schedules?.schedules ?? []);
	const timezone = $derived(schedules?.timezone ?? '');
	/**
	 * The clock the relative times are read on. Redrawn when the list changes (a run lands, a save arrives), not on a
	 * timer: like the deploy line, a page left open shows an age until something redraws it.
	 */
	const now = $derived.by(() => {
		void list;
		return Date.now();
	});

	onMount(() => {
		void backend.ensureLoaded();
	});

	$effect(() => {
		const id = projectId;
		if (id.length === 0) {
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

	// A notification links to `#schedule-<id>`: once the list is in, bring that schedule into view.
	$effect(() => {
		if (schedules?.loaded !== true) return;
		const anchor = location.hash.slice(1);
		if (!anchor.startsWith('schedule-')) return;
		queueMicrotask(() => document.getElementById(anchor)?.scrollIntoView({ block: 'center' }));
	});

	function errorText(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function openNew(): void {
		editing = undefined;
		editorOpen = true;
	}

	function openEdit(schedule: Schedule): void {
		editing = schedule;
		editorOpen = true;
	}

	function askDelete(schedule: Schedule): void {
		deleting = schedule;
		deleteError = undefined;
		deleteOpen = true;
	}

	async function save(input: ScheduleInput, scheduleId: string | undefined): Promise<void> {
		await schedules?.save(input, scheduleId);
	}

	async function confirmDelete(): Promise<void> {
		const schedule = deleting;
		if (schedule === undefined || schedules === undefined) return;
		deleteBusy = true;
		deleteError = undefined;
		try {
			await schedules.remove(schedule.id);
			deleteOpen = false;
			deleting = undefined;
			expanded = expanded.filter((id) => id !== schedule.id);
			if (runNotice?.scheduleId === schedule.id) runNotice = undefined;
		} catch (error) {
			deleteError = errorText(error);
		} finally {
			deleteBusy = false;
		}
	}

	/** Pause or resume a schedule: the switch saves the schedule whole, as the backend replaces it. */
	async function toggleEnabled(schedule: Schedule, enabled: boolean): Promise<void> {
		switchError = undefined;
		if (schedules === undefined) return;
		try {
			await schedules.save({ ...scheduleInput(schedule), enabled }, schedule.id);
		} catch (error) {
			switchError = `${schedule.title}: ${errorText(error)}`;
		}
	}

	async function runNow(schedule: Schedule): Promise<void> {
		if (schedules === undefined) return;
		runningId = schedule.id;
		runNotice = undefined;
		try {
			const run: ScheduleRun = await schedules.run(schedule.id);
			if (runHasThread(run)) {
				runNotice = {
					scheduleId: schedule.id,
					tone: 'info',
					text: 'Started a background thread. Its summary goes to main when it finishes.',
					threadId: run.threadId
				};
			} else if (run.outcome === 'started') {
				runNotice = {
					scheduleId: schedule.id,
					tone: 'info',
					text:
						run.workerId === null
							? 'Started a worker.'
							: `Started worker ${run.workerId}. The report goes to the coordinator.`,
					...(run.workerId === null ? {} : { workerId: run.workerId })
				};
			} else {
				runNotice = {
					scheduleId: schedule.id,
					tone: run.outcome === 'skipped' ? 'warning' : 'error',
					text: `Not run (${runOutcomeLabel(run.outcome).toLowerCase()}) — ${runReason(run) ?? 'no reason given'}`
				};
			}
		} catch (error) {
			runNotice = { scheduleId: schedule.id, tone: 'error', text: errorText(error) };
		} finally {
			runningId = undefined;
		}
	}

	function toggleHistory(scheduleId: string): void {
		expanded = expanded.includes(scheduleId)
			? expanded.filter((id) => id !== scheduleId)
			: [...expanded, scheduleId];
	}

	function workerLink(workerId: string): string {
		return workerHref(backend.id, projectId, workerId);
	}

	function threadLink(threadId: string): string {
		return threadHref(backend.id, projectId, threadId);
	}

	/** A task (an event run's, or a schedule's own), opened as a sheet on the project's page. */
	function taskLink(taskId: string): string {
		return `${projectHref(backend.id, projectId)}${taskHref(taskId)}`;
	}
</script>

<SettingsSection
	title="Scheduled tasks"
	description="Work the harness starts on a clock{backend.supports('schedule-events') ? ' or on an event' : ''}."
	icon="calendar-clock"
>
	{#if schedules?.error}<Banner tone="error">{schedules.error}</Banner>{/if}
	{#if switchError}<Banner tone="error">{switchError}</Banner>{/if}

	<SettingsGroup
		title="Schedules"
		description={timezoneNote(timezone)}
	>
		{#snippet actions()}
			<Button variant="outline" class="max-sm:h-11" disabled={schedules?.loaded !== true} onclick={openNew}>
				<PlusIcon data-icon="inline-start" /> New
			</Button>
		{/snippet}
		{#if !schedules?.loaded}
			<p class="px-5 py-5 text-sm text-muted-foreground" role="status">Loading scheduled tasks…</p>
		{:else if list.length === 0}
			<div class="flex flex-col gap-1 px-5 py-6 text-center">
				<p class="text-sm font-medium">No scheduled tasks yet</p>
				<p class="text-[0.8125rem] text-muted-foreground">A nightly test run, a weekly review of the open changes.</p>
			</div>
		{/if}
		{#each list as schedule (schedule.id)}
			<div
				id={scheduleAnchor(schedule.id)}
				class="flex scroll-mt-4 flex-col gap-2.5 px-4 py-3.5 target:bg-(--chat-surface-2)/50 sm:px-5"
				data-schedule={schedule.id}
				data-enabled={schedule.enabled}
			>
				<div class="flex items-start gap-3">
					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<span class="flex flex-wrap items-center gap-1.5">
							<span class="min-w-0 truncate text-sm font-semibold">{schedule.title}</span>
							{#if isEventSpec(schedule.spec)}
								<StatusChip tone="info" dot={false} class="h-5 text-[0.6875rem]"><GitPullRequestIcon class="size-3" aria-hidden="true" /> On an event</StatusChip>
							{/if}
							{#if scheduleRunsAs(schedule) === 'thread'}
								<StatusChip tone="muted" dot={false} class="h-5 text-[0.6875rem]">Background thread</StatusChip>
							{/if}
							{#if schedule.createdBy === 'coordinator'}
								<StatusChip tone="muted" dot={false} class="h-5 text-[0.6875rem]">By the coordinator</StatusChip>
							{/if}
							{#if !schedule.enabled}
								<StatusChip tone="warn" class="h-5 text-[0.6875rem]">Paused</StatusChip>
							{/if}
						</span>
						<span class="text-sm">{describeSchedule(schedule.spec)}</span>
						<span class="text-xs text-muted-foreground">{whenText(schedule, timezone, now)}</span>
						<span class="text-xs break-words text-muted-foreground" data-last-run>{lastRunText(schedule, now)}</span>
						{#if schedule.taskId}
							<a class="w-fit text-xs underline" href={taskLink(schedule.taskId)} data-schedule-task>Board task {schedule.taskId}</a>
						{/if}
					</div>
					<Switch
						id="schedule-enabled-{schedule.id}"
						label="{schedule.title} enabled"
						checked={schedule.enabled}
						onchange={(on) => void toggleEnabled(schedule, on)}
					/>
				</div>

				<div class="flex flex-wrap items-center gap-1.5">
					<Button
						variant="outline"
						class="max-sm:h-11"
						disabled={runningId === schedule.id}
						title="Run this schedule now, even while paused"
						onclick={() => void runNow(schedule)}
					>
						{#if runningId === schedule.id}<Spinner data-icon="inline-start" />{:else}<PlayIcon data-icon="inline-start" />{/if}
						Run now
					</Button>
					<Button variant="ghost" class="max-sm:h-11" aria-label="Edit {schedule.title}" onclick={() => openEdit(schedule)}>
						<PencilIcon data-icon="inline-start" /> Edit
					</Button>
					<Button variant="ghost" class="max-sm:h-11" aria-label="Delete {schedule.title}" onclick={() => askDelete(schedule)}>
						<TrashIcon data-icon="inline-start" /> Delete
					</Button>
					<button
						type="button"
						class="ml-auto flex min-h-6 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground hover:text-foreground max-sm:min-h-11"
						aria-expanded={expanded.includes(schedule.id)}
						onclick={() => toggleHistory(schedule.id)}
					>
						<ChevronRightIcon class="size-3.5 transition-transform motion-reduce:transition-none {expanded.includes(schedule.id) ? 'rotate-90' : ''}" />
						Runs ({schedule.runs.length})
					</button>
				</div>

				{#if runNotice?.scheduleId === schedule.id}
					<Banner tone={runNotice.tone}>
						{runNotice.text}
						{#if runNotice.threadId}
							<a class="underline" href={threadLink(runNotice.threadId)}>Open the thread</a>
						{:else if runNotice.workerId}
							<a class="underline" href={workerLink(runNotice.workerId)}>Open the worker</a>
						{/if}
					</Banner>
				{/if}

				{#if expanded.includes(schedule.id)}
					<div class="flex flex-col gap-1.5 rounded-lg bg-(--chat-surface-2)/40 px-3 py-2.5">
						{#if schedule.runs.length === 0}
							<p class="text-xs text-muted-foreground">No runs yet; the next one will appear here.</p>
						{/if}
						{#each schedule.runs as run, index (`${run.at}-${index}`)}
							<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs" title={absoluteTime(run.at, timezone)}>
								<span class="tabular-nums text-muted-foreground">{relativeTime(run.at, now)}</span>
								<span class="font-medium">{runTriggerLabel(run.trigger)}</span>
								{#if runRefLabel(run)}
									<a class="underline" href={run.ref ?? undefined} target="_blank" rel="noreferrer">{runRefLabel(run)}</a>
								{/if}
								<span
									style:color={run.outcome === 'started'
										? 'var(--chat-success)'
										: run.outcome === 'failed'
											? 'var(--chat-danger)'
											: 'var(--chat-warning)'}
								>
									{runOutcomeLabel(run.outcome)}
								</span>
								{#if runHasThread(run)}
									<a class="underline" href={threadLink(run.threadId)}>background thread</a>
								{:else if runHasWorker(run)}
									<a class="underline" href={workerLink(run.workerId)}>worker {run.workerId}</a>
								{:else if runReason(run)}
									<span class="min-w-0 break-words text-muted-foreground">{runReason(run)}</span>
								{/if}
								{#if run.taskId}
									<a class="underline" href={taskLink(run.taskId)}>task {run.taskId}</a>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</SettingsGroup>
</SettingsSection>

<ScheduleEditor {backend} bind:open={editorOpen} schedule={editing} onsave={save} />

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete this scheduled task?</Dialog.Title>
			<Dialog.Description>
				{deleting?.title ?? 'This schedule'} stops running and its run history goes with it. Work a run already
				started keeps running as that worker.
			</Dialog.Description>
		</Dialog.Header>
		{#if deleteError}
			<div class="px-4 sm:px-6"><Banner tone="error">{deleteError}</Banner></div>
		{/if}
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" type="button" disabled={deleteBusy}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button variant="destructive" size="sm" type="button" disabled={deleteBusy} onclick={() => void confirmDelete()}>
				{#if deleteBusy}<Spinner data-icon="inline-start" />{/if}
				Delete
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
