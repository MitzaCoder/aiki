import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_DATABASE_ID, requireDatabaseId } from "../src/database";

export const DEMO_PROJECT = "demo-aiki-relay";
export const relayRoot = resolve(import.meta.dir, "..");
export interface EmulatorPorts {
	auth: number;
	firestore: number;
	functions: number;
	hub: number;
	logging: number;
	websocket: number;
	fcm: number;
}

/** Accept only distinct high loopback port numbers; no project or host override is supported. */
export function emulatorPorts(): EmulatorPorts {
	const ports: EmulatorPorts = {
		auth: 19371,
		firestore: 19372,
		functions: 19373,
		hub: 19374,
		logging: 19375,
		websocket: 19376,
		fcm: 19377,
	};
	for (const key of Object.keys(ports) as (keyof EmulatorPorts)[]) {
		const override = process.env[`RELAY_${key.toUpperCase()}_PORT`];
		if (override !== undefined) ports[key] = Number(override);
		if (!Number.isInteger(ports[key]) || ports[key] < 1024 || ports[key] > 65535) throw new Error("Invalid port");
	}
	if (new Set(Object.values(ports)).size !== Object.values(ports).length) throw new Error("Ports must be distinct");
	return ports;
}

/** Fail before touching another stack's generated files if one of the requested ports is already bound. */
export function requireFreePorts(ports: EmulatorPorts, includeFcm = true): void {
	const sockets = Bun.spawnSync(["ss", "-ltn"], { timeout: 5000 });
	if (sockets.exitCode !== 0) throw new Error("Cannot check ports");
	if (
		Object.entries(ports).some(
			([key, port]) => (includeFcm || key !== "fcm") && new RegExp(`:${port}\\b`).test(sockets.stdout.toString()),
		)
	) {
		throw new Error("Emulator port occupied");
	}
}

/** Generate per-stack function/config/home state, never sharing a mutable .env.local between concurrent stacks. */
export function prepareEmulators(ports: EmulatorPorts) {
	const databaseId = requireDatabaseId(process.env.RELAY_DATABASE_ID ?? DEFAULT_DATABASE_ID);
	const shared = resolve(relayRoot, ".emulator");
	const state = resolve(shared, `stack-${ports.functions}`);
	for (const name of ["home/.cache", "config", "cache", "functions"])
		mkdirSync(resolve(state, name), { recursive: true });
	const cache = resolve(shared, "home/.cache/firebase");
	mkdirSync(cache, { recursive: true });
	const cacheLink = resolve(state, "home/.cache/firebase");
	if (!existsSync(cacheLink)) symlinkSync(cache, cacheLink, "dir");
	const environment: Record<string, string> = {
		PATH: process.env.PATH!,
		HOME: resolve(state, "home"),
		XDG_CONFIG_HOME: resolve(state, "config"),
		XDG_CACHE_HOME: resolve(state, "cache"),
		CI: "true",
		FIREBASE_CLI_DISABLE_ANALYTICS: "true",
		FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
		NO_UPDATE_NOTIFIER: "true",
		GCLOUD_PROJECT: DEMO_PROJECT,
		// Never probe a cloud metadata server: checks must run with loopback networking only.
		METADATA_SERVER_DETECTION: "none",
		RELAY_DATABASE_ID: databaseId,
		RELAY_TEST_FCM_PORT: String(ports.fcm),
		RELAY_DEMO_STATE: state,
	};
	for (const [key, value] of Object.entries(ports)) environment[`RELAY_${key.toUpperCase()}_PORT`] = String(value);
	const config = JSON.parse(readFileSync(resolve(relayRoot, "firebase.json"), "utf8"));
	for (const entry of Object.values(config.emulators) as { host?: string }[]) {
		if (entry.host !== undefined && entry.host !== "127.0.0.1") throw new Error("Loopback emulators required");
	}
	for (const key of ["auth", "firestore", "functions", "hub", "logging"] as const) {
		config.emulators[key].host = "127.0.0.1";
		config.emulators[key].port = ports[key];
	}
	config.emulators.firestore.websocketPort = ports.websocket;
	// Pinned CLI supports loading one rules file; named-database client IAM/rules need live acceptance.
	config.firestore.database = databaseId;
	config.emulators.ui = { enabled: false };
	config.functions.source = `.emulator/stack-${ports.functions}/functions`;
	const source = resolve(state, "functions");
	const packageJson = JSON.parse(readFileSync(resolve(relayRoot, "package.json"), "utf8"));
	writeFileSync(
		resolve(source, "package.json"),
		JSON.stringify({
			name: packageJson.name,
			main: "dist/index.js",
			engines: packageJson.engines,
			dependencies: packageJson.dependencies,
		}),
	);
	writeFileSync(
		resolve(source, ".env.local"),
		`RELAY_TEST_FCM_PORT=${ports.fcm}\nRELAY_REGION=us-central1\n` +
			`RELAY_RUNTIME_SERVICE_ACCOUNT=relay-runtime@${DEMO_PROJECT}.iam.gserviceaccount.com\n` +
			`RELAY_DATABASE_ID=${databaseId}\nRELAY_MAX_INSTANCES=2\n`,
	);
	const modules = resolve(source, "node_modules");
	if (!existsSync(modules)) symlinkSync(resolve(relayRoot, "node_modules"), modules, "dir");
	if (existsSync(resolve(relayRoot, "dist"))) {
		rmSync(resolve(source, "dist"), { recursive: true, force: true });
		cpSync(resolve(relayRoot, "dist"), resolve(source, "dist"), { recursive: true });
	}
	const configPath = resolve(relayRoot, `.emulator-config-${ports.functions}.json`);
	writeFileSync(configPath, JSON.stringify(config));
	return { state, environment, configPath };
}

/** Invoke only the installed CLI through env -i, with isolated login/config/cache state and an explicit demo ID. */
export function spawnEmulators(
	action: "setup" | "test" | "test:e2e" | "start" | "demo",
	minutes = 30,
	fakeFcmStarted = false,
) {
	const testing = action === "test" || action === "test:e2e";
	const ports = emulatorPorts();
	if (action === "demo" && !fakeFcmStarted) throw new Error("Demo must own its fake FCM listener");
	if (action !== "setup") requireFreePorts(ports, !fakeFcmStarted);
	const prepared = prepareEmulators(ports);
	const command = [resolve(relayRoot, "node_modules/.bin/firebase")];
	if (action === "setup") command.push("setup:emulators:firestore");
	else
		command.push(
			action === "start" || action === "demo" ? "emulators:start" : "emulators:exec",
			"--only",
			"auth,firestore,functions",
			"--project",
			DEMO_PROJECT,
			"--config",
			prepared.configPath,
			...(testing
				? [
						action === "test:e2e"
							? "bun test --timeout 90000 --preload ./checks/network-guard.ts ./checks/e2e/integration.cases.ts"
							: "bun run test:cases",
					]
				: []),
		);
	const child = Bun.spawn(
		["env", "-i", ...Object.entries(prepared.environment).map(([key, value]) => `${key}=${value}`), ...command],
		{
			cwd: relayRoot,
			stdout: action === "demo" ? 2 : "inherit",
			stderr: "inherit",
			stdin: "ignore",
			timeout:
				action === "setup" ? 120_000 : testing ? 240_000 : action === "demo" ? minutes * 60_000 + 120_000 : 600_000,
		},
	);
	return { child, ports, ...prepared };
}
