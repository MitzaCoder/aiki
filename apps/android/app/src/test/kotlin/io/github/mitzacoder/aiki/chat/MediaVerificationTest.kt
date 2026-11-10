package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.preferSoftwareVideoDecoder
import org.junit.Assert.*
import org.junit.Test

class MediaVerificationTest {
    @Test fun emulatorCodecWorkaroundNeverChangesPhysicalDeviceOrdering() {
        assertTrue(preferSoftwareVideoDecoder("ranchu"))
        assertTrue(preferSoftwareVideoDecoder("goldfish"))
        assertFalse(preferSoftwareVideoDecoder("qcom"))
        assertFalse(preferSoftwareVideoDecoder("tensor"))
    }
}
