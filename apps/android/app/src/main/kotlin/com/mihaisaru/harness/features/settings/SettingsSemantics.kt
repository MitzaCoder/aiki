package com.mihaisaru.harness.features.settings

import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.protocol.*
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request

const val DEFAULT_PUBLISHED_URL = com.mihaisaru.harness.BuildConfig.PUBLISHED_BACKENDS_URL

fun parsePublishedBackends(text: String): List<BackendConfig> {
    val rows = runCatching { wireJson.parseToJsonElement(text) as? JsonArray }.getOrNull() ?: return emptyList()
    val result = mutableListOf<BackendConfig>()
    for (row in rows) {
        val obj = row as? JsonObject ?: continue
        val name = (obj["name"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim() ?: continue
        val raw = (obj["url"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
        if (name.length !in 1..64 || name.any { it.code < 32 } || raw.length > 512) continue
        val url = runCatching { normalizeBackendOrigin(raw) }.getOrNull() ?: continue
        if (result.any { it.name == name || it.url == url }) continue
        result += BackendConfig(name, url)
        if (result.size == 32) break
    }
    return result
}

fun resolveBackend(address: String, name: String, entries: List<BackendConfig>, appOrigin: String = DEFAULT_PUBLISHED_URL): BackendConfig {
    val input = address.trim()
    require(input.isNotEmpty()) { "Enter a backend address." }
    val named = entries.firstOrNull { it.name.equals(input, ignoreCase = true) }
    fun suffix(url: String): String? {
        val host = runCatching { URI(url).host }.getOrNull() ?: return null
        if (host.contains(':') || Regex("[0-9.]+").matches(host) || host.split('.').size < 3) return null
        return host.substringAfter('.')
    }
    val domain = entries.mapNotNull { suffix(it.url) }.groupingBy { it }.eachCount().maxByOrNull { it.value }?.key ?: suffix(appOrigin)
    val expanded = when {
        named != null -> named.url
        input.contains("://") -> input
        Regex("(?i)(localhost|127\\.0\\.0\\.1|\\[::1])(:[0-9]+)?").matches(input) -> "http://$input"
        Regex("(?i)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?").matches(input) && domain != null -> "https://$input.$domain"
        else -> "https://$input"
    }
    val url = normalizeBackendOrigin(expanded)
    val host = URI(url).host.removePrefix("[").removeSuffix("]")
    val derived = named?.name ?: if (host == "::1") "localhost" else if (Regex("[0-9.]+").matches(host)) host else host.substringBefore('.')
    val label = name.trim().ifEmpty { derived.take(48) }
    require(label.length in 1..48 && label.none { it.code < 32 || it.code == 127 }) { "Use a backend name of 1–48 characters without control characters." }
    return BackendConfig(label, url)
}

private val discoveryHttp = OkHttpClient.Builder().callTimeout(10, java.util.concurrent.TimeUnit.SECONDS).build()
suspend fun fetchPublishedBackends(url: String): List<BackendConfig> = withContext(Dispatchers.IO) {
    runCatching {
        val uri = URI(url)
        require(uri.scheme == "https" && uri.rawUserInfo == null)
        discoveryHttp.newCall(Request.Builder().url(url).header("Accept", "application/json").build()).execute().use { response ->
            if (!response.isSuccessful) emptyList() else {
                val output = java.io.ByteArrayOutputStream()
                val input = response.body.byteStream()
                val buffer = ByteArray(4096)
                while (output.size() <= 65536) {
                    val count = input.read(buffer, 0, minOf(buffer.size, 65537 - output.size()))
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                val bytes = output.toByteArray()
                if (bytes.size > 65536) emptyList() else parsePublishedBackends(bytes.toString(Charsets.UTF_8))
            }
        }
    }.getOrDefault(emptyList())
}

data class CoordinatorPatch(val request: ProjectsConfigureRequest, val explicitNulls: Set<String>)
fun coordinatorPatch(projectId: String, model: ModelRef?, thinking: String?): CoordinatorPatch = CoordinatorPatch(
    ProjectsConfigureRequest(projectId = projectId, coordinatorModel = model, coordinatorThinkingLevel = thinking),
    buildSet {
        if (model == null) add("coordinatorModel")
        if (thinking == null) add("coordinatorThinkingLevel")
    },
)

fun validThinking(level: String?, model: ModelInfo?): String? = level?.takeIf { model?.thinkingLevels?.contains(it) == true }
fun Schedule.toInput() = ScheduleInput(title, brief, spec, model, thinkingLevel, isolation, onReport, enabled, kind)

fun backendTime(value: String?, timezone: String): String {
    if (value == null) return "—"
    return runCatching {
        java.time.Instant.parse(value).atZone(java.time.ZoneId.of(timezone))
            .format(java.time.format.DateTimeFormatter.ofPattern("EEE, d MMM HH:mm z", java.util.Locale.getDefault()))
    }.getOrDefault(value)
}

fun scheduleSpec(kind: String, minutes: String, time: String, days: Set<Int>, cron: String, repos: String = ""): ScheduleSpec = when (kind) {
    "github-review-requested" -> {
        val list = repos.split(Regex("[\\s,]+")).map { it.trim() }.filter { it.isNotEmpty() }
        val unknown = list.filter { com.mihaisaru.harness.features.refs.normalizeGithubRepo(it) == null }
        require(unknown.isEmpty()) { "Write each repository as owner/name: ${unknown.joinToString(", ")}" }
        ScheduleSpecGithubReviewRequested(repos = list.takeIf { it.isNotEmpty() })
    }
    "interval" -> {
        val value = minutes.toLongOrNull()
        require(value != null && value in 5..10080) { "Interval must be 5–10080 minutes." }
        ScheduleSpecInterval(everyMinutes = value)
    }
    "daily", "weekly" -> {
        require(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]").matches(time)) { "Use a 24-hour time, HH:MM." }
        if (kind == "weekly") {
            require(days.isNotEmpty() && days.all { it in 0..6 }) { "Choose at least one day." }
            ScheduleSpecWeekly(days = days.sorted().map(Int::toLong), time = time)
        } else ScheduleSpecDaily(time = time)
    }
    "cron" -> {
        require(cron.trim().split(Regex("\\s+")).size == 5) { "Cron requires five fields: minute hour day month weekday." }
        ScheduleSpecCron(expression = cron.trim())
    }
    else -> error("Unknown schedule type")
}
