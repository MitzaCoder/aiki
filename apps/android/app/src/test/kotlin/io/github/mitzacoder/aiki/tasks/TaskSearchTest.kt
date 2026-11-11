package io.github.mitzacoder.aiki.tasks

import io.github.mitzacoder.aiki.features.tasks.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class TaskSearchTest {
    private val fixture = Json.parseToJsonElement(generateSequence(File(requireNotNull(System.getProperty("user.dir"))).absoluteFile) { it.parentFile }
        .map { File(it, "packages/protocol/test-vectors/task-search.json") }.first { it.isFile }.readText()).jsonObject
    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content
    private val documents get() = fixture.getValue("documents").jsonArray.map { entry -> entry.jsonObject.let {
        TaskSearchDocument(it.text("id"), it.text("title"), it.getValue("refs").jsonArray.map { ref -> ref.jsonPrimitive.content }, it.text("body"), it["parent"]?.jsonPrimitive?.content)
    } }

    @Test fun sharedFuzzyRanges() {
        for (entry in fixture.getValue("fuzzy").jsonArray) {
            val case = entry.jsonObject
            val expected = case["ranges"].takeUnless { it == JsonNull }?.jsonArray?.map { range -> range.jsonArray.let { SearchRange(it[0].jsonPrimitive.int, it[1].jsonPrimitive.int) } }
            val match = fuzzyMatch(case.text("text"), case.text("query"))
            assertEquals(case.toString(), expected, match?.ranges)
            if (case["score"] != JsonNull) assertEquals(case.getValue("score").jsonPrimitive.double, requireNotNull(match).score, 0.00000001)
        }
    }

    @Test fun sharedMergedRankingAndFamilyContext() {
        val index = TaskSearchIndex(); index.update(documents)
        for (entry in fixture.getValue("queries").jsonArray) {
            val case = entry.jsonObject
            val hits = index.search(case.text("query"))
            assertEquals(case.toString(), case.getValue("ids").jsonArray.map { it.jsonPrimitive.content }, hits.map { it.id })
            assertEquals(case.toString(), case.getValue("contexts").jsonArray.map { it.jsonPrimitive.content }, hits.filter { it.context }.map { it.id })
        }
    }

    @Test fun fuzzyBonuses() {
        assertTrue(fuzzyMatch("Task Search", "ts")!!.score > fuzzyMatch("tasks", "ts")!!.score)
        assertTrue(fuzzyMatch("test", "te")!!.score > fuzzyMatch("tze", "te")!!.score)
        assertTrue(fuzzyMatch("search", "sea")!!.score > fuzzyMatch("long search", "sea")!!.score)
    }

    @Test fun bm25UpdatesPrefixesAndDeletion() {
        val index = SearchBM25()
        index.set("a", "chromatic calibration"); index.set("b", "chromatic calibration with many other extra words")
        assertTrue(index.search("chromatic cal").getValue("a") > index.search("chromatic cal").getValue("b"))
        assertTrue(index.search("chromatic absent").isEmpty())
        val same = index.documents["a"]; index.set("a", "chromatic calibration"); assertSame(same, index.documents["a"])
        index.set("a", "replacement"); assertFalse(index.search("chromatic").containsKey("a"))
        index.delete("b"); assertTrue(index.search("chromatic").isEmpty())
    }

    @Test fun visibilityAndCycles() {
        val index = TaskSearchIndex(); index.update(documents)
        assertEquals(listOf("T112"), index.search("telescope", setOf("T112")).map { it.id })
        assertTrue(index.search("chromatic ab").first().snippet.contains("aberration"))
        index.update(listOf(TaskSearchDocument("T1", "one", emptyList(), "", "T2"), TaskSearchDocument("T2", "two", emptyList(), "", "T1")))
        assertEquals(listOf("T2", "T1"), index.search("one").map { it.id })
        index.update(emptyList()); assertTrue(index.search("one").isEmpty())
    }

    @Test fun synthetic5000TaskBenchmark() {
        val index = TaskSearchIndex()
        val titles = listOf("Polish telescope lens", "Write the field guide", "Review night colours", "Pack the sample case")
        index.update((0 until 5000).map { at -> TaskSearchDocument("T${at + 1}", "${titles[at % 4]} $at", if (at % 17 == 0) listOf("https://github.com/example/studio/pull/${4000 + at}") else emptyList(), "Synthetic task $at. " + if (at % 5 != 0) "Inspect sample packaging and update documentation." else "Explain chromatic aberration and calibration in the field guide.") })
        val queries = listOf("t", "te", "tel", "tele", "teles", "telescope", "chromatic ab", "#4316", "112", "xyz")
        repeat(8) { queries.forEach { index.search(it) } }
        val times = (0 until 20).flatMap { queries.map { query -> val start = System.nanoTime(); index.search(query); (System.nanoTime() - start) / 1_000_000.0 } }.sorted()
        println("T114 5000 tasks JVM median=${times[times.size / 2]}ms p95=${times[(times.size * .95).toInt()]}ms max=${times.last()}ms")
    }
}
