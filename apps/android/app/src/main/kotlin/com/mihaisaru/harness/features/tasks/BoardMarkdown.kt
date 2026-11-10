package com.mihaisaru.harness.features.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.features.chat.RichMarkdown

internal fun boardMarkdownNeedsDisclosure(source: String): Boolean = source.length > 600 || source.lines().size > 12

/** Compact chat Markdown for questions, warnings and decisions; only rendered content is folded. */
@Composable
fun BoardMarkdown(source: String, modifier: Modifier = Modifier) {
    var expanded by rememberSaveable(source) { mutableStateOf(false) }
    val long = remember(source) { boardMarkdownNeedsDisclosure(source) }
    Column(modifier.widthIn(max = 600.dp)) {
        val fold = if (long && !expanded) Modifier.heightIn(max = 288.dp).verticalScroll(rememberScrollState()) else Modifier
        RichMarkdown(source, fold, userMessage = true, compact = true)
        if (long) TextButton(
            onClick = { expanded = !expanded },
            modifier = Modifier.semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
            contentPadding = PaddingValues(horizontal = 0.dp),
        ) { Text(if (expanded) "Show less" else "Show more", style = TaskType.xs) }
    }
}
