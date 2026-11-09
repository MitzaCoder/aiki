package com.mihaisaru.harness.settings

import com.mihaisaru.harness.features.settings.*
import com.mihaisaru.harness.protocol.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** The settings split and redesign's pure logic: the section lists, combobox filtering, thinking options, save states, worker model edits. */
class SettingsSplitTest {
    @Test fun sectionListsMatchTheWebUrlSegments() {
        assertEquals(listOf("appearance", "backends", "notifications", "archived"), GeneralSection.entries.map { it.id })
        assertEquals(listOf("general", "coordinator", "workers", "schedules", "tickets", "cache", "storage"), ProjectSection.entries.map { it.id })
        assertEquals(GeneralSection.Notifications, generalSectionFor("notifications"))
        assertNull(generalSectionFor("nope"))
        assertEquals(ProjectSection.Cache, projectSectionFor("cache"))
        assertNull(projectSectionFor(null))
    }

    @Test fun aSectionTheBackendDoesNotOfferIsLeftOut() {
        fun offered(features: Set<String>, links: Boolean = false, cache: Boolean = false) =
            ProjectSection.entries.filter { projectSectionAvailable(it, ProjectSectionSupport({ f -> f in features }, links, cache)) }
        assertEquals(listOf(ProjectSection.General), offered(emptySet()))
        assertEquals(listOf(ProjectSection.General, ProjectSection.Coordinator), offered(setOf("projects", "models")))
        assertEquals(
            listOf(ProjectSection.General, ProjectSection.Coordinator, ProjectSection.Workers, ProjectSection.Schedules, ProjectSection.Tickets, ProjectSection.Cache, ProjectSection.Storage),
            offered(setOf("projects", "models", "workers", "schedules", "storage"), links = true, cache = true),
        )
    }

    @Test fun backGoesOneScreenUp() {
        assertNull(generalParent(GeneralPage()))
        assertEquals(GeneralPage(), generalParent(GeneralPage(GeneralSection.Appearance)))
        assertEquals(GeneralPage(GeneralSection.Backends), generalParent(GeneralPage(GeneralSection.Backends, "b")))
        assertEquals(GeneralPage(GeneralSection.Backends, "b"), generalParent(GeneralPage(GeneralSection.Backends, "b", accounts = true)))
    }

    @Test fun aWideScreenShowsTheFirstSectionOfferedWhenNoneIsChosen() {
        val offered = listOf(ProjectSection.General, ProjectSection.Workers)
        assertEquals(ProjectSection.General, wideSection(null, offered))
        assertEquals(ProjectSection.Workers, wideSection(ProjectSection.Workers, offered))
        assertEquals(ProjectSection.General, wideSection(ProjectSection.Storage, offered))
    }

    @Test fun listChipsFlagTheStatesWorthSeeing() {
        assertEquals(SectionChip("2 offline", ChipTone.Warn), generalChips(2, true, 0)[GeneralSection.Backends])
        assertNull(generalChips(0, true, 0)[GeneralSection.Backends])
        assertEquals(SectionChip("On", ChipTone.Ok), generalChips(0, true, 0)[GeneralSection.Notifications])
        assertEquals(SectionChip("Off", ChipTone.Muted), generalChips(0, false, 0)[GeneralSection.Notifications])
        assertEquals(SectionChip("3", ChipTone.Muted), generalChips(0, false, 3)[GeneralSection.Archived])
        assertEquals(SectionChip("No model", ChipTone.Warn), projectChips(false)[ProjectSection.Coordinator])
        assertTrue(projectChips(true).isEmpty())
    }

    private fun model(provider: String, id: String, name: String, levels: List<String> = emptyList(), configured: Boolean = true, context: Long = 200_000) =
        ModelInfo(provider = provider, modelId = id, name = name, contextWindow = context, maxTokens = 8192, input = listOf("text"), reasoning = levels.isNotEmpty(), thinkingLevels = levels, configured = configured)

    private val providers = listOf(
        ProviderInfo(id = "openai", name = "OpenAI", configured = true),
        ProviderInfo(id = "anthropic", name = "Anthropic", configured = false),
    )

