/** Legacy MCP HTTP+SSE, for explicitly imported SSE definitions. No reconnect/replay. */
import { parseJsonRpcMessage, type JsonRpcMessage, type McpTransport, type McpTransportSendOptions } from '@earendil-works/pi-mcp';
export class McpSseTransport implements McpTransport {
 readonly #url: URL;
 readonly #token: () => Promise<string | undefined>;
 readonly #abort = new AbortController();
 readonly #messages = new Set<(message: JsonRpcMessage) => void>();
 readonly #errors = new Set<(error: Error) => void>();
 readonly #closes = new Set<() => void>();
 #endpoint?: URL;
 #stream?: Promise<void>;
 #closed = false;
 constructor(url: string, token: () => Promise<string | undefined>) { this.#url = new URL(url); this.#token = token; }
 onMessage(listener: (message: JsonRpcMessage) => void) { this.#messages.add(listener); return () => { this.#messages.delete(listener); }; }
 onError(listener: (error: Error) => void) { this.#errors.add(listener); return () => { this.#errors.delete(listener); }; }
 onClose(listener: () => void) { this.#closes.add(listener); return () => { this.#closes.delete(listener); }; }
 async #headers(): Promise<Record<string, string>> { const token = await this.#token(); return token ? { authorization: `Bearer ${token}` } : {}; }
 async start(): Promise<void> {
 let ready!: () => void; let reject!: (error: Error) => void;
 const endpoint = new Promise<void>((resolve, fail) => { ready = resolve; reject = fail; });
 const timer = setTimeout(() => { reject(new Error('MCP SSE endpoint timeout')); this.#abort.abort(); }, 10_000);
 this.#stream = (async () => {
 const response = await fetch(this.#url, { headers: { ...await this.#headers(), accept: 'text/event-stream' }, redirect: 'error', signal: this.#abort.signal });
 if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new Error('MCP SSE connection failed');
 const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let event = ''; let data: string[] = []; let eventBytes = 0;
 try {
 for (;;) {
 const chunk = await reader.read(); if (chunk.done) break;
 buffer += decoder.decode(chunk.value, { stream: true });
 if (buffer.length > 2 * 1024 * 1024) throw new Error('MCP SSE frame too large');
 let newline: number;
 while ((newline = buffer.indexOf('\n')) >= 0) {
 const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
 if (!line) {
 const payload = data.join('\n');
 if (event === 'endpoint') {
 const target = new URL(payload, this.#url);
 if (target.origin !== this.#url.origin || target.username || target.password || target.hash) throw new Error('MCP SSE endpoint origin refused');
 this.#endpoint = target; ready();
 } else if (event === 'message' && payload) { const message = parseJsonRpcMessage(JSON.parse(payload)); for (const listener of this.#messages) listener(message); }
 event = ''; data = []; eventBytes = 0;
 } else if (line.startsWith('event:')) event = line.slice(6).trim();
 else if (line.startsWith('data:')) { eventBytes += line.length; if (eventBytes > 2 * 1024 * 1024) throw new Error('MCP SSE message too large'); data.push(line.slice(5).replace(/^ /, '')); }
 }
 }
 } finally { await reader.cancel().catch(() => undefined); }
 if (!this.#closed) throw new Error('MCP SSE stream closed');
 })().catch(() => {
 reject(new Error('MCP SSE connection failed'));
 if (!this.#closed) for (const listener of this.#errors) listener(new Error('MCP SSE connection failed'));
 }).finally(() => { this.#emitClose(); });
 try { await endpoint; } finally { clearTimeout(timer); }
 }
 async send(message: JsonRpcMessage, options?: McpTransportSendOptions): Promise<void> {
 if (this.#closed || !this.#endpoint) throw new Error('MCP SSE disconnected');
 options?.signal?.throwIfAborted();
 const response = await fetch(this.#endpoint, { method: 'POST', headers: { ...await this.#headers(), 'content-type': 'application/json' }, body: JSON.stringify(message), redirect: 'error', signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(15_000), ...(options?.signal ? [options.signal] : [])]) });
 await response.body?.cancel(); if (!response.ok) throw new Error('MCP SSE send failed');
 }
 #emitClose() { if (this.#closed) return; this.#closed = true; for (const listener of this.#closes) listener(); }
 async close(): Promise<void> { this.#abort.abort(); await this.#stream; this.#emitClose(); }
}
