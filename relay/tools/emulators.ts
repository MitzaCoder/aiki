import { spawnEmulators } from "./emulator-launch";

const action = process.argv[2];
if (process.argv.length !== 3 || !["setup", "start", "test", "test:e2e"].includes(action)) {
	throw new Error("Expected setup, start, test or test:e2e");
}
const { child } = spawnEmulators(action as "setup" | "start" | "test" | "test:e2e");
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.once(signal, () => child.kill("SIGTERM"));
process.exit(await child.exited);
