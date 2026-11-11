package io.github.mitzacoder.aiki.features.settings

import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.BackendSession
import io.github.mitzacoder.aiki.protocol.ProjectsConfigureRequest
import io.github.mitzacoder.aiki.protocol.ProjectSummary

fun integrationBranchMode(ref: String?): String = when (ref) {
    null -> "off"
    "auto" -> "auto"
    else -> "custom"
}

fun integrationBranchRef(text: String): String {
    val ref = text.trim()
    require(ref.isNotEmpty()) { "Enter a branch name or full ref." }
    return if (ref.startsWith("refs/")) ref else "refs/heads/$ref"
}

data class DeliverySettingPatch(val request: ProjectsConfigureRequest, val explicitNulls: Set<String>)

fun deliverySettingPatch(projectId: String, field: String, value: String?): DeliverySettingPatch = when (field) {
    "integrationRef" -> DeliverySettingPatch(ProjectsConfigureRequest(projectId = projectId, integrationRef = value), if (value == null) setOf(field) else emptySet())
    "deployFeed" -> DeliverySettingPatch(ProjectsConfigureRequest(projectId = projectId, deployFeed = value), if (value == null) setOf(field) else emptySet())
    else -> error("Unknown delivery setting")
}

@Composable
internal fun DeliverySection(backend: BackendSession, project: ProjectSummary) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val integrationSave = rememberSaveState(project.id, "integration")
    val feedSave = rememberSaveState(project.id, "deploy-feed")
    var branchMode by remember(project.id, project.integrationRef) { mutableStateOf(integrationBranchMode(project.integrationRef)) }
    var feedMode by remember(project.id, project.deployFeed) { mutableStateOf(if (project.deployFeed == null) "off" else "file") }
    suspend fun persist(field: String, value: String?) {
        val patch = deliverySettingPatch(project.id, field, value)
        backend.configure(patch.request, patch.explicitNulls)
    }
    SettingsSectionPage("Delivery", "Where commits land and how deploy results reach tasks.", SettingsIcon.Server) {
        SettingsGroup(title = "Delivery") {
            if (connection.supports("task-changes")) {
                SettingsRow("Integration branch", hint = "Commits with an Aiki-Task: T12 line that land here are shown on their tasks.", status = integrationSave) {
                    Combobox(listOf(ComboOption("auto", "Automatic (main or master)"), ComboOption("custom", "Custom ref"), ComboOption("off", "Off")), branchMode, { mode ->
                        branchMode = mode
                        integrationSave.reset()
                        if (mode != "custom") integrationSave.launch { persist("integrationRef", if (mode == "auto") "auto" else null) }
                    }, "Integration branch mode", enabled = integrationSave.status != SaveStatus.Saving, invalid = integrationSave.status == SaveStatus.Failed)
                }
                if (branchMode == "custom") SettingsRow("Custom ref", status = integrationSave) {
                    AutoInput(project.integrationRef?.takeUnless { it == "auto" }.orEmpty(), integrationSave, placeholder = "refs/heads/trunk", mono = true, label = "Custom integration ref", enabled = integrationSave.status != SaveStatus.Saving) {
                        persist("integrationRef", integrationBranchRef(it))
                    }
                }
            }
            if (connection.supports("task-deploys")) {
                SettingsRow("Deploy status feed", hint = "A JSON journal your deploy scripts write; deploy results then appear on every task they shipped. The harness only reads it.", status = feedSave) {
                    Combobox(listOf(ComboOption("off", "Off"), ComboOption("file", "File path")), feedMode, { mode ->
                        feedMode = mode
                        feedSave.reset()
                        if (mode == "off") feedSave.launch { persist("deployFeed", null) }
                    }, "Deploy status feed mode", enabled = feedSave.status != SaveStatus.Saving, invalid = feedSave.status == SaveStatus.Failed)
                }
                if (feedMode == "file") SettingsRow("File path", status = feedSave) {
                    AutoInput(project.deployFeed.orEmpty(), feedSave, placeholder = "/tmp/demo/deploy-journal.json", mono = true, label = "Deploy feed file path", enabled = feedSave.status != SaveStatus.Saving) {
                        require(it.isNotBlank()) { "Enter an absolute file path." }
                        persist("deployFeed", it)
                    }
                }
            }
        }
    }
}
