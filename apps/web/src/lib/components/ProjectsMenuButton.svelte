<script lang="ts">
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import { Button } from '#lib/components/ui/button/index.js';
	import { projectsNav } from '#lib/projects-nav.svelte.js';

	/**
	 * Opens the projects drawer, and only where the sidebar is a drawer: below 64rem
	 * (`lg`), the width at which `ProjectsSidebar` becomes a persistent panel. A page
	 * header puts it where the back button used to be.
	 */
</script>

<Button
	variant="ghost"
	size="icon-sm"
	class="lg:hidden"
	onclick={() => projectsNav.toggleDrawer()}
	aria-label="Projects"
	title="Projects"
	aria-expanded={projectsNav.drawerOpen}
>
	<PanelLeftIcon />
</Button>
