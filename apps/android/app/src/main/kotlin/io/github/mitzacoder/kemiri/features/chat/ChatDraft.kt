package io.github.mitzacoder.kemiri.features.chat

import android.os.Build
import android.util.Base64
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.*
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** An image the composer holds: the draft's reference to it and, once this device has them, its bytes. */
@Immutable
internal class DraftImage(val ref: DraftAttachment, val bytes: ByteArray?)

/**
 * What the composer holds for one chat (text, picked task, quotes, images) and how it is kept: in the device's cache
 * always, and on the backend when it has `chat-drafts` (see `DraftSync`, docs/DESIGN.md "Chat drafts"). The screen reads
 * and writes these like plain state; changes are noticed by [content], and a draft that arrives from another device is put
 * back through [applyRemote] without echoing.
 */
@Stable
internal class ChatDraftState {
    /** The text field's state; [value] reads and writes it as a plain value. */
    val textState = TextFieldState()
    var value: TextFieldValue
        get() = TextFieldValue(textState.text.toString(), textState.selection)
        set(next) { textState.edit { replace(0, length, next.text); selection = TextRange(next.selection.start.coerceIn(0, length), next.selection.end.coerceIn(0, length)) } }
    var taskId by mutableStateOf<String?>(null)
    var quotes by mutableStateOf(listOf<String>())
    /** The images the draft holds, in order, by reference; the bytes are here once read from the cache or the backend. */
    var images by mutableStateOf(listOf<DraftImage>())
    /** The `image` content blocks a message carries, one for each image whose bytes are here. */
    fun imageBlocks(): List<JsonObject> = images.mapNotNull { image -> image.bytes?.let { imageBlock(image.ref.mimeType, it) } }
    /** A reference whose bytes are still on their way here. */
    val imageLoading: Boolean get() = images.any { it.bytes == null }
    /** The message went out: its images leave the composer. */
    fun clearImages() { images = emptyList() }
    /** Set when the draft on screen came from another device, until the user changes it. */
    var origin by mutableStateOf<DraftOrigin?>(null)
    var focused = false
    internal var sync: DraftSync? = null
    internal var last: DraftContent? = null

    fun content(): DraftContent = DraftContent(
        text = value.text,
        taskId = taskId,
        quotes = quotes,
        attachments = images.map { it.ref }.takeIf { it.isNotEmpty() },
    )

    /** Show a draft without it counting as something the user typed. */
    fun show(content: DraftContent?) {
        val next = content ?: DraftContent(text = "", quotes = emptyList())
        last = next
        val current = value
        val caretAtEnd = current.selection.end >= current.text.length
        val caret = if (caretAtEnd) next.text.length else current.selection.end.coerceAtMost(next.text.length)
        value = TextFieldValue(next.text, TextRange(caret))
        taskId = next.taskId
        quotes = next.quotes
        // Keep the bytes of images already shown; the others are read (see `loadImages`).
        val held = images.associateBy { it.ref.id }
        images = next.attachments.orEmpty().map { ref -> held[ref.id] ?: DraftImage(ref, null) }
    }

    /** A change on screen: tells the sync, and drops the "from another device" hint. */
    fun onContent(content: DraftContent) {
        if (sameDraftContent(content, last) && content.text == last?.text) return
        last = content
        origin = null
        sync?.changed(content)
    }

    /** The message went out and the fields were emptied: tell the backend now rather than after the debounce. */
    fun sent() {
        onContent(content())
        sync?.flush()
    }

    /**
     * The user attached an image: keep its bytes (they leave the draft only as a reference) and point the draft at it.
     * Returns why it does not fit the message (the count or the total size), or null when it was added; the same bytes twice
     * are one image.
     */
    suspend fun attach(cache: DraftCache, bytes: ByteArray, mimeType: String, name: String?): String? {
        val id = sha256Hex(bytes)
        if (images.any { it.ref.id == id }) return null
        messageLimitError(images.size, images.sumOf { it.ref.size.toInt() }, bytes.size, name)?.let { return it }
        cache.writeImage(id, bytes)
        images = images + DraftImage(DraftAttachment(id = id, mimeType = mimeType, size = bytes.size.toLong(), name = name), bytes)
        return null
    }

    fun removeImage(id: String) { images = images.filter { it.ref.id != id } }

    /** The bytes of a reference arrived (from the cache or the backend). */
    fun gotImage(id: String, bytes: ByteArray) { images = images.map { if (it.ref.id == id && it.bytes == null) DraftImage(it.ref, bytes) else it } }
}

internal fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

internal fun imageBlock(mimeType: String, bytes: ByteArray): JsonObject =
    buildJsonObject { put("type", "image"); put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)); put("mimeType", mimeType) }

