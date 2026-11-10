import { expect, test } from "bun:test";
import { needsWelcome } from "../src/lib/welcome.ts";
const fresh = { ready: true, modelsLoaded: true, projectsLoaded: true, projects: [] };
test("fresh local backend gets Welcome, including returning after provider setup", () => { expect(needsWelcome(fresh)).toBe(true); });
test("hosted app does not infer a local backend", () => { expect(needsWelcome(undefined)).toBe(false); });
test("wait for connection and loaded provider/project state", () => {
 for (const flag of ["ready", "modelsLoaded", "projectsLoaded"]) expect(needsWelcome({ ...fresh, [flag]: false })).toBe(false);
});
test("required sign-in is shown before any private provider or project state loads", () => {
 expect(needsWelcome({ ready: false, modelsLoaded: false, projectsLoaded: false, projects: [], authMode: "required" })).toBe(true);
 expect(needsWelcome({ ...fresh, ready: false, authMode: "required", authSessionId: "synthetic-session" })).toBe(false);
});
test("adding the first project completes Welcome", () => { expect(needsWelcome({ ...fresh, projects: [{}] })).toBe(false); });
