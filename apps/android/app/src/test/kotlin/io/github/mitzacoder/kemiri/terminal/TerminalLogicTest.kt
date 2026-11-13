package io.github.mitzacoder.kemiri.terminal

import io.github.mitzacoder.kemiri.data.TerminalState
import io.github.mitzacoder.kemiri.data.TerminalStatus
import io.github.mitzacoder.kemiri.features.terminal.*
import io.github.mitzacoder.kemiri.protocol.TerminalSessionInfo
import org.junit.Assert.*
import org.junit.Test

/** The web's `test/terminal.test.ts`, ported: what the screen decides without a screen. */
class TerminalLogicTest {
    private fun sessions(vararg entries: Pair<String, Boolean>) = entries.map { TerminalSessionInfo(name = it.first, exited = it.second, attached = false) }

    @Test fun prefixIsASlugOfTheProjectName() {
        assertEquals("example-core-services", terminalPrefix("Example Core Services"))
        assertEquals("cafe", terminalPrefix("Café"))
        assertEquals("term", terminalPrefix("!!!"))
        assertEquals(32, terminalPrefix("a".repeat(40) + " b").length)
        assertFalse(terminalPrefix("a".repeat(31) + " bcd").endsWith("-"))
    }

    @Test fun aProjectsTerminalStartsInItsFolderAndAWorkersInItsWorkspace() {
        val project = TerminalProject("Example Core", "/work/core")
        assertEquals(TerminalTarget("example-core", "/work/core", "Example Core"), terminalTarget(project))
        assertEquals(
            TerminalTarget("example-core-fix-login", "/work/core-ws/fix-login", "Example Core · fix-login"),
            terminalTarget(project, TerminalWorker("fix-login", "/work/core-ws/fix-login")),
        )
        // A worker on the shared checkout has no workspace of its own.
        assertEquals("/work/core", terminalTarget(project, TerminalWorker("w1", null)).cwd)
        assertEquals(TerminalTarget("term", null, "Terminal"), terminalTarget(null))
    }

    @Test fun anExistingRunningSessionIsReusedInsteadOfMakingAnother() {
        val list = sessions("example-core-2" to false, "example-core-1" to true, "example-core-10" to false, "example-core-fix-1" to false, "other-1" to false)
        assertEquals("example-core-2", sessionForPrefix(list, "example-core"))
        assertEquals("example-core-fix-1", sessionForPrefix(list, "example-core-fix"))
        // Only exited ones, or none at all: make a new one.
        assertNull(sessionForPrefix(sessions("example-core-1" to true), "example-core"))
        assertNull(sessionForPrefix(list, "nothing"))
        // A longer prefix is not a number suffix of a shorter one.
        assertNull(sessionForPrefix(sessions("example-core-fix-1" to false), "example-core"))
    }

    @Test fun readsWhatADeviceStoredAndDropsWhatIsBrokenOrUnattached() {
        val raw = """{"pc":{"tabs":[{"id":"a","session":"x-1","title":"X"},{"id":"b","title":"never attached"},5,{"id":"c","session":"x-2","title":"Y"}],"active":"c"},"bad":"nope"}"""
        assertEquals(
            mapOf("pc" to TerminalTabs(listOf(TerminalTab("a", "x-1", "X"), TerminalTab("c", "x-2", "Y")), "c")),
            parseTabs(raw),
        )
        assertEquals(emptyMap<String, TerminalTabs>(), parseTabs("{not json"))
        assertEquals(emptyMap<String, TerminalTabs>(), parseTabs(null))
    }

    @Test fun keepsAtMostTheAllowedNumberOfTabsAndAValidActiveOne() {
        val many = (0 until 10).joinToString(",") { """{"id":"t$it","session":"s-$it","title":"t"}""" }
        val result = parseTabs("""{"pc":{"tabs":[$many],"active":"t9"}}""").getValue("pc")
        assertEquals(MAX_TERMINAL_TABS, result.tabs.size)
        assertEquals("t0", result.active)
    }

    @Test fun storingKeepsOtherBackendsAndOnlyAttachedTabs() {
        val before = storeTabs(emptyMap(), "other", TerminalTabs(listOf(TerminalTab("o", "o-1", "O")), "o"))
        val after = storeTabs(parseTabs(before), "pc", TerminalTabs(listOf(TerminalTab("a", "x-1", "X"), TerminalTab("b", null, "unnamed")), "a"))
        val read = parseTabs(after)
        assertEquals(listOf("o-1"), read.getValue("other").tabs.map { it.session })
        assertEquals(listOf("x-1"), read.getValue("pc").tabs.map { it.session })
        assertEquals("a", read.getValue("pc").active)
    }

    @Test fun aScreenRestoresOnlyTheTabsWhoseSessionTheBackendStillHas() {
        val stored = TerminalTabs(listOf(TerminalTab("a", "gone-1", "gone"), TerminalTab("b", "kept-1", "kept"), TerminalTab("c", "dead-1", "dead")), "a")
        val result = reconcileTabs(stored, sessions("kept-1" to false, "dead-1" to true))
        assertEquals(listOf("b", "c"), result.tabs.map { it.id })
        assertEquals("b", result.active)
    }

