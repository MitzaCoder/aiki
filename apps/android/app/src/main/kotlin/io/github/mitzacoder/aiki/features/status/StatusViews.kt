package io.github.mitzacoder.aiki.features.status

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.BackendSession
import io.github.mitzacoder.aiki.data.HarnessFeature
import io.github.mitzacoder.aiki.data.HarnessRepository
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.ServerStatus
import io.github.mitzacoder.aiki.ui.components.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The wall clock, ticking every [periodMs] while shown, for "deployed 5 min ago" and friends. */
@Composable
fun rememberNow(periodMs: Long = 30_000): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(periodMs) { while (true) { delay(periodMs); now = System.currentTimeMillis() } }
    return now
}

/** A tinted notice: the web's `Banner` in its error, warning and plain tones. */
@Composable
fun ToneBanner(tone: BannerTone?, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val color = when (tone) { BannerTone.Error -> Jarvis.colors.danger; BannerTone.Warning -> Jarvis.colors.warning; null -> Jarvis.colors.fgMuted }
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = color.copy(alpha = .10f), border = BorderStroke(1.dp, color.copy(alpha = .35f))) {
        CompositionLocalProvider(LocalContentColor provides Jarvis.colors.fg) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp), content = content)
        }
    }
}

/**
 * The release a backend runs. `compact` (the chat header and its menu) shows the short commit and "deployed 5 min ago";
 * the full line (Backends) adds the commit's description. A tap shows the whole release: name, commit, description,
 * deploy time. A backend that runs from a checkout shows "Checkout"; nothing is drawn before the status is known.
 */
@Composable
fun ReleaseLine(status: ServerStatus?, compact: Boolean, modifier: Modifier = Modifier) {
    if (status == null) return
    val release = status.release
    var details by remember { mutableStateOf(false) }
    val muted = Jarvis.colors.fgMuted
    if (release == null) {
        ReleaseChip("Checkout", null, modifier.semantics { contentDescription = "Checkout: this server runs from a checkout, not from a deployed release." }) { details = true }
        if (details) AlertDialog(onDismissRequest = { details = false }, confirmButton = { TextButton(onClick = { details = false }) { Text("Close") } },
            title = { Text("Checkout") }, text = { Text("This server runs from a checkout, not from a deployed release.") })
        return
    }
    val view = releaseView(release, rememberNow(), status.deploy)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ReleaseChip(view.commit, StatusGlyphs.GitCommit, Modifier.semantics { contentDescription = "Release ${view.commit}, deployed ${view.`when`}. Show details" }) { details = true }
            if (!compact) Text(view.description, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("deployed ${view.`when`}", style = MaterialTheme.typography.labelSmall, color = muted, maxLines = 1, softWrap = false)
        }
        if (!compact) view.unchanged?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
    if (details) AlertDialog(onDismissRequest = { details = false }, confirmButton = { TextButton(onClick = { details = false }) { Text("Close") } },
        title = { Text("Release ${view.commit}") },
        text = { Text(view.title + (view.unchanged?.let { "\n$it" } ?: ""), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) })
}

@Composable
private fun ReleaseChip(label: String, icon: LucideIcon?, modifier: Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = modifier.heightIn(min = 24.dp), shape = RoundedCornerShape(6.dp), color = Color.Transparent,
        border = BorderStroke(1.dp, Jarvis.colors.border), contentColor = Jarvis.colors.fgMuted) {
        Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            icon?.let { LucideGlyph(it, size = 12.dp) }
            Text(label, style = MaterialTheme.typography.labelSmall, fontFamily = if (icon != null) FontFamily.Monospace else null)
        }
    }
}

/** A backend's machine in one line: free and total space per filesystem, amber when tight, red when low with a warning. */
@Composable
fun MachineLine(status: ServerStatus?, modifier: Modifier = Modifier) {
    val disks = serverDisks(status).map(::diskView)
    if (disks.isEmpty()) return
    val colors = Jarvis.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                LucideGlyph(StatusGlyphs.HardDrive, size = 14.dp, tint = colors.fg)
                Text("Machine", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
            }
            disks.forEachIndexed { index, disk ->
                if (index > 0) Text("·", style = MaterialTheme.typography.labelSmall, color = colors.fgMuted)
                val color = when (disk.level) { DiskLevel.Low -> colors.danger; DiskLevel.Tight -> colors.warning; DiskLevel.Ok -> colors.fgMuted }
                Text("${disk.label} ${disk.text}", Modifier.semantics { contentDescription = "${disk.label} ${disk.text}, ${disk.title}" },
                    style = MaterialTheme.typography.labelSmall, color = color)
            }
        }
        diskWarning(status)?.let { Text("$it Clean up finished workspaces in each project's settings.", style = MaterialTheme.typography.labelSmall, color = colors.danger) }
    }
}

/**
 * The banner for a deploy that needs attention (failed, rolled back, or a release other than the one deployed),
 * dismissible per attempt on this device so the next deploy shows again.
 */
@Composable
fun DeployBanner(repository: HarnessRepository, backend: BackendSession, modifier: Modifier = Modifier) {
    val status by backend.serverStatus.status.collectAsStateWithLifecycle()
    val settings by repository.settings.collectAsStateWithLifecycle()
    val problem = deployProblem(status) ?: return
    if (isDeployDismissed(settings.dismissedDeploys, problem.deploy)) return
    val view = deployBanner(problem, rememberNow())
    val scope = rememberCoroutineScope()
    ToneBanner(view.tone, modifier) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${view.title}: ${view.commit} ${view.description}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                Text(view.detail, style = MaterialTheme.typography.bodySmall)
                Text(view.note, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                Text(view.`when`, style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
            }
            IconButton(onClick = { scope.launch { repository.dismissDeploy(problem.deploy) } }) {
                LucideGlyph(Lucide.X, size = 16.dp, contentDescription = "Dismiss this deploy message until the next deploy")
            }
        }
    }
}

/** A small warning above the composer while the backend says a disk is low; [openStorage] leads to the cleanup. */
@Composable
fun DiskBanner(backend: BackendSession, openStorage: (() -> Unit)?, modifier: Modifier = Modifier) {
    val status by backend.serverStatus.status.collectAsStateWithLifecycle()
    val warning = diskWarning(status) ?: return
    ToneBanner(BannerTone.Warning, modifier) {
        Text(warning, style = MaterialTheme.typography.bodySmall)
        openStorage?.let { open ->
            Text("Clean up finished workspaces", Modifier.clickable(role = Role.Button, onClick = open).padding(vertical = 4.dp),
                style = MaterialTheme.typography.labelMedium, color = Jarvis.colors.link, fontWeight = FontWeight.SemiBold)
        }
    }
}

/**
 * The chat's server banners above the composer: the deploy banner and the low-disk warning, and the five-minute re-read
 * of `server.status` while the chat is open (a disk fills without a push).
 */
@Composable
fun ChatServerBanners(context: ProjectScreenContext, modifier: Modifier = Modifier) {
    val backend = context.backend
    val connection by backend.client.state.collectAsStateWithLifecycle()
    if (!connection.supports(SERVER_STATUS_FEATURE)) return
    LaunchedEffect(backend) { while (true) { delay(SERVER_STATUS_REFRESH_MS); backend.serverStatus.refresh() } }
    val openStorage = if (connection.supports(HarnessFeature.STORAGE)) { { context.navigate(Destination.ProjectSettings(context.route, io.github.mitzacoder.aiki.features.settings.ProjectSection.Storage)) } } else null
    Column(modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        DeployBanner(context.repository, backend)
        DiskBanner(backend, openStorage)
    }
}
