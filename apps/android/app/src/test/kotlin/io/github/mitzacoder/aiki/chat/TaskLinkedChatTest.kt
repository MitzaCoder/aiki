package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.protocol.EntryRecord
import io.github.mitzacoder.aiki.protocol.ModelRef
import io.github.mitzacoder.aiki.protocol.WorkerSummary
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/**
 * The task-linked chat: `[board]` notes and `board` calls in words (apps/web/test/board.test.ts), tool headlines
 * (tools.test.ts), steps rows and coding headers (transcript.test.ts), worker sends and check-ins (workers.test.ts).
 */
class TaskLinkedChatTest {
    @Test fun boardNotesReadAsASummaryAndTheWholeNote() {
        assertEquals(BoardNotice("You answered Q2: ship it", "You answered Q2: ship it\nT4 unblocked"), parseBoardNotice("[board] You answered Q2: ship it\nT4 unblocked"))
        assertEquals("You answered Q1 (\"Which db?\"): pg", parseBoardNotice("[board] The user answered Q1 (\"Which db?\"): pg")?.summary)
        assertEquals("You changed the board:\n- T1 done", parseBoardNotice("[board] The user changed the board:\n- T1 done")?.body)
        assertEquals(BoardNotice("", ""), parseBoardNotice("[board]"))
        assertNull(parseBoardNotice("[boardroom] hello"))
        assertNull(parseBoardNotice("please [board] this"))
    }

    @Test fun aLineThatOnlyIntroducesAListCarriesItsFirstChange() {
        assertEquals(BoardNotice("You changed the board: T16 done", "You changed the board:\n- T16 done\n- T4 review"), parseBoardNotice("[board] The user changed the board:\n- T16 done\n- T4 review"))
        assertEquals("You changed the board:", parseBoardNotice("[board] The user changed the board:\nfor the better")?.summary)
        assertEquals("Something to say:", parseBoardNotice("[board] Something to say:")?.summary)
    }

    private fun args(vararg pairs: Pair<String, Any>) = buildJsonObject {
        pairs.forEach { (key, value) -> when (value) { is String -> put(key, value); is List<*> -> putJsonArray(key) { value.forEach { add(it.toString()) } }; else -> put(key, value.toString()) } }
    }

    @Test fun boardCallsReadAsOneLine() {
        assertEquals(BoardCallView("Updated the report on T3 · First version merged"), boardCallView(args("action" to "write_report", "id" to "T3", "milestone" to "First version merged"), null))
        assertEquals("Updated the report on T3", boardCallView(args("action" to "write_report", "id" to "T3"), null)?.summary)
        assertEquals("Opened T3", boardCallView(args("action" to "show_task", "id" to "T3"), null)?.summary)
        assertEquals("Added T4 · Fix parser recovery", boardCallView(args("action" to "add_task", "title" to "Fix parser recovery"), "Added T4 (r1).")?.summary)
        assertEquals("Updated T4 → review", boardCallView(args("action" to "update_task", "id" to "T4", "status" to "review"), null)?.summary)
        assertEquals("Updated T3 · New", boardCallView(args("action" to "update_task", "id" to "T3", "title" to "New"), null)?.summary)
        assertEquals("Dropped T2", boardCallView(args("action" to "drop_task", "id" to "T2"), "Updated T2 (now r3, dropped).")?.summary)
        assertEquals(BoardCallView("Asked Q2 · Which db?", "Which db?"), boardCallView(args("action" to "ask", "text" to "Which db?", "options" to listOf("pg")), "Asked Q2. The user's answer arrives as a [board] message."))
        assertEquals("Resolved Q2", boardCallView(args("action" to "resolve_question", "id" to "Q2"), "Q2 is answered.")?.summary)
        assertEquals(BoardCallView("Decided D3 · Use pg", "Team knows it"), boardCallView(args("action" to "decide", "text" to "Use pg", "why" to "Team knows it"), "Recorded D3."))
        assertEquals("Listed the board", boardCallView(args("action" to "list"), null)?.summary)
        assertEquals("Added T9 · Nested", boardCallView(JsonPrimitive("""{"action":"add_task","title":"Nested"}"""), "Added T9 (r1).")?.summary)
        assertNull(boardCallView(null, null))
        assertNull(boardCallView(args("frobnicate" to "1"), null))
        assertNull(boardCallView(args("action" to "zzz"), null))
    }

