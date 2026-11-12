/** Pure, side-effect-free import review. Secrets stay in the caller's transient state. */
import type { McpCommand } from './mcp.ts';
export type McpImportRow = {
 name: string; serverId: string; kind: 'command' | 'http'; target: string;
 transport?: 'sse'; command?: McpCommand; env?: Record<string, string>; url?: string; token?: string;
 error?: string; renamed: boolean;
};
export function mcpImportId(name: string, taken: readonly string[]): string {
 const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30).replace(/_+$/g, '') || 'server';
 const stem = /^[a-z]/.test(base) ? base : `server_${base}`;
 let id = stem; for (let n = 2; taken.includes(id); n++) id = `${stem}_${n}`;
 return id;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function parseMcpImport(text: string, taken: readonly string[] = []): McpImportRow[] {
 if (text.length > 262144) throw new Error('Import is limited to 256 KiB');
 let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
 if (!record(parsed)) throw new Error('Expected a server map');
 const map = parsed.mcpServers ?? parsed;
 if (!record(map)) throw new Error('mcpServers must be a server map');
 if (Object.keys(map).length > 100) throw new Error('Import is limited to 100 servers');
 const used = [...taken];
 return Object.entries(map).map(([name, entry]) => {
 const serverId = mcpImportId(name, used); used.push(serverId);
 const renamed = serverId !== mcpImportId(name, []);
 const row: McpImportRow = { name: renamed ? `${name.slice(0,110)} (${serverId.split('_').at(-1)})` : name, serverId, kind: record(entry) && 'command' in entry ? 'command' : 'http', target: '', renamed: serverId !== mcpImportId(name, []) };
 try {
 if (!name.trim() || name.length > 120) throw new Error('Name must be 1–120 characters');
 if (!record(entry)) throw new Error('Expected a server object');
 if ('command' in entry) {
 if ('url' in entry) throw new Error('Choose command or URL, not both');
 if (typeof entry.command !== 'string' || !entry.command.trim() || entry.command.includes('\0')) throw new Error('Command must be a non-empty executable');
 const args = entry.args ?? [];
 if (!Array.isArray(args) || args.length > 256 || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('args must be an array of strings');
 if (entry.cwd !== undefined && (typeof entry.cwd !== 'string' || !entry.cwd.startsWith('/') || entry.cwd.includes('\0'))) throw new Error('cwd must be an absolute path');
 if (entry.env !== undefined && (!record(entry.env) || Object.entries(entry.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.startsWith('AIKI_') || typeof value !== 'string' || value.includes('\0')))) throw new Error('env must contain valid variable names and string values (no AIKI_* settings)');
 row.command = { command: entry.command, args, ...(entry.cwd ? { cwd: entry.cwd as string } : {}) };
 row.env = (entry.env ?? {}) as Record<string, string>;
 row.target = JSON.stringify([entry.command, ...args]);
 } else {
 if (entry.type !== undefined && !['http', 'sse', 'streamable-http'].includes(String(entry.type))) throw new Error('Unsupported transport type');
 if (entry.type === 'sse') row.transport = 'sse';
 if (typeof entry.url !== 'string') throw new Error('Missing URL');
 let url: URL; try { url = new URL(entry.url); } catch { throw new Error('Invalid URL'); }
 if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('URL requires HTTPS (except loopback), no credentials, query or fragment');
 row.url = url.href; row.target = url.href;
 if (entry.headers !== undefined) {
 if (!record(entry.headers)) throw new Error('headers must be an object');
 for (const [key, value] of Object.entries(entry.headers)) {
 if (key.toLowerCase() !== 'authorization' || typeof value !== 'string' || !/^Bearer [^\r\n]+$/i.test(value)) throw new Error('Only Authorization: Bearer headers can be imported');
 row.token = value.slice(7);
 }
 }
 }
 } catch (error) { row.error = error instanceof Error ? error.message : 'Invalid entry'; row.target = row.kind === 'command' ? 'Invalid command' : 'Invalid URL'; }
 return row;
 });
}
