/**
 * Lets a deploy restart the server between tool calls instead of waiting for every conversation and worker to go idle.
 *
 * `server.drain` starts a drain: until it ends (the timeout passes, `timeoutMs: 0` ends it, or the process stops) every
 * new tool call a model makes, in every conversation of every project, waits before it starts, so the number of calls
 * executing (`server.status.busy.toolCalls`) can only fall. The deploy restarts once it is 0. Generation in progress is
 * interrupted by the restart and asked again afterwards; that is cheap and loses nothing.
 *
 * Where the call waits is what makes the restart safe. pi-durable's tool task runs `beforeTool` hooks, then commits the
 * call's intent (phase `execute`), then calls `execute()`; a process that dies after the intent reruns the call only
 * when the tool is `replay: "safe"` and otherwise answers the model with an `interrupted` error. The wait is a
 * `beforeTool` hook, before the intent: a held call has not started as far as the Harness knows, its task is still in
 * phase `call`, and after the restart it runs from the beginning like a call that was never held. A close of the
 * Harness aborts the hook's context, which ends the wait with an abort the tool task rethrows and records nothing for.
 *
 * Only calls the model made are held. Calls a running tool makes through `executeTool()` (a code mode script's) are
 * not: holding them would keep their caller running, and the count with it, until the drain timed out. They are not
 * counted either; the script's own call covers them.
 *
 * The count wraps the `execute()` of every tool installed in a project's registry, so it measures exactly the time a
 * call runs, whatever ends it: a result, a throw or an abort.
 */
import type { Context } from "@earendil-works/chord/context";
import { defineExtension, hook, ToolTask, type Extension, type ToolRegistration, type Wrap } from "@earendil-works/pi-durable";
import { DEFAULT_DRAIN_TIMEOUT_MS } from "@mihai-harness/protocol";

export const DRAIN_EXTENSION_NAME = "server-drain";

export type ToolCallDrainOptions = {
	now?: () => number;
	log?: (message: string) => void;
};

/** One per server: the drain and the count span every project's runtime. */
export class ToolCallDrain {
	readonly #now: () => number;
	readonly #log: (message: string) => void;
	/** Calls the model made whose `execute()` is running now. */
	#executing = 0;
	/** Nested calls seen by the hook and not executed yet, by call ID, so the wrap leaves them out of the count. */
	readonly #nested = new Set<string>();
	#until: number | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** Resolves when the current drain ends; undefined while not draining. */
	#ended: Promise<void> | undefined;
	#end: (() => void) | undefined;

	constructor(options: ToolCallDrainOptions = {}) {
		this.#now = options.now ?? Date.now;
		this.#log = options.log ?? ((message) => console.log(message));
	}

	/** Tool calls the model made that are executing now, across every conversation. */
	get toolCalls(): number {
		return this.#executing;
	}

	/** When the drain ends unless extended, or undefined when not draining. */
	get drainingUntil(): number | undefined {
		return this.#until;
	}

	/** Start a drain, or extend the current one to `timeoutMs` from now; 0 or less ends it. */
	drain(timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS): void {
		if (timeoutMs <= 0) {
			this.end();
			return;
		}
		if (this.#ended === undefined) {
			this.#ended = new Promise((resolve) => {
				this.#end = resolve;
			});
			this.#log(`drain: holding new tool calls for ${Math.round(timeoutMs / 1000)}s; ${this.#executing} executing`);
		}
		this.#until = this.#now() + timeoutMs;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#log("drain: timed out; releasing held tool calls");
			this.end();
		}, timeoutMs);
	}

	/** End the drain: held calls start now. */
	end(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#until = undefined;
		const end = this.#end;
		this.#ended = undefined;
		this.#end = undefined;
		end?.();
	}

	/**
	 * The server is stopping: drop the timer without releasing anything, so no held call starts during the shutdown. The
	 * Harness close aborts the held calls' hooks, and they run after the restart.
	 */
	stop(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	/** Wait while draining; an aborted context (the conversation's abort, the Harness closing) ends the wait. */
	async hold(context: Context): Promise<void> {
		while (this.#ended !== undefined) await untilAborted(this.#ended, context.abortSignal);
	}

	/** The hook that holds and the wraps that count, for every tool named in `toolNames`. Install it last. */
	extension(toolNames: Iterable<string>): Extension {
		const wraps: Wrap[] = [...new Set(toolNames)].map((name) => ({
			tool: name,
			wrap: (tool: ToolRegistration) => this.#counted(tool),
		}));
		return defineExtension({
			name: DRAIN_EXTENSION_NAME,
			wraps,
			hooks: [
				hook(ToolTask, {
					beforeTool: async (call, _api, context) => {
						if (call.parent !== undefined) {
							this.#nested.add(call.id);
							return undefined;
						}
						await this.hold(context);
						return undefined;
					},
				}),
			],
		});
	}

	#counted<Tool extends ToolRegistration>(tool: Tool): Tool {
		return {
			...tool,
			execute: async (args, api, context) => {
				// A replay-safe call rerun after a restart skips the hook; it is not nested then, so it is counted.
				const nested = this.#nested.delete(api.callId);
				if (!nested) this.#executing += 1;
				try {
					return await tool.execute(args, api, context);
				} finally {
					if (!nested) this.#executing -= 1;
				}
			},
		};
	}
}

/** `promise`, or a rejection with the signal's reason once it aborts. */
function untilAborted(promise: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
	if (signal === undefined) return promise;
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const onAbort = (): void => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}
