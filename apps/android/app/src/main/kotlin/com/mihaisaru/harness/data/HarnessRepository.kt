package com.mihaisaru.harness.data

import com.mihaisaru.harness.features.status.ServerStatusStore
import com.mihaisaru.harness.features.status.addDismissedDeploy
import com.mihaisaru.harness.features.notifications.NotificationSettings
import com.mihaisaru.harness.protocol.*
import java.io.Closeable
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient

/** A backend owns the socket and catalog; screens must reuse it, never create another client. */
class BackendSession(val config: BackendConfig, val client: HarnessClient) : Closeable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val mutableProjects = MutableStateFlow<List<ProjectSummary>>(emptyList())
    val projects = mutableProjects.asStateFlow()
    private val mutableModels = MutableStateFlow<List<ModelInfo>>(emptyList())
    val models = mutableModels.asStateFlow()
    private val mutableModelCatalog = MutableStateFlow<ModelsListResponse?>(null)
    val modelCatalog = mutableModelCatalog.asStateFlow()
    private val modelsLock = Any()
    private var modelsRevision = 0L
    private val mutableError = MutableStateFlow<String?>(null)
    val error = mutableError.asStateFlow()
    private val boards = java.util.concurrent.ConcurrentHashMap<String, ProjectBoard>()
    /** One live board per project for the session's lifetime, shared by every screen that shows tasks or questions. */
    fun board(projectId: String): ProjectBoard = boards.computeIfAbsent(projectId) { ProjectBoard(client, it, scope) }
    private var terminalDeck: com.mihaisaru.harness.features.terminal.TerminalDeck? = null
    private var terminalScope: CoroutineScope? = null
    /** This backend's terminals: tabs and their live sessions, shared by every visit to the terminal screen. */
    @Synchronized fun terminals(context: android.content.Context): com.mihaisaru.harness.features.terminal.TerminalDeck =
        terminalDeck ?: CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).let { terminalScope = it
            com.mihaisaru.harness.features.terminal.TerminalDeck(context.applicationContext, config.key, client, it).also { deck -> terminalDeck = deck } }
    /** The release, last deploy and disks the backend reports (`server-status`), shared by the header, banners and Backends. */
    val serverStatus = ServerStatusStore(client, scope)
    init {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            client.events.collect { event ->
                if (event is ProjectStateEvent) {
                    mutableProjects.update { list -> (list.filterNot { it.id == event.project.id } + event.project).sortedBy { it.name } }
                }
                if (event is CredentialsLoginEvent && event.login.status == "succeeded") {
                    launch {
                        try { refreshModels() }
                        catch (e: CancellationException) { throw e }
                        catch (e: Exception) { mutableError.value = e.message }
                    }
                }
            }
        }
        scope.launch {
            client.state.collect { connection ->
                if (connection.status == ConnectionStatus.Ready) {
                    runCatching { refreshProjects() }.onFailure { mutableError.value = it.message }
                    if (connection.supports("models")) runCatching { refreshModels() }
                }
            }
        }
        client.connect()
    }
    /** Only the newest requested catalog may publish; an older in-flight read cannot undo credential changes. */
    suspend fun refreshModels() {
        val revision = synchronized(modelsLock) { ++modelsRevision }
        val catalog = client.request(ModelsListRequest())
        synchronized(modelsLock) {
            if (revision == modelsRevision) {
                mutableModels.value = catalog.models
                mutableModelCatalog.value = catalog
            }
        }
    }
    suspend fun refreshProjects() {
        mutableProjects.value = client.request(ProjectsListRequest()).projects
        mutableError.value = null
    }
    @Synchronized override fun close() { terminalDeck?.close(); terminalScope?.cancel(); scope.cancel(); client.close() }
}

/** Application-scoped. Settings mutations are durable before the UI/list of sockets changes. */
class HarnessRepository(private val store: DeviceStore) : Closeable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private val http = OkHttpClient.Builder().pingInterval(30, java.util.concurrent.TimeUnit.SECONDS).build()
    private val mutableSessions = MutableStateFlow<List<BackendSession>>(emptyList())
    val sessions = mutableSessions.asStateFlow()
    private val mutableSettings = MutableStateFlow(DeviceSettings())
    val settings = mutableSettings.asStateFlow()
    private val mutableLoaded = MutableStateFlow(false)
    val loaded = mutableLoaded.asStateFlow()

    init { scope.launch { lock.withLock {
        val saved = store.load()
        mutableSettings.value = saved
        reconcile(saved.backends)
        mutableLoaded.value = true
    } } }
    fun session(key: String) = sessions.value.firstOrNull { it.config.key == key }
    suspend fun addBackends(backends: List<BackendConfig>) = update { current ->
        val normalized = backends.map { BackendConfig(it.name.trim().also { n -> require(n.isNotEmpty() && n.length <= 48) }, normalizeBackendOrigin(it.url)) }
        current.copy(backends = (current.backends + normalized).distinctBy { it.key })
    }
    suspend fun removeBackend(key: String) = update { it.copy(backends = it.backends.filterNot { backend -> backend.key == key }) }
    suspend fun renameBackend(key: String, name: String) = update {
        require(name.trim().length in 1..48)
        it.copy(backends = it.backends.map { backend -> if (backend.key == key) backend.copy(name = name.trim()) else backend })
    }
    suspend fun setNotifications(transform: (NotificationSettings) -> NotificationSettings) = update { it.copy(notifications = transform(it.notifications)) }
    suspend fun setWorkDayStart(start: String) = update { it.copy(workDayStart = normalizeWorkDayStart(start)) }
    suspend fun setTheme(palette: ThemePalette, mode: ThemeMode) = update { it.copy(palette = palette, mode = mode) }
    suspend fun setCodeWrap(stored: String) = update { it.copy(codeWrap = stored) }
    suspend fun setTasksView(stored: String) = update { it.copy(tasksView = stored) }
    suspend fun setTopLevelTasksOnly(on: Boolean) = update { it.copy(topLevelTasksOnly = on) }
    suspend fun setMediaSeparate(on: Boolean) = update { it.copy(mediaSeparate = on) }
    /** Hides one deploy attempt's banner on this device until the next attempt. */
    suspend fun dismissDeploy(deploy: DeployStatus) = update { it.copy(dismissedDeploys = addDismissedDeploy(it.dismissedDeploys, deploy)) }
    suspend fun markSeen(key: String, projectId: String, entry: Long) = update {
        val seen = it.seenReplies[key].orEmpty()
        if (entry <= (seen[projectId] ?: 0)) it else it.copy(seenReplies = it.seenReplies + (key to (seen + (projectId to entry))))
    }
    private suspend fun update(transform: (DeviceSettings) -> DeviceSettings) = lock.withLock {
        val next = transform(settings.value)
        store.save(next)
        mutableSettings.value = next
        reconcile(next.backends)
    }
    private fun reconcile(configs: List<BackendConfig>) {
        val old = sessions.value.associateBy { it.config.key }.toMutableMap()
        mutableSessions.value = configs.map { config ->
            old.remove(config.key)?.let { previous ->
                if (previous.config == config) previous else { previous.close(); BackendSession(config, HarnessClient(config, http)) }
            } ?: BackendSession(config, HarnessClient(config, http))
        }
        old.values.forEach { it.close() }
    }
    override fun close() { scope.cancel(); sessions.value.forEach { it.close() }; http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll() }
}
