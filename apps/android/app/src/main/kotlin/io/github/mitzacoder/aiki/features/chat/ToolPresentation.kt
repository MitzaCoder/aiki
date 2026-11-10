package io.github.mitzacoder.aiki.features.chat

import kotlinx.serialization.json.*

fun nestedCallStatus(call: JsonObject): String {
    val summary = call["summary"].obj()
    val error = summary?.s("error") ?: call.s("error")
    val status = if(summary != null) { if(summary["isError"] == JsonPrimitive(true)) "error" else "ok" }
        else call.s("status").let { if(it == "pending" || it.isBlank()) "running" else it }
    return if(status == "error" && error.startsWith("Command exited with code ")) "exited" else status
}
private val header = Regex("^Script (?:completed|failed)\\nWall time [\\d.]+ seconds\\nOutput:\\n?")
internal fun scriptOutput(text: String) = text.replace(header,"")
fun unwrapScript(part: ChatPart): ChatPart {
    if(part.name != "codemode" || part.status != "done" || part.nested.size != 1) return part
    val call = part.nested.single()
    if(call.s("name") !in setOf("bash","read","write","edit") || call.s("status") !in setOf("ok","error")) return part
    val args = runCatching { Json.parseToJsonElement(call.s("args")).obj() }.getOrNull() ?: return part
    val code = part.arguments.obj()?.s("code")?.takeIf { it.isNotBlank() } ?: return part
    val output = scriptOutput(part.text).replace(Regex("\\n*This script made one tool call and returned all of its output; call the tool directly next time\\.\\s*$"),"")
    val diagnostic = call.s("error").takeIf { it.isNotBlank() }?.let { error ->
        buildJsonObject {
            put("severity", "error")
            put("message", error)
            if(nestedCallStatus(call) == "exited") put("code", "exit_code")
        }
    }
    return part.copy(name = call.s("name"),arguments = args,text = output,viaScript = code,details = null,nested = emptyList(),status = nestedCallStatus(call).let { if(it == "ok") "done" else it },diagnostics = (part.diagnostics + listOfNotNull(diagnostic)).distinct())
}
/** pi-durable carries the exit number in this message, not in a separate numeric field. */
fun toolExitCode(part: ChatPart): Int? = part.diagnostics.firstNotNullOfOrNull { diagnostic ->
    if(diagnostic.s("code") == "exit_code") Regex("^Command exited with code (-?\\d+)")
        .find(diagnostic.s("message"))?.groupValues?.get(1)?.toIntOrNull() else null
}

fun toolStatusLabel(part: ChatPart): String = toolExitCode(part)?.let { "${part.status} · exit $it" } ?: part.status

/** Keep metadata intact; omit only the repeated prose in the expanded presentation. */
fun visibleDiagnostics(part: ChatPart): List<JsonObject> = part.diagnostics
    .filter { it.s("message").isNotBlank() && !part.text.contains(it.s("message")) }
    .distinctBy { it.s("message") }

internal fun toolSummary(part: ChatPart): String {
    val args = part.arguments.obj() ?: return ""
    return when(part.name) {
        "bash" -> args.s("command")
        "read","write","edit","ls" -> args.s("path")
        "codemode" -> args.s("code").removePrefix("//").trim()
        else -> listOf("title","query","text","workerId","threadId","taskId","fileId","action").firstNotNullOfOrNull { args.s(it).takeIf(String::isNotBlank) }
            ?: args.values.firstOrNull { it is JsonPrimitive && it.isString }?.jsonPrimitive?.content.orEmpty()
    }.lineSequence().firstOrNull().orEmpty().take(120)
}
