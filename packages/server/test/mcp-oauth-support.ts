/** Fake OAuth issuer and protected resource, owned by a createSetup test/demo. */
import { createHash } from "node:crypto";
export function fakeMcpOAuth(autoApprovePage = false, options: { manualConsent?: boolean; registeredClient?: { id: string; secret?: string } } = {}) {
 let access = "synthetic-access-1", refresh = "synthetic-refresh-1", sequence = 1;
 let invalid = false, mismatch = false, registration = true, rejectAccess = false;
 let registrationError: { status: number; body: string } | undefined;
 let refreshes = 0, registrations = 0, inRefresh = 0, maxRefresh = 0, calls = 0;
 const codes = new Map<string, { challenge: string; redirectUri: string }>();
 let issuer: string, resource: string;
 const as = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/oauth-authorization-server") return Response.json({
   issuer: mismatch ? "https://example.com" : issuer,
   authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
   ...(registration ? { registration_endpoint: `${issuer}/register` } : {}),
   response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
   code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: [options.registeredClient?.secret ? "client_secret_post" : "none"],
   authorization_response_iss_parameter_supported: true,
  });
  if (url.pathname === "/register") {
   registrations++;
   if (registrationError) return new Response(registrationError.body, { status: registrationError.status });
   const metadata = await request.json() as object;
   return Response.json({ ...metadata, client_id: "synthetic-client" }, { status: 201 });
  }
  if (url.pathname === "/authorize") {
   if (options.registeredClient && url.searchParams.get("client_id") !== options.registeredClient.id) return new Response("Wrong synthetic client", { status: 400 });
   if (url.searchParams.get("code_challenge_method") !== "S256") return new Response("PKCE required", { status: 400 });
   const code = crypto.randomUUID();
   const redirectUri = url.searchParams.get("redirect_uri")!;
   codes.set(code, { challenge: url.searchParams.get("code_challenge")!, redirectUri });
   const callback = new URL(redirectUri);
   callback.searchParams.set("code", code); callback.searchParams.set("state", url.searchParams.get("state")!);
   callback.searchParams.set("iss", issuer);
   // Synthetic consent only: auto-approve, never a real account.
   if (autoApprovePage) return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><title>Synthetic consent</title><body style="font:20px system-ui;padding:48px;background:#eef4ff;color:#17243b"><h1>Synthetic OAuth consent</h1><p>Aiki requests pages:read on the fake MCP server.</p>${options.manualConsent ? '<p>Only synthetic data is shared.</p><button id="approve-synthetic">Approve synthetic access</button><script>document.querySelector("#approve-synthetic").onclick = () => location.replace(' + JSON.stringify(callback.href) + ')</script>' : '<p>Auto-approving for this isolated demo…</p><script>setTimeout(() => location.replace(' + JSON.stringify(callback.href) + '), 1500)</script>'}`, { headers: { "content-type": "text/html" } });
   return Response.redirect(callback.href, 302);
  }
  if (url.pathname === "/token") {
   const body = new URLSearchParams(await request.text());
   if (options.registeredClient && (body.get("client_id") !== options.registeredClient.id || (options.registeredClient.secret && body.get("client_secret") !== options.registeredClient.secret))) return Response.json({ error: "invalid_client" }, { status: 400 });
   if (body.get("grant_type") === "refresh_token") {
    refreshes++; inRefresh++; maxRefresh = Math.max(maxRefresh, inRefresh);
    await Bun.sleep(15); inRefresh--;
    if (invalid || body.get("refresh_token") !== refresh) return Response.json({ error: "invalid_grant", error_description: access }, { status: 400 });
    sequence++; access = `synthetic-access-${sequence}`; refresh = `synthetic-refresh-${sequence}`;
    rejectAccess = false;
   } else {
    const code = codes.get(body.get("code") ?? ""); codes.delete(body.get("code") ?? "");
    const challenge = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
    if (!code || code.challenge !== challenge || code.redirectUri !== body.get("redirect_uri")) return Response.json({ error: "invalid_grant" }, { status: 400 });
   }
   return Response.json({ access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope: "pages:read" });
  }
  return new Response(null, { status: 404 });
 } });
 issuer = `http://127.0.0.1:${as.port}`;
 const rs = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return Response.json({ resource, authorization_servers: [issuer], scopes_supported: ["pages:read"] });
  if (rejectAccess || request.headers.get("authorization") !== `Bearer ${access}`) return new Response(null, { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${new URL(resource).origin}/.well-known/oauth-protected-resource"` } });
  if (request.method === "GET") return new Response(null, { status: 405 });
  if (request.method === "DELETE") return new Response(null, { status: 204 });
  const message = await request.json() as { id?: number; method: string };
  if (message.id === undefined) return new Response(null, { status: 202 });
  let result: unknown = {};
  if (message.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "Synthetic OAuth MCP", version: "1" } };
  if (message.method === "tools/list") result = { tools: [{ name: "read_page", inputSchema: { type: "object" }, annotations: { readOnlyHint: true }, description: `Read synthetic page ${access} ${options.registeredClient?.id ?? ""} ${options.registeredClient?.secret ?? ""}` }] };
  if (message.method === "tools/call") { calls++; result = { content: [{ type: "text", text: `Synthetic page ${access}` }] }; }
  return Response.json({ jsonrpc: "2.0", id: message.id, result });
 } });
 resource = `http://127.0.0.1:${rs.port}/mcp`;
 return {
  url: resource, issuer,
  get access() { return access; }, get refresh() { return refresh; },
  get refreshes() { return refreshes; }, get registrations() { return registrations; }, get maxRefresh() { return maxRefresh; }, get calls() { return calls; },
  invalidGrant() { invalid = true; rejectAccess = true; }, rejectAccess() { rejectAccess = true; },
  mismatchIssuer() { mismatch = true; }, noRegistration() { registration = false; },
  rejectRegistration(status: number, body: string) { registrationError = { status, body }; },
  async callback(authorizationUrl: string) { const response = await fetch(authorizationUrl, { redirect: "manual", signal: AbortSignal.timeout(5000) }); return response.headers.get("location")!; },
  async close() { await rs.stop(true); await as.stop(true); },
 };
}
