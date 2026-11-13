/**
 * Settings, split in two: General settings (this browser and its backends) and Project settings (one project). Both
 * are a list of sections, and every section has its own URL, so a link, a banner or a notification can open the right
 * one and Android can map the same names one to one. Pure helpers, no runes: the routes, the sidebar and the tests
 * share them. docs/DESIGN.md "Settings" says what each section holds.
 */
import { projectHref } from "./backends.ts";

/** The name of a lucide icon a section uses; the shell maps it to the component. */
export type SettingsIconName =
	| "palette"
	| "server"
	| "bell"
	| "archive"
	| "folder"
	| "cpu"
	| "users"
	| "calendar-clock"
	| "ticket"
	| "database-zap"
	| "hard-drive"
	| "key-round"
	| "settings";

export type SettingsSectionInfo<Id extends string = string> = {
	/** The last URL segment, and the name Android uses for the same screen. */
	id: Id;
	label: string;
	/** One line, shown under the label in the phone's list. */
	hint: string;
	icon: SettingsIconName;
};

export const GENERAL_SECTIONS = [
	{ id: "appearance", label: "Appearance", hint: "Theme and colours", icon: "palette" },
	{ id: "backends", label: "Backends", hint: "Servers, accounts and API keys", icon: "server" },
	{ id: "notifications", label: "Notifications", hint: "Push, quiet hours, muted projects", icon: "bell" },
	{ id: "about", label: "About", hint: "Kemiri versions and updates", icon: "settings" },
	{ id: "archived", label: "Archived projects", hint: "Bring a project back", icon: "archive" },
] as const satisfies readonly SettingsSectionInfo[];

export type GeneralSectionId = (typeof GENERAL_SECTIONS)[number]["id"];

export const PROJECT_SECTIONS = [
	{ id: "general", label: "General", hint: "Name, folder, archive", icon: "folder" },
	{ id: "coordinator", label: "Coordinator", hint: "The model and how hard it thinks", icon: "cpu" },
	{ id: "workers", label: "Workers", hint: "Worker models and check-ins", icon: "users" },
	{ id: "schedules", label: "Scheduled tasks", hint: "Clocks and event triggers", icon: "calendar-clock" },
	{ id: "tickets", label: "Tickets and pull requests", hint: "Jira site, prefixes, repositories", icon: "ticket" },
	{ id: "cache", label: "Prompt cache", hint: "How long Claude keeps a conversation", icon: "database-zap" },
	{ id: "mcp", label: "MCP", hint: "Remote servers and agent roles", icon: "server" },
	{ id: "storage", label: "Storage", hint: "Finished workspaces and disk use", icon: "hard-drive" },
] as const satisfies readonly SettingsSectionInfo[];

export type ProjectSectionId = (typeof PROJECT_SECTIONS)[number]["id"];

export function isGeneralSection(value: unknown): value is GeneralSectionId {
	return GENERAL_SECTIONS.some((section) => section.id === value);
}

export function isProjectSection(value: unknown): value is ProjectSectionId {
	return PROJECT_SECTIONS.some((section) => section.id === value);
}

/** General settings: the list (phone) or the first section (wide). */
export const GENERAL_SETTINGS_HREF = "/settings";

export function generalSettingsHref(section?: GeneralSectionId): string {
	return section === undefined ? GENERAL_SETTINGS_HREF : `${GENERAL_SETTINGS_HREF}/${section}`;
}

/** One backend's own page, or one of its subpages. */
export function backendSettingsHref(backendId: string, sub?: "accounts" | "mcp"): string {
	const base = `${GENERAL_SETTINGS_HREF}/backends/${encodeURIComponent(backendId)}`;
	return sub === undefined ? base : `${base}/${sub}`;
}

/** A project's settings: the list (phone) or the first section (wide), or one section. */
export function projectSettingsHref(backendId: string, projectId: string, section?: ProjectSectionId): string {
	const base = `${projectHref(backendId, projectId)}/settings`;
	return section === undefined ? base : `${base}/${section}`;
}

export type SettingsLocation =
	| { scope: "general"; section: GeneralSectionId | undefined; parts: string[] }
	| { scope: "project"; backendId: string; projectId: string; section: ProjectSectionId | undefined; parts: string[] };

function decode(part: string): string | undefined {
	try {
		return decodeURIComponent(part);
	} catch {
		return undefined;
	}
}

/**
 * Where a path sits in settings: the scope, the section it opens (undefined on the list) and the segments after the
 * section (a backend's ID and subpage). Anything that is not a settings path gives undefined.
 */
export function settingsLocation(pathname: string): SettingsLocation | undefined {
	const parts = pathname.split("/").filter((part) => part.length > 0);
	if (parts[0] === "settings") {
		const section = parts[1];
		if (section === undefined) return { scope: "general", section: undefined, parts: [] };
		return { scope: "general", section: isGeneralSection(section) ? section : undefined, parts: parts.slice(2) };
	}
	if (parts[0] === "b" && parts[2] === "projects" && parts[4] === "settings") {
		const backendId = decode(parts[1] ?? "");
		const projectId = decode(parts[3] ?? "");
		if (backendId === undefined || projectId === undefined) return undefined;
		const section = parts[5];
		return {
			scope: "project",
			backendId,
			projectId,
			section: isProjectSection(section) ? section : undefined,
			parts: parts.slice(6),
		};
	}
	return undefined;
}

/**
 * The screen one step up from a path, for a phone's back button: a backend's subpage goes to the backend, the backend
 * to the Backends list, a section to the list of sections. Undefined on the list itself.
 */
export function settingsParentHref(pathname: string): string | undefined {
	const location = settingsLocation(pathname);
	if (location === undefined || location.section === undefined) return undefined;
	if (location.scope === "general") {
		if (location.section === "backends" && location.parts.length > 1) {
			return backendSettingsHref(decode(location.parts[0] ?? "") ?? "");
		}
		if (location.section === "backends" && location.parts.length === 1) return generalSettingsHref("backends");
		return GENERAL_SETTINGS_HREF;
	}
	return projectSettingsHref(location.backendId, location.projectId);
}

/** Whether a section is shown for a backend, by the features it advertises; the list drops the rest. */
export function projectSectionAvailable(
	section: ProjectSectionId,
	has: { supports: (feature: string) => boolean; links: boolean; longPromptCache: boolean },
): boolean {
	switch (section) {
		case "general":
			return true;
		case "coordinator":
			return has.supports("projects") && has.supports("models");
		case "workers":
			return has.supports("projects") && has.supports("models") && has.supports("workers");
		case "schedules":
			return has.supports("schedules");
		case "tickets":
			return has.links;
		case "cache":
			return has.longPromptCache;
		case "mcp":
			return has.supports("mcp-servers");
		case "storage":
			return has.supports("storage");
	}
}
