package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** The web's `memory-tools.test.ts` cases: the card parses the tools' prose back into hits, sections and matches. */
class MemoryCallsTest {
    private fun part(name: String, args: Map<String, Any>, output: String, details: JsonObject? = null, status: String = "done") =
        ChatPart("p0", "tool", output, name, status, buildJsonObject {
            args.forEach { (key, value) -> when (value) { is String -> put(key, value); is List<*> -> put(key, JsonArray(value.map { JsonPrimitive(it as String) })) } }
        }, details)

    @Test fun searchReadsHitsHeadingsScopesAndHighlightedSnippets() {
        val output = listOf(
            "project:testing — Testing conventions (section \"Deploy\", rank 0.93)",
            "  Run \u0002bun test\u0003 from the root; it takes 12s.",
            "",
            "global:workflow — How I work (intro, rank 0.41)",
            "  Prefer small commits and a \u0002short\u0003 review loop.",
        ).joinToString("\n")
        val view = memoryCallView(part("memory_search", mapOf("query" to "compaction thresholds"), output, buildJsonObject { put("hits", 2) })) as MemoryCallView.Search
        assertEquals("Searched memory for “compaction thresholds” · 2 matches", view.summary)
        assertEquals("both", view.scope)
        assertEquals(2, view.hits.size)
        with(view.hits[0]) { assertEquals(listOf("project", "testing", "Testing conventions", "Deploy"), listOf(scope, fileId, title, heading)); assertEquals(0.93, rank!!, 0.0) }
        assertEquals(listOf("bun test"), view.hits[0].parts.filter { it.match }.map { it.text })
        assertEquals("global", view.hits[1].scope)
        assertNull(view.hits[1].heading)
    }

    @Test fun hitsReadAsTheServerWritesThem() {
        val output = "project:testing — Testing conventions (\"Deploy\", rank -1.25)\n  Run `bun test` from the root.\n\nglobal:workflow — How I work (intro, rank -0.00)\n  Prefer small commits."
        val view = memoryCallView(part("memory_search", mapOf("query" to "bun test"), output, buildJsonObject { put("hits", 2) })) as MemoryCallView.Search
        assertEquals(listOf("testing", "workflow"), view.hits.map { it.fileId })
        assertEquals(-1.25, view.hits[0].rank!!, 0.0)
        assertEquals("Deploy", view.hits[0].heading)
        assertNull(view.hits[1].heading)
        assertEquals(listOf("bun", "test"), view.hits[0].parts.filter { it.match }.map { it.text })
    }

    @Test fun anExplicitScopeAndNoMatchesReadPlainly() {
        val view = memoryCallView(part("memory_search", mapOf("query" to "nothing", "scope" to "global"), "No memory matched \"nothing\". Try other words.", buildJsonObject { put("hits", 0) })) as MemoryCallView.Search
        assertEquals("Searched memory for “nothing” · no matches", view.summary)
        assertEquals("global", view.scope)
        assertTrue(view.hits.isEmpty())
    }

    @Test fun readReadsTitleMetadataAndSections() {
        val output = listOf("project:testing — Testing conventions", "Summary: How tests are run here.", "Tags: bun, ci; status: active",
            "Updated: 2026-11-04T12:00:00.000Z", "", "## Deploy", "", "Run `bun test` from the root.", "", "## Recovery", "", "Retry once, then read the log.").joinToString("\n")
        val view = memoryCallView(part("memory_read", mapOf("fileId" to "testing", "sections" to listOf("Deploy", "Recovery")), output,
            buildJsonObject { put("scope", "project"); put("fileId", "testing") })) as MemoryCallView.Read
        assertEquals("Read testing · 2 sections", view.summary)
        assertEquals("project", view.scope)
        assertEquals("Testing conventions", view.title)
        assertEquals("How tests are run here.", view.summaryText)
        assertEquals(listOf("bun", "ci"), view.tags)
        assertEquals("active", view.status)
        assertEquals(listOf("Deploy", "Recovery"), view.sections.map { it.heading })
        assertTrue("bun test" in view.sections[0].text)
    }

    @Test fun aGlobalTopicReadsAsGlobalAndKeepsItsIntroAndLinks() {
        val output = listOf("global:workflow — How I work", "Summary: Preferences.", "Tags: none; status: active", "Links:",
            "- global:reviews: Reviews — ask early", "- testing: Testing conventions — run bun test", "", "Small commits, short reviews.", "", "## Reviews", "", "Ask for one early.").joinToString("\n")
        val view = memoryCallView(part("memory_read", mapOf("fileId" to "workflow"), output, buildJsonObject { put("scope", "global"); put("fileId", "workflow") })) as MemoryCallView.Read
        assertEquals("global", view.scope)
        assertTrue(view.tags.isEmpty())
        assertTrue("Small commits" in view.intro)
        assertEquals(1, view.sections.size)
        assertEquals(listOf("global" to "reviews", "global" to "testing"), view.links.map { it.scope to it.fileId })
    }