    @Test fun toolHeadlinesReadAsWhatTheToolDid() {
        assertEquals("Saved a schedule", toolHeadline("schedule_save"))
        assertEquals("Listed the schedules", toolHeadline("schedule_list"))
        assertEquals("Started a scheduled run", toolHeadline("schedule_run"))
        assertEquals("Started a worker", toolHeadline("worker_spawn"))
        assertEquals("Forgot a worker", toolHeadline("worker_forget"))
        assertEquals("Web search", toolHeadline("web_search"))
        assertEquals("Mcp task get", toolHeadline("mcp.task-get"))
        for (name in listOf("bash", "read", "edit", "write", "")) assertNull(toolHeadline(name))
    }

    private fun call(key: String, name: String, status: String = "done", arguments: JsonElement? = null, details: JsonElement? = null) = ChatPart("call-$key", "tool", name = name, status = status, arguments = arguments, details = details)

    @Test fun aRunOfOtherCallsFoldsIntoStepsAndALoneCallStaysACard() {
        val rows = groupParts(listOf(ChatPart("t", "text", "Doing it."), call("a", "schedule_save"), call("b", "board"), call("c", "worker_spawn"), ChatPart("u", "text", "Done."), call("d", "board"), call("e", "bash"), call("f", "read")))
        assertEquals(listOf(1, 3, 1, 1, 2), rows.map { it.parts.size })
        assertEquals(listOf(false, true, false, false, false), rows.map { it.isSteps })
        val summary = stepsGroupSummary(listOf(call("a", "schedule_save"), call("b", "board", status = "error"), call("c", "worker_spawn", status = "running")))
        assertEquals(CallGroupSummary("running", "3 steps", "1 running · 1 failed"), summary)
        assertEquals(CallGroupSummary("done", "2 steps"), stepsGroupSummary(listOf(call("a", "board"), call("b", "board"))))
    }

    @Test fun codingHeadersSayWhatWasDoneInWords() {
        val parts = listOf(call("a", "bash"), call("b", "bash"), ChatPart("t", "thinking", "hm"), call("c", "read"), call("d", "edit", status = "error"))
        assertEquals(CallGroupSummary("failed", "Ran 2 commands, read 1 file, edited 1 file · 1 thought", "1 failed"), codingGroupSummary(parts))
        assertEquals("Reading 1 file", codingGroupSummary(listOf(call("r", "read", status = "running"))).label)
    }

    private fun worker(id: String, title: String, spawnedBy: String? = null) = WorkerSummary(id = id, title = title, status = "running", model = ModelRef(provider = "anthropic", modelId = "claude"), thinkingLevel = null,
        isolation = "shared", workspacePath = null, conversationId = 1, spawnedByCallId = spawnedBy, createdAt = "2026-11-01T00:00:00Z", updatedAt = "2026-11-01T00:00:00Z", lastReport = null, failure = null)

    @Test fun aWorkerSendThatRetitlesKnowsTheOldTitle() {
        val workers = listOf(worker("w1", "Fix the login", spawnedBy = "c1"))
        val rows = listOf(
            call("c1", "worker_spawn", arguments = args("title" to "Build the board", "brief" to "…")),
            call("c2", "worker_send", arguments = args("id" to "w1", "message" to "next", "title" to "Fix the board")),
            call("c3", "worker_send", arguments = args("id" to "w1", "message" to "plain")),
            call("c4", "worker_send", arguments = args("id" to "w1", "message" to "next", "title" to "Fix the login")),
            call("c5", "worker_send", arguments = args("id" to "w9", "message" to "x", "title" to "New")),
            call("c6", "worker_send", arguments = args("id" to "w8", "message" to "x", "title" to "Newer"), details = args("previousTitle" to "Older")),
        ).map { ChatRow(it.key, listOf(it)) }
        val before = workerTitlesBeforeSend(rows, workers)
        assertEquals("Build the board", before["call-c2"])
        assertFalse("call-c3" in before)
        assertEquals("Fix the board", before["call-c4"])
        assertFalse("call-c5" in before)
        assertEquals("Older", before["call-c6"])
        val send = call("c2", "worker_send", arguments = args("id" to "w1", "message" to "m", "title" to "Fix the board"))
        assertEquals("Retitled Build the board → Fix the board and sent a message", workerSendLine(send, "Build the board"))
        assertEquals("Sent Fix the board a new task", workerSendLine(send, null))
        assertEquals("Sent Fix the board a new task", workerSendLine(send, "Fix the board"))
        assertNull(workerSendLine(call("c3", "worker_send", arguments = args("id" to "w1", "message" to "m")), "x"))
        assertNull(workerSendLine(call("c1", "worker_stop", arguments = args("id" to "w1", "title" to "x")), "y"))
        assertEquals("Scheduled task", workerScheduleLabel("s1", null))
        assertEquals("Nightly", workerScheduleLabel("s1", "Nightly"))
        assertNull(workerScheduleLabel(null, "Nightly"))
    }

