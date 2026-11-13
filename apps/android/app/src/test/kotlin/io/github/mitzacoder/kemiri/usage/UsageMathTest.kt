package io.github.mitzacoder.kemiri.usage

import io.github.mitzacoder.kemiri.features.usage.*
import io.github.mitzacoder.kemiri.protocol.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class UsageMathTest {
    private val end = 3600000.0
    private fun window(used: Double? = 25.0, minutes: Long? = 60, reset: String? = Instant.ofEpochMilli(end.toLong()).toString(), samples: List<UsageSample> = emptyList()) = UsageWindow("hour", "Hour", used, reset, minutes, samples)
    @Test fun unknownIsNotZeroAndReachedWins() {
        assertEquals(PaceKind.Unknown, windowPace(window(null), end / 2).kind)
        assertEquals(PaceKind.Unknown, windowPace(window(minutes = null), end / 2).kind)
        assertEquals(PaceKind.Unknown, windowPace(window(reset = "invalid"), end / 2).kind)
        assertEquals(PaceKind.Exhausted, windowPace(window(101.0, null, null), end).kind)
        assertNull(windowPace(window(), 0.0).ratio)
    }
    @Test fun exactThresholdsAndEarlyBoundary() {
        assertEquals(PaceKind.OnPace, windowPace(window(42.5), end / 2).kind)
        assertEquals(PaceKind.OnPace, windowPace(window(57.5), end / 2).kind)
        assertEquals(PaceKind.Ahead, windowPace(window(57.51), end / 2).kind)
        assertEquals(PaceTone.Warn, paceTone(windowPace(window(20.0), end * .099)))
        assertEquals(PaceTone.Danger, paceTone(windowPace(window(20.0), end * .1)))
    }
    @Test fun projectionClampsAndExpiredWindowDoesNotExhaust() {
        val p = windowPace(window(75.0), end / 2)
        assertEquals(150.0, p.projectedAtReset!!, .0001)
        assertEquals(2400000.0, p.exhaustsAt!!, .0001)
        assertEquals(100.0, projectedUsedPercent(p, end / 2, end)!!, .0001)
        assertEquals(75.0, projectedUsedPercent(p, end / 2, 0.0)!!, .0001)
        assertNull(windowPace(window(75.0), end * 2).exhaustsAt)
    }
    @Test fun chartHandlesUnknownSingleSampleAndOverLimit() {
        assertTrue(usageChart(window(null, null, null), 0.0, 300.0, 72.0).points.isEmpty())
        val w = window(120.0, samples = listOf(UsageSample("invalid", 99.0), UsageSample(Instant.ofEpochMilli(1800000).toString(), 120.0)))
        val chart = usageChart(w, end / 2, 300.0, 72.0)
        assertEquals(2, chart.points.size)
        assertEquals(0.0, chart.points.last().y, .001)
        assertEquals(12.0, chart.limitY, .001)
        assertNull(chart.projection)
        assertNull(usageChart(w, end * 2, 300.0, 72.0).nowX)
    }
    @Test fun exhaustedWithoutResetDoesNotPromiseAReset() {
        assertEquals("Used up; the provider gives no reset time.", paceDetail(windowPace(window(100.0, null, null), end)))
    }
    @Test fun labelsKeepUnknownAndSlivers() {
        assertEquals("—", percentLabel(null))
        assertEquals("<1%", percentLabel(.2))
        assertEquals("101%", percentLabel(100.5))
        assertEquals("3d 4h", formatDuration(76 * 3600000.0))
    }
}
