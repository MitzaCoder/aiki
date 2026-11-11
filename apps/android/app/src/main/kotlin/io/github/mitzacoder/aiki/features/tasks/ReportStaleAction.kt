package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.layout.size
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.data.request
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.LucideIcon
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReportStaleAction(context: ProjectScreenContext, taskId: String, confirmed: Boolean, onMarked: () -> Unit, onError: (String) -> Unit) {
    var busy by remember(taskId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(), tooltip = { PlainTooltip { Text(REPORT_STALE_LABEL) } }, state = rememberTooltipState()) {
        IconButton(enabled = !busy && !confirmed, onClick = {
            busy = true
            scope.launch {
                try {
                    context.backend.client.request(reportStaleRequest(context.route.projectId, taskId))
                    onMarked()
                } catch (cause: CancellationException) { throw cause }
                catch (cause: Exception) { onError(cause.message ?: "Could not ask the agent to update") }
                finally { busy = false }
            }
        }, modifier = Modifier.size(48.dp).semantics { contentDescription = REPORT_STALE_LABEL }) {
            LucideGlyph(if (confirmed) Lucide.Check else LucideIcon("message-square-warning", "M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z", "M12 7v4", "M12 15h.01"), size = 18.dp, tint = Jarvis.colors.fgMuted)
        }
    }
}
