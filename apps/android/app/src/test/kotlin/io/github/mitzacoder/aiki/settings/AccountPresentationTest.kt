package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.features.settings.*
import org.junit.Assert.*
import org.junit.Test

class AccountPresentationTest {
    @Test fun credentialsAndLoginStatesAreHumanReadableWithoutInventingSuccess() {
        assertEquals("API key", accountAuthLabel("api_key"))
        assertEquals("Account sign-in", accountAuthLabel("oauth"))
        assertEquals("Not set up", accountAuthLabel(null))
        assertEquals("Waiting for your answer", accountLoginLabel("prompt"))
        assertEquals("Signing in…", accountLoginLabel("working"))
        assertEquals("Signed in", accountLoginLabel("succeeded"))
        assertEquals("Sign-in failed", accountLoginLabel("failed"))
        assertEquals("Sign-in cancelled", accountLoginLabel("cancelled"))
        assertEquals("future-state", accountLoginLabel("future-state"))
    }
}
