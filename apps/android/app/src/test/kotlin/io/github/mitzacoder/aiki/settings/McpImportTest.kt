package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.features.settings.*
import org.junit.Assert.*
import org.junit.Test

class McpImportTest {
    @Test fun wrappedAndBareMapsReviewCommandsHttpAndSse() {
        val map = """{"Local":{"command":"bun","args":["run","/tmp/synthetic.ts"],"cwd":"/tmp","env":{"DEMO_SECRET":"synthetic-env"}},"Remote":{"type":"http","url":"https://mcp.example.test/mcp","headers":{"Authorization":"Bearer synthetic-token"}},"Legacy":{"type":"sse","url":"https://mcp.example.test/sse"}}"""
        val rows = parseMcpImport("""{"mcpServers":$map}""", listOf("local"))
        assertEquals(3, rows.size); assertTrue(rows.all { it.error == null })
        assertEquals("local_2", rows[0].serverId); assertTrue(rows[0].renamed)
        assertEquals(listOf("run", "/tmp/synthetic.ts"), rows[0].command!!.args)
        assertEquals("synthetic-env", rows[0].env!!["DEMO_SECRET"])
        assertFalse(rows[0].target.contains("synthetic-env"))
        assertEquals("synthetic-token", rows[1].token)
        assertFalse(rows[1].target.contains("synthetic-token"))
        assertEquals("sse", rows[2].transport)
        assertEquals(3, parseMcpImport(map).size)
    }
    @Test fun invalidEntriesAreExplainedAndUncheckedWithoutEchoingSecrets() {
        listOf("null", """{"command":"bun","args":"bad"}""", """{"command":"bun","env":{"KEY":123}}""",
            """{"command":"bun","cwd":"relative"}""", """{"url":"https://mcp.example.test?token=synthetic-secret"}""",
            """{"url":"https://mcp.example.test","headers":{"x-token":"synthetic-secret"}}""").forEach { entry ->
            val row = parseMcpImport("""{"Bad":$entry}""").single()
            assertNotNull(row.error); assertFalse(row.target.contains("synthetic-secret"))
        }
    }
    @Test fun commandFormRequiresArgumentArrayAndAbsoluteCwdAndValidSecretNames() {
        assertEquals(listOf("a b", "--flag"), parseMcpCommand("bun", """["a b","--flag"]""", "/tmp").args)
        listOf("{}", "[12]", "null").forEach { args -> assertTrue(runCatching { parseMcpCommand("bun", args, "") }.isFailure) }
        assertTrue(runCatching { parseMcpCommand("bun", "[]", "relative") }.isFailure)
        assertTrue(runCatching { parseMcpEnvironment("""{"AIKI_DATA_DIR":"/tmp"}""") }.isFailure)
        assertTrue(runCatching { parseMcpEnvironment("""{"BAD-NAME":"synthetic"}""") }.isFailure)
        assertEquals(mapOf("KEY" to "synthetic"), parseMcpEnvironment("""{"KEY":"synthetic"}"""))
    }
    @Test fun malformedImportsFailBeforeAnyRowsCanBeSaved() {
        listOf("[]", "null", "{", """{"mcpServers":[]}""").forEach { assertTrue(runCatching { parseMcpImport(it) }.isFailure) }
    }
}
