<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { harness } from '#lib/harness.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	let error = $state('');
	let busy = $state(false);
	const backend = $derived(harness.backends.find((b) => b.pairingRequest));
	const pairing = $derived(backend?.pairingRequest);
	async function answer(approve: boolean): Promise<void> {
		busy = true;
		error = '';
		try {
			await backend?.answerPairing(approve);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not answer pairing.';
		} finally {
			busy = false;
		}
	}
</script>

{#if pairing && backend}
	<Dialog.Root open={true}
		><Dialog.Content
			class="max-w-md space-y-5"
			onInteractOutside={(e) => e.preventDefault()}
			onEscapeKeydown={(e) => e.preventDefault()}
		>
			<div>
				<p class="text-xs text-muted-foreground">{backend.name}</p>
				<Dialog.Title class="mt-1 text-xl font-semibold">Approve a new device?</Dialog.Title>
			</div>
			<p class="text-sm">{pairing.label} · {pairing.platform}</p>
			<div class="rounded-xl bg-muted p-5 text-center">
				<p class="text-xs text-muted-foreground">Compare this code on both devices</p>
				<p class="mt-2 font-mono text-3xl tracking-wider">{pairing.comparisonCode}</p>
			</div>
			<p class="text-sm text-muted-foreground">
				Full access to this computer. Approve only if you started this pairing and the codes match. Labels are
				not proof of identity.
			</p>
			{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			<div class="flex justify-end gap-2">
				<Button variant="outline" disabled={busy} onclick={() => void answer(false)}>Deny</Button><Button
					disabled={busy}
					onclick={() => void answer(true)}>Approve device</Button
				>
			</div>
		</Dialog.Content></Dialog.Root
	>
{/if}
