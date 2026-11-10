package io.github.mitzacoder.aiki.panels

import io.github.mitzacoder.aiki.features.panels.latestPanelReads
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import org.junit.Assert.*
import org.junit.Test

class PanelRefreshTest {
    @Test fun overtakenSnapshotCannotOverwriteInvalidationEvenIfNetworkIgnoresCancellation() = runBlocking {
        val triggers = Channel<Unit>(Channel.UNLIMITED)
        val requests = Channel<CompletableDeferred<String>>(Channel.UNLIMITED)
        val accepted = Channel<String>(Channel.UNLIMITED)
        val job = launch {
            latestPanelReads(triggers.receiveAsFlow(), { true }, {
                val response = CompletableDeferred<String>()
                requests.send(response)
                withContext(NonCancellable) { response.await() }
            }, {}, { accepted.trySend(it) }, { throw it })
        }
        try {
            triggers.send(Unit)
            val old = withTimeout(2_000) { requests.receive() }
            triggers.send(Unit) // a push invalidates the read (also used by reconnect)
            delay(30)
            old.complete("stale")
            val fresh = withTimeout(2_000) { requests.receive() }
            assertTrue(accepted.tryReceive().isFailure)
            fresh.complete("fresh including archive")
            assertEquals("fresh including archive", withTimeout(2_000) { accepted.receive() })
        } finally { job.cancelAndJoin() }
    }
    @Test fun offlineDoesNotReadAndReconnectReReadsWithArchiveSelectionIntact() = runBlocking {
        val triggers = Channel<Unit>(Channel.UNLIMITED)
        val accepted = Channel<List<String>>(Channel.UNLIMITED)
        var ready = false
        val includeArchive = true
        var requests = 0
        val job = launch {
            latestPanelReads(triggers.receiveAsFlow(), { ready }, {
                requests++
                if (includeArchive) listOf("active", "archived") else listOf("active")
            }, {}, { accepted.trySend(it) }, { throw it })
        }
        try {
            triggers.send(Unit)
            delay(30)
            assertEquals(0, requests)
            ready = true
            triggers.send(Unit)
            assertEquals(listOf("active", "archived"), withTimeout(2_000) { accepted.receive() })
            triggers.send(Unit) // archive-free push is an invalidation, not a replacement
            assertEquals(listOf("active", "archived"), withTimeout(2_000) { accepted.receive() })
            ready = false; triggers.send(Unit); delay(30)
            ready = true; triggers.send(Unit)
            assertEquals(listOf("active", "archived"), withTimeout(2_000) { accepted.receive() })
            assertEquals(3, requests)
        } finally { job.cancelAndJoin() }
    }
}
