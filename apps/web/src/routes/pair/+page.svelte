<script lang="ts">
	import { onMount } from 'svelte';
	import { deviceComparisonCode } from '@aiki/protocol';
	import {
		BackendDeviceAuth,
		authRequest,
		AuthHttpError,
		browserDeviceLabel,
		type PairPageLink,
		type ClaimResult,
	} from '#lib/device-auth.js';
	import { deviceCredentials, STORAGE_WARNING, type ClaimProof } from '#lib/device-credentials.js';
	import { takePairLink } from '#lib/pair-inbox.js';
	import { harness } from '#lib/harness.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	let link = $state<PairPageLink | undefined>(undefined);
	let backendName = $state('');
	let backendId = $state('');
	let code = $state('');
	let label = $state('');
	let comparison = $state('');
	let error = $state('');
	let warning = $state('');
	let pairState = $state<'loading' | 'confirm' | 'pending' | 'connected' | 'error'>('loading');
	let busy = $state(false);
	let proof: ClaimProof | undefined;
	let canRetry = $state(false);
	let auth: BackendDeviceAuth | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let failures = 0;
	onMount(() => {
		const invitation = takePairLink();
		link = invitation.link;
		error = invitation.error;
		label = browserDeviceLabel();
		if (!link && !error) void resume();
		else if (!link) pairState = 'error';
		else void discover();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	});
	async function resume(): Promise<void> {
		const record = await deviceCredentials.pendingPairing();
		if (!record?.pairing) {
			pairState = 'error';
			error =
				'Open a fresh pairing link from another signed-in device, or use the owner CLI on your computer.';
			return;
		}
		proof = record.pairing;
		canRetry = true;
		link = {
			kind: 'bootstrap',
			backendId: record.backendId,
			backendOrigin: record.origin,
			requestId: record.pairing.grantId ?? 'local',
		};
		auth = new BackendDeviceAuth(record.origin);
		try {
			await auth.discover();
			backendId = record.backendId;
			backendName = record.pairing.label ?? 'Backend';
			pairState = 'pending';
			await poll();
		} catch (e) {
			fail(e);
		}
	}
	async function discover(): Promise<void> {
		if (!link) return;
		try {
			auth = new BackendDeviceAuth(link.backendOrigin);
			const status = await auth.discover();
			if (!status || (link.backendId && status.backendId !== link.backendId))
				throw new Error('The backend identity does not match this link. Do not pair.');
			backendId = status.backendId;
			backendName = harness.backends.find((b) => b.url === link?.backendOrigin)?.name ?? 'New backend';
			pairState = 'confirm';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not reach this backend.';
			pairState = 'error';
		}
	}
	async function pair(): Promise<void> {
		if (!auth || !link || busy) return;
		busy = true;
		error = '';
		try {
			const record = await auth.record();
			const grantId = link.kind === 'pair' ? link.grantId : link.requestId;
			if (record.pairing?.grantId && record.pairing.grantId !== grantId) {
				delete record.pairing;
				await auth.store.write(record);
			}
			proof = await auth.proof('pairing');
			canRetry = true;
			const staged = await auth.record();
			staged.pairing = { ...proof, grantId, label: backendName, started: true };
			await auth.store.write(staged);
			warning = auth.store.memoryOnly ? STORAGE_WARNING : '';
			comparison = await deviceComparisonCode(
				backendId,
				link.kind === 'pair' ? link.grantId : link.requestId,
				proof.claimId,
				proof.claimSecret,
			);
			const result = await authRequest<ClaimResult>(
				link.backendOrigin,
				link.kind === 'pair' ? '/auth/pairings/redeem' : '/auth/bootstrap/redeem',
				{
					...proof,
					label,
					platform: 'web',
					...(link.kind === 'pair'
						? { grantId: link.grantId, secret: link.secret }
						: { requestId: link.requestId, code: link.code ?? code.replace(/\s|-/g, '').toUpperCase() }),
				},
			);
			await receive(result);
		} catch (e) {
			fail(e);
		} finally {
			busy = false;
		}
	}
	function fail(e: unknown): void {
		error = e instanceof Error ? e.message : 'Pairing failed.';
		if (e instanceof AuthHttpError && e.status === 429) {
			pairState = 'pending';
			timer = setTimeout(() => void pair(), Math.max(1000, e.retryAfter * 1000));
		} else pairState = 'error';
	}
	async function receive(result: ClaimResult): Promise<void> {
		if (!auth || !proof || !link || stopped) return;
		comparison = result.comparisonCode;
		if (await auth.acceptClaim(result, proof)) {
			warning = auth.store.memoryOnly ? STORAGE_WARNING : '';
			harness.load();
			const backend =
				harness.backends.find((b) => b.url === link?.backendOrigin) ??
				harness.addBackend(backendName, link.backendOrigin);
			backend.client.close();
			backend.client.connect();
			await backend.client.whenReady();
			pairState = 'connected';
			return;
		}
		if (result.state !== 'pending')
			throw new Error(
				result.state === 'denied'
					? 'Pairing was denied. Ask for a new link.'
					: 'This pairing expired or was already used. Ask for a new link.',
			);
		pairState = 'pending';
		failures = 0;
		timer = setTimeout(() => void poll(), 1500);
	}
	async function poll(): Promise<void> {
		if (!link || !proof || stopped) return;
		try {
			await receive(await authRequest<ClaimResult>(link.backendOrigin, '/auth/claims/poll', proof));
		} catch (e) {
			if (e instanceof AuthHttpError && e.status !== 429) {
				fail(e);
				return;
			}
			if (++failures > 8) {
				fail(new Error('Could not reach the backend. Retry using this same page.'));
				return;
			}
			timer = setTimeout(
				() => void poll(),
				e instanceof AuthHttpError
					? Math.max(1000, e.retryAfter * 1000)
					: Math.min(30_000, 2000 * 2 ** failures),
			);
		}
	}
