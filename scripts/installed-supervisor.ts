import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { SelfUpdateState } from "../packages/protocol/src/server-status.ts";
import { childEnvironment } from "../packages/server/src/child-environment.ts";
import { readSelfUpdate, writeSelfUpdate } from "../packages/server/src/self-update.ts";

export type Installation = { root: string; config: string; data: string; launcher: string; version: string; channel?: "pilot" | "stable"; release?: string };
export function atomicLink(root: string, name: string, target: string): void {
	const temporary = join(root, `.${name}-${process.pid}`);
	rmSync(temporary, { force: true }); symlinkSync(target, temporary); renameSync(temporary, join(root, name));
}
export function atomicInstallation(installation: Installation): void {
	const path = join(installation.root, ".aiki-install.json");
	const temporary = `${path}.incoming-${process.pid}`;
	writeFileSync(temporary, JSON.stringify(installation, null, 2), { mode: 0o600 }); renameSync(temporary, path);
}
/** Shared by manual rollback and health-triggered recovery. Mutable data and channel stay untouched. */
export function selectRetainedRelease(installation: Installation, selected: string, previous: string): void {
	const root = installation.root;
	const version = readFileSync(join(selected, ".ready"), "utf8").trim();
	atomicLink(root, "current", selected); atomicLink(root, "previous", previous);
	installation.version = version;
	if (basename(selected) === version) delete installation.release;
	else installation.release = basename(selected);
	atomicInstallation(installation);
}

type Transaction = {
	state: SelfUpdateState;
	publish: (state: SelfUpdateState) => void;
	stop: () => Promise<void>;
	activate: () => Promise<void>;
	start: () => void;
	health: () => Promise<boolean>;
	rollback: () => Promise<void>;
};
/** Restart boundary is injected so health/activation failures can be tested without touching a service. */
export async function applySelfUpdate(transaction: Transaction): Promise<void> {
	const { state, publish } = transaction;
	try {
		await transaction.stop();
		await transaction.activate();
		publish({ ...state, phase: "checking", message: "Checking the new release…" });
		transaction.start();
		if (!await transaction.health()) throw new Error("New release did not pass its owner-socket health check within 30 seconds");
		publish({ ...state, phase: "succeeded", agents: 0, message: `Updated to ${state.toVersion}` });
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		await transaction.stop();
		try {
			await transaction.rollback();
			transaction.start();
			const healthy = await transaction.health();
			publish({ ...state, phase: healthy ? "rolled_back" : "failed", message: healthy ? `Update failed, rolled back: ${reason}` : `Rollback selected the old release but it is not healthy: ${reason}` });
		} catch (rollbackError) {
			publish({ ...state, phase: "failed", message: `Update and rollback failed: ${reason}; ${String(rollbackError)}` });
		}
	}
}

