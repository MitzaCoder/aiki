package io.github.mitzacoder.kemiri.settings

import io.github.mitzacoder.kemiri.features.settings.*
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProjectSkillsTest {
    private fun skill(name: String = "demo", origin: String = "project", source: String = "pi", roles: List<String> = PROJECT_SKILL_ROLES, decided: Boolean = false) =
        ProjectSkill(name = name, description = "Synthetic skill", path = "/example/$name/SKILL.md", origin = origin, source = source, hides = emptyList(), roles = roles, decided = decided)

    @Test fun sectionRequiresItsOwnCapability() {
        assertFalse(projectSectionAvailable(ProjectSection.Skills, ProjectSectionSupport({ it == "mcp-servers" }, true, true)))
        assertTrue(projectSectionAvailable(ProjectSection.Skills, ProjectSectionSupport({ it == "project-skills" }, false, false)))
        assertEquals(ProjectSection.Skills, projectSectionFor("skills"))
    }
    @Test fun originAndSourceLabelsAreExplicit() {
        assertEquals("Project · .pi/skills", projectSkillSourceLabel(skill()))
        assertEquals("Project · .claude/skills", projectSkillSourceLabel(skill(source = "claude")))
        assertEquals("Project · .agents/skills", projectSkillSourceLabel(skill(source = "agents")))
        assertEquals("Project · Kemiri", projectSkillSourceLabel(skill(source = "harness")))
        assertEquals("Global · pi", projectSkillSourceLabel(skill(origin = "global")))
        assertEquals("Global · Claude Code", projectSkillSourceLabel(skill(origin = "global", source = "claude")))
        assertEquals("Global · .agents", projectSkillSourceLabel(skill(origin = "global", source = "agents")))
        assertEquals("Global · Kemiri", projectSkillSourceLabel(skill(origin = "global", source = "harness")))
        assertEquals("Kemiri", projectSkillSourceLabel(skill(origin = "builtin", source = "harness")))
    }
    @Test fun switchesKeepSubsetsOnButAlwaysWriteAllOrNone() {
        val subset = skill(roles = listOf("workers"))
        assertTrue(projectSkillOffered(subset))
        assertTrue(projectSkillSomeRoles(subset))
        assertFalse(projectSkillSomeRoles(skill()))
        assertFalse(projectSkillSomeRoles(skill(roles = emptyList())))
        assertFalse(projectSkillOffered(skill(roles = emptyList())))
        assertEquals(PROJECT_SKILL_ROLES, projectSkillRoles(true))
        assertEquals(emptyList<String>(), projectSkillRoles(false))
    }
    @Test fun filtersUseEffectiveRolesAndDecision() {
        val new = skill()
        val off = skill(roles = emptyList(), decided = true)
        val subset = skill(roles = listOf("background"), decided = true)
        val skills = listOf(new, off, subset)
        assertEquals(skills, skills.filter { projectSkillMatches(it, ProjectSkillFilter.All) })
        assertEquals(listOf(new, subset), skills.filter { projectSkillMatches(it, ProjectSkillFilter.Offered) })
        assertEquals(listOf(off), skills.filter { projectSkillMatches(it, ProjectSkillFilter.Off) })
        assertEquals(listOf(new), skills.filter { projectSkillMatches(it, ProjectSkillFilter.New) })
    }
    @Test fun groupsAreOrderedAndEmptyGroupsDisappear() {
        val skills = listOf(skill("Z", "global"), skill("z"), skill("built", "builtin"), skill("alpha"))
        val groups = projectSkillGroups(skills, ProjectSkillFilter.All)
        assertEquals(listOf("This project", "Built in", "On this backend, for every project"), groups.map { it.label })
        assertEquals(listOf("alpha", "z"), groups.first().skills.map { it.name })
        assertTrue(projectSkillGroups(skills, ProjectSkillFilter.Off).isEmpty())
    }
    @Test fun hiddenPathsAndHeldBackHintsHaveNoZeroNoise() {
        assertNull(projectSkillHiddenNote(skill()))
        assertEquals("Also in 1 other folder, hidden by this one", projectSkillHiddenNote(skill().copy(hides = listOf("/example/other/SKILL.md"))))
        assertEquals("Also in 2 other folders, hidden by this one", projectSkillHiddenNote(skill().copy(hides = listOf("a", "b"))))
        assertNull(skillsHeldBackLabel(null))
        assertNull(skillsHeldBackLabel(0))
        assertEquals("1 skill held back by this project's settings", skillsHeldBackLabel(1))
        assertEquals("2 skills held back by this project's settings", skillsHeldBackLabel(2))
    }
    @Test fun rapidEditsBatchByNameAfterOneSecondOfQuiet() = runTest {
        var catalogue = listOf(skill("a"), skill("b"))
        val writes = mutableListOf<List<SkillsProjectSetRequestChangesItem>>()
        val choices = ProjectSkillsChoices(backgroundScope, { catalogue }, { changes ->
            writes.add(changes)
            catalogue = catalogue.map { row -> changes.firstOrNull { it.name == row.name }?.let { row.copy(roles = it.roles!!, decided = true) } ?: row }
            catalogue
        })
        choices.refresh(); runCurrent()
        choices.setOffered("a", false); runCurrent()
        assertFalse(projectSkillOffered(choices.state.value.skills[0]))
        assertTrue(choices.state.value.skills[0].decided)
        advanceTimeBy(700)
        choices.setOffered("b", false); choices.setOffered("a", true); runCurrent()
        advanceTimeBy(999); runCurrent(); assertTrue(writes.isEmpty())
        advanceTimeBy(1); runCurrent()
        assertEquals(1, writes.size)
        assertEquals(mapOf("a" to PROJECT_SKILL_ROLES, "b" to emptyList<String>()), writes.single().associate { it.name to it.roles })
        assertFalse(choices.state.value.saving)
    }
    @Test fun failedSaveRevertsAndExplainsWithoutRetrying() = runTest {
        val choices = ProjectSkillsChoices(backgroundScope, { listOf(skill()) }, { error("Offline") })
        choices.refresh(); runCurrent()
        choices.setOffered("demo", false); runCurrent()
        advanceTimeBy(1_000); runCurrent()
        assertTrue(projectSkillOffered(choices.state.value.skills.single()))
        assertFalse(choices.state.value.skills.single().decided)
        assertEquals("Offline", choices.state.value.error)
        advanceTimeBy(10_000); runCurrent()
        assertEquals("Offline", choices.state.value.error)
    }
    @Test fun newerEditsSurviveAnInflightFailure() = runTest {
        val reply = CompletableDeferred<List<ProjectSkill>>()
        var attempts = 0
        val choices = ProjectSkillsChoices(backgroundScope, { listOf(skill()) }, {
            attempts++
            if (attempts == 1) reply.await() else listOf(skill(decided = true))
        })
        choices.refresh(); runCurrent()
        choices.setOffered("demo", false); runCurrent(); advanceTimeBy(1_000); runCurrent()
        choices.setOffered("demo", true); runCurrent()
        reply.completeExceptionally(IllegalStateException("First write failed")); runCurrent()
        assertTrue(projectSkillOffered(choices.state.value.skills.single()))
        assertTrue(choices.state.value.skills.single().decided)
        advanceTimeBy(1_000); runCurrent()
        assertEquals(2, attempts)
        assertNull(choices.state.value.error)
    }
    @Test fun refreshCannotOverwriteOptimisticChoices() = runTest {
        var catalogue = listOf(skill())
        val choices = ProjectSkillsChoices(backgroundScope, { catalogue }, { catalogue })
        choices.refresh(); runCurrent()
        choices.setOffered("demo", false); runCurrent()
        catalogue = listOf(skill().copy(description = "Changed remotely"))
        choices.refresh(); runCurrent()
        assertEquals("Changed remotely", choices.state.value.skills.single().description)
        assertFalse(projectSkillOffered(choices.state.value.skills.single()))
    }
    @Test fun aLoadErrorCanBeRetried() = runTest {
        var fail = true
        val choices = ProjectSkillsChoices(backgroundScope, { if (fail) error("No connection") else listOf(skill()) }, { emptyList() })
        choices.refresh(); runCurrent()
        assertFalse(choices.state.value.loaded)
        assertEquals("No connection", choices.state.value.error)
        fail = false; choices.refresh(); runCurrent()
        assertTrue(choices.state.value.loaded)
        assertNull(choices.state.value.error)
    }
}
