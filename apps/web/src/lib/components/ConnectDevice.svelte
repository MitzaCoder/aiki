<script lang="ts">
	import { page } from '$app/state';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import QrCode from '#lib/components/QrCode.svelte';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { connectHref, isConnectUrl, MAX_CONNECT_BACKENDS, shareableName } from '#lib/connect.js';
	import { harness } from '#lib/harness.svelte.js';

	/**
	 * The link that sets up another device: the chosen backends ride in the fragment, so no server sees them, and the
	 * other device shows them for confirmation instead of asking the user to type addresses on a phone keyboard.
	 *
	 * Only HTTPS backends can travel: a link leaves this browser, so a development backend on loopback stays here.
	 */
	let excluded = $state<string[]>([]);

	const chosen = $derived(
		harness.backends.filter((backend) => !excluded.includes(backend.id) && isConnectUrl(backend.url)),
	);
	const unshareable = $derived(harness.backends.filter((backend) => !isConnectUrl(backend.url)));
	/** What to show under the choices: a link, a nudge, or a cap the selection has run into. */
	const share = $derived.by((): { kind: 'empty' } | { kind: 'too-many' } | { kind: 'link'; href: string } => {
		if (chosen.length === 0) return { kind: 'empty' };
		if (chosen.length > MAX_CONNECT_BACKENDS) return { kind: 'too-many' };
		return {
			kind: 'link',
			href: connectHref(
				page.url.origin,
				chosen.map((backend) => ({ name: shareableName(backend.name), url: backend.url })),
			),
		};
	});

	function toggle(id: string, checked: boolean): void {
		excluded = checked
			? excluded.filter((entry) => entry !== id)
			: [...excluded.filter((entry) => entry !== id), id];
	}
</script>

<div class="flex flex-col gap-3" data-testid="connect-device">
	<p class="text-sm text-muted-foreground">
		Choose the backends to pass on. The link keeps them in its fragment, so it never reaches a server log; opening it
		on the other device shows them, and one tap adds them there.
	</p>

	<div class="flex flex-col gap-2">
		{#each harness.backends as backend (backend.id)}
			{#if isConnectUrl(backend.url)}
				<label class="flex items-start gap-2 text-sm">
					<Checkbox
						checked={!excluded.includes(backend.id)}
						onCheckedChange={(value) => toggle(backend.id, value === true)}
						aria-label="Include {backend.name}"
					/>
					<span class="flex min-w-0 flex-col">
						<span class="font-medium">{backend.name}</span>
						<span class="font-mono text-xs break-words text-muted-foreground">{backend.url}</span>
					</span>
				</label>
			{/if}
		{/each}
	</div>

	{#if unshareable.length > 0}
		<p class="text-xs text-muted-foreground">
			{#if unshareable.length === 1}
				{unshareable[0]?.name ?? 'One backend'} stays in this browser: a connect link carries only HTTPS origins.
			{:else}
				{unshareable.length} backends stay in this browser: a connect link carries only HTTPS origins.
			{/if}
		</p>
	{/if}

	{#if share.kind === 'empty'}
		{#if unshareable.length < harness.backends.length}
			<p class="text-sm text-muted-foreground">Choose at least one backend.</p>
		{/if}
	{:else if share.kind === 'too-many'}
		<p class="text-sm text-muted-foreground">
			A link carries at most {MAX_CONNECT_BACKENDS} backends. Leave some out and make a second link.
		</p>
	{:else}
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
			<div class="w-40 max-w-full shrink-0 self-center rounded-md bg-white p-1.5">
				<QrCode value={share.href} />
			</div>
			<div class="flex min-w-0 flex-1 flex-col gap-2">
				<span class="text-xs font-medium text-muted-foreground">Connect link</span>
				<div class="flex items-start gap-2">
					<code
						data-testid="connect-link"
						class="min-w-0 flex-1 rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs break-all"
						>{share.href}</code
					>
					<CopyButton text={() => share.href} label="Copy connect link" />
				</div>
				<p class="text-xs text-muted-foreground">
					Scan the code or send the link to the other device, then confirm there.
				</p>
			</div>
		</div>
	{/if}
</div>
