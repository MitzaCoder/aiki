package com.mihaisaru.harness.features.settings

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.theme.Jarvis
import com.mihaisaru.harness.ui.theme.JarvisColors
import com.mihaisaru.harness.ui.theme.mix

/**
 * The building blocks every settings section is made of, the Android twins of the web's `lib/components/settings`:
 * section header, grouped rows (label and a one-line hint on the left, the control on the right or, narrow, under it),
 * "Learn more" disclosures, per-field save states, status chips. Nothing here is theme-specific: it reads the tokens.
 */

/** Below this width a row stacks its control under its label (the web's `sm`). */
internal val ROW_SIDE_BY_SIDE_WIDTH = 520.dp

/** How a row places its control: `Wide` suits a combobox, `Auto` a short input or a button, `Full` takes the whole row, `Inline` (a switch, a chip) stays beside the label even on a phone. */
enum class RowControl { Wide, Auto, Full, Inline }

@Composable
internal fun cardColor(colors: JarvisColors = Jarvis.colors): Color = if (colors.dark) colors.surface else Color.White

/** The icon tile of a section: a wash of the theme's gradient behind the icon. */
@Composable
internal fun SectionIconTile(icon: SettingsIcon, size: Dp = 44.dp, modifier: Modifier = Modifier) {
    val colors = Jarvis.colors
    val wash = Brush.linearGradient(listOf(colors.accent1.mix(colors.surface, 18f), colors.accent3.mix(colors.surface, 16f)))
    Box(
        modifier.size(size).clip(RoundedCornerShape(12.dp)).background(wash),
        contentAlignment = Alignment.Center,
    ) { LucideGlyph(settingsIconGlyph(icon), size = size * 0.45f, tint = colors.accent2) }
}

/** What every section starts with: its icon, a title, one line saying what it is for, and its groups below. */
@Composable
internal fun SettingsSectionPage(
    title: String,
    description: String?,
    icon: SettingsIcon,
    modifier: Modifier = Modifier,
    actions: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
            SectionIconTile(icon)
            Column(Modifier.weight(1f).padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                description?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Jarvis.colors.fgMuted) }
            }
            actions?.invoke()
        }
        content()
    }
}

/**
 * A titled surface that holds rows, divided by hairlines. It lifts off the page with a ring; [danger] tints the edge for
 * things that cannot be undone. [actions] sits on the title's right.
 */
@Composable
internal fun SettingsGroup(
    modifier: Modifier = Modifier,
    title: String? = null,
    description: String? = null,
    danger: Boolean = false,
    actions: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Jarvis.colors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title != null || actions != null) Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = if (actions != null) Alignment.CenterVertically else Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                title?.let { Text(it.uppercase(), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = colors.fgSubtle, letterSpacing = 0.6.sp) }
                description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.fgMuted) }
            }
            actions?.invoke()
        }
        Surface(
            Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = cardColor(colors),
            border = BorderStroke(1.dp, if (danger) colors.danger.copy(alpha = .35f) else colors.border), shadowElevation = 1.dp,
        ) { Column(Modifier.fillMaxWidth(), content = content) }
    }
}

/** A row in a group: padding and the hairline under it (the last one lies on the group's own edge). */
@Composable
internal fun GroupRow(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val line = Jarvis.colors.border
    Column(
        modifier.fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .drawBehind { drawLine(line, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1f) }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        content = content,
    )
}

/**
 * One setting: its label and a one-line hint on the left, the control on the right (stacked, full width, on a phone).
 * [learn] is the longer explanation, behind a "Learn more" disclosure. [status] is this field's own save state; [below]
 * spans the whole row, for a preview or a warning about this field.
 */