/** One chat's line to the backend's draft store. */
private class DraftChannel(
    private val client: HarnessClient,
    private val projectId: String,
    private val chatId: String,
    private val device: DraftAuthor,
    private val cache: DraftCache,
) : DraftTransport {
    /** Images the backend is known to hold; it keeps them while a draft points at them. */
    private val uploaded = HashSet<String>()

    override fun available() = client.state.value.let { it.status == ConnectionStatus.Ready && it.supports("chat-drafts") }

    override suspend fun read(): ChatDraft? = client.request(DraftsGetRequest(projectId = projectId, threadId = chatId)).drafts.firstOrNull()

    override suspend fun write(content: DraftContent?, baseRevision: Long): DraftWriteResult {
        try {
            for (ref in content?.attachments.orEmpty()) {
                if (ref.id in uploaded) continue
                // Bytes this device does not have came from the backend, which has them.
                val bytes = cache.readImage(ref.id)
                if (bytes != null) client.request(DraftsAttachmentPutRequest(projectId = projectId, mimeType = ref.mimeType, data = Base64.encodeToString(bytes, Base64.NO_WRAP), name = ref.name))
                uploaded += ref.id
            }
            val response = client.request(
                DraftsSetRequest(projectId = projectId, threadId = chatId, content = content, baseRevision = baseRevision, device = device),
                explicitNulls = if (content == null) setOf("content") else emptySet(),
            )
            // What a write leaves out may be swept by the backend, so naming it again uploads it again.
            if (response.applied) uploaded.retainAll(content?.attachments.orEmpty().map { it.id }.toSet())
            return DraftWriteResult(response.applied, response.draft)
        } catch (e: ClientException) {
            uploaded.clear()
            if (e.code == "bad_request") throw DraftRejected(e.message ?: "The backend refused the draft")
            throw e
        } catch (e: Exception) {
            uploaded.clear()
            throw e
        }
    }
}

/** The draft of the chat on screen, restored from the device's cache and kept in step with the backend. */
@Composable
internal fun rememberChatDraft(context: ProjectScreenContext): ChatDraftState {
    val android = LocalContext.current
    val cache = remember { DraftCache.of(android) }
    val chatId = if (sameThread(context.route.threadId, null)) MAIN_THREAD_ID else context.route.threadId!!
    val key = "${context.backend.config.key}|${context.route.projectId}|$chatId"
    val state = remember(key) { ChatDraftState().also { it.show(cache.load(key).draft); it.last = it.content() } }
    var ready by remember(key) { mutableStateOf(cache.isLoaded) }
    LaunchedEffect(key) {
        if (!ready) {
            cache.awaitLoaded()
            // Stored drafts were not read yet when the screen opened: show the chat's, unless something was typed meanwhile.
            if (state.content().asContent() == null) state.show(cache.load(key).draft)
            ready = true
        }
    }
    val client = context.backend.client
    val projectId = context.route.projectId
    val ownId = context.repository.settings.collectAsStateWithLifecycle().value.deviceId
    val enabled = ready && context.route.workerId == null
    val scope = cache.scope
    val sync = remember(state, enabled, client, projectId, chatId, ownId) {
        if (!enabled) null else {
            val loaded = cache.load(key)
            val local = state.content().asContent()
            val channel = DraftChannel(client, projectId, chatId, DraftAuthor(deviceId = ownId, name = Build.MODEL), cache)
            DraftSync(
                transport = channel,
                scope = scope,
                local = local,
                synced = loaded.synced,
                focused = { state.focused },
                apply = { content, entry ->
                    state.show(content)
                    state.origin = draftOrigin(entry, ownId)
                    scope.launch { loadImages(state, cache, client, projectId) }
                },
                persist = { draft, synced -> cache.save(key, draft, synced) },
            ).also { if (!sameDraftContent(loaded.draft, local)) cache.save(key, local, loaded.synced) }
        }
    }
    DisposableEffect(sync) {
        state.sync = sync
        onDispose { sync?.destroy(); if (state.sync === sync) state.sync = null }
    }
    val connection by client.state.collectAsStateWithLifecycle()
    // The images a restored draft refers to: from the cache, else from the backend.
    val missing = state.images.filter { it.bytes == null }.map { it.ref.id }
    LaunchedEffect(missing, ready, client, connection.status) {
        if (missing.isNotEmpty() && ready) loadImages(state, cache, client, projectId)
    }
    LaunchedEffect(state, sync) {
        if (sync != null) snapshotFlow { state.content() }.collect { state.onContent(it) }
    }
    LaunchedEffect(sync, client, projectId, chatId) {
        if (sync != null) client.events.collect { event ->
            if (event is DraftsChangedEvent && event.projectId == projectId && event.threadId == chatId) sync.pushed(event.draft)
        }
    }
    LaunchedEffect(sync, connection.status, connection.supports("chat-drafts")) {
        if (sync != null && connection.status == ConnectionStatus.Ready && connection.supports("chat-drafts")) sync.connectionChanged()
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, sync) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) sync?.flush() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    return state
}

/** Read the bytes of every image the draft names and this device does not have yet: the cache first, then the backend. */
private suspend fun loadImages(state: ChatDraftState, cache: DraftCache, client: HarnessClient, projectId: String) {
    for (image in state.images.filter { it.bytes == null }) {
        val ref = image.ref
        try {
            val bytes = cache.readImage(ref.id) ?: runCatching {
                Base64.decode(client.request(DraftsAttachmentGetRequest(projectId = projectId, attachmentId = ref.id)).data, Base64.DEFAULT)
            }.getOrNull()?.also { cache.writeImage(ref.id, it) }
            if (bytes != null) state.gotImage(ref.id, bytes)
        } catch (e: CancellationException) { throw e }
    }
}
