package io.github.mitzacoder.kemiri.features.settings

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.android.gms.oss.licenses.v2.OssLicensesMenuActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.HarnessRepository
import io.github.mitzacoder.kemiri.features.status.ReleaseUpdateAbout
import io.github.mitzacoder.kemiri.BuildConfig

/** Offline notices remain accessible without any backend or relay account. */
@Composable
fun AboutSection(repository: HarnessRepository) {
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var document by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        SettingsGroup(title = "About Kemiri") {
            GroupNote("Version ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            GroupNote("A client for your own Kemiri backend. The pilot has no phone push notifications.")
        }
        sessions.forEach { backend -> key(backend.config.key) { ReleaseUpdateAbout(backend) } }
        SettingsGroup(title = "Open-source licences") {
            GroupNote("Sora editor and language-textmate 0.24.6 use LGPL-2.1. Library source and replacement instructions are included with this release.")
            TextButton(onClick = { document = "Sora-NOTICE.txt" }) { Text("Sora notice and source") }
            TextButton(onClick = { document = "LGPL-2.1-Sora.txt" }) { Text("GNU LGPL 2.1") }
            TextButton(onClick = { document = "RELINKING.md" }) { Text("Rebuild with modified libraries") }
            TextButton(onClick = {
                OssLicensesMenuActivity.setActivityTitle("Open-source licences")
                context.startActivity(Intent(context, OssLicensesMenuActivity::class.java))
            }) { Text("All dependency licences") }
            for ((label, file) in listOf(
                "Atkinson Hyperlegible Next font" to "OFL-AtkinsonHyperlegibleNext.txt",
                "JetBrains Mono font" to "OFL-JetBrainsMono.txt",
                "Termux terminal" to "APACHE-2.0-termux-terminal.txt",
            )) TextButton(onClick = { document = file }) { Text(label) }
        }
    }
    document?.let { file ->
        val text = remember(file) { context.assets.open(file).bufferedReader().use { it.readText() } }
        AlertDialog(
            onDismissRequest = { document = null },
            title = { Text(file) },
            text = {
                SelectionContainer {
                    Text(text, Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), style = MaterialTheme.typography.bodyMedium)
                }
            },
            confirmButton = { TextButton(onClick = { document = null }) { Text("Close") } },
        )
    }
}
