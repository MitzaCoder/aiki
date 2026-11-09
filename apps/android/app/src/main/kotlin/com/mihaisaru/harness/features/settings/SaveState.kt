package com.mihaisaru.harness.features.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One field's save, as the settings show it (web `save-state.svelte.ts`): idle, saving, saved for a moment, or failed. */
enum class SaveStatus { Idle, Saving, Saved, Failed }

/** How long "Saved" stays before the row goes quiet again. */
const val SAVED_VISIBLE_MS = 2500L

/**
 * Each row owns one, so a failure sits beside the field that failed and nothing else on the page changes. A newer run
 * supersedes an older one's outcome.
 */
class SaveState(private val scope: CoroutineScope, private val savedVisibleMs: Long = SAVED_VISIBLE_MS) {
    var status by mutableStateOf(SaveStatus.Idle)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    private var run = 0
    private var timer: Job? = null

    /** Runs the save; true when it went through. */
    suspend fun run(action: suspend () -> Unit): Boolean {
        val mine = ++run
        timer?.cancel()
        status = SaveStatus.Saving
        error = null
        try { action() }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (mine == run) { status = SaveStatus.Failed; error = e.message?.takeIf { it.isNotBlank() } ?: "Not saved." }
            return false
        }
        if (mine == run) {
            status = SaveStatus.Saved
            timer = scope.launch { delay(savedVisibleMs); if (mine == run) status = SaveStatus.Idle }
        }
        return true
    }

    /** [run] without waiting, for a click handler. */
    fun launch(action: suspend () -> Unit): Job = scope.launch { run(action) }

    /** A problem found before anything was sent, such as a value out of range. */
    fun fail(message: String) {
        run++
        timer?.cancel()
        status = SaveStatus.Failed
        error = message
    }

    fun reset() {
        run++
        timer?.cancel()
        status = SaveStatus.Idle
        error = null
    }
}

@Composable
fun rememberSaveState(vararg keys: Any?): SaveState {
    val scope = rememberCoroutineScope()
    return remember(*keys) { SaveState(scope) }
}
