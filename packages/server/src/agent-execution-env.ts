import type { Context } from "@earendil-works/chord/context";
import type { ShellExecOptions } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { childEnvironment } from "./child-environment.ts";

/** Shared by coordinators, workers, threads and schedules, including nested codemode tool calls. */
export class AgentExecutionEnv extends NodeExecutionEnv {
	override exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context) {
		// shellEnv alone is insufficient: pi merges process.env back in unless inheritEnv is false.
		return super.exec(command, {
			...options,
			env: childEnvironment({ ...(options?.inheritEnv === false ? {} : process.env), ...options?.env }),
			inheritEnv: false,
		}, context);
	}
}
