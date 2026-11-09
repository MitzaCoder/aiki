<script lang="ts">
	import ImageOffIcon from '@lucide/svelte/icons/image-off';
	import XIcon from '@lucide/svelte/icons/x';
	import ImageLightbox from '#lib/components/artifacts/ImageLightbox.svelte';

	/**
	 * Images in a message as small pictures. A click opens one large (the artifacts' lightbox). With `onremove` each has a ×
	 * (the composer); without it they are the pictures of a sent or waiting message, bigger. An image another device
	 * attached shows a quiet placeholder while its bytes come, and a crossed-out picture when they cannot.
	 */
	let {
		images,
		onremove,
		size = 'small'
	}: {
		images: { key: string; src?: string; label: string; status?: 'ready' | 'loading' | 'failed' }[];
		onremove?: (key: string) => void;
		size?: 'small' | 'large';
	} = $props();

	let opened = $state<{ src: string; label: string } | undefined>(undefined);
</script>

<ul class="flex min-w-0 flex-wrap gap-2 {size === 'large' ? 'justify-end' : ''}" aria-label="Attached images" data-image-strip>
	{#each images as image (image.key)}
		<li class="group/thumb relative" data-image-thumb data-status={image.status ?? 'ready'}>
			{#if image.src !== undefined && (image.status ?? 'ready') === 'ready'}
				<button
					type="button"
					class="block overflow-hidden border border-(--chat-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) {size === 'large'
						? 'rounded-2xl border-(--chat-user-border)'
						: 'rounded-xl'}"
					onclick={() => (opened = { src: image.src!, label: image.label })}
					aria-label="View {image.label} larger"
					title={image.label}
				>
					<img
						src={image.src}
						alt={image.label}
						class={size === 'large' ? 'max-h-56 max-w-full object-cover sm:max-h-64' : 'size-14 object-cover sm:size-16'}
					/>
				</button>
			{:else}
				<div
					class="grid size-14 place-items-center rounded-xl border border-(--chat-border) bg-(--chat-surface-2)/60 text-(--chat-fg-subtle) sm:size-16 {image.status === 'loading'
						? 'animate-pulse'
						: ''}"
					title={image.status === 'failed' ? `${image.label} is not available on this device. Remove it.` : `Loading ${image.label}…`}
					role={image.status === 'failed' ? 'img' : undefined}
					aria-label={image.status === 'failed' ? `${image.label} is not available` : undefined}
				>
					{#if image.status === 'failed'}<ImageOffIcon class="size-5" />{/if}
				</div>
			{/if}
			{#if onremove}
				<button
					type="button"
					class="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full border border-(--chat-border) bg-(--chat-bg-elev) text-(--chat-fg-muted) shadow-sm transition-colors hover:text-(--chat-fg) focus-visible:outline-2 focus-visible:outline-(--ring) max-sm:size-7"
					onclick={() => onremove(image.key)}
					aria-label="Remove {image.label}"
					title="Remove"
				>
					<XIcon class="size-3.5" />
				</button>
			{/if}
		</li>
	{/each}
</ul>

{#if opened}
	<ImageLightbox src={opened.src} alt={opened.label} title={opened.label} onclose={() => (opened = undefined)} />
{/if}
