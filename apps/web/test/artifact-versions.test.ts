import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Artifact } from "@aiki/protocol";
import { artifactPageDocument } from "../src/lib/artifact-page.ts";
import { artifactVersions, selectedArtifactVersion } from "../src/lib/artifact-versions.ts";

const legacy: Artifact = { id: "a", projectId: "p", name: "report.html", title: null, note: null, kind: "text", mimeType: "text/html", size: 12, durationSeconds: null, threadId: "main", workerId: null, taskId: null, sourcePath: "/example/report.html", createdAt: "" };
const versioned: Artifact = { ...legacy, version: 23, versionCount: 23, versions: [4, 22, 23].map(version => ({ ...legacy, id: "a~" + version, version, note: "Draft " + version, workerId: "worker-" + version })) };

test("theme and CSP decorate the selected version bytes, never the latest bytes instead", () => {
 const bytes = new Map([[4, "<h1>First draft</h1>"], [23, "<h1>Latest draft</h1>"]]);
 for (const version of [4, 23]) {
  const selected = selectedArtifactVersion(versioned, version);
  const document = artifactPageDocument(bytes.get(selected.version!)!, {mode: "dark", tokens: {"tone-bg":"#09090f"}}, true);
  expect(document).toContain(bytes.get(version)!);
  expect(document).not.toContain(bytes.get(version === 4 ? 23 : 4)!);
  expect(document).toContain('data-theme="dark"');
  expect(document).toContain("Content-Security-Policy");
 }
 const viewer = readFileSync(new URL("../src/lib/components/artifacts/ArtifactText.svelte", import.meta.url), "utf8");
 expect(viewer).toContain("artifactId: artifact.id");
 expect(viewer).toContain("artifactPageDocument(content, artifactTheme, blockRequests)");
 expect(viewer).toContain("srcdoc={pageDocument}");
});

test("old backends expose their one snapshot without inventing version addresses", () => {
 expect(artifactVersions(legacy)).toEqual([{ ...legacy, versionCount: 1 }]);
 expect(selectedArtifactVersion(legacy)).toMatchObject({ id: "a", versionCount: 1 });
});
test("latest is the default; selection follows retained numbers, not array positions", () => {
 expect(selectedArtifactVersion(versioned)).toMatchObject({ id: "a~23", versionCount: 23 });
 expect(selectedArtifactVersion(versioned, 4)).toMatchObject({ id: "a~4", note: "Draft 4", workerId: "worker-4", versionCount: 23 });
 expect(selectedArtifactVersion(versioned, 1).id).toBe("a~23");
 expect(artifactVersions(versioned).map(v => v.id)).toEqual(["a~4", "a~22", "a~23"]);
});
test("card version counts stay outside truncated titles and metadata", () => {
 const list = readFileSync(new URL("../src/lib/components/artifacts/ArtifactList.svelte", import.meta.url), "utf8");
 const call = readFileSync(new URL("../src/lib/components/artifacts/ArtifactCallCard.svelte", import.meta.url), "utf8");
 expect(list.match(/data-version-count/g)).toHaveLength(2);
 expect(list).toContain('class="shrink-0 text-[0.625rem] text-(--chat-fg-subtle)" data-version-count');
 expect(call).toContain('class="shrink-0 text-[0.625rem] text-(--chat-fg-subtle)" data-version-count');
});

test("the dialog changes its player and download with selection but deletes the stable artifact", () => {
 const source = readFileSync(new URL("../src/lib/components/artifacts/ArtifactDialog.svelte", import.meta.url), "utf8");
 expect(source).toContain("selectedArtifactVersion(latestArtifact, selectedVersion)");
 expect(source).toContain('aria-label="Previous version"');
 expect(source).toContain('aria-label="Next version"');
 expect(source).toContain("disabled={versionIndex <= 0}");
 expect(source).toContain("disabled={versionIndex >= versions.length - 1}");
 expect(source).toContain("downloadArtifact(client, artifact)");
 expect(source).toContain("const id = latestArtifact!.id");
 expect(source).toContain("selectedVersion = undefined");
});
