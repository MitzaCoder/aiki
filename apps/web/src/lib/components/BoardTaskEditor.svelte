<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
	import {
		TASK_STATUSES,
		authorLabel,
		blockerChoices,
		changedFields,
		draftFromTask,
		draftIsDirty,
		draftProblem,
		draftToInput,
		emptyDraft,
		fieldValueText,
		taskStatusLabel,
		type TaskDraft
	} from '#lib/board.js';
	import type { SaveOutcome } from '#lib/board.svelte.js';
	import { inProgressText } from '@kemiri/client';
	import ArtifactList from '#lib/components/artifacts/ArtifactList.svelte';
	import { artifactScope } from '#lib/artifacts.svelte.js';
	import type { BoardTask, BoardTaskInput, BoardTaskStatus } from '@kemiri/protocol';

	/**
	 * Add or edit one task. A save names the revision the draft was started from; when the task moved on, the editor shows
	 * the newer version beside what changed and lets the user take it or save their own version over it.
	 */
	let {
		task,
		tasks,
		onsave,
		onback
	}: {
		/** The task to edit, or undefined to add one. */
		task: BoardTask | undefined;
		tasks: readonly BoardTask[];
		onsave: (input: BoardTaskInput, options: { taskId?: string; expectedRevision?: number }) => Promise<SaveOutcome>;
		onback: () => void;
	} = $props();

	// The editor is created per task, so the first value is the right one.
	// svelte-ignore state_referenced_locally
	let draft = $state<TaskDraft>(task === undefined ? emptyDraft() : draftFromTask(task));
	// svelte-ignore state_referenced_locally
	let baseRevision = $state<number | undefined>(task?.revision);
	// svelte-ignore state_referenced_locally
	let shown = $state<BoardTask | undefined>(task);
	let saving = $state(false);
	let problem = $state<string | undefined>(undefined);
	let conflict = $state<{ newer: BoardTask | undefined } | undefined>(undefined);

	const taskId = $derived(shown?.id);
	const artifacts = artifactScope();
	const artifactTarget = $derived(artifacts?.());
	const choices = $derived(blockerChoices(tasks, taskId));
	const validation = $derived(draftProblem(draft, taskId, tasks));
	const dirty = $derived(draftIsDirty(draft, shown));
	const differing = $derived(conflict?.newer === undefined ? [] : changedFields(draft, conflict.newer));
	const live = $derived(taskId === undefined ? undefined : tasks.find((entry) => entry.id === taskId));
	const movedOn = $derived(conflict === undefined && live !== undefined && baseRevision !== undefined && live.revision !== baseRevision);

	async function save(): Promise<void> {
		if (saving || validation !== undefined) return;
		saving = true;
		problem = undefined;
		const outcome = await onsave(draftToInput(draft), {
			...(taskId === undefined ? {} : { taskId }),
			...(baseRevision === undefined ? {} : { expectedRevision: baseRevision })
		});
		saving = false;
		if (outcome.kind === 'saved') {
			onback();
		} else if (outcome.kind === 'conflict') {
			conflict = { newer: outcome.newer };
		} else {
			problem = outcome.message;
		}
	}

	function useTheirs(): void {
		const newer = conflict?.newer;
		if (newer === undefined) return;
		draft = draftFromTask(newer);
		baseRevision = newer.revision;
		shown = newer;
		conflict = undefined;
	}

	function keepMine(): void {
		const newer = conflict?.newer;
		if (newer === undefined) return;
		baseRevision = newer.revision;
		shown = newer;
		conflict = undefined;
		void save();
	}

	function toggleBlocker(id: string, on: boolean): void {
		draft.blockedBy = on ? [...draft.blockedBy.filter((entry) => entry !== id), id] : draft.blockedBy.filter((entry) => entry !== id);
	}

	const label = 'text-[0.6875rem] font-semibold text-(--chat-fg-subtle)';
	const field =
		'rounded-lg border-(--chat-border) bg-(--chat-surface)/30 px-2.5 py-1.5 text-xs md:text-xs';
</script>

