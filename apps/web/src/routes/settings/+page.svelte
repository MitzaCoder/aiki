<script lang="ts">
	import RedirectWhenWide from '#lib/components/settings/RedirectWhenWide.svelte';
	import { generalSettingsHref } from '#lib/settings.js';
</script>

<!-- On a phone this is the list of sections (the layout draws it); a wide screen goes on to the first. -->
<RedirectWhenWide href={generalSettingsHref('appearance')} />
