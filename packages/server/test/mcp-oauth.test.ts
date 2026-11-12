import { afterEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSetup, TestClient } from "./support.ts";
import { fakeMcpOAuth } from "./mcp-oauth-support.ts";
import { authSecret } from "../src/device-auth.ts";
import type { McpCredential } from "../src/credentials.ts";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const origin = "https://example.com", redirectUri = `${origin}/mcp/oauth/callback`;
async function setup() {
 let now = Date.now(); const logs: string[] = [];
 const test = await createSetup({ allowedOrigins: [origin], now: () => now, log: text => logs.push(text) });
 console.log(`MCP OAuth test dirs: ${test.root}; data=${test.dataDir}; project=${test.projectDir}`);
 cleanups.push(test.cleanup);
 const fake = fakeMcpOAuth(); cleanups.push(fake.close);
 const client = await TestClient.open(test.server); cleanups.push(async () => client.close()); await client.hello();
 const mcp = test.server.manager.mcp!;
 await mcp.add({ serverId: "notion", name: "Synthetic Notion", url: fake.url });
 const start = () => client.request({ type: "mcp.oauth.start", serverId: "notion", redirectUri });
 async function signIn() {
  const started = await start(); if (started.type !== "mcp.oauth.start") throw new Error(JSON.stringify(started));
  const redirectUrl = await fake.callback(started.authorizationUrl);
  const completed = await client.request({ type: "mcp.oauth.complete", redirectUrl });
  expect(completed.type).toBe("mcp.oauth.complete");
  return { started, redirectUrl };
 }
 return { test, fake, client, mcp, start, signIn, logs, advance: (ms: number) => { now += ms; } };
}
it("signs in through discovery/DCR/PKCE and pasted callback; bearer call, secrecy and restart", async () => {
 const { test, fake, client, mcp, signIn, logs } = await setup();
 const { started, redirectUrl } = await signIn();
 expect(fake.registrations).toBe(1);
 expect((await mcp.view("notion")).status).toBe("connected");
 expect((await mcp.view("notion")).oauthFlow?.status).toBe("succeeded");
 const added = await client.request({ type: "projects.add", path: test.projectDir });
 if (added.type !== "projects.add") throw new Error("project");
 const { runtime } = await test.server.manager.open(added.project.id);
 await mcp.setProject(added.project.id, [{ serverId: "notion", enabled: true, roles: ["coordinator"] }]);
 const tool = (await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.find(tool => tool.name.endsWith("__read_page"))!;
 const result = await tool.execute({}, { conversationId: runtime.conversation.id, callId: "synthetic" } as never, BACKGROUND_CONTEXT);
 expect(fake.calls).toBe(1); expect(JSON.stringify(result)).not.toContain(fake.access);
 const listed = await client.request({ type: "mcp.list" });
 for (const secret of [fake.access, fake.refresh]) {
  expect(JSON.stringify(listed)).not.toContain(secret); expect(logs.join("\n")).not.toContain(secret);
  expect(await readFile(mcp.path, "utf8")).not.toContain(secret);
 }
 expect(await client.request({ type: "mcp.oauth.complete", flowId: started.flowId, redirectUrl })).toMatchObject({ type: "error" });
 expect(logs.join("\n")).not.toContain(new URL(redirectUrl).searchParams.get("code")!);
 const stored = await test.credentials.read("mcp:notion") as McpCredential;
 expect(stored.mcp.oauth?.clientInformation?.client_id).toBe("synthetic-client");
 expect(stored.mcp.oauth?.codeVerifier).toBeUndefined();
 await test.restart();
 expect((await test.server.manager.mcp!.refresh("notion")).status).toBe("connected");
}, 20_000);
it("rejects wrong state/device/path, expired/reused/cancelled flows and unapproved redirect origins", async () => {
 const { test, fake, client, mcp, start, advance } = await setup();
 expect(await client.request({ type: "mcp.oauth.start", serverId: "notion", redirectUri: "https://evil.example/mcp/oauth/callback" })).toMatchObject({ type: "error" });
 const started = await start(); if (started.type !== "mcp.oauth.start") throw new Error("start");
 const redirectUrl = await fake.callback(started.authorizationUrl), callback = new URL(redirectUrl);
 expect((await mcp.list())[0]?.status).toBe("signing_in");
 expect(await client.request({ type: "mcp.oauth.complete", flowId: started.flowId, state: "wrong", code: "synthetic" })).toMatchObject({ type: "error" });
 const other = await TestClient.open(test.server); cleanups.push(async () => other.close()); await other.hello();
 expect(await other.request({ type: "mcp.oauth.complete", redirectUrl })).toMatchObject({ type: "error" });
 const wrong = new URL(redirectUrl); wrong.pathname = "/elsewhere";
 expect(await client.request({ type: "mcp.oauth.complete", redirectUrl: wrong.href })).toMatchObject({ type: "error" });
 expect(await client.request({ type: "mcp.oauth.complete", state: callback.searchParams.get("state")!, code: callback.searchParams.get("code")!, iss: callback.searchParams.get("iss")! })).toMatchObject({ type: "mcp.oauth.complete" });
 // Remove tokens to force another browser step instead of refreshing.
 await mcp.setToken("notion", null);
 const expired = await start(); if (expired.type !== "mcp.oauth.start") throw new Error("start");
 const expiredUrl = await fake.callback(expired.authorizationUrl); advance(11 * 60_000);
 expect(await client.request({ type: "mcp.oauth.complete", redirectUrl: expiredUrl })).toMatchObject({ type: "error" });
 expect((await mcp.view("notion")).oauthFlow?.status).toBe("expired");
 const cancelled = await start(); if (cancelled.type !== "mcp.oauth.start") throw new Error("start");
 const cancelledUrl = await fake.callback(cancelled.authorizationUrl);
 await client.request({ type: "mcp.oauth.cancel", flowId: cancelled.flowId });
 expect(await client.request({ type: "mcp.oauth.complete", redirectUrl: cancelledUrl })).toMatchObject({ type: "error" });
}, 20_000);
it("rejects issuer mismatch and clearly reports missing client registration", async () => {
 const { fake, start } = await setup(); fake.mismatchIssuer();
 expect(await start()).toMatchObject({ type: "error", error: { message: expect.stringContaining("issuer mismatch") } });
 const second = await setup(); second.fake.noRegistration();
 expect(await second.start()).toMatchObject({ type: "error", error: { message: expect.stringContaining("needs a registered client") } });
 const third = await setup(); const begun = await third.start(); if (begun.type !== "mcp.oauth.start") throw new Error("start");
 const callback = new URL(await third.fake.callback(begun.authorizationUrl)); callback.searchParams.set("iss", "https://example.com");
 expect(await third.client.request({ type: "mcp.oauth.complete", redirectUrl: callback.href })).toMatchObject({ type: "error", error: { message: expect.stringContaining("issuer mismatch") } });
}, 20_000);
it("serializes concurrent 401/expiry refreshes, persists rotation, invalid_grant needs sign-in", async () => {
 const { test, fake, mcp, signIn } = await setup(); await signIn();
 const a = mcp.oauth.provider("notion"), b = mcp.oauth.provider("notion");
 // Both saw the same rejected token; the store lock makes the second use its rotation.
 const token = fake.access; fake.rejectAccess();
 const response = new Response(null, { status: 401 });
 await Promise.all([a.onUnauthorized({ token, response, fetch, serverUrl: new URL(fake.url) }), b.onUnauthorized({ token, response, fetch, serverUrl: new URL(fake.url) })]);
 expect(fake.refreshes).toBe(1); expect(fake.maxRefresh).toBe(1);
 let credential = await test.credentials.read("mcp:notion") as McpCredential;
 expect(credential.type === "oauth" && credential.access).toBe(fake.access); expect(credential.type === "oauth" && credential.refresh).toBe(fake.refresh);
 expect((await mcp.refresh("notion")).status).toBe("connected");
 await test.credentials.modify("mcp:notion", async current => {
  const value = current as McpCredential; return { ...value, mcp: { ...value.mcp, oauth: { ...value.mcp.oauth!, tokensExpireAt: Date.now() - 1000 } } };
 });
 await Promise.all([a.token(), b.token()]); expect(fake.refreshes).toBe(2);
 credential = await test.credentials.read("mcp:notion") as McpCredential;
 expect(credential.type === "oauth" && credential.refresh).toBe(fake.refresh);
 // Exercise the real resource 401 path, not only provider primitives.
 fake.rejectAccess(); await mcp.refresh("notion"); expect(fake.refreshes).toBe(3);
 fake.invalidGrant();
 expect((await mcp.refresh("notion")).status).toBe("needs_sign_in");
 const count = fake.refreshes;
 expect((await mcp.refresh("notion")).status).toBe("needs_sign_in");
 expect(fake.refreshes).toBe(count);
 expect((await mcp.view("notion")).hasCredential).toBe(false);
}, 20_000);

it("keeps pasted completion bound to the paired session across a socket reconnect", async () => {
 const test = await createSetup({ auth: { mode: "required" }, allowedOrigins: [origin], terminals: false });
 cleanups.push(test.cleanup);
 const fake = fakeMcpOAuth(); cleanups.push(fake.close);
 async function enroll() {
  const grant = test.server.auth.bootstrap();
  return (await test.server.auth.redeem({ grantId: grant.requestId, secret: grant.secret,
   claimId: crypto.randomUUID(), claimSecret: authSecret("aiki_c1"), label: "Synthetic browser", platform: "web" }, "loopback", true)).credentials!;
 }
 async function connect(accessToken: string) {
  const client = await TestClient.open(test.server); cleanups.push(async () => client.close());
  expect(await client.request({ type: "hello", protocolVersion: 1, auth: { accessToken } })).toMatchObject({ type: "hello" });
  return client;
 }
 const credentials = await enroll(); const initial = await connect(credentials.accessToken);
 await initial.request({ type: "mcp.add", serverId: "notion", name: "Synthetic Notion", url: fake.url });
 const started = await initial.request({ type: "mcp.oauth.start", serverId: "notion", redirectUri });
 if (started.type !== "mcp.oauth.start") throw new Error("start");
 initial.close();
 const redirectUrl = await fake.callback(started.authorizationUrl);
 const other = await connect((await enroll()).accessToken);
 expect(await other.request({ type: "mcp.oauth.complete", redirectUrl })).toMatchObject({ type: "error" });
 expect(await other.request({ type: "mcp.oauth.cancel", flowId: started.flowId })).toMatchObject({ type: "error" });
 const reconnected = await connect(credentials.accessToken);
 expect(await reconnected.request({ type: "mcp.oauth.complete", redirectUrl })).toMatchObject({ type: "mcp.oauth.complete", server: { status: "connected" } });
 expect(await reconnected.request({ type: "mcp.oauth.complete", flowId: started.flowId, redirectUrl })).toMatchObject({ type: "error" });
}, 20_000);
