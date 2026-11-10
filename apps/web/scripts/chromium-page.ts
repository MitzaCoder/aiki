export type ScreencastFrame = { data: string; sessionId: number; metadata: { timestamp: number } };
type CDPMessage = {
	id?: number;
	method?: string;
	params?: ScreencastFrame;
	result?: unknown;
	error?: { message: string };
};

/** Bounded CDP requests to one page in a dedicated, already-running test browser. */
export class ChromiumPage {
	#sequence = 0;
	#pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	onFrame?: (frame: ScreencastFrame) => void;
	constructor(readonly socket: WebSocket) {
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data)) as CDPMessage;
			if (message.method === "Page.screencastFrame" && message.params) this.onFrame?.(message.params);
			if (message.id === undefined) return;
			const request = this.#pending.get(message.id);
			if (!request) return;
			clearTimeout(request.timer);
			this.#pending.delete(message.id);
			if (message.error) request.reject(new Error(JSON.stringify(message.error)));
			else request.resolve(message.result);
		};
	}
	/** Send one protocol call and reject after ten seconds, never hang a proof run. */
	async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
		return new Promise<unknown>((resolve, reject) => {
			const id = ++this.#sequence;
			this.#pending.set(id, {
				resolve,
				reject,
				timer: setTimeout(() => {
					this.#pending.delete(id);
					reject(new Error(method + " timeout"));
				}, 10_000),
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		}) as Promise<T>;
	}
	/** Evaluate an expression with an eight-second execution limit and surface page exceptions. */
	async evaluate<T = unknown>(expression: string): Promise<T> {
		const response = await this.call<{ exceptionDetails?: unknown; result: { value: T } }>("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			timeout: 8000,
		});
		if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
		return response.result.value;
	}
	/** Serialize a self-contained typed callback into the page without importing test code into the shipped app. */
	run<Args extends unknown[], Result>(callback: (...args: Args) => Result, ...args: Args): Promise<Awaited<Result>> {
		return this.evaluate(`(${callback.toString()})(...${JSON.stringify(args)})`);
	}
	/** Detach this test connection without shutting down an unrelated browser process. */
	close(): void {
		this.socket.close();
	}
}

/** Attach to the first page on an explicitly selected loopback CDP endpoint, within three seconds. */
export async function connectChromiumPage(cdp: string): Promise<ChromiumPage> {
	const targets = (await fetch(cdp + "/json", { signal: AbortSignal.timeout(3000) }).then((response) =>
		response.json(),
	)) as {
		type: string;
		webSocketDebuggerUrl: string;
	}[];
	const target = targets.find((target) => target.type === "page");
	if (!target) throw new Error("No test Chromium page");
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("CDP connection timeout")), 3000);
		socket.onopen = () => {
			clearTimeout(timer);
			resolve();
		};
		socket.onerror = reject;
	});
	return new ChromiumPage(socket);
}
