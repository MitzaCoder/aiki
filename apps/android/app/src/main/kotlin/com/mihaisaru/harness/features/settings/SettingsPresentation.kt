package com.mihaisaru.harness.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.data.ConnectionStatus
import com.mihaisaru.harness.ui.components.*
import com.mihaisaru.harness.ui.theme.LocalJarvisColors

/** [attempt] counts the reconnects: "Reconnecting (2)…", as on the web. */
fun connectionLabel(status: ConnectionStatus, attempt: Int = 0) = when (status) {
    ConnectionStatus.Ready -> "Connected"
    ConnectionStatus.Connecting -> "Connecting…"
    ConnectionStatus.Reconnecting -> if (attempt > 0) "Reconnecting ($attempt)…" else "Reconnecting…"
    ConnectionStatus.Idle -> "Not connected"
    ConnectionStatus.Closed -> "Disconnected"
}

internal fun canBrowseDirectories(connection: com.mihaisaru.harness.data.ConnectionState) =
    connection.status == ConnectionStatus.Ready && connection.supports("filesystem")

internal object SettingsGlyphs {
    val More = LucideIcon("more", "M5 12h.01", "M12 12h.01", "M19 12h.01")
    val Refresh = LucideIcon("refresh", "M20 7v5h-5", "M4 17v-5h5", "M6 7a7 7 0 0 1 11.5-2L20 8", "M4 16l2.5 3A7 7 0 0 0 18 17")
    // Lucide (ISC), circles written as arcs.
    val Palette = LucideIcon("palette", "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z", "M13.5 6.5h.01", "M17.5 10.5h.01", "M6.5 12.5h.01", "M8.5 7.5h.01")
    val Folder = LucideIcon("folder", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z")
    val Cpu = LucideIcon("cpu", "M12 20v2", "M12 2v2", "M17 20v2", "M17 2v2", "M2 12h2", "M2 17h2", "M2 7h2", "M20 12h2", "M20 17h2", "M20 7h2", "M7 20v2", "M7 2v2", "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M8 8h8v8H8z")
    val Ticket = LucideIcon("ticket", "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z", "M13 5v2", "M13 17v2", "M13 11v2")
    val DatabaseZap = LucideIcon("database-zap", "M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0", "M3 5v14a9 3 0 0 0 8.4 2.9", "M21 5v4", "M3 12a9 3 0 0 0 8.7 3", "m19 16-2 3h4l-2 3")
    val KeyRound = LucideIcon("key-round", "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z", "M16.5 7.5h.01")
    val GitPullRequest = LucideIcon("git-pull-request", "M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M13 6h3a2 2 0 0 1 2 2v7", "M6 9v12")
    val Play = LucideIcon("play", "M6 3l14 9-14 9z")
    val Pencil = LucideIcon("pencil", "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4")
    val Sun = LucideIcon("sun", "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41")
    val Moon = LucideIcon("moon", "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401")
}

internal fun settingsIconGlyph(icon: SettingsIcon): LucideIcon = when (icon) {
    SettingsIcon.Palette -> SettingsGlyphs.Palette
    SettingsIcon.Server -> com.mihaisaru.harness.navigation.NavGlyphs.Server
    SettingsIcon.Bell -> com.mihaisaru.harness.features.status.StatusGlyphs.Bell
    SettingsIcon.Archive -> Lucide.Archive
    SettingsIcon.Folder -> SettingsGlyphs.Folder
    SettingsIcon.Cpu -> SettingsGlyphs.Cpu
    SettingsIcon.Users -> Lucide.Users
    SettingsIcon.CalendarClock -> com.mihaisaru.harness.features.status.StatusGlyphs.CalendarClock
    SettingsIcon.Ticket -> SettingsGlyphs.Ticket
    SettingsIcon.DatabaseZap -> SettingsGlyphs.DatabaseZap
    SettingsIcon.HardDrive -> com.mihaisaru.harness.features.status.StatusGlyphs.HardDrive
    SettingsIcon.KeyRound -> SettingsGlyphs.KeyRound
    SettingsIcon.Settings -> Lucide.Settings2
}

/** A backend's connection as a chip: green when connected, amber while it connects, red when it failed, grey otherwise. */
@Composable
fun ConnectionBadge(status: ConnectionStatus, attempt: Int = 0) {
    StatusChip(connectionLabel(status, attempt), connectionChipTone(status))
}

fun connectionChipTone(status: ConnectionStatus): ChipTone = when (status) {
    ConnectionStatus.Ready -> ChipTone.Ok
    ConnectionStatus.Connecting, ConnectionStatus.Reconnecting -> ChipTone.Warn
    ConnectionStatus.Closed -> ChipTone.Err
    ConnectionStatus.Idle -> ChipTone.Muted
}

@Composable
internal fun SettingsBadge(label: String, color: Color = MaterialTheme.colorScheme.onSurfaceVariant, icon: LucideIcon? = null) {
    Surface(color = color.copy(alpha = .10f), contentColor = color, shape = RoundedCornerShape(6.dp)) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            icon?.let { LucideGlyph(it, size = 12.dp) }
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
internal fun SettingsAction(label: String, icon: LucideIcon, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled) { LucideGlyph(icon, size = 18.dp, contentDescription = label) }
}
