/**
 * The little of `WebSocket` this client needs.
 *
 * Declared here rather than using lib.dom so the package also type-checks and runs in React Native and Capacitor. The
 * default factory reads `globalThis.WebSocket`; an app with another implementation passes its own factory.
 */
export interface HarnessWebSocket {
	send(data: string | Uint8Array): void;
	/** Set to "arraybuffer" where the socket has it, so binary frames (terminal output) arrive as bytes. */
	binaryType?: string;
	close(code?: number, reason?: string): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => HarnessWebSocket;

export const defaultWebSocketFactory: WebSocketFactory = (url) => {
	const implementation = (globalThis as { WebSocket?: new (url: string) => HarnessWebSocket }).WebSocket;
	if (implementation === undefined) {
		throw new Error("No WebSocket implementation available; pass a webSocketFactory");
	}
	const socket = new implementation(url);
	try {
		socket.binaryType = "arraybuffer";
	} catch {
		// A socket without the property delivers text only.
	}
	return socket;
};
