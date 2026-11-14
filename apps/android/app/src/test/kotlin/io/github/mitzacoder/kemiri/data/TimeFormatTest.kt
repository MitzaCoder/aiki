package io.github.mitzacoder.kemiri.data

import java.time.Instant
import java.time.ZoneId
import java.time.format.FormatStyle
import java.util.Locale
import org.junit.Assert.*
import org.junit.Test

class TimeFormatTest {
    private fun clock(at: String, mode: TimeFormat, locale: Locale = Locale.US) =
        localizedTimeFormatter(locale = locale, choice = mode).withZone(ZoneId.of("UTC")).format(Instant.parse(at))
    @Test fun automaticFollowsLocale() {
        assertTrue(clock("2026-01-01T17:04:00Z", TimeFormat.Automatic).contains("PM"))
        assertEquals("17:04", clock("2026-01-01T17:04:00Z", TimeFormat.Automatic, Locale.UK))
    }
    @Test fun overridesLocaleAndHandlesMidnightNoon() {
        for (locale in listOf(Locale.US, Locale.UK)) {
            assertEquals("00:04", clock("2026-01-01T00:04:00Z", TimeFormat.Hour24, locale))
            assertTrue(clock("2026-01-01T12:04:00Z", TimeFormat.Hour12, locale).startsWith("12:04"))
            assertTrue(clock("2026-01-01T17:04:00Z", TimeFormat.Hour12, locale).startsWith("05:04"))
        }
    }
    @Test fun preservesDateSecondsZoneAndQuotedLiterals() {
        val at = Instant.parse("2026-01-01T17:04:05Z")
        val text = timeFormatter("yyyy-MM-dd 'Hours' HH:mm:ss z", Locale.US, TimeFormat.Hour12).withZone(ZoneId.of("America/New_York")).format(at)
        assertTrue(text.contains("2026-01-01 Hours 12:04:05"))
        assertTrue(text.contains("EST")); assertTrue(text.endsWith("PM"))
        assertFalse(localizedTimeFormatter(FormatStyle.MEDIUM, FormatStyle.MEDIUM, Locale.US, TimeFormat.Hour24).withZone(ZoneId.of("UTC")).format(at).contains("PM"))
    }
    @Test fun settingsRemainBackwardCompatibleAndChoiceChangesLive() {
        val saved = wireJson.decodeFromString(DeviceSettings.serializer(), "{}")
        assertEquals(TimeFormat.Automatic, saved.timeFormat)
        try {
            DeviceTimeFormat.current = TimeFormat.Hour24; assertEquals("17:04", displayWallTime("17:04"))
            DeviceTimeFormat.current = TimeFormat.Hour12; assertTrue(displayWallTime("17:04").startsWith("05:04"))
            val settings = saved.copy(timeFormat = TimeFormat.Hour12)
            assertEquals(settings, wireJson.decodeFromString(DeviceSettings.serializer(), wireJson.encodeToString(DeviceSettings.serializer(), settings)))
        } finally { DeviceTimeFormat.current = TimeFormat.Automatic }
    }
}
