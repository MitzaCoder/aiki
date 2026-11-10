package io.github.mitzacoder.aiki.features.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/**
 * Picks one of a list that can be long (models, providers): a button showing the current value (name and a second line)
 * that opens a bottom sheet with a search box and the options grouped under headings (web `Combobox`). The search box
 * shows for more than [COMBOBOX_SEARCH_THRESHOLD] options and is not focused on open, so the keyboard stays down on touch.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun Combobox(
    options: List<ComboOption>,
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String = "Choose…",
    searchPlaceholder: String = "Search…",
    emptyText: String = "Nothing matches.",
    enabled: Boolean = true,
    invalid: Boolean = false,
    selectedContent: (@Composable (ComboOption?) -> Unit)? = null,
    optionLeading: (@Composable (ComboOption) -> Unit)? = null,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val colors = Jarvis.colors
    val current = options.firstOrNull { it.value == value }
    Surface(
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).semantics {
            role = Role.DropdownList
            contentDescription = "$label: ${current?.label ?: placeholder}"
            stateDescription = if (enabled) "Opens a list" else "Unavailable"
        },
        shape = RoundedCornerShape(10.dp), color = if (enabled) colors.bg.copy(alpha = 0f) else colors.surface2.copy(alpha = .4f),
        border = BorderStroke(1.dp, if (invalid) colors.danger else colors.borderStrong),
        onClick = { open = true }, enabled = enabled,
    ) {
        Row(Modifier.padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) {
                if (selectedContent != null) selectedContent(current)
                else if (current != null) Column {
                    Text(current.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    current.description?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                } else Text(placeholder, style = MaterialTheme.typography.bodyMedium, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            LucideGlyph(Lucide.ChevronDown, size = 16.dp, tint = colors.fgSubtle)
        }
    }
    if (open) {
        val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(onDismissRequest = { open = false }, sheetState = sheet, containerColor = cardColor(colors)) {
            ComboboxList(options, value, label, searchPlaceholder, emptyText, optionLeading) { picked -> open = false; onChange(picked) }
        }
    }
}

@Composable
private fun ComboboxList(
    options: List<ComboOption>,
    value: String,
    label: String,
    searchPlaceholder: String,
    emptyText: String,
    optionLeading: (@Composable (ComboOption) -> Unit)?,
    pick: (String) -> Unit,
) {
    val colors = Jarvis.colors
    var query by rememberSaveable { mutableStateOf("") }
    val groups = remember(options, query) { filterOptions(options, query) }
    Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).navigationBarsPadding().imePadding()) {
        Text(label, Modifier.padding(horizontal = 20.dp, vertical = 4.dp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (showsSearch(options)) OutlinedTextField(
            query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), singleLine = true,
            placeholder = { Text(searchPlaceholder) },
            leadingIcon = { LucideGlyph(Lucide.Search, size = 18.dp, tint = colors.fgSubtle) },
            trailingIcon = if (query.isNotEmpty()) ({ IconButton(onClick = { query = "" }) { LucideGlyph(Lucide.X, size = 16.dp, contentDescription = "Clear the search") } }) else null,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
        )
        if (groups.isEmpty()) Text(emptyText, Modifier.padding(20.dp), style = MaterialTheme.typography.bodyMedium, color = colors.fgMuted)
        LazyColumn(Modifier.weight(1f, fill = false), contentPadding = PaddingValues(bottom = 12.dp)) {
            groups.forEach { group ->
                group.label?.let { heading ->
                    item(key = "h:${group.id}") {
                        Text(heading.uppercase(), Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold, color = colors.fgSubtle)
                    }
                }
                items(group.options, key = { "o:${group.id}:${it.value}" }) { option ->
                    val selected = option.value == value
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp)
                            .background(if (selected) colors.surface2.copy(alpha = .7f) else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable(enabled = !option.disabled, role = Role.RadioButton) { pick(option.value) }
                            .semantics { stateDescription = if (selected) "Selected" else "Not selected" }
                            .padding(horizontal = 20.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        optionLeading?.invoke(option)
                        Column(Modifier.weight(1f)) {
                            Text(option.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            option.description?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        }
                        option.badge?.let { StatusChip(it, if (option.badgeWarn) ChipTone.Warn else ChipTone.Muted, dot = false) }
                        if (selected) LucideGlyph(Lucide.Check, size = 18.dp, tint = colors.accent2)
                    }
                }
            }
        }
    }
}

/**
 * A model's thinking level as a dropdown: "Model default" and the levels the model lists, each with four small bars that
 * fill with the effort (web `ThinkingSelect`). The empty string is "Model default" (null on the wire).
 */
@Composable
internal fun ThinkingSelect(
    levels: List<String>,
    value: String?,
    onChange: (String?) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    label: String = "Thinking level",
) {
    val options = remember(levels, value) { thinkingOptions(levels, value) }
    val asLevel = { key: String -> key.ifEmpty { null } }
    Combobox(
        options, value ?: "", { onChange(asLevel(it)) }, label, modifier, placeholder = "Model default", enabled = enabled,
        selectedContent = { option ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ThinkingBars(thinkingBars(asLevel(option?.value ?: "")))
                Text(option?.label ?: "Model default", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
        optionLeading = { ThinkingBars(thinkingBars(asLevel(it.value))) },
    )
}

/** Four bars that fill with the effort. */
@Composable
internal fun ThinkingBars(lit: Int) {
    val colors = Jarvis.colors
    Row(Modifier.height(14.dp).semantics { contentDescription = "$lit of 4" }, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        (1..4).forEach { bar ->
            Box(Modifier.width(3.dp).fillMaxHeight(0.35f + bar * 0.16f).background(if (bar <= lit) colors.accent2 else colors.borderStrong, RoundedCornerShape(50)))
        }
    }
}
