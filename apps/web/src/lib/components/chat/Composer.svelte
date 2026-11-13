<script lang="ts">
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { onDestroy, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import type { ModelInfo, ModelRef, ProviderInfo, ThinkingLevel } from '@kemiri/protocol';
	import EffortPicker from './EffortPicker.svelte';
	import ModelPicker from './ModelPicker.svelte';
	import { hashTrigger, pickerChoices, withoutTrigger, type TaskOption } from '#lib/task-chat.js';
	import { isEmptyDraft, loadDraft, loadDraftState, saveDraft, saveDraftState, type Draft } from '#lib/drafts.js';
	import { DraftSync, draftOrigin } from '#lib/drafts-sync.js';
	import type { DraftChannel } from '#lib/draft-channel.js';
	import { messageWithQuotes } from '#lib/chat/quotes.js';
	import { imageDrop } from '#lib/chat/image-drop.js';
	import { MessageImages } from '#lib/chat/message-images.svelte.js';
	import type { HeldImage } from '#lib/chat/images.js';
	import AttachButton from './AttachButton.svelte';
	import FileChips from './FileChips.svelte';
	import { INPUT_FILE_MAX_BYTES, INPUT_MAX_FILES, isInputImageMimeType, type ChatFile } from '@kemiri/protocol';
	import ImageStrip from './ImageStrip.svelte';
	import QuoteChip from './QuoteChip.svelte';
	import TaskChip from './TaskChip.svelte';
	import TaskPicker from './TaskPicker.svelte';
	import WorkerPicker from './WorkerPicker.svelte';

	/**
	 * The message box: a rounded glass form that grows with what is typed, with the
	 * coordinator's model and thinking level on the left and send (or stop) on the
	 * right. When the backend has workers, a worker model + thinking picker sits
	 * beside them: it rides on each message and decides what new workers run on.
	 * Enter sends, Shift+Enter starts a new line; on touch devices Enter starts a
	 * new line and the button sends. With `tasks`, a message can be about one board task: `#` in the text or the task
	 * button picks it, it shows as a chip that can be removed, and it goes with the message. Quotes taken from the
	 * transcript (`addQuote`) wait as chips above the text and go in front of it as Markdown blockquotes. Images are
	 * pasted (an image on the clipboard), dropped on the box or picked with the attach button: they wait as removable
	 * thumbnails above the text, belong to the draft (as references, so they follow it to another device) and go with
	 * the message; a message of only images is fine.
	 */
	let {
		models,
		providers = [],
		model,
		thinkingLevel,
		thinkingLevels,
		workerModels = [],
		workerProviders = [],
		workerModel = null,
		workerThinkingLevel = null,
		showWorkerPicker = false,
		showModelPicker = true,
		modelNote,
		workerPickerDisabled = false,
		tasks,
		draftKey,
		draftChannel,
		busy = false,
		disabled = false,
		placeholder,
		onModelChange,
		onThinkingChange,
		onWorkerModelChange,
		onWorkerThinkingChange,
		onsend,
		uploadFile,
		onstop
	}: {
		models: readonly ModelInfo[];
		providers?: readonly ProviderInfo[];
		model: ModelRef | null;
		thinkingLevel: ThinkingLevel | null;
		thinkingLevels: readonly ThinkingLevel[];
		/** The catalog for the worker picker; empty when the backend has no models. */
		workerModels?: readonly ModelInfo[];
		workerProviders?: readonly ProviderInfo[];
		/** The worker model the user last picked; `null` lets the coordinator or the project decide. */
		workerModel?: ModelRef | null;
		workerThinkingLevel?: ThinkingLevel | null;
		/** Hidden when the backend's hello lacks the `workers` feature. */
		showWorkerPicker?: boolean;
		/** False where the model is not this screen's to change (a background thread keeps the one it started with). */
		showModelPicker?: boolean;
		/** Shown instead of the pickers when they are hidden, e.g. the thread's model. */
		modelNote?: string;
		/** The worker list has not loaded yet, so a pick could clobber a choice made on another device. */
		workerPickerDisabled?: boolean;
		/** The tasks a message can be about; undefined hides the task picker (no board, or a server without task reports). */
		tasks?: readonly TaskOption[];
		/**
		 * Which chat this composer is for (see `draftKey`); its unsent text, task and quotes are kept under it. Fixed for the
		 * life of the component: the parent remounts it (`{#key}`) when the chat changes, so one chat's draft never shows in another.
		 */
		draftKey?: string;
		/** The backend's draft store for this chat (see `draft-channel.ts`); without it the draft stays on this device. */
		draftChannel?: DraftChannel;
		/** The coordinator is working: the button becomes stop. */
		busy?: boolean;
		/** No conversation, no model, or a backend that is not connected. */
		disabled?: boolean;
		placeholder?: string;
		onModelChange: (model: ModelInfo) => void;
		onThinkingChange: (level: ThinkingLevel | null) => void;
		onWorkerModelChange?: (model: ModelInfo | null) => void;
		onWorkerThinkingChange?: (level: ThinkingLevel | null) => void;
		/** Resolves false when the message was not accepted, so the text and images are kept. */
		onsend: (text: string, taskId?: string, images?: HeldImage[], files?: ChatFile[]) => Promise<boolean>;
		uploadFile?: (file: File) => Promise<ChatFile>;
		onstop: () => void;
	} = $props();

	const chatKey = untrack(() => draftKey);
	const channel = untrack(() => draftChannel);
	const cached = chatKey === undefined ? undefined : loadDraftState(localStorage, chatKey);
	const restored = cached?.draft;

	let text = $state(restored?.text ?? '');
	let sending = $state(false);
	let textarea = $state<HTMLTextAreaElement | null>(null);

	let taskId = $state<string | undefined>(restored?.taskId);
	let quotes = $state<string[]>(restored?.quotes ?? []);
	/** The images of the message being written; the draft holds them as references (`attachments`). */
	const images = new MessageImages({ fetch: channel === undefined ? undefined : (id) => channel.readAttachment(id) });
	images.setRefs(restored?.attachments ?? []);
	let files = $state<ChatFile[]>([]);
	let uploading = $state(0);
	let fileError = $state<string | undefined>();
	async function addFiles(chosen: File[]): Promise<void> {
		fileError = undefined;
		for (const file of chosen) {
			if (files.length + images.count >= INPUT_MAX_FILES) { fileError = 'A message holds at most 8 attachments'; break; }
			if (isInputImageMimeType(file.type)) { await images.add([file]); continue; }
			if (file.size > INPUT_FILE_MAX_BYTES) { fileError = `${file.name}: each attachment must be at most 50 MB`; continue; }
			if (!uploadFile) { fileError = 'This backend does not support file attachments'; break; }
			uploading += 1;
			try { const uploaded = await uploadFile(file); files = [...files, uploaded]; }
			catch (e) { fileError = `${file.name}: ${e instanceof Error ? e.message : String(e)}`; }
			finally { uploading -= 1; }
		}
	}
	let dragging = $state(false);
	let savedJson = JSON.stringify(restored ?? { text: '', quotes: [] });
	let focused = false;
	/** Set when the draft on screen came from another device. */
	let origin = $state<{ name: string; attachments: number } | undefined>(undefined);

	function currentDraft(): Draft {
		const attachments = images.refs();
		return { text, quotes: [...quotes], ...(taskId === undefined ? {} : { taskId }), ...(attachments.length === 0 ? {} : { attachments }) };
	}

	// The draft is kept on the backend when it keeps drafts and on this device always (see `drafts-sync.ts`).
	const sync =
		chatKey === undefined || cached === undefined
			? undefined
			: new DraftSync({
					transport: channel ?? { available: () => false, read: async () => undefined, write: async () => ({ applied: false, draft: null }) },
					local: cached.draft,
					synced: cached.synced,
					focused: () => focused,
					persist: (local, synced) => saveDraftState(localStorage, chatKey, local, synced),
					apply: (draft, entry) => {
						// Where the caret was: still at the end if it was at the end, else the same place as far as the new text goes.
						const caret = focused ? { start: textarea?.selectionStart ?? 0, end: textarea?.selectionEnd ?? 0, atEnd: (textarea?.selectionEnd ?? 0) >= text.length } : undefined;
						text = draft.text;
						taskId = draft.taskId;
						quotes = draft.quotes;
						images.setRefs(draft.attachments ?? []);
						savedJson = JSON.stringify(currentDraft());
						origin = channel === undefined ? undefined : draftOrigin(entry, channel.device.deviceId);
						requestAnimationFrame(() => {
							autosize();
							if (caret !== undefined) {
								textarea?.setSelectionRange(caret.atEnd ? text.length : Math.min(caret.start, text.length), caret.atEnd ? text.length : Math.min(caret.end, text.length));
							}
						});
					}
				});

	// Keep the draft up to date as it changes (cleared on send, since the fields are emptied then).
	$effect(() => {
		if (sync === undefined) return;
		const draft = currentDraft();
		const json = JSON.stringify(draft);
		if (json === savedJson) return;
		savedJson = json;
		origin = undefined;
		sync.changed(draft);
	});
	// Read the backend's copy now and whenever the connection comes back, and follow its pushes.
	$effect(() => {
		if (sync !== undefined && channel?.available() === true) untrack(() => void sync.connectionChanged());
	});
	$effect(() => {
		if (sync === undefined || channel === undefined) return;
		return channel.onChanged((entry) => sync.pushed(entry));
	});
	// Images another device attached that could not be read are tried again when the connection is back.
	$effect(() => {
		if (channel?.available() === true) untrack(() => images.retryFailed());
	});
	onDestroy(() => {
		sync?.destroy();
		images.destroy();
	});

	// A draft restored with text needs the box sized to it.
	$effect(() => {
		if (textarea != null && untrack(() => text) !== '') autosize();
	});
	/** The quote whose chip was tapped, shown in full under the chips. */
	let openQuote = $state<number | undefined>(undefined);
	let trigger = $state<{ start: number; query: string } | undefined>(undefined);
	let dismissedAt = $state<number | undefined>(undefined);
	let listOpen = $state(false);
	let active = $state(0);

	const coarse = new MediaQuery('pointer: coarse');
	const attached = $derived(taskId === undefined || tasks === undefined ? undefined : (tasks.find((task) => task.id === taskId) ?? { id: taskId, title: '', status: 'todo' as const }));
	const pickerOpen = $derived(tasks !== undefined && (listOpen || trigger !== undefined));
	const choices = $derived(tasks === undefined ? [] : pickerChoices(tasks, trigger?.query ?? ''));
	const canSend = $derived(!sending && !disabled && uploading === 0 && files.length + images.count <= INPUT_MAX_FILES && images.ready && (text.trim().length > 0 || quotes.length > 0 || images.count > 0 || files.length > 0));
	/** The coordinator's model, when it is known not to read images: the pictures would reach it as a placeholder. */
	const blindModel = $derived.by(() => {
		if (!showModelPicker || model === null || images.count === 0) return false;
		const info = models.find((entry) => entry.provider === model.provider && entry.modelId === model.modelId);
		return info !== undefined && !info.input.includes('image');
	});
	const hint = $derived(
		placeholder ??
			(disabled
				? 'The coordinator is not ready'
				: busy
					? 'Send — the coordinator gets it at its next step…'
					: 'Message the coordinator…')
	);

	export function focus(): void {
		textarea?.focus();
	}

	export function setText(value: string): void {
		text = value;
		requestAnimationFrame(() => {
			textarea?.focus();
			autosize();
		});
	}

	/** Put a message taken back from the queue in front of what is being written; its task too when none is attached. */
	export function restore(message: string, task?: string, held: readonly HeldImage[] = [], restoredFiles: readonly ChatFile[] = []): void {
		text = text.trim().length === 0 ? message : `${message}\n\n${text}`;
		if (task !== undefined && taskId === undefined) taskId = task;
		images.restore(held);
		files = [...restoredFiles.filter(file => !files.some(held => held.id === file.id)), ...files];
		if (files.length + images.count > INPUT_MAX_FILES) fileError = 'A message holds at most 8 attachments. Remove files before sending.';
		requestAnimationFrame(() => {
			textarea?.focus();
			autosize();
		});
	}

	/** Quote text in the message being written, and go back to writing it. */
	export function addQuote(quote: string): void {
		quotes = [...quotes, quote];
		openQuote = undefined;
		requestAnimationFrame(() => textarea?.focus());
	}

	function removeQuote(index: number): void {
		quotes = quotes.filter((_, at) => at !== index);
		openQuote = undefined;
		textarea?.focus();
	}

	function syncTrigger(): void {
		const found = tasks === undefined || textarea == null ? undefined : hashTrigger(text, textarea.selectionStart);
		if (found === undefined) dismissedAt = undefined;
		const next = found !== undefined && found.start !== dismissedAt ? found : undefined;
		if (next?.query !== trigger?.query || next?.start !== trigger?.start) active = 0;
		trigger = next;
	}

	function closePicker(): void {
		if (trigger !== undefined) dismissedAt = trigger.start;
		trigger = undefined;
		listOpen = false;
	}

	function pick(option: TaskOption): void {
		taskId = option.id;
		if (trigger !== undefined) {
			const rest = withoutTrigger(text, trigger);
			text = rest.text;
			requestAnimationFrame(() => {
				textarea?.setSelectionRange(rest.caret, rest.caret);
				autosize();
			});
		}
		trigger = undefined;
		dismissedAt = undefined;
		listOpen = false;
		textarea?.focus();
	}

	function toggleList(): void {
		if (pickerOpen) closePicker();
		else {
			active = 0;
			listOpen = true;
		}
	}

	function outside(event: PointerEvent): void {
		if (!pickerOpen || (event.target as Element).closest('[data-task-picker],[data-task-picker-toggle]') !== null) return;
		closePicker();
	}

	function autosize(): void {
		if (textarea == null) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, window.innerHeight * 0.4)}px`;
	}

	async function send(): Promise<void> {
		if (!canSend) return;
		sending = true;
		const sent = text;
		const sentTask = attached?.id;
		const sentQuotes = quotes;
		const sentImages = images.held();
		const sentFiles = files;
		files = [];
		text = '';
		taskId = undefined;
		quotes = [];
		images.clear();
		openQuote = undefined;
		closePicker();
		requestAnimationFrame(autosize);
		// The cleared composer goes to the backend at once, not after the debounce.
		savedJson = JSON.stringify(currentDraft());
		sync?.changed(currentDraft());
		sync?.flush();
		try {
			// On success the draft is already gone: emptying the fields above saved an empty draft.
			if (!(await onsend(messageWithQuotes(sentQuotes, sent), sentTask, sentImages, sentFiles))) {
				// This composer may be gone (the user went to another chat): put the message back in its chat's draft, unless
				// something newer was typed there since.
				if (chatKey !== undefined && isEmptyDraft(loadDraft(localStorage, chatKey))) {
					saveDraft(localStorage, chatKey, {
						text: sent,
						quotes: sentQuotes,
						...(sentTask === undefined ? {} : { taskId: sentTask }),
						...(sentImages.length === 0 ? {} : { attachments: sentImages.map(({ data: _data, ...ref }) => ref) })
					});
				}
				text = sent;
				taskId = sentTask;
				quotes = sentQuotes;
				images.restore(sentImages);
				files = [...sentFiles, ...files];
				requestAnimationFrame(autosize);
			}
		} finally {
			sending = false;
		}
	}

	function onkeydown(event: KeyboardEvent): void {
		if (pickerOpen && !event.isComposing) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				if (choices.length > 0) active = (active + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
				return;
			}
			if ((event.key === 'Enter' || event.key === 'Tab') && choices[active] !== undefined && (trigger !== undefined || listOpen)) {
				event.preventDefault();
				pick(choices[active]);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				closePicker();
				return;
			}
		}
		if (event.key === 'Backspace' && text === '' && taskId !== undefined) {
			event.preventDefault();
			taskId = undefined;
			return;
		}
		if (event.key === 'Backspace' && text === '' && quotes.length > 0) {
			event.preventDefault();
			removeQuote(quotes.length - 1);
			return;
		}
		if (event.key !== 'Enter' || event.isComposing || event.shiftKey || coarse.current) return;
		event.preventDefault();
		void send();
	}
</script>

<svelte:window onpointerdown={outside} onpagehide={() => sync?.flush()} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && sync?.flush()} />

<form
	class="composer relative rounded-[1.75rem] border border-(--chat-border) shadow-(--chat-shadow) glass transition-colors {dragging
		? 'border-(--accent-2) ring-2 ring-(--accent-2)/40'
		: ''}"
	use:imageDrop={{ images, disabled: disabled || sending || uploading > 0, onfiles: uploadFile ? addFiles : undefined, onover: (over) => (dragging = over) }}
	data-drop-target={dragging ? 'over' : undefined}
	onsubmit={(event) => {
		event.preventDefault();
		void send();
	}}
>
	{#if pickerOpen}
		<TaskPicker {choices} {active} searching={trigger !== undefined && trigger.query.length > 0} onpick={pick} onhover={(index) => (active = index)} />
	{/if}
	{#if attached}
		<div class="flex min-w-0 items-center gap-1.5 px-4 pt-3" data-task-attached={attached.id}>
			<span class="shrink-0 text-xs text-(--chat-fg-subtle)">About</span>
			<TaskChip taskId={attached.id} title={attached.title} onremove={() => { taskId = undefined; textarea?.focus(); }} />
		</div>
	{/if}
	{#if quotes.length > 0}
		<div class="flex min-w-0 flex-col gap-1.5 px-4 {attached ? 'pt-1.5' : 'pt-3'}" data-quotes>
			<div class="flex min-w-0 flex-wrap items-center gap-1.5">
				{#each quotes as quote, index (index)}
					<QuoteChip
						{quote}
						open={openQuote === index}
						ontoggle={() => (openQuote = openQuote === index ? undefined : index)}
						onremove={() => removeQuote(index)}
					/>
				{/each}
			</div>
			{#if openQuote !== undefined && quotes[openQuote] !== undefined}
				<blockquote class="quote max-h-32 overflow-y-auto py-0.5 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-(--chat-fg-muted)">{quotes[openQuote]}</blockquote>
			{/if}
		</div>
	{/if}
	{#if files.length > 0}
		<div class="px-4 pt-3"><FileChips {files} onremove={id => files = files.filter(file => file.id !== id)} /></div>
	{/if}
	{#if uploading > 0}<p role="status" class="px-4 pt-2 text-sm text-(--chat-fg-subtle)">Uploading attachment…</p>{/if}
	{#if fileError}<p role="alert" class="px-4 pt-2 text-sm text-(--chat-warning)">{fileError}</p>{/if}
	{#if images.count > 0}
		<div class="px-4 {attached || quotes.length > 0 ? 'pt-2' : 'pt-3'}" data-composer-images>
			<ImageStrip
				images={images.items.map((item) => ({ key: item.id, src: item.url, label: item.name ?? 'Image', status: item.status }))}
				onremove={(id) => {
					images.remove(id);
					textarea?.focus();
				}}
			/>
		</div>
	{/if}
	<textarea
		bind:this={textarea}
		bind:value={text}
		oninput={() => {
			autosize();
			syncTrigger();
		}}
		onkeyup={(event) => {
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') syncTrigger();
		}}
		onclick={syncTrigger}
		onfocus={() => (focused = true)}
		onblur={() => {
			focused = false;
			sync?.flush();
		}}
		{onkeydown}
		rows="1"
		placeholder={hint}
		class="block max-h-[40dvh] w-full resize-none bg-transparent px-5 {attached || quotes.length > 0 ? 'pt-2' : images.count > 0 ? 'pt-2' : 'pt-4'} pb-2 text-base leading-relaxed outline-none placeholder:text-(--chat-fg-subtle)"
		aria-label="Message"
		enterkeyhint={coarse.current ? 'enter' : 'send'}
	></textarea>
	{#if origin}
		<p class="px-5 pb-1 text-[11px] leading-none text-(--chat-fg-subtle)" data-draft-origin>
			Draft from {origin.name}{#if origin.attachments > 0}{' '}· {origin.attachments === 1 ? 'with its image' : `with its ${origin.attachments} images`}{/if}
		</p>
	{/if}
	{#if images.error}
		<p class="px-5 pb-1 text-xs break-words text-(--chat-danger)" role="alert" data-image-error>{images.error}</p>
	{:else if blindModel}
		<p class="px-5 pb-1 text-xs text-(--chat-fg-subtle)" data-image-blind>This model cannot read images; it will see a placeholder instead.</p>
	{/if}

	<!-- One row on phones: the model chip truncates, the thinking and worker chips are icons. -->
	<div class="flex items-center gap-1 px-2 pb-2 sm:flex-wrap">
		<div class="flex min-w-0 items-center gap-1 sm:flex-wrap">
			{#if showModelPicker}
				<ModelPicker {models} {providers} value={model} onchange={onModelChange} />
				<EffortPicker levels={thinkingLevels} value={thinkingLevel} onchange={onThinkingChange} />
			{:else if modelNote}
				<span class="truncate px-2 text-xs text-(--chat-fg-subtle)">{modelNote}</span>
			{/if}
			{#if showWorkerPicker}
				<WorkerPicker
					models={workerModels}
					providers={workerProviders}
					model={workerModel}
					thinkingLevel={workerThinkingLevel}
					onModelChange={(entry) => onWorkerModelChange?.(entry)}
					onThinkingChange={(level) => onWorkerThinkingChange?.(level)}
					disabled={workerModels.length === 0 || workerPickerDisabled}
				/>
			{/if}
		</div>

		<div class="ml-auto flex shrink-0 items-center gap-1.5">
			<AttachButton {images} disabled={disabled || sending || uploading > 0} onfiles={uploadFile ? addFiles : undefined} />
			{#if tasks !== undefined}
				<button
					type="button"
					class="grid size-9 place-items-center rounded-full transition-colors active:scale-95 {attached || pickerOpen
						? 'bg-(--chat-surface-2) text-(--accent-2)'
						: 'text-(--chat-fg-subtle) hover:bg-(--chat-surface-2) hover:text-(--chat-fg)'}"
					onclick={toggleList}
					aria-label="Message about a task"
					aria-expanded={pickerOpen}
					title="Message about a task (type # to search)"
					data-task-picker-toggle
				>
					<ClipboardListIcon class="size-4" />
				</button>
			{/if}
			{#if busy}
				<button
					type="button"
					class="grid size-9 place-items-center rounded-full bg-(--chat-fg) text-(--chat-bg) transition-transform active:scale-95"
					onclick={onstop}
					aria-label="Stop"
					title="Stop"
				>
					<SquareIcon class="size-3.5 fill-current" />
				</button>
			{/if}
			<button
				type="submit"
				class="send grid size-9 place-items-center rounded-full text-white transition-all active:scale-95 disabled:opacity-35 disabled:saturate-0"
				disabled={!canSend}
				aria-label="Send"
				title="Send"
			>
				<ArrowUpIcon class="size-4.5" strokeWidth={2.5} />
			</button>
		</div>
	</div>
</form>

<style>
	.send {
		background: var(--chat-grad);
		background-size: 150% 150%;
		box-shadow: 0 4px 14px -4px color-mix(in oklab, var(--accent-3) 60%, transparent);
	}
	.quote {
		border-left: 2px solid transparent;
		border-image: var(--chat-grad) 1;
		overflow-wrap: anywhere;
	}
	.composer:focus-within {
		border-color: color-mix(in oklab, var(--accent-2) 45%, var(--chat-border));
	}
</style>
