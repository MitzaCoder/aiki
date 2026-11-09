package com.mihaisaru.harness.features.panels

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import com.mihaisaru.harness.features.chat.HarnessMarkdown
import com.mihaisaru.harness.features.status.StatusGlyphs
import com.mihaisaru.harness.ui.theme.Jarvis
import kotlinx.coroutines.launch
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import com.mihaisaru.harness.ui.components.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.navigation.*
import com.mihaisaru.harness.protocol.*

@Composable internal fun InfoPanel(context: ProjectScreenContext) {
    // Context pushes are sent only while a conversation watch exists.
    val watch = remember(context.backend.client, context.target) { ConversationWatch(context.backend.client, context.target) }
    DisposableEffect(watch) { onDispose { watch.close() } }
    val route = context.route
    val data = panelData(context, Unit, { it is ConversationContextEvent && matchesContext(route, it.context) }) {
        context.backend.client.request(ConversationContextRequest(projectId = route.projectId, threadId = route.threadId, workerId = route.workerId)).context
    }
    val draftKey = boardDraftKey(context.backend.config.key, route.projectId, "info", "${route.threadId}/${route.workerId}")
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    var skillFilter by rememberSaveable(draftKey) { mutableStateOf("") }
    var toolFilter by rememberSaveable(draftKey) { mutableStateOf("") }
    var instructions by rememberSaveable(draftKey) { mutableStateOf("") }
    var compactDialog by rememberSaveable(draftKey) { mutableStateOf(false) }
    var requested by rememberSaveable(draftKey) { mutableStateOf(false) }
    val androidContext = LocalContext.current
    fun copy(label: String, text: String) {
        val clipboard = androidContext.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText(label, text))
    }
    // The overview's counts jump to their sections, as on the web.
    val agentsSection = remember { BringIntoViewRequester() }
    val skillsSection = remember { BringIntoViewRequester() }
    val toolsSection = remember { BringIntoViewRequester() }
    val promptSection = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    var missDetail by rememberSaveable(draftKey) { mutableStateOf(false) }
    // Relative times ("last 5 min ago") move on while the panel is open.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(60_000); now = System.currentTimeMillis() } }
    PanelBody(data) { info ->
        if (connection.supports("artifacts")) ConversationArtifacts(context)
        info.usage?.let { usage ->
            val view = contextUsageView(usage, now)
            PanelCard("CONTEXT USAGE", header = {
                // Only a coordinator's conversation can be compacted from the app.
                if (route.workerId == null) OutlinedButton(
                    onClick = { compactDialog = true },
                    enabled = !usage.compacting && connection.status == ConnectionStatus.Ready,
                    contentPadding = PaddingValues(horizontal = 10.dp),
                    modifier = Modifier.heightIn(min = 32.dp),
                ) {
                    LucideGlyph(Lucide.Archive, size = 14.dp)
                    Spacer(Modifier.width(6.dp))
                    Text("Compact now", style = MaterialTheme.typography.labelMedium)
                }
            }) {
                if (view.measured) {
                    ContextUsageMeter(view)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("${view.tokensLabel} tokens", color = Jarvis.colors.fgMuted)
                        Text(view.percentLabel, style = MaterialTheme.typography.labelMedium, color = Jarvis.colors.fgMuted)
                    }
                } else Text("No model is set, so there is no context window to measure.", color = Jarvis.colors.fgSubtle)
                if (view.thresholdsLabel.isNotEmpty()) Text(view.thresholdsLabel, style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(view.compactionsLabel, style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                    if (usage.compacting) {
                        CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
                        Text("Compacting…", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted)
                    }
                }
                cacheMissTotalsView(usage.cacheMisses)?.let { misses ->
                    // Amber when some misses had no cause: worth a look. A tap shows the whole story.
                    Row(Modifier.fillMaxWidth().clickable { missDetail = !missDetail }.semantics(mergeDescendants = true) { contentDescription = misses.label + ". " + misses.title },
                        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        LucideGlyph(StatusGlyphs.Coins, Modifier.padding(top = 2.dp), size = 12.dp, tint = if (misses.warning) Jarvis.colors.warning else Jarvis.colors.fgSubtle)
                        Text(misses.label, color = if (misses.warning) Jarvis.colors.fgMuted else Jarvis.colors.fgSubtle, style = MaterialTheme.typography.labelSmall)
                    }
                    if (missDetail) Text(misses.title, style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                }
            }
        }
        if (info.usage == null && route.workerId == null) TextButton(enabled = connection.status == ConnectionStatus.Ready, onClick = { compactDialog = true }) { Text("Compact context…") }
        if (requested) Text("Compaction requested; waiting for the backend.", style = MaterialTheme.typography.bodySmall)
        val agentsFiles = info.contextFiles.filter { contextFileKind(it) == "agents" }
        val promptFiles = info.contextFiles.filter { contextFileKind(it) != "agents" }
        fun jump(target: BringIntoViewRequester) = scope.launch { target.bringIntoView() }
        val sections = mapOf(ContextSection.Agents to agentsSection, ContextSection.Skills to skillsSection, ContextSection.Tools to toolsSection, ContextSection.Prompt to promptSection)
        // Two tiles a row, four once the panel is wide enough (web: 34rem).
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val perRow = if (maxWidth >= 544.dp) 4 else 2
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                contextOverview(info).chunked(perRow).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { item -> OverviewTile(item, Modifier.weight(1f)) { jump(sections.getValue(item.section)) } }
                    }
                }
            }
        }
        listOf("PROJECT" to info.projectPath, "WORKING DIRECTORY" to info.cwd).distinctBy { it.second }.forEach { (label, path) ->
            Column {
                Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(humanPath(path, info.homeDir), Modifier.weight(1f), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    IconAction("Copy ${label.lowercase()}", Lucide.Copy) { copy(label, path) }
                }
            }
        }
        // A system prompt file is labelled by what it is, an AGENTS.md by where it comes from; each opens to its Markdown.
        @Composable fun FileRow(file: ContextFile) {
            val kind = contextFileKind(file)
            val shown = when (kind) { "agents" -> projectPath(file.path, info); "model" -> contextFileName(file); else -> contextFileOriginLabel(file, info.projectPath) }
            PanelDisclosure("${contextFileBadge(file, info.projectPath)} · $shown", textSize(file.content)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(file.path, Modifier.weight(1f), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                    IconAction("Copy the file's path", Lucide.Copy) { copy("Path", file.path) }
                }
                HarnessMarkdown(file.content, Modifier.fillMaxWidth())
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("SYSTEM PROMPT FILES (${promptFiles.size})", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (promptFiles.isEmpty()) Text("No SYSTEM.md or APPEND_SYSTEM.md: the harness's own sections and the AGENTS.md files only.", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
            promptFiles.forEach { FileRow(it) }
        }
        Column(Modifier.bringIntoViewRequester(agentsSection), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("AGENTS.MD (${agentsFiles.size})", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (agentsFiles.isEmpty()) Text("No AGENTS.md files in the system prompt.", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
            agentsFiles.forEach { FileRow(it) }
        }
        // Skills as on the web: the ones this conversation read first and in view, the rest folded under Available once
        // there are more than six; each by source (Harness, pi, Claude), then scope. A filter shows the matches instead.
        Box(Modifier.bringIntoViewRequester(skillsSection)) { PanelDisclosure("SKILLS", info.skills.size.toString(), initiallyExpanded = true) {
            if (info.skills.isEmpty()) Text("No skills are offered to this conversation.", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
            else {
                if (info.skills.size > 8) FilterField(skillFilter, "Filter skills") { skillFilter = it }
                @Composable fun Sources(sources: List<SkillSourceGroup>, showRead: Boolean) = sources.forEach { group ->
                    Column {
                        GroupLabel(group.label, group.skills.size, muted = true)
                        group.scopes.forEach { scope ->
                            GroupLabel(scope.label.uppercase(), scope.skills.size, Modifier.padding(start = 12.dp))
                            scope.skills.forEach { SkillRow(it, projectPath(it.path, info), showRead) { copy("Path", it.path) } }
                        }
                    }
                }
                if (skillFilter.isNotBlank()) {
                    val matched = skillGroups(filterSkills(info.skills, skillFilter))
                    val matches = matched.read + matched.available
                    GroupLabel("MATCHES", matches.size)
                    Sources(skillSourceGroups(matches), showRead = true)
                    if (matches.isEmpty()) Text("No skills match \"${skillFilter.trim()}\".", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
                } else {
                    val groups = skillGroups(info.skills)
                    if (groups.read.isNotEmpty()) {
                        GroupLabel("READ IN THIS CONVERSATION", groups.read.size)
                        Sources(skillSourceGroups(groups.read), showRead = false)
                    }
                    if (groups.available.isNotEmpty()) PanelDisclosure("AVAILABLE", groups.available.size.toString(), initiallyExpanded = groups.available.size <= 6) {
                        Sources(skillSourceGroups(groups.available), showRead = true)
                    }
                }
            }
        } }
        val toolGroups = groupTools(filterTools(info.tools, toolFilter))
        Box(Modifier.bringIntoViewRequester(toolsSection)) { PanelDisclosure("TOOLS", info.tools.size.toString(), initiallyExpanded = true) {
            if (info.tools.isEmpty()) Text("This conversation has no tools.", style = MaterialTheme.typography.bodySmall)
            if (info.tools.size > 15) FilterField(toolFilter, "Filter tools") { toolFilter = it }
            if (info.tools.isNotEmpty() && toolGroups.isEmpty()) Text("No tools match \"${toolFilter.trim()}\".", style = MaterialTheme.typography.bodySmall)
            toolGroups.forEach { group ->
                Column {
                    Row(Modifier.padding(top = 6.dp, bottom = 2.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(group.label.uppercase(), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                        Text(group.tools.size.toString(), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                    }
                    group.tools.forEach { ToolRow(it) }
                }
            }
        } }
        Column(Modifier.bringIntoViewRequester(promptSection)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("SYSTEM PROMPT", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${textSize(info.systemPrompt)} · ${formatTokenEstimate(estimateTokens(info.systemPrompt))}", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                IconAction("Copy the system prompt", Lucide.Copy) { copy("System prompt", info.systemPrompt) }
            }
            Detail("Show the system prompt", info.systemPrompt, monospace = true)
        }
    }
    if (compactDialog && route.workerId == null) AlertDialog(
        onDismissRequest = { compactDialog = false },
        title = { Text("Compact context?") },
        text = {
            Column {
                Text("Summarize older context. The transcript remains available; completion is reported by the backend.")
                OutlinedTextField(instructions, { instructions = it }, label = { Text("Optional instructions") }, modifier = Modifier.fillMaxWidth(), maxLines = 6)
            }
        },
        confirmButton = {
            Action("Compact", enabled = connection.status == ConnectionStatus.Ready && data.value?.usage?.compacting != true,
                after = { compactDialog = false; requested = true; data.refresh.trySend(Unit) }) {
                context.backend.client.request(ConversationCompactRequest(projectId = route.projectId, threadId = route.threadId, instructions = instructions.ifBlank { null }))
            }
        },
        dismissButton = { TextButton(onClick = { compactDialog = false }) { Text("Cancel") } },
    )
}

@Composable private fun ContextUsageMeter(view: ContextUsageView) {
    val colors = Jarvis.colors
    Box(Modifier.fillMaxWidth().height(8.dp).semantics {
        contentDescription = "Context used: ${view.tokensLabel} tokens (${view.percentLabel})"
    }) {
        Canvas(Modifier.fillMaxSize()) {
            val radius = androidx.compose.ui.geometry.CornerRadius(size.height / 2)
            drawRoundRect(colors.surface2, cornerRadius = radius)
            drawRoundRect(colors.accent2, size = size.copy(width = size.width * (view.percent / 100).toFloat()), cornerRadius = radius)
            listOf(view.backgroundPercent to colors.fgSubtle.copy(alpha = 0.6f), view.blockingPercent to colors.fg.copy(alpha = 0.5f)).forEach { (percent, color) ->
                percent?.let {
                    val x = (it / 100).toFloat() * size.width
                    drawLine(color, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1.dp.toPx())
                }
            }
        }
    }
}

/** One overview number: the value, its label, and a hint below it; a tap jumps to its section. */
@Composable private fun OverviewTile(item: ContextOverviewItem, modifier: Modifier, onClick: () -> Unit) {
    OutlinedCard(onClick = onClick, modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "Jump to ${item.label}: ${item.value}${item.detail?.let { ", $it" } ?: ""}" }, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(item.value, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(item.label.uppercase(), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            item.detail?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

/** A search box over one section's rows (web: "Filter skills", "Filter tools"). */
@Composable private fun FilterField(value: String, placeholder: String, onChange: (String) -> Unit) {
    OutlinedTextField(value, onChange, placeholder = { Text(placeholder) }, leadingIcon = { LucideGlyph(Lucide.Search, size = 16.dp) }, singleLine = true,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder })
}

/** A group's heading with its count: "READ IN THIS CONVERSATION (2)", a source ("pi (3)", [muted]) or a scope ("GLOBAL (2)"). */
@Composable private fun GroupLabel(label: String, count: Int, modifier: Modifier = Modifier, muted: Boolean = false) {
    Row(modifier.padding(top = 6.dp, bottom = 2.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, color = if (muted) Jarvis.colors.fgMuted else Jarvis.colors.fgSubtle)
        Text("($count)", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
    }
}

/** A skill as one line, its name and, where [showRead], a "read" mark; a tap shows its description and path (web `skillRow`). */
@Composable private fun SkillRow(skill: SkillInfo, path: String, showRead: Boolean, copyPath: () -> Unit) {
    var open by rememberSaveable(skill.path) { mutableStateOf(false) }
    Column {
        Row(
            Modifier.fillMaxWidth().clickable(onClickLabel = if (open) "Hide the skill" else "Show the skill") { open = !open }.heightIn(min = 32.dp).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, size = 12.dp, tint = Jarvis.colors.fgSubtle)
            Text(skill.name, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (skill.read && showRead) Surface(shape = MaterialTheme.shapes.extraLarge, color = Jarvis.colors.success.copy(alpha = .15f), contentColor = Jarvis.colors.success,
                modifier = Modifier.semantics { contentDescription = "This conversation read this SKILL.md" }) {
                Text("read", Modifier.padding(horizontal = 6.dp, vertical = 1.dp), style = MaterialTheme.typography.labelSmall, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
            }
        }
        if (open) Column(Modifier.padding(start = 22.dp, end = 4.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (skill.description.isNotEmpty()) Text(skill.description, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(path, Modifier.weight(1f), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                IconAction("Copy the skill's path", Lucide.Copy, onClick = copyPath)
            }
        }
    }
}

/** A tool as one short line, its name; a tap shows its description (web: a collapsible row). */
@Composable private fun ToolRow(tool: ToolInfo) {
    var open by rememberSaveable(tool.name) { mutableStateOf(false) }
    val described = tool.description.isNotEmpty()
    Column {
        Row(
            Modifier.fillMaxWidth().then(if (described) Modifier.clickable(onClickLabel = if (open) "Hide the description" else "Show the description") { open = !open } else Modifier)
                .heightIn(min = 32.dp).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (described) LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, size = 12.dp, tint = Jarvis.colors.fgSubtle) else Spacer(Modifier.width(12.dp))
            Text(tool.name, Modifier.weight(1f), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (open) Text(tool.description, Modifier.padding(start = 22.dp, end = 4.dp, bottom = 8.dp), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
    }
}

/** A path inside the project relative to it, else with `~` for the home directory (web `humanPath`). */
private fun projectPath(path: String, info: ConversationContext): String {
    val project = info.projectPath.trimEnd('/')
    val full = path.trimEnd('/')
    return if (full != project && full.startsWith("$project/")) full.removePrefix("$project/") else humanPath(path, info.homeDir)
}

internal fun humanPath(path: String, home: String) = when {
    home.isEmpty() -> path
    path == home -> "~"
    path.startsWith("$home/") -> "~" + path.removePrefix(home)
    else -> path
}
