package io.github.mitzacoder.aiki.features.terminal

import android.graphics.Typeface
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.res.ResourcesCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.R
import io.github.mitzacoder.aiki.data.TerminalStatus
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import com.termux.view.TerminalView

/**
 * One terminal: the Termux view bound to a tab's [TerminalScreenSession], with the web's overlays: "Opening a terminal…",
 * "Connection lost. Reattaching to the session…" and, once the session ended or could not be opened, a card with the
 * reason and Close (and Start a new session when it ended).
 *
 * Only the tab in front has a view; the others keep their emulator in the deck and get a view when they come forward (a
 * view for each, stacked, would take the touches of the one in front).
 */
@Composable
fun TerminalPane(
    session: TerminalScreenSession,
    input: TerminalInput,
    fontSp: Int,
    onClose: () -> Unit,
    onRestart: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val state by session.state.collectAsStateWithLifecycle()
    val background = Jarvis.colors.bg
    val typeface = remember(context) { ResourcesCompat.getFont(context, R.font.jetbrains_mono) ?: Typeface.MONOSPACE }
    val client = remember(session) { input.viewClient() }
    var view by remember(session) { mutableStateOf<TerminalView?>(null) }
    val appliedPx = remember(session) { intArrayOf(0) }
    // No background of its own: a Compose background over a sibling's AndroidView would hide that view.
    Box(modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                TerminalView(ctx, null).apply {
                    isFocusable = true
                    isFocusableInTouchMode = true
                    isVerticalScrollBarEnabled = false
                    client.view = this
                    setTerminalViewClient(client)
                    appliedPx[0] = terminalFontPx(ctx, fontSp)
                    setTextSize(appliedPx[0])
                    setTypeface(typeface)
                    session.attach(this)
                    view = this
                }
            },
            modifier = Modifier.fillMaxSize().padding(horizontal = 4.dp),
            update = { terminal ->
                terminal.setBackgroundColor(background.toArgb())
                val wanted = terminalFontPx(terminal.context, fontSp)
                if (appliedPx[0] != wanted) {
                    appliedPx[0] = wanted
                    terminal.setTextSize(wanted)
                    terminal.setTypeface(typeface)
                }
            },
            onRelease = { terminal -> session.detachView(terminal) },
        )
        // The key bar and the copy button act on the view in front.
        val current = view
        if (current != null) SideEffect {
            input.active = session
            input.activeView = current
            input.selecting = current.isSelectingText
        }
        if (current != null) LaunchedEffect(current) { current.requestFocus() }
        Overlays(state, onClose, onRestart)
    }
}

@Composable
private fun BoxScope.Overlays(state: io.github.mitzacoder.aiki.data.TerminalState, onClose: () -> Unit, onRestart: () -> Unit) {
    val colors = Jarvis.colors
    when (state.status) {
        TerminalStatus.Attaching -> Pill("Opening a terminal…", colors.fgMuted, Modifier.align(Alignment.TopCenter))
        TerminalStatus.Reconnecting -> Pill("Connection lost. Reattaching to the session…", colors.warning, Modifier.align(Alignment.TopCenter), live = true)
        TerminalStatus.Ended, TerminalStatus.Failed -> Box(Modifier.matchParentSize().background(MaterialTheme.colorScheme.background.copy(alpha = .7f)), contentAlignment = Alignment.Center) {
            Surface(
                Modifier.padding(16.dp).widthIn(max = 380.dp).semantics { liveRegion = LiveRegionMode.Assertive }, shape = RoundedCornerShape(16.dp),
                color = if (colors.dark) colors.surface else Color.White, border = BorderStroke(1.dp, colors.border), shadowElevation = 8.dp,
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(endedText(state), style = MaterialTheme.typography.bodyMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (state.status == TerminalStatus.Ended) Button(onClick = onRestart) { Text("Start a new session") }
                        OutlinedButton(onClick = onClose) { Text("Close tab") }
                    }
                }
            }
        }
        TerminalStatus.Attached, TerminalStatus.Detached -> Unit
    }
}

@Composable
private fun Pill(text: String, color: Color, modifier: Modifier, live: Boolean = false) {
    val colors = Jarvis.colors
    Surface(
        modifier.padding(top = 12.dp).then(if (live) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier),
        shape = CircleShape, color = if (colors.dark) colors.surface else Color.White, border = BorderStroke(1.dp, colors.border), shadowElevation = 2.dp,
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = color)
            Text(text, style = MaterialTheme.typography.labelMedium, color = color)
        }
    }
}
