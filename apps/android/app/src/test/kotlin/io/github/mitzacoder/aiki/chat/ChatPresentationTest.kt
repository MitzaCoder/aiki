package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class ChatPresentationTest {
    @Test fun boundedReadsDoNotConsumeBeyondLimit() {
        val stream = "abcdef".byteInputStream()
        assertEquals("abc",stream.readAtMost(3).toString(Charsets.UTF_8))
        assertEquals("def",stream.readAtMost(99).toString(Charsets.UTF_8))
        assertEquals(0,stream.readAtMost(0).size)
    }
    @Test fun expirationRefreshIsEarlyAndBounded() {
        assertEquals(55000L,artifactRefreshDelay("1970-01-01T00:01:00Z",0))
        assertEquals(1000L,artifactRefreshDelay("1970-01-01T00:00:00Z",10000))
        assertEquals(55000L,artifactRefreshDelay("invalid",0))
    }
    @Test fun highlighterNeverDropsSource() = runBlocking {
        val source = "const answer = 42; // hello\nreturn \"done\";"
        val highlighted = ChatHighlighter.highlight(source,"javascript",true)
        assertEquals(source,highlighted.text)
        assertTrue(highlighted.spanStyles.isNotEmpty())
        assertEquals(source,ChatHighlighter.highlight(source,"plaintext",false).text)
    }
}
