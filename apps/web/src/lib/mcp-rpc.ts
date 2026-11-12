import type { ClientRequest } from '@aiki/client';
import type { Response } from '@aiki/protocol';
import type { BackendConnection } from './harness.svelte.js';
/** Typed settings RPCs. No secrets are cached or written to browser storage. */
export async function mcpRequest<T extends `mcp.${string}` & Response['type']>(
  backend: BackendConnection, request: ClientRequest & { type: T }
): Promise<Extract<Response, { type: T }>> {
  const response = await backend.client.request(request);
  if (response.type === 'error') throw new Error(response.error.message);
  if (response.type !== request.type) throw new Error('Unexpected MCP response.');
  return response as Extract<Response, { type: T }>;
}
