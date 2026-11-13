package io.github.mitzacoder.kemiri.notifications

import io.github.mitzacoder.kemiri.features.notifications.INTERACTION_REPORT_INTERVAL_MS
import io.github.mitzacoder.kemiri.features.notifications.InteractionReporter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the web's `interaction.test.ts` for `ThrottledReporter`, on a clock the test moves. */
class InteractionReporterTest {
    private class Clock {
        var now = 1_000_000L
        private var next = 0
        private val timers = linkedMapOf<Int, Pair<Long, () -> Unit>>()
        val pending get() = timers.size
        fun schedule(delayMs: Long, run: () -> Unit): () -> Unit {
            val id = next++
            timers[id] = now + delayMs to run
            return { timers.remove(id) }
        }
        fun advance(ms: Long) {
            val end = now + ms
            while (true) {
                val due = timers.entries.filter { it.value.first <= end }.minByOrNull { it.value.first } ?: break
                timers.remove(due.key)
                now = maxOf(now, due.value.first)
                due.value.second()
            }
            now = end
        }
    }

    private fun reporter(clock: Clock, sent: MutableList<Long>) =
        InteractionReporter(clock = { clock.now }, schedule = clock::schedule, send = { sent += clock.now })

    @Test fun theFirstInteractionGoesOutAtOnce() {
        val clock = Clock(); val sent = mutableListOf<Long>()
        reporter(clock, sent).touch()
        assertEquals(1, sent.size)
        assertEquals(0, clock.pending)
    }

    @Test fun aBurstInsideTheIntervalIsOneTrailingSendAtItsEnd() {
        val clock = Clock(); val sent = mutableListOf<Long>()
        val reporter = reporter(clock, sent)
        val start = clock.now
        reporter.touch()
        repeat(200) { clock.advance(10); reporter.touch() }
        assertEquals(listOf(start), sent)
        clock.advance(INTERACTION_REPORT_INTERVAL_MS)
        assertEquals(listOf(start, start + INTERACTION_REPORT_INTERVAL_MS), sent)
        // Nothing more without more interaction.
        clock.advance(60_000)
        assertEquals(2, sent.size)
    }

    @Test fun continuousInteractionSendsOncePerIntervalNeverFaster() {
        val clock = Clock(); val sent = mutableListOf<Long>()
        val reporter = reporter(clock, sent)
        var elapsed = 0
        while (elapsed <= 30_000) { reporter.touch(); clock.advance(100); elapsed += 100 }
        assertTrue("sent ${sent.size}", sent.size in 6..7)
        sent.zipWithNext().forEach { (a, b) -> assertTrue(b - a >= INTERACTION_REPORT_INTERVAL_MS) }
    }

    @Test fun anInteractionAfterAQuietSpellGoesOutAtOnceAgain() {
        val clock = Clock(); val sent = mutableListOf<Long>()
        val reporter = reporter(clock, sent)
        reporter.touch()
        clock.advance(INTERACTION_REPORT_INTERVAL_MS + 1)
        reporter.touch()
        assertEquals(2, sent.size)
    }

    @Test fun stopCancelsTheTrailingSend() {
        val clock = Clock(); val sent = mutableListOf<Long>()
        val reporter = reporter(clock, sent)
        reporter.touch(); reporter.touch()
        reporter.stop()
        clock.advance(60_000)
        assertEquals(1, sent.size)
    }

    @Test fun aSendThatThrowsDoesNotStopLaterOnes() {
        val clock = Clock(); var calls = 0
        val reporter = InteractionReporter(clock = { clock.now }, schedule = clock::schedule, send = { calls++; error("socket closed") })
        reporter.touch()
        clock.advance(INTERACTION_REPORT_INTERVAL_MS)
        reporter.touch()
        assertEquals(2, calls)
    }

    @Test fun theIntervalMatchesTheProtocol() = assertEquals(5_000L, INTERACTION_REPORT_INTERVAL_MS)
}
