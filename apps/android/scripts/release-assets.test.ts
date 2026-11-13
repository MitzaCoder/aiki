import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const aliasScript = new URL("./release-asset-alias.sh", import.meta.url).pathname;

for (const suffix of ["universal.apk", "notices-and-source.tar.gz"]) {
	test(`Android ${suffix} has identical legacy bytes and valid named sidecars`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "kemiri-android-assets-"));
		try {
			const canonical = `kemiri-v0.1.0-pilot.4-android-${suffix}`;
			const legacy = canonical.replace("kemiri-", "aiki-");
			const bytes = new Uint8Array([0, 255, 42, 128, 10]);
			await writeFile(join(directory, canonical), bytes);
			const run = () => Bun.spawn(["bash", aliasScript, join(directory, canonical)], { stdout: "pipe", stderr: "pipe" });
			expect(await run().exited).toBe(0);
			expect(await readFile(join(directory, legacy))).toEqual(Buffer.from(bytes));
			for (const name of [canonical, legacy]) {
				const check = Bun.spawn(["sha256sum", "--check", `${name}.sha256`], { cwd: directory, stdout: "pipe", stderr: "pipe" });
				expect(await check.exited).toBe(0);
				expect(await readFile(join(directory, `${name}.sha256`), "utf8")).toContain(`  ${name}\n`);
			}
			// Never silently replace an already published asset or checksum.
			expect(await run().exited).toBe(1);
			expect(await readFile(join(directory, legacy))).toEqual(Buffer.from(bytes));
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}

test("release producers call the byte-copy helper, never sign or compress twice", async () => {
	for (const filename of ["sign-release.sh", "bundle-release-notices.sh"]) {
		const source = await readFile(new URL(filename, import.meta.url), "utf8");
		expect(source).toContain('name="kemiri-$version-android-');
		expect(source).toContain('bash "$root/apps/android/scripts/release-asset-alias.sh" "$out/$name"');
	}
});
