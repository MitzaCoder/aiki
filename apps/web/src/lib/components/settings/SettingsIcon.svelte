<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import DatabaseZapIcon from '@lucide/svelte/icons/database-zap';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import ServerIcon from '@lucide/svelte/icons/server';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import UsersIcon from '@lucide/svelte/icons/users';
	import type { SettingsIconName } from '#lib/settings.js';

	/** The icon a section is known by, in the nav, the section header and the sidebar. */
	let { name, class: className = 'size-4' }: { name: SettingsIconName; class?: string } = $props();

	const ICONS = {
		palette: PaletteIcon,
		server: ServerIcon,
		bell: BellIcon,
		archive: ArchiveIcon,
		folder: FolderIcon,
		cpu: CpuIcon,
		users: UsersIcon,
		'calendar-clock': CalendarClockIcon,
		ticket: TicketIcon,
		'database-zap': DatabaseZapIcon,
		'hard-drive': HardDriveIcon,
		'key-round': KeyRoundIcon,
		settings: SettingsIcon
	};
	const Icon = $derived(ICONS[name]);
</script>

<Icon class={className} aria-hidden="true" />
