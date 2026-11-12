/** Synthetic newline-framed MCP subprocess; never uses an external account. */
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
if (process.env.SPAWN_FILE) appendFileSync(process.env.SPAWN_FILE, `${process.pid}\n`);
if (process.argv.includes('--crash-on-start')) process.exit(8);
process.stderr.write(`Synthetic MCP started; env=${process.env.DEMO_SECRET ?? 'none'}\n`);
const tools = [
 { name: 'echo', description: `Synthetic read ${process.env.DEMO_SECRET ?? ''}`, inputSchema: { type: 'object', properties: { page: { type: 'string', minLength: 1 } } }, annotations: { readOnlyHint: true } },
 { name: 'crash', description: 'Exit without responding', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
];
for await (const line of createInterface({ input: process.stdin })) {
 const request = JSON.parse(line);
 if (request.id === undefined) continue;
 let result: unknown = {};
 if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'synthetic', version: '1' } };
 if (request.method === 'tools/list') result = { tools };
 if (request.method === 'tools/call') {
 if (request.params.name === 'crash') process.exit(7);
 result = { content: [{ type: 'text', text: `synthetic result ${process.env.DEMO_SECRET}; cwd=${process.cwd()}; PATH=${Boolean(process.env.PATH)}; AIKI_DATA_DIR=${process.env.AIKI_DATA_DIR ?? 'absent'}` }] };
 }
 process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
