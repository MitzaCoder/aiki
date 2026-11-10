import { resolveDataDir, resolveHostname, resolvePort } from "./data-dir.ts";
import { ALLOWED_ORIGINS_ENV } from "./origins.ts";
import { startServer } from "./server.ts";

const server = await startServer({
	dataDir: resolveDataDir(),
	hostname: resolveHostname(),
	port: resolvePort(),
});

const origins =
	server.allowedOrigins.length === 0
		? `none from a browser (${ALLOWED_ORIGINS_ENV} unset); non-browser clients are allowed`
		: server.allowedOrigins.join(", ");
console.log(
	`aiki listening on ${server.url} (data: ${server.dataDir}; browser origins: ${origins})`,
);

let stopping = false;
async function stop(signal: string): Promise<void> {
	if (stopping) return;
	stopping = true;
	console.log(`aiki: ${signal}, closing`);
	try {
		await server.stop();
		process.exit(0);
	} catch (error) {
		console.error("aiki: shutdown failed", error);
		process.exit(1);
	}
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void stop(signal));
