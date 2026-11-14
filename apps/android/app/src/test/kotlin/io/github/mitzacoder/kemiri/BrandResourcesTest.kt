package io.github.mitzacoder.kemiri

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.*
import org.junit.Test

class BrandResourcesTest {
    private val root = generateSequence(File(System.getProperty("user.dir")!!)) { it.parentFile }
        .first { File(it, "assets/brand/logo.svg").isFile }
    private fun resource(name: String) = File(root, "apps/android/app/src/main/res/$name")

    @Test fun adaptiveLauncherHasColourAndThemedLayers() {
        val xml = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(resource("mipmap-anydpi-v26/ic_launcher.xml"))
        for (layer in listOf("background", "foreground", "monochrome")) {
            assertEquals(1, xml.getElementsByTagName(layer).length)
        }
        val foreground = resource("drawable/ic_launcher_foreground.xml").readText()
        assertTrue(foreground.contains("<gradient"))
        // 695 source units * .088 = 61.16 dp, less than the 66 dp safe zone.
        assertTrue(foreground.contains("android:scaleX=\".088\""))
        assertTrue(695 * .088 < 66)
    }

    @Test fun notificationAndThemedMarksHaveTransparentFaceCutouts() {
        for (name in listOf("ic_notification", "ic_launcher_monochrome")) {
            val xml = resource("drawable/$name.xml").readText()
            assertTrue(xml.contains("android:fillType=\"evenOdd\""))
            assertTrue(xml.contains("android:fillColor=\"#FFFFFFFF\""))
            assertFalse(xml.contains("<gradient"))
            for (contour in listOf("M453 592", "ZM633 592", "ZM485 626")) assertTrue(xml.contains(contour))
        }
    }
}
