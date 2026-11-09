<script lang="ts">
	import Banner from '#lib/components/Banner.svelte';
	import SaveStatus from '#lib/components/settings/SaveStatus.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';
	import { SaveState } from '#lib/save-state.svelte.js';
	import type { AuthLogin, AuthPrompt, ProviderInfo } from '@mihai-harness/protocol';

	/**
	 * What one provider's account needs: sign in with its subscription (the whole OAuth exchange, as the backend runs
	 * it), paste or replace an API key, sign out or remove the key. Every action has its own save state beside it. The
	 * secret goes to the backend and is never shown again.
	 */
	let { backend, provider }: { backend: BackendConnection; provider: ProviderInfo } = $props();

	const canLogins = $derived(backend.supports('logins'));
	const canCredentials = $derived(backend.supports('credentials'));
	const stored = $derived(backend.credentials.find((credential) => credential.providerId === provider.id));
	const login = $derived(backend.loginFor(provider.id));
	const ended = $derived(login === undefined ? backend.finishedLoginFor(provider.id) : undefined);

	let keyDraft = $state('');
	let answerDraft = $state<Record<string, string>>({});
	let loginBusy = $state(false);
	let loginError = $state<string | undefined>(undefined);
	const keySave = new SaveState();
	const signOutSave = new SaveState();

	const keyId = $props.id();

	function errorText(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function loginStatusText(entry: AuthLogin): string {
		switch (entry.status) {
			case 'prompt':
				return entry.prompt?.type === 'select' ? 'Choose how to sign in' : 'Waiting for your answer';
			case 'working':
				return 'Waiting for the provider…';
			case 'succeeded':
				return 'Signed in';
			case 'failed':
				return 'Sign-in failed';
			case 'cancelled':
				return 'Sign-in cancelled';
		}
	}

	async function signIn(): Promise<void> {
		loginError = undefined;
		try {
			await backend.startLogin(provider.id);
		} catch (error) {
			loginError = errorText(error);
		}
	}

	async function removeCredential(save: SaveState): Promise<void> {
		await save.run(() => backend.removeCredential(provider.id));
	}

	async function answerPrompt(entry: AuthLogin, prompt: AuthPrompt, value: string): Promise<void> {
		const answer = value.trim();
		loginError = undefined;
		if (answer.length === 0) {
			loginError = 'Enter or paste an answer first.';
			return;
		}
		loginBusy = true;
		try {
			await backend.answerLogin(entry.id, prompt.id, answer);
			answerDraft[prompt.id] = '';
		} catch (error) {
			loginError = errorText(error);
		} finally {
			loginBusy = false;
		}
	}

	async function cancelLogin(entry: AuthLogin): Promise<void> {
		loginBusy = true;
		try {
			await backend.cancelLogin(entry.id);
		} catch (error) {
			loginError = errorText(error);
		} finally {
			loginBusy = false;
		}
	}

	async function saveKey(): Promise<void> {
		const value = keyDraft.trim();
		if (value.length === 0) {
			keySave.fail('Enter an API key before saving.');
			return;
		}
		if (await keySave.run(() => backend.saveCredential(provider.id, value))) keyDraft = '';
	}
</script>

<div class="flex flex-col gap-4 rounded-xl bg-(--chat-surface-2)/40 p-3.5 ring-1 ring-foreground/8 sm:p-4" data-provider-panel={provider.id}>
	{#if provider.oauth && canLogins}
		<div class="flex flex-wrap items-center gap-2">
			<Button variant="outline" class="max-sm:h-11" disabled={login !== undefined || signOutSave.status === 'saving'} onclick={() => void signIn()}>
				{stored?.type === 'oauth' ? 'Sign in again' : provider.oauth.loginLabel}
			</Button>
			{#if stored?.type === 'oauth' && canCredentials}
				<Button
					variant="destructive"
					class="max-sm:h-11"
					disabled={signOutSave.status === 'saving'}
					onclick={() => void removeCredential(signOutSave)}
				>
					Sign out
				</Button>
				<SaveStatus state={signOutSave} reserve={false} />
			{/if}
		</div>
	{/if}

	{#if login !== undefined}
		{@const prompt = login.prompt}
		<div class="flex flex-col gap-2.5 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
			<div class="flex items-center gap-2">
				<strong class="flex-1 text-sm">{loginStatusText(login)}</strong>
				<Button variant="destructive" size="sm" class="max-sm:h-11" disabled={loginBusy} onclick={() => void cancelLogin(login)}>
					Cancel
				</Button>
			</div>

			{#each login.events as event}
				{#if event.type === 'auth_url'}
					<p class="text-sm">
						<a class="underline" href={event.url} target="_blank" rel="noreferrer">
							{provider.oauth?.loginLabel ?? 'Open the sign-in page'}
						</a>
						{#if event.instructions}
							<span class="text-muted-foreground"> — {event.instructions}</span>
						{/if}
					</p>
				{:else if event.type === 'device_code'}
					<p class="text-sm">
						Code <code class="rounded bg-muted px-1 py-0.5 font-mono">{event.userCode}</code> at
						<a class="underline" href={event.verificationUri} target="_blank" rel="noreferrer">{event.verificationUri}</a>
					</p>
				{:else if event.type === 'info'}
					<p class="flex flex-wrap items-center gap-2 text-sm">
						{event.message}
						{#each event.links ?? [] as link}
							<a class="underline" href={link.url} target="_blank" rel="noreferrer">{link.label ?? link.url}</a>
						{/each}
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">{event.message}</p>
				{/if}
			{/each}

			{#if prompt !== undefined}
				<p class="text-sm">{prompt.message}</p>
				{#if prompt.type === 'select'}
					<div class="flex flex-wrap gap-2">
						{#each prompt.options ?? [] as option (option.id)}
							<Button
								variant="outline"
								class="max-sm:h-11"
								disabled={loginBusy}
								title={option.description ?? ''}
								onclick={() => void answerPrompt(login, prompt, option.id)}
							>
								{option.label}
							</Button>
						{/each}
					</div>
				{:else}
					<form
						class="flex flex-wrap items-center gap-2"
						onsubmit={(event) => {
							event.preventDefault();
							void answerPrompt(login, prompt, answerDraft[prompt.id] ?? '');
						}}
					>
						<Input
							class="min-w-0 flex-1 max-sm:h-11"
							type={prompt.type === 'secret' ? 'password' : 'text'}
							autocomplete="off"
							spellcheck="false"
							aria-label={prompt.message}
							placeholder={prompt.placeholder ?? 'Paste the code or redirect URL'}
							bind:value={answerDraft[prompt.id]}
						/>
						<Button type="submit" class="max-sm:h-11" disabled={loginBusy}>Answer</Button>
					</form>
				{/if}
			{:else if login.status === 'working'}
				<p class="text-sm text-muted-foreground">Waiting for the provider…</p>
			{/if}

			{#if login.error}<Banner tone="error">{login.error}</Banner>{/if}
		</div>
	{:else if ended !== undefined}
		<div class="flex flex-col gap-2.5 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
			<div class="flex items-center gap-2">
				<strong class="flex-1 text-sm">{loginStatusText(ended)}</strong>
				<Button variant="outline" size="sm" class="max-sm:h-11" onclick={() => backend.dismissLogin(ended.id)}>Dismiss</Button>
			</div>
			{#if ended.error}<Banner tone="error">{ended.error}</Banner>{/if}
		</div>
	{/if}

	{#if loginError}<Banner tone="error">{loginError}</Banner>{/if}

	{#if canCredentials}
		<form
			class="flex flex-col gap-1.5"
			onsubmit={(event) => {
				event.preventDefault();
				void saveKey();
			}}
		>
			<label for={keyId} class="text-sm font-medium">API key</label>
			<div class="flex flex-wrap items-center gap-2">
				<Input
					id={keyId}
					class="min-w-0 flex-1 max-sm:h-11"
					type="password"
					autocomplete="off"
					spellcheck="false"
					placeholder={stored?.type === 'api_key' ? 'Replace the stored key' : 'Paste an API key'}
					bind:value={keyDraft}
					oninput={() => keySave.reset()}
				/>
				<Button
					variant="outline"
					type="submit"
					class="max-sm:h-11"
					disabled={keySave.status === 'saving' || keyDraft.trim().length === 0}
				>
					Save key
				</Button>
				{#if stored?.type === 'api_key'}
					<Button
						variant="destructive"
						class="max-sm:h-11"
						disabled={keySave.status === 'saving'}
						onclick={() => void removeCredential(keySave)}
					>
						Remove
					</Button>
				{/if}
			</div>
			<SaveStatus state={keySave} reserve={false} />
		</form>
	{/if}
</div>
