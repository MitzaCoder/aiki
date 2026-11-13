package io.github.mitzacoder.aiki.features.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * An HTML artifact's page: the settings its WebView gets, the Page/Source choice, the link policy out of it and the
 * preview limit. The WebView itself needs a device; everything decided before one exists is here.
 */
class ArtifactPageTest {
    @Test fun htmlIsItsOwnKindByTypeOrName() {
        assertTrue(isHtmlArtifact("report.html", "text/html"))
        assertTrue(isHtmlArtifact("page", "text/html; charset=utf-8"))
        assertTrue(isHtmlArtifact("chart.XHTML", "application/octet-stream"))
        assertTrue(isHtmlArtifact("index.htm", ""))
        assertFalse(isHtmlArtifact("report.md", "text/markdown"))
        assertFalse(isHtmlArtifact("log.txt", "text/plain"))
        assertFalse(isHtmlArtifact("data.json", "application/json"))
        assertFalse(isHtmlArtifact("html-notes.txt", "text/plain"))
    }

    @Test fun thePageRunsScriptsWithoutFileContentLocationFormOrMixedContent() {
        val policy = artifactPagePolicy()
        // Charts and counters are scripts; that is the one capability the page keeps.
        assertTrue(policy.javaScript)
        assertFalse(policy.domStorage)
        assertFalse(policy.supportMultipleWindows)
        assertFalse(policy.javascriptCanOpenWindows)
        assertFalse(policy.fileAccess)
        assertFalse(policy.contentAccess)
        assertFalse(policy.fileUrlAccess)
        assertFalse(policy.universalFileUrlAccess)
        assertFalse(policy.geolocation)
        assertFalse(policy.saveFormData)
        assertFalse(policy.savePassword)
        assertFalse(policy.mixedContentAllowed)
        assertTrue(policy.mediaPlaybackNeedsGesture)
    }

    @Test fun aPageOpensRenderedUnlessTheReaderChoseSource() {
        assertEquals(ArtifactPageView.Page, artifactPageView(null, pageTooLarge = false))
        assertEquals(ArtifactPageView.Source, artifactPageView(null, pageTooLarge = true))
        // The reader's own choice wins over the limit, as on the web, so a partial page can still be drawn.
        assertEquals(ArtifactPageView.Page, artifactPageView(ArtifactPageView.Page, pageTooLarge = true))
        assertEquals(ArtifactPageView.Source, artifactPageView(ArtifactPageView.Source, pageTooLarge = false))
    }

    @Test fun theChoiceIsKeptForTheSessionAndNeverWrittenDown() {
        ArtifactPageChoice.clear()
        assertNull(ArtifactPageChoice.remembered())
        ArtifactPageChoice.remember(ArtifactPageView.Source)
        assertEquals(ArtifactPageView.Source, ArtifactPageChoice.remembered())
        // The next artifact opens the way the reader left the last one.
        assertEquals(ArtifactPageView.Source, artifactPageView(ArtifactPageChoice.remembered(), pageTooLarge = false))
        ArtifactPageChoice.remember(ArtifactPageView.Page)
        assertEquals(ArtifactPageView.Page, ArtifactPageChoice.remembered())
        ArtifactPageChoice.clear()
        assertNull(ArtifactPageChoice.remembered())
    }

    @Test fun onlyHttpLinksLeaveTheWebView() {
        assertTrue(isExternalBrowserLink("https://example.com/report?q=1#top"))
        assertTrue(isExternalBrowserLink("http://127.0.0.1:4900/page"))
        assertTrue(isExternalBrowserLink("HTTPS://example.com"))
        assertFalse(isExternalBrowserLink("javascript:alert(1)"))
        assertFalse(isExternalBrowserLink("intent://example.com#Intent;end"))
        assertFalse(isExternalBrowserLink("content://media/external/images/1"))
        assertFalse(isExternalBrowserLink("file:///sdcard/secret.txt"))
        assertFalse(isExternalBrowserLink("about:blank"))
        assertFalse(isExternalBrowserLink("data:text/html,<b>x</b>"))
        assertFalse(isExternalBrowserLink("aiki://connect#v1.abc"))
        assertFalse(isExternalBrowserLink(""))
        assertFalse(isExternalBrowserLink("not a url"))
    }

    @Test fun anHtmlPreviewKeepsThePageLimitAndSaysItIsCutShort() {
        val short = "<!doctype html><p>hi</p>".toByteArray()
        val kept = artifactPreview(short, html = true)
        assertEquals("<!doctype html><p>hi</p>", kept.text)
        assertFalse(kept.truncated)

        val over = ByteArray(ARTIFACT_HTML_PAGE_LIMIT + 1) { 97 }
        val page = artifactPreview(over, html = true)
        assertEquals(ARTIFACT_HTML_PAGE_LIMIT, page.text.length)
        assertTrue(page.truncated)
        // The same bytes are still a whole text preview: the limit belongs to pages, not to source.
        val source = artifactPreview(over, html = false)
        assertEquals(ARTIFACT_HTML_PAGE_LIMIT + 1, source.text.length)
        assertFalse(source.truncated)
    }

    @Test fun aFileTheServerSaysIsLongerIsCutShort() {
        val bytes = "x".toByteArray()
        assertFalse(artifactPreview(bytes, html = false, size = 1).truncated)
        assertTrue(artifactPreview(bytes, html = false, size = 5000).truncated)
        // An unknown size (an older backend row) never invents truncation.
        assertFalse(artifactPreview(bytes, html = false, size = -1).truncated)
    }
}
