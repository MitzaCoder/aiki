package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.protocol.WorkerDefaults
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ChatFilesTest {
    private val file = ChatFile("a".repeat(32), "notes.md", 1024, "text/markdown", "/attachments/project/1/${"a".repeat(32)}", "/example/backend/notes.md")
    private fun envelope(file: ChatFile) = "Please review\n[aiki-files-v1]\n${Json.encodeToString(ChatFile.serializer(), file)}\nFile notes.md\n```\n# notes\n```\n[/aiki-files-v1]"
    @Test fun textEnvelopeKeepsOldTextAndSafeDownloadMetadata() {
        val parsed = splitFileMessage(envelope(file))
        assertEquals("Please review", parsed.text)
        assertEquals(listOf(file), parsed.files)
        assertEquals("1.0 KB", fileSizeLabel(1024))
        assertEquals("1.0 MB", fileSizeLabel(1024 * 1024))
    }
    @Test fun unknownAndUnsafeEnvelopesStayReadableText() {
        for (url in listOf("https://evil.example.test/file", "//evil.example.test/file", "/attachments/../../etc/passwd", "javascript:alert(1)")) {
            val text = envelope(file.copy(url = url))
            assertEquals(text, splitFileMessage(text).text)
            assertTrue(splitFileMessage(text).files.isEmpty())
        }
        for (text in listOf("old message", "\n[aiki-files-v2]\nfuture", "\n[aiki-files-v1]\ninvalid\n[/aiki-files-v1]")) assertEquals(text, splitFileMessage(text).text)
    }
    @Test fun fileIdsSurviveSavedAdmissionAndCannotBeChangedOnRetry() {
        val admission = PendingAdmission.create("scope", "read", emptyList(), WorkerDefaults(null, null), "same-admission", fileIds = listOf(file.id))
        val restored = PendingAdmission.restore(admission.save())!!
        assertEquals(listOf(file.id), restored.fileIds)
        assertEquals("same-admission", restored.requestId)
        assertTrue(restored.canRetry("scope", "read", emptyList(), fileIds = listOf(file.id)))
        assertFalse(restored.canRetry("scope", "read", emptyList()))
        assertFalse(restored.canRetry("scope", "read", emptyList(), fileIds = listOf("b".repeat(32))))
    }
    @Test fun oldSavedAdmissionHasNoFiles() {
        val old = PendingAdmission.create("scope", "old text", emptyList(), WorkerDefaults(null, null))
        assertTrue(PendingAdmission.restore(old.save())!!.fileIds.isEmpty())
        assertTrue(old.canRetry("scope", "old text", emptyList()))
    }
}
