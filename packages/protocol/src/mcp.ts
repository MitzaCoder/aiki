/** Remote MCP settings. Secrets are write-only; catalogues are untrusted server metadata. */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";
export const McpRoleSchema = Type.Union([
	Type.Literal("coordinator"),
	Type.Literal("workers"),
	Type.Literal("background"),
]);
export type McpRole = Static<typeof McpRoleSchema>;
export const McpPolicySchema = Type.Union([Type.Literal("off"), Type.Literal("ask"), Type.Literal("allow")]);
export type McpPolicy = Static<typeof McpPolicySchema>;
export const McpToolSchema = Type.Object({
	name: Type.String(),
	description: Type.Optional(Type.String()),
	inputSchema: Type.Record(Type.String(), Type.Unknown()),
	annotations: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	policy: McpPolicySchema,
});
export const McpServerSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	url: Type.String(),
	presetId: Type.Optional(Type.String()),
	status: Type.Union([Type.Literal("disconnected"), Type.Literal("connected"), Type.Literal("error")]),
	lastError: Type.Union([Type.String(), Type.Null()]),
	hasCredential: Type.Boolean(),
	authKind: Type.Union([Type.Literal("none"), Type.Literal("token"), Type.Literal("oauth")]),
	tools: Type.Array(McpToolSchema),
});
export type McpServer = Static<typeof McpServerSchema>;
export const McpProjectServerSchema = Type.Object({
	serverId: Type.String(),
	enabled: Type.Boolean(),
	roles: Type.Array(McpRoleSchema),
});
export type McpProjectServer = Static<typeof McpProjectServerSchema>;
export const MCP_PRESETS = [
	{ id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth or token" },
] as const;
export const McpListRequestSchema = Type.Object({ type: Type.Literal("mcp.list"), id: RequestIdSchema });
export const McpAddRequestSchema = Type.Object({
	type: Type.Literal("mcp.add"),
	id: RequestIdSchema,
	serverId: Type.String(),
	name: Type.String(),
	url: Type.Optional(Type.String()),
	presetId: Type.Optional(Type.String()),
});
export const McpTokenSetRequestSchema = Type.Object({
	type: Type.Literal("mcp.token.set"),
	id: RequestIdSchema,
	serverId: Type.String(),
	token: Type.Union([Type.String(), Type.Null()]),
});
export const McpRefreshRequestSchema = Type.Object({
	type: Type.Literal("mcp.refresh"),
	id: RequestIdSchema,
	serverId: Type.String(),
});
export const McpPolicySetRequestSchema = Type.Object({
	type: Type.Literal("mcp.policy.set"),
	id: RequestIdSchema,
	serverId: Type.String(),
	tool: Type.String(),
	policy: McpPolicySchema,
});
export const McpRemoveRequestSchema = Type.Object({
	type: Type.Literal("mcp.remove"),
	id: RequestIdSchema,
	serverId: Type.String(),
});
export const McpDisconnectRequestSchema = Type.Object({
	type: Type.Literal("mcp.disconnect"),
	id: RequestIdSchema,
	serverId: Type.String(),
});
export const McpProjectGetRequestSchema = Type.Object({
	type: Type.Literal("mcp.project.get"),
	id: RequestIdSchema,
	projectId: Type.String(),
});
export const McpProjectSetRequestSchema = Type.Object({
	type: Type.Literal("mcp.project.set"),
	id: RequestIdSchema,
	projectId: Type.String(),
	servers: Type.Array(McpProjectServerSchema),
});
export const McpListResponseSchema = Type.Object({
	type: Type.Literal("mcp.list"),
	id: RequestIdSchema,
	servers: Type.Array(McpServerSchema),
	presets: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), url: Type.String(), auth: Type.String() })),
});
export const McpAddResponseSchema = Type.Object({
	type: Type.Literal("mcp.add"),
	id: RequestIdSchema,
	server: McpServerSchema,
});
export const McpTokenSetResponseSchema = Type.Object({
	type: Type.Literal("mcp.token.set"),
	id: RequestIdSchema,
	server: McpServerSchema,
});
export const McpRefreshResponseSchema = Type.Object({
	type: Type.Literal("mcp.refresh"),
	id: RequestIdSchema,
	server: McpServerSchema,
});
export const McpPolicySetResponseSchema = Type.Object({
	type: Type.Literal("mcp.policy.set"),
	id: RequestIdSchema,
	server: McpServerSchema,
});
export const McpRemoveResponseSchema = Type.Object({ type: Type.Literal("mcp.remove"), id: RequestIdSchema });
export const McpDisconnectResponseSchema = Type.Object({
	type: Type.Literal("mcp.disconnect"),
	id: RequestIdSchema,
	server: McpServerSchema,
});
export const McpProjectGetResponseSchema = Type.Object({
	type: Type.Literal("mcp.project.get"),
	id: RequestIdSchema,
	servers: Type.Array(McpProjectServerSchema),
});
export const McpProjectSetResponseSchema = Type.Object({
	type: Type.Literal("mcp.project.set"),
	id: RequestIdSchema,
	servers: Type.Array(McpProjectServerSchema),
});

export type McpListRequest = Static<typeof McpListRequestSchema>;
export type McpListResponse = Static<typeof McpListResponseSchema>;
export type McpAddRequest = Static<typeof McpAddRequestSchema>;
export type McpAddResponse = Static<typeof McpAddResponseSchema>;
export type McpTokenSetRequest = Static<typeof McpTokenSetRequestSchema>;
export type McpTokenSetResponse = Static<typeof McpTokenSetResponseSchema>;
export type McpRefreshRequest = Static<typeof McpRefreshRequestSchema>;
export type McpRefreshResponse = Static<typeof McpRefreshResponseSchema>;
export type McpPolicySetRequest = Static<typeof McpPolicySetRequestSchema>;
export type McpPolicySetResponse = Static<typeof McpPolicySetResponseSchema>;
export type McpRemoveRequest = Static<typeof McpRemoveRequestSchema>;
export type McpRemoveResponse = Static<typeof McpRemoveResponseSchema>;
export type McpDisconnectRequest = Static<typeof McpDisconnectRequestSchema>;
export type McpDisconnectResponse = Static<typeof McpDisconnectResponseSchema>;
export type McpProjectGetRequest = Static<typeof McpProjectGetRequestSchema>;
export type McpProjectGetResponse = Static<typeof McpProjectGetResponseSchema>;
export type McpProjectSetRequest = Static<typeof McpProjectSetRequestSchema>;
export type McpProjectSetResponse = Static<typeof McpProjectSetResponseSchema>;
