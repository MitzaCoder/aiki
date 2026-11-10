import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	DEMO_PROJECT,
	emulatorPorts,
	prepareEmulators,
	relayRoot,
	requireFreePorts,
	spawnEmulators,
} from "./emulator-launch";
import { startFakeFcm } from "./fake-fcm";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--minutes")) throw new Error("Expected --minutes <1..120>");
const minutes = args.length ? Number(args[1]) : 30;
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new Error("Expected --minutes <1..120>");
const ports = emulatorPorts();
requireFreePorts(ports);
const state = resolve(relayRoot, `.emulator/stack-${ports.functions}`);
mkdirSync(state, { recursive: true, mode: 0o700 });
const captureFile = resolve(state, `captured-${Date.now()}-${process.pid}.jsonl`);
const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.once(signal, () => stop.abort());
const timer = setTimeout(() => stop.abort(), minutes * 60_000);
let launcher: ReturnType<typeof spawnEmulators> | undefined;
let seed: ReturnType<typeof Bun.spawn> | undefined;
const server = startFakeFcm(ports.fcm, captureFile);
try {
	// Build through a scrubbed environment too; demo callers need not remember a separate build command.
	const { environment } = prepareEmulators(ports);
	const build = Bun.spawn(
		[
			"env",
			"-i",
			...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
			process.execPath,
			"run",
			"build",
		],
		{ cwd: relayRoot, stdout: 2, stderr: "inherit", stdin: "ignore", timeout: 30_000 },
	);
	if ((await build.exited) !== 0) throw new Error("Demo build failed");
	stop.signal.throwIfAborted();
	launcher = spawnEmulators("demo", minutes, true);
	const base = `http://127.0.0.1:${ports.functions}/${DEMO_PROJECT}/us-central1/relay/v1/`;
	const deadline = Date.now() + 90_000;
	while (true) {
		stop.signal.throwIfAborted();
		if (launcher.child.exitCode !== null) throw new Error("Emulators exited before readiness");
		if (Date.now() >= deadline) throw new Error("Emulator readiness deadline exceeded");
		try {
			const reply = await fetch(base + "accounts/status", {
				signal: AbortSignal.any([stop.signal, AbortSignal.timeout(1500)]),
			});
			if (reply.status === 405 && ((await reply.json()) as { error?: string }).error === "method_not_allowed") break;
		} catch {
			stop.signal.throwIfAborted();
		}
		await Bun.sleep(250);
	}
	seed = Bun.spawn(
		[
			"env",
			"-i",
			...Object.entries({
				...launcher.environment,
				FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${ports.auth}`,
				FIRESTORE_EMULATOR_HOST: `127.0.0.1:${ports.firestore}`,
			}).map(([key, value]) => `${key}=${value}`),
			process.execPath,
			resolve(relayRoot, "tools/demo-seed.ts"),
		],
		{ cwd: relayRoot, stdout: 2, stderr: "inherit", stdin: "ignore", timeout: 20_000 },
	);
	const abortSeed = () => seed?.kill("SIGTERM");
	stop.signal.addEventListener("abort", abortSeed, { once: true });
	try {
		if ((await seed.exited) !== 0) throw new Error("Demo control seed failed");
	} finally {
		stop.signal.removeEventListener("abort", abortSeed);
	}
	stop.signal.throwIfAborted();
	const ready = {
		pid: process.pid,
		projectId: DEMO_PROJECT,
		databaseId: launcher.environment.RELAY_DATABASE_ID,
		functionBaseUrl: base,
		authEmulatorHost: `127.0.0.1:${ports.auth}`,
		firestoreHost: `127.0.0.1:${ports.firestore}`,
		fakeFcmUrl: `http://127.0.0.1:${ports.fcm}`,
		captureFile,
	};
	writeFileSync(resolve(state, "ready.json"), JSON.stringify(ready) + "\n", { mode: 0o600 });
	console.log(JSON.stringify(ready));
	await Promise.race([
		new Promise<void>((resolve) => stop.signal.addEventListener("abort", () => resolve(), { once: true })),
		launcher.child.exited.then(() => {
			throw new Error("Emulators exited unexpectedly");
		}),
	]);
} catch (error) {
	if (!stop.signal.aborted) {
		console.error(error instanceof Error ? error.message : "Demo failed");
		process.exitCode = 1;
	}
} finally {
	clearTimeout(timer);
	if (seed && seed.exitCode === null) {
		seed.kill("SIGTERM");
		await seed.exited;
	}
	if (launcher && launcher.child.exitCode === null) {
		// The CLI owns Java/functions/hub children; a single SIGTERM invokes its cleanShutdown, never a broad pkill.
		launcher.child.kill("SIGTERM");
		await launcher.child.exited;
	}
	await server.stop(true);
}
