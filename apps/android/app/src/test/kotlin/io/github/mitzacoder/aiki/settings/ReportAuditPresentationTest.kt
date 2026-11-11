package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.features.settings.*
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ReportAuditPresentationTest {
    private val now = Instant.parse("2026-01-01T12:00:00Z").toEpochMilli()
    private val status = ProjectSummaryReportAuditStatus(effectiveModel = null, day = "2026-01-01", tokensUsed = 1240,
        lastRunAt = "2026-01-01T10:00:00Z", state = "idle", reason = "No new evidence")

    @Test fun onlyAnExplicitFeatureEnablesTheGroup() {
        assertFalse(reportAuditVisible(null))
        assertFalse(reportAuditVisible(listOf("projects", "models", "task-freshness")))
        assertTrue(reportAuditVisible(listOf("report-audit")))
    }
    @Test fun defaultsAndBudgetBounds() {
        assertEquals("auto", DEFAULT_REPORT_AUDIT_SETTINGS.mode)
        assertEquals(65000L, DEFAULT_REPORT_AUDIT_SETTINGS.dailyTokens)
        assertEquals(0L, reportAuditBudget("0"))
        assertEquals(65000L, reportAuditBudget(" 65000 "))
        assertEquals(10000000L, reportAuditBudget("10000000"))
        listOf("", "-1", "1.5", "10000001", "9999999999999999999999").forEach { assertNull(reportAuditBudget(it)) }
    }
    @Test fun usageIsReadableAndDoesNotHideOverages() {
        assertEquals("1,240 of 65,000 tokens today", reportAuditUsage(1240, 65000))
        assertEquals("100 of 0 tokens today", reportAuditUsage(100, 0))
    }
    @Test fun effectiveModelUsesCatalogAndProviderNames() {
        val ref = ModelRef(provider = "anthropic", modelId = "claude-haiku-5-5")
        val model = ModelInfo(provider = ref.provider, modelId = ref.modelId, name = "Claude Haiku 5.5", contextWindow = 200000,
            maxTokens = 100, input = listOf("text"), reasoning = false, thinkingLevels = emptyList(), configured = false)
        val provider = ProviderInfo(id = "anthropic", name = "Anthropic", configured = false)
        assertEquals("Using Claude Haiku 5.5 via Anthropic", reportAuditModel(ref, listOf(model), listOf(provider)))
        assertEquals("No model available", reportAuditModel(null, emptyList(), emptyList()))
        assertEquals("Using claude-haiku-5-5 via anthropic", reportAuditModel(ref, emptyList(), emptyList()))
    }
    @Test fun statusKeepsReasonAndLocallyFormatsLastRun() {
        assertEquals("Last run 2 h ago · No new evidence", reportAuditStatusWords(status, now))
        assertEquals("Last run 3 h ago · No new evidence", reportAuditStatusWords(status, now + 3600000))
        assertEquals("No checks run yet · No credential", reportAuditStatusWords(status.copy(state = "unavailable", lastRunAt = null, reason = "No credential"), now))
        assertEquals("Last run 2 h ago · Daily budget spent", reportAuditStatusWords(status.copy(state = "budget", reason = null), now))
        assertEquals("No checks run yet · Status not available yet", reportAuditStatusWords(null, now))
    }
}
