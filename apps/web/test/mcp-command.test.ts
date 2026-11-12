import { expect, test } from 'bun:test';
import { parseMcpImport } from '@aiki/protocol';
import { createServer } from 'vite';

test('command confirmation shows exact argv/cwd, masks env and renders command metadata as plain text', async () => {
 const vite = await createServer({root:import.meta.dir+'/..',server:{middlewareMode:true},logLevel:'error'});
 try {
 const {default:Review} = await vite.ssrLoadModule('/src/lib/components/settings/McpCommandReview.svelte');
 const {render} = await vite.ssrLoadModule('svelte/server');
 const entries = parseMcpImport(JSON.stringify({Local:{command:'bun',args:['run','<script>untrusted</script>','a b'],cwd:'/tmp/synthetic',env:{DEMO_SECRET:'synthetic-secret-value'}}}));
 const html = render(Review,{props:{entries}}).body;
 expect(html).toContain('Command: bun'); expect(html).toContain('Working directory: /tmp/synthetic');
 expect(html).toContain('a b'); expect(html).toContain('DEMO_SECRET=••••');
 expect(html).not.toContain('synthetic-secret-value'); expect(html).not.toContain('<script>');
 const edit = render(Review,{props:{entries,retainedEnvNames:['SAVED_TOKEN']}}).body;
 expect(edit).toContain('SAVED_TOKEN=••••');
 } finally {await vite.close();}
},20_000);

test('import review checks valid entries, disables invalid entries, explains collisions and never shows bearer/env values', async () => {
 const vite = await createServer({root:import.meta.dir+'/..',server:{middlewareMode:true},logLevel:'error'});
 try {
 const {default:Review} = await vite.ssrLoadModule('/src/lib/components/settings/McpImportReview.svelte');
 const {render} = await vite.ssrLoadModule('svelte/server');
 const entries = parseMcpImport(JSON.stringify({Local:{command:'bun',env:{KEY:'synthetic-env'}},Remote:{url:'https://mcp.example.test/mcp',headers:{Authorization:'Bearer synthetic-bearer'}},Bad:{command:'bun',args:12}}),['local']);
 const html = render(Review,{props:{entries,checked:entries.filter(row=>!row.error).map(row=>row.serverId)}}).body;
 expect(html).toContain('Renamed ID: local_2'); expect(html).toContain('Local (2)');
 expect(html).toContain('args must be an array'); expect(html).toContain('disabled');
 expect(html.match(/ checked/g)).toHaveLength(2);
 expect(html).toContain('command'); expect(html).toContain('https://mcp.example.test/mcp');
 expect(html).not.toContain('synthetic-env'); expect(html).not.toContain('synthetic-bearer');
 expect(html).not.toContain('<form');
 } finally {await vite.close();}
},20_000);
