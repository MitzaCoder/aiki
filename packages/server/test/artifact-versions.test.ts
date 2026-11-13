import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Artifact } from "@aiki/protocol";
import { ArtifactStore, ARTIFACT_VERSION_LIMIT } from "../src/artifacts.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
 const root = await mkdtemp(join(tmpdir(), "artifact-versions-")); roots.push(root);
 const sourcePath = join(root, "report.html"); await writeFile(sourcePath, "<h1>One</h1>");
 let now = 1_800_000_000_000;
 const store = new ArtifactStore({ dataDir: root, now: () => now++, probeDuration: async () => null });
 const input = { projectId: "p", sourcePath, title: "Report", note: "First", threadId: "main", workerId: null, taskId: "T1", tags: ["web", "before"] };
 return { root, store, input };
}

test("same basename and task keeps one stable card and complete immutable metadata", async () => {
 const { store, input } = await fixture();
 const first = await store.save({ ...input, artifactId: "save-one" });
 await writeFile(input.sourcePath, "<h1>Two, longer</h1>");
 const second = await store.save({ ...input, title: "Renamed title", note: "Second", workerId: "worker-two", threadId: "thread-two", tags: ["web", "after"], artifactId: "save-two" });
 expect(second.id).toBe(first.id); expect(second.version).toBe(2);
 expect(await store.list("p")).toHaveLength(1);
 const old = await store.require("p", first.id + "~1");
 expect(old).toMatchObject({ version: 1, title: "Report", note: "First", workerId: null, threadId: "main", tags: ["web", "before"], mimeType: "text/html", size: 12, createdAt: first.createdAt });
 expect(await readFile(store.filePath(old), "utf8")).toBe("<h1>One</h1>");
 expect(await readFile(store.filePath(await store.require("p", first.id)), "utf8")).toBe("<h1>Two, longer</h1>");
 expect(second.versions?.map(v => v.id)).toEqual([first.id + "~1", first.id + "~2"]);
 // A durable rerun returns its original snapshot, never creates a third version, and references the stable card.
 expect(await store.save({ ...input, artifactId: "save-one" })).toMatchObject({ id: first.id, version: 1 });
 expect(await store.save({ ...input, artifactId: "save-two" })).toEqual(second);
 expect((await store.require("p", first.id)).versionCount).toBe(2);
});

test("title is not identity; project, task and unscoped conversation are separate", async () => {
 const { root, store, input } = await fixture();
 const one = await store.save(input);
 await mkdir(join(root, "elsewhere")); await writeFile(join(root, "elsewhere", "report.html"), "Elsewhere");
 expect((await store.save({ ...input, sourcePath: join(root, "elsewhere", "report.html") })).id).toBe(one.id);
 for (const change of [{ taskId: "T2" }, { taskId: null }, { taskId: null, threadId: "thread-two" }, { taskId: null, workerId: "unscoped-worker" }]) {
  expect((await store.save({ ...input, ...change })).id).not.toBe(one.id);
 }
 await writeFile(join(root, "different.html"), "different");
 expect((await store.save({ ...input, sourcePath: join(root, "different.html") })).id).not.toBe(one.id);
 expect((await store.save({ ...input, projectId: "other" })).id).not.toBe(one.id);
 expect(await store.list("p")).toHaveLength(6);
 expect((await store.list("p", { artifactId: one.id }))[0]?.id).toBe(one.id);
});

test("legacy rows migrate only on save; duplicate old names and URLs keep their identities", async () => {
 const { root, store, input } = await fixture();
 const legacy: Artifact = { id: "legacy", projectId: "p", name: "report.html", title: null, note: "Old note", kind: "text", mimeType: "text/html", size: 6, durationSeconds: null, threadId: "main", workerId: null, taskId: "T1", sourcePath: input.sourcePath, createdAt: "2026-01-01T00:00:00.000Z" };
 const indexPath = join(store.dir("p"), "index.json");
 for (const id of ["older", "legacy"]) { await mkdir(join(store.dir("p"), id), { recursive: true }); await writeFile(join(store.dir("p"), id, "report.html"), "legacy"); }
 const index = JSON.stringify({ version: 1, artifacts: [{ ...legacy, id: "older" }, legacy] }); await writeFile(indexPath, index);
 expect((await store.list("p"))[0]).toMatchObject({ id: "legacy", version: 1, versionCount: 1 });
 expect((await store.require("p", "legacy~1")).note).toBe("Old note");
 expect(await readFile(indexPath, "utf8")).toBe(index); // Reads do not touch disk.
 const saved = await store.save(input); expect(saved.id).toBe("legacy"); expect(saved.version).toBe(2);
 const reopened = new ArtifactStore({ dataDir: root });
 expect(await reopened.list("p")).toHaveLength(2);
 expect(await readFile(reopened.filePath(await reopened.require("p", "legacy~1")), "utf8")).toBe("legacy");
 expect(await readFile(reopened.filePath(await reopened.require("p", "older")), "utf8")).toBe("legacy");
});

test("any legacy filename, including versions, can gain a snapshot without a directory collision", async () => {
 const { root, store, input } = await fixture();
 const sourcePath = join(root, "versions"); await writeFile(sourcePath, "First");
 const first = await store.save({ ...input, sourcePath });
 await writeFile(sourcePath, "Second");
 const second = await store.save({ ...input, sourcePath });
 expect(second.id).toBe(first.id); expect(second.version).toBe(2);
 expect(await readFile(store.filePath(await store.require("p", first.id + "~1")), "utf8")).toBe("First");
 expect(await readFile(store.filePath(second), "utf8")).toBe("Second");
});

test("concurrent saves serialize, keep the newest 20, prune bytes and never reuse version numbers", async () => {
 const { store, input, root } = await fixture();
 const saves = await Promise.all(Array.from({ length: ARTIFACT_VERSION_LIMIT + 3 }, (_, n) => store.save({ ...input, artifactId: "receipt-" + n })));
 expect(new Set(saves.map(v => v.id)).size).toBe(1);
 expect(saves.map(v => v.version)).toEqual(Array.from({ length: 23 }, (_, n) => n + 1));
 const latest = (await store.list("p"))[0]!;
 expect(latest.versionCount).toBe(23); expect(latest.versions).toHaveLength(20);
 expect(latest.versions?.[0]?.version).toBe(4);
 for (const version of [1, 2, 3]) {
  expect(await store.get("p", latest.id + "~" + version)).toBeUndefined();
  expect(await Bun.file(store.filePath({ ...latest, version })).exists()).toBe(false);
 }
 for (const version of latest.versions!) expect(await Bun.file(store.filePath(version)).exists()).toBe(true);
 const reopened = new ArtifactStore({ dataDir: root });
 expect((await reopened.save(input)).version).toBe(24);
 expect((await reopened.save({ ...input, artifactId: "receipt-0" })).id).toBe(latest.id);
 expect((await reopened.require("p", latest.id)).versionCount).toBe(24);
 await reopened.delete("p", latest.id);
 expect(await reopened.list("p")).toEqual([]);
 expect(await Bun.file(join(store.dir("p"), latest.id + ".versions", "24", "report.html")).exists()).toBe(false);
});
