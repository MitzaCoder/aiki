<script lang="ts">
	import { overlayScroll } from '#lib/scrollbars.js';
	import Banner from '#lib/components/Banner.svelte';
	import Combobox from '#lib/components/settings/Combobox.svelte';
	import LearnMore from '#lib/components/settings/LearnMore.svelte';
	import ThinkingSelect from '#lib/components/settings/ThinkingSelect.svelte';
	import type { ComboOption } from '#lib/combobox.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { modelKey, modelOptions, sameModel } from '#lib/models.js';
	import {
		DAY_SHORT,
		briefLabel,
		checkScheduleDraft,
		checkScheduleSpec,
		describeSchedule,
		draftFromSchedule,
		emptyScheduleDraft,
		runsAsLabel,
		type ScheduleDraft
	} from '#lib/schedules.js';
	import {
		THINKING_LEVELS,
		type ModelRef,
		type Schedule,
		type ScheduleInput,
		type ThinkingLevel
	} from '@aiki/protocol';

	/**
	 * The scheduled task editor: a dialog over the project settings card. It holds the draft, validates it with the
	 * pure rules in `lib/schedules.ts` and hands the section one schedule to save; the section owns the request so the
	 * dialog stays a form.
	 */
	let {
		backend,
		open = $bindable(false),
		schedule,
		onsave
	}: {
		backend: BackendConnection;
		open: boolean;
		/** The schedule being edited; absent for a new one. */
		schedule?: Schedule;
		onsave: (input: ScheduleInput, scheduleId: string | undefined) => Promise<void>;
	} = $props();

	let draft = $state<ScheduleDraft>(emptyScheduleDraft());
	/** A backend with threads can start a background thread per run instead of one worker. */
	const supportsThreads = $derived(backend.supports('threads'));
	/** Only a backend that advertises `schedule-events` can run an event rule; an existing one stays editable. */
	const supportsEvents = $derived(backend.supports('schedule-events') || draft.kind === 'github-review-requested');
	let errors = $state<string[]>([]);
	let saving = $state(false);
	/** Which schedule the draft was filled from, so reopening the dialog starts from what is stored. */
	let filledFor = $state<string | undefined>(undefined);

	const spec = $derived(checkScheduleSpec(draft));
	const summary = $derived(spec.spec === undefined ? undefined : describeSchedule(spec.spec));
	const currentModel = $derived(
		draft.model === null
			? undefined
			: backend.models.find((model) => sameModel(model, draft.model as ModelRef))
	);
	const levels = $derived<readonly ThinkingLevel[]>(currentModel?.thinkingLevels ?? THINKING_LEVELS);

	$effect(() => {
		if (!open) {
			filledFor = undefined;
			return;
		}
		const key = schedule === undefined ? 'new' : `${schedule.id}|${schedule.updatedAt}`;
		if (filledFor === key) return;
		filledFor = key;
		draft = schedule === undefined ? emptyScheduleDraft() : draftFromSchedule(schedule);
		errors = [];
	});

	function toggleDay(day: number): void {
		draft.days = draft.days.includes(day)
			? draft.days.filter((entry) => entry !== day)
			: [...draft.days, day].sort((left, right) => left - right);
	}

	const modelChoices = $derived<ComboOption[]>([
		{ value: '', label: 'Worker default', description: "The composer's pick, then the project's worker models" },
		...modelOptions(backend.models, backend.providers)
	]);

	function chooseModel(key: string): void {
		const model = backend.models.find((entry) => modelKey(entry) === key);
		if (model === undefined) {
			draft.model = null;
			draft.thinkingLevel = null;
			return;
		}
		draft.model = { provider: model.provider, modelId: model.modelId };
		// A level the chosen model does not offer is dropped, as the composer does.
		if (draft.thinkingLevel !== null && !model.thinkingLevels.includes(draft.thinkingLevel)) {
			draft.thinkingLevel = null;
		}
	}

	const runsAsOptions: ComboOption[] = [
		{ value: 'worker', label: runsAsLabel('worker'), description: 'One focused job' },
		{ value: 'thread', label: runsAsLabel('thread'), description: 'Plans and runs its own workers' }
	];
	const kindOptions = $derived<ComboOption[]>([
		{ value: 'interval', label: 'Every few minutes or hours' },
		{ value: 'daily', label: 'Every day at a time' },
		{ value: 'weekly', label: 'On chosen days of the week' },
		{ value: 'cron', label: 'Cron expression' },
		...(supportsEvents
			? [{ value: 'github-review-requested', label: 'When a review is requested from you on GitHub', description: 'Checked every 2 minutes' }]
			: [])
	]);
	const unitOptions: ComboOption[] = [
		{ value: 'minutes', label: 'minutes' },
		{ value: 'hours', label: 'hours' }
	];
	const isolationOptions: ComboOption[] = [
		{ value: 'shared', label: 'Shared checkout', description: "Edits the project's own checkout" },
		{ value: 'workspace', label: 'Own jj workspace', description: 'The coordinator merges it' }
	];
	const reportOptions = $derived<ComboOption[]>([
		{ value: 'review', label: draft.runsAs === 'thread' ? 'Main reviews it' : 'Coordinator reviews it', description: 'Wakes it for a turn' },
		{ value: 'record', label: 'Just record it', description: 'Kept for your next message' }
	]);

	async function save(): Promise<void> {
		const checked = checkScheduleDraft(draft);
		if (!('input' in checked)) {
			errors = checked.errors;
			return;
		}
		errors = [];
		saving = true;
		try {
			await onsave(checked.input, schedule?.id);
			open = false;
		} catch (error) {
			errors = [error instanceof Error ? error.message : String(error)];
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-dvh sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{schedule === undefined ? 'New scheduled task' : 'Edit scheduled task'}</Dialog.Title>
			<Dialog.Description>
				{#if draft.runsAs === 'thread'}
					Each run starts a background thread with your prompt: a coordinator with its own workers. Its summary
					reaches main when it finishes.
				{:else}
					The brief runs as a worker of the project's coordinator. The report goes to the coordinator like any other
					worker's.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="relative">
		<form
			id="schedule-editor"
			use:overlayScroll={'parent'}
			class="flex max-h-[min(36rem,68dvh)] flex-col gap-4 overflow-y-auto overscroll-contain px-4 sm:px-6"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<Field.Group>
				<Field.Field>
					<Field.Label for="schedule-title">Title</Field.Label>
					<Input
						id="schedule-title"
						bind:value={draft.title}
						placeholder="Nightly test run"
						autocomplete="off"
					/>
				</Field.Field>
				{#if supportsThreads}
					<Field.Field>
						<Field.Label for="schedule-runs-as">Each run</Field.Label>
						<Combobox id="schedule-runs-as" options={runsAsOptions} value={draft.runsAs} onchange={(next) => (draft.runsAs = next as 'worker' | 'thread')} />
						<Field.Description>One focused job, or a thread that plans its own workers.</Field.Description>
					</Field.Field>
				{/if}
				<Field.Field>
					<Field.Label for="schedule-brief">{briefLabel(draft.runsAs)}</Field.Label>
					<Textarea
						id="schedule-brief"
						bind:value={draft.brief}
						rows={4}
						placeholder="Run the test suite, look at the failures and report what broke."
						class="min-h-20 text-sm md:text-sm"
					/>
					<Field.Description>
						{draft.runsAs === 'thread' ? 'What you would ask main for.' : 'Self-contained: the worker sees only this.'}
					</Field.Description>
					<LearnMore>
						{#if draft.runsAs === 'thread'}
							The thread sees this prompt, the board and memory, not this conversation.
						{:else}
							The worker sees this brief and its checkout, not this conversation.
						{/if}
					</LearnMore>
				</Field.Field>
			</Field.Group>

			<Field.Group>
				<Field.Field>
					<Field.Label for="schedule-kind">{draft.kind === 'github-review-requested' ? 'Run' : 'Repeat'}</Field.Label>
					<Combobox id="schedule-kind" options={kindOptions} value={draft.kind} onchange={(next) => (draft.kind = next as typeof draft.kind)} />
				</Field.Field>

				{#if draft.kind === 'interval'}
					<Field.Field>
						<Field.Label for="schedule-every">Every</Field.Label>
						<div class="flex items-center gap-2">
							<Input
								id="schedule-every"
								class="w-24"
								type="number"
								min="1"
								step="1"
								value={draft.every}
								oninput={(event) => (draft.every = event.currentTarget.value)}
							/>
							<Combobox class="w-36" options={unitOptions} value={draft.everyUnit} onchange={(next) => (draft.everyUnit = next as typeof draft.everyUnit)} aria-label="Unit" />
						</div>
					</Field.Field>
				{:else if draft.kind === 'daily'}
					<Field.Field>
						<Field.Label for="schedule-time">At</Field.Label>
						<Input id="schedule-time" class="w-40" type="time" bind:value={draft.time} />
					</Field.Field>
				{:else if draft.kind === 'weekly'}
					<Field.Field>
						<Field.Label for="schedule-days">Days</Field.Label>
						<div id="schedule-days" class="flex flex-wrap gap-1.5">
							{#each DAY_SHORT as name, index (name)}
								<button
									type="button"
									class="day {draft.days.includes(index) ? 'day-on' : ''}"
									aria-pressed={draft.days.includes(index)}
									onclick={() => toggleDay(index)}
								>
									{name}
								</button>
							{/each}
						</div>
					</Field.Field>
					<Field.Field>
						<Field.Label for="schedule-weekly-time">At</Field.Label>
						<Input id="schedule-weekly-time" class="w-40" type="time" bind:value={draft.time} />
					</Field.Field>
				{:else if draft.kind === 'github-review-requested'}
					<Field.Field>
						<Field.Label for="schedule-repos">Repositories</Field.Label>
						<Input
							id="schedule-repos"
							bind:value={draft.repos}
							spellcheck="false"
							autocomplete="off"
							placeholder="Leave empty for this project's repositories"
						/>
						<Field.Description>owner/name, separated by commas. Empty: this project's repositories.</Field.Description>
					<LearnMore>
						Empty means the project's GitHub repositories, or every repository when it has none. The backend checks GitHub
						every 2 minutes as the account its <code>gh</code> is signed in to, counting requests to you and to your teams.
						Each new request starts its own run with your {draft.runsAs === 'thread' ? 'prompt' : 'brief'} plus the pull
						request's details, and gets its own task. Requests already open when you turn this on are left alone.
					</LearnMore>
					</Field.Field>
				{:else}
					<Field.Field>
						<Field.Label for="schedule-cron">Cron expression</Field.Label>
						<Input
							id="schedule-cron"
							class="font-mono"
							bind:value={draft.cron}
							spellcheck="false"
							placeholder="0 9 * * 1-5"
						/>
						<Field.Description>Five fields: minute, hour, day of month, month, day of week.</Field.Description>
					</Field.Field>
				{/if}

				<p class="text-sm text-muted-foreground" aria-live="polite">
					{#if summary !== undefined}
						{summary}
					{:else}
						{spec.errors[0] ?? ''}
					{/if}
				</p>
			</Field.Group>

			<Field.Group>
				<Field.Field>
					<Field.Label for="schedule-model">{draft.runsAs === 'thread' ? 'Thread model' : 'Worker model'}</Field.Label>
					<Combobox
						id="schedule-model"
						options={modelChoices}
						value={draft.model === null ? '' : modelKey(draft.model)}
						onchange={chooseModel}
						searchPlaceholder="Search models or providers…"
					/>
					<Field.Description>
						{draft.runsAs === 'thread' ? 'The thread\'s own model.' : 'Worker default resolves like any worker.'}
					</Field.Description>
				</Field.Field>

				<Field.Field>
					<Field.Label for="schedule-thinking">Thinking level</Field.Label>
					<ThinkingSelect
						id="schedule-thinking"
						{levels}
						value={draft.thinkingLevel}
						onchange={(level) => (draft.thinkingLevel = level)}
						disabled={draft.model === null}
					/>
					<Field.Description>{draft.model === null ? 'Choose a model to set a level.' : 'Applies to this schedule\'s runs.'}</Field.Description>
				</Field.Field>

				{#if draft.runsAs === 'worker'}
				<Field.Field>
					<Field.Label for="schedule-isolation">Isolation</Field.Label>
					<Combobox id="schedule-isolation" options={isolationOptions} value={draft.isolation} onchange={(next) => (draft.isolation = next as typeof draft.isolation)} />
					<Field.Description>A shared worker edits the project's checkout; an isolated one gets its own.</Field.Description>
				</Field.Field>
				{/if}

				<Field.Field>
					<Field.Label for="schedule-report">On report</Field.Label>
					<Combobox id="schedule-report" options={reportOptions} value={draft.onReport} onchange={(next) => (draft.onReport = next as typeof draft.onReport)} />
					<Field.Description>Reviewing wakes it for a turn per run; recording waits for your next message.</Field.Description>
				</Field.Field>

				<Field.Field orientation="horizontal">
					<Checkbox id="schedule-enabled" bind:checked={draft.enabled} />
					<Field.Label for="schedule-enabled">Enabled</Field.Label>
				</Field.Field>
			</Field.Group>

			{#if errors.length > 0}
				<div class="flex flex-col gap-1">
					{#each errors as error (error)}
						<Banner tone="error">{error}</Banner>
					{/each}
				</div>
			{/if}
		</form>
		</div>

		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" type="button" disabled={saving}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button size="sm" type="button" disabled={saving} onclick={() => void save()}>
				{#if saving}<Spinner data-icon="inline-start" />{/if}
				{schedule === undefined ? 'Create' : 'Save'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.day {
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--muted-foreground);
		transition:
			background 0.15s,
			color 0.15s;
	}
	.day:hover {
		background: var(--muted);
		color: var(--foreground);
	}
	.day-on {
		border-color: color-mix(in oklab, var(--primary) 50%, transparent);
		background: color-mix(in oklab, var(--primary) 14%, transparent);
		color: var(--foreground);
	}
</style>
