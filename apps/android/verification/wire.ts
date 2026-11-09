import { Value } from "../../../packages/protocol/node_modules/typebox/build/value/index.mjs";
import { ClientMessageSchema, ServerMessageSchema } from "../../../packages/protocol/src/index.ts";
/** Small bounded verification client; validates every response AND push against final contracts. */
export async function connect(url: string, options: { validateRequests?: boolean } = {}) {
	const socket = new WebSocket(`${url.replace(/^http/, "ws")}/ws`);
	const events: any[] = [];
	const requests: any[] = [];
	const pending = new Map<
		string,
		{
			resolve: (v: any) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	let sequence = 0;
	socket.addEventListener("message", (event) => {
		const value = JSON.parse(String(event.data));
		const p = pending.get(value.id);
		if (!Value.Check(ServerMessageSchema, value)) {
			const error = new Error(
				`Invalid server wire schema for ${value.type ?? "unknown"} (payload omitted: may contain signed URLs)`,
			);
			for (const item of pending.values()) {
				clearTimeout(item.timer);
				item.reject(error);
			}
			pending.clear();
			socket.close();
			return;
		}
		events.push(value);
		if (p) {
			clearTimeout(p.timer);
			if ("id" in value && value.id) pending.delete(value.id);
			p.resolve(value);
		}
	});
	socket.addEventListener("close", () => {
		for (const p of pending.values()) {
			clearTimeout(p.timer);
			p.reject(new Error("Socket closed"));
		}
		pending.clear();
	});
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener(
			"error",
			() => reject(new Error("WebSocket failed")),
			{ once: true },
		);
	});
	return {
		events,
		requests,
		request(type: string, fields: Record<string, unknown> = {}): Promise<any> {
			const id = `verify-${++sequence}`;
			const message = { ...fields, type, id };
			if (options.validateRequests && !Value.Check(ClientMessageSchema, message))
				return Promise.reject(new Error(`Invalid request wire schema: ${type}`));
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`Timed out: ${type}`));
				}, 10_000);
				pending.set(id, { resolve, reject, timer });
				requests.push(message);
				socket.send(JSON.stringify(message));
			});
		},
		close() {
			socket.close();
		},
	};
}
