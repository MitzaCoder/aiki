package io.github.mitzacoder.aiki.navigation

import io.github.mitzacoder.aiki.protocol.ProjectSummary
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Same grouping/order as web sidebar-attention.ts. Older backends use activity only. */
enum class AttentionKind { Question, Warning, Coordinator, Worker, Thread, Review }
data class AttentionAction(val kind: AttentionKind, val count: Long, val label: String, val taskId: String? = null, val threadId: String? = null)
data class BackendAttentionProjects(val key: String, val name: String, val projects: List<ProjectSummary>)
data class ProjectAttentionLink(val backendKey: String, val backendName: String, val projectId: String, val projectName: String, val action: AttentionAction)

fun projectAttentionActions(project: ProjectSummary): List<AttentionAction> = buildList {
    if (project.archived == true) return@buildList
    val summary = project.attention
    val questions = summary?.questions ?: project.activity?.openQuestions ?: 0
    if (questions > 0) add(AttentionAction(AttentionKind.Question, questions, "$questions question${if (questions == 1L) "" else "s"}", summary?.questionTaskId))
    val warnings = summary?.warnings ?: 0
    if (warnings > 0) add(AttentionAction(AttentionKind.Warning, warnings, "$warnings warning${if (warnings == 1L) "" else "s"}", summary?.warningTaskId))
    if (project.state == "failed" || project.activity?.coordinator == "failed") add(AttentionAction(AttentionKind.Coordinator, 1, if (project.state == "failed") "Project failed" else "Coordinator failed"))
    val workers = summary?.failedWorkers ?: 0
    if (workers > 0) add(AttentionAction(AttentionKind.Worker, workers, if (workers == 1L) "Worker failed" else "$workers workers failed", summary?.failedWorkerTaskId))
    val threads = summary?.failedThreads ?: 0
    if (threads > 0) add(AttentionAction(AttentionKind.Thread, threads, if (threads == 1L) "Thread failed" else "$threads threads failed", threadId = summary?.failedThreadId))
    val reviews = summary?.reviewTasks ?: 0
    if (reviews > 0) add(AttentionAction(AttentionKind.Review, reviews, "$reviews to review", summary?.reviewTaskId))
}

fun attentionCount(project: ProjectSummary): Long = projectAttentionActions(project).sumOf { it.count }
fun needsYouLinks(backends: List<BackendAttentionProjects>): List<ProjectAttentionLink> = backends.flatMap { backend ->
    backend.projects.flatMap { project -> projectAttentionActions(project).map { action -> ProjectAttentionLink(backend.key, backend.name, project.id, project.name, action) } }
}.sortedBy { it.action.kind.ordinal }

data class SidebarStatus(val label: String, val glyph: String, val urgent: Boolean = false, val working: Boolean = false)
fun sidebarStatus(project: ProjectSummary, row: ProjectStatus): SidebarStatus {
    val action = projectAttentionActions(project).firstOrNull()
    val running = project.attention?.runningWorkers ?: project.activity?.runningWorkers ?: 0
    val working = project.activity?.coordinator == "working" || running > 0
    if (action != null) return SidebarStatus(action.label, when (action.kind) { AttentionKind.Question -> "?"; AttentionKind.Review -> "✓"; else -> "!" }, action.kind != AttentionKind.Review, working)
    if (working) return SidebarStatus(if (running > 0) "Working · $running worker${if (running == 1L) "" else "s"}" else "Working", "◌", working = true)
    val returning = project.attention?.nextReturnAt?.let { try { Instant.parse(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())) } catch (_: java.time.DateTimeException) { null } }
    if (returning != null) return SidebarStatus("Returns $returning", "◷")
    val waiting = project.attention?.waitingTasks ?: 0
    if (waiting > 0) return SidebarStatus("$waiting waiting", "◷")
    return SidebarStatus(listOfNotNull(row.label, row.detail).joinToString(" · "), "·", row.tone == ProjectStatusTone.Warn || row.tone == ProjectStatusTone.Error)
}
