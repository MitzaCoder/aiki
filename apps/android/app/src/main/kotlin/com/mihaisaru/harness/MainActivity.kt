package com.mihaisaru.harness

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import com.mihaisaru.harness.features.chat.CodeWrapChoice
import com.mihaisaru.harness.features.chat.LocalCodeWrap
import kotlinx.coroutines.launch
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.ThemeMode
import com.mihaisaru.harness.features.notifications.*
import com.mihaisaru.harness.navigation.HarnessApp
import com.mihaisaru.harness.navigation.LocalProjectMute
import com.mihaisaru.harness.navigation.connectPayloadFromUri
import com.mihaisaru.harness.ui.theme.HarnessTheme

class MainActivity : ComponentActivity() {
    private var connectPayload by mutableStateOf<String?>(null)
    /** A project link or a notification tap, opened once the backends have loaded. */
    private var pendingLink by mutableStateOf<PendingAppLink?>(null)
    private val notifications get() = (application as HarnessApplication).notifications
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState != null) {
            connectPayload = savedInstanceState.getString("pending-connect")
            pendingLink = savedInstanceState.getString("pending-link")?.let(::decodePendingAppLink)
        } else readIntent(intent)
        val repository = (application as HarnessApplication).repository
        val notifications = notifications
        val projectMute = CenterProjectMute(notifications)
        setContent {
            val settings by repository.settings.collectAsStateWithLifecycle()
            val dark = when (settings.mode) {
                ThemeMode.System -> isSystemInDarkTheme()
                ThemeMode.Light -> false
                ThemeMode.Dark -> true
            }
            SideEffect {
                val bars = if (dark) SystemBarStyle.dark(Color.TRANSPARENT)
                    else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
            }
            HarnessTheme(settings.palette, settings.mode) {
                val scope = rememberCoroutineScope()
                val codeWrap = remember(settings.codeWrap) { CodeWrapChoice(settings.codeWrap) { stored -> scope.launch { repository.setCodeWrap(stored) } } }
                CompositionLocalProvider(LocalNotificationCenter provides notifications, LocalProjectMute provides projectMute, LocalCodeWrap provides codeWrap) {
                    HarnessApp(repository, connectPayload, onConnectHandled = {
                        connectPayload = null
                        intent?.data = null // Rotation/process recreation must not reopen a consumed import.
                    }, pendingLink = pendingLink, onLinkHandled = {
                        pendingLink = null
                        intent?.data = null
                        intent?.removeExtra(EXTRA_NOTIFICATION_PAYLOAD)
                    })
                }
            }
        }
    }
    /**
     * Using the app, on any screen: a touch (every move of a drag or fling too), a key, the mouse wheel. The notification
     * center throttles what it tells the backends. A mouse move alone does not count. (Typing on the soft keyboard is
     * reported by the composer.) `onUserInteraction` covers keys, trackballs and the start of a touch; it is the hook for
     * keys because `dispatchKeyEvent` is restricted API on a `ComponentActivity`.
     */
    override fun onUserInteraction() { super.onUserInteraction(); notifications.interacted() }
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean { notifications.interacted(); return super.dispatchTouchEvent(ev) }
    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_SCROLL) notifications.interacted()
        return super.dispatchGenericMotionEvent(ev)
    }
    override fun onStart() {
        super.onStart()
        notifications.setVisible(true)
    }
    override fun onStop() {
        notifications.setVisible(false)
        super.onStop()
    }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("pending-connect", connectPayload)
        outState.putString("pending-link", pendingLink?.encode())
        super.onSaveInstanceState(outState)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readIntent(intent)
    }
    private fun readIntent(intent: Intent?) {
        if (intent == null) return
        val data = intent.dataString
        connectPayload = data?.let(::connectPayloadFromUri)
        pendingLink = when {
            intent.action == ACTION_OPEN_NOTIFICATION -> intent.getStringExtra(EXTRA_NOTIFICATION_PAYLOAD)?.let { PendingAppLink.Notification(it) }
            data != null && isProjectLink(data) -> PendingAppLink.Web(data)
            else -> null
        }
    }
}
