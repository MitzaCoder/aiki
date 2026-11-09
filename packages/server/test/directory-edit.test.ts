import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectory, deleteDirectory, renameDirectory } from "../src/directory-edit.ts";
import { ServerError } from "../src/errors.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "mh-edit-")));
	roots.push(root);
	return root;
}

async function names(path: string): Promise<string[]> {
	return (await readdir(path)).sort();
}

/** The error a call throws, so a test can read its code and message. */
async function failure(call: Promise<unknown>): Promise<ServerError> {
	const error = await call.then(
		() => undefined,
		(thrown: unknown) => thrown,
	);
	expect(error).toBeInstanceOf(ServerError);
	return error as ServerError;
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await chmod(join(root, "locked"), 0o700).catch(() => undefined);
		await rm(root, { recursive: true, force: true });
	}
});

describe("createDirectory", () => {
	it("makes a folder and describes it", async () => {
		const root = await makeRoot();
		const entry = await createDirectory(root, "  fresh ");
		expect(entry.name).toBe("fresh");
		expect(entry.path).toBe(join(root, "fresh"));
		expect(entry.isRepo).toBe(false);
		expect(Number.isNaN(Date.parse(entry.modifiedAt ?? ""))).toBe(false);
		expect(await names(root)).toEqual(["fresh"]);
	});

	it("refuses bad names without touching anything", async () => {
		const root = await makeRoot();
		for (const name of ["", "   ", ".", "..", "a/b", "/abs", "../up", "nul\0byte", "x".repeat(256)]) {
			const error = await failure(createDirectory(root, name));
			expect(error.code).toBe("invalid_path");
		}
		expect(await names(root)).toEqual([]);
		// Dots inside a name are fine.
		await createDirectory(root, "v1..2");
		expect(await names(root)).toEqual(["v1..2"]);
	});

	it("does not clobber an existing folder or file", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "taken"));
		await writeFile(join(root, "file"), "x");
		const folder = await failure(createDirectory(root, "taken"));
		expect(folder.message).toContain("already exists");
		const file = await failure(createDirectory(root, "file"));
		expect(file.message).toContain("already exists");
	});

	it("explains a missing parent, a file as parent and a read-only parent", async () => {
		const root = await makeRoot();
		await writeFile(join(root, "file"), "x");
		expect((await failure(createDirectory(join(root, "nope"), "a"))).message).toContain("No such folder");
		expect((await failure(createDirectory(join(root, "file"), "a"))).message).toContain("Not a folder");
		expect((await failure(createDirectory("relative", "a"))).code).toBe("invalid_path");

		if (process.getuid?.() === 0) return; // root ignores permissions
		await mkdir(join(root, "locked"));
		await chmod(join(root, "locked"), 0o500);
		const denied = await failure(createDirectory(join(root, "locked"), "a"));
		expect(denied.code).toBe("permission_denied");
		expect(denied.message).toContain("permission denied");
	});
});

