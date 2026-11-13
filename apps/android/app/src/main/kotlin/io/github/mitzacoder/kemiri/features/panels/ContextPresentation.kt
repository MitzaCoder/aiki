package io.github.mitzacoder.kemiri.features.panels

import io.github.mitzacoder.kemiri.features.status.exactTime
import io.github.mitzacoder.kemiri.features.status.relativeTime
import io.github.mitzacoder.kemiri.features.status.toFixed
import io.github.mitzacoder.kemiri.features.usage.formatTokenCount
import io.github.mitzacoder.kemiri.protocol.CacheMissTotals
import io.github.mitzacoder.kemiri.protocol.ContextFile
import io.github.mitzacoder.kemiri.protocol.ContextUsage
import io.github.mitzacoder.kemiri.protocol.ConversationContext
import io.github.mitzacoder.kemiri.protocol.SkillInfo
import io.github.mitzacoder.kemiri.protocol.ToolInfo
import kotlin.math.ceil

/**
 * How the Info tab words a conversation's context: what each system prompt file is and where it comes from, the system
 * prompt's size, its skills by what read them and where they come from, its tools by extension, the overview's numbers, how full the context window is, and its prompt cache
 * misses. Ports of the web's `lib/context.ts`, `lib/context-usage.ts` and `lib/chat/cache.ts` (`cacheMissTotalsView`).
 */

/** What a context file is; an older backend sends no kind and knows only AGENTS.md files. */
fun contextFileKind(file: ContextFile): String = file.kind ?: "agents"

fun contextFileKindLabel(kind: String): String = when (kind) {
    "system" -> "System prompt override"
    "append" -> "Appended instructions"
    "agents" -> "AGENTS.md"
    "model" -> "Model notes"
    else -> kind
}

/**
 * Where a file comes from: the harness config ("harness config"), pi's agent directory ("global"), the project, or one
 * of its ancestor folders ("parent folder").
 */
fun contextFileOriginLabel(file: ContextFile, projectPath: String): String {
    if (contextFileKind(file) != "agents") return if (file.scope == "global") "harness config" else "project"
    if (file.scope == "global") return "global"
    val path = file.path.trimEnd('/')
    val parent = path.substringBeforeLast('/', "").ifEmpty { "/" }
    return if (parent == projectPath.trimEnd('/').ifEmpty { "/" }) "project" else "parent folder"
}

/** The badge a file row shows: an AGENTS.md by where it comes from, a system prompt file by what it is. */
fun contextFileBadge(file: ContextFile, projectPath: String): String =
    if (contextFileKind(file) == "agents") contextFileOriginLabel(file, projectPath) else contextFileKindLabel(contextFileKind(file))

/** A file's own name: model notes are picked by their name's model pattern, so the name says why it applies. */
fun contextFileName(file: ContextFile): String = file.path.trimEnd('/').substringAfterLast('/')

/** A file's size as the Info tab reads it: "840 B", "2.4 KB", "15.2 KB", "120 KB" (web `lib/context.ts` `formatBytes`). */
fun contextBytes(bytes: Long): String {
    if (bytes < 1000) return "$bytes B"
    val kilobytes = bytes / 1000.0
    return if (kilobytes < 100) "${toFixed(kilobytes, 1)} KB" else "${Math.round(kilobytes)} KB"
}

fun textSize(text: String): String = contextBytes(text.toByteArray(Charsets.UTF_8).size.toLong())

/** About four characters a token. */
fun estimateTokens(text: String): Long = ceil(text.length / 4.0).toLong()

/** A token estimate as it reads: "~840 tokens", "~3.8k tokens". */
fun formatTokenEstimate(tokens: Long): String =
    if (tokens < 1000) "~$tokens token${if (tokens == 1L) "" else "s"}"
    else "~${toFixed(tokens / 1000.0, 1)}k tokens"

/** A conversation's cache misses for the Info tab: the line, its long version, and whether some had no cause. */
data class CacheMissTotalsView(val label: String, val title: String, val warning: Boolean)

private fun aboutCost(cost: Double): String = if (cost >= 0.01) " (~$${toFixed(cost, 2)})" else ""

