package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.features.notifications.relay.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class RelaySignInStateTest {
    @Test fun `first run is off without an account prompt`() {
        assertEquals(RelaySignInPage.Off, RelaySignInState().page)
        assertNull(RelaySignInState().problem)
    }

    @Test fun `unavailable builds cannot begin sign in`() {
        val state = RelaySignInState().begin(false)
        assertEquals(RelaySignInPage.Off, state.page)
        assertEquals(RelaySignInProblem.Unavailable, state.problem)
    }

    @Test fun `explicit opt in shows consent before sign in`() {
        assertEquals(RelaySignInPage.Consent, RelaySignInState().begin(true).page)
    }

    @Test fun `cancelling every unfinished page returns to off`() {
        for (page in RelaySignInPage.entries.filter { it != RelaySignInPage.On }) {
            assertEquals(RelaySignInState(), RelaySignInState(page, RelaySignInProblem.Network, 50).cancel())
        }
    }

    @Test fun `sign in alone does not turn notifications on`() {
        assertEquals(RelaySignInPage.CheckingPhone, RelaySignInState().signedIn().page)
        assertEquals(RelaySignInPage.CheckingPhone, RelaySignInState().phoneChecked(false).page)
        assertEquals(RelaySignInPage.On, RelaySignInState().phoneChecked(true).page)
    }

    @Test fun `email send starts exact sixty second cooldown`() {
        val state = RelaySignInState().emailSent(100_000)
        assertEquals(RelaySignInPage.CheckEmail, state.page)
        assertEquals(60L, state.resendSeconds(100_000))
        assertEquals(60L, state.resendSeconds(100_001))
        assertEquals(1L, state.resendSeconds(159_999))
        assertEquals(0L, state.resendSeconds(160_000))
        assertEquals(0L, state.resendSeconds(160_001))
        assertEquals(60L, state.resendSeconds(99_000))
    }

    @Test fun `email links require exact configured host and path`() {
        assertTrue(validRelayEmailLink("https://relay.example.test/__/auth/links?oobCode=synthetic", "relay.example.test"))
        for (link in listOf(
            "http://relay.example.test/__/auth/links?oobCode=x",
            "https://relay.example.test.evil.test/__/auth/links?oobCode=x",
            "https://evil.test/__/auth/links?oobCode=x",
            "https://relay.example.test:443/__/auth/links?oobCode=x",
            "https://user@relay.example.test/__/auth/links?oobCode=x",
            "https://relay.example.test/__/auth/links?oobCode=x#fragment",
            "https://relay.example.test/__/auth/action?oobCode=x",
            "https://relay.example.test/__/auth/links/extra?oobCode=x",
            "https://relay.example.test/__/auth/%6cinks?oobCode=x",
            "https://relay.example.test/__/auth/links",
            "not a link",
        )) assertFalse(link, validRelayEmailLink(link, "relay.example.test"))
        assertFalse(validRelayEmailLink("https://relay.example.test/__/auth/links?x=y", ""))
    }

    @Test fun `all problems have fixed plain words without implementation jargon`() {
        val jargon = Regex("\\b(route|enrollment|vapid|capability)\\b", RegexOption.IGNORE_CASE)
        for (problem in RelaySignInProblem.entries) {
            assertTrue(problem.message.isNotBlank())
            assertFalse(problem.name, jargon.containsMatchIn(problem.message))
        }
        for (code in RelayErrorCode.entries) {
            val text = relayProblemText(code, 30)
            assertTrue(text.isNotBlank())
            assertFalse(code.name, jargon.containsMatchIn(text))
        }
    }

    @Test fun `quota labels never display wire names or unknown remote text`() {
        for (budget in listOf("accountDay", "accountMinute", "accountChallengeHour", "accountChallengeDay",
            "enrollmentDay", "ipDay", "ipMinute", "managementMinute", "managementDay", "ipChallengeHour",
            "ipChallengeDay", "newAccountIpDay", "relaySendDay", "relayChallengeDay", "newAccountDay")) {
            assertFalse(relayQuotaLabel(budget).contains('_'))
            assertNotEquals(budget, relayQuotaLabel(budget))
            assertFalse(relayQuotaLabel(budget).contains("enrollment"))
        }
        assertEquals("Service limit", relayQuotaLabel("untrusted remote text"))
    }

    @Test fun `phone limit operator pause and rate limit have different actions`() {
        assertTrue(relayProblemText(RelayErrorCode.PhoneLimit).contains("Remove an old phone"))
        assertTrue(relayProblemText(RelayErrorCode.RelayDisabled).contains("paused by the relay operator"))
        assertTrue(relayProblemText(RelayErrorCode.RequestRate, 17).contains("17 seconds"))
        assertNotEquals(relayProblemText(RelayErrorCode.AccountDisabled), relayProblemText(RelayErrorCode.AccountDeleted))
    }

    @Test fun `sign out removes phone before clearing Firebase state`() = runTest {
        val calls = mutableListOf<String>()
        RelayAccountLifecycle({ calls += "remove-phone" }, { calls += "off" },
            { calls += "cancel-notifications" }, { calls += "firebase-and-credentials" }).signOutPhone()
        assertEquals(listOf("off", "cancel-notifications", "remove-phone", "firebase-and-credentials"), calls)
    }

    @Test fun `offline cleanup never prevents local sign out`() = runTest {
        var signedOut = false
        try {
            RelayAccountLifecycle({ error("offline") }, {}, {}, { signedOut = true }).signOutPhone()
        } catch (_: IllegalStateException) { }
        assertTrue(signedOut)
    }
}
