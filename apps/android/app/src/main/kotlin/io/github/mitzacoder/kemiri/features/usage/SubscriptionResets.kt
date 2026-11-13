package io.github.mitzacoder.kemiri.features.usage

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.data.BackendSession
import io.github.mitzacoder.kemiri.data.ConnectionStatus
import io.github.mitzacoder.kemiri.data.request
import io.github.mitzacoder.kemiri.protocol.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

data class ResetGroup(val credit: SubscriptionResetCredit, val remaining: Long)
fun groupResets(credits: List<SubscriptionResetCredit>): List<ResetGroup> = credits.filter { it.remaining > 0 }
    .groupBy { listOf(it.program, it.label, it.expiresAt, it.clears.sorted(), it.givesBackWeekly == true, it.usable, it.unavailableReason) }
    .values.map { ResetGroup(it.first(), it.sumOf { credit -> credit.remaining }) }

fun resetExplanation(credit: SubscriptionResetCredit): String {
    val scopes = credit.clears.map { when(it) {
        "five_hour" -> "your 5-hour limit"
        "seven_day" -> "your weekly limit"
        "seven_day_fable", "seven_day_overage_included" -> "your Fable allowance"
        "seven_day_opus" -> "your Opus allowance"
        "seven_day_sonnet" -> "your Sonnet allowance"
        else -> it.replace('_', ' ')
    } }.joinToString(" and ").ifEmpty { "the provider’s covered limits" }
    return "This refills $scopes${if (credit.givesBackWeekly == true) " and gives back what Fable used on your weekly limit" else ""}."
}
fun resetExpiry(expiresAt: String?, remaining: Long): String {
    if (expiresAt == null) return "No expiry reported"
    val date = runCatching { DateTimeFormatter.ofPattern("MMM d, yyyy").withZone(ZoneId.systemDefault()).format(Instant.parse(expiresAt)) }.getOrDefault("unknown date")
    return "${if (remaining > 1) "all expire" else "expires"} $date"
}
fun resetUnavailableReason(credit: SubscriptionResetCredit): String = (credit.unavailableReason ?: "Not usable now").replace('_', ' ')

@Composable
fun SubscriptionResets(subscription: SubscriptionUsage, backend: BackendSession, onRefresh: () -> Unit) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var confirming by remember { mutableStateOf<ResetGroup?>(null) }
    var pending by remember { mutableStateOf(false) }
    var uncertain by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val resets = subscription.manualResets
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HorizontalDivider()
        Text("Limit resets · ${resets?.let { "${it.available} available" } ?: "Not reported by this provider"}", style = MaterialTheme.typography.titleSmall)
        resets?.reason?.let { Text(it.replace('_', ' '), style = MaterialTheme.typography.bodySmall) }
        groupResets(resets?.credits.orEmpty()).forEach { group ->
            val credit = group.credit
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${credit.label}${if (group.remaining > 1) " · ${group.remaining}" else ""} · ${resetExpiry(credit.expiresAt, group.remaining)}", style = MaterialTheme.typography.titleSmall)
                Text(resetExplanation(credit), style = MaterialTheme.typography.bodySmall)
                if (!credit.usable) Text(resetUnavailableReason(credit), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                if (connection.supports("subscription-resets")) OutlinedButton(
                    onClick = { confirming = group; message = null },
                    enabled = credit.usable && !pending && !uncertain && connection.status == ConnectionStatus.Ready,
                    modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = "Reset for free using 1 ${credit.label}" }
                ) { Text("Reset for free") }
            }
        }
        if (pending) Text("Applying one reset…", style = MaterialTheme.typography.bodySmall)
        message?.let { result -> Snackbar(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }, action = { TextButton(onClick = { message = null }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Dismiss") } }) { Text(result) } }
    }
    confirming?.let { group -> AlertDialog(
        onDismissRequest = { confirming = null },
        title = { Text("Use 1 of ${group.remaining} ${group.credit.label}s?") },
        text = { Text("${resetExplanation(group.credit)} It can't be undone.") },
        dismissButton = { TextButton(onClick = { confirming = null }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancel") } },
        confirmButton = { TextButton(onClick = {
            if (pending) return@TextButton
            confirming = null
            pending = true
            scope.launch {
                try {
                    val answer = backend.client.request(SubscriptionsResetRequest(providerId = subscription.providerId, creditId = group.credit.id, program = group.credit.program, requestId = UUID.randomUUID().toString(), confirmed = true))
                    uncertain = answer.code == "unknown_outcome"
                    message = when {
                        answer.ok -> "Reset applied. Subscription limits have been refreshed."
                        uncertain -> "The outcome is unknown. Check the provider before trying another reset."
                        else -> "Reset not applied: ${answer.code.replace('_', ' ')}."
                    }
                    onRefresh()
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) {
                    uncertain = true
                    message = "The outcome is unknown. Check the provider before trying another reset."
                    onRefresh()
                } finally { pending = false }
            }
        }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Confirm") } }
    ) }
}
