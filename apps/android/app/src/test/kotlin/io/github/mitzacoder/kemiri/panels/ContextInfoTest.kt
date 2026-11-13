package io.github.mitzacoder.kemiri.panels

import io.github.mitzacoder.kemiri.features.panels.*
import io.github.mitzacoder.kemiri.protocol.*
import org.junit.Assert.*
import org.junit.Test

/** The Info tab's usage block, tool groups and overview; mirrors the web's `context-usage.test.ts` and `context.test.ts`. */
class ContextInfoTest {
    private val now = java.time.Instant.parse("2026-11-05T12:00:00.000Z").toEpochMilli()

    private fun usage(
        contextTokens: Long? = 40_000, contextWindow: Long? = 200_000, backgroundAt: Long? = 70_000, blockingAt: Long? = 100_000,
        compactions: Long = 0, lastCompactionAt: String? = null,
    ) = ContextUsage(contextTokens = contextTokens, contextWindow = contextWindow, backgroundAt = backgroundAt, blockingAt = blockingAt,
        compactions = compactions, lastCompactionAt = lastCompactionAt, compacting = false)

    private fun tool(name: String, extension: String? = null) = ToolInfo(name = name, description = "", extension = extension)
    private fun skill(name: String, read: Boolean = false, scope: String = "global", source: String? = null, description: String = "") =
        SkillInfo(name = name, description = description, path = "/skills/$name/SKILL.md", scope = scope, source = source, read = read)

    @Test fun usagePercentIsTheFilledFractionClamped() {
        assertEquals(25.0, usagePercent(50_000, 200_000)!!, 0.0)
        assertEquals(33.3, usagePercent(1, 3)!!, 0.0)
        assertEquals(0.0, usagePercent(0, 200_000)!!, 0.0)
        assertEquals(100.0, usagePercent(250_000, 200_000)!!, 0.0)
        assertNull(usagePercent(1_000, null))
        assertNull(usagePercent(1_000, 0))
    }

    @Test fun fillsTheBarAndMarksBothThresholds() {
        val view = contextUsageView(usage(), now)
        assertTrue(view.measured)
        assertEquals(20.0, view.percent, 0.0)
        assertEquals("20%", view.percentLabel)
        assertEquals("40k / 200k", view.tokensLabel)
        assertEquals(35.0, view.backgroundPercent!!, 0.0)
        assertEquals(50.0, view.blockingPercent!!, 0.0)
        assertEquals("background at 70k · blocking at 100k", view.thresholdsLabel)
        assertEquals("15.2k / 400k", contextUsageView(usage(contextTokens = 15_209, contextWindow = 400_000), now).tokensLabel)
    }

    @Test fun startsEmptyBeforeTheFirstAnswerAndLeavesNumbersOutWithoutAModel() {
        val first = contextUsageView(usage(contextTokens = null), now)
        assertEquals(0.0, first.percent, 0.0)
        assertEquals("— / 200k", first.tokensLabel)
        val none = contextUsageView(usage(contextTokens = null, contextWindow = null, backgroundAt = null, blockingAt = null), now)
        assertFalse(none.measured)
        assertEquals("—", none.tokensLabel)
        assertEquals("", none.percentLabel)
        assertNull(none.backgroundPercent)
        assertEquals("", none.thresholdsLabel)
    }

    @Test fun countsCompactionsAndSaysWhenTheLastWas() {
        assertEquals("No compactions yet", contextUsageView(usage(), now).compactionsLabel)
        assertEquals("1 compaction", contextUsageView(usage(compactions = 1), now).compactionsLabel)
        val view = contextUsageView(usage(compactions = 3, lastCompactionAt = "2026-11-05T11:55:00.000Z"), now)
        assertEquals("3 compactions · last 5 min ago", view.compactionsLabel)
        assertNotNull(view.lastCompactionTitle)
        assertEquals("2 compactions", contextUsageView(usage(compactions = 2), now).compactionsLabel)
    }

    @Test fun groupsBuiltInsFirstThenExtensionsByLabel() {
        val groups = groupTools(listOf(
            tool("worker_stop", "worker-tools"), tool("read"), tool("worker_spawn", "worker-tools"), tool("apply_patch"), tool("memory_search", "memory"),
        ))
        assertEquals(listOf("Built-in" to listOf("apply_patch", "read"), "Memory" to listOf("memory_search"), "Workers" to listOf("worker_spawn", "worker_stop")),
            groups.map { group -> group.label to group.tools.map { it.name } })
        assertEquals(emptyList<ToolGroup>(), groupTools(emptyList()))
        assertEquals(listOf("worker_spawn"), filterTools(listOf(tool("worker_spawn", "worker-tools"), tool("read")), "worker").map { it.name })
        assertEquals(listOf("read"), filterTools(listOf(tool("worker_spawn", "worker-tools"), tool("read")), "built-in").map { it.name })
    }

