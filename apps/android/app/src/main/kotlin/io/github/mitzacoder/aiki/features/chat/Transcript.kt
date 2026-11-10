package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.protocol.EntryRecord
import io.github.mitzacoder.aiki.protocol.CacheWarmStretch
import kotlinx.serialization.json.*

internal fun JsonElement?.obj() = this as? JsonObject
internal fun JsonElement?.objects() = (this as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
internal fun JsonObject.s(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
internal fun contentText(content: JsonElement?): String = when(content) {
    is JsonPrimitive -> content.contentOrNull.orEmpty()
    is JsonArray -> content.objects().filter { it.s("type") == "text" }.joinToString("\n") { it.s("text") }
    else -> ""
}
data class ChatPart(val key: String, val kind: String, val text: String = "", val name: String = "", val status: String = "", val arguments: JsonElement? = null, val details: JsonElement? = null, val nested: List<JsonObject> = emptyList(), val viaScript: String? = null, val sourceConversationId: Long? = null, val sourceEntryId: Long? = null, val diagnostics: List<JsonObject> = emptyList(), val timestamp: Long? = null, val durationMs: Long? = null, val detail: String? = null)
/**
 * What a turn (everything the coordinator did between two user messages) took, for the footer under its last row: its
 * start and end, the model, the tokens and cost summed over its requests, the requests that re-billed much of the
 * cached prompt, and its text for the copy button. [streaming] while its message still arrives (the footer waits).
 */
data class TurnMeta(val timestamp: Long? = null, val ended: Long? = null, val model: String? = null, val usage: TurnUsage? = null, val cacheMisses: List<CacheMiss> = emptyList(), val text: String = "", val streaming: Boolean = false)
/** One transcript row: a part, or a group of them (thinking steps, a coding run, a run of other calls); [turn] on a turn's last row. */
data class ChatRow(val key: String, val parts: List<ChatPart>, val turn: TurnMeta? = null) {
    /** A run of two or more calls that are not coding calls, folded into one "N steps" row. */
    val isSteps: Boolean get() = parts.size > 1 && parts.first().kind == "tool" && parts.first().name !in coding
}
private val coding = setOf("read","write","edit","bash")
fun groupParts(parts: List<ChatPart>): List<ChatRow> {
    val rows = mutableListOf<ChatRow>(); var i = 0
    while (i < parts.size) {
        val first = parts[i++]; val group = mutableListOf(first)
        if (first.kind == "thinking") {
            while(i < parts.size && parts[i].kind == "thinking") group += parts[i++]
        } else if(first.kind == "tool" && first.name in coding) {
            while(i < parts.size) {
                val next = parts[i]
                if(next.kind == "tool" && next.name in coding) group += parts[i++]
                else if(next.kind == "thinking" && parts.drop(i).firstOrNull { it.kind != "thinking" }?.let { it.kind == "tool" && it.name in coding } == true) group += parts[i++]
                else break
            }
        } else if(first.kind == "tool") {
            // Board writes, schedules, workers, threads, memory: a stack of them between two sentences folds into one row.
            while(i < parts.size && parts[i].kind == "tool" && parts[i].name !in coding) group += parts[i++]
        }
        rows += ChatRow(first.key,group)
    }
    return rows
}

/** Pure projection over retained history. Results and live slots enrich a single stable call identity. */
fun transcript(entries: List<EntryRecord>, liveValue: JsonElement?, keepWarm: List<CacheWarmStretch> = emptyList()): List<ChatRow> {
    val warmByAnchor = cacheWarmByAnchor(keepWarm, entries.map { it.id }.toSet())
    val live = liveValue.obj()
    val results = mutableMapOf<String,Pair<JsonObject,JsonElement?>>()
    entries.forEach { e -> e.model.orEmpty().mapNotNull { it.obj() }.filter { it.s("role") == "toolResult" }.forEach { results[it.s("toolCallId")] = it to e.data } }
    val slots = live?.get("tools").objects().associateBy { it.s("callId") }
    val nested = live?.get("nestedTools").objects()
    val seen = mutableSetOf<String>(); val parts = mutableListOf<ChatPart>()
    val cache = CacheMissTracker()
    class Turn(val start: Int) { var timestamp: Long? = null; var ended: Long? = null; var model: String? = null; var usage: TurnUsage? = null; val misses = mutableListOf<CacheMiss>(); var streaming = false }
    var turn: Turn? = null
    val turns = mutableMapOf<String,TurnMeta>()
    fun ensureTurn(): Turn = turn ?: Turn(parts.size).also { turn = it }
    fun flush() {
        val current = turn ?: return
        turn = null
        if(parts.size <= current.start) return
        val text = parts.subList(current.start,parts.size).filter { it.kind == "text" }.joinToString("\n\n") { it.text }
        turns[parts.last().key] = TurnMeta(current.timestamp,current.ended,current.model,current.usage,current.misses.toList(),text,current.streaming)
    }
    fun absorb(message: JsonObject) {
        val current = ensureTurn()
        (message["timestamp"] as? JsonPrimitive)?.longOrNull?.let { time ->
            if(current.timestamp == null) current.timestamp = time
            current.ended = maxOf(current.ended ?: time,time)
        }
        message.s("model").takeIf(String::isNotEmpty)?.let { current.model = it }
        message["usage"].obj()?.let { usage ->
            fun n(o: JsonObject?, key: String) = (o?.get(key) as? JsonPrimitive)?.doubleOrNull ?: 0.0
            val sum = current.usage ?: TurnUsage()
            current.usage = TurnUsage(sum.input + n(usage,"input"),sum.output + n(usage,"output"),sum.cacheRead + n(usage,"cacheRead"),sum.cacheWrite + n(usage,"cacheWrite"),sum.cost + n(usage["cost"].obj(),"total"))
        }
    }
    fun tool(call: JsonObject, fallbackId: String) {
        val id = call.s("id").ifBlank { call.s("callId").ifBlank { fallbackId } }
        if(!seen.add(id)) return
        val result = results[id]; val message = result?.first; val slot = slots[id]
        val output = message?.let { contentText(it["content"]) } ?: slot?.s("output").orEmpty()
        val diagnostics = (result?.second.obj()?.get("diagnostics").objects() + slot?.get("diagnostics").objects()).distinct()
        val error = message?.get("isError") == JsonPrimitive(true)
        val status = when {
            error && diagnostics.any { it.s("code") == "exit_code" } && output.isNotEmpty() -> "exited"
            error -> "error"
            message != null -> "done"
            slot != null -> slot.s("status").let { if(it == "pending") "preparing" else it }
            live?.get("generation") != null -> "preparing"
            else -> "interrupted"
        }
        val details = message?.get("details") ?: slot?.get("details")
        val children = if(message != null) details.obj()?.get("calls").objects() else nested.filter { it.s("parentCallId") == id }
        parts += unwrapScript(ChatPart("call-$id","tool",output,call.s("name").ifBlank { message?.s("toolName") ?: "tool" },status,call["arguments"],details,children,diagnostics = diagnostics, timestamp = (message?.get("timestamp") as? JsonPrimitive)?.longOrNull, durationMs = (message?.get("durationMs") as? JsonPrimitive)?.longOrNull))
    }
    fun assistant(message: JsonObject, key: String, active: Boolean = false) {
        ensureTurn()
        val blocks = message["content"].objects()
        blocks.forEachIndexed { index,b ->
            when(b.s("type")) {
                "toolCall" -> tool(b,"$key-$index")
                // Only the live message's last block is still being written; thinking before its text is done (web `buildTranscript`).
                "thinking" -> if(b["redacted"] != JsonPrimitive(true)) parts += ChatPart("$key-$index","thinking",b.s("thinking"),status = if(active && index == blocks.lastIndex) "running" else "done")
                "text" -> parts += ChatPart("$key-$index","text",b.s("text"),timestamp = (message["timestamp"] as? JsonPrimitive)?.longOrNull)
            }
        }
        when(message.s("stopReason")) {
            "error" -> parts += ChatPart("$key-end","notice",message.s("errorMessage").ifBlank { "The model response failed." },status = "error")
            "aborted" -> parts += ChatPart("$key-end","notice","Stopped.",status = "stopped")
        }
    }
    entries.forEach { e ->
        val messages = e.model.orEmpty().mapNotNull { it.obj() }
        // Compactions, resets and instruction changes move the cache tracker; assistant messages are fed below.
        if(e.kind != "pi.assistant") cache.observeEntry(e.kind,e.model)
        if(e.kind in setOf("pi.user","pi.reset","pi.compaction")) flush()
        when(e.kind) {
            "pi.assistant" -> messages.forEachIndexed { i,m ->
                absorb(m)
                cache.observe(m)?.takeIf(::isNotableCacheMiss)?.let { ensureTurn().misses += it }
                assistant(m,"entry-${e.id}-$i")
            }
            "pi.user" -> messages.forEachIndexed { i,m ->
                val text = contentText(m["content"])
                val injected = m["content"].objects().none { it.s("type") == "image" } && injectedInput(text) != null
                if(text.isNotEmpty()) parts += ChatPart("entry-${e.id}-$i",if(injected) "notice" else "user",text,timestamp = (m["timestamp"] as? JsonPrimitive)?.longOrNull)
                m["content"].objects().filter { it.s("type") == "image" }.forEachIndexed { n,b -> parts += ChatPart("entry-${e.id}-$i-image-$n","image",b.s("data"),b.s("mimeType")) }
            }
            "pi.compaction" -> parts += ChatPart("entry-${e.id}","compaction",messages.map { contentText(it["content"]) }.filter(String::isNotBlank).joinToString("\n"),sourceConversationId = e.conversationId,sourceEntryId = e.id,
                timestamp = messages.firstNotNullOfOrNull { (it["timestamp"] as? JsonPrimitive)?.longOrNull })
            "pi.reset" -> parts += ChatPart("entry-${e.id}","notice","Context reset. Earlier messages are still in the transcript.",status = "info")
            "pi.tool-result" -> messages.forEach { m ->
                val id = m.s("toolCallId")
                // A call may be outside the paged window; keep its output visible.
                if(id !in seen) { ensureTurn(); tool(buildJsonObject { put("id",id); put("name",m.s("toolName")) },id) }
            }
        }
        warmByAnchor[e.id].orEmpty().forEach { stretch ->
            flush()
            parts += ChatPart("cache-warm-${stretch.id}", "cacheWarm", cacheWarmLabel(stretch), detail = cacheWarmDetail(stretch))
            stretch.lastReadAt?.let { cache.touch(it.toLong()) }
        }
    }
    val generation = live?.get("generation").obj()?.get("message").obj()
    if(generation != null && entries.none { e -> e.model.orEmpty().any { m -> m == generation || (generation["timestamp"] != null && m.obj()?.get("timestamp") == generation["timestamp"] && m.obj()?.get("content") == generation["content"]) } }) { absorb(generation); ensureTurn().streaming = true; assistant(generation,"live",active = true) }
    slots.values.forEach { if(it.s("callId") !in seen) ensureTurn(); tool(it,it.s("callId")) }
    flush()
    live?.get("compactions").objects().forEachIndexed { i,c -> parts += ChatPart("compacting-$i","compaction",status = "running",detail = c.s("reason").ifBlank { null }) }
    live?.get("generation").obj()?.get("retry").obj()?.let { parts += ChatPart("retry","notice","The model request failed; retrying.",status = "warning",detail = it.s("error").ifBlank { null }) }
    live?.get("runFailure").obj()?.let { parts += ChatPart("runFailure","notice","The last run failed${it.s("reason").takeIf(String::isNotBlank)?.let { reason -> " ($reason)" }.orEmpty()}.",status = "error",detail = it.s("detail").ifBlank { null }) }
    live?.get("compactionFailure").obj()?.let { parts += ChatPart("compactionFailure","notice","Compaction failed.",status = "error",detail = it.s("error").ifBlank { null }) }
    return groupParts(parts).map { row -> turns[row.parts.last().key]?.let { row.copy(turn = it) } ?: row }
}
