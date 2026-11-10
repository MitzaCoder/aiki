import { resolveDataDir, resolveHostname, resolvePort } from "./data-dir.ts";
import { ALLOWED_ORIGINS_ENV } from "./origins.ts";
import { loadServerEnv, resolvedServerConfig } from "./server-env.ts";
import { configureServerSettings, serverSettings } from "./server-settings.ts";

configureServerSettings(loadServerEnv());
if (process.argv.includes("--print-config")) {
	console.log(JSON.stringify(resolvedServerConfig(), null, 2));
	process.exit(0);
}
if (process.argv[2] === "auth") {
	// The owner CLI reads the same private env file, so it reaches the same data directory and socket.
	const { runAuthCli } = await import("./device-auth-cli.ts");
	await runAuthCli(process.argv.slice(3));
} else {
	// Import only after the private env file: persistent identities are registered at module initialization.
	const { startServer } = await import("./server.ts");
	const server = await startServer({
		dataDir: resolveDataDir(),
		hostname: resolveHostname(),
		port: resolvePort(),
		...(serverSettings.AIKI_WEB_DIR ? { webDir: serverSettings.AIKI_WEB_DIR } : {}),
	});

	const origins =
		server.allowedOrigins.length === 0
			? `none from a browser (${ALLOWED_ORIGINS_ENV} unset); native clients still need device auth when required`
			: server.allowedOrigins.join(", ");
	console.log(`Aiki listening on ${server.url} (data: ${server.dataDir}; browser origins: ${origins})`);

	let stopping = false;
	async function stop(signal: string): Promise<void> {
		if (stopping) return;
		stopping = true;
		console.log(`Aiki: ${signal}, closing`);
		try {
			await server.stop();
			process.exit(0);
		} catch (error) {
			console.error("Aiki: shutdown failed", error);
			process.exit(1);
		}
	}

	for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void stop(signal));
}