    @Test fun namesToolGroupsInWords() {
        assertEquals("Coding", toolGroupLabel("coding-tools"))
        assertEquals("Workers", toolGroupLabel("worker-tools"))
        assertEquals("Context", toolGroupLabel("aiki-agent-context"))
        assertEquals("Memory tools", toolGroupLabel("memory-tools"))
        assertEquals("Acme ticket worker", toolGroupLabel("acme.ticket_worker"))
    }

    @Test fun overviewSaysZeroSkillsPlainlyAndCountsToolGroups() {
        val context = ConversationContext(
            projectId = "p", workerId = null, cwd = "/p", projectPath = "/p", homeDir = "/home/u", systemPrompt = "x".repeat(4000),
            tools = listOf(tool("read"), tool("bash"), tool("memory_search", "memory-tools")), contextFiles = emptyList(), skills = emptyList(),
        )
        val overview = contextOverview(context)
        assertEquals(listOf("AGENTS.md files", "skills read", "tools", "system prompt"), overview.map { it.label })
        assertEquals("0", overview[1].value)
        assertEquals("3", overview[2].value)
        assertEquals("2 groups", overview[2].detail)
        assertEquals("4.0 KB", overview[3].value)
        assertEquals(listOf("840 B", "2.0 KB", "20.5 KB", "120 KB"), listOf(840L, 2048L, 20_480L, 120_000L).map(::contextBytes))
        assertEquals("~1.0k tokens", overview[3].detail)
    }

    @Test fun separatesTheReadSkillsFromTheRestEachByName() {
        val groups = skillGroups(listOf(skill("beta"), skill("zebra", read = true), skill("alpha-skill"), skill("alpha", read = true)))
        assertEquals(listOf("alpha", "zebra"), groups.read.map { it.name })
        assertEquals(listOf("alpha-skill", "beta"), groups.available.map { it.name })
    }

    @Test fun putsGlobalBeforeProjectSortsByNameAndLeavesOutAnEmptyScope() {
        val project = skill("deploy", scope = "project")
        assertEquals(listOf("Global" to listOf("alpha", "zeta"), "Project" to listOf("deploy")),
            skillScopeGroups(listOf(skill("zeta"), project, skill("alpha"))).map { it.label to it.skills.map { entry -> entry.name } })
        assertEquals(listOf("Project"), skillScopeGroups(listOf(project)).map { it.label })
    }

    @Test fun readsAMissingSourceAsPis() {
        assertEquals("pi", skillSource(skill("a")))
        assertEquals("harness", skillSource(skill("a", source = "harness")))
        assertEquals(listOf("Harness", "pi", "Claude"), listOf("harness", "pi", "claude").map(::skillSourceLabel))
    }

    @Test fun groupsBySourceHarnessThenPiThenClaudeEachGlobalBeforeProject() {
        val groups = skillSourceGroups(listOf(
            skill("claude-project", source = "claude", scope = "project"),
            skill("pi-global", source = "pi"),
            skill("claude-global", source = "claude"),
            skill("harness-project", source = "harness", scope = "project"),
            skill("pi-project", source = "pi", scope = "project"),
        ))
        assertEquals(listOf(
            Triple("Harness", listOf("harness-project"), listOf("Project" to listOf("harness-project"))),
            Triple("pi", listOf("pi-global", "pi-project"), listOf("Global" to listOf("pi-global"), "Project" to listOf("pi-project"))),
            Triple("Claude", listOf("claude-global", "claude-project"), listOf("Global" to listOf("claude-global"), "Project" to listOf("claude-project"))),
        ), groups.map { group -> Triple(group.label, group.skills.map { it.name }, group.scopes.map { scope -> scope.label to scope.skills.map { it.name } }) })
        assertEquals(listOf("Claude"), skillSourceGroups(listOf(skill("b", source = "claude"), skill("a", source = "claude"))).map { it.label })
    }

    @Test fun matchesSkillsOnNameDescriptionScopeAndSource() {
        val skills = listOf(
            skill("deploy", description = "Ship the app."),
            skill("jira", description = "Work with tickets.", scope = "project"),
            skill("chrome-cdp", description = "Debug Chrome."),
        )
        assertEquals(listOf("chrome-cdp"), filterSkills(skills, "chro").map { it.name })
        assertEquals(listOf("jira"), filterSkills(skills, "TICKETS").map { it.name })
        assertEquals(listOf("jira"), filterSkills(skills, "project").map { it.name })
        assertEquals(3, filterSkills(skills, "  ").size)
        assertEquals(listOf("two"), filterSkills(listOf(skill("one", source = "harness", description = "Harness skill."),
            skill("two", source = "claude", description = "Claude skill.", scope = "project")), "claude").map { it.name })
    }
}
