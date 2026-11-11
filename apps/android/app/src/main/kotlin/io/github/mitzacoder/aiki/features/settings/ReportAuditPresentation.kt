package io.github.mitzacoder.aiki.features.settings

import io.github.mitzacoder.aiki.protocol.*
import java.text.NumberFormat
import java.util.Locale
import io.github.mitzacoder.aiki.features.tasks.relativeTime

internal const val REPORT_AUDIT_FEATURE = "report-audit"
internal val DEFAULT_REPORT_AUDIT_SETTINGS = ProjectsConfigureRequestReportAudit(mode = "auto", dailyTokens = 65000)
internal fun reportAuditVisible(features: Collection<String>?): Boolean = features?.contains(REPORT_AUDIT_FEATURE) == true

internal fun reportAuditBudget(text: String): Long? = text.trim().toLongOrNull()?.takeIf { it in 0..10_000_000 }

internal fun reportAuditUsage(used: Long, budget: Long): String {
    val number = NumberFormat.getIntegerInstance(Locale.US)
    return "${number.format(used)} of ${number.format(budget)} tokens today"
}

internal fun reportAuditModel(model: ModelRef?, models: List<ModelInfo>, providers: List<ProviderInfo>): String =
    if (model == null) "No model available" else {
        val name = models.firstOrNull { it.provider == model.provider && it.modelId == model.modelId }?.name ?: model.modelId
        "Using $name via ${providerName(providers, model.provider)}"
    }

internal fun reportAuditStatusWords(status: ProjectSummaryReportAuditStatus?, now: Long): String =
    if (status == null) "No checks run yet · Status not available yet" else listOf(
        status.lastRunAt?.let { "Last run ${relativeTime(it, now)}" } ?: "No checks run yet",
        status.reason?.takeIf { it.isNotBlank() } ?: when (status.state) {
            "off" -> "Off"
            "running" -> "Checking reports"
            "checked" -> "Reports checked"
            "budget" -> "Daily budget spent"
            "unavailable" -> "Unavailable"
            "error" -> "Check failed"
            else -> "Idle"
        },
    ).joinToString(" · ")
