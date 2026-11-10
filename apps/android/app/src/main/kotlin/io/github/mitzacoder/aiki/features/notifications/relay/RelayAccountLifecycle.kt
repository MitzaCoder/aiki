package io.github.mitzacoder.aiki.features.notifications.relay

import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Orders local receive revocation and remote cleanup before clearing Firebase/Credential Manager state. */
class RelayAccountLifecycle(
    private val removePhone: suspend () -> Unit,
    private val turnOff: suspend () -> Unit,
    private val clearNotifications: () -> Unit,
    private val signOut: suspend () -> Unit,
) {
    /** Local off remains effective even when installation cleanup cannot reach the relay. */
    suspend fun signOutPhone() {
        turnOff()
        clearNotifications()
        try { removePhone() }
        finally { withContext(NonCancellable) { signOut() } }
    }
}