    @Test fun theKeyBarHasTheKeysAPhoneLacksInOrder() {
        assertEquals(listOf("Esc", "Tab", "Ctrl", "Alt", "←", "↓", "↑", "→", "|", "~", "/", "-"), KEY_BAR.map { it.label })
        assertEquals("\u001b", KEY_BAR.first { it.id == "esc" }.bytes)
        assertEquals(listOf(KeyModifier.Ctrl, KeyModifier.Alt), KEY_BAR.mapNotNull { it.modifier })
    }

    @Test fun arrowsFollowTheCursorKeyMode() {
        assertEquals("\u001b[A", arrowBytes(Arrow.Up, false))
        assertEquals("\u001b[D", arrowBytes(Arrow.Left, false))
        assertEquals("\u001bOB", arrowBytes(Arrow.Down, true))
        assertEquals("\u001bOC", arrowBytes(Arrow.Right, true))
    }

    @Test fun stickyCtrlAndAltChangeTheNextKey() {
        val none = Modifiers()
        assertEquals("\u0003", applyModifiers("c", none.copy(ctrl = true)))
        assertEquals("\u0003", applyModifiers("C", none.copy(ctrl = true)))
        assertEquals("\u001b", applyModifiers("[", none.copy(ctrl = true)))
        assertEquals("\u0000", applyModifiers(" ", none.copy(ctrl = true)))
        assertEquals("1", applyModifiers("1", none.copy(ctrl = true)))
        assertEquals("\u001bx", applyModifiers("x", none.copy(alt = true)))
        assertEquals("\u001b\u0004", applyModifiers("d", Modifiers(ctrl = true, alt = true)))
        // A paste or an escape sequence is not a key.
        assertEquals("hello", applyModifiers("hello", none.copy(ctrl = true)))
        assertEquals("hello", applyModifiers("hello", none))
    }

    private val tones = TerminalTones(
        bg = "#ffffff", fg = "#101010", fgMuted = "#606060", fgSubtle = "#909090", surface2 = "#eeeeee", primary = "#6366f1",
        danger = "#e11d48", success = "#059669", warning = "#d97706", accent1 = "#22d3ee", accent2 = "#6366f1", accent3 = "#d946ef", accent4 = "#fb923c",
    )

    @Test fun mixesHexColours() {
        assertEquals("#808080", mixHex("#000000", "#ffffff", 0.5))
        assertEquals("#102030", mixHex("#102030", "#102030", 0.7))
    }

    @Test fun thePaletteTakesThePagesOwnBackgroundTextAndCursor() {
        val palette = terminalPalette(tones, dark = false)
        assertEquals("#ffffff", palette.background)
        assertEquals("#101010", palette.foreground)
        assertEquals("#6366f1", palette.cursor)
        assertEquals(16, palette.ansi.size)
        (palette.ansi + palette.background + palette.foreground + palette.cursor).forEach { assertTrue(it, Regex("^#[0-9a-f]{6}$").matches(it)) }
    }

    @Test fun lightThemesDarkenThePlainColoursAndDarkOnesLightenTheBrightOnes() {
        val light = terminalPalette(tones, dark = false)
        assertNotEquals(tones.danger, light.ansi[1])
        assertEquals(tones.danger, light.ansi[9])
        val dark = terminalPalette(tones.copy(bg = "#09090f", fg = "#ecebf5"), dark = true)
        assertEquals(tones.danger, dark.ansi[1])
        assertNotEquals(tones.danger, dark.ansi[9])
        assertNotEquals(dark.background, dark.ansi[0])
    }

    @Test fun theEndedOverlaySaysWhy() {
        assertEquals("This session ended.", endedText(TerminalState(TerminalStatus.Ended, endedReason = "exited", exitCode = 0)))
        assertEquals("This session ended (exit code 2).", endedText(TerminalState(TerminalStatus.Ended, endedReason = "exited", exitCode = 2)))
        assertEquals("This session was ended.", endedText(TerminalState(TerminalStatus.Ended, endedReason = "killed")))
        assertEquals("zellij is not installed on this backend", endedText(TerminalState(TerminalStatus.Failed, error = "zellij is not installed on this backend")))
        assertEquals("This terminal could not be opened.", endedText(TerminalState(TerminalStatus.Failed)))
    }

    @Test fun aUrlIsFoundUnderTheTapAndNotItsTrailingPunctuation() {
        val row = "See https://example.com/docs, or http://a.b/c)."
        assertEquals("https://example.com/docs", urlInRow(row, 6))
        assertEquals("https://example.com/docs", urlInRow(row, 4))
        assertNull(urlInRow(row, 0))
        // The comma after the first URL is not part of it.
        assertNull(urlInRow(row, 28))
        assertEquals("http://a.b/c", urlInRow(row, 40))
    }
}
