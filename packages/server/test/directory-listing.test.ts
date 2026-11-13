import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPLETION_LIMIT } from "@kemiri/protocol";
import { completeDirectory, DIRECTORY_ENTRY_LIMIT, listDirectory } from "../src/directory-listing.ts";
import { ServerError } from "../src/errors.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "mh-dirs-")));
	roots.push(root);
	return root;
}

async function makeTree(root: string): Promise<void> {
	await mkdir(join(root, "alpha"));
	await mkdir(join(root, "Beta"));
	await mkdir(join(root, "zeta"));
	await mkdir(join(root, ".hidden"));
	await mkdir(join(root, "alpha", "nested"));
	await mkdir(join(root, "repo-git", ".git"), { recursive: true });
	await mkdir(join(root, "repo-jj", ".jj"), { recursive: true });
	await mkdir(join(root, "worktree"));
	await writeFile(join(root, "worktree", ".git"), "gitdir: /elsewhere\n");
	await writeFile(join(root, "README.md"), "# not a directory\n");
}

function errorCode(error: unknown): string | undefined {
	return error instanceof ServerError ? error.code : undefined;
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		// A test may have removed read permission from a directory inside it.
		await chmod(join(root, "locked"), 0o700).catch(() => undefined);
		await rm(root, { recursive: true, force: true });
	}
});

describe("listDirectory", () => {
	it("lists subdirectories, sorted, without files or hidden folders", async () => {
		const root = await makeRoot();
		await makeTree(root);

		const listing = await listDirectory({ path: root, home: root });
		expect(listing.path).toBe(root);
		expect(listing.home).toBe(root);
		expect(listing.parent).toBe(await realpath(join(root, "..")));
		expect(listing.truncated).toBe(false);
		expect(listing.entries.map((entry) => entry.name)).toEqual([
			"alpha",
			"Beta",
			"repo-git",
			"repo-jj",
			"worktree",
			"zeta",
		]);
		expect(listing.entries.every((entry) => entry.path.startsWith(`${root}/`))).toBe(true);
	});

	it("includes hidden folders only when asked", async () => {
		const root = await makeRoot();
		await makeTree(root);

		const hidden = await listDirectory({ path: root, showHidden: true });
		expect(hidden.entries.map((entry) => entry.name)).toContain(".hidden");
		const plain = await listDirectory({ path: root, showHidden: false });
		expect(plain.entries.map((entry) => entry.name)).not.toContain(".hidden");
	});

	it("marks directories with .git or .jj, including a .git file", async () => {
		const root = await makeRoot();
		await makeTree(root);

		const listing = await listDirectory({ path: root });
		const repos = listing.entries.filter((entry) => entry.isRepo).map((entry) => entry.name);
		expect(repos).toEqual(["repo-git", "repo-jj", "worktree"]);
		expect(listing.entries.find((entry) => entry.name === "alpha")?.isRepo).toBe(false);
	});

	it("marks the listed directory and its subdirectories that are already projects", async () => {
		const root = await makeRoot();
		await makeTree(root);
		const projects = new Map([
			[join(root, "alpha"), "alpha-1"],
			[join(root, "repo-jj"), "repo-jj-2"],
		]);

		const listing = await listDirectory({ path: root, projects });
		expect(listing.projectId).toBeUndefined();
		expect(listing.entries.find((entry) => entry.name === "alpha")?.projectId).toBe("alpha-1");
		expect(listing.entries.find((entry) => entry.name === "repo-jj")?.projectId).toBe("repo-jj-2");
		expect(listing.entries.find((entry) => entry.name === "Beta")?.projectId).toBeUndefined();

		const inside = await listDirectory({ path: join(root, "alpha"), projects });
		expect(inside.projectId).toBe("alpha-1");
	});

	it("starts at home by default and reports the filesystem root as parentless", async () => {
		const root = await makeRoot();
		await makeTree(root);

		const fromHome = await listDirectory({ home: root });
		expect(fromHome.path).toBe(root);

		const atRoot = await listDirectory({ path: "/" });
		expect(atRoot.parent).toBeNull();
	});

	it("follows symlinks to directories and skips broken or file symlinks", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "real"));
		await writeFile(join(root, "file.txt"), "x");
		await symlink(join(root, "real"), join(root, "link-to-dir"));
		await symlink(join(root, "file.txt"), join(root, "link-to-file"));
		await symlink(join(root, "missing"), join(root, "link-broken"));

		const listing = await listDirectory({ path: root });
		expect(listing.entries.map((entry) => entry.name)).toEqual(["link-to-dir", "real"]);

		// A symlinked directory is listed under its own path but matches the project at its target.
		const projects = new Map([[join(root, "real"), "real-1"]]);
		const marked = await listDirectory({ path: root, projects });
		expect(marked.entries.find((entry) => entry.name === "link-to-dir")?.projectId).toBe("real-1");
	});

	it("reports an unreadable directory as permission_denied and a missing one as invalid_path", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "locked"));
		await writeFile(join(root, "file.txt"), "x");

		const missing = await listDirectory({ path: join(root, "nope") }).catch((error: unknown) => error);
		expect(errorCode(missing)).toBe("invalid_path");

		const file = await listDirectory({ path: join(root, "file.txt") }).catch((error: unknown) => error);
		expect(errorCode(file)).toBe("invalid_path");

		const relative = await listDirectory({ path: "relative/path" }).catch((error: unknown) => error);
		expect(errorCode(relative)).toBe("invalid_path");

		if (process.getuid?.() === 0) return; // root ignores permissions
		await chmod(join(root, "locked"), 0o000);
		const locked = await listDirectory({ path: join(root, "locked") }).catch((error: unknown) => error);
		expect(errorCode(locked)).toBe("permission_denied");
		expect(String(locked)).toContain("permission denied");
	});

	it("caps huge listings and says they were truncated", async () => {
		const root = await makeRoot();
		for (let index = 0; index < DIRECTORY_ENTRY_LIMIT + 3; index++) {
			await mkdir(join(root, `dir-${String(index).padStart(4, "0")}`));
		}

		const listing = await listDirectory({ path: root, limit: 5 });
		expect(listing.entries).toHaveLength(5);
		expect(listing.truncated).toBe(true);
		expect(listing.entries.map((entry) => entry.name)).toEqual(["dir-0000", "dir-0001", "dir-0002", "dir-0003", "dir-0004"]);
	});
});

