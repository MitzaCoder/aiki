package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.features.settings.*
import org.junit.Assert.*
import org.junit.Test

class DeliverySettingsTest {
    @Test fun branchModes() {
        assertEquals("off", integrationBranchMode(null))
        assertEquals("auto", integrationBranchMode("auto"))
        assertEquals("custom", integrationBranchMode("refs/heads/trunk"))
    }
    @Test fun branchNamesBecomeFullRefs() {
        assertEquals("refs/heads/trunk", integrationBranchRef(" trunk "))
        assertEquals("refs/remotes/origin/trunk", integrationBranchRef("refs/remotes/origin/trunk"))
    }
    @Test(expected = IllegalArgumentException::class) fun emptyBranchIsNotOff() { integrationBranchRef(" ") }
    @Test fun offUsesExplicitNullWithoutClearingOtherSettings() {
        for (field in listOf("integrationRef", "deployFeed")) {
            val patch = deliverySettingPatch("demo", field, null)
            assertEquals(setOf(field), patch.explicitNulls)
            assertNull(patch.request.coordinatorModel)
            assertNull(patch.request.reportAudit)
        }
    }
    @Test fun configuredValuesArePreserved() {
        val branch = deliverySettingPatch("demo", "integrationRef", "auto")
        assertEquals("auto", branch.request.integrationRef)
        assertTrue(branch.explicitNulls.isEmpty())
        val feed = deliverySettingPatch("demo", "deployFeed", "/tmp/demo/journal.json")
        assertEquals("/tmp/demo/journal.json", feed.request.deployFeed)
        assertNull(feed.request.integrationRef)
        assertTrue(feed.explicitNulls.isEmpty())
    }
    @Test fun eachFeatureOffersDeliveryIndependently() {
        for (features in listOf(emptySet(), setOf("task-changes"), setOf("task-deploys"), setOf("task-changes", "task-deploys"))) {
            assertEquals(features.isNotEmpty(), projectSectionAvailable(ProjectSection.Delivery, ProjectSectionSupport(features::contains, false, false)))
        }
    }
}
