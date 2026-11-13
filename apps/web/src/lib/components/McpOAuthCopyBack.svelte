<script lang="ts">
 import { Button } from '#lib/components/ui/button/index.js';
 let { redirectUrl }: { redirectUrl: string } = $props();
 let copied = $state(false);
 let error = $state('');
 async function copy() {
  try { await navigator.clipboard.writeText(redirectUrl); copied = true; error = ''; }
  catch { error = 'Select and copy the URL below.'; }
 }
</script>
<h1 class="mb-3 text-2xl font-semibold">Sign-in almost done</h1>
<p class="mb-4">Copy this link and paste it in Kemiri where you started.</p>
<label class="mb-2 block text-sm font-medium" for="callback-url">One-use callback URL</label>
<textarea id="callback-url" readonly value={redirectUrl} rows="5" class="mb-3 w-full resize-none rounded-md border bg-background p-3 text-sm" aria-describedby="callback-warning"></textarea>
<p id="callback-warning" class="mb-4 text-sm text-muted-foreground">This URL contains a short-lived sign-in code. Do not share it.</p>
<Button onclick={copy}>{copied ? 'Copied' : 'Copy URL'}</Button>
{#if error}<p class="mt-3 text-sm" role="alert">{error}</p>{/if}
