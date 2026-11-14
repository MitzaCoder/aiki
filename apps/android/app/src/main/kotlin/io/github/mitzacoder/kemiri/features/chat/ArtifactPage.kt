package io.github.mitzacoder.kemiri.features.chat

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.print.PrintManager
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
import androidx.compose.ui.graphics.toArgb
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import io.github.mitzacoder.kemiri.ui.theme.JarvisColors

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

/** The only navigation actions an origin-less artifact may request. */
internal enum class ArtifactLinkAction { Scroll, Browser, Email, Dial, Block }

internal fun artifactLinkAction(url: String): ArtifactLinkAction {
    val link = url.trim()
    if (link.startsWith("#") || link.startsWith("about:blank#")) return ArtifactLinkAction.Scroll
    val uri = runCatching { java.net.URI(link) }.getOrNull() ?: return ArtifactLinkAction.Block
    return when (uri.scheme?.lowercase()) {
        "http", "https" -> if (!uri.host.isNullOrBlank()) ArtifactLinkAction.Browser else ArtifactLinkAction.Block
        "mailto" -> if (!uri.rawSchemeSpecificPart.isNullOrBlank()) ArtifactLinkAction.Email else ArtifactLinkAction.Block
        "tel" -> if (!uri.rawSchemeSpecificPart.isNullOrBlank()) ArtifactLinkAction.Dial else ArtifactLinkAction.Block
        else -> ArtifactLinkAction.Block
    }
}

internal fun isExternalBrowserLink(url: String): Boolean = artifactLinkAction(url) == ArtifactLinkAction.Browser

