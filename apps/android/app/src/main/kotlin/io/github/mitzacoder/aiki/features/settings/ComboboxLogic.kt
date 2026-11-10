package io.github.mitzacoder.aiki.features.settings

import io.github.mitzacoder.aiki.protocol.ModelInfo
import io.github.mitzacoder.aiki.protocol.ModelRef
import io.github.mitzacoder.aiki.protocol.ProviderInfo

/**
 * The searchable list behind a settings combobox, thinking dropdown and model lists (web `combobox.ts`, `thinking.ts`,
 * `models.ts`). Pure, so the filter, the grouping and the thinking rules are tested without a screen.
 */
data class ComboOption(
    /** What the field stores; unique in the list. An empty string is allowed for a "none" choice. */
    val value: String,
    val label: String,
    /** A second line under the label: an ID, a context size. */
    val description: String? = null,
    /** Group key; options without one sit in an unnamed group first. */
    val group: String? = null,
    /** What the group's heading says; defaults to the key. */
    val groupLabel: String? = null,
    /** More words the search matches that the row does not show. */
    val keywords: String = "",
    /** A small chip on the right: "no credential", "subscription". */
    val badge: String? = null,
    val badgeWarn: Boolean = false,
    val disabled: Boolean = false,
)

data class ComboGroup(val id: String, /** Null for the unnamed group, which has no heading. */ val label: String?, val options: List<ComboOption>)

/** Every word typed must appear in the option's label, description, group or keywords (any case). */
fun matchesQuery(option: ComboOption, query: String): Boolean {
    val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return true
    val haystack = "${option.label} ${option.description.orEmpty()} ${option.groupLabel ?: option.group.orEmpty()} ${option.keywords}".lowercase()
    return words.all { haystack.contains(it) }
}

/** The options that match, in groups ordered as the groups first appear in the list. */
fun filterOptions(options: List<ComboOption>, query: String = ""): List<ComboGroup> {
    val groups = LinkedHashMap<String, MutableList<ComboOption>>()
    val labels = HashMap<String, String?>()
    for (option in options) {
        if (!matchesQuery(option, query)) continue
        val id = option.group.orEmpty()
        groups.getOrPut(id) { mutableListOf() }.add(option)
        if (id !in labels) labels[id] = if (option.group == null) null else option.groupLabel ?: option.group
    }
    return groups.map { (id, list) -> ComboGroup(id, labels[id], list) }
}

/** The search box shows only for a list longer than this: a handful of choices is faster to scan than to search. */
const val COMBOBOX_SEARCH_THRESHOLD = 8

fun showsSearch(options: List<ComboOption>): Boolean = options.size > COMBOBOX_SEARCH_THRESHOLD

// ---- models

fun modelKey(provider: String, modelId: String) = "$provider/$modelId"
fun modelKey(model: ModelRef) = modelKey(model.provider, model.modelId)
fun modelKey(model: ModelInfo) = modelKey(model.provider, model.modelId)

fun providerName(providers: List<ProviderInfo>, id: String): String = providers.firstOrNull { it.id == id }?.name ?: id

/** A context window the way a list shows it: "200k", "1M". */
fun contextSize(tokens: Long): String = when {
    tokens >= 1_000_000 -> "${trimmed(tokens / 1_000_000.0)}M"
    tokens >= 1000 -> "${Math.round(tokens / 1000.0)}k"
    else -> tokens.toString()
}

private fun trimmed(value: Double): String {
    val text = String.format(java.util.Locale.US, "%.1f", value)
    return text.removeSuffix(".0")
}

/**
 * The catalog as combobox options: one group per provider (ordered by the provider's name), models by name, the model's
 * ID and context window under its name and a chip when its provider has no credential yet.
 */
fun modelOptions(models: List<ModelInfo>, providers: List<ProviderInfo>): List<ComboOption> =
    models.sortedWith(compareBy<ModelInfo>({ providerName(providers, it.provider).lowercase() }, { it.name.lowercase() })).map { model ->
        ComboOption(
            value = modelKey(model),
            label = model.name,
            description = "${model.modelId} · ${contextSize(model.contextWindow)} context",
            group = model.provider,
            groupLabel = providerName(providers, model.provider),
            keywords = model.provider,
            badge = if (model.configured) null else "no credential",
            badgeWarn = !model.configured,
        )
    }

// ---- thinking

/** Increasing effort, as the protocol lists them. */
val THINKING_ORDER = listOf("off", "minimal", "low", "medium", "high", "xhigh", "max")

/** How many of four bars a level lights; 0 for "model default" and "off". */
fun thinkingBars(level: String?): Int = when (level) {
    null, "off" -> 0
    "minimal", "low" -> 1
    "medium" -> 2
    "high" -> 3
    else -> 4
}

fun thinkingLabel(level: String?): String = if (level == null) "Model default" else level.replaceFirstChar(Char::uppercase)

private val THINKING_HINTS = mapOf(
    "off" to "No extra reasoning", "minimal" to "A moment of thought", "low" to "Light reasoning", "medium" to "Balanced",
    "high" to "Careful, slower", "xhigh" to "Very thorough", "max" to "As much as the model allows",
)

/**
 * "Model default" first, then the model's levels in increasing effort. A stored level the model does not list stays in the
 * list, so the dropdown shows what is saved instead of going blank.
 */
fun thinkingOptions(levels: List<String>, current: String?): List<ComboOption> {
    val shown = (levels + listOfNotNull(current)).toSet()
    val ordered = THINKING_ORDER.filter { it in shown } + shown.filter { it !in THINKING_ORDER }
    return listOf(ComboOption("", thinkingLabel(null), "Leave it to the model")) + ordered.map { level ->
        val hint = THINKING_HINTS[level] ?: level
        ComboOption(level, thinkingLabel(level), if (level in levels) hint else "$hint (this model does not list it)")
    }
}

