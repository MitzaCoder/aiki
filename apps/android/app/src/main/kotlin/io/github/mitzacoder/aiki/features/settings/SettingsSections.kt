package io.github.mitzacoder.aiki.features.settings

import kotlinx.serialization.Serializable

/**
 * Settings, split in two as on the web (`lib/settings.ts`, `docs/DESIGN.md` "Settings"): General settings (this device and
 * its backends) and Project settings (one project). Both are a list of sections; the section ids are the web's URL
 * segments, so a web link maps to the same screen. Pure, so the lists, the parents and the availability rules are tested.
 */
enum class SettingsIcon { Palette, Server, Bell, Archive, Folder, Cpu, Users, CalendarClock, Ticket, DatabaseZap, HardDrive, KeyRound, Settings }

/** One entry of a section list: [id] is the last URL segment, [hint] the line under the label on a phone. */
interface SettingsSectionInfo {
    val id: String
    val label: String
    val hint: String
    val icon: SettingsIcon
}

@Serializable
enum class GeneralSection(override val id: String, override val label: String, override val hint: String, override val icon: SettingsIcon) : SettingsSectionInfo {
    Appearance("appearance", "Appearance", "Theme and colours", SettingsIcon.Palette),
    Backends("backends", "Backends", "Servers, accounts and API keys", SettingsIcon.Server),
    Notifications("notifications", "Notifications", "Push, quiet hours, muted projects", SettingsIcon.Bell),
    Archived("archived", "Archived projects", "Bring a project back", SettingsIcon.Archive),
}

@Serializable
enum class ProjectSection(override val id: String, override val label: String, override val hint: String, override val icon: SettingsIcon) : SettingsSectionInfo {
    General("general", "General", "Name, folder, archive", SettingsIcon.Folder),
    Coordinator("coordinator", "Coordinator", "The model and how hard it thinks", SettingsIcon.Cpu),
    Workers("workers", "Workers", "Worker models and check-ins", SettingsIcon.Users),
    Schedules("schedules", "Scheduled tasks", "Clocks and event triggers", SettingsIcon.CalendarClock),
    Tickets("tickets", "Tickets and pull requests", "Jira site, prefixes, repositories", SettingsIcon.Ticket),
    Cache("cache", "Prompt cache", "How long Claude keeps a conversation", SettingsIcon.DatabaseZap),
    Storage("storage", "Storage", "Finished workspaces and disk use", SettingsIcon.HardDrive),
}

fun generalSectionFor(id: String?): GeneralSection? = GeneralSection.entries.firstOrNull { it.id == id }
fun projectSectionFor(id: String?): ProjectSection? = ProjectSection.entries.firstOrNull { it.id == id }

/** What a backend offers a project's settings: the features it advertises and what its project summary carries. */
data class ProjectSectionSupport(val supports: (String) -> Boolean, val links: Boolean, val longPromptCache: Boolean)

/** Whether a section is shown for a project (web `projectSectionAvailable`); the list drops the rest. */
fun projectSectionAvailable(section: ProjectSection, has: ProjectSectionSupport): Boolean = when (section) {
    ProjectSection.General -> true
    ProjectSection.Coordinator -> has.supports("projects") && has.supports("models")
    ProjectSection.Workers -> has.supports("projects") && has.supports("models") && has.supports("workers")
    ProjectSection.Schedules -> has.supports("schedules")
    ProjectSection.Tickets -> has.links
    ProjectSection.Cache -> has.longPromptCache
    ProjectSection.Storage -> has.supports("storage")
}

/** The tone of a status chip (web `StatusChip`). */
enum class ChipTone { Ok, Warn, Err, Info, Muted }

data class SectionChip(val label: String, val tone: ChipTone)

/** The chips of the General list: "2 offline" on Backends, On/Off on Notifications, the count of archived projects. */
fun generalChips(offline: Int, notificationsOn: Boolean, archived: Int): Map<GeneralSection, SectionChip> = buildMap {
    if (offline > 0) put(GeneralSection.Backends, SectionChip("$offline offline", ChipTone.Warn))
    put(GeneralSection.Notifications, if (notificationsOn) SectionChip("On", ChipTone.Ok) else SectionChip("Off", ChipTone.Muted))
    if (archived > 0) put(GeneralSection.Archived, SectionChip(archived.toString(), ChipTone.Muted))
}

/** The chips of the project list: a coordinator without a model is the one state worth seeing before opening. */
fun projectChips(coordinatorModelSet: Boolean): Map<ProjectSection, SectionChip> =
    if (coordinatorModelSet) emptyMap() else mapOf(ProjectSection.Coordinator to SectionChip("No model", ChipTone.Warn))

/** Where a General settings screen sits: a section (null is the list), a backend's own page, or its Accounts page. */
@Serializable
data class GeneralPage(val section: GeneralSection? = null, val backendKey: String? = null, val accounts: Boolean = false)

/**
 * The screen one step up, for the back button: Accounts to its backend, a backend to the Backends list, a section to the
 * list of sections. Null on the list itself (web `settingsParentHref`).
 */
fun generalParent(page: GeneralPage): GeneralPage? = when {
    page.section == null -> null
    page.backendKey != null && page.accounts -> GeneralPage(GeneralSection.Backends, page.backendKey)
    page.backendKey != null -> GeneralPage(GeneralSection.Backends)
    else -> GeneralPage()
}

/** The section a project settings screen opens on a wide screen, where the list and a section share the screen: the first one offered. */
fun <T : SettingsSectionInfo> wideSection(section: T?, offered: List<T>): T? = section?.takeIf { it in offered } ?: offered.firstOrNull()
