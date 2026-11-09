package com.mihaisaru.harness.chat

import com.mihaisaru.harness.features.chat.*
import com.mihaisaru.harness.protocol.WorkerDefaults
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChatAdmissionTest {
    private fun image(data: String, mime: String = "image/png") = buildJsonObject { put("type","image"); put("data",data); put("mimeType",mime) }

    @Test fun textAdmissionSurvivesSavedStateAndReusesIdAndContent() {
        val original = PendingAdmission.create("scope","hello",emptyList(),WorkerDefaults(null,null),"fixed-id")
        val restored = PendingAdmission.restore(original.save())!!
        assertEquals("fixed-id",restored.requestId)
        assertEquals(JsonPrimitive("hello"),restored.content(emptyList()))
        assertTrue(restored.canRetry("scope","hello",emptyList()))
        assertFalse(restored.canRetry("other backend","hello",emptyList()))
        assertFalse(restored.canRetry("scope","changed draft",emptyList()))
    }
    @Test fun imageSavedStateContainsDigestNotImageAndMissingImageCannotBeRetriedAsText() {
        val image = image("SECRET_BASE64".repeat(1000))
        val original = PendingAdmission.create("scope","hello",listOf(image),WorkerDefaults(null,null),"image-id")
        val saved = original.save()
        assertFalse(saved.contains("SECRET_BASE64"))
        assertTrue(saved.length < 1000)
        val restored = PendingAdmission.restore(saved)!!
        assertNull(restored.content(emptyList()))
        assertFalse(restored.canRetry("scope","hello",emptyList()))
        assertEquals(original.content(listOf(image)),restored.content(listOf(image)))
        assertEquals("image-id",restored.requestId)
    }
    @Test fun differentImageCannotReuseAdmission() {
        val saved = PendingAdmission.create("scope","",listOf(image("first")),WorkerDefaults(null,null),"id")
        assertFalse(saved.canRetry("scope","",listOf(image("different"))))
        assertNull(saved.content(listOf(image("different"))))
    }
    @Test fun severalImagesGoAfterTheTextInOrderAndTheOrderIsPartOfTheIdentity() {
        val first = image("AAAA"); val second = image("BBBB","image/jpeg")
        val admission = PendingAdmission.create("scope","look",listOf(first,second),WorkerDefaults(null,null),"id")
        assertEquals(buildJsonArray { add(buildJsonObject { put("type","text"); put("text","look") }); add(first); add(second) },admission.content(listOf(first,second)))
        assertFalse(admission.canRetry("scope","look",listOf(second,first)))
        assertFalse(admission.canRetry("scope","look",listOf(first)))
        assertTrue(admission.canRetry("scope","look",listOf(first,second)))
    }
    @Test fun imagesWithoutTextCarryNoTextBlock() {
        val only = image("AAAA")
        val admission = PendingAdmission.create("scope","  ",listOf(only),WorkerDefaults(null,null),"id")
        assertEquals(buildJsonArray { add(only) },admission.content(listOf(only)))
    }
}
