package io.github.mitzacoder.aiki.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.github.mitzacoder.aiki.features.notifications.NotificationSettings
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable

enum class ThemePalette { Jarvis, Neutral }
enum class ThemeMode { System, Light, Dark }

@Serializable
data class DeviceSettings(
    val backends: List<BackendConfig> = emptyList(),
    val deviceId: String = UUID.randomUUID().toString(),
    val palette: ThemePalette = ThemePalette.Jarvis,
    val mode: ThemeMode = ThemeMode.System,
    /** Backend URL -> project ID -> last viewed reply entry. */
    val seenReplies: Map<String, Map<String, Long>> = emptyMap(),
    /** Legacy device-wide List/Board choice, used until a project has its own view preference. */
    val tasksView: String = "list",
    /** One timeline reading direction for every task on this device. */
    val timelineNewestFirst: Boolean = true,
    /** Backend origin -> project ID -> List, Board or Graph. Legacy global choice is the fallback. */
    val projectTasksView: Map<String, Map<String, String>> = emptyMap(),
    /** Backend origin -> project ID -> parent ID -> explicit family expansion choice. */
    val taskFamilyExpansion: Map<String, Map<String, Map<String, Boolean>>> = emptyMap(),
    /** Waiting calendar dates resolve at this local wall time on this device. */
    val workDayStart: String = DEFAULT_WORK_DAY_START,
    /** Show before/after images individually rather than as one compare slide on this device. */
    val mediaSeparate: Boolean = false,
    /** Deploy attempts whose banner was dismissed on this device (`commit@at`), newest last. */
    val dismissedDeploys: List<String> = emptyList(),
    /** Push: what this device wants from every backend, and its FCM token. */
    val notifications: NotificationSettings = NotificationSettings(),
    /** "wrap" or "scroll" once the reader chose with a code block's Wrap toggle, null before (web `aiki.code-wrap.v1`). */
    val codeWrap: String? = null,
)
private val Context.deviceData by preferencesDataStore(name = "harness-device")
class DeviceStore(context: Context) {
    private val data = context.applicationContext.deviceData
    private val key = stringPreferencesKey("settings-v1")
    suspend fun load(): DeviceSettings {
        val preferences = data.data.first()
        val existing = preferences[key]?.let { runCatching { wireJson.decodeFromString(DeviceSettings.serializer(), it) }.getOrNull() }
        if (existing != null) return existing
        return DeviceSettings().also { save(it) }
    }
    suspend fun save(settings: DeviceSettings) {
        data.edit { it[key] = wireJson.encodeToString(DeviceSettings.serializer(), settings) }
    }
}
