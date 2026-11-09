package com.mihaisaru.harness.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldDecorator
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.ui.components.GlassComposerSurface
import com.mihaisaru.harness.ui.components.JarvisIconButton
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.theme.Jarvis

/** The same message input in chat and task replies; callers own intake, drafts and sending. */
@Composable
internal fun MessageComposer(
    textState: TextFieldState,
    hint: String,
    images: List<DraftImage>,
    onRemoveImage: (String) -> Unit,
    attaching: Boolean,
    attachEnabled: Boolean,
    onAttach: () -> Unit,
    sendLabel: String,
    sendEnabled: Boolean,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    fieldModifier: Modifier = Modifier,
    inputTransformation: InputTransformation? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    hintMaxLines: Int = Int.MAX_VALUE,
    beforeInput: @Composable ColumnScope.() -> Unit = {},
    afterInput: @Composable ColumnScope.() -> Unit = {},
    controls: @Composable RowScope.() -> Unit = { Spacer(Modifier.weight(1f)) },
) {
    GlassComposerSurface(modifier) {
        beforeInput()
        if (images.isNotEmpty()) ImageThumbs(images, onRemove = onRemoveImage, modifier = Modifier.padding(horizontal = 8.dp))
        BasicTextField(
            state = textState,
            inputTransformation = inputTransformation,
            lineLimits = TextFieldLineLimits.MultiLine(),
            keyboardOptions = keyboardOptions,
            modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp, max = 200.dp).padding(horizontal = 8.dp).then(fieldModifier),
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = Jarvis.colors.fg),
            cursorBrush = SolidColor(Jarvis.colors.accent2),
            decorator = TextFieldDecorator { field ->
                Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.CenterStart) {
                    if (textState.text.isEmpty()) Text(hint, style = MaterialTheme.typography.bodyLarge, color = Jarvis.colors.fgSubtle,
                        maxLines = hintMaxLines, overflow = if (hintMaxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis)
                    field()
                }
            },
        )
        afterInput()
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            JarvisIconButton(Lucide.Paperclip, if (attaching) "Reading images" else "Attach images", enabled = attachEnabled, onClick = onAttach)
            controls()
            JarvisIconButton(Lucide.ArrowUp, sendLabel, emphasized = true, enabled = sendEnabled, onClick = onSend)
        }
    }
}
