import { expect, it } from "bun:test";
import { Value } from "typebox/value";
import { ClientMessageSchema, ServerMessageSchema, HARNESS_FEATURES, LEGACY_HARNESS_FEATURES } from "../src/index.ts";

it("advertises project-skills without assuming it for legacy hello", () => {
	expect(HARNESS_FEATURES).toContain("project-skills");
	expect(LEGACY_HARNESS_FEATURES).not.toContain("project-skills");
});

it("validates skill requests, role decisions and reset through the message unions", () => {
	expect(Value.Check(ClientMessageSchema, { type: "skills.project.get", id: "r", projectId: "p" })).toBe(true);
	for (const roles of [[], ["coordinator", "workers", "background"], null]) {
		expect(Value.Check(ClientMessageSchema, { type: "skills.project.set", id: "r", projectId: "p", changes: [{ name: "testing", roles }] })).toBe(true);
	}
	for (const roles of [["other"], false, "workers"]) {
		expect(Value.Check(ClientMessageSchema, { type: "skills.project.set", id: "r", projectId: "p", changes: [{ name: "testing", roles }] })).toBe(false);
	}
});

it("validates catalogues and the change event through the server message union", () => {
	const skill = { name: "testing", description: "Test guidance", path: "/example/skills/testing/SKILL.md", origin: "builtin", source: "harness", hides: ["/example/other/SKILL.md"], roles: [], decided: true };
	for (const type of ["skills.project.get", "skills.project.set"]) {
		expect(Value.Check(ServerMessageSchema, { type, id: "r", projectId: "p", skills: [skill] })).toBe(true);
		expect(Value.Check(ServerMessageSchema, { type, id: "r", skills: [skill] })).toBe(false);
	}
	expect(Value.Check(ServerMessageSchema, { type: "skills.project.changed", projectId: "p" })).toBe(true);
});