fun cacheMissTotalsView(totals: CacheMissTotals?): CacheMissTotalsView? {
    if (totals == null || totals.misses == 0L) return null
    fun plural(count: Long) = "$count cache miss${if (count == 1L) "" else "es"}"
    val all = "${plural(totals.misses)} so far: ${formatTokenCount(totals.missedTokens)} tokens re-billed${aboutCost(totals.missedCost)}."
    if (totals.unexplained == 0L) return CacheMissTotalsView(
        "${plural(totals.misses)}, each after idle time or a change",
        "$all Each came after the conversation sat idle, the model was switched, or the instructions changed.",
        false,
    )
    return CacheMissTotalsView(
        "${plural(totals.unexplained)} with no clear cause · ${formatTokenCount(totals.unexplainedTokens)} tokens${aboutCost(totals.unexplainedCost)}",
        "$all ${totals.unexplained} of them had no idle gap, model switch or change of instructions: the start of the prompt changed between two requests, which shouldn't happen." +
            (totals.lastUnexplainedAt?.let { " Last one: ${exactTime(it)}." } ?: ""),
        true,
    )
}

/** How full a window a token count is, 0–100 with one decimal; null when the window is unusable (web `usagePercent`). */
fun usagePercent(tokens: Long, window: Long?): Double? {
    if (window == null || window <= 0) return null
    return (Math.round(tokens.toDouble() / window * 1000) / 10.0).coerceIn(0.0, 100.0)
}

/**
 * Everything the usage block draws (web `ContextUsageView`): whether the window is known, the bar and its threshold
 * ticks (0–100), "12.3k / 200k", "6%", "background at 70k", "blocking at 100k" and "2 compactions · last 5 min ago".
 */
data class ContextUsageView(
    val measured: Boolean,
    val percent: Double,
    val backgroundPercent: Double?,
    val blockingPercent: Double?,
    val tokensLabel: String,
    val percentLabel: String,
    val thresholdsLabel: String,
    val compactionsLabel: String,
    val lastCompactionTitle: String?,
)

/** Read a context usage; with no model there is no window, and the numbers are left out instead of drawn as zero. */
fun contextUsageView(usage: ContextUsage, now: Long): ContextUsageView {
    val window = usage.contextWindow
    val measured = window != null
    val percent = if (measured) usagePercent(usage.contextTokens ?: 0, window) ?: 0.0 else 0.0
    val count = usage.compactions
    val last = usage.lastCompactionAt?.takeIf { count > 0 }
    return ContextUsageView(
        measured = measured,
        percent = percent,
        backgroundPercent = usage.backgroundAt?.takeIf { measured }?.let { usagePercent(it, window) },
        blockingPercent = usage.blockingAt?.takeIf { measured }?.let { usagePercent(it, window) },
        tokensLabel = if (measured) "${usage.contextTokens?.let(::formatTokenCount) ?: "—"} / ${formatTokenCount(window ?: 0)}" else "—",
        percentLabel = if (measured) "${Math.round(percent)}%" else "",
        thresholdsLabel = listOfNotNull(
            usage.backgroundAt?.let { "background at ${formatTokenCount(it)}" },
            usage.blockingAt?.let { "blocking at ${formatTokenCount(it)}" },
        ).joinToString(" · "),
        compactionsLabel = if (count == 0L) "No compactions yet"
            else "$count compaction${if (count == 1L) "" else "s"}${last?.let { " · last ${relativeTime(it, now)}" } ?: ""}",
        lastCompactionTitle = last?.let(::exactTime),
    )
}

/** What pi's own tools are grouped under; they have no extension. */
const val BUILT_IN_TOOLS_LABEL = "Built-in"

private val toolGroupLabels = mapOf("coding-tools" to "Coding", "worker-tools" to "Workers", "aiki-agent-context" to "Context")

/** How an extension's tools are headed: "Coding", "Workers", or a readable form of an unknown ID ("Memory tools"). */
fun toolGroupLabel(extension: String): String {
    toolGroupLabels[extension]?.let { return it }
    val words = extension.replace(Regex("[._-]+"), " ").trim()
    return if (words.isEmpty()) extension else words.replaceFirstChar { it.uppercase() }
}

/** One group of tools: pi's own (no [extension]), or those one extension registered. */
data class ToolGroup(val label: String, val extension: String?, val tools: List<ToolInfo>)

/** Tools grouped by the extension that registered them, built-ins first, then by label, names sorted inside each. */
fun groupTools(tools: List<ToolInfo>): List<ToolGroup> =
    tools.groupBy { it.extension }
        .map { (extension, group) -> ToolGroup(extension?.let(::toolGroupLabel) ?: BUILT_IN_TOOLS_LABEL, extension, group.sortedBy { it.name }) }
        .sortedWith(compareBy<ToolGroup> { if (it.extension == null) 0 else 1 }.thenBy { it.label })