    @Test fun checkInsAndReportsAreRecognised() {
        assertEquals("2 workers are still running. Decide whether any is stuck.\n\nalpha — Fix the parser\nstatus: running",
            parseCheckIn("[check-in]\n2 workers are still running. Decide whether any is stuck.\n\nalpha — Fix the parser\nstatus: running"))
        assertNull(parseCheckIn("[check-in] please"))
        assertNull(parseCheckIn("Hello"))
        assertEquals(listOf("t-1" to "OpenTelemetry metrics"), checkInThreads("thread t-1 — OpenTelemetry metrics\nstatus: running"))
        assertEquals("## Report  \nOutcome: done  \nFiles changed: none  ", reportMarkdown("## Report\nOutcome: done\nFiles changed: none"))
        assertEquals("before  \n\nafter  \n", reportMarkdown("before\n\nafter\n"))
        assertEquals("```\na\nb\n```", reportMarkdown("```\na\nb\n```"))
    }

    private fun user(id: Long, text: String) = EntryRecord(id, 1, "pi.user", listOf(buildJsonObject { put("role", "user"); put("content", text); put("timestamp", id) }))

    @Test fun harnessInputsBecomeTaskLinesNotUserMessages() {
        val rows = transcript(listOf(
            user(1, "[board] You edited T4 (status: todo → blocked)"), user(2, "[worker w1 reported]\nDone"), user(3, "[check-in]\ntask T3: 42m in progress"),
            user(4, "[thread t1 finished] All good"), user(5, "[check-in] please"), user(6, "hello"),
        ), null)
        assertEquals(listOf("notice", "notice", "notice", "notice", "user", "user"), rows.map { it.parts.single().kind })
        assertEquals(listOf(true, true, true, true, false, false), rows.map(::isTaskLineRow))
        assertEquals(5L, rows[4].parts.single().timestamp)
    }

    @Test fun aTurnFooterSitsOnTheTurnsLastRow() {
        fun assistant(id: Long, content: String, at: Long) = EntryRecord(id, 1, "pi.assistant", listOf(Json.parseToJsonElement("""{"role":"assistant","model":"m1","timestamp":$at,"content":$content,"usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"cost":{"total":0.002}}}""")))
        val rows = transcript(listOf(
            user(1, "go"),
            assistant(2, """[{"type":"text","text":"First."},{"type":"toolCall","id":"x","name":"board","arguments":{"action":"list"}}]""", 1_000),
            EntryRecord(3, 1, "pi.tool-result", listOf(Json.parseToJsonElement("""{"role":"toolResult","toolCallId":"x","toolName":"board","content":"ok"}"""))),
            assistant(4, """[{"type":"text","text":"Second."}]""", 9_000),
            user(5, "thanks"),
        ), null)
        assertEquals(listOf(null, null, null, "Second."), rows.take(4).map { it.turn?.text?.substringAfterLast("\n\n") })
        val turn = rows[3].turn!!
        assertEquals("First.\n\nSecond.", turn.text)
        assertEquals(1_000L, turn.timestamp); assertEquals(9_000L, turn.ended); assertEquals("m1", turn.model)
        assertEquals(TurnUsage(20.0, 10.0, 0.0, 0.0, 0.004), turn.usage)
        assertNull(rows[4].turn)
    }

    @Test fun aHighlightFindsTheEntryOrTheThreadsNewestCard() {
        val rows = transcript(listOf(
            user(1, "[thread t1 finished] First part"),
            EntryRecord(2, 1, "pi.compaction", listOf(buildJsonObject { put("role", "user"); put("content", "Summary.") })),
            user(3, "[thread t1 failed: out of disk]"),
            user(4, "hello"),
        ), null)
        assertEquals(1, highlightIndex(rows, io.github.mitzacoder.aiki.navigation.ChatHighlight.Entry(2)))
        assertEquals(3, highlightIndex(rows, io.github.mitzacoder.aiki.navigation.ChatHighlight.Entry(4)))
        assertEquals(2, highlightIndex(rows, io.github.mitzacoder.aiki.navigation.ChatHighlight.Thread("t1")))
        assertEquals(-1, highlightIndex(rows, io.github.mitzacoder.aiki.navigation.ChatHighlight.Thread("t9")))
        assertEquals(-1, highlightIndex(rows, io.github.mitzacoder.aiki.navigation.ChatHighlight.Entry(99)))
    }
}
