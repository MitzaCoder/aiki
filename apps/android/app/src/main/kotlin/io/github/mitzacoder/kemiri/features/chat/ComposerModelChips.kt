package io.github.mitzacoder.kemiri.features.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import io.github.mitzacoder.kemiri.ui.components.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.features.settings.validThinking
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/** A chip's model: its catalog name, else its ID, else [defaultLabel] ("Choose a model", "Worker default"). */
internal fun composerModelLabel(model: ModelRef?, name: String?, defaultLabel: String): String =
    model?.let { name ?: it.modelId } ?: defaultLabel

/** Every thinking level a model may offer, in order (protocol `THINKING_LEVELS`). */
internal val THINKING_LEVELS = listOf("off","minimal","low","medium","high","xhigh","max")

/** How many of the thinking chip's four bars a level lights (web `EffortPicker`). */
internal fun thinkingIntensity(level: String?): Int = when(level) {
    "minimal","low" -> 1; "medium" -> 2; "high" -> 3; "xhigh","max" -> 4; else -> 0
}

/** A thinking level as the chips name it: the level itself, or "Model default". */
internal fun thinkingLabel(level: String?): String = level ?: "Model default"

/** The models one provider offers, under the provider's name. */
internal data class ModelGroup(val id: String, val label: String, val models: List<ModelInfo>)

/**
 * The models matching [query] (name, ID, provider and its name), grouped by provider and ordered by the provider's name
 * (web `groupModels`). Models without a credential stay in the list; the row says so.
 */
internal fun groupModels(models: List<ModelInfo>, providers: List<ProviderInfo>, query: String): List<ModelGroup> {
    fun providerName(id: String) = providers.firstOrNull { it.id == id }?.name ?: id
    val needle = query.trim().lowercase()
    return models.filter { needle.isEmpty() || "${it.name} ${it.modelId} ${it.provider} ${providerName(it.provider)}".lowercase().contains(needle) }
        .groupBy { it.provider }
        .map { (id,list) -> ModelGroup(id,providerName(id),list) }
        .sortedBy { it.label.lowercase() }
}

