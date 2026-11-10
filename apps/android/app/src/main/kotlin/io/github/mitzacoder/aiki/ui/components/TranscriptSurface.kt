package io.github.mitzacoder.aiki.ui.components

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/** Only the header toggles: selecting code or using a worker link never collapses it. */
@Composable
fun TranscriptSurface(
    title: String,
    icon: LucideIcon,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    status: String? = null,
    tone: Color = Jarvis.colors.fgMuted,
    compactHeader: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Jarvis.colors
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = colors.surface.copy(alpha = .85f),
        border = BorderStroke(1.dp, colors.border)) {
        Column(Modifier.animateContentSize(animationSpec = tween(160))) {
            Row(Modifier.fillMaxWidth()
                .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" }
                .clickable(role = Role.Button, onClickLabel = if (expanded) "Collapse details" else "Expand details", onClick = onToggle)
                .heightIn(min = if(compactHeader) 48.dp else 56.dp).padding(horizontal = 12.dp, vertical = if(compactHeader) 6.dp else 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(if(compactHeader) 24.dp else 30.dp).background(colors.surface2, RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
                    LucideGlyph(icon, tint = tone, size = 16.dp)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(title, style = MaterialTheme.typography.labelLarge, color = colors.fg,
                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall,
                        color = colors.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (!compactHeader && !status.isNullOrBlank()) Text(status, style = MaterialTheme.typography.labelSmall, color = tone)
                }
                if(compactHeader && !status.isNullOrBlank()) LucideGlyph(when {
                    status.startsWith("Failed",true) -> Lucide.X
                    status.startsWith("Exit",true) || status.startsWith("Stopped",true) -> Lucide.CircleAlert
                    status.startsWith("Done",true) -> Lucide.Check
                    else -> Lucide.Clock
                },tint = tone,size = 14.dp,contentDescription = status)
                LucideGlyph(if (expanded) Lucide.ChevronDown else Lucide.ChevronRight, tint = colors.fgMuted)
            }
            Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (expanded) HorizontalDivider(color = colors.border)
                content()
                if (expanded) Spacer(Modifier.height(4.dp))
            }
        }
    }
}
