/**
 * The projects sidebar's live state: whether the desktop sidebar is a wide panel or the
 * narrow icon rail, whether the drawer is open on a narrow screen, and the stamps unread
 * marks come from. Runes, so the layout, the sidebar and every page header share one state.
 *
 * Everything that can be decided without state lives in `projects.ts`.
 */
import type { ProjectActivity } from "@mihai-harness/protocol";
import {
	loadProjectSeens,
	loadProjectsNavState,
	projectSeenStamp,
	saveProjectSeens,
	saveProjectsNavState,
	seenIsNewer,
	type ProjectSeen,
	type ProjectSeens,
} from "./projects.ts";

class ProjectsNavigation {
	/** The desktop sidebar's shape: a wide panel, or the icon rail. Remembered per browser. */
	collapsed = $state(false);
	/** The narrow screen's drawer, opened from a page header. Never restored: a drawer covers the page. */
	drawerOpen = $state(false);
	/** The reply each project had reached when this browser last showed it, keyed by `projectSeenKey`. */
	seens = $state<ProjectSeens>({});

	#loaded = false;

	/** Read what this browser remembers. Safe to call from every screen's onMount. */
	load(): void {
		if (this.#loaded) return;
		this.#loaded = true;
		this.collapsed = loadProjectsNavState().collapsed;
		this.seens = loadProjectSeens();
	}

	toggleCollapsed(): void {
		this.setCollapsed(!this.collapsed);
	}

	setCollapsed(collapsed: boolean): void {
		this.collapsed = collapsed;
		saveProjectsNavState({ collapsed });
	}

	openDrawer(): void {
		this.drawerOpen = true;
	}

	closeDrawer(): void {
		this.drawerOpen = false;
	}

	toggleDrawer(): void {
		this.drawerOpen = !this.drawerOpen;
	}

	setDrawer(open: boolean): void {
		this.drawerOpen = open;
	}

	/** The reply this browser last showed for a project, if it has shown it. */
	seen(key: string): ProjectSeen | undefined {
		return this.seens[key];
	}

	/**
	 * Remember that this browser is showing a project's latest reply. Called while the
	 * project's screen is open, so a reply pushed live is read as it arrives, and a mark
	 * never moves back when an older state arrives late.
	 */
	markSeen(key: string, activity: ProjectActivity | undefined): void {
		const stamp = projectSeenStamp(activity);
		if (stamp === undefined || !seenIsNewer(stamp, this.seens[key])) return;
		this.seens = { ...this.seens, [key]: stamp };
		saveProjectSeens(this.seens);
	}
}

export const projectsNav = new ProjectsNavigation();
