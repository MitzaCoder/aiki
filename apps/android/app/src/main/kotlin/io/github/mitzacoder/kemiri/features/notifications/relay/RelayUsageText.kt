package io.github.mitzacoder.kemiri.features.notifications.relay

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The account's daily allowance is the only summary; shared and shorter-window limits are details. */
fun relayVisibleQuotas(quotas: List<RelayQuota>, moreLimits: Boolean): List<RelayQuota> =
    quotas.filter { moreLimits || it.budget == "accountDay" }

/** Reset wording is local and time-only, with tomorrow stated when the reset crosses the local day. */
fun relayQuotaResetText(
    resetAt: Long,
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
): String {
    val reset = Instant.ofEpochMilli(resetAt).atZone(zone)
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val whenText = if (reset.toLocalDate() == today.plusDays(1)) "resets tomorrow at" else "resets at"
    val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(reset)
        .replace('\u202f', ' ').replace('\u00a0', ' ')
    return "$whenText $time"
}
