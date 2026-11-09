<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { connectionBadgeClass, connectionView } from '#lib/connection.js';
	import type { BackendConnection } from '#lib/harness.svelte.js';

	let { backend }: { backend: BackendConnection } = $props();

	const badge = $derived(connectionView(backend.connection));
</script>

<Badge variant="outline" class={connectionBadgeClass(badge.tone)} title={badge.title}>
	{badge.label}
</Badge>
