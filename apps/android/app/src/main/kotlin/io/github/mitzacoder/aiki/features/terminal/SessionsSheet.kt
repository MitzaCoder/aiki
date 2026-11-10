package io.github.mitzacoder.aiki.features.terminal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.protocol.TerminalListResponse
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.launch

/**
 * The backend's zellij sessions (the web's Sessions popover): attach one in a tab, end one (a second press confirms), or
 * start a new terminal. Closing a tab only detaches; "End" stops everything running in the session.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsSheet(
    backendName: String,
    listing: TerminalListResponse?,
    openSessions: Set<String>,
    onDismiss: () -> Unit,
    onAttach: (String) -> Unit,
    onNew: () -> Unit,
    onEnd: suspend (String) -> Unit,
) {
    val colors = Jarvis.colors
    val scope = rememberCoroutineScope()
    /** The session whose "End" was pressed once: a second press confirms. */
    var confirmEnd by remember { mutableStateOf<String?>(null) }
    val sessions = listing?.sessions.orEmpty()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Sessions on $backendName", style = MaterialTheme.typography.titleSmall)
            if (sessions.isEmpty()) {
                Text("No sessions yet. A new terminal makes one.", Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium, color = colors.fgMuted)
            } else {
                LazyColumn(Modifier.heightIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(sessions, key = { it.name }) { session ->
                        val open = session.name in openSessions
                        Surface(
                            Modifier.fillMaxWidth().semantics { contentDescription = "Session ${session.name}" }, shape = RoundedCornerShape(10.dp),
                            color = MaterialTheme.colorScheme.background, border = BorderStroke(1.dp, colors.border),
                        ) {
                            Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text(session.name, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        (if (open) "Open in a tab" else if (session.exited) "Exited, attaching restarts it" else "Running") + (session.created?.let { " · $it" } ?: ""),
                                        style = MaterialTheme.typography.bodySmall, color = colors.fgMuted,
                                    )
                                }
                                if (!open) OutlinedButton(onClick = { onAttach(session.name) }, contentPadding = PaddingValues(horizontal = 12.dp), modifier = Modifier.height(36.dp)) { Text("Attach") }
                                val confirming = confirmEnd == session.name
                                TextButton(
                                    onClick = { if (confirming) { confirmEnd = null; scope.launch { onEnd(session.name) } } else confirmEnd = session.name },
                                    colors = if (confirming) ButtonDefaults.textButtonColors(containerColor = colors.danger, contentColor = MaterialTheme.colorScheme.onError) else ButtonDefaults.textButtonColors(contentColor = colors.fgMuted),
                                    contentPadding = PaddingValues(horizontal = 12.dp), modifier = Modifier.height(36.dp).semantics { contentDescription = if (confirming) "Really end ${session.name}" else "End ${session.name}, stopping everything running in it" },
                                ) { Text(if (confirming) "Really end?" else "End") }
                            }
                        }
                    }
                }
            }
            OutlinedButton(onClick = onNew) { LucideGlyph(Lucide.Plus, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("New terminal") }
        }
    }
}
