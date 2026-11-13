import { expect, it } from 'bun:test';
import type { McpOAuthFlow } from '@kemiri/protocol';
import { HarnessClient, type HarnessWebSocket } from '../src/index.ts';

it('delivers MCP OAuth events, isolates listeners and stops after unsubscribe', async () => {
  const socket: HarnessWebSocket = {
    onopen: null, onmessage: null, onclose: null, onerror: null,
    send(data) {
      const request = JSON.parse(data as string);
      if (request.type === 'hello') socket.onmessage?.({ data: JSON.stringify({ type: 'hello', id: request.id,
        protocolVersion: 1, server: { name: 'synthetic', version: '0' }, features: ['mcp-servers'] }) });
    },
    close() { socket.onclose?.({ code: 1000 }); },
  };
  const client = new HarnessClient({ url: 'ws://example.test/ws', reconnect: false,
    webSocketFactory: () => { queueMicrotask(() => socket.onopen?.()); return socket; } });
  try {
    client.connect(); await client.whenReady();
    const received: McpOAuthFlow[] = [];
    client.onMcpOAuthChanged(() => { throw new Error('synthetic consumer failure'); });
    const stop = client.onMcpOAuthChanged(flow => received.push(flow));
    const flow: McpOAuthFlow = { flowId: 'synthetic-flow', serverId: 'notion', status: 'pending', expiresAt: 1000 };
    const push = (flow: McpOAuthFlow) => socket.onmessage?.({ data: JSON.stringify({ type: 'mcp.oauth.changed', flow }) });
    push(flow); push({ ...flow, status: 'succeeded' });
    expect(received.map(flow => flow.status)).toEqual(['pending', 'succeeded']);
    expect(received[0]).toEqual(flow);
    stop(); push({ ...flow, status: 'cancelled' });
    expect(received).toHaveLength(2);
  } finally { client.close(); }
});