@Composable
internal fun SettingsRow(
    label: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    learn: (@Composable () -> Unit)? = null,
    status: SaveState? = null,
    onRetry: (() -> Unit)? = null,
    control: RowControl = RowControl.Wide,
    below: (@Composable ColumnScope.() -> Unit)? = null,
    controlContent: (@Composable ColumnScope.() -> Unit)? = null,
) {
    GroupRow(modifier) {
        BoxWithConstraints {
            val inline = control == RowControl.Inline
            val wide = inline || (maxWidth >= ROW_SIDE_BY_SIDE_WIDTH && control != RowControl.Full)
            @Composable fun labels(m: Modifier) = Column(m, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted) }
                learn?.let { LearnMore(content = it) }
            }
            @Composable fun controlColumn(m: Modifier) = Column(m, verticalArrangement = Arrangement.spacedBy(6.dp),
                horizontalAlignment = if ((control == RowControl.Auto || inline) && wide) Alignment.End else Alignment.Start) {
                controlContent?.invoke(this)
                status?.let { if (!inline) SaveStatusLine(it, onRetry) }
            }
            Column(Modifier.fillMaxWidth()) {
            if (wide) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.Top) {
                labels(Modifier.weight(1f))
                if (controlContent != null || status != null) controlColumn(if (control == RowControl.Wide) Modifier.width(320.dp) else Modifier.widthIn(max = 320.dp))
            }
            if (inline && status != null) Box(Modifier.padding(top = 4.dp)) { SaveStatusLine(status, onRetry, reserve = false) }
            if (!wide) Column(Modifier.fillMaxWidth()) {
                labels(Modifier.fillMaxWidth())
                if (controlContent != null || status != null) controlColumn(Modifier.fillMaxWidth().padding(top = 10.dp))
            }
            }
        }
        below?.let { Column(Modifier.fillMaxWidth().padding(top = 10.dp), content = it) }
    }
}

/**
 * The longer explanation behind a one-line hint: a disclosure under the hint, never a tooltip (tooltips do not work on
 * touch). Closed by default.
 */
@Composable
internal fun LearnMore(label: String = "Learn more", content: @Composable () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val turn by animateFloatAsState(if (open) 90f else 0f, label = "learn more chevron")
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(6.dp))
                .clickable(role = Role.Button, onClickLabel = if (open) "Hide" else "Show") { open = !open }
                .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
                .padding(end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LucideGlyph(Lucide.ChevronRight, Modifier.rotate(turn), size = 14.dp, tint = Jarvis.colors.accent2)
            Spacer(Modifier.width(2.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = Jarvis.colors.accent2)
        }
        if (open) Surface(shape = RoundedCornerShape(8.dp), color = Jarvis.colors.surface2.copy(alpha = .6f)) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                CompositionLocalProvider(LocalTextStyle provides MaterialTheme.typography.bodySmall.copy(color = Jarvis.colors.fgMuted)) { content() }
            }
        }
    }
}

/**
 * A field's save state: a spinner while it saves, a check for a moment after, and on a failure the reason, kept until the
 * next try. It reserves its line so a row does not jump when the state changes.
 */
@Composable
internal fun SaveStatusLine(state: SaveState, onRetry: (() -> Unit)? = null, reserve: Boolean = true) {
    val colors = Jarvis.colors
    Box(Modifier.fillMaxWidth().then(if (reserve) Modifier.heightIn(min = 20.dp) else Modifier)) {
        when (state.status) {
            SaveStatus.Saving -> Row(Modifier.semantics { contentDescription = "Saving" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = colors.fgMuted)
                Text("Saving…", style = MaterialTheme.typography.labelMedium, color = colors.fgMuted)
            }
            SaveStatus.Saved -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                LucideGlyph(Lucide.Check, size = 14.dp, tint = colors.success)
                Text("Saved", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = colors.success)
            }
            SaveStatus.Failed -> Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                LucideGlyph(Lucide.CircleAlert, Modifier.padding(top = 2.dp), size = 14.dp, tint = colors.danger)
                Column {
                    Text(state.error ?: "Not saved.", style = MaterialTheme.typography.labelMedium, color = colors.danger)
                    onRetry?.let { Text("Try again", Modifier.clickable(role = Role.Button, onClick = it).heightIn(min = 32.dp).wrapContentHeight(Alignment.CenterVertically),
                        style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = colors.danger, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline) }
                }
            }
            SaveStatus.Idle -> Unit
        }
    }
}

@Composable
internal fun chipColor(tone: ChipTone): Color = when (tone) {
    ChipTone.Ok -> Jarvis.colors.success
    ChipTone.Warn -> Jarvis.colors.warning
    ChipTone.Err -> Jarvis.colors.danger
    ChipTone.Info -> Jarvis.colors.accent2
    ChipTone.Muted -> Jarvis.colors.fgMuted
}

/**
 * A small state label (connected, configured, signed in, paused). The colour comes from the theme's success, warning and
 * danger tones; the words carry the meaning, the colour only helps.
 */
