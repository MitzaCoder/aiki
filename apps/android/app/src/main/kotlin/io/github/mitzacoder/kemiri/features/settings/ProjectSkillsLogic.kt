package io.github.mitzacoder.kemiri.features.settings

import io.github.mitzacoder.kemiri.protocol.ProjectSkill

const val PROJECT_SKILLS_FEATURE = "project-skills"
val PROJECT_SKILL_ROLES = listOf("coordinator", "workers", "background")
enum class ProjectSkillFilter(val label: String) { All("All"), Offered("Offered"), Off("Off"), New("New") }

fun projectSkillRoles(offered: Boolean): List<String> = if (offered) PROJECT_SKILL_ROLES else emptyList()
fun projectSkillOffered(skill: ProjectSkill): Boolean = skill.roles.isNotEmpty()
fun projectSkillSomeRoles(skill: ProjectSkill): Boolean = projectSkillOffered(skill) && !skill.roles.containsAll(PROJECT_SKILL_ROLES)
fun projectSkillMatches(skill: ProjectSkill, filter: ProjectSkillFilter): Boolean = when (filter) {
    ProjectSkillFilter.All -> true
    ProjectSkillFilter.Offered -> projectSkillOffered(skill)
    ProjectSkillFilter.Off -> !projectSkillOffered(skill)
    ProjectSkillFilter.New -> !skill.decided
}
fun projectSkillSourceLabel(skill: ProjectSkill): String = when (skill.origin) {
    "builtin" -> "Kemiri"
    "project" -> "Project · " + when (skill.source) {
        "pi" -> ".pi/skills"
        "claude" -> ".claude/skills"
        "agents" -> ".agents/skills"
        else -> "Kemiri"
    }
    else -> "Global · " + when (skill.source) {
        "pi" -> "pi"
        "claude" -> "Claude Code"
        "agents" -> ".agents"
        else -> "Kemiri"
    }
}
data class ProjectSkillGroup(val label: String, val skills: List<ProjectSkill>)
fun projectSkillGroups(skills: List<ProjectSkill>, filter: ProjectSkillFilter): List<ProjectSkillGroup> =
    listOf("project" to "This project", "builtin" to "Built in", "global" to "On this backend, for every project").mapNotNull { (origin, label) ->
        skills.filter { it.origin == origin && projectSkillMatches(it, filter) }.sortedBy { it.name.lowercase() }
            .takeIf { it.isNotEmpty() }?.let { ProjectSkillGroup(label, it) }
    }
fun projectSkillHiddenNote(skill: ProjectSkill): String? = skill.hides.size.takeIf { it > 0 }?.let {
    "Also in $it other ${if (it == 1) "folder" else "folders"}, hidden by this one"
}
fun skillsHeldBackLabel(count: Long?): String? = count?.takeIf { it > 0 }?.let { "$it ${if (it == 1L) "skill" else "skills"} held back by this project's settings" }
