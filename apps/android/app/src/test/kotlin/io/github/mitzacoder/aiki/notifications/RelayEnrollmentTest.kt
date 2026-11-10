package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.features.notifications.relay.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class RelayEnrollmentTest {
    @Test fun enrollmentAndTokenReplacementUseOneInstallationAcrossDuplicateCallbacks() = runTest {
        val time = RelayFakeTime()
        val store = RelayMemoryStore()
        val api = RelayFakeApi(time)
        val machine = RelayEnrollmentMachine(store, api, time)
        machine.enable("fcm-one")
        val installation = store.state.installationId
        machine.tokenChanged("fcm-one")
        assertEquals(1, api.begins)
        assertTrue(machine.challenge(challenge(store.state, api.challengeId, time)))
        assertEquals("fcm-one", store.state.activeToken)
        assertNull(store.state.enrollment)
        machine.tokenChanged("fcm-two")
        machine.tokenChanged("fcm-two")
        assertTrue(api.replacing)
        assertEquals(2, api.begins)
        assertEquals(installation, store.state.installationId)
        assertTrue(machine.challenge(challenge(store.state, api.challengeId, time)))
        assertEquals("fcm-two", store.state.activeToken)
        assertEquals(2, api.confirms)
    }

    @Test fun wrongForeignExpiredAndUnexpectedChallengesNeverConfirm() = runTest {
        val time = RelayFakeTime()
        val store = RelayMemoryStore()
        val api = RelayFakeApi(time)
        val machine = RelayEnrollmentMachine(store, api, time)
        machine.enable("fcm")
        val valid = Json.parseToJsonElement(challenge(store.state, api.challengeId, time)).jsonObject
        for ((key, replacement) in listOf(
            "installationId" to JsonPrimitive(RelayCrypto.newId()), "operationId" to JsonPrimitive(RelayCrypto.newId()),
            "challengeId" to JsonPrimitive(RelayCrypto.newId()), "deadline" to JsonPrimitive(time.now - 1),
            "deadline" to JsonPrimitive(time.now + 300001), "v" to JsonPrimitive(2),
            "nonce" to JsonPrimitive("invalid"), "extra" to JsonPrimitive("attacker"),
        )) assertFalse(machine.challenge(JsonObject(valid + (key to replacement)).toString()))
        assertEquals(0, api.confirms)
        assertTrue(machine.challenge(valid.toString()))
        assertFalse(machine.challenge(valid.toString()))
    }

    @Test fun receiptDeadlineSurvivesSmallPhoneClockLag() = runTest {
        val time = RelayFakeTime()
        val store = RelayMemoryStore()
        val api = RelayFakeApi(time)
        val machine = RelayEnrollmentMachine(store, api, time)
        machine.enable("fcm")
        time.now -= 750
        assertTrue(machine.challenge(challenge(store.state, api.challengeId, time)))
        assertEquals(1, api.confirms)
        assertNotNull(store.state.activeToken)
    }

    @Test fun lostChallengeStartsNewOperationWhileBeginRetryReusesOriginal() = runTest {
        val time = RelayFakeTime()
        val store = RelayMemoryStore()
        val api = RelayFakeApi(time)
        api.failure = RelayResult.Failure(RelayErrorCode.Network)
        RelayEnrollmentMachine(store, api, time).enable("fcm")
        val original = store.state.enrollment!!.operationId
        api.failure = null
        val restarted = RelayEnrollmentMachine(store, api, time)
        restarted.resume()
        assertEquals(listOf(original, original), api.operationIds)
        restarted.restartChallenge()
        assertNotEquals(original, store.state.enrollment!!.operationId)
        time.now += 300001
        RelayEnrollmentMachine(store, api, time).resume()
        assertEquals(4, api.begins)
        assertEquals(3, api.operationIds.distinct().size)
    }

    @Test fun phoneLimitAndRateRetryRemainTypedAcrossProcessDeath() = runTest {
        val time = RelayFakeTime()
        val store = RelayMemoryStore()
        val api = RelayFakeApi(time)
        api.failure = RelayResult.Failure(RelayErrorCode.PhoneLimit, 70)
        RelayEnrollmentMachine(store, api, time).enable("fcm")
        assertEquals(RelayErrorCode.PhoneLimit, store.state.failure)
        assertEquals(70L, store.state.retryAfterSeconds)
        val operation = store.state.enrollment!!.operationId
        api.failure = RelayResult.Failure(RelayErrorCode.EnrollmentCapacity, 90)
        RelayEnrollmentMachine(store, api, time).resume()
        assertEquals(operation, store.state.enrollment!!.operationId)
        assertEquals(RelayErrorCode.EnrollmentCapacity, store.state.failure)
    }

    @Test fun confirmNonceIsDurableAndResumesWithoutSecondChallenge() = runTest {
        val time = RelayFakeTime()
        val store = RelayMemoryStore()
        val api = RelayFakeApi(time)
        val machine = RelayEnrollmentMachine(store, api, time)
        machine.enable("fcm")
        val waiting = RelayEnrollmentMachine(store, api, time)
        waiting.resume()
        assertEquals(1, api.begins)
        api.failure = RelayResult.Failure(RelayErrorCode.Network)
        assertTrue(waiting.challenge(challenge(store.state, api.challengeId, time)))
        assertEquals(RelayEnrollment.Phase.Confirm, store.state.enrollment!!.phase)
        assertNotNull(store.state.enrollment!!.nonce)
        api.failure = null
        RelayEnrollmentMachine(store, api, time).resume()
        assertEquals(2, api.confirms)
        assertEquals("fcm", store.state.activeToken)
    }
}