describe("renameDirectory", () => {
	it("renames within the same parent and keeps the contents", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "old", "inner"), { recursive: true });
		const entry = await renameDirectory(join(root, "old"), "new");
		expect(entry.path).toBe(join(root, "new"));
		expect(await names(root)).toEqual(["new"]);
		expect(await names(join(root, "new"))).toEqual(["inner"]);
	});

	it("refuses bad names, the same name and a name that is taken (even an empty folder)", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "a"));
		await mkdir(join(root, "empty"));
		await writeFile(join(root, "a", "keep.txt"), "keep");
		for (const name of ["", "..", "x/y"]) {
			expect((await failure(renameDirectory(join(root, "a"), name))).code).toBe("invalid_path");
		}
		expect((await failure(renameDirectory(join(root, "a"), "a"))).message).toContain("already called");
		// rename(2) alone would replace the empty folder.
		expect((await failure(renameDirectory(join(root, "a"), "empty"))).message).toContain("already exists");
		expect(await names(root)).toEqual(["a", "empty"]);
		expect(await names(join(root, "a"))).toEqual(["keep.txt"]);
	});

	it("never renames a project, a folder that contains one, or the folders the server needs", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "work", "app"), { recursive: true });
		await mkdir(join(root, "data", "projects"), { recursive: true });
		await mkdir(join(root, "home", "me"), { recursive: true });
		const projects = new Map([[join(root, "work", "app"), "p-1"]]);
		const options = { projects, dataDir: join(root, "data", "projects"), home: join(root, "home", "me") };

		const project = await failure(renameDirectory(join(root, "work", "app"), "other", options));
		expect(project.message).toContain("is an added project");
		const above = await failure(renameDirectory(join(root, "work"), "other", options));
		expect(above.message).toContain("contains a project");
		expect((await failure(renameDirectory(join(root, "data"), "other", options))).message).toContain("own data");
		expect((await failure(renameDirectory(join(root, "home"), "other", options))).message).toContain("home folder");
		expect((await failure(renameDirectory(join(root, "home", "me"), "other", options))).message).toContain("home folder");
		expect((await failure(renameDirectory("/", "other", options))).code).toBe("invalid_path");
		expect(await names(root)).toEqual(["data", "home", "work"]);

		// A sibling of a project is fine.
		await mkdir(join(root, "work", "plain"));
		await renameDirectory(join(root, "work", "plain"), "renamed", options);
		expect(await names(join(root, "work"))).toEqual(["app", "renamed"]);
	});

	it("refuses a symlink and a file, and reports a missing folder", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "real"));
		await symlink(join(root, "real"), join(root, "link"));
		await writeFile(join(root, "file"), "x");
		expect((await failure(renameDirectory(join(root, "link"), "x"))).message).toContain("link");
		expect((await failure(renameDirectory(join(root, "file"), "x"))).message).toContain("not a folder");
		expect((await failure(renameDirectory(join(root, "gone"), "x"))).message).toContain("No such folder");
		expect(await names(root)).toEqual(["file", "link", "real"]);
	});

	it("reports permission denied when the parent is read-only", async () => {
		if (process.getuid?.() === 0) return;
		const root = await makeRoot();
		await mkdir(join(root, "locked", "inside"), { recursive: true });
		await chmod(join(root, "locked"), 0o500);
		const denied = await failure(renameDirectory(join(root, "locked", "inside"), "x"));
		expect(denied.code).toBe("permission_denied");
	});
});

describe("deleteDirectory", () => {
	it("deletes an empty folder", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "empty"));
		expect(await deleteDirectory(join(root, "empty"))).toBe(join(root, "empty"));
		expect(await names(root)).toEqual([]);
	});

	it("refuses a folder with anything in it, hidden files included", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "full"));
		await writeFile(join(root, "full", ".hidden"), "x");
		const error = await failure(deleteDirectory(join(root, "full")));
		expect(error.code).toBe("invalid_path");
		expect(error.message).toContain("This folder is not empty");
		expect(await names(join(root, "full"))).toEqual([".hidden"]);
	});

	it("never deletes a project or a folder that holds one, even an empty-looking one", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "work", "app"), { recursive: true });
		const options = { projects: new Map([[join(root, "work", "app"), "p-1"]]), home: join(root, "elsewhere") };
		expect((await failure(deleteDirectory(join(root, "work", "app"), options))).message).toContain("is an added project");
		expect((await failure(deleteDirectory(join(root, "work"), options))).message).toContain("contains a project");
		expect(await names(join(root, "work"))).toEqual(["app"]);
	});

	it("refuses a symlink, a file and a missing folder, and explains a permission error", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "real"));
		await symlink(join(root, "real"), join(root, "link"));
		await writeFile(join(root, "file"), "x");
		expect((await failure(deleteDirectory(join(root, "link")))).message).toContain("link");
		expect((await failure(deleteDirectory(join(root, "file")))).message).toContain("not a folder");
		expect((await failure(deleteDirectory(join(root, "gone")))).message).toContain("No such folder");
		expect((await failure(deleteDirectory("relative"))).code).toBe("invalid_path");
		expect(await names(root)).toEqual(["file", "link", "real"]);

		if (process.getuid?.() === 0) return;
		await mkdir(join(root, "locked", "inside"), { recursive: true });
		await chmod(join(root, "locked"), 0o500);
		const denied = await failure(deleteDirectory(join(root, "locked", "inside")));
		expect(denied.code).toBe("permission_denied");
	});
});
