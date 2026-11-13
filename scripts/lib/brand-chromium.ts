/** Minimal owned Chromium/CDP session for deterministic brand rasterization. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function brandChromium() {
	const binary = process.env.CHROMIUM_BIN ?? Bun.which("chromium");
	if (!binary) throw new Error("Chromium is required (set CHROMIUM_BIN)");
	const profile = await mkdtemp(join(tmpdir(), "kemiri-brand-chromium-"));
	const browser = Bun.spawn([binary, "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore", detached: true });
	const stopBrowser = () => {
		try { process.kill(-browser.pid, "SIGKILL"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
	};
	let port = "";
	for (let attempt = 0; attempt < 200; attempt++) {
		try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]!; break; }
		catch { await Bun.sleep(50); }
	}
	if (!port) { stopBrowser(); await browser.exited; await rm(profile, { recursive: true, force: true }); throw new Error("Chromium startup timed out"); }
	const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { webSocketDebuggerUrl: string }[];
	const socket = new WebSocket(pages[0]!.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = reject; });
	let sequence = 0;
	const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	socket.onmessage = (event) => {
		const message = JSON.parse(String(event.data));
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		if (message.error) request.reject(new Error(JSON.stringify(message.error)));
		else request.resolve(message.result);
	};
	async function send(method: string, params: object = {}): Promise<any> {
		const id = ++sequence;
		return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
	}
	return {
		send,
		async evaluate(expression: string) {
			const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
			if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
			return reply.result.value;
		},
		async close() { socket.close(); stopBrowser(); await browser.exited; await rm(profile, { recursive: true, force: true }); },
	};
}
