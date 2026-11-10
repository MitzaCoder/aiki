/**
 * Caps how long the coordinator's own tool calls may run, so a slow or polling command — `bash` above all — can never
 * keep the coordinator unreachable: the user submits messages to it while it runs, and a turn that never ends is a turn
 * the user cannot interrupt with anything but Abort. Workers keep running as long as they like: only long-lived work
 * belongs on them, and nobody is waiting on one turn of theirs the way the user waits on the coordinator.
 *
 * Implemented as an extension that wraps the named tools (`bash`, `powershell`) with a hard wall-clock timeout, derived
 * from the call's own `Context` with `withCancel()`: the wrapped tool gets a context that aborts on whichever comes
 * first, the cap timer or the caller's own cancellation (Esc, a conversation abort). Only the timer firing first is
 * ours to report; an outer cancellation is left to the ordinary abort message, so the Abort button's wording is
 * unchanged. The extension is installed like any other and removed for workers the same way memory and compaction are
 * (`WorkerService.removedExtensions`), so this is the one place the cap applies.
 */
import { withCancel } from "@earendil-works/chord/context";
import { defineExtension, type Extension, type ToolExecutionResult, type ToolRegistration, type Wrap } from "@earendil-works/pi-durable";

export const TOOL_CAP_EXTENSION_NAME = "coordinator-tool-caps";

/** Long enough for a real command; short enough that the coordinator never looks stuck to the user waiting on it. */
export const DEFAULT_TOOL_CALL_CAP_MS = 2 * 60_000;

/** Minutes, so the number in the environment reads naturally; `AIKI_TOOL_CALL_CAP_MINUTES` overrides it. */
export const TOOL_CALL_CAP_MINUTES_ENV = "AIKI_TOOL_CALL_CAP_MINUTES";

/**
 * The tools this cap wraps. Every other tool the coordinator has keeps running as long as it likes. `codemode` is
 * capped as a whole call, on top of the nested `bash`/`powershell` calls a script makes, which are already wrapped
 * here too: `resolveAgent()` applies every extension's wraps before filtering by `callers`, so a script's nested call
 * resolves the same capped tool a direct model call would.
 */
const CAPPED_TOOLS = ["bash", "powershell", "codemode"] as const;

/** `AIKI_TOOL_CALL_CAP_MINUTES` when it names a positive number of minutes, else the default. */
export function resolveToolCallCapMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
	const raw = env[TOOL_CALL_CAP_MINUTES_ENV];
	if (raw === undefined || raw.trim().length === 0) return DEFAULT_TOOL_CALL_CAP_MS;
	const minutes = Number(raw);
	return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : DEFAULT_TOOL_CALL_CAP_MS;
}

/** The error message the model sees when a call is stopped for running past the cap. */
export function toolCapMessage(toolName: string, capMs: number): string {
	const minutes = capMs % 60_000 === 0 ? `${capMs / 60_000} minute${capMs === 60_000 ? "" : "s"}` : `${Math.round(capMs / 1000)}s`;
	return (
		`${toolName} was stopped after running past its ${minutes} cap. The coordinator must stay responsive to the user, ` +
		"so it never waits out a long command itself. Delegate long-running work — a CI watch, a long build or test run, " +
		"any kind of wait or poll — to a worker with worker_spawn, or to a schedule with schedule_save for something " +
		"recurring, then end this turn; review the report when it arrives instead of blocking on it."
	);
}

function capResult(toolName: string, capMs: number): ToolExecutionResult {
	return {
		output: [],
		isError: true,
		diagnostics: [{ severity: "error", code: "tool_call_capped", message: toolCapMessage(toolName, capMs) }],
	};
}

/** Wraps `tool.execute` with a hard wall-clock cap, distinguishing its own timeout from an outer cancellation. */
function capExecution<Tool extends ToolRegistration>(tool: Tool, capMs: number): Tool {
	return {
		...tool,
		async execute(args, api, context) {
			const { context: capped, cancel } = withCancel(context);
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				cancel(new Error(`${tool.name} exceeded its ${capMs}ms cap`));
			}, capMs);
			try {
				return await tool.execute(args, api, capped);
			} catch (error) {
				// The outer context was already aborted (Esc, conversation.abort): let the ordinary abort path report it.
				if (timedOut && context.abortSignal?.aborted !== true) return capResult(tool.name, capMs);
				throw error;
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/**
 * The extension that wraps `bash` and `powershell` with the cap. Installed for every conversation by default, like
 * `coding-tools`; a worker removes it by name through `WorkerService.removedExtensions`, so it keeps its own, longer
 * timeouts.
 */
export function createToolCapExtension(options?: { capMs?: number }): Extension {
	const capMs = options?.capMs ?? DEFAULT_TOOL_CALL_CAP_MS;
	const wraps: Wrap[] = CAPPED_TOOLS.map((name) => ({
		tool: name,
		wrap: (tool: ToolRegistration) => capExecution(tool, capMs),
	}));
	return defineExtension({ name: TOOL_CAP_EXTENSION_NAME, wraps });
}
