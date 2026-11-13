package io.github.mitzacoder.kemiri.features.notifications

/** The feature a backend lists when it holds notifications and wants to hear about interaction. */
const val NOTIFICATION_HOLD_FEATURE = "notification-hold"

/** How often at most the app tells one backend that the user is interacting (the protocol's `INTERACTION_REPORT_INTERVAL_MS`). */
const val INTERACTION_REPORT_INTERVAL_MS = 5_000L

/**
 * At most one [send] per [intervalMs]: the first [touch] sends now, touches inside the interval become one trailing
 * send at its end, and nothing is sent when nobody touches. Port of the web's `ThrottledReporter`. [touch] runs for every
 * touch event, so the common path (a send already scheduled) is a lock and a null check.
 */
class InteractionReporter(
    private val intervalMs: Long = INTERACTION_REPORT_INTERVAL_MS,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Run the action after the delay; returns what cancels it. */
    private val schedule: (delayMs: Long, run: () -> Unit) -> () -> Unit,
    private val send: () -> Unit,
) {
    private val lock = Any()
    private var lastSentAt = Long.MIN_VALUE
    private var cancelTrailing: (() -> Unit)? = null

    fun touch() {
        val sendNow = synchronized(lock) {
            if (cancelTrailing != null) return
            val now = clock()
            val wait = if (lastSentAt == Long.MIN_VALUE) 0L else lastSentAt + intervalMs - now
            if (wait <= 0) { lastSentAt = now; true }
            else { cancelTrailing = schedule(wait, ::trailing); false }
        }
        if (sendNow) fire()
    }

    fun stop() = synchronized(lock) { cancelTrailing?.invoke(); cancelTrailing = null }

    private fun trailing() {
        synchronized(lock) { cancelTrailing = null; lastSentAt = clock() }
        fire()
    }

    private fun fire() { try { send() } catch (_: Exception) { /* Lost; the next interaction sends another. */ } }
}
