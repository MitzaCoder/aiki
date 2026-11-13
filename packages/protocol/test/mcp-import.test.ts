import { expect, test } from 'bun:test';
import { parseMcpImport } from '../src/mcp-import.ts';
import { McpAddRequestSchema } from '../src/mcp.ts';
import { Value } from 'typebox/value';

test('reviews wrapped/bare maps, commands, URL aliases and bearer headers without saving', () => {
 const fixture = { Local: { command: 'bun', args: ['run', '/tmp/synthetic.ts'], cwd: '/tmp', env: { DEMO_TOKEN: 'synthetic-env' } }, Remote: { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer synthetic-token' } }, Legacy: { type: 'sse', url: 'https://mcp.example.test/sse' }, Stream: { type: 'streamable-http', url: 'https://mcp.example.test/mcp' } };
 const rows = parseMcpImport(JSON.stringify({mcpServers:fixture}), ['local']);
 expect(rows.map(row => row.error)).toEqual([undefined, undefined, undefined, undefined]);
 expect(rows[0]?.serverId).toBe('local_2'); expect(rows[0]?.renamed).toBe(true);
 expect(rows[0]?.command?.args).toEqual(['run', '/tmp/synthetic.ts']);
 expect(rows[0]?.target).not.toContain('synthetic-env');
 expect(rows[1]?.token).toBe('synthetic-token'); expect(rows[1]?.target).not.toContain('synthetic-token');
 expect(rows[2]?.transport).toBe('sse');
 expect(parseMcpImport(JSON.stringify(fixture))).toHaveLength(4);
});
test('explains invalid rows without echoing secret values and assigns safe collision IDs', () => {
 const invalid = [null, {command:'bun',args:'no'}, {command:'bun',env:{TOKEN:123}}, {command:'bun',cwd:'relative'}, {command:'bun',url:'https://example.test'}, {url:'https://example.test?token=synthetic-secret'}, {url:'https://example.test',headers:{'x-api-key':'synthetic-secret'}}, {command:'bun',env:{AIKI_DATA_DIR:'/tmp'}}, {command:'bun',env:{KEMIRI_FUTURE_SETTING:'synthetic-secret'}}];
 for (const entry of invalid) {
 const row = parseMcpImport(JSON.stringify({'Bad entry':entry}))[0]!;
 expect(row.error).toBeTruthy(); expect(JSON.stringify(row)).not.toContain('synthetic-secret');
 }
 for (const text of ['[]','null','{','{"mcpServers":[]}']) expect(() => parseMcpImport(text)).toThrow();
 const ids = parseMcpImport(JSON.stringify({'A B':{command:'bun'},'A_B':{command:'bun'},'123':{command:'bun'}})).map(row=>row.serverId);
 expect(new Set(ids).size).toBe(3); for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
});
test('command protocol accepts write-only env, confirmation and replacement fields', () => {
 expect(Value.Check(McpAddRequestSchema, {type:'mcp.add',id:'test',serverId:'local',name:'Local',command:{command:'bun',args:[],cwd:'/tmp'},env:{DEMO_SECRET:'synthetic'},confirmed:true,replace:true})).toBe(true);
 expect(Value.Check(McpAddRequestSchema, {type:'mcp.add',id:'test',serverId:'local',name:'Local',command:{command:'bun',args:'shell string'}})).toBe(false);
});
