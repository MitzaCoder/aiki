package io.github.mitzacoder.kemiri.features.tasks.media

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.features.tasks.TaskType
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/**
 * Edits one artifact's tags in place (web `TagEditor`): the tags as removable chips, an input that completes from the
 * task's tags, then the project's, then the suggested ones (shown as chips to tap), and Done. Enter or a comma adds what
 * is typed, Backspace on an empty input takes the last tag off. Every change is sent at once through [onChange]; the
 * parent gives the stored tags back.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TagEditor(
    tags: List<String>,
    task: List<String>,
    project: List<String>,
    busy: Boolean,
    problem: String?,
    onChange: (List<String>) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Jarvis.colors
    var typed by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val suggestions = suggestTags(typed, current = tags, task = task, project = project)
    val full = tags.size >= ARTIFACT_MAX_TAGS
    val bring = remember { androidx.compose.foundation.relocation.BringIntoViewRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() }; kotlinx.coroutines.delay(350); runCatching { bring.bringIntoView() } }

    fun add(text: String) {
        val next = addTags(tags, text)
        typed = ""
        if (next != tags) onChange(next)
    }

    Column(modifier.fillMaxWidth().bringIntoViewRequester(bring).semantics { contentDescription = "Edit tags" }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val fieldShape = RoundedCornerShape(12.dp)
        FlowRow(
            Modifier.fillMaxWidth().clip(fieldShape).background(colors.surface.copy(alpha = .7f)).border(1.dp, colors.accent2.copy(alpha = .45f), fieldShape).padding(horizontal = 6.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            tags.forEach { tag ->
                Row(
                    Modifier.clip(RoundedCornerShape(50)).background(colors.accent2.copy(alpha = .14f)).border(1.dp, colors.accent2.copy(alpha = .30f), RoundedCornerShape(50)).padding(start = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(tag, style = TaskType.xsMedium, color = colors.fg)
                    Box(
                        Modifier.size(32.dp).clickable(enabled = !busy, role = Role.Button, onClickLabel = "Remove the tag $tag") { onChange(removeTag(tags, tag)) },
                        contentAlignment = Alignment.Center,
                    ) { LucideGlyph(Lucide.X, size = 12.dp, tint = colors.fgMuted, contentDescription = "Remove the tag $tag") }
                }
            }
            BasicTextField(
                value = typed,
                onValueChange = { value -> if (value.any { it == ',' || it == ';' }) add(value) else typed = value },
                modifier = Modifier.widthIn(min = 96.dp).weight(1f).heightIn(min = 40.dp).focusRequester(focus)
                    .onPreviewKeyEvent { event ->
                        if (event.type == KeyEventType.KeyDown && event.key == Key.Backspace && typed.isEmpty() && tags.isNotEmpty()) { onChange(removeTag(tags, tags.last())); true } else false
                    }
                    .semantics { contentDescription = "Add a tag" },
                enabled = !full,
                singleLine = true,
                textStyle = TaskType.xs.copy(fontSize = androidx.compose.ui.unit.TextUnit(14f, androidx.compose.ui.unit.TextUnitType.Sp), color = colors.fg),
                cursorBrush = SolidColor(colors.accent2),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (typed.isNotBlank()) add(typed) else onClose() }),
                decorationBox = { inner ->
                    Box(Modifier.padding(horizontal = 6.dp), contentAlignment = Alignment.CenterStart) {
                        if (typed.isEmpty()) Text(if (full) "At most $ARTIFACT_MAX_TAGS tags" else "Add a tag…", style = TaskType.xs.copy(fontSize = androidx.compose.ui.unit.TextUnit(14f, androidx.compose.ui.unit.TextUnitType.Sp)), color = colors.fgSubtle)
                        inner()
                    }
                },
            )
            Row(
                Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(50)).clickable(role = Role.Button, onClickLabel = "Done editing tags", onClick = onClose)
                    .background(colors.accent2.copy(alpha = .12f)).padding(horizontal = 12.dp).semantics { contentDescription = "Done editing tags" },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                LucideGlyph(Lucide.Check, size = 14.dp, tint = colors.accent2)
                Text("Done", style = TaskType.xsMedium, color = colors.accent2)
            }
        }
        if (suggestions.isNotEmpty() && !full) FlowRow(
            Modifier.fillMaxWidth().semantics { contentDescription = "Suggested tags" },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            suggestions.forEach { suggestion ->
                val dash = colors.borderStrong
                Row(
                    Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(50))
                        .drawBehind { drawRoundRect(dash, cornerRadius = CornerRadius(size.height / 2f), style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 5f)))) }
                        .clickable(enabled = !busy, role = Role.Button, onClickLabel = "Add the tag $suggestion") { add(suggestion) }
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    LucideGlyph(Lucide.Plus, size = 12.dp, tint = colors.fgMuted)
                    Text(suggestion, style = TaskType.xs, color = colors.fgMuted)
                }
            }
        }
        problem?.let { Text(it, style = TaskType.xs, color = colors.danger, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }) }
    }
}
