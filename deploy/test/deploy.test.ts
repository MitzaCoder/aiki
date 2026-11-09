/**
 * The deploy's scripts, against temporary directories and a stand-in backend (deploy/test/fake-backend.ts). Nothing here
 * touches a real service, a real port or ~/.local/share/mihai-harness-deploy: `systemctl`, `journalctl` and `ssh` are
 * stubs on PATH, HOME is a temporary directory, and `bun install` is stubbed out.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAIN_FEATURES, type FakeBackend, type FakeRelease, startFakeBackend } from "./fake-backend.ts";

const BUN = process.execPath;
const DEPLOY_DIR = join(import.meta.dir, "..");
const HEALTH_CHECK = join(DEPLOY_DIR, "health-check.ts");
const BACKEND = join(DEPLOY_DIR, "backend.sh");
const DEPLOY = join(DEPLOY_DIR, "deploy.sh");
const VAPID_KEY = join(DEPLOY_DIR, "vapid-key.sh");
const VM_ONLY_TARGETS = JSON.stringify({
	targets: [{ name: "vm", label: "VM", ssh: "user@vm.example.test", tailnet: "vm.example.test", unit: "user" }],
});
const SAFE_CGROUP = "0::/user.slice/user-1000.slice/session-3.scope";

const backends: FakeBackend[] = [];

afterEach(() => {
	for (const backend of backends.splice(0)) backend.stop();
});

function startBackend(overrides: Parameters<typeof startFakeBackend>[0] = {}): FakeBackend {
	const backend = startFakeBackend(overrides);
	backends.push(backend);
	return backend;
}

type Run = { code: number; stdout: string; stderr: string };

/** Asynchronous on purpose: the stand-in backend runs in this process, so blocking here would stop it answering. */
async function run(cmd: string[], env: Record<string, string | undefined> = {}): Promise<Run> {
	const child = Bun.spawn({ cmd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}

async function healthCheck(backend: FakeBackend, args: string[] = []): Promise<Run> {
	return run([BUN, "run", HEALTH_CHECK, backend.url, ...args]);
}

/** A path in a fresh temporary directory, for the recorded open projects. */
function temporaryFile(name: string): string {
	return join(mkdtempSync(join(tmpdir(), "mihai-harness-deploy-projects.")), name);
}

const COMMIT = "0f1e2d3c4b5a69788796a5b4c3d2e1f009182736";
const OTHER_COMMIT = "1231234890abcdef1231234890abcdef12312348";

function release(commit: string, name = "20261030T120000Z-0f1e2d3"): FakeRelease {
	return { name, commit, description: "feat(deploy): a release", deployedAt: "2026-10-30T12:00:00.000Z" };
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("health-check", () => {
	test("answers the hello of a server without a status", async () => {
		const backend = startBackend({ features: ["projects", "conversation"] });
		const result = await healthCheck(backend);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("answers: mihai-harness 0.1.0");
	});

	test("deep-checks the running commit and pages every open project", async () => {
		const backend = startBackend({
			release: release(COMMIT),
			projects: [
				{ id: "open-project", state: "open" },
				{ id: "closed-project", state: "closed" },
			],
		});
		const result = await healthCheck(backend, ["--deep", `--expect-commit=${COMMIT}`]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("release 20261030T120000Z-0f1e2d3");
		expect(result.stdout).toContain("1 open project(s) paged");
		const paged = backend.requests.filter((request) => request.type === "conversation.page");
		expect(paged.map((request) => request.fields.projectId)).toEqual(["open-project"]);
	});

	test("fails when the server runs another commit", async () => {
		const backend = startBackend({ release: release(OTHER_COMMIT) });
		const result = await healthCheck(backend, ["--deep", `--expect-commit=${COMMIT}`, "--timeout-ms=1000"]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("expected 0f1e2d3c4b5a");
	});

	test("fails when the server reports no release", async () => {
		const backend = startBackend({ release: null });
		const result = await healthCheck(backend, ["--deep", `--expect-commit=${COMMIT}`, "--timeout-ms=1000"]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("reports no release");
	});

	test("skips the release check on a server without the feature, and still pages projects", async () => {
		const backend = startBackend({
			features: ["projects", "conversation"],
			deployRoot: null,
			projects: [{ id: "open-project", state: "open" }],
		});
		const result = await healthCheck(backend, ["--deep", `--expect-commit=${COMMIT}`]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("no server-status feature");
		expect(result.stdout).toContain("1 open project(s) paged");
		expect(backend.requests.some((request) => request.type === "server.status")).toBe(false);
	});

	test("treats a listed but unanswered status as a missing feature", async () => {
		const backend = startBackend({ answerStatus: false, busy: { conversations: 1, workers: 0 } });
		const deep = await healthCheck(backend, ["--deep", `--expect-commit=${COMMIT}`]);
		expect(deep.code).toBe(0);
		expect(deep.stdout).toContain("no working server-status feature");
		const idle = await healthCheck(backend, ["--wait-idle"]);
		expect(idle.code).toBe(0);
		expect(idle.stdout).toContain("lists but does not answer server-status");
	});

	test("records the projects open before a restart and pages those afterwards", async () => {
		const backend = startBackend({
			release: release(COMMIT),
			projects: [
				{ id: "open-project", state: "open" },
				{ id: "closed-project", state: "closed" },
			],
			failPageFor: ["closed-project"],
		});
		const file = temporaryFile("open-projects");

		const recorded = await healthCheck(backend, [`--record-open-projects=${file}`]);
		expect(recorded.code).toBe(0);
		expect(recorded.stdout).toContain("1 project(s) open before the restart");
		expect(readFileSync(file, "utf8")).toBe("open-project\n");

		// Projects open lazily: after a restart the list reports none open, and only the recorded one is paged.
		backend.state.projects = [
			{ id: "open-project", state: "closed" },
			{ id: "closed-project", state: "closed" },
		];
		const deep = await healthCheck(backend, ["--deep", `--open-projects=${file}`, `--expect-commit=${COMMIT}`]);
		expect(deep.code).toBe(0);
		expect(deep.stdout).toContain("paged the 1 project(s) that were open before the restart");
		expect(
			backend.requests
				.filter((request) => request.type === "conversation.page")
				.map((request) => request.fields.projectId),
		).toEqual(["open-project"]);
	});

	test("fails when a project that was open before the restart does not page", async () => {
		const backend = startBackend({
			release: release(COMMIT),
			projects: [{ id: "open-project", state: "open" }],
			failPageFor: ["open-project"],
		});
		const file = temporaryFile("open-projects");
		writeFileSync(file, "open-project\n");

		const deep = await healthCheck(backend, ["--deep", `--open-projects=${file}`, "--timeout-ms=1000"]);
		expect(deep.code).toBe(1);
		expect(deep.stderr).toContain("open-project cannot be paged");
	});

	test("records nothing when the server does not answer, and checks nothing then", async () => {
		const backend = startBackend();
		const url = backend.url;
		backend.stop();
		backends.length = 0;
		const file = temporaryFile("open-projects");

		const recorded = await run([BUN, "run", HEALTH_CHECK, url, `--record-open-projects=${file}`]);
		expect(recorded.code).toBe(0);
		expect(recorded.stdout).toContain("checking none after it");
		expect(readFileSync(file, "utf8")).toBe("");
	});

	test("says so when no project was open before the restart", async () => {
		const backend = startBackend({ release: release(COMMIT) });
		const file = temporaryFile("open-projects");
		writeFileSync(file, "");

		const deep = await healthCheck(backend, ["--deep", `--open-projects=${file}`]);
		expect(deep.code).toBe(0);
		expect(deep.stdout).toContain("no project was open before the restart");
	});

	test("fails when a project's transcript cannot be paged", async () => {
		const backend = startBackend({
			release: release(COMMIT),
			projects: [{ id: "broken", state: "open" }],
			failPageFor: ["broken"],
		});
		const result = await healthCheck(backend, ["--deep", "--timeout-ms=1000"]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("broken cannot be paged");
	});

	test("waits for busy work to finish before saying it is idle", async () => {
		const backend = startBackend({
			release: release(COMMIT),
			busy: { conversations: 1, workers: 0 },
			busyFor: 1,
		});
		const result = await healthCheck(backend, ["--wait-idle", "--idle-timeout-ms=5000", "--idle-poll-ms=50"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("is idle: nothing is running");
		expect(result.stderr).toContain("is not idle (1 conversation(s) and 0 worker(s) running)");
		expect(backend.requests.filter((request) => request.type === "server.status").length).toBeGreaterThanOrEqual(2);
	});

	test("gives up at the timeout and says it restarts anyway", async () => {
		const backend = startBackend({ release: release(COMMIT), busy: { conversations: 0, workers: 2 } });
		const result = await healthCheck(backend, ["--wait-idle", "--idle-timeout-ms=200", "--idle-poll-ms=50"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("still busy after 0s (0 conversation(s) and 2 worker(s) running); restarting anyway");
	});

	test("does not wait for a server that is down", async () => {
		const backend = startBackend();
		const url = backend.url;
		backend.stop();
		backends.length = 0;
		const result = await run([BUN, "run", HEALTH_CHECK, url, "--wait-idle", "--idle-timeout-ms=1000"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("does not answer");
		expect(result.stdout).toContain("not waiting for it to be idle");
	});

	test("does not wait for a server without the feature", async () => {
		const backend = startBackend({ features: ["projects"], busy: { conversations: 1, workers: 0 } });
		const result = await healthCheck(backend, ["--wait-idle"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("has no server-status feature");
		expect(backend.requests.map((request) => request.type)).toEqual(["hello"]);
	});

	test("drains a server that can, and waits only for its executing tool calls", async () => {
		// Conversations and workers keep running; only the two executing tool calls matter, and they finish.
		const backend = startBackend({
			features: DRAIN_FEATURES,
			busy: { conversations: 1, workers: 3 },
			toolCalls: 2,
			toolCallsFor: 2,
		});
		const result = await healthCheck(backend, ["--wait-idle", "--idle-timeout-ms=5000", "--idle-poll-ms=50"]);
		expect(result.code).toBe(0);
		expect(result.stderr).toContain("is draining (2 tool call(s) executing, new ones held)");
		expect(result.stdout).toContain("is drained: no tool call is executing and new ones wait, safe to restart");
		// Every poll asks for the drain again, which keeps it going; nothing asks whether the server is idle.
		const types = backend.requests.map((request) => request.type);
		expect(types.filter((type) => type === "server.drain").length).toBe(3);
		expect(types).not.toContain("server.status");
	});

	test("restarts anyway when tool calls keep executing past the timeout", async () => {
		const backend = startBackend({ features: DRAIN_FEATURES, toolCalls: 1 });
		const result = await healthCheck(backend, ["--wait-idle", "--idle-timeout-ms=200", "--idle-poll-ms=50"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("still busy after 0s (1 tool call(s) executing, new ones held); restarting anyway");
	});

	test("waits for idle on a server that lists drain but does not answer it", async () => {
		const backend = startBackend({
			features: DRAIN_FEATURES,
			answerDrain: false,
			busy: { conversations: 1, workers: 0 },
			busyFor: 1,
		});
		const result = await healthCheck(backend, ["--wait-idle", "--idle-timeout-ms=5000", "--idle-poll-ms=50"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("is idle: nothing is running, safe to restart");
		// Asked once, then never again.
		expect(backend.requests.filter((request) => request.type === "server.drain").length).toBe(1);
	});

	test("rejects an option it does not know", async () => {
		const backend = startBackend();
		const result = await healthCheck(backend, ["--nonsense"]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("unknown option --nonsense");
	});
});

/** A temporary machine: HOME, the deploy root under it and the stubs backend.sh calls. */
type Machine = {
	dir: string;
	home: string;
	root: string;
	bin: string;
	restartsFile: string;
	cgroupFile: string;
};

function writeScript(path: string, body: string): void {
	writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
	chmodSync(path, 0o755);
}

function makeMachine(): Machine {
	const dir = mkdtempSync(join(tmpdir(), "mihai-harness-deploy-test."));
	const home = join(dir, "home");
	const root = join(home, ".local", "share", "mihai-harness-deploy");
	const bin = join(dir, "bin");
	mkdirSync(bin, { recursive: true });

	// `restart` is the moment a real deploy would take the server down; a user unit's restart is marked " user".
	writeScript(
		join(bin, "systemctl"),
		[
			'scope=""',
			'if [[ ${1:-} == --user ]]; then scope=" user"; shift; fi',
			"case ${1:-} in",
			'restart) printf "%s%s\\n" "$(date +%s%3N)" "$scope" >> "$STUB_RESTARTS" ;;',
			"esac",
			"exit 0",
		].join("\n"),
	);
	writeScript(join(bin, "journalctl"), "exit 0");
	// `bun install` in a release is the only step that would reach the network here.
	const bun = join(bin, "bun");
	writeScript(bun, `if [[ \${1:-} == install ]]; then exit 0; fi\nexec ${BUN} "$@"`);

	const restartsFile = join(dir, "restarts");
	writeFileSync(restartsFile, "");
	const cgroupFile = join(dir, "cgroup");
	writeFileSync(cgroupFile, `${SAFE_CGROUP}\n`);

	return { dir, home, root, bin, restartsFile, cgroupFile };
}

function backendEnvironment(machine: Machine, port: number): Record<string, string> {
	return {
		HOME: machine.home,
		PATH: `${machine.bin}:${process.env.PATH ?? ""}`,
		BUN: join(machine.bin, "bun"),
		MIHAI_HARNESS_PORT: String(port),
		DEPLOY_IDLE_POLL_SECONDS: "1",
		DEPLOY_IDLE_TIMEOUT_SECONDS: "5",
		DEPLOY_HEALTH_TIMEOUT_MS: "1500",
		DEPLOY_CGROUP_FILE: machine.cgroupFile,
		STUB_RESTARTS: machine.restartsFile,
	};
}

function port(backend: FakeBackend): number {
	return Number(new URL(backend.url).port);
}

function prepareIncoming(machine: Machine, name: string): void {
	const incoming = join(machine.root, "incoming", name);
	mkdirSync(incoming, { recursive: true });
	writeFileSync(join(incoming, "package.json"), '{ "name": "release", "private": true }\n');
}

async function deployBackend(
	machine: Machine,
	backend: FakeBackend,
	name: string,
	commit: string,
	subject: string,
): Promise<Run> {
	prepareIncoming(machine, name);
	return run(["bash", BACKEND, "system", "release", name, commit, subject], backendEnvironment(machine, port(backend)));
}

describe("backend.sh", () => {
	test("writes RELEASE.json, waits for idle, then records an ok deploy", async () => {
		const machine = makeMachine();
		// The stand-in backend reports the release `current` points at, like a real one reading its own RELEASE.json.
		const backend = startBackend({ deployRoot: machine.root, busyFor: 1, busy: { conversations: 1, workers: 0 } });
		backend.state.projects = [{ id: "open-project", state: "open" }];

		const name = "20261030T120000Z-0f1e2d3";
		const subject = 'feat(deploy): restart only when idle and check "conversations"';
		const result = await deployBackend(machine, backend, name, COMMIT, subject);

		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("is not idle");
		expect(result.stdout).toContain("is idle: nothing is running, safe to restart");
		expect(result.stdout).toContain("healthy:");

		const written = readJson<FakeRelease>(join(machine.root, "releases", name, "RELEASE.json"));
		expect(written).toMatchObject({ name, commit: COMMIT, description: subject });
		expect(Number.isNaN(Date.parse(written.deployedAt))).toBe(false);

		expect(readFileSync(join(machine.root, "current", "RELEASE.json"), "utf8")).toContain(name);
		const status = readJson<{ state: string; commit: string; description: string; message: string | null }>(
			join(machine.root, "deploy-status.json"),
		);
		expect(status).toMatchObject({ state: "ok", commit: COMMIT, description: subject, message: null });

		// The restart happens once, after at least one "busy" answer and one "idle" answer, and the deep check follows it.
		const restarts = readFileSync(machine.restartsFile, "utf8").trim().split("\n").map(Number);
		expect(restarts.length).toBe(1);
		const [restartedAt] = restarts as [number];
		const before = backend.requests.filter((request) => request.type === "server.status" && request.at < restartedAt);
		const after = backend.requests.filter((request) => request.at > restartedAt);
		expect(before.length).toBeGreaterThanOrEqual(2);
		expect(after.map((request) => request.type)).toContain("projects.list");
		expect(after.map((request) => request.type)).toContain("conversation.page");
	});

	test("drains the backend and restarts once no tool call executes, with conversations still running", async () => {
		const machine = makeMachine();
		const backend = startBackend({
			deployRoot: machine.root,
			features: DRAIN_FEATURES,
			busy: { conversations: 2, workers: 4 },
			toolCalls: 1,
			toolCallsFor: 1,
		});

		const result = await deployBackend(machine, backend, "20261030T150000Z-0f1e2d3", COMMIT, "feat: drain");

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("idle: " + backend.url + " is drained");
		const restarts = readFileSync(machine.restartsFile, "utf8").trim().split("\n").map(Number);
		expect(restarts.length).toBe(1);
		const drains = backend.requests.filter((request) => request.type === "server.drain");
		expect(drains.length).toBe(2);
		expect(drains.every((request) => request.at < restarts[0]!)).toBe(true);
	});

	test("checks the conversations that were open before the restart", async () => {
		const machine = makeMachine();
		// One open project, and a list that reports everything closed after the first answer: after the restart nothing
		// is open yet, exactly like a real backend, so the deep check must page what was recorded before it.
		const backend = startBackend({
			deployRoot: machine.root,
			projects: [{ id: "open-project", state: "open" }],
			openFor: 1,
		});

		const result = await deployBackend(machine, backend, "20261030Laptop0000Z-0f1e2d3", COMMIT, "feat: lazy projects");

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("open before restart:");
		expect(result.stdout).toContain("1 project(s) open before the restart");
		expect(result.stdout).toContain("paged the 1 project(s) that were open before the restart");
		expect(readFileSync(join(machine.root, ".open-projects"), "utf8")).toBe("open-project\n");
		expect(
			backend.requests
				.filter((request) => request.type === "conversation.page")
				.map((request) => request.fields.projectId),
		).toEqual(["open-project"]);
	});

	test("rolls back when the new release does not run its commit", async () => {
		const machine = makeMachine();
		const backend = startBackend({ deployRoot: machine.root, busyFor: null });

		const first = "20261030T120000Z-0f1e2d3";
		const firstResult = await deployBackend(machine, backend, first, COMMIT, "feat: first");
		expect(firstResult.code).toBe(0);

		// From here the server keeps answering for the first release, whatever `current` says: the deploy must notice.
		const lies = join(machine.dir, "running.json");
		writeFileSync(lies, JSON.stringify(release(COMMIT, "20261030T110000Z-0f1e2d3")));
		backend.state.releaseFromFile = lies;

		const second = "20261030T130000Z-1231234";
		const secondResult = await deployBackend(machine, backend, second, OTHER_COMMIT, "fix: second");
		expect(secondResult.code).toBe(1);
		expect(secondResult.stdout).toContain(`rolling back to ${first}`);
		expect(secondResult.stdout).toContain(`rolled back to ${first}`);

		const status = readJson<{ state: string; commit: string; message: string }>(
			join(machine.root, "deploy-status.json"),
		);
		expect(status.state).toBe("rolled_back");
		expect(status.commit).toBe(OTHER_COMMIT);
		expect(status.message).toContain(second);

		// The new release stays for inspection; `current` points at the one that works.
		expect(existsSync(join(machine.root, "releases", second, "RELEASE.json"))).toBe(true);
		expect(readFileSync(join(machine.root, "current", "RELEASE.json"), "utf8")).toContain(first);
	});

	test("refuses to run from inside the server's own cgroup", async () => {
		const machine = makeMachine();
		writeFileSync(
			machine.cgroupFile,
			"0::/user.slice/user-1000.slice/user@1000.service/app.slice/mihai-harness.service\n",
		);
		const backend = startBackend({ deployRoot: machine.root });

		const result = await deployBackend(machine, backend, "20261030T120000Z-0f1e2d3", COMMIT, "feat: refused");

		expect(result.code).toBe(2);
		expect(result.stdout).toContain("REFUSING to deploy from inside the mihai-harness server's cgroup");
		expect(result.stdout).toContain("Move the main bookmark instead");
		expect(existsSync(join(machine.root, "releases"))).toBe(false);
		expect(backend.requests.length).toBe(0);
	});
	/** Start a release whose output is read for one chunk and then dropped, like an ssh connection that breaks. */
	async function releaseWithDroppedOutput(survive: boolean): Promise<{ code: number; machine: Machine }> {
		const machine = makeMachine();
		// Busy for a while, so the script still has output to write after the connection is gone.
		const backend = startBackend({ deployRoot: machine.root, busyFor: 3, busy: { conversations: 1, workers: 0 } });
		prepareIncoming(machine, "20261030T160000Z-0f1e2d3");
		const child = Bun.spawn({
			cmd: ["bash", BACKEND, "system", "release", "20261030T160000Z-0f1e2d3", COMMIT, "feat: dropped"],
			env: { ...process.env, ...backendEnvironment(machine, port(backend)), ...(survive ? { DEPLOY_SURVIVE_DISCONNECT: "1" } : {}) },
			stdout: "pipe",
			stderr: "pipe",
		});
		const reader = child.stdout.getReader();
		await reader.read();
		await reader.cancel();
		const code = await child.exited;
		return { code, machine };
	}

	test("with DEPLOY_SURVIVE_DISCONNECT a dropped connection cannot stop it before the health check", async () => {
		const { code, machine } = await releaseWithDroppedOutput(true);
		expect(code).toBe(0);
		expect(readJson<{ state: string; commit: string }>(join(machine.root, "deploy-status.json"))).toMatchObject({ state: "ok", commit: COMMIT });
		expect(readFileSync(join(machine.root, "last-deploy.log"), "utf8")).toContain("healthy:");
		expect(readFileSync(machine.restartsFile, "utf8").trim().split("\n")).toHaveLength(1);
	});

	test("without it the same drop kills the script after current moved, which is why the laptop gets the option", async () => {
		const { code, machine } = await releaseWithDroppedOutput(false);
		expect(code).not.toBe(0);
		expect(existsSync(join(machine.root, "deploy-status.json"))).toBe(false);
		expect(existsSync(join(machine.root, "current"))).toBe(true);
	});

	test("a second run waits out one that is still going", async () => {
		const machine = makeMachine();
		const backend = startBackend({ deployRoot: machine.root });
		mkdirSync(machine.root, { recursive: true });
		const holder = Bun.spawn(["flock", join(machine.root, ".backend.lock"), "sleep", "20"]);
		await Bun.sleep(300);
		try {
			prepareIncoming(machine, "20261030T170000Z-0f1e2d3");
			const result = await run(["bash", BACKEND, "system", "release", "20261030T170000Z-0f1e2d3", COMMIT, "feat: second"], {
				...backendEnvironment(machine, port(backend)),
				DEPLOY_SURVIVE_DISCONNECT: "1",
			});
			expect(result.code).toBe(75);
			expect(result.stdout).toContain("another backend.sh is still running here");
			expect(existsSync(join(machine.root, "current"))).toBe(false);
		} finally {
			holder.kill();
		}
	});
});

describe("deploy.sh", () => {
	/** A throwaway repository with this deploy/ in it, so `git archive` has a commit to materialise. */
	async function makeRepository(): Promise<{ dir: string; sha: string }> {
		const dir = mkdtempSync(join(tmpdir(), "mihai-harness-deploy-repo."));
		cpSync(DEPLOY_DIR, join(dir, "deploy"), { recursive: true, filter: (source) => source !== join(DEPLOY_DIR, "local") });
		writeFileSync(join(dir, "package.json"), '{ "name": "mihai-harness", "private": true }\n');
		const git = async (...args: string[]): Promise<void> => {
			const result = await run(["git", "-C", dir, ...args]);
			expect(result.code).toBe(0);
		};
		await git("init", "--quiet");
		await git("add", ".");
		await git("-c", "user.name=Deploy Test", "-c", "user.email=deploy@example.test", "commit", "--quiet", "-m", "feat: a commit");
		const sha = (await run(["git", "-C", dir, "rev-parse", "HEAD"])).stdout.trim();
		return { dir, sha };
	}

	/** ssh for the VM: run the command locally, with a HOME of its own so its files are easy to find. */
	function addSshStub(machine: Machine): string {
		const vmHome = join(machine.dir, "vm-home");
		mkdirSync(vmHome, { recursive: true });
		writeScript(join(machine.bin, "ssh"), 'printf "%s\\n" "$2" >> "$STUB_SSH_LOG"\nexec env HOME="$STUB_VM_HOME" bash -c "$2"');
		const log = join(machine.dir, "ssh.log");
		writeFileSync(log, "");
		return log;
	}

	function deployEnvironment(machine: Machine, sshLog: string): Record<string, string> {
		// The VM alone, as before there was a list: the real list also names the laptop, which these tests do not fake.
		const targetsFile = join(machine.dir, "vm-only-targets.json");
		writeFileSync(targetsFile, VM_ONLY_TARGETS);
		return {
			DEPLOY_TARGETS_FILE: targetsFile,
			HOME: machine.home,
			PATH: `${machine.bin}:${process.env.PATH ?? ""}`,
			BUN: join(machine.bin, "bun"),
			XDG_STATE_HOME: join(machine.dir, "state"),
			DEPLOY_HOST_ROOT: join(machine.dir, "host-root"),
			DEPLOY_APP_ROOT: join(machine.dir, "no-app-root"),
			DEPLOY_TAILNET_HOST: "",
			DEPLOY_CGROUP_FILE: machine.cgroupFile,
			STUB_RESTARTS: machine.restartsFile,
			STUB_SSH_LOG: sshLog,
			STUB_VM_HOME: join(machine.dir, "vm-home"),
		};
	}

	test("records a failed build on every backend target and publishes nothing", async () => {
		const machine = makeMachine();
		mkdirSync(join(machine.dir, "host-root"), { recursive: true });
		const sshLog = addSshStub(machine);
		// Every check but the tests passes on the empty tree; the tests are the ones that fail.
		writeScript(join(machine.bin, "bun"), `if [[ \${1:-} == test ]]; then echo "boom" >&2; exit 7; fi\nexec ${BUN} "$@"`);
		const { dir, sha } = await makeRepository();

		const result = await run(["bash", join(dir, "deploy", "deploy.sh"), sha], deployEnvironment(machine, sshLog));

		expect(result.code).toBe(1);
		expect(result.stdout).toContain("tests failed on");
		expect(result.stdout).toContain("host backend: " + join(machine.dir, "host-root", "deploy-status.json") + ": failed");
		expect(result.stdout).toContain("VM backend: recorded the failed attempt on user@vm.example.test");

		const hostStatus = readJson<{ state: string; commit: string; message: string }>(
			join(machine.dir, "host-root", "deploy-status.json"),
		);
		expect(hostStatus.state).toBe("failed");
		expect(hostStatus.commit).toBe(sha);
		expect(hostStatus.message).toContain("tests failed");

		const vmStatus = readJson<{ state: string; commit: string; message: string }>(
			join(machine.dir, "vm-home", ".local", "share", "mihai-harness-deploy", "deploy-status.json"),
		);
		expect(vmStatus).toMatchObject({ state: "failed", commit: sha });
		expect(readFileSync(sshLog, "utf8")).toContain("deploy-status.json");

		// Nothing was published, and neither the app nor the unit knows about the big hammer.
		expect(existsSync(join(machine.dir, "host-root", "releases"))).toBe(false);
		expect(existsSync(join(machine.dir, "no-app-root"))).toBe(false);
	});

	/** A second commit on top of the repository's first, touching `paths` and apps/web, which the web check enters. */
	async function commitChanges(dir: string, paths: string[]): Promise<string> {
		for (const path of [...paths, "apps/web/package.json"]) {
			mkdirSync(join(dir, path, ".."), { recursive: true });
			writeFileSync(join(dir, path), `changed ${path}\n`);
		}
		const git = (...args: string[]) => run(["git", "-C", dir, ...args]);
		expect((await git("add", ".")).code).toBe(0);
		const commit = await git("-c", "user.name=Deploy Test", "-c", "user.email=deploy@example.test", "commit", "--quiet", "-m", "feat: a change");
		expect(commit.code).toBe(0);
		return (await git("rev-parse", "HEAD")).stdout.trim();
	}

	/** A deploy root whose current release runs <commit>; null leaves RELEASE.json out, like a release older than it. */
	function seedRunning(root: string, commit: string | null): void {
		const name = "20261101T000000Z-running";
		mkdirSync(join(root, "releases", name), { recursive: true });
		if (commit !== null) writeFileSync(join(root, "releases", name, "RELEASE.json"), JSON.stringify(release(commit, name)));
		const result = Bun.spawnSync(["ln", "-sfn", `releases/${name}`, join(root, "current")]);
		expect(result.exitCode).toBe(0);
	}

	/**
	 * Everything for a deploy that gets past the checks: the checks stubbed to pass, a VM home with its own Bun, and both
	 * backends answering on the stand-in's port.
	 */
	function fullDeployEnvironment(machine: Machine, sshLog: string, backend: FakeBackend): Record<string, string> {
		const passing = ["case ${1:-} in", "install | test) exit 0 ;;", "run) case ${2:-} in typecheck | check | build) exit 0 ;; esac ;;", "esac", `exec ${BUN} "$@"`].join("\n");
		writeScript(join(machine.bin, "bun"), passing);
		const vmBin = join(machine.dir, "vm-home", ".local", "bin");
		mkdirSync(vmBin, { recursive: true });
		writeScript(join(vmBin, "bun"), passing);
		return {
			...deployEnvironment(machine, sshLog),
			DEPLOY_HOST_ROOT: machine.root,
			DEPLOY_PORT: String(port(backend)),
			DEPLOY_BUN_VERSION: Bun.version,
			DEPLOY_IDLE_POLL_SECONDS: "1",
			DEPLOY_IDLE_TIMEOUT_SECONDS: "5",
			DEPLOY_HEALTH_TIMEOUT_MS: "3000",
		};
	}

	function vmRoot(machine: Machine): string {
		return join(machine.dir, "vm-home", ".local", "share", "mihai-harness-deploy");
	}

	function restarts(machine: Machine): string[] {
		return readFileSync(machine.restartsFile, "utf8").trim().split("\n").filter((line) => line.length > 0);
	}

	type RecordedStatus = { state: string; commit: string; message: string | null; backendUnchanged?: boolean };

	test("leaves a backend running when only the app, docs and deploy tooling changed, and restarts one it cannot compare", async () => {
		const machine = makeMachine();
		const sshLog = addSshStub(machine);
		const { dir, sha: running } = await makeRepository();
		const sha = await commitChanges(dir, [
			"apps/web/src/page.ts",
			"apps/android/app.kt",
			"docs/notes.md",
			"README.md",
			"deploy/test/more.test.ts",
			"deploy/new-tool.sh",
		]);
		// The host runs the first commit; the VM runs a release without RELEASE.json, so its commit is unknown.
		seedRunning(machine.root, running);
		seedRunning(vmRoot(machine), null);
		const backend = startBackend({ deployRoot: vmRoot(machine) });

		const result = await run(["bash", join(dir, "deploy", "deploy.sh"), sha], fullDeployEnvironment(machine, sshLog, backend));

		expect(result.stderr).not.toContain("ERROR");
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(`host backend: nothing it runs changed since ${running.slice(0, 12)}`);
		expect(result.stdout).toMatch(/unchanged, not restarted: http:\/\/127.0.0.1:\d+ answers/);
		expect(result.stdout).toContain("VM backend: its running commit is unknown");
		expect(result.stdout).toContain("VM backend: deployed");

		// Only the VM restarted; the host kept its release but has this deploy's tooling and an ok record that says why.
		expect(restarts(machine)).toEqual([expect.stringMatching(/ user$/)]);
		expect(readFileSync(join(machine.root, "current", "RELEASE.json"), "utf8")).toContain(running);
		expect(existsSync(join(machine.root, "incoming", sha.slice(0, 7)))).toBe(false);
		expect(existsSync(join(machine.root, "tools", "backend.sh"))).toBe(true);
		const host = readJson<RecordedStatus>(join(machine.root, "deploy-status.json"));
		expect(host).toMatchObject({ state: "ok", commit: sha, message: null, backendUnchanged: true });
		const vm = readJson<RecordedStatus>(join(vmRoot(machine), "deploy-status.json"));
		expect(vm).toMatchObject({ state: "ok", commit: sha });
		expect(vm.backendUnchanged).toBeUndefined();
	}, 30_000);

	test("restarts an unchanged VM that just received the VAPID key, which it reads at start", async () => {
		const machine = makeMachine();
		const sshLog = addSshStub(machine);
		const { dir, sha: running } = await makeRepository();
		const sha = await commitChanges(dir, ["docs/notes.md"]);
		seedRunning(machine.root, running);
		seedRunning(vmRoot(machine), running);
		const keyFile = join(machine.home, ".local", "share", "mihai-harness", "notifications", "vapid.json");
		mkdirSync(join(keyFile, ".."), { recursive: true });
		writeFileSync(keyFile, '{"version":1,"publicKey":"p","privateKey":"k"}\n', { mode: 0o600 });
		// The VM restarts, so the stand-in has to report its new release.
		const backend = startBackend({ deployRoot: vmRoot(machine) });

		const result = await run(["bash", join(dir, "deploy", "deploy.sh"), sha], fullDeployEnvironment(machine, sshLog, backend));

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("host backend: nothing it runs changed");
		expect(result.stdout).toContain("VM backend: it just received the VAPID key");
		expect(restarts(machine)).toEqual([expect.stringMatching(/ user$/)]);
		expect(readJson<RecordedStatus>(join(machine.root, "deploy-status.json")).backendUnchanged).toBe(true);
	}, 30_000);

	test("restarts a backend whose unit changed, and one running a commit the repository does not have", async () => {
		const machine = makeMachine();
		const sshLog = addSshStub(machine);
		const { dir, sha: running } = await makeRepository();
		const sha = await commitChanges(dir, ["README.md", "deploy/systemd/mihai-harness.service"]);
		seedRunning(machine.root, OTHER_COMMIT);
		seedRunning(vmRoot(machine), running);
		// The host deploys first, so by the VM's deep check the host's current is the new commit too.
		const backend = startBackend({ deployRoot: machine.root });

		const result = await run(["bash", join(dir, "deploy", "deploy.sh"), sha], fullDeployEnvironment(machine, sshLog, backend));

		expect(result.code).toBe(0);
		expect(result.stdout).toContain(`host backend: cannot compare its running ${OTHER_COMMIT.slice(0, 12)}`);
		expect(result.stdout).toContain(`VM backend: deploy/systemd/mihai-harness.service changed since its running ${running.slice(0, 12)}`);
		expect(restarts(machine).length).toBe(2);
		for (const root of [machine.root, vmRoot(machine)]) {
			const status = readJson<RecordedStatus>(join(root, "deploy-status.json"));
			expect(status).toMatchObject({ state: "ok", commit: sha });
			expect(status.backendUnchanged).toBeUndefined();
		}
	}, 30_000);

	test("refuses to run from inside the server's own cgroup", async () => {
		const machine = makeMachine();
		writeFileSync(
			machine.cgroupFile,
			"0::/user.slice/user-1000.slice/user@1000.service/app.slice/mihai-harness.service\n",
		);
		const sshLog = addSshStub(machine);
		const { dir, sha } = await makeRepository();

		const result = await run(["bash", join(dir, "deploy", "deploy.sh"), sha], deployEnvironment(machine, sshLog));

		expect(result.code).toBe(2);
		expect(result.stdout).toContain("REFUSING to deploy from inside the mihai-harness server's cgroup");
		expect(result.stdout).toContain("Move the main bookmark instead");
		expect(existsSync(join(machine.dir, "host-root", "deploy-status.json"))).toBe(false);
		expect(readFileSync(sshLog, "utf8")).toBe("");
	});
	describe("an intermittent target (the Laptop)", () => {
		const Laptop_SSH = "user@laptop.example.test";

		function laptopHome(machine: Machine): string {
			return join(machine.dir, "laptop-home");
		}
		function laptopRoot(machine: Machine): string {
			return join(laptopHome(machine), ".local", "share", "mihai-harness-deploy");
		}
		function pendingFile(machine: Machine): string {
			return join(machine.dir, "state", "mihai-harness-deploy", "pending", "laptop.json");
		}

		/**
		 * ssh for both remote targets: options and the target are parsed like ssh does, a target named in the "down" file
		 * does not answer (255, like a laptop asleep), anything else runs locally with that target's HOME. `STUB_DROP_AFTER`
		 * models a connection that breaks during backend.sh's release: the command still runs to its end (it runs detached
		 * there), then the connection reports failure and the target stays down.
		 */
		function addTargetsSshStub(machine: Machine): string {
			mkdirSync(join(machine.dir, "vm-home"), { recursive: true });
			mkdirSync(laptopHome(machine), { recursive: true });
			writeScript(
				join(machine.bin, "ssh"),
				[
					'opts=""',
					"while [[ ${1:-} == -* ]]; do",
					'  case $1 in -o|-i) opts="$opts $1 $2"; shift 2 ;; *) shift ;; esac',
					"done",
					'target=$1; command=$2',
					'printf "%s\\t%s\\t%s\\n" "$target" "$opts" "$command" >> "$STUB_SSH_LOG"',
					'if grep -qx "$target" "$STUB_SSH_DOWN"; then exit 255; fi',
					'home=$STUB_VM_HOME; if [[ $target == "user@laptop.example.test" ]]; then home=$STUB_Laptop_HOME; fi',
					'if [[ -n ${STUB_DROP_AFTER:-} && $command == *" release "* && $target == "$STUB_DROP_AFTER" ]]; then',
					'  env HOME="$home" bash -c "$command" >/dev/null 2>&1; echo "$target" >> "$STUB_SSH_DOWN"; exit 255',
					"fi",
					'exec env HOME="$home" bash -c "$command"',
				].join("\n"),
			);
			const log = join(machine.dir, "ssh.log");
			writeFileSync(log, "");
			writeFileSync(join(machine.dir, "ssh-down"), "");
			return log;
		}

		function setDown(machine: Machine, ...targets: string[]): void {
			writeFileSync(join(machine.dir, "ssh-down"), targets.map((target) => `${target}\n`).join(""));
		}

		/** The remote Bun the Laptop's target names: an absolute path, as on the laptop. */
		function laptopBun(machine: Machine): string {
			const bin = join(laptopHome(machine), "bin");
			mkdirSync(bin, { recursive: true });
			const bun = join(bin, "bun");
			writeScript(bun, ['case ${1:-} in', "install | test) exit 0 ;;", "run) case ${2:-} in typecheck | check | build) exit 0 ;; esac ;;", "esac", `exec ${BUN} "$@"`].join("\n"));
			return bun;
		}

		function targetsEnvironment(machine: Machine, sshLog: string, backend: FakeBackend | null, withVm: boolean): Record<string, string> {
			const targets = [
				...(withVm ? [{ name: "vm", label: "VM", ssh: "user@vm.example.test", tailnet: "", unit: "user" }] : []),
				{
					name: "laptop",
					label: "Laptop",
					ssh: Laptop_SSH,
					tailnet: "",
					unit: "system",
					bun: laptopBun(machine),
					identity: "/keys/laptop-g2",
					optional: true,
					shell: "fish",
				},
			];
			const file = join(machine.dir, "targets.json");
			writeFileSync(file, JSON.stringify({ targets }));
			return {
				...fullDeployEnvironment(machine, sshLog, backend ?? startBackend({ deployRoot: laptopRoot(machine) })),
				DEPLOY_TARGETS_FILE: file,
				DEPLOY_PROBE_TIMEOUT_SECONDS: "1",
				STUB_SSH_DOWN: join(machine.dir, "ssh-down"),
				STUB_Laptop_HOME: laptopHome(machine),
			};
		}

		/** The web check enters apps/web, which the bare test repository lacks. */
		async function repositoryWithWeb(): Promise<{ dir: string; sha: string }> {
			const { dir } = await makeRepository();
			return { dir, sha: await commitChanges(dir, []) };
		}

		const remoteCommands = (sshLog: string, target: string): string[] =>
			readFileSync(sshLog, "utf8")
				.split("\n")
				.filter((line) => line.startsWith(`${target}\t`))
				.map((line) => line.split("\t")[2] ?? "");

		test("skips a laptop that does not answer, leaves it pending, and still deploys the others", async () => {
			const machine = makeMachine();
			const sshLog = addTargetsSshStub(machine);
			const { dir, sha } = await repositoryWithWeb();
			// The host runs this very commit (hello only); the VM has none yet, so it deploys for real.
			seedRunning(machine.root, sha);
			const backend = startBackend({ deployRoot: vmRoot(machine) });
			const environment = targetsEnvironment(machine, sshLog, backend, true);
			setDown(machine, Laptop_SSH);

			const result = await run(["bash", join(dir, "deploy", "deploy.sh"), sha], environment);

			expect(result.stderr).not.toContain("ERROR");
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("VM backend: deployed");
			expect(result.stdout).toContain("Laptop backend: SKIPPED, it did not answer ssh within 1s");
			expect(result.stdout).toContain("skipped, pending catch-up: laptop");
			expect(result.stdout).toContain("to every target that answered");
			expect(result.stdout).not.toContain("FAILED");
			// Only the probe was tried on the laptop, with the key and without ever asking a question.
			const attempts = readFileSync(sshLog, "utf8").split("\n").filter((line) => line.startsWith(`${Laptop_SSH}\t`));
			expect(attempts).toHaveLength(1);
			expect(attempts[0]).toContain("-i /keys/laptop-g2 -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=1");
			expect(attempts[0]!.endsWith("\ttrue")).toBe(true);
			expect(existsSync(laptopRoot(machine))).toBe(false);
			// The record the watcher's catch-up reads.
			expect(readJson<{ name: string; commit: string; reason: string }>(pendingFile(machine))).toMatchObject({ name: "laptop", commit: sha });
			expect(readJson<RecordedStatus>(join(vmRoot(machine), "deploy-status.json"))).toMatchObject({ state: "ok", commit: sha });
		}, 30_000);

		test("deploys a laptop that answers like any backend: its own Bun, a system unit, bash under a fish login, no unit file", async () => {
			const machine = makeMachine();
			const sshLog = addTargetsSshStub(machine);
			const { dir, sha } = await repositoryWithWeb();
			const environment = targetsEnvironment(machine, sshLog, null, false);
			mkdirSync(join(machine.dir, "state", "mihai-harness-deploy", "pending"), { recursive: true });
			writeFileSync(pendingFile(machine), "{}\n");

			const result = await run(["bash", join(dir, "deploy", "deploy.sh"), "--only=laptop", sha], environment);

			expect(result.stderr).not.toContain("ERROR");
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("only: laptop (no app, no host backend)");
			expect(result.stdout).toContain("Laptop backend: deployed");
			// A partial deploy leaves the host alone, and a system unit is restarted without --user.
			expect(restarts(machine)).toEqual([expect.not.stringMatching(/ user$/)]);
			expect(restarts(machine)).toHaveLength(1);
			expect(existsSync(join(machine.root, "deploy-status.json"))).toBe(false);
			const root = laptopRoot(machine);
			expect(readFileSync(join(root, "current", "RELEASE.json"), "utf8")).toContain(sha);
			expect(readJson<RecordedStatus>(join(root, "deploy-status.json"))).toMatchObject({ state: "ok", commit: sha });
			expect(existsSync(join(root, "tools", "backend.sh"))).toBe(true);
			expect(existsSync(join(root, "tools", "mihai-harness.service"))).toBe(false);
			expect(existsSync(pendingFile(machine))).toBe(false);
			// Every command went through bash (the laptop's login shell is fish), and backend.sh got the laptop's Bun and
			// the instruction to outlive a dropped connection.
			const commands = remoteCommands(sshLog, Laptop_SSH).filter((command) => command !== "true");
			expect(commands.length).toBeGreaterThan(4);
			for (const command of commands) expect(command).toStartWith("bash -c '");
			const release = commands.find((command) => command.includes("backend.sh system release"));
			expect(release).toContain(`BUN=${join(laptopHome(machine), "bin", "bun")} DEPLOY_SURVIVE_DISCONNECT=1 MIHAI_HARNESS_PORT=`);
			expect(existsSync(join(root, "last-deploy.log"))).toBe(true);
		}, 30_000);

		test("a laptop that answers and then fails its health check is a failure, not a skip", async () => {
			const machine = makeMachine();
			const sshLog = addTargetsSshStub(machine);
			const { dir, sha } = await repositoryWithWeb();
			// Nothing answers on the port: the release cannot pass its health check, and the probe still works.
			const dead = startBackend({ deployRoot: laptopRoot(machine) });
			const environment = targetsEnvironment(machine, sshLog, dead, false);
			dead.stop();

			const result = await run(["bash", join(dir, "deploy", "deploy.sh"), "--only=laptop", sha], environment);

			expect(result.code).toBe(1);
			expect(result.stdout).toContain("FAILED: Laptop backend: did not end up healthy");
			expect(result.stdout).not.toContain("SKIPPED");
			expect(readJson<RecordedStatus>(join(laptopRoot(machine), "deploy-status.json")).state).toBe("failed");
			expect(existsSync(pendingFile(machine))).toBe(false);
		}, 30_000);

		test("a laptop that drops mid-publish is pending, and backend.sh there still finishes the release", async () => {
			const machine = makeMachine();
			const sshLog = addTargetsSshStub(machine);
			const { dir, sha } = await repositoryWithWeb();
			const environment = { ...targetsEnvironment(machine, sshLog, null, false), STUB_DROP_AFTER: Laptop_SSH };

			const result = await run(["bash", join(dir, "deploy", "deploy.sh"), "--only=laptop", sha], environment);

			expect(result.code).toBe(0);
			expect(result.stdout).toContain("Laptop backend: SKIPPED, it went away while publishing");
			expect(result.stdout).not.toContain("FAILED");
			expect(readJson<{ commit: string }>(pendingFile(machine)).commit).toBe(sha);
			// No broken release: the remote script ran to its health check and recorded the result itself.
			expect(readJson<RecordedStatus>(join(laptopRoot(machine), "deploy-status.json"))).toMatchObject({ state: "ok", commit: sha });
		}, 30_000);

		describe("catch-up", () => {
			/** A laptop that runs <running>, with a pending file for the current main. */
			function laptopBehind(machine: Machine, running: string): void {
				seedRunning(laptopRoot(machine), running);
				mkdirSync(join(machine.dir, "state", "mihai-harness-deploy", "pending"), { recursive: true });
				writeFileSync(pendingFile(machine), JSON.stringify({ name: "laptop", commit: running, since: "2026-11-08T00:00:00.000Z" }));
			}

			async function twoCommits(): Promise<{ dir: string; before: string; sha: string }> {
				const { dir, sha: before } = await repositoryWithWeb();
				const sha = await commitChanges(dir, ["packages/server/src/more.ts"]);
				return { dir, before, sha };
			}

			test("does nothing, and says nothing, when no target is pending", async () => {
				const machine = makeMachine();
				const sshLog = addTargetsSshStub(machine);
				const { dir, sha } = await repositoryWithWeb();
				const environment = targetsEnvironment(machine, sshLog, null, true);

				const result = await run(["bash", join(dir, "deploy", "deploy.sh"), "--catch-up", sha], environment);

				expect(result.code).toBe(0);
				expect(result.stdout).toBe("");
				expect(readFileSync(sshLog, "utf8")).toBe("");
			});

			test("stays pending, silently, while the laptop is still away", async () => {
				const machine = makeMachine();
				const sshLog = addTargetsSshStub(machine);
				const { dir, before, sha } = await twoCommits();
				laptopBehind(machine, before);
				const environment = targetsEnvironment(machine, sshLog, null, true);
				setDown(machine, Laptop_SSH);

				const result = await run(["bash", join(dir, "deploy", "deploy.sh"), "--catch-up", sha], environment);

				expect(result.code).toBe(0);
				expect(result.stdout).toBe("");
				expect(existsSync(pendingFile(machine))).toBe(true);
				expect(remoteCommands(sshLog, Laptop_SSH)).toEqual(["true"]);
				expect(restarts(machine)).toEqual([]);
			});

			test("deploys the current main to a laptop that is behind, and to nothing else, without re-running the checks", async () => {
				const machine = makeMachine();
				const sshLog = addTargetsSshStub(machine);
				const { dir, before, sha } = await twoCommits();
				laptopBehind(machine, before);
				const environment = targetsEnvironment(machine, sshLog, null, true);
				// The last full deploy already ran the checks on this commit: a failing `bun test` proves they are not run again.
				writeScript(join(machine.bin, "bun"), `if [[ \${1:-} == test ]]; then echo "re-ran the tests" >&2; exit 7; fi\nexec ${BUN} "$@"`);
				mkdirSync(join(machine.dir, "state", "mihai-harness-deploy", "verified"), { recursive: true });
				writeFileSync(join(machine.dir, "state", "mihai-harness-deploy", "verified", sha), "");
				// The laptop's own tooling is where it left it by an earlier deploy, so it can note the pending deploy.
				mkdirSync(join(laptopRoot(machine), "tools"), { recursive: true });
				cpSync(join(DEPLOY_DIR, "deploy-status.ts"), join(laptopRoot(machine), "tools", "deploy-status.ts"));
				writeFileSync(join(laptopRoot(machine), "deploy-status.json"), JSON.stringify({ state: "ok", commit: before, description: "feat: earlier", message: null, at: "2026-11-08T00:00:00.000Z" }));

				const result = await run(["bash", join(dir, "deploy", "deploy.sh"), "--catch-up", sha], environment);

				expect(result.stderr).not.toContain("re-ran the tests");
				expect(result.code).toBe(0);
				expect(result.stdout).toContain(`Laptop backend: answers again and runs ${before.slice(0, 12)}; catching up to ${sha.slice(0, 12)}`);
				expect(result.stdout).toContain("checks: already passed on this host");
				expect(result.stdout).toContain("Laptop backend: deployed");
				expect(readFileSync(join(laptopRoot(machine), "current", "RELEASE.json"), "utf8")).toContain(sha);
				expect(existsSync(pendingFile(machine))).toBe(false);
				// One restart (the laptop's); not the host, not the VM, not the app.
				expect(restarts(machine)).toHaveLength(1);
				expect(existsSync(join(vmRoot(machine), "releases"))).toBe(false);
				expect(existsSync(join(machine.root, "releases"))).toBe(false);
				expect(readFileSync(sshLog, "utf8")).not.toContain("user@vm.example.test");
				// The app was told why the laptop was behind while the deploy ran: that note is replaced by the real record.
				expect(readFileSync(sshLog, "utf8")).toContain("deploy-status.ts pending");
				expect(readJson<RecordedStatus & { pending?: unknown }>(join(laptopRoot(machine), "deploy-status.json"))).toMatchObject({ state: "ok", commit: sha });
				expect(readJson<{ pending?: unknown }>(join(laptopRoot(machine), "deploy-status.json")).pending).toBeUndefined();
			}, 30_000);

			test("runs the checks once when this host has no marker for the commit, and still skips the app", async () => {
				const machine = makeMachine();
				const sshLog = addTargetsSshStub(machine);
				const { dir, before, sha } = await twoCommits();
				laptopBehind(machine, before);
				const environment = targetsEnvironment(machine, sshLog, null, true);

				const result = await run(["bash", join(dir, "deploy", "deploy.sh"), "--catch-up", sha], environment);

				expect(result.code).toBe(0);
				expect(result.stdout).toContain("checking: bun test");
				expect(result.stdout).toContain("checks passed");
				expect(result.stdout).not.toContain("app:");
				expect(existsSync(join(machine.dir, "state", "mihai-harness-deploy", "verified", sha))).toBe(true);
			}, 30_000);

			test("leaves a laptop alone that already runs main, and one where main already failed", async () => {
				const machine = makeMachine();
				const sshLog = addTargetsSshStub(machine);
				const { dir, before, sha } = await twoCommits();
				const environment = targetsEnvironment(machine, sshLog, null, true);

				// Already on main (the deploy finished there by itself after a drop).
				laptopBehind(machine, sha);
				const upToDate = await run(["bash", join(dir, "deploy", "deploy.sh"), "--catch-up", sha], environment);
				expect(upToDate.code).toBe(0);
				expect(upToDate.stdout).toContain("already has");
				expect(existsSync(pendingFile(machine))).toBe(false);
				expect(restarts(machine)).toEqual([]);

				// Behind, but its record says this commit already rolled back there: do not try it again every two minutes.
				laptopBehind(machine, before);
				writeFileSync(join(laptopRoot(machine), "deploy-status.json"), JSON.stringify({ state: "rolled_back", commit: sha, description: "", message: "x", at: "2026-11-08T00:00:00.000Z" }));
				const failedBefore = await run(["bash", join(dir, "deploy", "deploy.sh"), "--catch-up", sha], environment);
				expect(failedBefore.code).toBe(0);
				expect(failedBefore.stdout).toContain("already rolled_back there");
				expect(existsSync(pendingFile(machine))).toBe(false);
				expect(restarts(machine)).toEqual([]);
			}, 30_000);

			test("gives way to a deploy that holds the lock", async () => {
				const machine = makeMachine();
				const sshLog = addTargetsSshStub(machine);
				const { dir, before, sha } = await twoCommits();
				laptopBehind(machine, before);
				const environment = targetsEnvironment(machine, sshLog, null, true);
				mkdirSync(join(machine.dir, "state", "mihai-harness-deploy"), { recursive: true });
				const lock = join(machine.dir, "state", "mihai-harness-deploy", "deploy.lock");
				const holder = Bun.spawn(["flock", lock, "sleep", "20"]);
				await Bun.sleep(300);
				try {
					const result = await run(["bash", join(dir, "deploy", "deploy.sh"), "--catch-up", sha], environment);
					expect(result.code).toBe(75);
					expect(result.stdout).toBe("");
					expect(existsSync(pendingFile(machine))).toBe(true);
				} finally {
					holder.kill();
				}
			}, 30_000);
		});

		test("deploy-status.ts adds a pending note to the record, and to nothing when there is none", async () => {
			const machine = makeMachine();
			const out = join(machine.dir, "status.json");
			const writer = (...args: string[]) => run([BUN, "run", join(DEPLOY_DIR, "deploy-status.ts"), ...args]);

			const none = await writer("pending", COMMIT, "feat: new", "back online", `--out=${out}`);
			expect(none.code).toBe(0);
			expect(existsSync(out)).toBe(false);

			expect((await writer("ok", OTHER_COMMIT, "feat: old", `--out=${out}`)).code).toBe(0);
			expect((await writer("pending", COMMIT, "feat: new", "back online, deploying feat: new", `--out=${out}`)).code).toBe(0);
			const status = readJson<{ state: string; commit: string; pending: { commit: string; message: string; since: string } }>(out);
			expect(status).toMatchObject({ state: "ok", commit: OTHER_COMMIT });
			expect(status.pending).toMatchObject({ commit: COMMIT, message: "back online, deploying feat: new" });
			expect(Number.isNaN(Date.parse(status.pending.since))).toBe(false);

			// The next real record replaces the file, so the note ends with it.
			expect((await writer("ok", COMMIT, "feat: new", `--out=${out}`)).code).toBe(0);
			expect(readJson<{ pending?: unknown }>(out).pending).toBeUndefined();
			expect((await writer("pending", COMMIT, "x", "y", "--out=-")).code).not.toBe(0);
		});
	});

	test("the real target list keeps the VM's behaviour: with the laptop turned off, the VM deploys as before", async () => {
		const machine = makeMachine();
		const sshLog = addSshStub(machine);
		const { dir, sha: running } = await makeRepository();
		const sha = await commitChanges(dir, ["docs/notes.md"]);
		seedRunning(machine.root, running);
		seedRunning(vmRoot(machine), running);
		const backend = startBackend({ deployRoot: vmRoot(machine) });
		// The public examples stand in for an operator's untracked list; never read this checkout's private config.
		mkdirSync(join(dir, "deploy", "local"), { recursive: true });
		cpSync(join(DEPLOY_DIR, "targets.example.json"), join(dir, "deploy", "local", "targets.json"));
		const { DEPLOY_TARGETS_FILE: _, ...environment } = fullDeployEnvironment(machine, sshLog, backend);

		const result = await run(["bash", join(dir, "deploy", "deploy.sh"), sha], { ...environment, DEPLOY_LAPTOP_ENABLED: "0" });

		expect(result.code).toBe(0);
		expect(result.stdout).toMatch(/VM backend: nothing it runs changed since/);
		expect(result.stdout).toContain("deployed");
		expect(readFileSync(sshLog, "utf8")).toContain("mkdir -p $HOME/.local/share/mihai-harness-deploy/tools");
		// The VM's commands are sent unchanged: no bash wrapper and no extra environment.
		expect(readFileSync(sshLog, "utf8")).not.toContain("bash -c '");
		expect(readFileSync(sshLog, "utf8")).not.toContain("DEPLOY_SURVIVE_DISCONNECT");
		expect(readJson<RecordedStatus>(join(vmRoot(machine), "deploy-status.json"))).toMatchObject({ state: "ok", commit: sha, backendUnchanged: true });
	}, 30_000);

});

describe("vapid-key.sh", () => {
	/** The key file a backend writes: mode 0600, two base64url parts. */
	const keyJson = (name: string): string =>
		`${JSON.stringify({ version: 1, publicKey: `${name}-public`, privateKey: `${name}-private` }, null, "\t")}\n`;

	/** A host with its key file and a VM home the ssh stub runs commands in. */
	function shareMachine(key: string | null, vmKey: string | null): {
		machine: Machine;
		vmKeyFile: string;
		sshLog: string;
	} {
		const machine = makeMachine();
		const keyFile = join(machine.home, ".local", "share", "mihai-harness", "notifications", "vapid.json");
		const vmKeyFile = join(machine.dir, "vm-home", ".local", "share", "mihai-harness", "notifications", "vapid.json");
		if (key !== null) {
			mkdirSync(join(keyFile, ".."), { recursive: true, mode: 0o700 });
			writeFileSync(keyFile, key, { mode: 0o600 });
		}
		if (vmKey !== null) {
			mkdirSync(join(vmKeyFile, ".."), { recursive: true, mode: 0o700 });
			writeFileSync(vmKeyFile, vmKey, { mode: 0o600 });
		}
		mkdirSync(join(machine.dir, "vm-home"), { recursive: true });
		// ssh for the VM: run the command locally, with a HOME of its own, and keep a log of what was asked.
		writeScript(join(machine.bin, "ssh"), 'printf "%s\n" "$2" >> "$STUB_SSH_LOG"' + "\n" + 'exec env HOME="$STUB_VM_HOME" bash -c "$2"');
		const sshLog = join(machine.dir, "vapid-ssh.log");
		writeFileSync(sshLog, "");
		return { machine, vmKeyFile, sshLog };
	}

	function runShare(machine: Machine, sshLog: string): Promise<Run> {
		return run(["bash", VAPID_KEY, "user@vm.example.test"], {
			HOME: machine.home,
			PATH: `${machine.bin}:${process.env.PATH ?? ""}`,
			STUB_SSH_LOG: sshLog,
			STUB_VM_HOME: join(machine.dir, "vm-home"),
		});
	}

	test("copies the host key to a VM that has none, privately, and leaves an identical one alone", async () => {
		const hostKey = keyJson("host");
		const { machine, vmKeyFile, sshLog } = shareMachine(hostKey, null);
		const first = await runShare(machine, sshLog);
		expect(first.code).toBe(0);
		expect(first.stdout).toContain("copied the key to user@vm.example.test");
		expect(readFileSync(vmKeyFile, "utf8")).toBe(hostKey);
		expect(statSync(vmKeyFile).mode & 0o777).toBe(0o600);

		const again = await runShare(machine, sshLog);
		expect(again.code).toBe(0);
		expect(again.stdout).toContain("already has this key");
		expect(readFileSync(vmKeyFile, "utf8")).toBe(hostKey);
	});

	test("replaces a VM key that differs from the host's", async () => {
		const hostKey = keyJson("host");
		const { machine, vmKeyFile, sshLog } = shareMachine(hostKey, keyJson("vm"));
		const result = await runShare(machine, sshLog);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("replaced the key on user@vm.example.test");
		expect(result.stdout).toContain("must subscribe again");
		expect(readFileSync(vmKeyFile, "utf8")).toBe(hostKey);
		expect(statSync(vmKeyFile).mode & 0o777).toBe(0o600);
	});

	test("says so and touches nothing when the host has no key yet", async () => {
		const vmKey = keyJson("vm");
		const { machine, vmKeyFile, sshLog } = shareMachine(null, vmKey);
		const result = await runShare(machine, sshLog);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("creates one at its next start");
		expect(readFileSync(vmKeyFile, "utf8")).toBe(vmKey);
		expect(readFileSync(sshLog, "utf8")).toBe("");
	});
});


describe("watch.sh catch-up", () => {
	/** A repository holding this deploy/ with a deploy.sh that only logs how it was called and exits with `code`. */
	async function watchedRepository(code: number): Promise<{ dir: string; log: string; sha: string }> {
		const dir = mkdtempSync(join(tmpdir(), "demo-watch-repo."));
		cpSync(DEPLOY_DIR, join(dir, "deploy"), { recursive: true, filter: (source) => source !== join(DEPLOY_DIR, "local") });
		const log = join(dir, "calls.log");
		writeFileSync(log, "");
		writeScript(join(dir, "deploy", "deploy.sh"), `printf '%s\\n' "$*" >> "${log}"\nexit ${code}`);
		const git = (...args: string[]) => run(["git", "-C", dir, ...args]);
		await git("init", "--quiet");
		await git("add", ".");
		await git("-c", "user.name=Deploy Test", "-c", "user.email=deploy@example.test", "commit", "--quiet", "-m", "feat: a commit");
		const sha = (await git("rev-parse", "HEAD")).stdout.trim();
		return { dir, log, sha };
	}

	/** Run the watcher for a few seconds with a short catch-up interval, then stop it. */
	async function watchFor(dir: string, state: string, seconds: number): Promise<string> {
		const child = Bun.spawn({
			cmd: ["bash", join(dir, "deploy", "watch.sh")],
			env: { ...process.env, XDG_STATE_HOME: state, DEPLOY_REF: "HEAD", DEPLOY_POLL_SECONDS: "1", DEPLOY_CATCHUP_SECONDS: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		await Bun.sleep(seconds * 1000);
		child.kill();
		return new Response(child.stdout).text();
	}

	function pend(state: string): void {
		const pending = join(state, "mihai-harness-deploy", "pending");
		mkdirSync(pending, { recursive: true });
		writeFileSync(join(pending, "laptop.json"), "{}\n");
	}

	test("does not run a catch-up while nothing is pending", async () => {
		const { dir, log } = await watchedRepository(0);
		const state = mkdtempSync(join(tmpdir(), "demo-watch-state."));
		await watchFor(dir, state, 3.5);
		expect(readFileSync(log, "utf8")).toBe("");
	}, 15_000);

	test("runs a catch-up for the current main while a laptop is pending, every round", async () => {
		const { dir, log, sha } = await watchedRepository(0);
		const state = mkdtempSync(join(tmpdir(), "demo-watch-state."));
		pend(state);
		await watchFor(dir, state, 3.5);
		const calls = readFileSync(log, "utf8").trim().split("\n");
		expect(calls.length).toBeGreaterThanOrEqual(2);
		for (const call of calls) expect(call).toBe(`--catch-up ${sha}`);
	}, 15_000);

	test("does not repeat a catch-up that failed for this commit", async () => {
		const { dir, log, sha } = await watchedRepository(1);
		const state = mkdtempSync(join(tmpdir(), "demo-watch-state."));
		pend(state);
		const output = await watchFor(dir, state, 3.5);
		expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([`--catch-up ${sha}`]);
		expect(output).toContain(`catch-up of ${sha.slice(0, 12)} FAILED (exit 1)`);
	}, 15_000);

	test("treats a deploy that holds the lock (75) as not yet, and tries again", async () => {
		const { dir, log } = await watchedRepository(75);
		const state = mkdtempSync(join(tmpdir(), "demo-watch-state."));
		pend(state);
		const output = await watchFor(dir, state, 3.5);
		expect(readFileSync(log, "utf8").trim().split("\n").length).toBeGreaterThanOrEqual(2);
		expect(output).not.toContain("FAILED");
	}, 15_000);
});