@Composable
internal fun StatusChip(label: String, tone: ChipTone = ChipTone.Muted, modifier: Modifier = Modifier, dot: Boolean = true, icon: com.mihaisaru.harness.ui.components.LucideIcon? = null) {
    val colors = Jarvis.colors
    val chip = chipColor(tone)
    Surface(
        modifier, shape = CircleShape, color = chip.copy(alpha = .11f), contentColor = chip.mix(colors.fg, 78f),
        border = BorderStroke(1.dp, chip.copy(alpha = .30f)),
    ) {
        Row(Modifier.heightIn(min = 24.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (dot) Box(Modifier.size(6.dp).background(chip, CircleShape))
            icon?.let { LucideGlyph(it, size = 12.dp) }
            Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, maxLines = 1)
        }
    }
}

/** A switch with its meaning for a screen reader (the row's label is not part of it). */
@Composable
internal fun SettingsSwitch(checked: Boolean, onChange: (Boolean) -> Unit, label: String, enabled: Boolean = true) {
    Switch(checked, onChange, enabled = enabled, modifier = Modifier.semantics { contentDescription = label })
}

/** A text or number field that saves when it is left (focus lost, or the keyboard's Done), like the web's `AutoInput`. */
@Composable
internal fun AutoInput(
    value: String,
    save: SaveState,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    suffix: String? = null,
    enabled: Boolean = true,
    numeric: Boolean = false,
    mono: Boolean = false,
    label: String? = null,
    commit: suspend (String) -> Unit,
) {
    var text by rememberSaveable(value) { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    fun leave() {
        val next = text.trim()
        if (next == value.trim()) { if (text != value) text = value; return }
        save.launch { commit(next) }
    }
    OutlinedTextField(
        text, { text = it; if (save.status == SaveStatus.Failed) save.reset() }, modifier.fillMaxWidth()
            .onFocusChanged { if (focused && !it.isFocused) leave(); focused = it.isFocused }
            .then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier),
        enabled = enabled, singleLine = true,
        placeholder = placeholder?.let { { Text(it) } },
        suffix = suffix?.let { { Text(it) } },
        isError = save.status == SaveStatus.Failed,
        textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = if (mono) FontFamily.Monospace else MaterialTheme.typography.bodyMedium.fontFamily),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, autoCorrectEnabled = false,
            keyboardType = if (numeric) androidx.compose.ui.text.input.KeyboardType.Number else androidx.compose.ui.text.input.KeyboardType.Text),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
    )
}

/** A short read-only value (an address, a folder) in monospace with a copy button. */
@Composable
internal fun CopyableValue(text: String, copyLabel: String, modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Surface(Modifier.weight(1f, fill = false), shape = RoundedCornerShape(8.dp), color = Jarvis.colors.surface2.copy(alpha = .6f)) {
            Text(text, Modifier.padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace)
        }
        IconButton(onClick = {
            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText(copyLabel, text))
        }) { LucideGlyph(Lucide.Copy, size = 16.dp, contentDescription = copyLabel) }
    }
}

/** A line of text in a row that is not a label and hint (an empty list, a note). */
@Composable
internal fun GroupNote(text: String, modifier: Modifier = Modifier, center: Boolean = true) {
    Text(
        text, modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 22.dp), style = MaterialTheme.typography.bodyMedium,
        color = Jarvis.colors.fgMuted, textAlign = if (center) androidx.compose.ui.text.style.TextAlign.Center else null,
    )
}

/** A row that opens another screen: icon or nothing, a label and hint, an optional chip and a chevron. */
@Composable
internal fun LinkRow(label: String, hint: String?, onClick: () -> Unit, modifier: Modifier = Modifier, leading: (@Composable () -> Unit)? = null, chip: (@Composable () -> Unit)? = null) {
    GroupRow(modifier.heightIn(min = 56.dp).semantics { role = Role.Button }, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            leading?.invoke()
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            chip?.invoke()
            LucideGlyph(Lucide.ChevronRight, size = 16.dp, tint = Jarvis.colors.fgSubtle)
        }
    }
}

/** Usage's empty state: nothing to show until a subscription provider is signed in on a backend. */
@Composable
fun UsageEmptyNote() {
    SettingsGroup { GroupNote("No subscription usage. Sign in to a subscription provider under Settings → Backends → Accounts and API keys. API-key billing is not shown here.") }
}

/** Makes a full-screen dialog's status and navigation bar icons readable on the theme's background (a dialog window has its own). */
@Composable
internal fun DialogSystemBars() {
    val view = androidx.compose.ui.platform.LocalView.current
    val dark = Jarvis.colors.dark
    SideEffect {
        (view.parent as? androidx.compose.ui.window.DialogWindowProvider)?.window?.let { window ->
            androidx.core.view.WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
}
