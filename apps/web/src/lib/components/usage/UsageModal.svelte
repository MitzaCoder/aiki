<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import UsageBody from '#lib/components/usage/UsageBody.svelte';
	import { usageModal } from '#lib/usage-modal.svelte.js';
</script>

<Dialog.Root bind:open={usageModal.open}>
	<Dialog.Content
		showCloseButton={false}
		class="flex flex-col gap-0 overflow-hidden p-0 max-sm:inset-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:h-[min(52rem,88dvh)] sm:max-w-6xl"
	>
		<UsageBody />
	</Dialog.Content>
</Dialog.Root>
