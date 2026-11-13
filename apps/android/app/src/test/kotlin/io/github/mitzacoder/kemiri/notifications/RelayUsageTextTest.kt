package io.github.mitzacoder.kemiri.notifications

import io.github.mitzacoder.kemiri.features.notifications.relay.*
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.*
import org.junit.Test

class RelayUsageTextTest {
    @Test fun summaryContainsOnlyTheAccountsDailyAllowance() {
        val quotas = listOf("accountDay", "accountMinute", "ipDay", "relaySendDay").map {
            RelayQuota("synthetic", it, 42, 0)
        }
        assertEquals(listOf("accountDay"), relayVisibleQuotas(quotas, false).map { it.budget })
        assertEquals(quotas, relayVisibleQuotas(quotas, true))
        assertTrue(relayVisibleQuotas(emptyList(), false).isEmpty())
    }

    @Test fun resetTodayUsesOnlyALocalTime() {
        val now = Instant.parse("2026-11-10T10:00:00Z").toEpochMilli()
        val reset = Instant.parse("2026-11-10T12:00:00Z").toEpochMilli()
        assertEquals("resets at 2:00 PM", relayQuotaResetText(reset, now, ZoneId.of("+02:00"), Locale.US))
    }

    @Test fun resetTomorrowSaysTomorrowWithoutAFullDate() {
        val now = Instant.parse("2026-11-10T20:00:00Z").toEpochMilli()
        val reset = Instant.parse("2026-11-11T00:00:00Z").toEpochMilli()
        assertEquals("resets tomorrow at 2:00 AM", relayQuotaResetText(reset, now, ZoneId.of("+02:00"), Locale.US))
    }
}
