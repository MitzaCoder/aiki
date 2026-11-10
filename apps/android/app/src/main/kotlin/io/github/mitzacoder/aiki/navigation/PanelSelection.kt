package io.github.mitzacoder.aiki.navigation

import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.HarnessClient

/**
 * Root and panel share the same capability resolution. The connection keeps the last hello through a reconnect, so a
 * moment offline never closes a live editor.
 */
@Composable
fun rememberPanelTabs(client: HarnessClient): List<PanelTab> {
    val connection by client.state.collectAsStateWithLifecycle()
    return remember(connection.hello) { PanelTab.entries.filter { connection.supports(it.feature) } }
}
