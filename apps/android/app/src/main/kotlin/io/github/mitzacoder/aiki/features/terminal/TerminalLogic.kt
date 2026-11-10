package io.github.mitzacoder.aiki.features.terminal

import io.github.mitzacoder.aiki.data.TerminalState
import io.github.mitzacoder.aiki.data.TerminalStatus
import io.github.mitzacoder.aiki.protocol.TerminalSessionInfo
import java.text.Normalizer
import kotlinx.serialization.json.*

/**
 * What the terminal screen decides without a screen: where a terminal opens, which sessions a visit restores, the phone's
 * key bar and its sticky modifiers, and the emulator's colours. The port of `apps/web/src/lib/terminal.ts`, with the
 * web's tests mirrored in `TerminalLogicTest`.
 */

/** SharedPreferences file and key for the tabs each backend's terminal screen has open (the web's key, per device). */
const val TERMINAL_TABS_PREFERENCES = "aiki.terminal-tabs.v1"
/** Tabs one screen keeps attached; the backend allows eight per connection. */
const val MAX_TERMINAL_TABS = 6

/** The prefix for new sessions made from [text] (a project's name): `Example Core Services` becomes `example-core-services`. */
fun terminalPrefix(text: String): String {
    val slug = Normalizer.normalize(text.lowercase(), Normalizer.Form.NFKD)
        .replace(Regex("\\p{M}"), "")
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .take(32)
        .trimEnd('-')
    return slug.ifEmpty { "term" }
}

/** Where a terminal opens and what its sessions are called. */
data class TerminalTarget(
    /** The prefix of its new session's name (`example-core`, `example-core-fix-login`). */
    val prefix: String,
    /** The folder its first shell starts in; the backend's home when absent. */
    val cwd: String? = null,
    /** What the tab says. */
    val title: String,
)

class TerminalProject(val name: String, val path: String)
class TerminalWorker(val id: String, val workspacePath: String?)

/** The target for a project's terminal, or for one of its workers (its workspace; a shared-checkout worker gets the project's folder). */
fun terminalTarget(project: TerminalProject?, worker: TerminalWorker? = null): TerminalTarget {
    if (project == null) return TerminalTarget(prefix = "term", title = "Terminal")
    val base = terminalPrefix(project.name)
    if (worker == null) return TerminalTarget(prefix = base, cwd = project.path, title = project.name)
    return TerminalTarget(prefix = terminalPrefix("$base-${worker.id}"), cwd = worker.workspacePath ?: project.path, title = "${project.name} · ${worker.id}")
}

private fun isFromPrefix(session: String, prefix: String) =
    session.startsWith("$prefix-") && session.substring(prefix.length + 1).let { rest -> rest.isNotEmpty() && rest.all { it in '0'..'9' } }

/**
 * The running session a screen should show for [prefix] instead of making another: the lowest-numbered one that is not
 * exited, or null. Exited sessions (resurrectable) are not picked: opening a terminal should not re-run old commands.
 */
fun sessionForPrefix(sessions: List<TerminalSessionInfo>, prefix: String): String? =
    sessions.filter { !it.exited && isFromPrefix(it.name, prefix) }.map { it.name }
        .minByOrNull { it.substring(prefix.length + 1).toBigInteger() }

// --- tabs, as one device remembers them ---------------------------------------------------------------------------

data class TerminalTab(
    /** Local: identifies the tab while its session is not named yet. */
    val id: String,
    /** The session the tab shows, once attached (or from before a restart). */
    val session: String? = null,
    val title: String,
    /** For a tab not attached yet: where a new session starts and what it is called. */
    val prefix: String? = null,
    val cwd: String? = null,
)

data class TerminalTabs(val tabs: List<TerminalTab> = emptyList(), val active: String? = null)

private val tabJson = Json { ignoreUnknownKeys = true }