    @Test fun everyWordTypedMustMatchSomewhere() {
        val option = ComboOption("anthropic/claude", "Claude Opus", "claude-opus-4 · 200k context", group = "anthropic", groupLabel = "Anthropic", keywords = "anthropic")
        assertTrue(matchesQuery(option, ""))
        assertTrue(matchesQuery(option, "opus"))
        assertTrue(matchesQuery(option, "OPUS 200k"))
        assertTrue(matchesQuery(option, "anthropic claude"))
        assertFalse(matchesQuery(option, "opus gpt"))
    }

    @Test fun filteringKeepsGroupsInOrderOfFirstAppearance() {
        val options = modelOptions(
            listOf(model("openai", "gpt-5", "GPT 5"), model("anthropic", "opus", "Opus", configured = false), model("openai", "gpt-4", "GPT 4")),
            providers,
        )
        // Providers are ordered by name, models by name.
        assertEquals(listOf("Anthropic", "OpenAI"), filterOptions(options).map { it.label })
        assertEquals(listOf("GPT 4", "GPT 5"), filterOptions(options)[1].options.map { it.label })
        assertEquals(listOf("openai/gpt-5"), filterOptions(options, "gpt 5").flatMap { it.options }.map { it.value })
        assertTrue(filterOptions(options, "nothing like this").isEmpty())
        val ungrouped = filterOptions(listOf(ComboOption("", "None"), ComboOption("a", "A", group = "g")))
        assertNull(ungrouped[0].label)
        assertEquals("g", ungrouped[1].label)
    }

    @Test fun modelOptionsNameTheContextAndFlagAMissingCredential() {
        val option = modelOptions(listOf(model("anthropic", "opus", "Opus", configured = false, context = 1_000_000)), providers).single()
        assertEquals("anthropic/opus", option.value)
        assertEquals("opus · 1M context", option.description)
        assertEquals("Anthropic", option.groupLabel)
        assertEquals("no credential", option.badge)
        assertTrue(option.badgeWarn)
        assertNull(modelOptions(listOf(model("openai", "x", "X")), providers).single().badge)
        assertEquals(listOf("200k", "1M", "1.5M", "512"), listOf(200_000L, 1_000_000L, 1_500_000L, 512L).map(::contextSize))
    }

    @Test fun theSearchBoxShowsOnlyForALongList() {
        fun options(count: Int) = (1..count).map { ComboOption("$it", "Option $it") }
        assertFalse(showsSearch(options(8)))
        assertTrue(showsSearch(options(9)))
    }

    @Test fun thinkingOptionsStartWithTheModelDefaultAndGoUpInEffort() {
        val options = thinkingOptions(listOf("high", "low", "medium"), null)
        assertEquals(listOf("", "low", "medium", "high"), options.map { it.value })
        assertEquals("Model default", options[0].label)
        assertEquals("Medium", options[2].label)
        assertEquals(listOf(0, 1, 2, 3, 4), listOf("off", "low", "medium", "high", "max").map(::thinkingBars))
        assertEquals(0, thinkingBars(null))
    }

    @Test fun aStoredLevelTheModelDoesNotListStaysInTheList() {
        val options = thinkingOptions(listOf("low"), "xhigh")
        assertEquals(listOf("", "low", "xhigh"), options.map { it.value })
        assertTrue(options.last().description!!.contains("does not list it"))
        assertEquals("low", validThinking("low", model("p", "m", "M", levels = listOf("low"))))
        assertNull(validThinking("high", model("p", "m", "M", levels = listOf("low"))))
    }

    @Test fun workerModelEditsKeepTheListWhenNothingChanges() {
        val a = WorkerModel("p", "a", null)
        val b = WorkerModel("p", "b", "high")
        val list = listOf(a, b)
        assertEquals(listOf(b, a), moveWorkerModel(list, 1, -1))
        assertSame(list, moveWorkerModel(list, 0, -1))
        assertSame(list, moveWorkerModel(list, 1, 1))
        assertEquals(listOf(b), removeWorkerModel(list, ModelRef("p", "a")))
        assertSame(list, removeWorkerModel(list, ModelRef("p", "zzz")))
        assertEquals(listOf(a.copy(thinkingLevel = "low"), b), setWorkerModelThinkingLevel(list, ModelRef("p", "a"), "low"))
        assertSame(list, setWorkerModelThinkingLevel(list, ModelRef("p", "b"), "high"))
        assertNotEquals(workerModelsSignature(list), workerModelsSignature(listOf(a, b.copy(thinkingLevel = null))))
    }

