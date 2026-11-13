package io.github.mitzacoder.aiki.features.chat

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.MotionEvent
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri

/**
 * An HTML artifact shown as the page it is, and how that page is allowed to behave: the Android half of the web's
 * sandboxed artifact frame (`apps/web/src/lib/artifact-preview.ts`, DESIGN's "An HTML artifact is shown as a page").
 *
 * The web puts the document in an `<iframe sandbox>` with scripts but no `allow-same-origin`, so it runs in an opaque
 * origin. A WebView has no sandbox attribute; the equivalent is to take away everything that would let the page reach
 * the app or the device, and to give the document no origin at all: it is loaded with `loadDataWithBaseURL(null, …)`
 * under an opaque origin, like a sandboxed frame. Scripts stay on, because reports draw charts and counters with them,
 * and no JavaScript bridge is ever installed (`addJavascriptInterface` is never called): the page can compute in its
 * own document and call nothing of ours.
 */

/** Which way an HTML artifact is read: the page it renders to, or the source it was written in. */
internal enum class ArtifactPageView { Page, Source }

/**
 * The reader's last Page/Source choice for HTML artifacts, kept while the process lives: the web version of this is a
 * module-scoped variable in `ArtifactText.svelte`, so the choice survives one artifact and the next in a session but is
 * never written to storage.
 */
internal object ArtifactPageChoice {
    private var chosen: ArtifactPageView? = null
    fun remembered(): ArtifactPageView? = chosen
    fun remember(view: ArtifactPageView) { chosen = view }
    /** Forgets the choice; only the tests use it. */
    fun clear() { chosen = null }
}

/**
 * Which view an HTML artifact opens in. The reader's own choice wins; otherwise a page cut short by the preview limit
 * opens as its source, because half a document renders as something the worker never wrote.
 */
internal fun artifactPageView(chosen: ArtifactPageView?, pageTooLarge: Boolean): ArtifactPageView =
    chosen ?: if (pageTooLarge) ArtifactPageView.Source else ArtifactPageView.Page

/** What an HTML artifact's WebView may do; the opposite of every risky default, applied before the first load. */
internal data class ArtifactPagePolicy(
    /** Charts, counters and other scripts run, as in the web's frame. */
    val javaScript: Boolean,
    /** DOM storage needs an origin to hang on; the page has none, and the app keeps nothing in WebView storage. */
    val domStorage: Boolean,
    /** `window.open` and `target=_blank` links must not spawn a WebView pop-up nobody configured. */
    val javascriptCanOpenWindows: Boolean,
    val supportMultipleWindows: Boolean,
    /** No `file:` or `content:` document, resource or file-URL grant supplies the page with anything of the device. */
    val fileAccess: Boolean,
    val contentAccess: Boolean,
    val fileUrlAccess: Boolean,
    val universalFileUrlAccess: Boolean,
    /** The page never asks the device for a location. */
    val geolocation: Boolean,
    /** No form data or passwords are remembered between pages or in the app's storage. */
    val saveFormData: Boolean,
    val savePassword: Boolean,
    /** Blocked mixed content: an `https` page may not pull `http` bytes in, the platform's default and the web's. */
    val mixedContentAllowed: Boolean,
    /** Audio and video only after a tap, so a report cannot start playing by itself. */
    val mediaPlaybackNeedsGesture: Boolean,
)

/** The single policy every HTML artifact page gets; the tests pin each field. */
internal fun artifactPagePolicy(): ArtifactPagePolicy = ArtifactPagePolicy(
    javaScript = true,
    domStorage = false,
    javascriptCanOpenWindows = false,
    supportMultipleWindows = false,
    fileAccess = false,
    contentAccess = false,
    fileUrlAccess = false,
    universalFileUrlAccess = false,
    geolocation = false,
    saveFormData = false,
    savePassword = false,
    mixedContentAllowed = false,
    mediaPlaybackNeedsGesture = true,
)

