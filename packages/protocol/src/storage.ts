/**
 * Project storage: what a project's worker and thread workspaces take on disk, and cleaning up finished ones.
 *
 * Worker workspaces (jj workspaces or folders) and background-thread checkouts live in the data directory and can
 * grow large (dependencies, build caches, emulator images). A finished one is "removable": its worker was forgotten
 * or its thread is done, stopped or archived. Cleaning removes the folder (and forgets the jj workspace) and never
 * touches the project checkout itself.
 */
import { type Static, Type } from "typebox";
import { ProjectIdSchema, RequestIdSchema } from "./common.ts";

export const StorageItemSchema = Type.Object({
	id: Type.String({ minLength: 1, description: '"worker:<threadId>/<workerId>" or "thread:<threadId>".' }),
	kind: Type.Union([Type.Literal("worker"), Type.Literal("thread")]),
	label: Type.String({ description: "The worker's or thread's title." }),
	path: Type.String(),
	bytes: Type.Integer({ minimum: 0 }),
	removable: Type.Boolean({ description: "Finished: safe to remove." }),
	updatedAt: Type.String(),
});
export type StorageItem = Static<typeof StorageItemSchema>;

export const ProjectsStorageRequestSchema = Type.Object({
	type: Type.Literal("projects.storage"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
});
export type ProjectsStorageRequest = Static<typeof ProjectsStorageRequestSchema>;

/** Remove these finished workspaces, or every removable one when `itemIds` is absent. Running ones are refused. */
export const ProjectsStorageCleanRequestSchema = Type.Object({
	type: Type.Literal("projects.storage.clean"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	itemIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export type ProjectsStorageCleanRequest = Static<typeof ProjectsStorageCleanRequestSchema>;

export const ProjectsStorageResponseSchema = Type.Object({
	type: Type.Literal("projects.storage"),
	id: RequestIdSchema,
	totalBytes: Type.Integer({ minimum: 0 }),
	items: Type.Array(StorageItemSchema, { description: "Largest first." }),
	measuredAt: Type.String({ description: "Sizes are measured in the background and cached for a few minutes." }),
});
export type ProjectsStorageResponse = Static<typeof ProjectsStorageResponseSchema>;

export const ProjectsStorageCleanResponseSchema = Type.Object({
	type: Type.Literal("projects.storage.clean"),
	id: RequestIdSchema,
	removed: Type.Array(Type.String()),
	freedBytes: Type.Integer({ minimum: 0 }),
	refused: Type.Array(Type.Object({ id: Type.String(), reason: Type.String() })),
});
export type ProjectsStorageCleanResponse = Static<typeof ProjectsStorageCleanResponseSchema>;