    @Test fun checkInMinutesAreWholeNumbersFromOneToADay() {
        assertEquals(10L, parseCheckInMinutes(" 10 "))
        assertEquals(1440L, parseCheckInMinutes("1440"))
        assertNull(parseCheckInMinutes("0"))
        assertNull(parseCheckInMinutes("1441"))
        assertNull(parseCheckInMinutes("2.5"))
        assertNull(parseCheckInMinutes(""))
    }

    @Test fun aSaveGoesSavingThenSavedThenQuiet() = runBlocking {
        val state = SaveState(this, savedVisibleMs = 40)
        assertEquals(SaveStatus.Idle, state.status)
        assertTrue(state.run { })
        assertEquals(SaveStatus.Saved, state.status)
        kotlinx.coroutines.delay(150)
        assertEquals(SaveStatus.Idle, state.status)
    }

    @Test fun aFailureKeepsItsReasonUntilTheNextTry() = runBlocking {
        val state = SaveState(this, savedVisibleMs = 40)
        assertFalse(state.run { throw IllegalStateException("Nope") })
        assertEquals(SaveStatus.Failed, state.status)
        assertEquals("Nope", state.error)
        assertTrue(state.run { })
        assertNull(state.error)
        assertEquals(SaveStatus.Saved, state.status)
        state.fail("Out of range")
        assertEquals("Out of range", state.error)
        state.reset()
        assertEquals(SaveStatus.Idle, state.status)
    }

    @Test fun anAccountReadsHowItGotItsCredential() {
        val openai = providers[0]
        assertEquals("Signed in" to ChipTone.Ok, providerHow(openai, listOf(CredentialInfo("openai", "oauth"))))
        assertEquals("API key" to ChipTone.Ok, providerHow(openai, listOf(CredentialInfo("openai", "api_key"))))
        assertEquals("From environment" to ChipTone.Info, providerHow(openai, emptyList()))
        val options = providerOptions(listOf(ProviderInfo("claude", "Claude", false, null, ProviderOAuthInfo("Claude Pro", "Sign in", true))))
        assertEquals("subscription", options.single().badge)
        assertTrue(matchesQuery(options.single(), "claude pro"))
    }

    @Test fun schedulesReadInPlainWords() {
        assertEquals("Every 30 minutes", describeSchedule(ScheduleSpecInterval(everyMinutes = 30)))
        assertEquals("Every hour", describeSchedule(ScheduleSpecInterval(everyMinutes = 60)))
        assertEquals("Every 2 hours", describeSchedule(ScheduleSpecInterval(everyMinutes = 120)))
        assertEquals("Every day", describeSchedule(ScheduleSpecInterval(everyMinutes = 1440)))
        assertEquals("Every day at 09:00", describeSchedule(ScheduleSpecDaily(time = "09:00")))
        assertEquals("Weekdays at 09:00", describeSchedule(ScheduleSpecWeekly(days = listOf(5, 4, 3, 2, 1), time = "09:00")))
        assertEquals("Weekends at 10:00", describeSchedule(ScheduleSpecWeekly(days = listOf(0, 6), time = "10:00")))
        assertEquals("Every Monday at 08:00", describeSchedule(ScheduleSpecWeekly(days = listOf(1), time = "08:00")))
        assertEquals("Mon, Wed and Fri at 18:30", describeSchedule(ScheduleSpecWeekly(days = listOf(1, 3, 5), time = "18:30")))
        assertEquals("Cron: 0 9 * * 1", describeSchedule(ScheduleSpecCron(expression = "0 9 * * 1")))
        assertEquals("When a review is requested from you on GitHub", describeSchedule(ScheduleSpecGithubReviewRequested()))
        assertEquals("When a review is requested from you on GitHub in a/b, c/d", describeSchedule(ScheduleSpecGithubReviewRequested(repos = listOf("a/b", "c/d"))))
    }

