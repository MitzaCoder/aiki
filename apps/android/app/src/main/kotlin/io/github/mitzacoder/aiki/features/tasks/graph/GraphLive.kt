package io.github.mitzacoder.aiki.features.tasks.graph

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay

/** Session-only history and short visual signals. Does not own or mutate backend tasks. */
internal class GraphLive {
    private val baseline = GraphChangeBaseline()
    private var baselineGeneration = -1
    private var reset = true
    var entries by mutableStateOf(emptyList<GraphChangeEntry>())
    var seenSerial by mutableStateOf(0L)
    var serial by mutableStateOf(0L)
    var lastDataAt by mutableStateOf(0L)
    val glows = mutableStateMapOf<String, Long>()
    val reports = mutableStateMapOf<String, Long>()
    val linger = mutableStateMapOf<String, Long>()
    fun disconnected() { reset = true }
    fun read(snapshot: GraphSnapshot, generation: Int, now: Long) {
        val changes = baseline.read(snapshot, reset || baselineGeneration != generation)
        reset = false; baselineGeneration = generation; lastDataAt = now
        if (changes.isEmpty()) return
        entries = batchGraphChanges(entries, changes, now, serial)
        serial = entries.maxOf { it.serial }
        changes.forEach { change ->
            change.taskIds.forEach { glows[it] = now + 1500 }
            if (change.kind == "report") reports[change.key.removeSuffix(":report")] = now + 1600
            if (change.kind == "status") change.taskIds.filter { graphClosed(snapshot.tasks[it]?.status.orEmpty()) }.forEach { linger[it] = now + 4500 }
        }
    }
    fun prune(now: Long) {
        glows.keys.filter { glows.getValue(it) <= now }.forEach { glows.remove(it) }
        reports.keys.filter { reports.getValue(it) <= now }.forEach { reports.remove(it) }
        linger.keys.filter { linger.getValue(it) <= now }.forEach { linger.remove(it) }
    }
    val unseen get() = entries.count { it.serial > seenSerial }
    fun markSeen() { seenSerial = serial }
}

@Composable
internal fun graphMotionAllowed(): Boolean {
    val context = LocalContext.current
    fun enabled() = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    var enabled by remember(context) { mutableStateOf(enabled()) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { enabled = enabled() }
        }
        context.contentResolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state by lifecycle.currentStateFlow.collectAsStateWithLifecycle()
    return enabled && state.isAtLeast(Lifecycle.State.RESUMED)
}

@Composable
internal fun graphDisplayTime(live: GraphLive): Long {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state by lifecycle.currentStateFlow.collectAsStateWithLifecycle()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(live, state) {
        if (state.isAtLeast(Lifecycle.State.RESUMED)) while (true) {
            now = System.currentTimeMillis(); live.prune(now)
            delay(if (live.glows.isNotEmpty() || live.reports.isNotEmpty() || live.linger.isNotEmpty()) 200 else 1000)
        }
    }
    return now
}
