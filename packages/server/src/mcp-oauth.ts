/** OAuth grants stay on the backend; only an expiring authorization URL leaves it. */
import type { CredentialStore } from "@earendil-works/pi-ai";
import {
 startMcpSignIn, completeMcpSignIn, createMcpAuthProvider,
 type McpOAuthState, type McpOAuthServerStore, type McpSignInRedirect,
 OAuthIssuerMismatchError, OAuthRegistrationError, McpOAuthAuthorizationRequiredError,
} from "@earendil-works/pi-mcp/oauth";
import type { McpOAuthFlow } from "@aiki/protocol";
import type { McpCredential } from "./credentials.ts";
import { ServerError } from "./errors.ts";

const fail = (message: string): never => { throw new ServerError("bad_request", message); };
function safeError(error: unknown): string {
 if (error instanceof OAuthIssuerMismatchError) return "MCP OAuth issuer mismatch; sign in again";
 if (error instanceof OAuthRegistrationError) {
  // A remote error body can reflect credentials, codes or attacker-supplied text.
  // Report only a recognized protocol reason and status, never that body's description.
  let reason = "";
  try {
   const code = JSON.parse(error.body).error;
   if (["invalid_redirect_uri", "invalid_client_metadata", "invalid_software_statement", "unapproved_software_statement"].includes(code)) reason = `; ${code}`;
  } catch { /* Non-JSON server response: status still explains the failed step. */ }
  return `MCP server refused OAuth client registration (HTTP ${error.status}${reason}). Check the server's redirect address requirements.`;
 }
 if (error instanceof Error && error.message === "Authorization server does not support dynamic client registration")
  return "MCP server needs a registered client; dynamic registration is not advertised";
 return "MCP OAuth failed; check that the server supports dynamic client registration, then sign in again";
}
type Pending = {
 flow: McpOAuthFlow; owner: string; serverUrl: string; redirectUri: string;
 authorization?: McpSignInRedirect; controller: AbortController; starting: boolean;
 ephemeral: Pick<McpOAuthState, "codeVerifier" | "oauthState">;
 timer: ReturnType<typeof setTimeout>;
};
export class McpOAuth {
 readonly #pending = new Map<string, Pending>();
 readonly #locks = new Map<string, Promise<unknown>>();
 readonly #providers = new Set<ReturnType<typeof createMcpAuthProvider>>();
 constructor(
  readonly credentials: CredentialStore,
  readonly origins: readonly string[],
  readonly serverUrl: (id: string) => string,
  readonly changed: (flow: McpOAuthFlow) => void,
  readonly needsSignIn: (id: string) => Promise<void>,
  readonly now: () => number = Date.now,
 ) {}
 #emit(pending: Pending, status: McpOAuthFlow["status"], error?: string) {
  pending.flow = { ...pending.flow, status, ...(error ? { error } : {}) };
  if (status !== "pending") {
   clearTimeout(pending.timer);
   pending.ephemeral = {};
   pending.authorization = undefined;
   pending.controller.abort();
  }
  this.changed(pending.flow);
 }
 flow(serverId: string): McpOAuthFlow | undefined {
  const pending = [...this.#pending.values()].findLast(p => p.flow.serverId === serverId);
  if (pending?.flow.status === "pending" && pending.flow.expiresAt <= this.now()) this.#emit(pending, "expired");
  return pending ? { ...pending.flow } : undefined;
 }
 #store(id: string, url: string, pending?: Pending): McpOAuthServerStore {
  const key = `mcp:${id}`;
  return {
   load: async () => {
    const credential = await this.credentials.read(key) as McpCredential | undefined;
    const state = credential?.type === "oauth" && credential.mcp?.serverUrl === url ? credential.mcp.oauth : undefined;
    return { ...state, serverUrl: url, ...(pending?.ephemeral ?? {}) };
   },
   save: async state => {
    if (this.serverUrl(id) !== url) return;
    const cancelled = pending?.controller.signal.aborted === true;
    const { codeVerifier, oauthState, ...grant } = state;
    if (pending && !cancelled) pending.ephemeral = { codeVerifier, oauthState };
    await this.credentials.modify(key, async current => {
     // A refresh already sent can rotate even after cancellation: never discard its answer.
     if (cancelled && !(pending?.starting && current?.type === "oauth" && current.refresh && state.tokens?.refresh_token && state.tokens.refresh_token !== current.refresh)) return undefined;
     return {
      type: "oauth", access: state.tokens?.access_token ?? "", refresh: state.tokens?.refresh_token ?? "",
      expires: state.tokensExpireAt ?? 0, mcp: { version: 1, serverUrl: url, oauth: grant },
     };
    });
    if (!pending && !state.tokens?.access_token) await this.needsSignIn(id);
   },
   withRefreshLock: async fn => {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    this.#locks.set(key, next);
    try { return await next; } finally { if (this.#locks.get(key) === next) this.#locks.delete(key); }
   },
  };
 }
 async start(serverId: string, redirectUri: string, owner: string): Promise<{flowId: string; authorizationUrl: string; expiresAt: number}> {
  if (!this.origins.some(origin => redirectUri === `${origin}/mcp/oauth/callback`)) return fail("MCP callback must use an allowed web origin and /mcp/oauth/callback");
  this.cancelServer(serverId);
  // Bound the retained terminal history as well as live flow count.
  for (const [id, p] of this.#pending) if (p.flow.status !== "pending") this.#pending.delete(id);
  if (this.#pending.size >= 32) return fail("Too many pending MCP sign-ins");
  const flowId = crypto.randomUUID();
  const expiresAt = this.now() + 10 * 60_000;
  const pending: Pending = {
   flow: { flowId, serverId, status: "pending", expiresAt }, owner, redirectUri,
   serverUrl: this.serverUrl(serverId), controller: new AbortController(), starting: true, ephemeral: {},
   timer: setTimeout(() => this.#emit(pending, "expired"), 10 * 60_000),
  };
  pending.timer.unref();
  this.#pending.set(flowId, pending);
  this.changed(pending.flow);
  try {
   const authorization = await startMcpSignIn({
    serverUrl: pending.serverUrl, store: this.#store(serverId, pending.serverUrl, pending),
    settings: {}, clientName: "Aiki", redirectUrl: redirectUri, signal: pending.controller.signal,
   });
   pending.starting = false;
   if (pending.controller.signal.aborted) return fail("MCP sign-in cancelled or expired");
   if (authorization.kind !== "redirect") {
    this.#emit(pending, "succeeded");
    return { flowId, authorizationUrl: "", expiresAt };
   }
   pending.authorization = authorization;
   this.changed(pending.flow);
   return { flowId, authorizationUrl: authorization.authorizationUrl, expiresAt };
  } catch (error) {
   const message = safeError(error);
   if (pending.flow.status === "pending") this.#emit(pending, "failed", message);
   return fail(message);
  }
 }
 async complete(input: { flowId?: string; state?: string; code?: string; iss?: string; redirectUrl?: string }, owner: string): Promise<string> {
  let { state, code, iss } = input;
  let redirect: URL | undefined;
  if (input.redirectUrl) {
   try { redirect = new URL(input.redirectUrl); } catch { return fail("Invalid MCP redirect URL"); }
   if (redirect.searchParams.getAll("state").length !== 1 || redirect.searchParams.getAll("code").length !== 1) return fail("Invalid MCP callback parameters");
   state = redirect.searchParams.get("state") ?? undefined;
   code = redirect.searchParams.get("code") ?? undefined;
   iss = redirect.searchParams.get("iss") ?? undefined;
  }
  const pending = input.flowId ? this.#pending.get(input.flowId) : [...this.#pending.values()].find(p => p.authorization?.state === state);
  if (!pending || pending.owner !== owner) return fail("Unknown MCP sign-in for this device; return to where you started");
  if (pending.flow.expiresAt <= this.now()) this.#emit(pending, "expired");
  const authorization = pending.authorization;
  if (pending.flow.status !== "pending" || !authorization) return fail("MCP sign-in expired or already used");
  if (!state || state !== authorization.state || !code) return fail("MCP callback state mismatch or missing code");
  if (redirect && (redirect.origin + redirect.pathname !== pending.redirectUri || redirect.username || redirect.password || redirect.hash)) return fail("MCP callback URL does not match the sign-in");
  if (this.serverUrl(pending.flow.serverId) !== pending.serverUrl) return fail("MCP server changed; sign in again");
  // Consume before the first await: a concurrent/replayed callback cannot exchange twice.
  pending.authorization = undefined;
  try {
   await completeMcpSignIn({
    serverUrl: pending.serverUrl, store: this.#store(pending.flow.serverId, pending.serverUrl, pending),
    settings: {}, clientName: "Aiki", redirectUrl: pending.redirectUri, authorization,
    response: { state, code, ...(iss ? { iss } : {}) }, signal: pending.controller.signal,
   });
   if (pending.controller.signal.aborted) return fail("MCP sign-in cancelled or expired");
   this.#emit(pending, "succeeded");
   return pending.flow.serverId;
  } catch (error) {
   const message = safeError(error);
   if (pending.flow.status === "pending") this.#emit(pending, "failed", message);
   return fail(message);
  }
 }
 /** Publish again after catalogue connection so other tabs observe the final server status. */
 notifyStatus(serverId: string): void { const flow = this.flow(serverId); if (flow) this.changed(flow); }
 cancel(flowId: string, owner: string): void {
  const pending = this.#pending.get(flowId);
  if (!pending || pending.owner !== owner) return fail("Unknown MCP sign-in for this device");
  if (pending.flow.status === "pending") this.#emit(pending, "cancelled");
 }
 cancelServer(serverId: string): void {
  for (const pending of this.#pending.values()) if (pending.flow.serverId === serverId && pending.flow.status === "pending") this.#emit(pending, "cancelled");
 }
 provider(serverId: string) {
  const provider = createMcpAuthProvider({
   serverUrl: this.serverUrl(serverId), store: this.#store(serverId, this.serverUrl(serverId)),
   settings: () => ({}), clientName: "Aiki", onChallenge: () => {},
  });
  this.#providers.add(provider);
  return { ...provider, onUnauthorized: async (context: Parameters<NonNullable<typeof provider.onUnauthorized>>[0]) => {
   try { await provider.onUnauthorized?.({ ...context, fetch: globalThis.fetch }); }
   catch (error) {
    if (error instanceof McpOAuthAuthorizationRequiredError) await this.needsSignIn(serverId);
    throw new Error("MCP authorization failed");
   }
  } };
 }
 async close(): Promise<void> {
  for (const p of this.#pending.values()) { clearTimeout(p.timer); p.controller.abort(); }
  await Promise.all([...this.#providers].map(provider => provider.settled()));
  await Promise.allSettled([...this.#locks.values()]);
 }
}
