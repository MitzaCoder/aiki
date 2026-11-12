import { expect, test } from 'bun:test';
import { McpClient } from '@earendil-works/pi-mcp';
import { McpSseTransport } from '../src/mcp-sse.ts';

test('legacy SSE initializes, lists and calls over a same-origin bearer endpoint', async () => {
 let stream: ReadableStreamDefaultController<Uint8Array> | undefined; const encoder = new TextEncoder(); let calls = 0;
 const peer = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async request => {
 if (request.headers.get('authorization') !== 'Bearer synthetic-sse-token') return new Response(null,{status:401});
 if (request.method === 'GET') return new Response(new ReadableStream({start(controller) {stream = controller; controller.enqueue(encoder.encode('event: endpoint\ndata: /messages?session=synthetic\n\n'));},cancel(){ stream = undefined; }}),{headers:{'content-type':'text/event-stream'}});
 const message = await request.json() as {id?:number;method:string};
 if (message.id !== undefined) {
 let result: unknown = {};
 if (message.method === 'initialize') result = {protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};
 if (message.method === 'tools/list') result = {tools:[{name:'read',inputSchema:{type:'object'}}]};
 if (message.method === 'tools/call') {calls++; result = {content:[{type:'text',text:'synthetic SSE result'}]};}
 stream?.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',id:message.id,result})}\n\n`));
 }
 return new Response(null,{status:202});
 }});
 const client = new McpClient({name:'test',version:'1'});
 try { await client.connect(new McpSseTransport(`http://127.0.0.1:${peer.port}/sse`, async () => 'synthetic-sse-token'));
 expect((await client.listTools())[0]?.name).toBe('read'); expect(JSON.stringify(await client.callTool('read',{}))).toContain('synthetic SSE result'); expect(calls).toBe(1);
 } finally { await client.close(); peer.stop(true); }
});
test('legacy SSE refuses cross-origin advertised endpoints before forwarding any token', async () => {
 const peer = Bun.serve({port:0,fetch:()=>new Response('event: endpoint\ndata: https://other.example.test/messages\n\n',{headers:{'content-type':'text/event-stream'}})});
 const transport = new McpSseTransport(`http://localhost:${peer.port}/sse`, async ()=>'synthetic');
 try { await expect(transport.start()).rejects.toThrow('MCP SSE connection failed'); } finally {await transport.close();peer.stop(true);}
});
