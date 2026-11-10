package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.features.notifications.relay.*
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class RelayClientTest {
    private val installation = RelayCrypto.newId()
    private val operation = RelayCrypto.newId()
    private val challenge = RelayCrypto.newId()
    private val nonce = RelayCrypto.newSecret()
    private val routeId = RelayCrypto.newId()
    private val route = RelayRoute(routeId, RelayCrypto.newId(), operation, "backend", "session", "local",
        RelayCrypto.bearer("send", routeId), RelayCrypto.bearer("delete", routeId), "private", "public", nonce)
    private val receipt = """{"routeId":"$routeId","state":"pending","leaseExpiresAt":1000,"absoluteExpiresAt":2000}"""

    @Test fun everyPhoneEndpointUsesExactOctetStreamBearerAndBody() = runTest {
        MockWebServer().use { server ->
            server.start()
            val client = client(server)
            suspend fun check(path: String, body: JsonObject, response: String, call: suspend () -> RelayResult<*>) {
                server.enqueue(MockResponse.Builder().code(if (response.isEmpty()) 204 else 200).body(response).build())
                assertTrue(call() is RelayResult.Success)
                val request = server.takeRequest(2, TimeUnit.SECONDS)!!
                assertEquals("/v1/$path", request.url.encodedPath)
                assertEquals("POST", request.method)
                assertEquals("application/octet-stream", request.headers["Content-Type"])
                assertEquals("Bearer synthetic-id-token", request.headers["Authorization"])
                assertEquals("no-store", request.headers["Cache-Control"])
                assertEquals(body, Json.parseToJsonElement(request.body!!.utf8()))
            }
            check("accounts/status", obj(), """{"state":"active","phones":1,"routes":0,"phoneLimit":3,"routeLimit":24,"future":true}""") { client.accountStatus() }
            check("installations/list", obj(), """{"installations":[]}""") { client.installations() }
            for (replacing in listOf(false, true)) {
                val prefix = if (replacing) "installations/token" else "installations"
                check("$prefix/begin", obj("installationId" to installation, "operationId" to operation, "token" to "fcm"),
                    """{"challengeId":"$challenge","deadline":1000}""") { client.begin(installation, operation, "fcm", replacing) }
                check("$prefix/confirm", obj("installationId" to installation, "operationId" to operation,
                    "challengeId" to challenge, "nonce" to nonce), """{"installationId":"$installation","generation":1}""") {
                    client.confirm(installation, operation, challenge, nonce, replacing)
                }
            }
            check("installations/delete", obj("installationId" to installation), "") { client.deleteInstallation(installation) }
            fun hash(bearer: String, purpose: String) = RelayCrypto.credentialHash(bearer, purpose)
                .joinToString("") { "%02x".format(it.toInt() and 255) }
            check("routes/create", obj("installationId" to installation, "routeId" to routeId, "operationId" to operation,
                "sendHash" to hash(route.sendBearer!!, "send"), "deleteHash" to hash(route.deleteBearer!!, "delete")), receipt) {
                client.create(installation, route)
            }
            val ids = obj("installationId" to installation, "routeId" to routeId)
            check("routes/activate", ids, receipt) { client.activate(installation, routeId) }
            check("routes/renew", ids, receipt) { client.renew(installation, routeId) }
            check("routes/delete", ids, "") { client.deleteRoute(installation, routeId) }
        }
    }

    @Test fun fixedErrorsAndRetryAfterAreTypedAndUnknownTextIsNotRetained() = runTest {
        MockWebServer().use { server ->
            server.start()
            val client = client(server)
            val codes = RelayErrorCode.entries.filterNot { it.wire.startsWith("local_") || it == RelayErrorCode.Unknown }
            for (code in codes) {
                server.enqueue(MockResponse.Builder().code(429).addHeader("Retry-After", "73")
                    .body("""{"error":"${code.wire}"}""").build())
                assertEquals(RelayResult.Failure(code, 73), client.accountStatus())
            }
            server.enqueue(MockResponse.Builder().code(500).addHeader("Retry-After", "not-seconds")
                .body("""{"error":"attacker-controlled"}""").build())
            val result = client.accountStatus()
            assertEquals(RelayResult.Failure(RelayErrorCode.Unknown), result)
            assertFalse(result.toString().contains("attacker"))
        }
    }

    @Test fun redirectsRefusedAndOversizedResponsesRefused() = runTest {
        MockWebServer().use { server ->
            server.start()
            val client = client(server)
            server.enqueue(MockResponse.Builder().code(302).addHeader("Location", server.url("/stolen")).body("{}").build())
            assertTrue(client.accountStatus() is RelayResult.Failure)
            assertEquals(1, server.requestCount)
            server.enqueue(MockResponse.Builder().body("x".repeat(RelayClient.MAX_RESPONSE.toInt() + 1)).build())
            assertEquals(RelayResult.Failure(RelayErrorCode.InvalidResponse), client.accountStatus())
        }
    }

    @Test fun absentAccountOrEndpointNeverCallsHttp() = runTest {
        MockWebServer().use { server ->
            server.start()
            val noAccount = RelayClient(RelayEndpoint(server.url("/").toString(), true), RelayAccount { null })
            assertEquals(RelayResult.Failure(RelayErrorCode.NotSignedIn), noAccount.accountStatus())
            val noEndpoint = RelayClient(RelayEndpoint("", false), RelayAccount { error("must not request sign-in") })
            assertEquals(RelayResult.Failure(RelayErrorCode.Unavailable), noEndpoint.accountStatus())
            assertEquals(0, server.requestCount)
        }
    }

    @Test fun deleteOnlyQueueNeedsNoSignedInAccount() = runTest {
        MockWebServer().use { server ->
            server.start()
            val client = RelayClient(RelayEndpoint(server.url("/v1/").toString(), true), RelayAccount { error("no account") })
            server.enqueue(MockResponse.Builder().code(204).build())
            assertTrue(client.revoke(RelayDeletion(routeId, route.deleteBearer!!)) is RelayResult.Success)
            val request = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("Bearer ${route.deleteBearer}", request.headers["Authorization"])
            assertEquals("/v1/delete", request.url.encodedPath)
            assertEquals(obj("routeId" to routeId), Json.parseToJsonElement(request.body!!.utf8()))
        }
    }

    @Test fun endpointPolicyNeverAcceptsUntrustedOrigins() {
        assertNotNull(RelayEndpoint("", false).unavailableReason)
        assertNotNull(RelayEndpoint("http://relay.example.test/v1", true).unavailableReason)
        assertNotNull(RelayEndpoint("http://127.0.0.1/v1", false).unavailableReason)
        assertNotNull(RelayEndpoint("https://user:pass@relay.example.test/v1", true).unavailableReason)
        assertNotNull(RelayEndpoint("https://relay.example.test/v1?redirect=x", true).unavailableReason)
        assertNull(RelayEndpoint("https://relay.example.test/v1", false).unavailableReason)
        assertNull(RelayEndpoint("http://10.0.2.2/v1", true).unavailableReason)
    }

    private fun client(server: MockWebServer) = RelayClient(RelayEndpoint(server.url("/v1/").toString(), true),
        RelayAccount { "synthetic-id-token" })
    private fun obj(vararg pairs: Pair<String, String>) = buildJsonObject { pairs.forEach { put(it.first, it.second) } }
}
