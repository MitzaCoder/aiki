<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ImageIcon from '@lucide/svelte/icons/image';
	import MusicIcon from '@lucide/svelte/icons/music';
	import VideoIcon from '@lucide/svelte/icons/video';
	import type { ArtifactKind } from '@mihai-harness/protocol';

	/** The icon for an artifact's kind. */
	let { kind, class: className = 'size-4' }: { kind: ArtifactKind; class?: string } = $props();

	const ICONS = { video: VideoIcon, image: ImageIcon, audio: MusicIcon, text: FileTextIcon, file: FileIcon };
	const Icon = $derived(ICONS[kind]);
</script>

<Icon class={className} aria-hidden="true" />
