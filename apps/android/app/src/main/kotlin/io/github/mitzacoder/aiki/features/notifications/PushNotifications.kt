package io.github.mitzacoder.aiki.features.notifications

import io.github.mitzacoder.aiki.features.chat.markdownText

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.annotation.ChecksSdkIntAtLeast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.mitzacoder.aiki.MainActivity
import io.github.mitzacoder.aiki.R
import io.github.mitzacoder.aiki.data.wireJson
import io.github.mitzacoder.aiki.protocol.NotificationPayload

/** The intent a notification tap sends to [MainActivity], with the payload it should open. */
const val ACTION_OPEN_NOTIFICATION = "io.github.mitzacoder.aiki.OPEN_NOTIFICATION"
const val EXTRA_NOTIFICATION_PAYLOAD = "io.github.mitzacoder.aiki.NOTIFICATION_PAYLOAD"

/** Kinds that want the user now: they pop up; the rest arrive quietly in the shade. */
private val URGENT_KINDS = setOf("board_question", "login_prompt", "task_review")

fun notificationChannelId(kind: String) = "kind-$kind"

/** One channel per kind, named like the preferences, so the system settings can tune each on its own. */
fun ensureNotificationChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannelGroup(NotificationChannelGroup("events", "Harness events"))
    val channels = NOTIFICATION_KIND_INFO.map { info ->
        val importance = if (info.failure || info.kind in URGENT_KINDS) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
        NotificationChannel(notificationChannelId(info.kind), info.label, importance).apply { description = info.description; group = "events" }
    } + NotificationChannel(notificationChannelId("test"), "Test notifications", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "What \"Send test\" pushes."
    }
    manager.createNotificationChannels(channels)
}

/** Android 13 asks for POST_NOTIFICATIONS; before it, only the app's notification switch in system settings counts. */
@get:ChecksSdkIntAtLeast(api = Build.VERSION_CODES.TIRAMISU)
val needsNotificationPermission get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

fun canPostNotifications(context: Context): Boolean =
    (!needsNotificationPermission || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        NotificationManagerCompat.from(context).areNotificationsEnabled()

/**
 * Draw one push. Same tag replaces the last notification, like the web's; a failure buzzes again while anything else
 * updates quietly. Nothing is filtered here: with the app open the backend held the push for 15 s and dropped it if the
 * user interacted, so a push that arrives is one to show, even for the project on screen.
 */
fun showPushNotification(context: Context, payload: NotificationPayload): Boolean {
    if (!canPostNotifications(context)) return false
    val open = Intent(context, MainActivity::class.java)
        .setAction(ACTION_OPEN_NOTIFICATION)
        .putExtra(EXTRA_NOTIFICATION_PAYLOAD, wireJson.encodeToString(NotificationPayload.serializer(), payload))
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val tap = PendingIntent.getActivity(context, payload.tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val channel = notificationChannelId(if (kindInfo(payload.kind) != null) payload.kind else "test")
    val notification = NotificationCompat.Builder(context, channel)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(payload.title)
        .setContentText(if (payload.kind == "board_question") markdownText(payload.body) else payload.body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(if (payload.kind == "board_question") markdownText(payload.body) else payload.body))
        .setContentIntent(tap)
        .setAutoCancel(true)
        .setOnlyAlertOnce(!isNotificationFailure(payload.kind))
        .setWhen(runCatching { java.time.Instant.parse(payload.at).toEpochMilli() }.getOrDefault(System.currentTimeMillis()))
        .setShowWhen(true)
        .setCategory(if (isNotificationFailure(payload.kind)) NotificationCompat.CATEGORY_ERROR else NotificationCompat.CATEGORY_MESSAGE)
        .build()
    return try {
        NotificationManagerCompat.from(context).notify("${payload.backendKey}|${payload.tag}", 0, notification)
        true
    } catch (_: SecurityException) {
        false
    }
}
