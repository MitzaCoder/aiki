package com.mihaisaru.harness.chat

import com.mihaisaru.harness.features.chat.preferSoftwareVideoDecoder
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
