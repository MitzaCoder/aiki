package io.github.mitzacoder.kemiri.features.refs

import io.github.mitzacoder.kemiri.protocol.MAX_REF_STATUS_REFS
import io.github.mitzacoder.kemiri.protocol.RefDetails
import io.github.mitzacoder.kemiri.protocol.RefStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The live state of the refs a project screen shows (web `ProjectRefStatus`): read with `refs.status` when the set
 * changes, every couple of minutes while the screen is visible, when it comes back into view and after a reconnect
 * ([ProvideRefLinks] drives those). Any failure keeps what was known; a ref the backend left out loses its state.
 */
class RefStatusStore(
    private val read: suspend (List<String>) -> List<RefStatus>,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val known = MutableStateFlow<Map<String, RefStatus>>(emptyMap())
    /** The state the backend read for each ref, by the ref as written. */
    val statuses: StateFlow<Map<String, RefStatus>> = known.asStateFlow()
    private var wanted: List<String> = emptyList()
    /** When the last read started; 0 before the first. */
    var lastRead = 0L
        private set

    /** The refs on screen. True when one not asked for before joined (read it soon); the same set again changes nothing. */
    fun want(refs: List<String>): Boolean {
        val next = refs.distinct().take(MAX_REF_STATUS_REFS)
        val added = next.any { it !in wanted }
        wanted = next
        return added
    }

    /** Coming back to the screen reads again only when the last read is at least [STALE_ON_RETURN_MS] old. */
    fun staleOnReturn(): Boolean = lastRead > 0 && now() - lastRead > STALE_ON_RETURN_MS

    suspend fun refresh() {
        val refs = wanted
        if (refs.isEmpty()) return
        lastRead = now()
        val statuses = try { read(refs) } catch (e: CancellationException) { throw e } catch (_: Exception) { return }
        val found = statuses.associateBy { it.ref }
        known.update { current ->
            current.toMutableMap().apply {
                for (ref in refs) { val status = found[ref]; if (status == null) remove(ref) else put(ref, status) }
            }
        }
    }

    companion object {
        /** How often the shown refs are read again while the screen is visible; the backend caches anyway. */
        const val REFRESH_MS = 2 * 60_000L
        const val STALE_ON_RETURN_MS = 45_000L
        /** New refs (a task added or edited) are read after a short pause, so a burst of changes is one request. */
        const val SETTLE_MS = 400L
    }
}

/**
 * A card's details by what the ref is about ([refIdentity]), kept for a minute like the web's card host; a failed read
 * keeps what an earlier one found, "nothing found" replaces it.
 */
class RefDetailsCache(
    private val read: suspend (String) -> RefDetails?,
    private val now: () -> Long = System::currentTimeMillis,
) {
    data class Entry(val details: RefDetails?, val at: Long)

    private val entries = MutableStateFlow<Map<String, Entry>>(emptyMap())
    private val reading = MutableStateFlow<Set<String>>(emptySet())
    val known: StateFlow<Map<String, Entry>> = entries.asStateFlow()
    /** The identities being read now. */
    val loading: StateFlow<Set<String>> = reading.asStateFlow()

    /** Reads [href]'s details unless a fresh answer is kept or a read is under way. */
    suspend fun load(identity: String, href: String) {
        val kept = entries.value[identity]
        if ((kept != null && now() - kept.at < FRESH_MS) || identity in reading.value) return
        reading.update { it + identity }
        try {
            val details = read(href)
            entries.update { it + (identity to Entry(details, now())) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
        } finally {
            reading.update { it - identity }
        }
    }

    companion object { const val FRESH_MS = 60_000L }
}
