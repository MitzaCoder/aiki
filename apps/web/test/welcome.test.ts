import { expect, test } from "bun:test";
import { needsWelcome } from "../src/lib/welcome.ts";
const fresh = { ready: true, modelsLoaded: true, projectsLoaded: true, projects: [] };
test("fresh local backend gets Welcome, including returning after provider setup", () => { expect(needsWelcome(fresh)).toBe(true); });
test("hosted app does not infer a local backend", () => { expect(needsWelcome(undefined)).toBe(false); });
test("wait for connection and loaded provider/project state", () => {
 for (const flag of ["ready", "modelsLoaded", "projectsLoaded"]) expect(needsWelcome({ ...fresh, [flag]: false })).toBe(false);
});
test("adding the first project completes Welcome", () => { expect(needsWelcome({ ...fresh, projects: [{}] })).toBe(false); });
