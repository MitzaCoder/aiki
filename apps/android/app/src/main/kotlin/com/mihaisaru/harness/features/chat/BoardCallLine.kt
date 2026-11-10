package com.mihaisaru.harness.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.protocol.BOARD_PREFIX
import com.mihaisaru.harness.features.tasks.isBoardMessage
import com.mihaisaru.harness.navigation.*
import com.mihaisaru.harness.ui.components.*
import com.mihaisaru.harness.ui.theme.Jarvis
import kotlinx.serialization.json.*

/*
 * The transcript's one-line cards for the coordinator's `board` calls and the harness' `[board]` notes. The wording is
 * ported from `apps/web/src/lib/board.ts` (`boardCallView`, `parseBoardNotice`) with its tests (BoardCallLineTest).
 */

data class BoardNotice(val summary: String, val body: String)

/** A `[board]` note the harness posted: what changed, addressed to the reader (the notes say "The user" to the model). */
fun parseBoardNotice(text: String): BoardNotice? {
    if (!isBoardMessage(text)) return null
    val rest = text.trimStart().substring(BOARD_PREFIX.length).trim().replace(Regex("^The user (answered|changed) "), "You $1 ")
    val lines = rest.split("\n")
    val summary = lines.first().trim()
    // "You changed the board:" on its own says nothing; the list under it does, so the line carries its first change.
    if (summary.endsWith(":")) {
        val first = lines.drop(1).firstOrNull { it.isNotBlank() }?.trim()
        val change = first?.replace(Regex("^[-*]\\s+"), "")?.trim()
        if (!change.isNullOrEmpty() && first != change) return BoardNotice("$summary $change", rest)
    }
    return BoardNotice(summary, rest)
}

/** A `board` call as one line ("Added T4 · Fix parser recovery") and the longer text it opens to. */
data class BoardCallView(val summary: String, val detail: String? = null)

private fun JsonObject.firstString(vararg keys: String): String? = keys.firstNotNullOfOrNull { key -> (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.takeIf(String::isNotEmpty) }
private fun clip(text: String, length: Int = 90): String {
    val line = markdownText(text)
    return if (line.length > length) line.take(length - 1) + "…" else line
}

/** Null for an unknown action: the generic card shows the call as it is. */
fun boardCallView(arguments: JsonElement?, output: String?): BoardCallView? {
    val args = arguments.record() ?: return null
    fun outputId(prefix: String) = Regex("\\b($prefix\\d+)\\b").find(output.orEmpty())?.groupValues?.get(1)
    val id = args.firstString("id")
    val title = args.firstString("title")
    val text = args.firstString("text")
    val status = args.firstString("status")
    fun withTitle(head: String, shown: String?) = if (shown == null) head else "$head · ${clip(shown)}"
    return when (args.firstString("action")) {
        "list" -> BoardCallView("Listed the board")
        "add_task" -> BoardCallView(withTitle("Added ${outputId("T") ?: "a task"}", title), args.firstString("description"))
        "update_task" -> {
            val head = "Updated ${id ?: outputId("T") ?: "a task"}"
            BoardCallView(if (status == null) withTitle(head, title) else "$head → ${status.replace('_', ' ')}", args.firstString("blockedReason", "description"))
        }
        "drop_task" -> BoardCallView("Dropped ${id ?: outputId("T") ?: "a task"}")
        "ask" -> BoardCallView(withTitle("Asked ${outputId("Q") ?: "a question"}", text), text)
        "resolve_question" -> BoardCallView("Resolved ${id ?: outputId("Q") ?: "a question"}", args.firstString("answer"))
        "write_report" -> BoardCallView(withTitle("Updated the report on ${id ?: "a task"}", args.firstString("milestone")))
        "show_task" -> BoardCallView("Opened ${id ?: "a task"}")
        "claim" -> BoardCallView("Claimed ${id ?: outputId("T") ?: "a task"}")
        "release" -> BoardCallView("Released ${id ?: outputId("T") ?: "a task"}")
        "handoff" -> {
            val to = args.firstString("toThread")
            val head = "Handed ${id ?: outputId("T") ?: "a task"} over"
            BoardCallView(if (to == null) head else "$head to $to", args.firstString("note", "message", "why"))
        }
        "decide" -> BoardCallView(withTitle("Decided ${outputId("D").orEmpty()}".trimEnd(), text), args.firstString("why"))
        else -> null
    }
}

/**
 * One `board` call as a single line; it opens into the longer text when there is some, and an error stays collapsed
 * and red, like every tool card. Task IDs in the line are task pills that open the task.
 */
@Composable internal fun BoardCallLine(part: ChatPart, view: BoardCallView, context: ProjectScreenContext?) {
    val failed = part.status in setOf("error", "exited")
    val details: @Composable ColumnScope.() -> Unit = {
        if (failed) Text(part.text.ifBlank { "The board tool failed." }, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.danger)
        else {
            view.detail?.let { com.mihaisaru.harness.features.tasks.BoardMarkdown(it) }
            if (context != null) TextButton(onClick = { context.navigate(Destination.Panel(context.route, PanelTab.Board)) }, contentPadding = PaddingValues(0.dp)) { Text("Open the Board") }
        }
    }
    TaskLine(
        stateKey = part.key,
        icon = ChatIcons.ClipboardList,
        tone = if (failed) TaskLineTone.Failed else TaskLineTone.Tool,
        trailing = { CallStateIcon(part) },
        details = if (failed || view.detail != null || context != null) details else null,
    ) { TaskText(view.summary, Modifier.weight(1f, fill = false), strong = true) }
}
