package io.github.mitzacoder.aiki.features.settings

import io.github.mitzacoder.aiki.protocol.McpOAuthCompleteResponseServerCommand
import kotlinx.serialization.json.*
import java.net.URI

data class McpImportEntry(
    val name: String, val serverId: String, val kind: String, val target: String,
    val command: McpOAuthCompleteResponseServerCommand? = null,
    val env: Map<String, String>? = null, val url: String? = null, val token: String? = null,
    val error: String? = null, val renamed: Boolean = false, val transport: String? = null, val envNames: List<String>? = null,
) { override fun toString(): String = "McpImportEntry(redacted)" }
fun mcpImportServerId(name: String, taken: List<String>): String {
    val base = name.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_').take(30).trimEnd('_').ifEmpty { "server" }
    val stem = if (base.first().isLetter()) base else "server_$base"
    var id = stem; var n = 2
    while (id in taken) id = "${stem}_${n++}"
    return id
}
private fun JsonElement.string(): String { require(this is JsonPrimitive && isString) { "Expected a string" }; return content }
fun parseMcpEnvironment(text: String): Map<String, String> {
    val env = Json.parseToJsonElement(text) as? JsonObject ?: error("Environment must be a JSON object")
    return env.mapValues { (key, value) ->
        require(Regex("[A-Za-z_][A-Za-z0-9_]*").matches(key) && !key.startsWith("AIKI_")) { "Invalid environment variable name" }
        value.string().also { require(!it.contains('\u0000')) { "Invalid environment value" } }
    }
}
fun parseMcpCommand(command: String, args: String, cwd: String): McpOAuthCompleteResponseServerCommand {
    require(command.isNotBlank() && !command.contains('\u0000')) { "Command must be a non-empty executable" }
    val array = Json.parseToJsonElement(args) as? JsonArray ?: error("Arguments must be a JSON array")
    require(array.size <= 256) { "Too many arguments" }
    val arguments = array.map { it.string().also { value -> require(!value.contains('\u0000')) { "Invalid argument" } } }
    require(cwd.isEmpty() || (cwd.startsWith('/') && !cwd.contains('\u0000'))) { "Working directory must be absolute" }
    return McpOAuthCompleteResponseServerCommand(command = command, args = arguments, cwd = cwd.ifEmpty { null })
}
fun parseMcpImport(text: String, taken: List<String> = emptyList()): List<McpImportEntry> {
    require(text.length <= 262144) { "Import is limited to 256 KiB" }
    val parsed = runCatching { Json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: error("Invalid JSON server map")
    val map = (parsed["mcpServers"] ?: parsed) as? JsonObject ?: error("mcpServers must be a server map")
    require(map.size <= 100) { "Import is limited to 100 servers" }
    val used = taken.toMutableList()
    return map.map { (name, element) ->
        val id = mcpImportServerId(name, used); used += id
        val kind = if ((element as? JsonObject)?.containsKey("command") == true) "command" else "http"
        val renamed = id != mcpImportServerId(name, emptyList())
        val reviewedName = if (renamed) "${name.take(110)} (${id.substringAfterLast('_')})" else name
        try {
            require(name.isNotBlank() && name.length <= 120) { "Name must be 1–120 characters" }
            val entry = element as? JsonObject ?: error("Expected a server object")
            if (kind == "command") {
                require(!entry.containsKey("url")) { "Choose command or URL, not both" }
                val command = parseMcpCommand(entry.getValue("command").string(), (entry["args"] ?: JsonArray(emptyList())).toString(), entry["cwd"]?.string().orEmpty())
                val env = parseMcpEnvironment((entry["env"] ?: JsonObject(emptyMap())).toString())
                McpImportEntry(reviewedName, id, kind, "${command.command} ${JsonArray(command.args.map(::JsonPrimitive))}", command = command, env = env, renamed = renamed)
            } else {
                val type = entry["type"]?.string()
                require(type == null || type in listOf("http", "sse", "streamable-http")) { "Unsupported transport type" }
                val url = entry["url"]?.string() ?: error("Missing URL")
                val uri = runCatching { URI(url) }.getOrNull() ?: error("Invalid URL")
                require(uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && (uri.scheme == "https" || (uri.scheme == "http" && uri.host in listOf("localhost", "127.0.0.1", "[::1]")))) { "URL requires HTTPS (except loopback), no credentials, query or fragment" }
                var token: String? = null
                entry["headers"]?.let { headers ->
                    require(headers is JsonObject) { "headers must be an object" }
                    headers.forEach { (key, value) ->
                        val header = value.string()
                        require(key.equals("authorization", true) && Regex("Bearer [^\\r\\n]+", RegexOption.IGNORE_CASE).matches(header)) { "Only Authorization: Bearer headers can be imported" }
                        token = header.substring(7)
                    }
                }
                McpImportEntry(reviewedName, id, kind, url, url = url, token = token, renamed = renamed, transport = type?.takeIf { it == "sse" })
            }
        } catch (failure: Exception) { McpImportEntry(name, id, kind, "Invalid $kind", error = failure.message ?: "Invalid entry", renamed = renamed) }
    }
}
