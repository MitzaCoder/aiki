/** Presentation rules for untrusted remote MCP catalogues. Policies themselves come from the backend. */
import type { McpOAuthFlow, McpProjectServer, McpServer } from '@aiki/protocol';
export type McpTool = McpServer['tools'][number];
export const MCP_POLICY_OPTIONS = [
  { value: 'off', label: 'Off' }, { value: 'ask', label: 'Ask' }, { value: 'allow', label: 'Allow' }
] as const;
export const MCP_ROLE_OPTIONS = [
  { value: 'coordinator', label: 'Coordinator' }, { value: 'workers', label: 'Workers' },
  { value: 'background', label: 'Background threads' }
] as const;
export function mcpStatus(server: Pick<McpServer, 'status' | 'hasCredential' | 'lastError'>): { label: string; tone: 'ok' | 'warn' | 'err' | 'muted' } {
  if (server.status === 'connected') return { label: 'Connected', tone: 'ok' };
  if (server.status === 'signing_in') return { label: 'Waiting for sign-in', tone: 'warn' };
  if (server.status === 'needs_sign_in') return { label: 'Needs sign-in', tone: 'warn' };
  if (server.status === 'error') return { label: 'Error', tone: 'err' };
  return { label: 'Disconnected', tone: 'muted' };
}
/** Never infer OAuth support from a missing credential or an arbitrary server display name. */
export function mcpSupportsOAuth(server: Pick<McpServer, 'presetId' | 'authKind'>, presets: readonly { id: string; auth: string }[]): boolean {
  return server.authKind === 'oauth' || presets.some(preset => preset.id === server.presetId && /\boauth\b/i.test(preset.auth));
}
export function mcpOAuthFlowLabel(flow: McpOAuthFlow): string {
  switch (flow.status) {
    case 'pending': return 'Waiting for sign-in';
    case 'succeeded': return 'Sign-in finished';
    case 'failed': return 'Sign-in failed';
    case 'cancelled': return 'Sign-in cancelled';
    case 'expired': return 'Sign-in expired';
  }
}
export function mcpToolHint(tool: Pick<McpTool, 'annotations'>): string {
  if (tool.annotations?.destructiveHint === true) return 'Destructive hint';
  return tool.annotations?.readOnlyHint === true ? 'Read-only hint' : 'Write / unknown hint';
}
export function filterMcpTools(tools: readonly McpTool[], query: string): McpTool[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return tools.filter(tool => {
    const text = `${tool.name} ${tool.description ?? ''} ${mcpToolHint(tool)}`.toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}
export function mcpProjectServer(servers: readonly McpProjectServer[], serverId: string): McpProjectServer {
  return servers.find(server => server.serverId === serverId) ?? { serverId, enabled: false, roles: [] };
}
/** ID has the backend's deliberately small, namespace-safe alphabet. */
export function mcpServerId(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32).replace(/_+$/g, '') || 'server';
  const stem = /^[a-z]/.test(base) ? base : `server_${base}`.slice(0, 32);
  let id = stem;
  for (let suffix = 2; taken.includes(id); suffix++) id = `${stem}_${suffix}`;
  return id;
}
