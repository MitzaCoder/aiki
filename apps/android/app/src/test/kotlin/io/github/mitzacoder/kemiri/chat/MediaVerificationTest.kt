package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.preferSoftwareVideoDecoder
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
