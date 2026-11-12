import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureJjWorkspace, removeJjWorkspace } from "../src/jj.ts";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("serializes concurrent workspace creation, reuse and removal in one repository", async () => {
	const root = await mkdtemp(join(tmpdir(), "aiki-jj-test-"));
	roots.push(root);
	const repo = join(root, "repo");
	await mkdir(repo);
	await writeFile(join(repo, "README.md"), "# test repository\n");
	const child = Bun.spawn(["jj", "git", "init"], { cwd: repo, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect({ code, stdout, stderr }).toMatchObject({ code: 0 });

	const workspaces = Array.from({ length: 4 }, (_, index) => ({
		repo,
		name: `worker-${index}`,
		path: join(root, `worker-${index}`),
	}));
	// Distinct workers share jj's Git ref export. Repeated calls for the same
	// worker must also be idempotent, even before the first creation finishes.
	await Promise.all(workspaces.flatMap((workspace) => [ensureJjWorkspace(workspace), ensureJjWorkspace(workspace)]));
	for (const workspace of workspaces) {
		expect(await readdir(workspace.path)).toContain("README.md");
	}

	// A failed operation must not strand later creations or cleanups in the queue.
	const retry = { repo, name: "retry", path: join(root, "retry") };
	const failed = ensureJjWorkspace({ ...retry, revision: "missing-revision" });
	const recovered = ensureJjWorkspace(retry);
	await expect(failed).rejects.toThrow("missing-revision");
	await recovered;
	await Promise.all([...workspaces, retry].flatMap((workspace) => [removeJjWorkspace(workspace), removeJjWorkspace(workspace)]));
	expect(await readdir(root)).toEqual(["repo"]);
}, 60_000);
