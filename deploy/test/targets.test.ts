/** `deploy/targets.ts`: the list of remote backend targets, its environment overrides and what it refuses. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatTarget, overrideVariable, parseTargets } from "../targets.ts";

const REAL_LIST = readFileSync(join(import.meta.dir, "..", "targets.example.json"), "utf8");
const BUN = process.execPath;
const TARGETS_TS = join(import.meta.dir, "..", "targets.ts");

describe("targets.json", () => {
	test("lists the remote VM exactly as it was hard-coded, and the Laptop as an intermittent system unit", () => {
		const [vm, laptop, ...rest] = parseTargets(REAL_LIST, {});
		expect(rest).toEqual([]);
		expect(vm).toEqual({
			name: "vm",
			label: "VM",
			ssh: "user@vm.example.test",
			tailnet: "vm.example.test",
			unit: "user",
			bun: "",
			identity: "",
			optional: false,
			port: "",
			shell: "",
		});
		expect(laptop).toMatchObject({
			name: "laptop",
			ssh: "user@laptop.example.test",
			tailnet: "laptop.example.test",
			unit: "system",
			bun: "$HOME/.local/bin/bun",
			identity: join(homedir(), ".ssh", "example-deploy"),
			optional: true,
			shell: "fish",
		});
	});

	test("prints one pipe-separated line per target for the bash scripts, empty fields kept", () => {
		const lines = parseTargets(REAL_LIST, {}).map(formatTarget);
		expect(lines[0]).toBe("vm|VM|user@vm.example.test|vm.example.test|user|||||");
		expect(lines[1]!.split("|")).toHaveLength(10);
		expect(lines[1]).toContain("|optional|");
	});

	test("the CLI prints the same lines and can pick one target", () => {
		const all = Bun.spawnSync([BUN, "run", TARGETS_TS, `--file=${join(import.meta.dir, "..", "targets.example.json")}`], { env: { ...process.env, DEPLOY_SSH_TARGET: "", DEPLOY_TAILNET_HOST: undefined } });
		expect(all.stdout.toString().trim().split("\n")).toHaveLength(2);
		const one = Bun.spawnSync([BUN, "run", TARGETS_TS, `--file=${join(import.meta.dir, "..", "targets.example.json")}`, "--name=laptop"]);
		expect(one.stdout.toString().trim().split("\n")).toHaveLength(1);
		expect(one.stdout.toString()).toStartWith("laptop|");
	});
});

describe("overrides", () => {
	test("the old DEPLOY_SSH_TARGET and DEPLOY_TAILNET_HOST still steer the VM, and only the VM", () => {
		const [vm, laptop] = parseTargets(REAL_LIST, { DEPLOY_SSH_TARGET: "me@elsewhere", DEPLOY_TAILNET_HOST: "10.0.0.9" });
		expect(vm).toMatchObject({ ssh: "me@elsewhere", tailnet: "10.0.0.9" });
		expect(laptop).toMatchObject({ ssh: "user@laptop.example.test", tailnet: "laptop.example.test" });
	});

	test("a tailnet host that is set but empty skips the check; an unset one keeps the default", () => {
		expect(parseTargets(REAL_LIST, { DEPLOY_TAILNET_HOST: "" })[0]!.tailnet).toBe("");
		expect(parseTargets(REAL_LIST, {})[0]!.tailnet).toBe("vm.example.test");
		// An empty ssh target is "not set": the default stands, as `${DEPLOY_SSH_TARGET:-user@vm.example.test}` did.
		expect(parseTargets(REAL_LIST, { DEPLOY_SSH_TARGET: "" })[0]!.ssh).toBe("user@vm.example.test");
	});

	test("each target answers DEPLOY_<NAME>_*, and ENABLED=0 leaves it out", () => {
		expect(overrideVariable("laptop", "SSH_TARGET")).toBe("DEPLOY_LAPTOP_SSH_TARGET");
		expect(overrideVariable("my-laptop", "BUN")).toBe("DEPLOY_MY_LAPTOP_BUN");
		const [, laptop] = parseTargets(REAL_LIST, {
			DEPLOY_LAPTOP_SSH_TARGET: "x@y",
			DEPLOY_LAPTOP_TAILNET_HOST: "",
			DEPLOY_LAPTOP_BUN: "$HOME/.local/bin/bun",
			DEPLOY_LAPTOP_OPTIONAL: "0",
			DEPLOY_LAPTOP_PORT: "9000",
		});
		expect(laptop).toMatchObject({ ssh: "x@y", tailnet: "", bun: "$HOME/.local/bin/bun", optional: false, port: "9000" });
		expect(parseTargets(REAL_LIST, { DEPLOY_LAPTOP_ENABLED: "0" }).map((target) => target.name)).toEqual(["vm"]);
		expect(parseTargets(REAL_LIST, { DEPLOY_VM_ENABLED: "false" }).map((target) => target.name)).toEqual(["laptop"]);
	});
});

describe("validation", () => {
	const one = (patch: Record<string, unknown>) => JSON.stringify({ targets: [{ name: "a", ssh: "u@h", unit: "user", ...patch }] });

	test("accepts a bare array and fills in the label with the name", () => {
		const targets = parseTargets(JSON.stringify([{ name: "a", ssh: "u@h", unit: "system" }]), {});
		expect(targets[0]).toMatchObject({ name: "a", label: "a", unit: "system", optional: false });
	});

	test("refuses what would break a script", () => {
		expect(() => parseTargets("{", {})).toThrow("not JSON");
		expect(() => parseTargets("{}", {})).toThrow("expected");
		expect(() => parseTargets(one({ unit: "container" }), {})).toThrow('"unit" must be');
		expect(() => parseTargets(one({ ssh: "" }), {})).toThrow('"ssh" is required');
		expect(() => parseTargets(one({ name: "Bad Name" }), {})).toThrow('"name" must be');
		expect(() => parseTargets(one({ name: "host" }), {})).toThrow("is taken");
		expect(() => parseTargets(one({ ssh: "u@h|x" }), {})).toThrow('must not contain "|"');
		expect(() => parseTargets(one({ optional: "yes" }), {})).toThrow('"optional" must be');
		expect(() =>
			parseTargets(JSON.stringify([{ name: "a", ssh: "x", unit: "user" }, { name: "a", ssh: "y", unit: "user" }]), {}),
		).toThrow("is taken");
	});
});