private object ChipGlyphs {
    val Cpu = LucideIcon("cpu", "M12 20v2", "M12 2v2", "M17 20v2", "M17 2v2", "M2 12h2", "M2 17h2", "M2 7h2", "M20 12h2", "M20 17h2", "M20 7h2", "M7 20v2", "M7 2v2",
        "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "M9 8h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z")
}

/** The thinking level as four rising bars, lit up to its intensity (web `EffortPicker`'s icon). */
@Composable internal fun ThinkingBars(level: String?, modifier: Modifier = Modifier) {
    val lit = thinkingIntensity(level)
    val colors = Jarvis.colors
    Row(modifier.height(12.dp),horizontalArrangement = Arrangement.spacedBy(2.dp),verticalAlignment = Alignment.Bottom) {
        for(bar in 1..4) {
            val shape = RoundedCornerShape(50)
            Box(Modifier.width(3.dp).fillMaxHeight((35 + bar * 16) / 100f).clip(shape).then(
                if(bar <= lit) Modifier.background(colors.grad(),shape) else Modifier.background(colors.borderStrong,shape)))
        }
    }
}

/**
 * The composer's model controls, as the web's chips: the coordinator's model (chip icon a CPU, "Choose a model" when
 * none) beside its thinking level (four bars, "Model default"), or the workers' model ("Worker default", a bot icon,
 * with its thinking level after a dot). [compact] is the phone's one-row composer: [modifier] sizes the model chip, and
 * [iconOnly] / [iconOnlyEffort] turn the worker or thinking chip into an icon whose description says it all. The picker
 * lists every model, grouped by provider, with its ID, image and reasoning marks and context window.
 */
@Composable internal fun ComposerModelChips(models: List<ModelInfo>, providers: List<ProviderInfo>, model: ModelRef?, thinking: String?, onChange: (ModelRef?, String?) -> Unit, enabled: Boolean, modifier: Modifier = Modifier, worker: Boolean = false, modelWidthDp: Float = 192f, effortWidthDp: Float = 84f, compact: Boolean = false, iconOnly: Boolean = false, iconOnlyEffort: Boolean = false) {
    var open by rememberSaveable { mutableStateOf(false) }
    var effort by remember { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val current = models.find { it.provider == model?.provider && it.modelId == model.modelId }
    val label = composerModelLabel(model,current?.name,if(worker) "Worker default" else "Choose a model")
    val description = composerControlDescription(label,model?.provider,model?.modelId,worker,thinking)
    val icon = if(worker) ChatIcons.Bot else ChipGlyphs.Cpu
    // Amber while the coordinator has no model, since the icon cannot say "Choose a model".
    @Composable fun IconForm() = IconButton(onClick = { open = true },enabled = enabled,modifier = Modifier.size(48.dp).semantics { contentDescription = description }) {
        LucideGlyph(icon,size = 18.dp,tint = if(!worker && model == null) Jarvis.colors.warning else Jarvis.colors.accent2)
    }
    @Composable fun Chip(chipModifier: Modifier) = AssistChip(onClick = { open = true },enabled = enabled,
        modifier = chipModifier.heightIn(min = 48.dp).semantics { contentDescription = description },
        leadingIcon = { LucideGlyph(icon,size = 14.dp,tint = Jarvis.colors.accent2) },
        // The phone's row leaves the name what room there is; the chip opens its picker all the same.
        trailingIcon = if(compact) null else ({ LucideGlyph(Lucide.ChevronDown,size = 12.dp) }),
        label = { Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label,Modifier.weight(1f,fill = false),maxLines = 1,overflow = TextOverflow.Ellipsis,style = MaterialTheme.typography.labelMedium)
            if(worker && thinking != null) Text(" · $thinking",maxLines = 1,style = MaterialTheme.typography.labelMedium,color = Jarvis.colors.fgSubtle)
        } })
    if(iconOnly) IconForm()
    else if(compact) {
        // The phone's row (web: the chip truncates beside icon-only thinking and worker chips): the whole name when it
        // fits, else the chip's icon alone, whose description names the model. A name cut to "F…" says nothing.
        val style = MaterialTheme.typography.labelMedium
        val measurer = rememberTextMeasurer()
        val labelWidth = remember(label,style,measurer) { measurer.measure(label,style,maxLines = 1).size.width }
        val density = LocalDensity.current
        BoxWithConstraints(modifier,contentAlignment = Alignment.CenterStart) {
            if(compactChipShowsLabel(maxWidth.value,with(density) { labelWidth.toDp().value })) Chip(Modifier) else IconForm()
        }
    } else Chip(modifier.widthIn(max = modelWidthDp.dp))
    if(!worker) Box {
        val effortDescription = "Thinking level: ${thinkingLabel(thinking)}"
        if(iconOnlyEffort) {
            IconButton(onClick = { effort = true },enabled = enabled && model != null,modifier = Modifier.size(48.dp).semantics { contentDescription = effortDescription }) {
                ThinkingBars(thinking)
            }
        } else {
            AssistChip(onClick = { effort = true },enabled = enabled && model != null,
                modifier = Modifier.widthIn(max = effortWidthDp.dp + 40.dp).heightIn(min = 48.dp).semantics { contentDescription = effortDescription },
                leadingIcon = { ThinkingBars(thinking) },
                trailingIcon = { LucideGlyph(Lucide.ChevronDown,size = 12.dp) },
                label = { Text(thinkingLabel(thinking),maxLines = 1,overflow = TextOverflow.Ellipsis,style = MaterialTheme.typography.labelMedium) })
        }
        DropdownMenu(effort,{ effort = false }) {
            Text("THINKING",Modifier.padding(horizontal = 12.dp,vertical = 4.dp),style = MaterialTheme.typography.labelSmall,fontWeight = FontWeight.SemiBold,color = Jarvis.colors.fgSubtle)
            (listOf<String?>(null) + current?.thinkingLevels.orEmpty().sortedBy { THINKING_LEVELS.indexOf(it) }).distinct().forEach { level ->
                DropdownMenuItem(text = { Text(thinkingLabel(level),fontWeight = FontWeight.Medium) },leadingIcon = { ThinkingBars(level) },
                    trailingIcon = if(level == thinking) ({ LucideGlyph(Lucide.Check,size = 16.dp,tint = Jarvis.colors.accent2) }) else null,
                    onClick = { onChange(model,level); effort = false })
            }
        }
    }
    if(open) AlertDialog(onDismissRequest = { open = false },title = { Text(if(worker) "Worker model" else "Coordinator model") },text = {
        Column(Modifier.heightIn(max = 480.dp)) {
            OutlinedTextField(query,{ query = it },placeholder = { Text(if(worker) "Search models for new workers…" else "Search models…") },singleLine = true,
                leadingIcon = { LucideGlyph(Lucide.Search,size = 16.dp) },modifier = Modifier.fillMaxWidth())
            Column(Modifier.weight(1f,fill = false).verticalScroll(rememberScrollState()).padding(top = 6.dp)) {
                if(worker) PickerRow(chosen = model == null,enabled = enabled,onClick = { onChange(null,null); open = false }) {
                    Column(Modifier.weight(1f)) {
                        Text("Coordinator's choice",style = MaterialTheme.typography.bodyMedium,fontWeight = FontWeight.Medium,color = Jarvis.colors.fg)
                        Text("Whatever the coordinator names, else the project's worker models",style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.fgSubtle)
                    }
                }
                val groups = groupModels(models,providers,query)
                groups.forEach { group ->
                    Text(group.label.uppercase(),style = MaterialTheme.typography.labelSmall,fontWeight = FontWeight.SemiBold,color = Jarvis.colors.fgSubtle,modifier = Modifier.padding(start = 10.dp,top = 10.dp,bottom = 4.dp))
                    group.models.forEach { item ->
                        val chosen = item.provider == model?.provider && item.modelId == model.modelId
                        PickerRow(chosen = chosen,enabled = enabled,onClick = { onChange(ModelRef(item.provider,item.modelId),validThinking(thinking,item)); if(!worker) { open = false; query = "" } }) {
                            Column(Modifier.weight(1f)) {
                                Text(item.name + if(item.configured) "" else " (no credential)",style = MaterialTheme.typography.bodyMedium,fontWeight = FontWeight.Medium,color = Jarvis.colors.fg,maxLines = 1,overflow = TextOverflow.Ellipsis)
                                Text(item.modelId,style = MaterialTheme.typography.labelSmall,fontFamily = FontFamily.Monospace,color = Jarvis.colors.fgSubtle,maxLines = 1,overflow = TextOverflow.Ellipsis)
                            }
                            if("image" in item.input) LucideGlyph(Lucide.Image,size = 14.dp,tint = Jarvis.colors.fgSubtle,contentDescription = "Accepts images")
                            if(item.reasoning) LucideGlyph(Lucide.Brain,size = 14.dp,tint = Jarvis.colors.fgSubtle,contentDescription = "Reasons")
                            if(!worker) Text(compactNumber(item.contextWindow.toDouble()),style = MaterialTheme.typography.labelSmall,fontFamily = FontFamily.Monospace,color = Jarvis.colors.fgSubtle)
                        }
                    }
                }
                if(groups.isEmpty()) Text("No models offered.",style = MaterialTheme.typography.bodySmall,color = Jarvis.colors.fgSubtle,modifier = Modifier.fillMaxWidth().padding(16.dp))
            }
            if(worker) {
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Text("THINKING LEVEL",style = MaterialTheme.typography.labelSmall,fontWeight = FontWeight.SemiBold,color = Jarvis.colors.fgSubtle)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    (listOf<String?>(null) + (current?.thinkingLevels ?: THINKING_LEVELS)).distinct().forEach { level ->
                        FilterChip(selected = thinking == level,onClick = { onChange(model,level); open = false },enabled = enabled,label = { Text(thinkingLabel(level)) })
                    }
                }
            }
        }
    },confirmButton = { TextButton(onClick = { open = false }) { Text("Close") } })
}

/** One choice in a model picker: a check on the right when it is the current one. */
@Composable private fun PickerRow(chosen: Boolean, enabled: Boolean, onClick: () -> Unit, content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).background(if(chosen) Jarvis.colors.surface2 else androidx.compose.ui.graphics.Color.Transparent)
        .clickable(enabled = enabled,role = Role.Button,onClick = onClick).padding(horizontal = 10.dp,vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        content()
        LucideGlyph(Lucide.Check,size = 16.dp,tint = if(chosen) Jarvis.colors.accent2 else androidx.compose.ui.graphics.Color.Transparent)
    }
}
