package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.features.notifications.relay.relayConsentPoints
import io.github.mitzacoder.aiki.features.notifications.relay.relayGoogleSignInEnabled
import io.github.mitzacoder.aiki.features.notifications.relay.relaySettingsVisible
import io.github.mitzacoder.aiki.features.notifications.relay.relayPrivacyDetails
import org.junit.Assert.*
import org.junit.Test

class RelaySignInOptionsTest {
    @Test fun emailOnlyPilotDoesNotOfferGoogleOrDescribeGoogleProfileSharing() {
        val google = relayGoogleSignInEnabled("")
        assertFalse(google)
        val points = relayConsentPoints(google)
        assertEquals(5, points.size)
        assertFalse(points.any { it.contains("name and photo") })
        assertTrue(points.any { it.contains("relay and Google can see") })
    }

    @Test fun configuredWebClientOffersGoogleAndDescribesProfileSharing() {
        val google = relayGoogleSignInEnabled("demo-web-client")
        assertTrue(google)
        val points = relayConsentPoints(google)
        assertEquals(6, points.size)
        assertTrue(points.any { it.contains("Google sign-in may also share your name and photo") })
    }

    @Test fun noEndpointMeansNoRelaySettingsAtAll() {
        assertFalse(relaySettingsVisible(""))
        assertFalse(relaySettingsVisible("  "))
        assertTrue(relaySettingsVisible("https://relay.example.test/v1/"))
    }

    @Test fun consentAndLearnMoreUsePlainWords() {
        val jargon = Regex("\\b(route|enrollment|capability|identity)\\b|provider logs", RegexOption.IGNORE_CASE)
        for (text in relayConsentPoints(true) + relayConsentPoints(false) + relayPrivacyDetails()) {
            assertFalse(text, jargon.containsMatchIn(text))
        }
        assertEquals("The relay's operator stores your email address.", relayConsentPoints(false).first())
        assertFalse(relayConsentPoints(true).any { it.contains("pending") || it.contains("security") })
        assertTrue(relayPrivacyDetails().contains("can take time"))
    }

    @Test fun debugFakeCredentialCountsAsGoogleConfiguredWithoutAWebClient() {
        assertTrue(relayGoogleSignInEnabled("", fakeGoogleCredential = true))
        assertFalse(relayGoogleSignInEnabled(" ", fakeGoogleCredential = false))
    }
}
