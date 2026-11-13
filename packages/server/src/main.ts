import { resolveDataDir, resolveHostname, resolvePort } from "./data-dir.ts";
import { ALLOWED_ORIGINS_ENV } from "./origins.ts";
import { loadServerEnv, resolvedServerConfig } from "./server-env.ts";
import { configureServerSettings, serverSettings } from "./server-settings.ts";

export async function runServerEntry(
	settings: Readonly<Record<string, string | undefined>> = loadServerEnv(),
	args: readonly string[] = process.argv.slice(2),
): Promise<void> {
	configureServerSettings(settings);
	if (args.includes("--print-config")) {
		console.log(JSON.stringify(resolvedServerConfig(), null, 2));
		return;
	}
	if (args[0] === "auth") {
		// The owner CLI reads the same private env file, so it reaches the same data directory and socket.
		const { runAuthCli } = await import("./device-auth-cli.ts");
		await runAuthCli(args.slice(1));
	} else {
		// Import only after the private env file: persistent identities are registered at module initialization.
		const { startServer } = await import("./server.ts");
		const server = await startServer({
			dataDir: resolveDataDir(),
			hostname: resolveHostname(),
			port: resolvePort(),
			...(serverSettings.KEMIRI_WEB_DIR ? { webDir: serverSettings.KEMIRI_WEB_DIR } : {}),
		});

		const origins =
			server.allowedOrigins.length === 0
				? `none from a browser (${ALLOWED_ORIGINS_ENV} unset); native clients still need device auth when required`
				: server.allowedOrigins.join(", ");
		console.log(`Kemiri listening on ${server.url} (data: ${server.dataDir}; browser origins: ${origins})`);

		let stopping = false;
		async function stop(signal: string): Promise<void> {
			if (stopping) return;
			stopping = true;
			console.log(`Kemiri: ${signal}, closing`);
			try {
				await server.stop();
				process.exit(0);
			} catch (error) {
				console.error("Kemiri: shutdown failed", error);
				process.exit(1);
			}
		}

		for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void stop(signal));
	}

}

if (import.meta.main) await runServerEntry();