/** Every backend's tabs from storage; anything unreadable is dropped, and so is a tab that never got a session name. */
fun parseTabs(raw: String?): Map<String, TerminalTabs> {
    if (raw == null) return emptyMap()
    return try {
        val root = tabJson.parseToJsonElement(raw) as? JsonObject ?: return emptyMap()
        buildMap {
            for ((backendKey, value) in root) {
                val entry = value as? JsonObject ?: continue
                val tabs = ((entry["tabs"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { element ->
                    val tab = element as? JsonObject ?: return@mapNotNull null
                    val id = (tab["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
                    val title = (tab["title"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
                    val session = (tab["session"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
                    TerminalTab(id, session, title)
                }.take(MAX_TERMINAL_TABS)
                val active = (entry["active"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { id -> tabs.any { it.id == id } } ?: tabs.firstOrNull()?.id
                put(backendKey, TerminalTabs(tabs, active))
            }
        }
    } catch (_: Exception) { emptyMap() }
}

/** [all] with [backendKey]'s tabs replaced, as the text to store; only attached tabs are kept. */
fun storeTabs(all: Map<String, TerminalTabs>, backendKey: String, tabs: TerminalTabs): String {
    val next = all + (backendKey to tabs)
    return buildJsonObject {
        for ((key, value) in next) putJsonObject(key) {
            putJsonArray("tabs") {
                value.tabs.filter { it.session != null }.forEach { tab ->
                    addJsonObject { put("id", tab.id); put("session", tab.session); put("title", tab.title) }
                }
            }
            put("active", value.active)
        }
    }.toString()
}

/** The tabs a screen restores: those whose session the backend still has (an exited one is resurrected on attach). */
fun reconcileTabs(stored: TerminalTabs, sessions: List<TerminalSessionInfo>): TerminalTabs {
    val tabs = stored.tabs.filter { tab -> tab.session != null && sessions.any { it.name == tab.session } }
    val active = stored.active?.takeIf { id -> tabs.any { it.id == id } } ?: tabs.firstOrNull()?.id
    return TerminalTabs(tabs, active)
}

// --- the phone's key bar ------------------------------------------------------------------------------------------

enum class KeyModifier { Ctrl, Alt }
enum class Arrow { Up, Down, Left, Right }

data class KeyBarKey(
    val id: String,
    /** What the button shows. */
    val label: String,
    /** What it is called to a screen reader. */
    val name: String,
    /** The bytes it types. Absent for a modifier and for the arrows (which depend on the cursor-key mode). */
    val bytes: String? = null,
    val modifier: KeyModifier? = null,
    val arrow: Arrow? = null,
)

/**
 * Two rows, so every key is wide enough to hit with a thumb on a 390dp phone: the keys a soft keyboard lacks, then the
 * symbols that are two taps away on it (the second row also holds the clipboard buttons).
 */
val KEY_BAR_ROWS: List<List<KeyBarKey>> = listOf(
    listOf(
        KeyBarKey("esc", "Esc", "Escape", bytes = "\u001b"),
        KeyBarKey("tab", "Tab", "Tab", bytes = "\t"),
        KeyBarKey("ctrl", "Ctrl", "Control", modifier = KeyModifier.Ctrl),
        KeyBarKey("alt", "Alt", "Alt", modifier = KeyModifier.Alt),
        KeyBarKey("left", "←", "Left arrow", arrow = Arrow.Left),
        KeyBarKey("down", "↓", "Down arrow", arrow = Arrow.Down),
        KeyBarKey("up", "↑", "Up arrow", arrow = Arrow.Up),
        KeyBarKey("right", "→", "Right arrow", arrow = Arrow.Right),
    ),
    listOf(
        KeyBarKey("pipe", "|", "Pipe", bytes = "|"),
        KeyBarKey("tilde", "~", "Tilde", bytes = "~"),
        KeyBarKey("slash", "/", "Slash", bytes = "/"),
        KeyBarKey("dash", "-", "Dash", bytes = "-"),
    ),
)

val KEY_BAR: List<KeyBarKey> = KEY_BAR_ROWS.flatten()

/** The bytes an arrow key types; programs that switch on application cursor keys expect `ESC O` instead of `ESC [`. */
fun arrowBytes(direction: Arrow, applicationMode: Boolean): String {
    val letter = when (direction) { Arrow.Up -> "A"; Arrow.Down -> "B"; Arrow.Right -> "C"; Arrow.Left -> "D" }
    return (if (applicationMode) "\u001bO" else "\u001b[") + letter
}

data class Modifiers(val ctrl: Boolean = false, val alt: Boolean = false) {
    val any get() = ctrl || alt
}

/**
 * Apply the key bar's sticky modifiers to what a key typed: Ctrl turns one letter or `@[\]^_` into its control byte
 * (`c` becomes `\u0003`), Alt prefixes ESC. Anything longer than one character (a paste, an escape sequence) is left as it
 * is, apart from Alt's prefix.
 */
fun applyModifiers(data: String, modifiers: Modifiers): String {
    var result = data
    if (modifiers.ctrl && data.length == 1) {
        val code = data.uppercase().first().code
        result = when {
            code in 0x40..0x5f -> (code - 0x40).toChar().toString()
            data == " " -> "\u0000"
            data == "?" -> "\u007f"
            else -> data
        }
    }
    return if (modifiers.alt) "\u001b$result" else result
}

// --- colours --------------------------------------------------------------------------------------------------------

/** The active theme's tones, as `#rrggbb`. */
data class TerminalTones(
    val bg: String, val fg: String, val fgMuted: String, val fgSubtle: String, val surface2: String, val primary: String,
    val danger: String, val success: String, val warning: String, val accent1: String, val accent2: String, val accent3: String, val accent4: String,
)

private fun channels(hex: String): IntArray = hex.removePrefix("#").let { intArrayOf(it.substring(0, 2).toInt(16), it.substring(2, 4).toInt(16), it.substring(4, 6).toInt(16)) }

private fun toHex(values: List<Double>): String =
    "#" + values.joinToString("") { Math.round(it.coerceIn(0.0, 255.0)).toInt().toString(16).padStart(2, '0') }

/** [a] moved [amount] (0 to 1) of the way to [b], both `#rrggbb`. */
fun mixHex(a: String, b: String, amount: Double): String {
    val from = channels(a)
    val to = channels(b)
    return toHex(from.indices.map { from[it] + (to[it] - from[it]) * amount })
}

/** The emulator's palette: the 16 ANSI colours plus the default foreground, background and cursor, all `#rrggbb`. */
data class TerminalPalette(
    val background: String, val foreground: String, val cursor: String,
    /** black, red, green, yellow, blue, magenta, cyan, white, then the same bright. */
    val ansi: List<String>,
)

/**
 * A palette from the app's tones (the web's `xtermColors`): the page's own background and text, the primary colour for the
 * cursor, the status tones as red, green and yellow, the accents as blue, magenta and cyan. Dark themes lighten the bright
 * colours, light themes darken the plain ones so they stay readable on a pale background.
 */
fun terminalPalette(tones: TerminalTones, dark: Boolean): TerminalPalette {
    fun plain(color: String) = if (dark) color else mixHex(color, "#000000", 0.18)
    fun bright(color: String) = if (dark) mixHex(color, "#ffffff", 0.22) else color
    val ansi = listOf(
        if (dark) mixHex(tones.bg, tones.fg, 0.22) else mixHex(tones.fg, tones.bg, 0.1),
        plain(tones.danger), plain(tones.success), plain(tones.warning), plain(tones.accent2), plain(tones.accent3), plain(tones.accent1),
        if (dark) tones.fgMuted else mixHex(tones.bg, tones.fg, 0.45),
        tones.fgSubtle,
        bright(tones.danger), bright(tones.success), bright(tones.warning), bright(tones.accent2), bright(tones.accent3), bright(tones.accent1),
        if (dark) tones.fg else mixHex(tones.bg, tones.fg, 0.3),
    )
    return TerminalPalette(
        background = tones.bg, foreground = tones.fg, cursor = tones.primary,
        ansi = ansi,
    )
}

// --- what the overlay says -------------------------------------------------------------------------------------------

/** The sentence the "ended" overlay shows for a finished or failed terminal. */
fun endedText(state: TerminalState): String = when {
    state.status == TerminalStatus.Failed -> state.error ?: "This terminal could not be opened."
    state.endedReason == "killed" -> "This session was ended."
    state.exitCode != null && state.exitCode != 0L -> "This session ended (exit code ${state.exitCode})."
    else -> "This session ended."
}
