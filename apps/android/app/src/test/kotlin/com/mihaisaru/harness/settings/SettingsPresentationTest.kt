package com.mihaisaru.harness.settings

import com.mihaisaru.harness.data.ConnectionStatus
import com.mihaisaru.harness.features.settings.connectionLabel
import org.junit.Assert.*
import org.junit.Test

class SettingsPresentationTest {
    @Test fun directoryPickerRequiresAdvertisedFilesystemAndReadyConnection() {
        fun state(features: String, status: ConnectionStatus = ConnectionStatus.Ready) = com.mihaisaru.harness.data.ConnectionState(status = status,
            hello = com.mihaisaru.harness.data.wireJson.decodeFromString<com.mihaisaru.harness.protocol.HelloResponse>("""{"type":"hello","id":"1","protocolVersion":1,"features":[$features],"server":{"name":"reference","version":"1"}}"""))
        assertFalse(com.mihaisaru.harness.features.settings.canBrowseDirectories(state("\"projects\"")))
        assertTrue(com.mihaisaru.harness.features.settings.canBrowseDirectories(state("\"projects\",\"filesystem\"")))
        assertFalse(com.mihaisaru.harness.features.settings.canBrowseDirectories(state("\"filesystem\"", ConnectionStatus.Reconnecting)))
    }
    @Test fun connectionStatesAreHumanLabelsNotProtocolNames() {
        assertEquals("Connected", connectionLabel(ConnectionStatus.Ready))
        assertEquals("Connecting…", connectionLabel(ConnectionStatus.Connecting))
        assertEquals("Reconnecting…", connectionLabel(ConnectionStatus.Reconnecting))
        assertEquals("Not connected", connectionLabel(ConnectionStatus.Idle))
        assertEquals("Disconnected", connectionLabel(ConnectionStatus.Closed))
        assertEquals(5, ConnectionStatus.entries.map(::connectionLabel).distinct().size)
    }
}
