<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { onMount } from 'svelte';
	import { encodePairingFragment, type AuthDevice, type AuthPairing } from '@aiki/protocol';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import QrCode from '#lib/components/QrCode.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import SettingsGroup from './SettingsGroup.svelte';
	let { backend }: { backend: BackendConnection } = $props();
	let devices = $state<AuthDevice[]>([]);
	let pairings = $state<AuthPairing[]>([]);
	let confirmDevice = $state(true);
	let link = $state('');
	let grant = $state<AuthPairing | undefined>(undefined);
	let now = $state(Date.now());
	let error = $state('');
	let busy = $state(false);
	let revokeDevice = $state<AuthDevice | undefined>(undefined);
	let editing = $state<string | undefined>(undefined);
	let label = $state('');
	async function load(): Promise<void> {
		if (!backend.ready || !backend.authSessionId) return;
		try {
			const [d, p] = await Promise.all([
				backend.client.request({ type: 'auth.devices.list' }),
				backend.client.request({ type: 'auth.pairings.list' }),
			]);
			if (d.type === 'error') throw new Error(d.error.message);
			if (p.type === 'error') throw new Error(p.error.message);
			if (d.type === 'auth.devices.list') devices = d.devices;
			if (p.type === 'auth.pairings.list') {
				pairings = p.pairings;
				if (
					grant &&
					!pairings.some(
						(pairing) => pairing.id === grant?.id && ['unused', 'claimed'].includes(pairing.state),
					)
				) {
					grant = undefined;
					link = '';
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load devices.';
		}
	}
	$effect(() => {
		void backend.devicesVersion;
		void backend.authSessionId;
		if (backend.ready) void load();
	});
	onMount(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		const migration = setInterval(() => void backend.pollMigration(), 10_000);
		return () => {
			clearInterval(timer);
			clearInterval(migration);
		};
	});
	async function create(): Promise<void> {
		busy = true;
		error = '';
		try {
			const response = await backend.client.request({ type: 'auth.pairings.create', confirm: confirmDevice });
			if (response.type === 'error') throw new Error(response.error.message);
			if (response.type !== 'auth.pairings.create' || !backend.authBackendId) return;
			grant = response.pairing;
			link = `${location.origin}/pair${encodePairingFragment({ backendId: backend.authBackendId, backendOrigin: backend.url, grantId: grant.id, secret: response.secret })}`;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not create pairing.';
		} finally {
			busy = false;
		}
	}
	async function cancel(grantId: string): Promise<void> {
		try {
			const response = await backend.client.request({ type: 'auth.pairings.cancel', grantId });
			if (response.type === 'error') {
				error = response.error.message;
				return;
			}
			if (grant?.id === grantId) {
				grant = undefined;
				link = '';
			}
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not cancel pairing.';
		}
	}
	async function rename(sessionId: string): Promise<void> {
		try {
			const response = await backend.client.request({ type: 'auth.devices.rename', sessionId, label });
			if (response.type === 'error') {
				error = response.error.message;
				return;
			}
			editing = undefined;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not rename device.';
		}
	}
	async function revoke(): Promise<void> {
		if (!revokeDevice) return;
		const device = revokeDevice;
		revokeDevice = undefined;
		try {
			const response = await backend.client.request({ type: 'auth.devices.revoke', sessionId: device.id });
			if (response.type === 'error') {
				error = response.error.message;
				return;
			}
			if (!device.current) await load();
		} catch (e) {
			if (!device.current || backend.ready)
				error = e instanceof Error ? e.message : 'Could not revoke device.';
		}
	}
	const date = (timestamp: string): string => new Date(timestamp).toLocaleString();
</script>

<SettingsGroup title="Devices">
	<div class="space-y-5 p-4 sm:p-5" data-devices>
		<p class="text-sm text-muted-foreground">
			Every paired device has full access to this computer, including files, terminals and provider accounts.
		</p>
		{#if backend.storageWarning}<p role="status" class="text-sm text-amber-700 dark:text-amber-300">
				{backend.storageWarning}
			</p>{/if}
		{#if backend.authNotice}<p role="status" class="rounded-xl border p-3 text-sm">
				{backend.authNotice}
			</p>{/if}
		{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
		{#if !backend.authSessionId}
			<p class="text-sm text-muted-foreground">
				{backend.authMode === 'optional' && backend.ready
					? 'You can keep using this backend while the owner approves this browser. Compare the code using the owner CLI.'
					: 'Pair this backend using a new link from another device or the owner CLI.'}
			</p>
			<a class="text-sm underline" href="/pair">Pair this backend</a>
			{#if backend.authMode === 'optional' && backend.authNotice?.includes('enrollment')}<Button
					variant="outline"
					onclick={() => void backend.requestMigrationApproval()}>Request approval again</Button
				>{/if}
		{:else}
			<ul class="divide-y rounded-xl border">
				{#each devices as device (device.id)}
					<li class="space-y-2 p-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div>
								<strong class="text-sm">{device.label}</strong>{#if device.current}<span
										class="ml-2 rounded-full bg-primary/10 px-2 py-1 text-xs">This device</span
									>{/if}
							</div>
							<div class="flex gap-2">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => {
										editing = device.id;
										label = device.label;
									}}>Rename</Button
								><Button variant="outline" size="sm" onclick={() => (revokeDevice = device)}
									>{device.current ? 'Sign out' : 'Revoke'}</Button
								>
							</div>
						</div>
						{#if editing === device.id}<form
								class="flex gap-2"
								onsubmit={(e) => {
									e.preventDefault();
									void rename(device.id);
								}}
							>
								<input
									aria-label="Device label"
									class="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
									bind:value={label}
									maxlength="120"
									required
								/><Button size="sm" type="submit">Save</Button><Button
									size="sm"
									variant="ghost"
									onclick={() => (editing = undefined)}>Cancel</Button
								>
							</form>{/if}
						<p class="text-xs text-muted-foreground">{device.platform} · {device.connectedCount} connected</p>
						<dl class="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
							<div>Created {date(device.createdAt)}</div>
							<div>Last seen {date(device.lastSeenAt)}</div>
							<div>Expires {date(device.expiresAt)}</div>
						</dl>
					</li>
				{/each}
			</ul>
			<div class="space-y-3 rounded-xl border p-4">
				<h3 class="text-sm font-semibold">Add a device</h3>
				<label class="flex items-center gap-2 text-sm"
					><input
						type="checkbox"
						bind:checked={confirmDevice}
						disabled={!!grant && Date.parse(grant.expiresAt) > now}
					/>Confirm new device on this device</label
				>
				{#if !confirmDevice}<p role="alert" class="text-sm text-amber-700 dark:text-amber-300">
						Anyone with this link gets full access without your approval. Do not forward it.
					</p>{/if}
				{#if grant && Date.parse(grant.expiresAt) > now && link}
					<div class="flex flex-col items-start gap-4 sm:flex-row">
						<div class="w-44 shrink-0"><QrCode value={link} /></div>
						<div class="min-w-0 flex-1 space-y-3">
							<p class="text-sm">
								Expires in {Math.max(0, Math.ceil((Date.parse(grant.expiresAt) - now) / 1000))} seconds. Keep this
								link private.
							</p>
							<div class="flex min-w-0 items-center gap-1">
								<input
									aria-label="Pairing link"
									class="min-w-0 flex-1 rounded-lg border bg-background p-2 text-xs"
									readonly
									value={link}
								/><CopyButton text={link} label="Copy pairing link" />
							</div>
							<Button variant="outline" onclick={() => void cancel(grant!.id)}>Cancel pairing</Button>
						</div>
					</div>
				{:else}<Button disabled={busy} onclick={() => void create()}
						>{busy ? 'Creating…' : 'Create pairing link'}</Button
					>{/if}
			</div>
			{#if pairings.some((p) => ['unused', 'claimed'].includes(p.state) && Date.parse(p.expiresAt) > now)}
				<div class="space-y-2">
					<h3 class="text-sm font-semibold">Pending pairings</h3>
					{#each pairings.filter((p) => ['unused', 'claimed'].includes(p.state) && Date.parse(p.expiresAt) > now) as pairing}<div
							class="flex items-center justify-between gap-3 text-sm"
						>
							<span
								>{pairing.label ?? 'Unused link'} · {pairing.comparisonCode ??
									`expires ${date(pairing.expiresAt)}`}</span
							>
							<div class="flex gap-1">
								{#if pairing.state === 'claimed'}<Button
										variant="outline"
										size="sm"
										onclick={() => backend.reviewPairing(pairing)}>Review</Button
									>{/if}<Button variant="ghost" size="sm" onclick={() => void cancel(pairing.id)}
									>Cancel</Button
								>
							</div>
						</div>{/each}
				</div>
			{/if}
		{/if}
	</div>
</SettingsGroup>
{#if revokeDevice}
	<Dialog.Root
		open={true}
		onOpenChange={(open) => {
			if (!open) revokeDevice = undefined;
		}}
		><Dialog.Content class="max-w-md space-y-4">
			<Dialog.Title class="text-lg font-semibold"
				>{revokeDevice.current ? 'Sign out this device?' : `Revoke ${revokeDevice.label}?`}</Dialog.Title
			>
			<p class="text-sm text-muted-foreground">
				Access ends immediately. Running agents and host jobs keep running; downloaded files cannot be
				recalled.
			</p>
			{#if devices.filter((device) => Date.parse(device.expiresAt) > now).length <= 1}<p
					class="text-sm text-destructive"
				>
					This is the last device. Recovery will require the owner CLI on the computer.
				</p>{/if}
			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={() => (revokeDevice = undefined)}>Cancel</Button><Button
					variant="destructive"
					onclick={() => void revoke()}>{revokeDevice.current ? 'Sign out' : 'Revoke device'}</Button
				>
			</div>
		</Dialog.Content></Dialog.Root
	>
{/if}
