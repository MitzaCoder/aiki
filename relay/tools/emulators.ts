import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const state = resolve(root, ".emulator");
for (const name of ["home", "config", "cache"]) mkdirSync(resolve(state, name), { recursive: true });
const ports = {
	auth: 19371,
	firestore: 19372,
	functions: 19373,
	hub: 19374,
	logging: 19375,
	websocket: 19376,
	fcm: 19377,
};
for (const key of Object.keys(ports) as (keyof typeof ports)[]) {
	const override = process.env[`RELAY_${key.toUpperCase()}_PORT`];
	if (override) ports[key] = Number(override);
	if (!Number.isInteger(ports[key]) || ports[key] < 1024 || ports[key] > 65535) throw new Error("Invalid port");
}
if (new Set(Object.values(ports)).size !== Object.values(ports).length) throw new Error("Ports must be distinct");
const config = JSON.parse(readFileSync(resolve(root, "firebase.json"), "utf8"));
config.functions.source = ".";
for (const key of ["auth", "firestore", "functions", "hub", "logging"] as const)
	config.emulators[key].port = ports[key];
config.emulators.firestore.websocketPort = ports.websocket;
writeFileSync(resolve(root, ".emulator-config.json"), JSON.stringify(config));
writeFileSync(resolve(root, ".env.local"), `RELAY_TEST_FCM_PORT=${ports.fcm}\n`);
const action = process.argv[2];
if (!["setup", "start", "test"].includes(action)) throw new Error("Expected setup, start or test");
if (action !== "setup") {
	const sockets = Bun.spawnSync(["ss", "-ltn"], { timeout: 5000 });
	if (sockets.exitCode !== 0) throw new Error("Cannot check ports");
	if (Object.values(ports).some((port) => new RegExp(`:${port}\\b`).test(sockets.stdout.toString())))
		throw new Error("Emulator port occupied");
}
// env -i prevents the CLI and all descendants from discovering the operator's login state.
const environment: Record<string, string> = {
	PATH: process.env.PATH!,
	HOME: resolve(state, "home"),
	XDG_CONFIG_HOME: resolve(state, "config"),
	XDG_CACHE_HOME: resolve(state, "cache"),
	CI: "true",
	FIREBASE_CLI_DISABLE_ANALYTICS: "true",
	FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
	NO_UPDATE_NOTIFIER: "true",
	GCLOUD_PROJECT: "demo-aiki-relay",
	RELAY_TEST_FCM_PORT: String(ports.fcm),
	RELAY_FUNCTIONS_PORT: String(ports.functions),
};
// Execute the installed CLI binary through its Node shebang; Bun remains the script runner.
const command = [resolve(root, "node_modules/.bin/firebase")];
if (action === "setup") command.push("setup:emulators:firestore");
else
	command.push(
		action === "test" ? "emulators:exec" : "emulators:start",
		"--only",
		"auth,firestore,functions",
		"--project",
		"demo-aiki-relay",
		"--config",
		resolve(root, ".emulator-config.json"),
		...(action === "test" ? ["bun run test:cases"] : []),
	);
const child = Bun.spawn(
	["env", "-i", ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), ...command],
	{
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
		timeout: action === "setup" ? 120000 : action === "test" ? 240000 : 600000,
	},
);
process.exit(await child.exited);
