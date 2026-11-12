/** Remote MCP settings. Secrets are write-only; catalogues are untrusted server metadata. */
import { type Static, Type } from "typebox";
import { McpPresetSchema } from "./mcp-presets.ts";
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
export const McpOAuthFlowSchema = Type.Object({
 flowId: Type.String(), serverId: Type.String(), expiresAt: Type.Number(),
 status: Type.Union([Type.Literal("pending"), Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("expired")]),
 error: Type.Optional(Type.String()),
});
export type McpOAuthFlow = Static<typeof McpOAuthFlowSchema>;
export const McpCommandSchema = Type.Object({
 command: Type.String(), args: Type.Array(Type.String()), cwd: Type.Optional(Type.String()),
});
export type McpCommand = Static<typeof McpCommandSchema>;
export const McpServerSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	url: Type.String(),
	transport: Type.Optional(Type.Union([Type.Literal("http"), Type.Literal("sse")])),
	command: Type.Optional(McpCommandSchema),
	envNames: Type.Optional(Type.Array(Type.String())),
	stderrTail: Type.Optional(Type.String()),
	presetId: Type.Optional(Type.String()),
	status: Type.Union([Type.Literal("disconnected"), Type.Literal("connected"), Type.Literal("error"), Type.Literal("needs_sign_in"), Type.Literal("signing_in")]),
	lastError: Type.Union([Type.String(), Type.Null()]),
	hasCredential: Type.Boolean(),
 hasOAuthClient: Type.Optional(Type.Boolean()),
	oauthFlow: Type.Optional(McpOAuthFlowSchema),
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
export { MCP_PRESETS, MCP_PRESET_GROUPS, mcpCliSetupMessage, mcpPresetQueryAllowed, type McpPreset } from "./mcp-presets.ts";
export const McpListRequestSchema = Type.Object({ type: Type.Literal("mcp.list"), id: RequestIdSchema });
export const McpAddRequestSchema = Type.Object({
	type: Type.Literal("mcp.add"),
	id: RequestIdSchema,
	serverId: Type.String(),
	name: Type.String(),
	url: Type.Optional(Type.String()),
	presetId: Type.Optional(Type.String()),
 transport: Type.Optional(Type.Union([Type.Literal("http"), Type.Literal("sse")])),
 command: Type.Optional(McpCommandSchema),
 env: Type.Optional(Type.Record(Type.String(), Type.String())),
 confirmed: Type.Optional(Type.Boolean()),
 replace: Type.Optional(Type.Boolean()),
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
	presets: Type.Array(McpPresetSchema),
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

export const McpOAuthStartRequestSchema = Type.Object({
 type: Type.Literal("mcp.oauth.start"), id: RequestIdSchema, serverId: Type.String(), redirectUri: Type.String(),
 clientId: Type.Optional(Type.String()), clientSecret: Type.Optional(Type.String()),
});
export const McpOAuthStartResponseSchema = Type.Object({
 type: Type.Literal("mcp.oauth.start"), id: RequestIdSchema, flowId: Type.String(), authorizationUrl: Type.String(), expiresAt: Type.Number(),
});
export const McpOAuthCompleteRequestSchema = Type.Object({
 type: Type.Literal("mcp.oauth.complete"), id: RequestIdSchema,
 flowId: Type.Optional(Type.String()), state: Type.Optional(Type.String()), code: Type.Optional(Type.String()),
 iss: Type.Optional(Type.String()), redirectUrl: Type.Optional(Type.String()),
});
export const McpOAuthCompleteResponseSchema = Type.Object({
 type: Type.Literal("mcp.oauth.complete"), id: RequestIdSchema, server: McpServerSchema,
});
export const McpOAuthCancelRequestSchema = Type.Object({
 type: Type.Literal("mcp.oauth.cancel"), id: RequestIdSchema, flowId: Type.String(),
});
export const McpOAuthCancelResponseSchema = Type.Object({ type: Type.Literal("mcp.oauth.cancel"), id: RequestIdSchema });
export const McpOAuthChangedEventSchema = Type.Object({ type: Type.Literal("mcp.oauth.changed"), flow: McpOAuthFlowSchema });
export type McpOAuthStartRequest = Static<typeof McpOAuthStartRequestSchema>;
export type McpOAuthStartResponse = Static<typeof McpOAuthStartResponseSchema>;
export type McpOAuthCompleteRequest = Static<typeof McpOAuthCompleteRequestSchema>;
export type McpOAuthCompleteResponse = Static<typeof McpOAuthCompleteResponseSchema>;
export type McpOAuthCancelRequest = Static<typeof McpOAuthCancelRequestSchema>;
export type McpOAuthCancelResponse = Static<typeof McpOAuthCancelResponseSchema>;
export type McpOAuthChangedEvent = Static<typeof McpOAuthChangedEventSchema>;
