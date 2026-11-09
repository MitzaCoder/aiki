/**
 * The deploy-survival experiment from docs/DESIGN.md "Terminals": a stand-in for the backend that attaches a zellij
 * session through `TerminalHost`, so the unit it runs in can be restarted like a deploy does and the session checked.
 *
 *   MODE=auto|off DIR=<scratch dir> bun run packages/server/scripts/terminal-survival.ts
 *
 * `auto` starts the zellij server outside the unit's cgroup (systemd-run --user --scope), `off` leaves it in the PTY.
 * It uses its own zellij sockets, cache and home under DIR, never the user's sessions. Run by hand; see the design doc
 * for the commands and results.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TerminalHost } from "../src/terminals.ts";

const dir = process.env.DIR ?? "/tmp/mh-survival";
const mode = process.env.MODE === "off" ? "off" : "auto";
const session = `survive-${mode}`;
for (const sub of ["sock", "home", "cache", "config"]) mkdirSync(join(dir, sub), { recursive: true });
const host = new TerminalHost({
	multiplexer: "zellij",
	survive: mode,
	configFile: join(dir, "zellij.kdl"),
	env: {
		PATH: process.env.PATH,
		ZELLIJ_SOCKET_DIR: join(dir, "sock"),
		XDG_CACHE_HOME: join(dir, "cache"),
		XDG_CONFIG_HOME: join(dir, "config"),
		XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
		HOME: join(dir, "home"),
		SHELL: Bun.which("bash") ?? "/bin/bash",
	},
});
let screen = "";
const sink = { output: (bytes: Uint8Array) => (screen += new TextDecoder().decode(bytes)), resync() {}, closed() {} };
const terminal = await host.open({ session, cols: 100, rows: 30 }, sink);
const first = !(await Bun.file(join(dir, `typed-${mode}`)).exists());
if (first) {
	terminal.write("sleep 4321\r");
	writeFileSync(join(dir, `typed-${mode}`), "1");
}
terminal.ack(1 << 30);
await Bun.sleep(3000);
writeFileSync(join(dir, `screen-${mode}-${first ? 1 : 2}.txt`), screen.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
console.log(`${mode}: ${first ? "first" : "second"} start, session ${session} created=${terminal.created}`);
setInterval(() => {}, 1000);
