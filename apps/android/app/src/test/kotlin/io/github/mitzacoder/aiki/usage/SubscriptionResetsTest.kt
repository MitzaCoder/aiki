package io.github.mitzacoder.aiki.usage

import io.github.mitzacoder.aiki.features.usage.*
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test

class SubscriptionResetsTest {
    private val fable = SubscriptionResetCredit("synthetic-fable", "cedar_ember", "Fable reset", 1, true, "2027-03-09T23:59:59Z", listOf("five_hour", "seven_day_overage_included"), true)
    @Test fun matchingGrantsGroupWithOneSpendId() {
        val groups = groupResets(listOf(fable, fable.copy(id = "second"), fable.copy(id = "third")))
        assertEquals(1, groups.size)
        assertEquals(3L, groups.single().remaining)
        assertEquals("synthetic-fable", groups.single().credit.id)
    }
    @Test fun differentScopeExpiryAndUsabilityStaySeparate() {
        assertEquals(4, groupResets(listOf(fable, fable.copy(expiresAt = null), fable.copy(usable = false), fable.copy(clears = listOf("five_hour")), fable.copy(remaining = 0))).size)
    }
    @Test fun narrowerFableRefillDoesNotPromiseAFullWeeklyRefill() {
        assertEquals("This refills your 5-hour limit and your Fable allowance and gives back what Fable used on your weekly limit.", resetExplanation(fable))
        assertEquals("This refills your 5-hour limit and your weekly limit.", resetExplanation(fable.copy(clears = listOf("five_hour", "seven_day"), givesBackWeekly = false)))
    }
    @Test fun unknownExpiryAndReasonsAreReadable() {
        assertTrue(resetExpiry(fable.expiresAt, 3).startsWith("all expire "))
        assertEquals("No expiry reported", resetExpiry(null, 1))
        assertEquals("weekly limit not reached", resetUnavailableReason(fable.copy(unavailableReason = "weekly_limit_not_reached")))
        assertEquals("Not usable now", resetUnavailableReason(fable))
    }
}
