/** One executable for standalone use and the shared installed lifecycle CLI. */
import { installedCliRequested, runInstalledCli } from "../../../scripts/aiki.ts";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { registerLazyBedrockProvider } from "@earendil-works/pi-ai/lazy-bedrock-provider";
import { packagedResources } from "./packaged-resources.ts";
import { loadServerEnv, resolvedServerConfig } from "./server-env.ts";
import { runServerEntry } from "./main.ts";
import { join } from "node:path";

registerBunOAuthFlows();
registerLazyBedrockProvider();

export async function runBinaryEntry(args = process.argv.slice(2)): Promise<void> {
	if (args[0] === "--kemiri-version") { console.log(`Kemiri ${packagedResources.release?.name ?? "development"}\nBun ${Bun.version}`); return; }
	if (installedCliRequested(args)) return runInstalledCli(args);
	const loaded = loadServerEnv();
	const settings = { ...loaded, KEMIRI_WEB_DIR: loaded.AIKI_WEB_DIR || "embedded", AIKI_WEB_DIR: loaded.AIKI_WEB_DIR || "embedded" };
	const [command = "start", ...rest] = args;
	if (command === "version" || command === "--version") {
		console.log(`${packagedResources.legacyVersionProbe ? "Aiki" : "Kemiri"} ${packagedResources.release?.name ?? "development"}\nBun ${Bun.version}`);
	} else if (command === "status" || command === "health-check") {
		if (loaded.AIKI_CHILD_PROCESS === "1" && !loaded.AIKI_ENV_FILE?.trim() && !loaded.AIKI_DATA_DIR?.trim()) {
			throw new Error("Owner CLI from an agent requires explicit AIKI_ENV_FILE or AIKI_DATA_DIR");
		}
		const config = resolvedServerConfig(settings);
		for (const type of ["hello", "server.status"]) {
			const response = await fetch("http://localhost/", {
				unix: join(config.dataDir, "auth.sock"), method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ args: ["health-check", JSON.stringify({ type, id: "binary-health", protocolVersion: 1 })] }),
				signal: AbortSignal.timeout(5000),
			});
			const result = await response.json() as { answer?: { type?: string }; loopbackOrigin?: string };
			if (!response.ok || result.answer?.type !== type) throw new Error(`Backend health check failed (${type})`);
			if (type === "server.status") console.log(command === "status" ? `Running at ${result.loopbackOrigin}` : JSON.stringify(result));
		}
	} else if (command === "auth") await runServerEntry(settings, ["auth", ...rest]);
	else if (command === "pair") await runServerEntry(settings, ["auth", "pair", "--local", ...rest]);
	else if (command === "start" || command === "--print-config") {
		const config = resolvedServerConfig(settings);
		if (command === "start") console.log(`Kemiri data: ${config.dataDir}\nKemiri config: ${config.configDir}`);
		await runServerEntry(settings, command === "start" ? rest : args);
	} else throw new Error("Usage: kemiri start|status|health-check|version|pair|auth [arguments]\nInstaller lifecycle commands are provided by the installed launcher.");
}

if (import.meta.main) {
	try { await runBinaryEntry(); }
	catch (error) { console.error(`kemiri: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}
