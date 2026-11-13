package io.github.mitzacoder.kemiri.settings

import io.github.mitzacoder.kemiri.data.ConnectionStatus
import io.github.mitzacoder.kemiri.features.settings.connectionLabel
import org.junit.Assert.*
import org.junit.Test

class SettingsPresentationTest {
    @Test fun directoryPickerRequiresAdvertisedFilesystemAndReadyConnection() {
        fun state(features: String, status: ConnectionStatus = ConnectionStatus.Ready) = io.github.mitzacoder.kemiri.data.ConnectionState(status = status,
            hello = io.github.mitzacoder.kemiri.data.wireJson.decodeFromString<io.github.mitzacoder.kemiri.protocol.HelloResponse>("""{"type":"hello","id":"1","protocolVersion":1,"features":[$features],"server":{"name":"reference","version":"1"}}"""))
        assertFalse(io.github.mitzacoder.kemiri.features.settings.canBrowseDirectories(state("\"projects\"")))
        assertTrue(io.github.mitzacoder.kemiri.features.settings.canBrowseDirectories(state("\"projects\",\"filesystem\"")))
        assertFalse(io.github.mitzacoder.kemiri.features.settings.canBrowseDirectories(state("\"filesystem\"", ConnectionStatus.Reconnecting)))
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