    @Test fun writesSayWhatHappened() {
        val text = "Run `bun test` from the root."
        val created = memoryCallView(part("memory_write", mapOf("fileId" to "testing", "heading" to "Deploy", "text" to text, "title" to "Testing"),
            "Created project:testing — \"Testing\", 2 sections. Commit abc. It is searchable now.", buildJsonObject { put("scope", "project"); put("fileId", "testing"); put("created", true) })) as MemoryCallView.Write
        assertEquals("Created testing › Deploy", created.summary)
        assertEquals("created", created.outcome)
        assertEquals(text, created.text)
        assertEquals("project", created.scope)
        val updated = memoryCallView(part("memory_write", mapOf("fileId" to "testing", "heading" to "Deploy", "text" to text),
            "Updated section \"Deploy\" of project:testing, 2 sections in all. Commit abc.", buildJsonObject { put("scope", "project"); put("fileId", "testing"); put("created", false) }))
        assertEquals("Saved to testing › Deploy", updated.summary)
        assertEquals("Saved to testing", memoryCallView(part("memory_write", mapOf("fileId" to "testing", "text" to text), "Updated the intro of project:testing, 2 sections in all.")).summary)
        val unchanged = memoryCallView(part("memory_write", mapOf("fileId" to "testing", "heading" to "Deploy", "text" to text), "project:testing already reads that way; nothing was written.")) as MemoryCallView.Write
        assertEquals("No change to testing › Deploy", unchanged.summary)
        assertEquals("unchanged", unchanged.outcome)
    }

    @Test fun closeMatchesNameTheirTopics() {
        val output = listOf("Memory close to project:testing already exists, so nothing was created. Update one of these instead:",
            "- project:testing-old — Testing old, section \"Deploy\": run it from the root", "- global:testing — Testing: run it", "",
            "Call memory_write again with one of those fileIds (and its scope), or pass create: true to start project:testing anyway.").joinToString("\n")
        val view = memoryCallView(part("memory_write", mapOf("fileId" to "testing", "heading" to "Deploy", "text" to "x"), output, buildJsonObject { put("created", false); put("matches", 2) })) as MemoryCallView.Write
        assertEquals("Didn't create testing · 2 close matches", view.summary)
        assertEquals("suggested", view.outcome)
        assertEquals(2, view.closeMatches.size)
        with(view.closeMatches[0]) { assertEquals(listOf("project", "testing-old", "Testing old", "Deploy"), listOf(scope, fileId, title, heading)) }
        with(view.closeMatches[1]) { assertEquals("global", scope); assertNull(heading) }
    }

    @Test fun archiveShowsTheTopicAndItsReason() {
        val view = memoryCallView(part("memory_archive", mapOf("fileId" to "old-notes", "reason" to "superseded by testing"), "Archived project:old-notes. It leaves search and the catalog; includeArchived still finds it.")) as MemoryCallView.Archive
        assertEquals("Archived old-notes — superseded by testing", view.summary)
        assertEquals("superseded by testing", view.reason)
        assertEquals("project", view.scope)
        val bare = memoryCallView(part("memory_archive", mapOf("fileId" to "old-notes"), "Archived project:old-notes.")) as MemoryCallView.Archive
        assertEquals("Archived old-notes", bare.summary)
        assertNull(bare.reason)
    }

    @Test fun snippetHighlighting() {
        assertEquals(listOf("Compaction", "thresholds", "tests"),
            highlightedSnippetParts("The Compaction thresholds is met; the latest tests pass.", "compaction thresholds test").filter { it.match }.map { it.text })
        assertTrue(highlightedSnippetParts("accomplish the task", "comp").none { it.match })
        assertEquals(listOf("completion"), highlightedSnippetParts("the completion", "comp").filter { it.match }.map { it.text })
        assertEquals(listOf("this"), highlightedSnippetParts("use \u0002this\u0003 now", "other").filter { it.match }.map { it.text })
        assertEquals("use this now", highlightedSnippetParts("use \u0002this\u0003 now", "other").joinToString("") { it.text })
    }

    @Test fun scopeBadgesAndErrors() {
        assertEquals(listOf("Both", "Global", "Project"), listOf("both", "global", "project").map(::memoryScopeBadge))
        val view = memoryCallView(part("memory_read", mapOf("fileId" to "missing"), "No memory \"missing\" in project or global.", status = "error"))
        assertTrue(view.isError)
        assertEquals("Memory read failed", view.summary)
        assertTrue("No memory" in view.output)
    }
}