</script>

<svelte:head
	><title>Pair a device · Aiki</title><meta name="referrer" content="no-referrer" /><meta
		name="robots"
		content="noindex,nofollow"
	/></svelte:head
>
<main
	class="flex min-h-dvh items-center justify-center overflow-y-auto bg-background p-4 text-foreground sm:p-8"
>
	<section class="w-full max-w-lg space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
		<div>
			<p class="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
				Aiki · Device sign-in
			</p>
			<h1 class="mt-2 text-2xl font-semibold">
				{pairState === 'connected' ? 'Device paired' : 'Pair this device'}
			</h1>
		</div>
		{#if link}
			<div class="space-y-1 rounded-xl bg-muted/60 p-4">
				<p class="font-semibold">{backendName || 'Backend'}</p>
				<p class="text-sm break-all">{link.backendOrigin}</p>
				<p class="font-mono text-xs break-all text-muted-foreground">
					{backendId || link.backendId || 'Checking identity…'}
				</p>
			</div>
		{/if}
		{#if warning}<p role="status" class="text-sm text-amber-700 dark:text-amber-300">{warning}</p>{/if}
		{#if pairState === 'loading'}<p class="text-sm text-muted-foreground">Checking backend identity…</p>{/if}
		{#if pairState === 'confirm'}
			<div class="space-y-2">
				<h2 class="font-semibold">Full access to this computer</h2>
				<p class="text-sm text-muted-foreground">
					This device can read and change files, run terminals and agents, and use provider accounts. Pair
					only a computer you trust at the address above.
				</p>
			</div>
			<form
				class="space-y-4"
				onsubmit={(e) => {
					e.preventDefault();
					void pair();
				}}
			>
				<label class="block space-y-1 text-sm"
					><span>Backend name in this browser</span><input
						class="w-full rounded-lg border bg-background p-2.5"
						bind:value={backendName}
						required
						maxlength="120"
					/></label
				>
				<label class="block space-y-1 text-sm"
					><span>This device's label</span><input
						class="w-full rounded-lg border bg-background p-2.5"
						bind:value={label}
						required
						maxlength="120"
					/></label
				>
				{#if link?.kind === 'bootstrap' && !link.code}<label class="block space-y-1 text-sm"
						><span>12-character code from the owner CLI</span><input
							class="w-full rounded-lg border bg-background p-2.5 font-mono uppercase"
							autocomplete="off"
							bind:value={code}
							required
							pattern={'[A-Za-z2-7 \-]{12,16}'}
						/></label
					>{/if}
				<Button class="w-full" type="submit" disabled={busy}>{busy ? 'Pairing…' : 'Pair'}</Button>
			</form>
		{/if}
		{#if pairState === 'pending'}<div class="rounded-xl border p-5 text-center">
				<p class="text-sm text-muted-foreground">Compare this code on the approving device</p>
				<p class="my-3 font-mono text-3xl tracking-wider">{comparison}</p>
				<p role="status" class="text-sm">Waiting for approval…</p>
			</div>
			<p class="text-sm text-muted-foreground">
				Only approve when both codes match. Keep this page open.
			</p>{/if}
		{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		{#if pairState === 'error' && canRetry}<Button
				variant="outline"
				onclick={() => {
					error = '';
					pairState = 'pending';
					failures = 0;
					if (link?.kind === 'pair' || (link?.kind === 'bootstrap' && (link.code || code))) void pair();
					else void poll();
				}}>Retry delivery</Button
			>{/if}
		{#if pairState === 'connected'}<p class="text-sm">
				This browser is signed in. You can revoke its access in Settings → Devices.
			</p>
			<a
				href="/"
				data-sveltekit-reload
				class="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
				>Open Aiki</a
			>{/if}
		<a href="/" data-sveltekit-reload class="block text-sm text-muted-foreground underline"
			>{pairState === 'connected' ? 'Home' : 'Cancel and go home'}</a
		>
	</section>
</main>
