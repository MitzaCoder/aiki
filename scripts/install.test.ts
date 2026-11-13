import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
 const home = await mkdtemp(join(tmpdir(), "aiki-install-test-")); roots.push(home);
 const root = join(home, "install"); const bin = join(home, "bin"); await mkdir(bin);
 async function run(args: string[]) {
  const child = Bun.spawn(["sh", resolve(import.meta.dir, "../install.sh"), "--dir", root, "--no-service", ...args], {
   env: { HOME: home, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, message: out + err };
 }
 async function uname(os: string, arch: string) { await writeFile(join(bin, "uname"), `#!/bin/sh\ncase $1 in -s) echo ${os};; -m) echo ${arch};; esac\n`, { mode: 0o755 }); }
 return { home, root, run, uname };
}
test("unsupported operating systems explain WSL without creating an installation", async () => {
 const fixture = await setup(); await fixture.uname("Windows_NT", "x86_64");
 const result = await fixture.run([]); expect(result.code).toBe(1); expect(result.message).toContain("WSL"); expect(existsSync(fixture.root)).toBe(false);
});
test("unsupported architectures fail clearly", async () => {
 const fixture = await setup(); await fixture.uname("Linux", "riscv64");
 expect((await fixture.run([])).message).toContain("Supported architectures");
});
test("missing option arguments and destructive path choices fail before writing", async () => {
 const fixture = await setup();
 expect((await fixture.run(["--version"])).message).toContain("needs a value");
 expect((await fixture.run(["--dir", "/"])).message).toContain("unsafe install directory");
 expect((await fixture.run(["--purge"])).message).toContain("requires --uninstall");
});
test("an existing unmanaged data directory is never adopted", async () => {
 const fixture = await setup(); await mkdir(fixture.root); await writeFile(join(fixture.root, "keep"), "synthetic data");
 expect((await fixture.run([])).message).toContain("not a Kemiri-managed installation");
 expect(await readFile(join(fixture.root, "keep"), "utf8")).toBe("synthetic data");
});
test("a foreign launcher is never replaced", async () => {
 const fixture = await setup(); await mkdir(join(fixture.home, ".local/bin"), { recursive: true });
 const launcher = join(fixture.home, ".local/bin/kemiri"); await writeFile(launcher, "unrelated command");
 expect((await fixture.run([])).message).toContain("refusing to overwrite");
 expect(await readFile(launcher, "utf8")).toBe("unrelated command");
});
test("a corrupt archive is rejected before changing the selected release", async () => {
 const fixture = await setup(); await mkdir(join(fixture.root, "runtime/bun-1.4.4/bin"), { recursive: true });
 await writeFile(join(fixture.root, ".aiki-managed"), "aiki-installer-v1\n");
 await symlink(process.execPath, join(fixture.root, "runtime/bun-1.4.4/bin/bun"));
 const archive = join(fixture.home, "bad.tar.gz"); await writeFile(archive, "corrupt archive"); await writeFile(archive + ".sha256", "0".repeat(64));
 const result = await fixture.run(["--version", "v0.1.0", "--archive", archive]);
 expect(result.message).toContain("archive checksum mismatch"); expect(existsSync(join(fixture.root, "current"))).toBe(false);
 expect(existsSync(join(fixture.root, ".install-lock"))).toBe(false);
});