/** Applies [artifactPagePolicy] to a WebView before it loads anything. */
@SuppressLint("SetJavaScriptEnabled")
internal fun applyArtifactPagePolicy(webView: WebView, policy: ArtifactPagePolicy = artifactPagePolicy()) {
    val settings: WebSettings = webView.settings
    // The document has no origin to store anything under, and the app never reads WebView storage.
    settings.domStorageEnabled = policy.domStorage
    settings.javaScriptEnabled = policy.javaScript
    settings.javaScriptCanOpenWindowsAutomatically = policy.javascriptCanOpenWindows
    settings.setSupportMultipleWindows(policy.supportMultipleWindows)
    settings.allowFileAccess = policy.fileAccess
    settings.allowContentAccess = policy.contentAccess
    settings.allowFileAccessFromFileURLs = policy.fileUrlAccess
    settings.allowUniversalAccessFromFileURLs = policy.universalFileUrlAccess
    settings.setGeolocationEnabled(policy.geolocation)
    @Suppress("DEPRECATION")
    settings.setSaveFormData(policy.saveFormData)
    @Suppress("DEPRECATION")
    settings.setSavePassword(policy.savePassword)
    settings.mixedContentMode = if (policy.mixedContentAllowed) {
        WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    } else WebSettings.MIXED_CONTENT_NEVER_ALLOW
    settings.mediaPlaybackRequiresUserGesture = policy.mediaPlaybackNeedsGesture
    // The page itself is the only document; no bridge, no cookie jar of the app's, no cache of its own on disk.
    webView.setBackgroundColor(Color.WHITE)
    webView.isVerticalScrollBarEnabled = true
}

/**
 * Whether a link tapped inside an artifact page goes to the external browser: `http` and `https` only. Any other
 * scheme (`intent:`, `content:`, `file:`, `javascript:`, an app's own deep link) is never followed and never handed to
 * the system.
 */
internal fun isExternalBrowserLink(url: String): Boolean {
    val scheme = runCatching { java.net.URI(url).scheme }.getOrNull()?.lowercase() ?: return false
    return scheme == "http" || scheme == "https"
}

/** A page tapped inside the artifact, or null when the URL must not leave the WebView. */
internal fun artifactLinkIntent(url: String, context: Context): Intent? {
    if (!isExternalBrowserLink(url)) return null
    return Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).let { intent ->
        if (context.packageManager.resolveActivity(intent, 0) == null) null else intent
    }
}

/**
 * The artifact's document in a WebView, the size of the caller's box. The same page the web draws, with the policy
 * above: no bridge (see this file's header), an origin-less document, and links out to the browser.
 */
@SuppressLint("ClickableViewAccessibility") // The listener never consumes events; WebView keeps native click/accessibility handling.
@Composable
internal fun ArtifactPage(html: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val webView = remember(context) {
        WebView(context).also { view ->
            applyArtifactPagePolicy(view)
            // Scrolling and zoom belong to this bounded viewport, never a Compose scrolling ancestor.
            view.settings.builtInZoomControls = true
            view.settings.displayZoomControls = false
            view.isHorizontalScrollBarEnabled = true
            view.setOnTouchListener { _, event ->
                if (event.actionMasked == MotionEvent.ACTION_DOWN) view.parent?.requestDisallowInterceptTouchEvent(true)
                false
            }
            view.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val intent = artifactLinkIntent(request.url.toString(), view.context) ?: return true
                    try {
                        view.context.startActivity(intent)
                    } catch (_: ActivityNotFoundException) {
                        // Nothing can open it; the page still keeps the tap rather than replacing itself.
                    }
                    return true
                }
            }
        }
    }
    DisposableEffect(webView) {
        onDispose {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        }
    }
    LaunchedEffect(webView, html) {
        // No base URL: the document has no origin and no cookies, as a sandboxed frame's.
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }
    AndroidView(factory = { webView }, modifier = modifier.fillMaxWidth())
}
