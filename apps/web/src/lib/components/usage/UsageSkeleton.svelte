<script lang="ts">
	/** A subscription card while its numbers load. */
</script>

<div class="flex flex-col gap-4 rounded-2xl border border-(--chat-border) bg-(--chat-surface)/40 p-4 sm:p-5" aria-hidden="true">
	<div class="flex items-center gap-3">
		<div class="size-10 animate-pulse rounded-xl bg-(--chat-surface-2) motion-reduce:animate-none"></div>
		<div class="flex flex-1 flex-col gap-2">
			<div class="h-3.5 w-28 animate-pulse rounded bg-(--chat-surface-2) motion-reduce:animate-none"></div>
			<div class="h-3 w-40 animate-pulse rounded bg-(--chat-surface-2) motion-reduce:animate-none"></div>
		</div>
	</div>
	<div class="flex items-center gap-4">
		<div class="size-[116px] shrink-0 animate-pulse rounded-full border-[9px] border-(--chat-surface-2) motion-reduce:animate-none"></div>
		<div class="flex flex-1 flex-col gap-2">
			<div class="h-3.5 w-24 animate-pulse rounded bg-(--chat-surface-2) motion-reduce:animate-none"></div>
			<div class="h-5 w-20 animate-pulse rounded-full bg-(--chat-surface-2) motion-reduce:animate-none"></div>
			<div class="h-3 w-full animate-pulse rounded bg-(--chat-surface-2) motion-reduce:animate-none"></div>
			<div class="h-3 w-2/3 animate-pulse rounded bg-(--chat-surface-2) motion-reduce:animate-none"></div>
		</div>
	</div>
	<div class="h-[72px] animate-pulse rounded-lg bg-(--chat-surface-2)/70 motion-reduce:animate-none"></div>
</div>