    private fun schedule(spec: ScheduleSpec, enabled: Boolean = true, next: String? = null, state: ScheduleEventState? = null, runs: List<ScheduleRun> = emptyList()) = Schedule(
        title = "T", brief = "B", spec = spec, model = null, thinkingLevel = null, isolation = "shared", onReport = "review", enabled = enabled, kind = null,
        id = "s", createdBy = "user", createdAt = "2026-11-01T00:00:00Z", updatedAt = "2026-11-01T00:00:00Z", nextRunAt = next, eventState = state, runs = runs,
    )

    @Test fun anEventRuleSaysHowGitHubIsChecked() {
        val now = java.time.Instant.parse("2026-11-08T10:00:00Z").toEpochMilli()
        val rule = ScheduleSpecGithubReviewRequested()
        assertEquals("Paused", scheduleWhenText(schedule(rule, enabled = false), "UTC", now))
        assertEquals("Checks GitHub every 2 min · not checked yet", scheduleWhenText(schedule(rule), "UTC", now))
        assertEquals("Checks GitHub every 2 min · last checked 1 min ago", scheduleWhenText(schedule(rule, state = ScheduleEventState("2026-11-08T09:59:00Z", null)), "UTC", now))
        assertTrue(scheduleWhenText(schedule(rule, state = ScheduleEventState("2026-11-08T09:59:00Z", "gh failed")), "UTC", now).endsWith("last check failed 1 min ago: gh failed"))
        assertEquals("Paused", scheduleWhenText(schedule(ScheduleSpecDaily(time = "09:00")), "UTC", now))
        assertTrue(scheduleWhenText(schedule(ScheduleSpecDaily(time = "09:00"), next = "2026-11-08T10:25:00Z"), "UTC", now).startsWith("Next in 25 min · "))
    }

    @Test fun theLastRunIsOneLineAndASkipCarriesItsReason() {
        val now = java.time.Instant.parse("2026-11-08T10:00:00Z").toEpochMilli()
        assertEquals("Never ran", scheduleLastRunText(schedule(ScheduleSpecDaily(time = "09:00")), now))
        fun run(at: String, outcome: String, message: String? = null) = ScheduleRun(at = at, trigger = "schedule", outcome = outcome, workerId = null, message = message)
        val runs = listOf(run("2026-11-08T08:00:00Z", "started"), run("2026-11-08T09:00:00Z", "skipped", "previous run still running"))
        assertEquals("Skipped 1 h ago — previous run still running", scheduleLastRunText(schedule(ScheduleSpecDaily(time = "09:00"), runs = runs), now))
        assertEquals("Last run started 2 h ago", scheduleLastRunText(schedule(ScheduleSpecDaily(time = "09:00"), runs = runs.take(1)), now))
        assertEquals("Review requested", scheduleTriggerLabel("event"))
        assertEquals("acme/platform#1205", runRefLabel(run("x", "started").copy(ref = "https://github.com/acme/platform/pull/1205")))
        assertNull(runRefLabel(run("x", "started")))
    }

    @Test fun anEventRuleIsBuiltFromRepositoriesAsTyped() {
        assertEquals(ScheduleSpecGithubReviewRequested(repos = listOf("a/b", "c/d")), scheduleSpec("github-review-requested", "", "", emptySet(), "", "a/b, c/d"))
        assertEquals(ScheduleSpecGithubReviewRequested(repos = null), scheduleSpec("github-review-requested", "", "", emptySet(), "", ""))
        assertTrue(runCatching { scheduleSpec("github-review-requested", "", "", emptySet(), "", "not a repo") }.isFailure)
    }

    @Test fun backendsConnectionChipFollowsTheStatus() {
        assertEquals(ChipTone.Ok, connectionChipTone(com.mihaisaru.harness.data.ConnectionStatus.Ready))
        assertEquals(ChipTone.Warn, connectionChipTone(com.mihaisaru.harness.data.ConnectionStatus.Reconnecting))
        assertEquals(ChipTone.Muted, connectionChipTone(com.mihaisaru.harness.data.ConnectionStatus.Idle))
    }

    @Test fun maintenanceSummarySaysOffUntilAModelIsChosen() {
        val off = MemoryMaintenanceSettings(null, null, "03:00", 20)
        assertTrue(maintenanceSummary(off, "UTC").startsWith("Off"))
        val on = off.copy(model = ModelRef("p", "m"))
        assertEquals("Runs nightly at 03:00 (UTC) and after 20 new writes to a scope.", maintenanceSummary(on, "UTC"))
    }
}
