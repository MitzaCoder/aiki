/**
 * Code mode: a `codemode` tool that runs model-written JavaScript in a QuickJS sandbox
 * (`@earendil-works/pi-codemode`), calling the conversation's own tools as `await tools.<name>(args)`. Decided with
 * the user: on for the coordinator and every worker alike, always on (no setting), offered alongside the tools
 * themselves rather than replacing them — the model may call a tool directly or write a script.
 *
 * The sandbox is process-wide, not per-project: it only holds a worker-thread pool and the memory limit, and every
 * nested call still runs against the calling conversation's own tools through `api.executeTool()`. One instance is
 * created per `ProjectManager` (so a restart in tests gets a fresh one) and installed into every project's registry.
 *
 * `callers` on the model-only tools (`worker_spawn`, `worker_send`, `worker_stop`, `worker_forget`, `schedule_save`,
 * `schedule_delete`, `schedule_run`) keeps a script from starting or stopping work behind the model's back; the
 * reading tools (`worker_list`, `worker_peek`, `memory_*`, `history`, `schedule_list`) keep the default, so a script
 * may call them. The `codemode` tool itself is `callers: ["model"]` in pi-durable, so a script can never start
 * another script. `models: false` leaves the model catalog, `models.classify()` and `models.generateImages()` out:
 * they are not part of this harness's tool surface.
 */
import { CodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode";
import { packagedResources } from "./packaged-resources.ts";
import type { CodemodeNamespace } from "@earendil-works/pi-durable/codemode";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import type { Extension } from "@earendil-works/pi-durable";
import { flagOneCallScriptWrap } from "./codemode-wrap.ts";

/** Generous enough for a script that reads or searches a lot; small enough to bound one runaway process. */
export const DEFAULT_CODEMODE_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

/** Groups the coordinator's own tools in the `codemode` section, so a script finds them by what they do. */
const CODEMODE_NAMESPACES: CodemodeNamespace[] = [
	{ name: "workers", description: "List and inspect the project's workers.", prefix: "worker_" },
	{ name: "memory", description: "Search, read, write and archive durable memory.", prefix: "memory_" },
	{ name: "schedules", description: "List the project's scheduled tasks.", prefix: "schedule_" },
	{ name: "artifacts", description: "Keep files for the user as artifacts.", prefix: "artifact_" },
];

/** One sandbox per `ProjectManager`: a worker-thread pool shared by every project it opens, not per-project state. */
export function createCodemodeSandbox(options?: { memoryLimitBytes?: number }): CodemodeSandbox {
	return new CodemodeSandbox({
		memoryLimitBytes: options?.memoryLimitBytes ?? DEFAULT_CODEMODE_MEMORY_LIMIT_BYTES,
		...(packagedResources.quickjsWasm ? { wasm: loadQuickJSWasm(packagedResources.quickjsWasm) } : {}),
		...(packagedResources.codemodeWorker ? { workerUrl: packagedResources.codemodeWorker } : {}),
	});
}

/** The `codemode` extension: installed for the coordinator and every worker, and never removed for either. */
export function createHarnessCodemodeExtension(sandbox: CodemodeSandbox, namespaces: CodemodeNamespace[] = []): Extension {
	const extension = createCodemodeExtension({ sandbox, namespaces: [...CODEMODE_NAMESPACES, ...namespaces], models: false });
	return { ...extension, wraps: [...(extension.wraps ?? []), flagOneCallScriptWrap] };
}
