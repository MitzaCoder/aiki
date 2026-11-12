import { expect, test } from 'bun:test';
import { askCoordinatorForMcpCli } from '../src/lib/mcp-cli.ts';

test('CLI button submits to the chosen coordinator, then opens its chat', async () => {
 const events: unknown[] = [];
 const client = { submit: async (...args: unknown[]) => { events.push(args); } };
 await askCoordinatorForMcpCli(client, 'synthetic-project', 'gh', async () => { events.push('chat'); });
 expect(events).toEqual([['synthetic-project', expect.stringContaining('Please set up the GitHub CLI (gh)'), { whenBusy: 'steer' }], 'chat']);
});
test('missing project or failed admission does not navigate or resend', async () => {
 let calls = 0, opens = 0;
 const client = { submit: async () => { calls++; throw new Error('offline'); } };
 await expect(askCoordinatorForMcpCli(client, '', 'acli', async () => { opens++; })).rejects.toThrow('Choose a project');
 expect(calls).toBe(0);
 await expect(askCoordinatorForMcpCli(client, 'project', 'acli', async () => { opens++; })).rejects.toThrow('offline');
 expect(calls).toBe(1); expect(opens).toBe(0);
});
