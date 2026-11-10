package io.github.mitzacoder.aiki.features.notifications.relay

/** D54: email-only builds do not offer Google. Only the debug source set can supply a synthetic credential. */
fun relayGoogleSignInEnabled(webClientId: String, fakeGoogleCredential: Boolean = false): Boolean =
    webClientId.isNotBlank() || fakeGoogleCredential

/** Consent follows the actual methods offered, without removing Google's Auth/FCM metadata disclosure. */
fun relayConsentPoints(googleSignInEnabled: Boolean): List<String> = buildList {
    add("The operator's Firebase project stores your email and account identity.")
    if (googleSignInEnabled) add("Google sign-in may share your name and photo. Aiki does not use them.")
    add("Your backend encrypts notification content for this phone. The relay and Google cannot read it.")
    add("The relay and Google see network addresses, timing and message sizes. " +
        "The operator can link your phones and activity.")
    add("There are limits. The operator can disable an account or pause the service.")
    add("You can delete the account here. Turning notifications off or signing out keeps the account. " +
        "Cleanup may be pending; sent messages and provider logs cannot be recalled.")
}