/** Keeps the service's main PID alive across switches; also works without a service manager. */
export async function superviseInstallation(installation: Installation, env: Readonly<Record<string, string | undefined>>): Promise<void> {
	const { root } = installation;
	const lock = join(root, "supervisor.pid");
	if (existsSync(lock)) {
		const pid = Number(readFileSync(lock, "utf8"));
		if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid supervisor.pid; inspect the installation before removing it");
		let alive = false;
		try { process.kill(pid, 0); alive = true; } catch { /* Prior supervisor exited. */ }
		if (alive) throw new Error("Kemiri's supervisor is already running");
		rmSync(lock);
	}
	writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
	const recoveryPath = join(root, "self-update-recovery.json");
	let child: ReturnType<typeof Bun.spawn> | undefined;
	let stopping = false;
	const childEnv = { ...childEnvironment(), KEMIRI_INSTALL_DIR: root, KEMIRI_UPDATE_CHILD: "1", ...(env.KEMIRI_PORT ? { KEMIRI_PORT: env.KEMIRI_PORT } : {}) };
	const start = () => {
		// Only our stopped child can leave this file; never remove a live process's lock.
		if (existsSync(join(root, "server.pid"))) {
			const pid = Number(readFileSync(join(root, "server.pid"), "utf8"));
			let alive = false;
			if (Number.isSafeInteger(pid) && pid > 0) try { process.kill(pid, 0); alive = true; } catch { /* Dead child. */ }
			if (alive) throw new Error("Another server is running in this installation");
			rmSync(join(root, "server.pid"));
		}
		child = Bun.spawn([installation.launcher, "start"], { env: childEnv, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
	};
	const stop = async () => {
		if (!child || child.exitCode !== null) return;
		child.kill("SIGTERM");
		const timeout = setTimeout(() => child?.kill("SIGKILL"), 20_000);
		try { await child.exited; } finally { clearTimeout(timeout); }
	};
	const health = async () => {
		const deadline = Date.now() + 30_000;
		const selected = JSON.parse(readFileSync(join(root, ".aiki-install.json"), "utf8")) as Installation;
		while (!stopping && Date.now() < deadline) {
			if (child?.exitCode !== null) return false;
			try {
				const response = await fetch("http://localhost/", { unix: join(installation.data, "auth.sock"), method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: ["health-check", JSON.stringify({ type: "server.status", id: "self-update-health" })] }), signal: AbortSignal.timeout(1500) });
				const answer = await response.json() as { answer?: { type?: string; status?: { updates?: { installedVersion?: string } } } };
				if (response.ok && answer.answer?.type === "server.status" && answer.answer.status?.updates?.installedVersion === selected.version) return true;
			} catch { /* Startup can take a moment. Never accept an arbitrary HTTP listener. */ }
			await Bun.sleep(250);
		}
		return false;
	};
	const shutdown = () => { stopping = true; void stop(); };
	process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
	try {
		// Recovery journal predates activation. Even partial symlink/metadata writes restore known old code.
		if (existsSync(recoveryPath)) {
			const recovery = JSON.parse(readFileSync(recoveryPath, "utf8")) as { installation: Installation; selected: string; candidate: string; state: SelfUpdateState };
			selectRetainedRelease(recovery.installation, recovery.selected, existsSync(recovery.candidate) ? recovery.candidate : recovery.selected);
			writeSelfUpdate(root, { ...recovery.state, phase: "rolled_back", message: "Update failed, rolled back: supervisor interrupted during restart" });
			rmSync(recoveryPath);
		}
		start();
		while (!stopping) {
			await Bun.sleep(250);
			const state = readSelfUpdate(root);
			if (state?.phase === "restarting") {
				const old = JSON.parse(readFileSync(join(root, ".aiki-install.json"), "utf8")) as Installation;
				const selected = realpathSync(join(root, "current"));
				const candidate = join(root, "releases", state.toVersion);
				try {
					if (!/^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(state.toVersion) || readFileSync(join(candidate, ".ready"), "utf8").trim() !== state.toVersion) throw new Error("Invalid staged release");
				} catch {
					writeSelfUpdate(root, { ...state, phase: "failed", message: "Staged release is missing or invalid; running release unchanged." });
					continue;
				}
				writeFileSync(recoveryPath, JSON.stringify({ installation: old, selected, candidate, state }), { mode: 0o600 });
				await applySelfUpdate({ state, publish: next => writeSelfUpdate(root, next), stop,
					activate: async () => { selectRetainedRelease({ ...old }, candidate, selected); },
					start, health,
					rollback: async () => { selectRetainedRelease(old, selected, candidate); },
				});
				rmSync(recoveryPath, { force: true });
				const keep = new Set([realpathSync(join(root, "current")), realpathSync(join(root, "previous"))]);
				for (const name of readdirSync(join(root, "releases"))) {
					const release = join(root, "releases", name);
					if (!keep.has(release) && existsSync(join(release, ".ready"))) rmSync(release, { recursive: true, force: true });
				}
			} else if (child && child.exitCode !== null) { process.exitCode = child.exitCode; break; }
		}
	} finally {
		stopping = true; await stop(); rmSync(lock, { force: true });
		process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown);
	}
}