/** Do not preflight resolveActivity: package visibility can hide an otherwise available handler. */
internal fun artifactLinkIntent(url: String): Intent? {
    val action = when (artifactLinkAction(url)) {
        ArtifactLinkAction.Browser -> Intent.ACTION_VIEW
        ArtifactLinkAction.Email -> Intent.ACTION_SENDTO
        ArtifactLinkAction.Dial -> Intent.ACTION_DIAL
        else -> return null
    }
    return Intent(action, url.toUri().normalizeScheme()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/**
 * The artifact's document in a WebView, the size of the caller's box. The same page the web draws, with the policy
 * above: no bridge (see this file's header), an origin-less document, and links out to the browser.
 */
@SuppressLint("ClickableViewAccessibility") // The listener never consumes events; WebView keeps native click/accessibility handling.
@Composable
internal fun ArtifactPage(html: String, modifier: Modifier = Modifier, blockRequests: Boolean = false, hostControls: Boolean = false, onPrintReady: ((() -> Unit)?) -> Unit = {}) {
    val context = LocalContext.current
    val colors = Jarvis.colors
    val document = artifactPageDocument(html, colors.dark, artifactThemeTokens(colors), blockRequests, !hostControls)
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
                    if (request.url.toString() == "aiki-artifact:print" && request.hasGesture()) {
                        val printing = view.context.getSystemService(Context.PRINT_SERVICE) as PrintManager
                        printing.print("Artifact", view.createPrintDocumentAdapter("Artifact"), null)
                        return true
                    }
                    if (artifactLinkAction(request.url.toString()) == ArtifactLinkAction.Scroll) {
                        val fragment = request.url.toString().substringAfter('#')
                        view.evaluateJavascript("window.aikiArtifactScroll(" + org.json.JSONObject.quote(fragment) + ")", null)
                        return true
                    }
                    val intent = artifactLinkIntent(request.url.toString()) ?: return true
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
    DisposableEffect(webView, hostControls) {
        onPrintReady {
            val printing = webView.context.getSystemService(Context.PRINT_SERVICE) as PrintManager
            printing.print("Artifact", webView.createPrintDocumentAdapter("Artifact"), null)
        }
        onDispose {
            onPrintReady(null)
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        }
    }
    LaunchedEffect(webView, document) {
        // No base URL: the document has no origin and no cookies, as a sandboxed frame's.
        webView.loadDataWithBaseURL(null, document, "text/html", "utf-8", null)
    }
    AndroidView(factory = { webView }, modifier = modifier.fillMaxWidth())
}


/** Current Compose tones, in the same CSS names as the web and bundled skill. */
internal fun artifactThemeTokens(colors: JarvisColors): Map<String, String> {
    fun hex(color: androidx.compose.ui.graphics.Color) = "#%06x".format(color.toArgb() and 0xffffff)
    return mapOf(
        "tone-bg" to hex(colors.bg), "tone-surface" to hex(colors.surface), "tone-surface-2" to hex(colors.surface2),
        "tone-border" to hex(colors.border), "tone-border-strong" to hex(colors.borderStrong),
        "tone-fg" to hex(colors.fg), "tone-fg-muted" to hex(colors.fgMuted), "tone-fg-subtle" to hex(colors.fgSubtle),
        "tone-primary" to hex(if (colors.dark && !colors.neutral) androidx.compose.ui.graphics.Color(0xFF818CF8) else colors.accent2),
        "tone-primary-fg" to if (colors.dark && !colors.neutral) "#0b0b14" else if (colors.neutral) hex(colors.bg) else "#ffffff",
        "tone-accent-1" to hex(colors.accent1), "tone-accent-2" to hex(colors.accent2),
        "tone-accent-3" to hex(colors.accent3), "tone-accent-4" to hex(colors.accent4),
        "tone-danger" to hex(colors.danger), "tone-success" to hex(colors.success), "tone-warning" to hex(colors.warning), "tone-ring" to hex(colors.ring),
        "tone-radius" to if (colors.neutral) "0.625rem" else "0.875rem",
        "font-sans" to "system-ui,sans-serif", "font-mono" to "ui-monospace,monospace",
        "text-task" to ".9375rem", "text-task-sm" to ".8125rem", "spacing" to ".25rem",
    )
}

internal const val ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://cdnjs.cloudflare.com; img-src data: blob: https:; font-src data: https://cdnjs.cloudflare.com; media-src data: blob: https:; connect-src 'none'; form-action 'none'; base-uri 'none'"

/** First-in-head CSP and defaults. No author bytes enter a native/app origin or a JavaScript bridge. */
internal fun artifactPageDocument(html: String, dark: Boolean, tokens: Map<String, String>, blockRequests: Boolean = false, showPrintButton: Boolean = true): String {
    val mode = if (dark) "dark" else "light"
    val variables = tokens.filterKeys { it.matches(Regex("[a-z-]+")) }.entries.joinToString("") { (name, value) -> "--$name:" + value.replace(Regex("[<>{};]"), "") + ";" }
    val policy = if (blockRequests) "<meta http-equiv=\"Content-Security-Policy\" content=\"$ARTIFACT_CSP\">" else ""
    val prelude = """$policy
<style data-aiki-artifact-prelude>
:where(:root){$variables color-scheme:$mode}
:where(body){background:var(--tone-bg);color:var(--tone-fg);font:16px/1.6 var(--font-sans,system-ui,sans-serif)}
:where(a){color:var(--tone-primary)}
#aiki-artifact-print{position:fixed;right:12px;bottom:12px;z-index:2147483647;border:1px solid var(--tone-border,#ccc);border-radius:999px;background:var(--tone-surface,#fff);color:var(--tone-fg,#111);padding:8px 16px;font:14px/1.4 system-ui}
@media print{#aiki-artifact-print{display:none!important}:where(body){background:white;color:black}img,video,svg{max-width:100%}pre{white-space:pre-wrap}h1,h2,h3{break-after:avoid}figure,tr{break-inside:avoid}}
</style>
<script>
window.aikiArtifactScroll=function(fragment){try{var id=decodeURIComponent(fragment);if(!id)window.scrollTo(0,0);else{var target=document.getElementById(id)||document.getElementsByName(id)[0];if(target)target.scrollIntoView()}}catch(e){}};
document.addEventListener('click',function(event){if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;var anchor=event.target.closest&&event.target.closest('a[href]');if(!anchor)return;var href=anchor.getAttribute('href').trim();if(href.charAt(0)==='#'){event.preventDefault();window.aikiArtifactScroll(href.slice(1))}},true);
window.print=function(){location.href='aiki-artifact:print'};${if (showPrintButton) """(function(){function add(){var b=document.createElement('button');b.id='aiki-artifact-print';b.type='button';b.textContent='Print';b.setAttribute('aria-label','Print this artifact');b.onclick=function(){window.print()};document.body.appendChild(b)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add()})();""" else ""}</script>"""
    val source = html.replaceFirst(Regex("^\\s*<!doctype[^>]*>", RegexOption.IGNORE_CASE), "")
    val opening = Regex("""^\s*<html\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>""", RegexOption.IGNORE_CASE).find(source)
    val attributes = (opening?.groupValues?.get(1) ?: "").replace(Regex("""\s+([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?""")) {
        if (it.groupValues[1].equals("data-theme", ignoreCase = true)) "" else it.value
    }
    var remainder = if (opening != null) source.substring(opening.range.last + 1) else source
    val head = Regex("""^\s*<head\b(?:[^"'<>]|"[^"]*"|'[^']*')*>""", RegexOption.IGNORE_CASE).find(remainder)
    remainder = if (head != null) head.value + prelude + remainder.substring(head.range.last + 1) else "<head>$prelude</head>$remainder"
    return "<!doctype html><html$attributes data-theme=\"$mode\">$remainder" + if (opening != null) "" else "</html>"
}
