package io.github.mitzacoder.kemiri.data

/** T1 is only unique within its backend and project. Missing choices mean folded, not expanded. */
fun DeviceSettings.familyExpansion(backendKey: String, projectId: String): Map<String, Boolean> =
    taskFamilyExpansion[backendKey]?.get(projectId).orEmpty()

fun DeviceSettings.withFamilyExpansion(backendKey: String, projectId: String, parentId: String, expanded: Boolean): DeviceSettings {
    val projects = taskFamilyExpansion[backendKey].orEmpty()
    val choices = projects[projectId].orEmpty() + (parentId to expanded)
    return copy(taskFamilyExpansion = taskFamilyExpansion + (backendKey to (projects + (projectId to choices))))
}
