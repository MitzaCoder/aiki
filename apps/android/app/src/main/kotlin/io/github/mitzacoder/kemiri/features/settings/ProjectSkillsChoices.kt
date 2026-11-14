package io.github.mitzacoder.kemiri.features.settings

import io.github.mitzacoder.kemiri.protocol.ProjectSkill
import io.github.mitzacoder.kemiri.protocol.SkillsProjectSetRequestChangesItem
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class ProjectSkillsState(
    val skills: List<ProjectSkill> = emptyList(),
    val loaded: Boolean = false,
    val saving: Boolean = false,
    val error: String? = null,
)

/** Session-owned: leaving settings does not discard a pending save. Reads and writes are serialized. */
class ProjectSkillsChoices(
    private val scope: CoroutineScope,
    private val read: suspend () -> List<ProjectSkill>,
    private val save: suspend (List<SkillsProjectSetRequestChangesItem>) -> List<ProjectSkill>,
    private val debounceMs: Long = 1_000,
) {
    private val lock = Mutex()
    private val requests = Mutex()
    private val mutableState = MutableStateFlow(ProjectSkillsState())
    val state = mutableState.asStateFlow()
    private var confirmed = emptyList<ProjectSkill>()
    private data class Choice(val roles: List<String>, val revision: Long)
    private var revision = 0L
    private val pending = linkedMapOf<String, Choice>()
    private var debounce: Job? = null

    private fun publish() {
        mutableState.value = state.value.copy(skills = confirmed.map { skill ->
            pending[skill.name]?.let { skill.copy(roles = it.roles, decided = true) } ?: skill
        })
    }
    fun refresh() { scope.launch {
        requests.withLock {
            try {
                val skills = read()
                lock.withLock {
                    confirmed = skills
                    mutableState.value = state.value.copy(loaded = true, error = null)
                    publish()
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { lock.withLock { mutableState.value = state.value.copy(error = e.message ?: "Could not load skills.") } }
        }
    } }
    fun setOffered(name: String, offered: Boolean) { scope.launch {
        lock.withLock {
            if (!state.value.loaded) return@withLock
            pending[name] = Choice(projectSkillRoles(offered), ++revision)
            mutableState.value = state.value.copy(error = null)
            publish()
            debounce?.cancel()
            // Only cancel the delay, never a request which may already have reached the backend.
            debounce = scope.launch {
                delay(debounceMs)
                scope.launch { flush() }
            }
        }
    } }
    private suspend fun flush() = requests.withLock {
        val batch = lock.withLock {
            if (pending.isEmpty()) return@withLock emptyMap<String, Choice>()
            mutableState.value = state.value.copy(saving = true)
            pending.toMap()
        }
        if (batch.isEmpty()) return@withLock
        try {
            val skills = save(batch.map { (name, choice) -> SkillsProjectSetRequestChangesItem(name = name, roles = choice.roles) })
            lock.withLock {
                confirmed = skills
                finish(batch)
                mutableState.value = state.value.copy(loaded = true, error = null)
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { lock.withLock {
            finish(batch)
            mutableState.value = state.value.copy(error = e.message ?: "Could not save skills. Changes reverted.")
        } }
        finally { lock.withLock { mutableState.value = state.value.copy(saving = false) } }
    }
    private fun finish(batch: Map<String, Choice>) {
        batch.forEach { (name, choice) -> if (pending[name]?.revision == choice.revision) pending.remove(name) }
        publish()
    }
}
