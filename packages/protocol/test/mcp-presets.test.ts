import { expect, test } from 'bun:test';
import { MCP_PRESETS, MCP_PRESET_GROUPS, mcpCliSetupMessage, mcpPresetQueryAllowed } from '../src/mcp.ts';

test('catalogue definitions have unique IDs, documented transports and explicit authentication', () => {
 expect(MCP_PRESETS).toHaveLength(19);
 expect(new Set(MCP_PRESETS.map(p => p.id)).size).toBe(MCP_PRESETS.length);
 for (const preset of MCP_PRESETS) {
  expect(preset.id).toMatch(/^[a-z][a-z0-9_]*$/);
  expect(MCP_PRESET_GROUPS).toContain(preset.group!);
  expect(['oauth', 'registered_oauth', 'token', 'none', 'command']).toContain(preset.auth);
  expect(new URL(preset.docsUrl!).protocol).toBe('https:');
  expect(preset.description!.length).toBeGreaterThan(15);
  if (preset.command) {
   expect(preset.auth).toBe('command'); expect(preset.url).toBe(''); expect(preset.command.args.length).toBeGreaterThan(0);
  } else {
   const url = new URL(preset.url); expect(url.protocol).toBe('https:'); expect(url.username + url.password + url.hash).toBe(''); expect(mcpPresetQueryAllowed(url)).toBe(true);
  }
  if (preset.auth === 'token') expect(new URL(preset.tokenUrl!).protocol).toBe('https:');
  if (preset.auth === 'registered_oauth') { expect(new URL(preset.appUrl!).protocol).toBe('https:'); expect(preset.steps!.length).toBeGreaterThanOrEqual(3); }
 }
 expect(MCP_PRESETS.find(p => p.id === 'github')!.url).toEndWith('/readonly');
 expect(MCP_PRESETS.find(p => p.id === 'postgres')!.envNames).toEqual(['DATABASE_URI']);
});
test('vendor options do not open a credential-in-query path', () => {
 for (const url of ['https://mcp.supabase.com/mcp?read_only=true&project_ref=synthetic123', 'https://mcp.atlassian.com/v2/mcp?tools=all']) expect(mcpPresetQueryAllowed(new URL(url))).toBe(true);
 for (const url of ['https://example.com/mcp?read_only=true', 'https://mcp.supabase.com/mcp?access_token=secret', 'https://mcp.supabase.com/mcp?read_only=false', 'https://mcp.supabase.com/mcp?read_only=true&read_only=true', 'https://mcp.atlassian.com/v2/mcp?tools=all&token=secret']) expect(mcpPresetQueryAllowed(new URL(url))).toBe(false);
});
test('CLI setup requests are fixed, project scoped and never shell commands', () => {
 expect(mcpCliSetupMessage('gh')).toContain('GitHub CLI (gh)');
 expect(mcpCliSetupMessage('acli')).toContain('Atlassian CLI (acli) for Jira');
 expect(mcpCliSetupMessage('gh')).toContain('headless login steps');
 expect(() => mcpCliSetupMessage('arbitrary')).toThrow('Unsupported CLI');
});
