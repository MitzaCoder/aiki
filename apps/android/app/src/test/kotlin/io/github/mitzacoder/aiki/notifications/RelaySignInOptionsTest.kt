package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.features.notifications.relay.relayConsentPoints
import io.github.mitzacoder.aiki.features.notifications.relay.relayGoogleSignInEnabled
import org.junit.Assert.*
import org.junit.Test

class RelaySignInOptionsTest {
    @Test fun emailOnlyPilotDoesNotOfferGoogleOrDescribeGoogleProfileSharing() {
        val google = relayGoogleSignInEnabled("")
        assertFalse(google)
        val points = relayConsentPoints(google)
        assertEquals(5, points.size)
        assertFalse(points.any { it.contains("name and photo") })
        assertTrue(points.any { it.contains("relay and Google see") })
    }

    @Test fun configuredWebClientOffersGoogleAndDescribesProfileSharing() {
        val google = relayGoogleSignInEnabled("demo-web-client")
        assertTrue(google)
        val points = relayConsentPoints(google)
        assertEquals(6, points.size)
        assertTrue(points.any { it.contains("Google sign-in may share your name and photo") })
    }

    @Test fun debugFakeCredentialCountsAsGoogleConfiguredWithoutAWebClient() {
        assertTrue(relayGoogleSignInEnabled("", fakeGoogleCredential = true))
        assertFalse(relayGoogleSignInEnabled(" ", fakeGoogleCredential = false))
    }
}
