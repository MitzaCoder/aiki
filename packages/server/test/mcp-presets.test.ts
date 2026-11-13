import { expect, test } from 'bun:test';
import { MCP_PRESETS } from '@kemiri/protocol';
import { createSetup } from './support.ts';

test('remote presets resolve their verified URL without connecting or enabling projects', async () => {
 const setup = await createSetup({ terminals: false });
 try {
  const mcp = setup.server.manager.mcp!;
  for (const preset of MCP_PRESETS.filter(p => !p.command)) {
   const server = await mcp.add({ serverId: preset.id, name: preset.name, presetId: preset.id });
   expect(server.url).toBe(new URL(preset.url).href);
   expect(server.status).toBe('disconnected'); expect(server.hasCredential).toBe(false);
   expect(server.tools).toEqual([]); expect(server.presetId).toBe(preset.id);
  }
  expect(mcp.project('synthetic-project')).toEqual([]);
 } finally { await setup.cleanup(); }
});
test('every command preset still requires exact-command confirmation and hides env secrets', async () => {
 const setup = await createSetup({ terminals: false });
 try {
  const mcp = setup.server.manager.mcp!;
  for (const preset of MCP_PRESETS.filter(p => p.command)) {
   const input = { serverId: preset.id, name: preset.name, presetId: preset.id, command: preset.command!, env: Object.fromEntries((preset.envNames ?? []).map(name => [name, 'synthetic-database-secret'])) };
   await expect(mcp.add(input)).rejects.toThrow('Confirm the exact command');
   const server = await mcp.add({ ...input, confirmed: true });
   expect(server.command).toEqual(preset.command); expect(server.envNames).toEqual(preset.envNames ?? []);
   expect(server.status).toBe('disconnected'); expect(JSON.stringify(server)).not.toContain('synthetic-database-secret');
   expect(mcp.project('synthetic-project')).toEqual([]);
  }
 } finally { await setup.cleanup(); }
});
