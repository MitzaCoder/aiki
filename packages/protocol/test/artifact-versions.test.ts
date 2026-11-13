import { expect, test } from "bun:test";
import { Value } from "typebox/value";
import { ArtifactSchema, ArtifactsListRequestSchema, ArtifactsListResponseSchema, ArtifactsUrlRequestSchema } from "../src/artifacts.ts";
import { HARNESS_FEATURES, LEGACY_HARNESS_FEATURES, PROTOCOL_VERSION } from "../src/index.ts";

const legacy = { id: "report", projectId: "p", name: "report.html", title: null, note: null, kind: "text", mimeType: "text/html", size: 12, durationSeconds: null, threadId: "main", workerId: null, taskId: "T1", sourcePath: "/example/report.html", createdAt: "2026-01-01T00:00:00.000Z" };

test("version metadata is additive and version addresses use the existing URL request", () => {
 expect(Value.Check(ArtifactSchema, legacy)).toBe(true);
 const snapshot = { ...legacy, id: "report~1", version: 1, versionCount: 1 };
 expect(Value.Check(ArtifactsListResponseSchema, { type: "artifacts.list", id: "r", artifacts: [{ ...legacy, version: 2, versionCount: 2, versions: [snapshot, { ...snapshot, id: "report~2", version: 2 }] }] })).toBe(true);
 expect(Value.Check(ArtifactsUrlRequestSchema, { type: "artifacts.url", id: "r", projectId: "p", artifactId: "report~1" })).toBe(true);
 expect(Value.Check(ArtifactSchema, { ...legacy, version: 0 })).toBe(false);
 expect(Value.Check(ArtifactSchema, { ...legacy, versions: [{ ...snapshot, size: -1 }] })).toBe(false);
 expect(Value.Check(ArtifactsListRequestSchema, { type: "artifacts.list", id: "r", projectId: "p", artifactId: "report" })).toBe(true);
 expect(PROTOCOL_VERSION).toBe(1);
 expect(HARNESS_FEATURES).toContain("artifact-versions");
 expect(LEGACY_HARNESS_FEATURES).not.toContain("artifact-versions");
});
