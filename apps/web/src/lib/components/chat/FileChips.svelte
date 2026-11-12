<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import XIcon from '@lucide/svelte/icons/x';
	import { fileSizeLabel, type ChatFile } from '@aiki/protocol';
	import { fileDownload } from '#lib/chat/file-scope.js';
	let { files, onremove }: { files: readonly ChatFile[]; onremove?: (id: string) => void } = $props();
	const download = fileDownload();
	let error = $state<string | undefined>();
</script>
<div class="flex min-w-0 flex-wrap gap-2" data-file-chips>
	{#each files as file (file.id)}
		<div class="flex max-w-full items-center gap-2 rounded-2xl border border-(--chat-border) bg-(--chat-surface-2) pl-3 text-sm text-(--chat-fg)" data-file-chip={file.name}>
			{#if /zip|gzip|tar|archive/.test(file.mimeType)}<ArchiveIcon class="size-4 shrink-0" aria-hidden="true" />
			{:else if /text|json|pdf|yaml/.test(file.mimeType)}<FileTextIcon class="size-4 shrink-0" aria-hidden="true" />
			{:else}<FileIcon class="size-4 shrink-0" aria-hidden="true" />{/if}
			{#if onremove}
				<span class="min-w-0 py-2"><span class="block truncate font-medium">{file.name}</span><span class="text-xs text-(--chat-fg-subtle)">{fileSizeLabel(file.size)} · {file.mimeType}</span></span>
				<button type="button" class="grid size-12 shrink-0 place-items-center rounded-full hover:bg-(--chat-surface)" aria-label={`Remove ${file.name}`} onclick={() => onremove?.(file.id)}><XIcon class="size-4" /></button>
			{:else}
				<a href={file.url} download={file.name} class="min-h-12 min-w-0 py-2 pr-3 hover:underline" aria-label={`Download ${file.name}, ${fileSizeLabel(file.size)}`} onclick={async event => { event.preventDefault(); try { if (!download) throw new Error('Open this conversation on its backend to download files'); await download(file); error = undefined; } catch (e) { error = e instanceof Error ? e.message : String(e); } }}><span class="block truncate font-medium">{file.name}</span><span class="text-xs text-(--chat-fg-subtle)">{fileSizeLabel(file.size)} · {file.mimeType}</span></a>
			{/if}
		</div>
	{/each}
</div>
{#if error}<p role="alert" class="text-sm text-(--chat-warning)">{error}</p>{/if}
