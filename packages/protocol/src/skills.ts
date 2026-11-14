/** Per-project skill choices. Missing decisions offer a skill to every agent role. */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";
import { SkillSourceSchema } from "./context.ts";
import { McpRoleSchema } from "./mcp.ts";

export const SkillRoleSchema = McpRoleSchema;
export type SkillRole = Static<typeof SkillRoleSchema>;
export const ProjectSkillSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	description: Type.String(),
	path: Type.String({ description: "Absolute path of the winning SKILL.md." }),
	origin: Type.Union([Type.Literal("project"), Type.Literal("global"), Type.Literal("builtin")]),
	source: SkillSourceSchema,
	hides: Type.Array(Type.String()),
	roles: Type.Array(SkillRoleSchema),
	decided: Type.Boolean(),
});
export type ProjectSkill = Static<typeof ProjectSkillSchema>;
export const SkillsProjectGetRequestSchema = Type.Object({
	type: Type.Literal("skills.project.get"), id: RequestIdSchema, projectId: Type.String(),
});
export const SkillsProjectSetRequestSchema = Type.Object({
	type: Type.Literal("skills.project.set"), id: RequestIdSchema, projectId: Type.String(),
	changes: Type.Array(Type.Object({ name: Type.String({ minLength: 1 }), roles: Type.Union([Type.Array(SkillRoleSchema), Type.Null()]) })),
});
export const SkillsProjectGetResponseSchema = Type.Object({
	type: Type.Literal("skills.project.get"), id: RequestIdSchema, projectId: Type.String(), skills: Type.Array(ProjectSkillSchema),
});
export const SkillsProjectSetResponseSchema = Type.Object({
	type: Type.Literal("skills.project.set"), id: RequestIdSchema, projectId: Type.String(), skills: Type.Array(ProjectSkillSchema),
});
export const SkillsProjectChangedEventSchema = Type.Object({
	type: Type.Literal("skills.project.changed"), projectId: Type.String(),
});
export type SkillsProjectGetRequest = Static<typeof SkillsProjectGetRequestSchema>;
export type SkillsProjectSetRequest = Static<typeof SkillsProjectSetRequestSchema>;
export type SkillsProjectGetResponse = Static<typeof SkillsProjectGetResponseSchema>;
export type SkillsProjectSetResponse = Static<typeof SkillsProjectSetResponseSchema>;
export type SkillsProjectChangedEvent = Static<typeof SkillsProjectChangedEventSchema>;
