package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.features.notifications.relay.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class RelayAccountsTest {
    @Test fun pendingDeletionErasesKeysBeforeHttpAndReusesOperationAcrossRestart() = runTest {
        val time = RelayFakeTime()
        val store = sensitive()
        val operations = mutableListOf<String>()
        var complete = false
        val api = object : RelayFakeApi(time) {
            override suspend fun deleteAccount(operationId: String): RelayResult<RelayAccountDeletion> {
                assertTrue(store.state.routes.isEmpty())
                assertTrue(store.state.admissions.isEmpty())
                assertNull(store.state.enrollment)
                operations.add(operationId)
                return RelayResult.Success(RelayAccountDeletion(if (complete) RelayDeletionState.Deleted else
                    RelayDeletionState.Deleting, !complete), 60)
            }
        }
        val observed = RelayAccountAwareApi(api, store)
        val result = RelayAccounts(store, observed).delete() as RelayResult.Success
        assertEquals(60L, result.retryAfterSeconds)
        assertTrue(store.state.accountDeletionPending)
        assertEquals(60L, store.state.retryAfterSeconds)
        complete = true
        RelayAccounts(store, observed).delete()
        assertEquals(1, operations.distinct().size)
        assertTrue(store.state.accountDeleted)
        assertFalse(store.state.accountDeletionPending)
        assertFalse(store.state.signedIn)
        assertTrue(store.state.deletions.isEmpty())
        assertTrue("No plaintext fallback after account deletion", "local" in store.state.selectedBackends)
    }

    @Test fun accountDeletedAfterDeletionRequestIsCompletionUnderD53() = runTest {
        val time = RelayFakeTime()
        val store = sensitive()
        val api = RelayFakeApi(time).apply { failure = RelayResult.Failure(RelayErrorCode.AccountDeleted) }
        val result = RelayAccounts(store, RelayAccountAwareApi(api, store)).delete() as RelayResult.Success
        assertEquals(RelayDeletionState.Deleted, result.value.state)
        assertTrue(store.state.accountDeleted)
        assertTrue(store.state.routes.isEmpty())
        assertTrue(store.state.admissions.isEmpty())
    }

    @Test fun accountDeletedOnOrdinaryManagementErasesAllReceiveAuthority() = runTest {
        val time = RelayFakeTime()
        val store = sensitive()
        val api = RelayFakeApi(time).apply { failure = RelayResult.Failure(RelayErrorCode.AccountDeleted) }
        val observed = RelayAccountAwareApi(api, store)
        observed.begin(store.state.installationId!!, RelayCrypto.newId(), "synthetic-token")
        assertTrue(store.state.accountDeleted)
        assertNull(store.state.installationId)
        assertTrue(store.state.routes.isEmpty())
        assertTrue(store.state.admissions.isEmpty())
        assertEquals(RelayErrorCode.AccountDeleted, store.state.failure)
    }

    @Test fun disabledAccountKeepsSignInButStopsReceiveEnrollmentAndRouteMutation() = runTest {
        val time = RelayFakeTime()
        val store = sensitive()
        val api = RelayFakeApi(time).apply { failure = RelayResult.Failure(RelayErrorCode.AccountDisabled) }
        val observed = RelayAccountAwareApi(api, store)
        observed.begin(store.state.installationId!!, RelayCrypto.newId(), "synthetic-token")
        assertTrue(store.state.accountDisabled)
        assertTrue(store.state.signedIn)
        assertEquals(RelayErrorCode.AccountDisabled, store.state.failure)
        api.failure = null
        val begins = api.begins
        observed.begin(store.state.installationId!!, RelayCrypto.newId(), "another-token")
        assertEquals(begins, api.begins)
        RelayEnrollmentMachine(store, observed, time).resume()
        assertEquals(begins, api.begins)
        assertTrue(runCatching { RelayRoutes(store, observed, object : RelayBackendRegistration {
            override suspend fun register(route: RelayRoute): RelayBackendAgreement = error("must stop")
            override suspend fun confirm(route: RelayRoute, phoneConfirmation: String) = error("must stop")
            override suspend fun sync(route: RelayRoute, resume: Boolean): RelayClock = error("must stop")
            override suspend fun unregister(deletion: RelayBackendDeletion) { }
        }, time).create("backend", "session", "local") }.isFailure)
    }

    @Test fun revokedTokenStopsReceiveWithoutClaimingAccountDeletion() = runTest {
        val time = RelayFakeTime()
        val store = sensitive()
        val api = RelayFakeApi(time).apply { failure = RelayResult.Failure(RelayErrorCode.Unauthorized) }
        RelayAccountAwareApi(api, store).begin(store.state.installationId!!, RelayCrypto.newId(), "synthetic-token")
        assertFalse(store.state.signedIn)
        assertFalse(store.state.accountDeleted)
        assertEquals(RelayErrorCode.Unauthorized, store.state.failure)
    }

    @Test fun recentAuthRequiredRetainsDeletionOperationForLaterReauthentication() = runTest {
        val time = RelayFakeTime()
        val store = sensitive()
        val api = RelayFakeApi(time).apply { failure = RelayResult.Failure(RelayErrorCode.RecentLoginRequired) }
        val accounts = RelayAccounts(store, RelayAccountAwareApi(api, store))
        assertEquals(RelayResult.Failure(RelayErrorCode.RecentLoginRequired), accounts.delete())
        val operation = store.state.accountDeletionOperationId
        assertNotNull(operation)
        assertFalse(store.state.accountDeleted)
        assertEquals(RelayErrorCode.RecentLoginRequired, store.state.failure)
        accounts.delete()
        assertEquals(operation, store.state.accountDeletionOperationId)
    }

    private fun sensitive(): RelayMemoryStore {
        val route = RelayRoute(RelayCrypto.newId(), RelayCrypto.newId(), RelayCrypto.newId(), "backend", "session", "local",
            phonePublicKey = "public", salt = RelayCrypto.newSecret(), notificationKey = RelayCrypto.newSecret())
        return RelayMemoryStore(RelayState(installationId = RelayCrypto.newId(), signedIn = true,
            activeToken = "synthetic-token", routes = mapOf(route.routeId to route),
            selectedBackends = mapOf("local" to "session"), admissions = mapOf("session" to "synthetic-admission")))
    }
}
