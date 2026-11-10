package io.github.mitzacoder.aiki.notifications

import android.content.Context
import android.content.ContextWrapper
import io.github.mitzacoder.aiki.features.notifications.relay.FirebaseRelayAccount
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class FirebaseRelayAccountTest {
    @Test fun `off creates no Firebase Auth object even when queried during normal use`() = runTest {
        var created = 0
        val context = object : ContextWrapper(null) {
            override fun getApplicationContext(): Context = this
        }
        val account = FirebaseRelayAccount(context) {
            created++
            error("Auth must never be created with the relay switch off")
        }
        assertNull(account.identity())
        assertNull(account.idToken())
        assertEquals("", account.pendingEmail())
        assertFalse(account.recentlyAuthenticated())
        account.signOut()
        assertEquals(0, created)
    }
}