<div class="flex min-w-0 flex-col gap-3 pb-2" data-task-editor={taskId ?? 'new'}>
	<div class="flex items-center gap-1">
		<Button variant="ghost" size="icon-sm" onclick={onback} aria-label="Back to the board" title="Back">
			<ArrowLeftIcon />
		</Button>
		<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
			{#if taskId}<span class="mr-1.5 font-mono text-(--chat-fg-subtle)">{taskId}</span>{/if}{taskId ? 'Edit task' : 'New task'}
		</h2>
	</div>

	{#if conflict}
		<div class="flex flex-col gap-2 rounded-xl border border-(--chat-warning)/50 bg-(--chat-warning)/10 px-3 py-2.5 text-xs" role="alert">
			{#if conflict.newer === undefined}
				<p class="font-semibold text-(--chat-fg)">This task is gone from the board.</p>
				<p class="text-(--chat-fg-muted)">It may have been archived. Your changes were not saved.</p>
			{:else}
				<p class="font-semibold text-(--chat-fg)">
					Changed by {authorLabel(conflict.newer.updatedBy)} since you opened it. Nothing was saved.
				</p>
				{#if differing.length === 0}
					<p class="text-(--chat-fg-muted)">Their version says the same as yours.</p>
				{:else}
					<dl class="flex flex-col gap-1">
						{#each differing as name (name)}
							<div class="min-w-0">
								<dt class="font-medium text-(--chat-fg-muted)">{name}, now</dt>
								<dd class="line-clamp-3 break-words whitespace-pre-wrap text-(--chat-fg)">{fieldValueText(conflict.newer, name)}</dd>
							</div>
						{/each}
					</dl>
				{/if}
				<div class="flex flex-wrap gap-1.5">
					<Button size="sm" variant="outline" onclick={useTheirs}>Use their version</Button>
					<Button size="sm" onclick={keepMine} disabled={saving || validation !== undefined}>Save mine over it</Button>
				</div>
			{/if}
		</div>
	{:else if movedOn && live}
		<p class="rounded-xl border border-(--chat-border) px-3 py-2 text-xs text-(--chat-fg-muted)">
			{authorLabel(live.updatedBy)} changed this task while you edit. Saving will ask which version to keep.
		</p>
	{/if}

	<label class="flex flex-col gap-1">
		<span class={label}>Title</span>
		<Input bind:value={draft.title} class="h-8 {field}" aria-invalid={validation === 'A task needs a title.'} />
	</label>

	<label class="flex flex-col gap-1">
		<span class={label}>Tickets and links</span>
		<Textarea bind:value={draft.refs} rows={2} class="min-h-12 font-mono {field}" placeholder="One per line, like EX-1234, #1234 or a link" />
	</label>

	<label class="flex flex-col gap-1">
		<span class={label}>Description</span>
		<Textarea bind:value={draft.description} rows={4} class="min-h-20 {field}" />
	</label>

	<label class="flex flex-col gap-1">
		<span class={label}>Done when</span>
		<Textarea bind:value={draft.acceptance} rows={2} class="min-h-12 {field}" placeholder="Acceptance, optional" />
	</label>

	<label class="flex flex-col gap-1">
		<span class={label}>Status</span>
		<NativeSelect bind:value={draft.status} class="w-full" size="sm">
			{#if draft.status === 'waiting'}<NativeSelectOption value="waiting">Waiting (edit from the status menu)</NativeSelectOption>{/if}
			{#each TASK_STATUSES as status (status)}
				<NativeSelectOption value={status satisfies BoardTaskStatus}>{taskStatusLabel(status)}</NativeSelectOption>
			{/each}
		</NativeSelect>
	</label>

	<!-- A todo task has no time to show; a finished one keeps the time it spent in progress. -->
	{#if shown && inProgressText(shown) && (shown.status === 'in_progress' || (shown.inProgressMinutes ?? 0) > 0)}
		<p class="-mt-1.5 text-xs text-(--chat-fg-subtle)" data-in-progress>{inProgressText(shown)}</p>
	{/if}

	{#if draft.status === 'blocked'}
		<label class="flex flex-col gap-1">
			<span class={label}>Why it is blocked</span>
			<Input bind:value={draft.blockedReason} class="h-8 {field}" placeholder="Besides its dependencies" />
		</label>
	{/if}

	<fieldset class="flex min-w-0 flex-col gap-1">
		<legend class={label}>Waits for</legend>
		{#if choices.length === 0}
			<p class="text-xs text-(--chat-fg-subtle)">No other task to wait for.</p>
		{:else}
			<div class="relative">
			<div use:overlayScroll={'parent'} class="flex max-h-40 flex-col overflow-y-auto rounded-lg border border-(--chat-border)">
				{#each choices as choice (choice.id)}
					<label class="flex min-w-0 cursor-pointer items-start gap-2 px-2.5 py-1.5 text-xs hover:bg-(--chat-surface-2)/60">
						<input
							type="checkbox"
							class="mt-0.5 shrink-0 accent-(--accent-2)"
							checked={draft.blockedBy.includes(choice.id)}
							onchange={(event) => toggleBlocker(choice.id, event.currentTarget.checked)}
						/>
						<span class="min-w-0 flex-1 break-words">
							<span class="font-mono text-(--chat-fg-subtle)">{choice.id}</span>
							{choice.title}
							<span class="text-(--chat-fg-subtle)">· {taskStatusLabel(choice.status)}</span>
						</span>
					</label>
				{/each}
			</div>
			</div>
		{/if}
		{#each draft.blockedBy.filter((id) => !choices.some((choice) => choice.id === id)) as id (id)}
			<p class="text-xs text-(--chat-fg-subtle)">Also waits for <span class="font-mono">{id}</span>, which is archived.</p>
		{/each}
	</fieldset>

	<label class="flex flex-col gap-1">
		<span class={label}>Write scopes</span>
		<Textarea
			bind:value={draft.writeScopes}
			rows={2}
			class="min-h-12 font-mono {field}"
			placeholder="One path per line, relative to the project"
		/>
	</label>

	{#if taskId !== undefined && artifactTarget?.available === true}
		<section class="flex flex-col gap-1" aria-label="Artifacts for {taskId}">
			<span class={label}>Artifacts</span>
			<ArtifactList
				client={artifactTarget.client}
				projectId={artifactTarget.projectId}
				filter={{ taskId }}
				layout="rows"
				collapsedCount={4}
				emptyText="None saved for this task yet."
			/>
		</section>
	{/if}

	{#if validation && validation !== 'A task needs a title.'}
		<p class="text-xs text-(--chat-danger)" role="alert">{validation}</p>
	{/if}
	{#if problem}
		<p class="text-xs break-words text-(--chat-danger)" role="alert">{problem}</p>
	{/if}

	<div class="flex gap-2">
		<Button size="sm" onclick={save} disabled={saving || validation !== undefined || (!dirty && taskId !== undefined)}>
			{taskId === undefined ? 'Add task' : 'Save'}
		</Button>
		<Button size="sm" variant="ghost" onclick={onback}>Cancel</Button>
	</div>
</div>
