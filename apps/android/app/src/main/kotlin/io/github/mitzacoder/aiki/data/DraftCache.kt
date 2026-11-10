package io.github.mitzacoder.aiki.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.github.mitzacoder.aiki.features.chat.DRAFT_MAX_AGE_MS
import io.github.mitzacoder.aiki.features.chat.SyncedDraft
import io.github.mitzacoder.aiki.features.chat.asContent
import io.github.mitzacoder.aiki.protocol.DraftContent
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable

/** What the device keeps for one chat: the draft, and what it last knew the backend held (the web's `lib/drafts.ts` entry). */
@Serializable
internal data class StoredDraft(
    val draft: DraftContent,
    /** When the draft last changed (ms since the epoch). */
    val at: Long,
    /** The backend's revision this device last saw and the content it had then. Absent for a draft never synced. */
    val rev: Long? = null,
    val base: DraftContent? = null,
)

/** The draft restored for a chat and what the backend is known to hold for it. */
data class CachedDraft(val draft: DraftContent?, val synced: SyncedDraft)

/**
 * The cache's rules without storage (mirrors apps/web/test/drafts.test.ts): an entry is dropped when it is empty and has
 * nothing unsynced, or when it is older than 30 days; an empty draft stays while the backend still holds a non-empty one,
 * so a clear made offline is pushed later. Not thread safe on its own; [DraftCache] serialises it.
 */
internal class DraftCacheState(initial: Map<String, StoredDraft> = emptyMap()) {
    private val entries = LinkedHashMap(initial)

    fun load(key: String, now: Long): CachedDraft {
        val found = entries[key]?.takeIf { now - it.at <= DRAFT_MAX_AGE_MS } ?: return CachedDraft(null, SyncedDraft())
        return CachedDraft(found.draft.asContent(), SyncedDraft(found.rev ?: 0, found.base.asContent()))
    }

    /** Returns the stored entry (or null when it was removed) so the caller can write it through. */
    fun save(key: String, draft: DraftContent?, synced: SyncedDraft, now: Long): StoredDraft? {
        val mine = draft.asContent()
        val base = synced.content.asContent()
        entries.entries.removeAll { now - it.value.at > DRAFT_MAX_AGE_MS }
        if (mine == null && base == null) { entries.remove(key); return null }
        return StoredDraft(mine ?: DraftContent(text = "", quotes = emptyList()), now, synced.revision, base).also { entries[key] = it }
    }

    /** Puts a stored entry back (at start-up) unless this process already changed that chat. */
    fun restore(key: String, stored: StoredDraft) { if (key !in entries) entries[key] = stored }
}

private val Context.draftData by preferencesDataStore(name = "harness-drafts")

/**
 * The device's own copy of every chat's unsent draft: instant restore, and the draft when the backend is away or has no
 * `chat-drafts`. A memory map is the truth (so a screen that is recreated sees the latest change at once); DataStore is
 * written behind it, one write per change per chat. Images a draft holds are kept as files in the cache directory, named
 * by their SHA-256; losing them is harmless since the backend has the bytes.
 */
class DraftCache private constructor(private val appContext: Context) {
    /** Outlives every screen: a last write after the user leaves a chat must not be cancelled with it. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Any()
    private val state = DraftCacheState()
    private val loaded = CompletableDeferred<Unit>()
    private val pending = ConcurrentHashMap<String, Job>()
    @Volatile private var ready = false

    init {
        io.launch {
            try {
                val saved = appContext.draftData.data.first().asMap()
                synchronized(lock) {
                    for ((key, value) in saved) {
                        if (!key.name.startsWith(PREFIX) || value !is String) continue
                        val stored = runCatching { wireJson.decodeFromString(StoredDraft.serializer(), value) }.getOrNull() ?: continue
                        // A change made before the read finished is newer than what was stored.
                        state.restore(key.name.removePrefix(PREFIX), stored)
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { /* No stored drafts: start empty. */ }
            ready = true
            loaded.complete(Unit)
        }
    }

    /** True once the stored drafts have been read; before that [load] only knows changes made in this process. */
    val isLoaded: Boolean get() = ready
    suspend fun awaitLoaded() = loaded.await()

    fun load(key: String, now: Long = System.currentTimeMillis()): CachedDraft = synchronized(lock) { state.load(key, now) }

    fun save(key: String, draft: DraftContent?, synced: SyncedDraft, now: Long = System.currentTimeMillis()) {
        val stored = synchronized(lock) { state.save(key, draft, synced, now) }
        // Only the newest change of a chat is written; an older one still waiting is replaced.
        pending.put(key, io.launch {
            try {
                appContext.draftData.edit { preferences ->
                    val preferenceKey = stringPreferencesKey(PREFIX + key)
                    if (stored == null) preferences.remove(preferenceKey)
                    else preferences[preferenceKey] = wireJson.encodeToString(StoredDraft.serializer(), stored)
                }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { /* Storage failed: the draft survives until the process ends. */ }
        })?.cancel()
    }

    private fun images(): File = File(appContext.cacheDir, "draft-images").also { it.mkdirs() }

    /** The bytes of an image a draft holds, if this device still has them. */
    suspend fun readImage(id: String): ByteArray? = withContext(Dispatchers.IO) {
        File(images(), id).takeIf { it.isFile }?.let { runCatching { it.readBytes() }.getOrNull() }
    }

    suspend fun writeImage(id: String, bytes: ByteArray) = withContext(Dispatchers.IO) {
        runCatching { File(images(), id).writeBytes(bytes) }
        Unit
    }

    companion object {
        private const val PREFIX = "draft|"
        @Volatile private var instance: DraftCache? = null
        fun of(context: Context): DraftCache = instance ?: synchronized(this) {
            instance ?: DraftCache(context.applicationContext).also { instance = it }
        }
    }
}