describe("listing details", () => {
	it("reports the repo kind (jj wins over git) and a last-modified time", async () => {
		const root = await makeRoot();
		await makeTree(root);
		await mkdir(join(root, "colocated", ".git"), { recursive: true });
		await mkdir(join(root, "colocated", ".jj"));

		const listing = await listDirectory({ path: root });
		const kind = (name: string) => listing.entries.find((entry) => entry.name === name)?.repoKind;
		expect(kind("repo-git")).toBe("git");
		expect(kind("repo-jj")).toBe("jj");
		expect(kind("worktree")).toBe("git");
		expect(kind("colocated")).toBe("jj");
		expect(kind("alpha")).toBeUndefined();
		for (const entry of listing.entries) {
			expect(Number.isNaN(Date.parse(entry.modifiedAt ?? ""))).toBe(false);
		}
	});
});

describe("completeDirectory", () => {
	it("lists the folders whose name starts with the last segment, ignoring case", async () => {
		const root = await makeRoot();
		await makeTree(root);
		await mkdir(join(root, "alphabet"));

		const result = await completeDirectory({ input: `${root}/AL`, home: root });
		expect(result.directory).toBe(root);
		expect(result.exact).toBeNull();
		expect(result.entries.map((entry) => entry.name)).toEqual(["alpha", "alphabet"]);
		expect(result.entries[0]?.path).toBe(join(root, "alpha"));
		expect(result.truncated).toBe(false);
	});

	it("lists everything after a trailing slash, repos first, without dot folders", async () => {
		const root = await makeRoot();
		await makeTree(root);

		const result = await completeDirectory({ input: `${root}/`, home: root });
		expect(result.exact).toBe(root);
		expect(result.entries.map((entry) => entry.name)).toEqual([
			"repo-git",
			"repo-jj",
			"worktree",
			"alpha",
			"Beta",
			"zeta",
		]);
		const dotted = await completeDirectory({ input: `${root}/.h`, home: root });
		expect(dotted.entries.map((entry) => entry.name)).toEqual([".hidden"]);
		const all = await completeDirectory({ input: `${root}/`, home: root, showHidden: true });
		expect(all.entries.map((entry) => entry.name)).toContain(".hidden");
	});

	it("reports the folder the input names, and accepts ~", async () => {
		const root = await makeRoot();
		await makeTree(root);

		const named = await completeDirectory({ input: `${root}/alpha`, home: root });
		expect(named.exact).toBe(join(root, "alpha"));
		expect(named.entries.map((entry) => entry.name)).toEqual(["alpha"]);

		const tilde = await completeDirectory({ input: "~/al", home: root });
		expect(tilde.directory).toBe(root);
		expect(tilde.entries.map((entry) => entry.name)).toEqual(["alpha"]);
		expect((await completeDirectory({ input: "~", home: root })).exact).toBe(root);
		expect((await completeDirectory({ input: "~/alpha/", home: root })).entries.map((entry) => entry.name)).toEqual([
			"nested",
		]);
	});

	it("gives no matches, not an error, for a folder that does not exist yet", async () => {
		const root = await makeRoot();
		const result = await completeDirectory({ input: `${root}/nope/deeper`, home: root });
		expect(result).toEqual({ directory: null, exact: null, entries: [], truncated: false });
		const files = await completeDirectory({ input: `${root}/zz`, home: root });
		expect(files.entries).toEqual([]);
	});

	it("rejects a relative input, skips files, marks projects and caps the matches", async () => {
		const root = await makeRoot();
		await writeFile(join(root, "file.txt"), "x");
		for (let index = 0; index < COMPLETION_LIMIT + 2; index++) await mkdir(join(root, `d${String(index).padStart(3, "0")}`));

		const relative = await completeDirectory({ input: "relative/x", home: root }).catch((error: unknown) => error);
		expect(errorCode(relative)).toBe("invalid_path");

		const files = await completeDirectory({ input: `${root}/fi`, home: root });
		expect(files.entries).toEqual([]);

		const capped = await completeDirectory({
			input: `${root}/d`,
			home: root,
			projects: new Map([[join(root, "d001"), "p-1"]]),
		});
		expect(capped.entries).toHaveLength(COMPLETION_LIMIT);
		expect(capped.truncated).toBe(true);
		expect(capped.entries.find((entry) => entry.name === "d001")?.projectId).toBe("p-1");
	});
});
