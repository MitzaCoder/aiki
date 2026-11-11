package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.github.mitzacoder.aiki.features.chat.RichMarkdown
import io.github.mitzacoder.aiki.protocol.BoardQuestion
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.LucideIcon
import io.github.mitzacoder.aiki.ui.theme.Jarvis

internal val ExpandQuestionIcon = LucideIcon("maximize-2", "M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7")

/** Read-only: dismissing returns to the same answer draft and suggested answers. */
@Composable
internal fun QuestionReadingDialog(question: BoardQuestion, taskLabel: String?, onDismiss: () -> Unit) {
    val colors = Jarvis.colors
    val title = "${if (isWarning(question)) "Warning" else "Question"} ${question.id}"
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
            Surface(
                Modifier.widthIn(max = 896.dp).fillMaxWidth().heightIn(max = maxHeight)
                    .semantics { paneTitle = title },
                shape = RoundedCornerShape(16.dp),
                color = colors.bg,
                contentColor = colors.fg,
                border = BorderStroke(1.dp, colors.border),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(title, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
                        IconButton(onClick = onDismiss) {
                            LucideGlyph(Lucide.X, size = 18.dp, contentDescription = "Close expanded ${question.id}")
                        }
                    }
                    Text(taskLabel ?: "Read the full text. Close to answer on the card.", style = TaskType.xs, color = colors.fgSubtle)
                    Column(Modifier.weight(1f, fill = false).clipToBounds().verticalScroll(rememberScrollState())) {
                        ProvideTextStyle(MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp, lineHeight = 28.sp)) {
                            RichMarkdown(question.text, userMessage = true)
                        }
                    }
                }
            }
        }
    }
}
