package io.github.mitzacoder.kemiri.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.time.LocalTime
import java.time.chrono.IsoChronology
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.format.FormatStyle
import java.util.Locale

/** Display-only, persisted with the other device settings. */
enum class TimeFormat(val label: String) { Automatic("Automatic"), Hour24("24-hour"), Hour12("12-hour") }
object DeviceTimeFormat { var current by mutableStateOf(TimeFormat.Automatic) }

/** All clock-bearing formatters use this factory; quoted date literals are never rewritten. */
fun timeFormatter(pattern: String, locale: Locale = Locale.getDefault(), choice: TimeFormat = DeviceTimeFormat.current): DateTimeFormatter {
    val localePattern = DateTimeFormatterBuilder.getLocalizedDateTimePattern(null, FormatStyle.SHORT, IsoChronology.INSTANCE, locale)
    val resolved = if (choice == TimeFormat.Automatic) {
        if (Regex("[hK]").containsMatchIn(localePattern)) TimeFormat.Hour12 else TimeFormat.Hour24
    } else choice
    val parts = Regex("('(?:[^']|'')*')").split(pattern)
    val literals = Regex("('(?:[^']|'')*')").findAll(pattern).map { it.value }.toList()
    val hasPeriod = parts.any { Regex("[aB]").containsMatchIn(it) }
    val rewritten = parts.mapIndexed { index, part ->
        val clock = part.replace(Regex("[HhKk]+")) { token ->
            if (resolved == TimeFormat.Hour24) "HH" else if (choice == TimeFormat.Automatic && token.value.length == 1) "h" else "hh"
        }.let { if (resolved == TimeFormat.Hour24) it.replace(Regex("[aB]+"), "") else it }
        clock + literals.getOrElse(index) { "" }
    }.joinToString("").trim().replace(Regex(" {2,}"), " ")
    return DateTimeFormatter.ofPattern(rewritten + if (resolved == TimeFormat.Hour12 && !hasPeriod) " a" else "", locale)
}
fun localizedTimeFormatter(dateStyle: FormatStyle? = null, timeStyle: FormatStyle = FormatStyle.SHORT, locale: Locale = Locale.getDefault(), choice: TimeFormat = DeviceTimeFormat.current): DateTimeFormatter =
    timeFormatter(DateTimeFormatterBuilder.getLocalizedDateTimePattern(dateStyle, timeStyle, IsoChronology.INSTANCE, locale), locale, choice)

/** Protocol wall times stay HH:mm. Only their displayed labels use the choice. */
fun displayWallTime(time: String): String = runCatching { localizedTimeFormatter().format(LocalTime.parse(time)) }.getOrDefault(time)