/** Skills ordered by name as the web's `localeCompare` does. */
private val skillNameOrder: Comparator<SkillInfo> = java.text.Collator.getInstance(java.util.Locale.ROOT).let { collator -> Comparator { left, right -> collator.compare(left.name, right.name) } }

/** The skills this conversation read, which shaped it and are shown first, and the ones still on offer; each by name. */
data class SkillGroups(val read: List<SkillInfo>, val available: List<SkillInfo>)

fun skillGroups(skills: List<SkillInfo>): SkillGroups =
    SkillGroups(read = skills.filter { it.read }.sortedWith(skillNameOrder), available = skills.filterNot { it.read }.sortedWith(skillNameOrder))

/** One scope's skills inside a source: "Global" or "Project". */
data class SkillScopeGroup(val scope: String, val label: String, val skills: List<SkillInfo>)

/** Skills split by scope, global first, each by name; empty scopes are left out. */
fun skillScopeGroups(skills: List<SkillInfo>): List<SkillScopeGroup> =
    listOf("global" to "Global", "project" to "Project")
        .map { (scope, label) -> SkillScopeGroup(scope, label, skills.filter { it.scope == scope }.sortedWith(skillNameOrder)) }
        .filter { it.skills.isNotEmpty() }

/** Where a skill came from; an older backend sends no source, and every skill it knew was pi's. */
fun skillSource(skill: SkillInfo): String = skill.source ?: "pi"

/** How a source reads in the panel: "Harness", "pi" or "Claude". */
fun skillSourceLabel(source: String): String = when (source) {
    "harness" -> "Harness"
    "claude" -> "Claude"
    else -> source
}

/** One source's skills inside the read or available group, split by scope. */
data class SkillSourceGroup(val source: String, val label: String, val skills: List<SkillInfo>, val scopes: List<SkillScopeGroup>)

/** The skills by where they come from — the harness, pi, then Claude — each by scope and name; empty sources left out. */
fun skillSourceGroups(skills: List<SkillInfo>): List<SkillSourceGroup> =
    listOf("harness", "pi", "claude").map { source ->
        val ofSource = skills.filter { skillSource(it) == source }
        SkillSourceGroup(source, skillSourceLabel(source), ofSource.sortedWith(skillNameOrder), skillScopeGroups(ofSource))
    }.filter { it.skills.isNotEmpty() }

/** The skills whose name, description, scope or source contains the filter text. */
fun filterSkills(skills: List<SkillInfo>, query: String): List<SkillInfo> {
    val needle = query.trim()
    if (needle.isEmpty()) return skills
    return skills.filter { skill -> listOf(skill.name, skill.description, skill.scope, skillSourceLabel(skillSource(skill))).any { it.contains(needle, ignoreCase = true) } }
}

/** The tools whose name, description or group contains the filter text. */
fun filterTools(tools: List<ToolInfo>, query: String): List<ToolInfo> {
    val needle = query.trim()
    if (needle.isEmpty()) return tools
    return tools.filter { tool -> listOf(tool.name, tool.description, tool.extension ?: BUILT_IN_TOOLS_LABEL).any { it.contains(needle, ignoreCase = true) } }
}

/** The overview's sections, which are also the panel's sections. */
enum class ContextSection { Agents, Skills, Tools, Prompt }

/** One number in the overview: a short value, its label, and an optional hint below it. */
data class ContextOverviewItem(val section: ContextSection, val label: String, val value: String, val detail: String? = null)

/** The four numbers worth seeing before scrolling: AGENTS.md files, skills read, tools, the prompt (web `contextOverview`). */
fun contextOverview(context: ConversationContext): List<ContextOverviewItem> {
    val skills = context.skills.size
    val groups = groupTools(context.tools).size
    return listOf(
        ContextOverviewItem(ContextSection.Agents, "AGENTS.md files", context.contextFiles.count { contextFileKind(it) == "agents" }.toString()),
        ContextOverviewItem(ContextSection.Skills, "skills read", if (skills == 0) "0" else "${context.skills.count { it.read }}/$skills"),
        ContextOverviewItem(ContextSection.Tools, "tools", context.tools.size.toString(), when (groups) { 0 -> null; 1 -> "1 group"; else -> "$groups groups" }),
        ContextOverviewItem(ContextSection.Prompt, "system prompt", textSize(context.systemPrompt), formatTokenEstimate(estimateTokens(context.systemPrompt))),
    )
}
