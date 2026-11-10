package io.github.mitzacoder.aiki.features.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.protocol.WorkerSummary
import io.github.mitzacoder.aiki.ui.components.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/*
 * A `worker_*` call as one compact card for the worker it acted on, opening that worker's read-only transcript. Wording
 * from the web's `WorkerCallCard.svelte` and `lib/workers.ts` (WorkerCallCardTest).
 */

/** What a tool call did with a worker. */
fun workerToolAction(name: String): String = when (name) {
    "worker_spawn" -> "Started worker"
    "worker_send" -> "Sent to worker"
    "worker_stop" -> "Stopped worker"
    "worker_forget" -> "Forgot worker"
    "worker_peek" -> "Peeked at worker"
    else -> "Worker"
}

fun workerPlace(worker: WorkerSummary): String = if (worker.isolation == "shared") "shared checkout" else worker.workspacePath ?: "workspace removed"

/** "Retitled <old> → <new> and sent a message" when the old title is known and differs, else "Sent <new> a new task"; null without a title. */
fun workerSendLine(part: ChatPart, previousTitle: String?): String? {
    if (part.name != "worker_send") return null
    val title = part.arguments.record()?.s("title")?.takeIf(String::isNotEmpty) ?: return null
    if (previousTitle != null && previousTitle != title) return "Retitled $previousTitle → $title and sent a message"
    return "Sent $title a new task"
}

/** Each retitling `worker_send`'s previous worker title, by call key: from the spawn, an earlier send or the server's details. */
fun workerTitlesBeforeSend(rows: List<ChatRow>, workers: List<WorkerSummary>): Map<String, String> {
    val current = mutableMapOf<String, String>()
    val before = mutableMapOf<String, String>()
    rows.flatMap { it.parts }.filter { it.kind == "tool" }.forEach { part ->
        val args = part.arguments.record()
        val title = args?.s("title")?.takeIf(String::isNotEmpty)
        if (part.name == "worker_spawn") {
            val id = workers.firstOrNull { it.spawnedByCallId != null && part.key == "call-${it.spawnedByCallId}" }?.id ?: args?.s("id")?.takeIf(String::isNotEmpty)
            if (id != null && title != null) current[id] = title
            return@forEach
        }
        if (part.name != "worker_send") return@forEach
        val id = args?.s("id")?.takeIf(String::isNotEmpty) ?: return@forEach
        if (title == null) return@forEach
        val told = part.details.record()?.s("previousTitle")?.takeIf(String::isNotEmpty) ?: current[id]
        if (told != null) before[part.key] = told
        current[id] = title
    }
    return before
}

/** "Scheduled task" for a worker a schedule started whose schedule this screen does not know by name. */
fun workerScheduleLabel(scheduleId: String?, title: String?): String? = if (scheduleId.isNullOrEmpty()) null else title?.takeIf(String::isNotEmpty) ?: "Scheduled task"

@Composable internal fun WorkerCallCard(part: ChatPart, worker: WorkerSummary, previousTitle: String?, scheduleTitle: String?, onOpen: (() -> Unit)?) {
    val sent = workerSendLine(part, previousTitle)
    val schedule = workerScheduleLabel(worker.scheduleId, scheduleTitle)
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(Jarvis.colors.surface.copy(alpha = .6f)).border(1.dp, Jarvis.colors.border, shape)
            .then(if (onOpen != null) Modifier.clickable(role = Role.Button, onClickLabel = "Open the worker's transcript", onClick = onOpen) else Modifier)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(Jarvis.colors.accent2.copy(alpha = .12f)), contentAlignment = Alignment.Center) {
            LucideGlyph(ChatIcons.Bot, size = 14.dp, tint = Jarvis.colors.accent2)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(worker.title.ifBlank { worker.id }, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(worker.id, Modifier.widthIn(max = 112.dp), style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            sent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted) }
            Text(listOfNotNull(if (sent == null) workerToolAction(part.name) else null, workerPlace(worker), worker.model.modelId).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            schedule?.let { Text("Scheduled · $it", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        StatusBadge(worker.status, domain = "worker")
        if (onOpen != null) LucideGlyph(Lucide.ChevronRight, size = 14.dp, tint = Jarvis.colors.fgSubtle)
    }
}
