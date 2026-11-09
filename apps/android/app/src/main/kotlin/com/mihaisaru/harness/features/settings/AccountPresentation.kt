package com.mihaisaru.harness.features.settings

internal fun accountAuthLabel(type: String?): String = when (type) {
    "api_key" -> "API key"
    "oauth" -> "Account sign-in"
    null -> "Not set up"
    else -> type
}
internal fun accountLoginLabel(status: String): String = when (status) {
    "prompt" -> "Waiting for your answer"
    "working" -> "Signing in…"
    "succeeded" -> "Signed in"
    "failed" -> "Sign-in failed"
    "cancelled" -> "Sign-in cancelled"
    else -> status
}
