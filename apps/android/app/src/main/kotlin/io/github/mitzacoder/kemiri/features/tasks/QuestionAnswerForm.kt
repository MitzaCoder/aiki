package io.github.mitzacoder.kemiri.features.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.features.chat.markdownText
import io.github.mitzacoder.kemiri.protocol.BoardQuestion
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import io.github.mitzacoder.kemiri.ui.theme.Text as TextStyles

internal fun questionCanAnswer(question: BoardQuestion, readOnly: Boolean = false): Boolean = question.status == "open" && !readOnly
internal fun questionCanAnswerExpanded(question: BoardQuestion, readOnly: Boolean = false): Boolean = questionCanAnswer(question, readOnly) && !isWarning(question)

/** Both presentations edit the card's one draft and invoke the card's one guarded send action. */
@Composable
internal fun QuestionAnswerForm(
    question: BoardQuestion,
    text: String,
    onTextChange: (String) -> Unit,
    busy: Boolean,
    problem: String?,
    onSend: (String) -> Unit,
    compact: Boolean = false,
    expanded: Boolean = false,
    maxChoicesHeight: Dp = 112.dp,
) {
    val colors = Jarvis.colors
    val warning = isWarning(question)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!warning && question.options.isNotEmpty()) {
            val choicesScroll = if (expanded) Modifier.heightIn(max = maxChoicesHeight).verticalScroll(rememberScrollState()) else Modifier
            Column(choicesScroll.semantics { contentDescription = "Suggested answers" }) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    question.options.forEach { option ->
                        Surface(
                            onClick = { onSend(option) },
                            enabled = !busy,
                            shape = RoundedCornerShape(50),
                            color = colors.surface,
                            border = BorderStroke(1.dp, colors.border),
                            modifier = Modifier.heightIn(min = 32.dp),
                        ) {
                            Box(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), contentAlignment = Alignment.CenterStart) {
                                Text(markdownText(option), style = TaskType.xsMedium, color = colors.fg)
                            }
                        }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                modifier = Modifier.weight(1f).semantics { contentDescription = if (warning) "Note for ${question.id}" else "Answer to ${question.id}" },
                placeholder = { Text(if (warning) "Add a note (optional)" else if (question.options.isNotEmpty()) "Or answer in your own words" else "Your answer", style = TaskType.xs) },
                textStyle = if (expanded) TextStyles.base else TextStyles.sm,
                minLines = if (expanded || compact) 1 else 2,
                maxLines = if (expanded) 2 else 5,
                enabled = !busy,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                shape = RoundedCornerShape(10.dp),
            )
            if (warning) {
                Button(onClick = { onSend(text.trim().ifEmpty { "Acknowledged" }) }, enabled = !busy, contentPadding = PaddingValues(horizontal = 12.dp)) {
                    LucideGlyph(Lucide.Check, size = 16.dp)
                    Spacer(Modifier.width(6.dp))
                    Text("Acknowledge")
                }
            } else {
                FilledIconButton(onClick = { onSend(text) }, enabled = !busy && text.isNotBlank()) {
                    LucideGlyph(TaskIcons.Send, size = 16.dp, contentDescription = "Send the answer to ${question.id}")
                }
            }
        }
        problem?.let {
            val errorScroll = if (expanded) Modifier.heightIn(max = 48.dp).verticalScroll(rememberScrollState()) else Modifier
            Text(it, errorScroll, style = TaskType.xs, color = colors.danger)
        }
    }
}
