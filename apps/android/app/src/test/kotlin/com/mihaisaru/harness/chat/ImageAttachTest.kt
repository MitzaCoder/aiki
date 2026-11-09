package com.mihaisaru.harness.chat

import com.mihaisaru.harness.features.chat.*
import org.junit.Assert.*
import org.junit.Test

/** The limits and decisions for images in a message; the web's `images.test.ts` has the same cases. */
class ImageAttachTest {
    private val mib = 1024 * 1024

    @Test fun fitWithinKeepsTheShapeAndNeverScalesUp() {
        assertEquals(2000 to 1000,fitWithin(4000,2000))
        assertEquals(667 to 2000,fitWithin(1000,3000))
        assertEquals(800 to 600,fitWithin(800,600))
    }

    @Test fun aScreenshotWithinTheLimitsGoesAsItIs() {
        assertEquals(ImagePlan.Keep,planImage("image/png",800_000,1920,1080))
        assertEquals(ImagePlan.Keep,planImage("image/png",INPUT_IMAGE_MAX_BYTES,2000,1500))
    }

    @Test fun aBigScreenshotIsDrawnAt2000pxAndStaysPngWhenThatIsEnough() {
        val plan = planImage("image/png",3 * mib,3840,2160) as ImagePlan.Encode
        assertEquals(EncodeAttempt(2000,1125,"image/png"),plan.attempts[0])
        assertEquals("image/jpeg",plan.attempts[1].type)
        assertEquals(2000 to 1125,plan.attempts[1].width to plan.attempts[1].height)
        assertTrue(plan.attempts.drop(2).all { it.type == "image/jpeg" })
        val edges = plan.attempts.map { maxOf(it.width,it.height) }
        assertEquals(edges.sortedDescending(),edges)
        assertTrue(edges.min() >= MIN_ENCODE_EDGE)
    }

    @Test fun aSmallImageOver5MiBIsEncodedAgainAtItsSize() {
        val plan = planImage("image/png",6 * mib,1900,1200) as ImagePlan.Encode
        assertEquals(EncodeAttempt(1900,1200,"image/png"),plan.attempts[0])
    }

    @Test fun aBigJpegOrWebpStaysItsOwnFormatFirst() {
        val jpeg = planImage("image/jpeg",9 * mib,6000,4000) as ImagePlan.Encode
        val webp = planImage("image/webp",2 * mib,5000,2500) as ImagePlan.Encode
        assertEquals("image/jpeg",jpeg.attempts[0].type)
        assertEquals(2000,jpeg.attempts[0].width)
        assertEquals(1,jpeg.attempts.count { it.width == 2000 })
        assertEquals("image/webp",webp.attempts[0].type)
        assertEquals("image/jpeg",webp.attempts[1].type)
    }

    @Test fun aTypeTheProtocolDoesNotTakeIsEncodedAsPngFirst() {
        val plan = planImage("image/bmp",100_000,300,200) as ImagePlan.Encode
        assertEquals(EncodeAttempt(300,200,"image/png"),plan.attempts[0])
    }

    @Test fun aGifIsKeptWithin5MiBAtAnySizeAndRefusedOverNeverReencoded() {
        assertEquals(ImagePlan.Keep,planImage("image/gif",mib,5000,5000))
        val over = planImage("image/gif",6 * mib,500,500)
        assertTrue(over is ImagePlan.Reject && over.reason.contains("GIF"))
    }

    @Test fun theMessageLimitsNameTheCountAndTheTotal() {
        assertNull(messageLimitError(0,0,INPUT_IMAGE_MAX_BYTES))
        assertNull(messageLimitError(INPUT_MAX_IMAGES - 1,0,1))
        assertTrue(messageLimitError(INPUT_MAX_IMAGES,0,1)!!.contains("$INPUT_MAX_IMAGES images"))
        assertTrue(messageLimitError(4,INPUT_IMAGES_MAX_BYTES - 10,11,"big.png")!!.contains("big.png"))
    }

    @Test fun theBytesSaySoWhatTheyAreWhateverTheFileWasCalled() {
        fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }
        assertEquals("image/png",sniffImageType(bytes(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0)))
        assertEquals("image/jpeg",sniffImageType(bytes(0xff,0xd8,0xff,0xe0)))
        assertEquals("image/gif",sniffImageType("GIF89a".toByteArray()))
        assertEquals("image/webp",sniffImageType("RIFF....WEBPVP8 ".toByteArray()))
        assertNull(sniffImageType("not an image".toByteArray()))
        assertNull(sniffImageType(ByteArray(0)))
    }

    @Test fun theDraftCapIsTheMessageCap() {
        assertEquals(INPUT_MAX_IMAGES,DRAFT_MAX_ATTACHMENTS)
    }
}
