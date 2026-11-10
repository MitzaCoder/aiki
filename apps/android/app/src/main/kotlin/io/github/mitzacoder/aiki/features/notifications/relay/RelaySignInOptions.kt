package io.github.mitzacoder.aiki.features.notifications.relay

/** D54: email-only builds do not offer Google. Only the debug source set can supply a synthetic credential. */
fun relayGoogleSignInEnabled(webClientId: String, fakeGoogleCredential: Boolean = false): Boolean =
    webClientId.isNotBlank() || fakeGoogleCredential

/** An unconfigured build has exactly the existing notification page, without a relay notice or account UI. */
fun relaySettingsVisible(endpoint: String): Boolean = endpoint.isNotBlank()

/** Longer erasure boundaries stay behind Learn more and use everyday words, never service implementation terms. */
fun relayPrivacyDetails(): String = "Deleting an account can take time if the service cannot connect. " +
    "Already-sent messages and records kept by Google for security cannot be recalled."

/** Consent follows the actual methods offered, without removing Google's Auth/FCM metadata disclosure. */
fun relayConsentPoints(googleSignInEnabled: Boolean): List<String> = buildList {
    add("The relay's operator stores your email address.")
    if (googleSignInEnabled) add("Google sign-in may also share your name and photo. Aiki does not use them.")
    add("Your backend encrypts each notification for this phone. The relay and Google cannot read it.")
    add("The relay and Google can see when notifications are sent, how big they are and from which network.")
    add("There are limits. The operator can pause the service or disable an account.")
    add("You can delete the account here at any time. Turning notifications off or signing out keeps it.")
}
