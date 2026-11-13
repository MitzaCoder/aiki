package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.data.ClientException
import io.github.mitzacoder.kemiri.data.ProjectSetting
import io.github.mitzacoder.kemiri.data.configureProject
import io.github.mitzacoder.kemiri.features.refs.normalizeGithubRepo
import io.github.mitzacoder.kemiri.features.refs.normalizeJiraSite
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.ProjectLinkSettings
import io.github.mitzacoder.kemiri.protocol.ProjectLinks
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The form's three fields as typed. */
internal data class LinksForm(val jiraSite: String, val jiraProjects: String, val githubRepos: String)

/** What the server found or the user saved, as the form shows it ("acme.atlassian.net", "EX, CORE", "a/b, c/d"). */
internal fun linksForm(links: ProjectLinkSettings) = LinksForm(
    jiraSite = links.jiraSite?.removePrefix("https://").orEmpty(),
    jiraProjects = links.jiraProjects.joinToString(", "),
    githubRepos = links.githubRepos.joinToString(", "),
)

private fun listOf(text: String) = text.split(Regex("[\\s,]+")).map { it.trim() }.filter { it.isNotEmpty() }

/** The form as settings to save, or why it cannot be saved (web `saveLinks`). */
internal fun linksToSave(form: LinksForm): Result<ProjectLinks> {
    val site = form.jiraSite.trim()
    if (site.isNotEmpty() && normalizeJiraSite(site) == null) return Result.failure(IllegalArgumentException("The Jira site should be an address, like acme.atlassian.net."))
    val repos = listOf(form.githubRepos)
    val unknown = repos.filter { normalizeGithubRepo(it) == null }
    if (unknown.isNotEmpty()) return Result.failure(IllegalArgumentException("Write each repository as owner/name: ${unknown.joinToString(", ")}"))
    return Result.success(ProjectLinks(
        jiraSite = if (site.isEmpty()) null else normalizeJiraSite(site),
        jiraProjects = listOf(form.jiraProjects).map { it.uppercase() },
        githubRepos = repos,
    ))
}

/**
 * Project → Tickets and pull requests (web `TicketsSection.svelte`): the Jira site, ticket prefixes and GitHub repositories
 * bare keys and `#123`s link through, filled in by the server until the user saves their own. Each field saves when it is
 * left; "Fill in again" hands all three back (`links: null`). Hidden on a backend whose projects carry no `links`.
 */
@Composable
fun TicketsSection(context: ProjectScreenContext, links: ProjectLinkSettings) {
    val projectId = context.route.projectId
    val form = linksForm(links)
    val siteSave = rememberSaveState(projectId)
    val prefixSave = rememberSaveState(projectId)
    val reposSave = rememberSaveState(projectId)
    val autoSave = rememberSaveState(projectId)
    suspend fun write(next: LinksForm) {
        val value = linksToSave(next).getOrThrow()
        context.backend.client.configureProject(projectId, ProjectSetting.Links(value))
        context.backend.refreshProjects()
    }
    SettingsSectionPage("Tickets and pull requests", "Ticket keys and pull request numbers become links.", SettingsIcon.Ticket) {
        SettingsGroup(title = "Links", actions = { StatusChip(if (links.detected) "Filled in automatically" else "Set by you", if (links.detected) ChipTone.Info else ChipTone.Muted) }) {
            SettingsRow(
                "Jira site", hint = "Where ticket keys like EX-1234 open.", status = siteSave,
                learn = { Text("Keys link in the chat, in task reports and in titles. A task's tickets and pull requests also show where they stand (open, merged, in review) when this backend's machine is signed in to GitHub (gh) and Jira (acli).") },
            ) { AutoInput(form.jiraSite, siteSave, placeholder = "acme.atlassian.net", mono = true, label = "Jira site") { write(form.copy(jiraSite = it)) } }
            SettingsRow(
                "Ticket prefixes", hint = "Keys with these prefixes link everywhere.", status = prefixSave,
                learn = { Text("Other keys link only inside a task's own tickets, so words like UTF-8 stay plain.") },
            ) { AutoInput(form.jiraProjects, prefixSave, placeholder = "EX, CORE", mono = true, label = "Ticket prefixes") { write(form.copy(jiraProjects = it)) } }
            SettingsRow(
                "GitHub repositories", hint = "owner/name, separated by commas.", status = reposSave,
                learn = { Text("With one repository, #1234 links to it. With several, write the name before the number, like web#1234.") },
            ) { AutoInput(form.githubRepos, reposSave, placeholder = "owner/name", mono = true, label = "GitHub repositories") { write(form.copy(githubRepos = it)) } }
            SettingsRow(
                "Fill in automatically", hint = "From git remotes, commit messages and the machine's Jira sign-in.", control = RowControl.Auto, status = autoSave,
                onRetry = { autoSave.launch { context.backend.client.configureProject(projectId, ProjectSetting.Links(null)); context.backend.refreshProjects() } },
            ) {
                OutlinedButton(enabled = autoSave.status != SaveStatus.Saving, modifier = Modifier.heightIn(min = 44.dp), onClick = {
                    autoSave.launch { context.backend.client.configureProject(projectId, ProjectSetting.Links(null)); context.backend.refreshProjects() }
                }) { Text("Fill in again") }
            }
        }
    }
}

