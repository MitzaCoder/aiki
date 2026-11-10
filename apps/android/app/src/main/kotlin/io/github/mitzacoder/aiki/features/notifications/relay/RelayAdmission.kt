package io.github.mitzacoder.aiki.features.notifications.relay

import java.math.BigInteger
import kotlinx.serialization.json.*

/** Persistent 4096-bit window, bit zero is the highest accepted sequence. Never reset under the same key. */
class RelayReplayWindow(state: JsonObject? = null) {
    private var highest: BigInteger? = null
    private var bits = BigInteger.ZERO
    private val mask = BigInteger.ONE.shiftLeft(RelayCrypto.WINDOW_SIZE) - BigInteger.ONE

    init {
        if (state != null) {
            RelayCrypto.keys(state, listOf("highest", "bits"))
            highest = if (state["highest"] == JsonNull) {
                null
            } else {
                RelayCrypto.sequence(RelayCrypto.text(state["highest"], 20))
            }
            val hex = RelayCrypto.text(state["bits"], 1024)
            if (!Regex("^(0|[1-9a-f][0-9a-f]{0,1023})$").matches(hex)) reject("invalid")
            bits = BigInteger(hex, 16)
            validateState()
        }
    }

    private fun validateState() {
        val top = highest
        if ((top == null) != (bits == BigInteger.ZERO)) reject("invalid")
        if (top != null && !bits.testBit(0)) reject("invalid")
        if (top != null && top < BigInteger.valueOf(4095) && bits.shiftRight(top.toInt() + 1) != BigInteger.ZERO) {
            reject("invalid")
        }
    }

    /** Accept an unseen u64 sequence once, allowing reordering only within the sliding window. */
    fun accept(sequence: String): Boolean {
        val number = RelayCrypto.sequence(sequence)
        val top = highest
        if (top == null) {
            highest = number
            bits = BigInteger.ONE
            return true
        }
        if (number > top) {
            val jump = number - top
            bits = if (jump >= BigInteger.valueOf(4096)) {
                BigInteger.ONE
            } else {
                bits.shiftLeft(jump.toInt()).or(BigInteger.ONE).and(mask)
            }
            highest = number
            return true
        }
        val age = top - number
        if (age >= BigInteger.valueOf(4096) || bits.testBit(age.toInt())) return false
        bits = bits.setBit(age.toInt())
        return true
    }

    /** Export the complete window for exact restoration without resetting a live key. */
    fun state(): JsonObject = buildJsonObject {
        put("highest", highest?.toString()?.let(::JsonPrimitive) ?: JsonNull)
        put("bits", bits.toString(16))
    }
}

/**
 * One per backend/session across rotated keys. Caller serializes access and supplies trusted backend time.
 * The persistence callback must commit atomically before this method returns and the caller displays anything.
 * A failed commit leaves in-memory state unchanged. The later storage layer owns key retirement and locking.
 */
class RelayAdmission(serialized: String? = null) {
    private var windows = linkedMapOf<String, JsonObject>()
    private var events = linkedMapOf<String, Long>()

    init {
        if (serialized != null) {
            val state = RelayCrypto.obj(RelayCrypto.parse(serialized))
            RelayCrypto.keys(state, listOf("windows", "events"))
            for ((key, raw) in RelayCrypto.obj(state["windows"])) {
                windows[RelayCrypto.id(key)] = RelayReplayWindow(RelayCrypto.obj(raw)).state()
            }
            for ((id, at) in RelayCrypto.obj(state["events"])) {
                events[RelayCrypto.id(id)] = RelayCrypto.timestamp(at)
            }
        }
    }

    private fun serialized(windows: Map<String, JsonObject>, events: Map<String, Long>): String = buildJsonObject {
        put("windows", JsonObject(windows))
        put("events", buildJsonObject {
            for ((id, at) in events) put(id, at)
        })
    }.toString()

    /** Export replay and cross-key event-dedupe state without changing it. */
    fun serialize(): String = serialized(windows, events)

    /** Stage admission, durably persist it, then commit memory; never return display permission before persistence. */
    fun admit(
        keyId: String,
        plaintext: RelayPlaintext,
        backendNow: Long,
        persist: (String) -> Unit,
        clockTrusted: Boolean = true,
    ) {
        RelayCrypto.id(keyId)
        RelayCrypto.readPlaintext(RelayCrypto.plaintextJson(plaintext))
        RelayCrypto.checkExpiry(plaintext, backendNow, clockTrusted)
        val window = RelayReplayWindow(windows[keyId])
        if (!window.accept(plaintext.sequence)) reject("replay")
        val nextEvents = events.filterValues { backendNow - it < RelayCrypto.RETENTION_MS }.toMutableMap()
        if (plaintext.eventId in nextEvents) reject("event_duplicate")
        nextEvents[plaintext.eventId] = backendNow
        val nextWindows = windows.toMutableMap().apply { put(keyId, window.state()) }
        persist(serialized(nextWindows, nextEvents))
        windows = LinkedHashMap(nextWindows)
        events = LinkedHashMap(nextEvents)
    }
}
