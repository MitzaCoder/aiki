import { describe, expect, test } from 'bun:test';
import type { McpServer } from '@kemiri/protocol';
import { filterMcpTools, mcpProjectServer, mcpServerId, mcpStatus, mcpToolHint, mcpSupportsOAuth, mcpOAuthFlowLabel } from '../src/lib/mcp.ts';
import { backendSettingsHref, projectSectionAvailable, projectSettingsHref, settingsParentHref } from '../src/lib/settings.ts';

const tool = (name: string, annotations?: Record<string, unknown>, description?: string): McpServer['tools'][number] => ({ name, annotations, description, policy: 'ask', inputSchema: {} });
describe('MCP settings', () => {
  test('connection states and write-only credential presence', () => {
    expect(mcpStatus({ status: 'connected', hasCredential: false, lastError: null }).label).toBe('Connected');
    expect(mcpStatus({ status: 'disconnected', hasCredential: true, lastError: null }).label).toBe('Disconnected');
    expect(mcpStatus({ status: 'error', hasCredential: false, lastError: 'MCP connection failed' }).label).toBe('Error');
    expect(mcpStatus({ status: 'needs_sign_in', hasCredential: true, lastError: null }).label).toBe('Needs sign-in');
    expect(mcpStatus({ status: 'signing_in', hasCredential: false, lastError: null }).label).toBe('Waiting for sign-in');
    expect(mcpStatus({ status: 'error', hasCredential: true, lastError: 'MCP connection failed' }).tone).toBe('err');
  });
  test('OAuth support comes only from preset auth or an existing OAuth grant', () => {
    const presets = [{ id: 'notion', auth: 'OAuth or token' }, { id: 'token', auth: 'token only' }];
    expect(mcpSupportsOAuth({ presetId: 'notion', authKind: 'none' }, presets)).toBe(true);
    expect(mcpSupportsOAuth({ presetId: 'token', authKind: 'none' }, presets)).toBe(false);
    expect(mcpSupportsOAuth({ authKind: 'none' }, presets)).toBe(false);
    expect(mcpSupportsOAuth({ authKind: 'oauth' }, [])).toBe(true);
    expect(mcpSupportsOAuth({ presetId: 'unknown', authKind: 'token' }, presets)).toBe(false);
  });
  test('OAuth flow labels cover every terminal state without echoing server text', () => {
    const labels = ['Waiting for sign-in', 'Sign-in finished', 'Sign-in failed', 'Sign-in cancelled', 'Sign-in expired'];
    (['pending', 'succeeded', 'failed', 'cancelled', 'expired'] as const).forEach((status, index) => {
      expect(mcpOAuthFlowLabel({ flowId: 'f', serverId: 'notion', expiresAt: 1000, status, error: 'synthetic failure' })).toBe(labels[index]!);
    });
  });
  test('destructive beats read-only; missing or false hints are not read-only', () => {
    for (const annotations of [undefined, {}, { readOnlyHint: false }, { readOnlyHint: 'true' }]) expect(mcpToolHint({ annotations })).toBe('Write / unknown hint');
    expect(mcpToolHint({ annotations: { readOnlyHint: true } })).toBe('Read-only hint');
    expect(mcpToolHint({ annotations: { readOnlyHint: true, destructiveHint: true } })).toBe('Destructive hint');
    expect(mcpToolHint({})).toBe('Write / unknown hint');
  });
  test('filter is case insensitive, literal, and requires every word', () => {
    const tools = [tool('read_page', { readOnlyHint: true }, 'Search a PAGE'), tool('delete_page', { destructiveHint: true }, 'Delete a page <script>no markup</script>')];
    expect(filterMcpTools(tools, '  PAGE READ-only  ')).toEqual([tools[0]!]);
    expect(filterMcpTools(tools, '<script>')).toEqual([tools[1]!]);
    expect(filterMcpTools(tools, '.*')).toEqual([]);
    expect(filterMcpTools(tools, '')).toEqual(tools);
  });
  test('project enablement and every role start off without changing stored selections', () => {
    const stored = [{ serverId: 'notion', enabled: true, roles: ['workers' as const] }];
    expect(mcpProjectServer(stored, 'other')).toEqual({ serverId: 'other', enabled: false, roles: [] });
    expect(mcpProjectServer(stored, 'notion')).toBe(stored[0]!);
    expect(stored).toHaveLength(1);
  });
  test('generated server IDs are unique and namespace safe', () => {
    expect(mcpServerId('Notion account', ['notion_account'])).toBe('notion_account_2');
    expect(mcpServerId('!!!', ['server'])).toBe('server_2');
    expect(mcpServerId('a'.repeat(31) + ' b', ['a'.repeat(31)])).toBe('a'.repeat(31) + '_2');
    for (const name of ['123', '!!!', 'A___B', 'x'.repeat(150), 'é Example']) {
      const id = mcpServerId(name, []);
      expect(id).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
      expect(id.includes('__')).toBe(false);
    }
  });
  test('routes are stable and section is capability gated', () => {
    expect(backendSettingsHref('test', 'mcp')).toBe('/settings/backends/test/mcp');
    expect(settingsParentHref('/settings/backends/test/mcp')).toBe('/settings/backends/test');
    expect(projectSettingsHref('test', 'p', 'mcp')).toBe('/b/test/projects/p/settings/mcp');
    expect(projectSectionAvailable('mcp', { supports: () => false, links: true, longPromptCache: true })).toBe(false);
    expect(projectSectionAvailable('mcp', { supports: feature => feature === 'mcp-servers', links: false, longPromptCache: false })).toBe(true);
  });
});
