import { afterEach, expect, test } from "bun:test";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FileCredentialStore } from "../src/credentials.ts";
import { startServer, type HarnessServer } from "../src/server.ts";
import { TestClient } from "./support.ts";
import { authSecret } from "../src/device-auth.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test("fresh installed SPA requires sign-in and pairs through the CLI's existing local owner socket", async () => {
 const root = await mkdtemp(join(tmpdir(), "aiki-local-auth-"));
 cleanups.push(() => rm(root, { recursive: true, force: true }));
 const dataDir = join(root, "data"), configDir = join(root, "config"), webDir = join(root, "web");
 await mkdir(webDir); await writeFile(join(webDir, "200.html"), "<h1>Synthetic local app</h1>");
 const credentials = new FileCredentialStore(join(dataDir, "credentials.json"));
 const models = createModels({ credentials }); models.setProvider(fauxProvider().provider);
 console.log(JSON.stringify({ dataDir, configDir })); // Before opening any backend state.
 const server: HarnessServer = await startServer({ dataDir, configDir, webDir, agentDir: join(root, "agent"), claudeDir: join(root, "claude"), port: 0, models, credentials, terminals: false, log: () => {} });
 cleanups.push(() => server.stop());
 expect(server.auth.mode).toBe("required");
 expect(await (await fetch(server.url)).text()).toContain("Synthetic local app");
 expect((await fetch(server.url + "/auth/status")).status).toBe(200);
 expect((await fetch(server.url + "/auth/status", { headers: { origin: "http://example.test" } })).status).toBe(403);
 expect((await fetch(server.url, { headers: { host: "example.test" } })).status).toBe(403);
 const anonymous = await TestClient.open(server, { origin: server.url }); cleanups.push(async () => anonymous.close());
 expect(await anonymous.hello()).toMatchObject({ type: "error", error: { code: "auth_required" } });
 expect((await fetch(server.url + "/artifacts/project/file")).status).toBe(403);

 // Generate installation metadata without installing a service or copying a runtime.
 await mkdir(join(root, "releases/v0.0.1-test"), { recursive: true });
 await writeFile(join(root, "releases/v0.0.1-test/.ready"), "v0.0.1-test");
 await mkdir(join(root, "releases/v0.0.1-test/packages/server/src"), { recursive: true });
 await writeFile(join(root, "releases/v0.0.1-test/packages/server/src/main.ts"), `export { runServerEntry } from ${JSON.stringify(join(import.meta.dir, "../src/main.ts"))};`);
 await writeFile(join(root, ".aiki-managed"), "aiki-installer-v1\n");
 const cli = resolve(import.meta.dir, "../../../scripts/aiki.ts");
 const env = { HOME: join(root, "home"), PATH: process.env.PATH, KEMIRI_INSTALL_DIR: root, KEMIRI_PORT: String(server.port), KEMIRI_DATA_DIR: join(root, "foreign-data"), KEMIRI_CONFIG_DIR: join(root, "foreign-config"), KEMIRI_ENV_FILE: join(root, "foreign.env") };
 async function command(args: string[], extra: Record<string, string | undefined> = {}, expectedExit = 0) {
  const child = Bun.spawn([process.execPath, cli, ...args], { env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (expectedExit === 0) expect(err).toBe("");
  expect(code).toBe(expectedExit); return expectedExit === 0 ? out : out + err;
 }
 await command(["activate", root, configDir, "v0.0.1-test", join(root, "home/.local/bin/aiki")]);
 for (const extra of [{}, { KEMIRI_CHILD_PROCESS: "1", KEMIRI_AUTH_MODE: "off", KEMIRI_PORT: "not-needed-for-owner-control" }]) {
  expect(JSON.parse(await command(["auth", "status"], extra))).toMatchObject({ mode: "required" });
 }
 const refused = await command(["start"], { KEMIRI_CHILD_PROCESS: "1", KEMIRI_UPDATE_CHILD: "1" }, 1);
 expect(refused).toContain(`Kemiri data: ${dataDir}`);
 expect(refused).toContain("Another live server owns data directory");
 expect((await fetch(server.url + "/auth/status")).status).toBe(200);
 const grant = JSON.parse(await command(["pair"], { KEMIRI_CHILD_PROCESS: "1", KEMIRI_PORT: "not-needed-for-owner-control" }));
 expect(grant.url).toBe(`${server.url}/pair#bootstrap=${grant.code}`);
 const response = await fetch(server.url + "/auth/bootstrap/redeem", {
  method: "POST", headers: { "content-type": "application/json", origin: server.url },
  body: JSON.stringify({ requestId: "local", code: grant.code, claimId: "synthetic-local-device", claimSecret: authSecret("aiki_c1"), label: "Synthetic browser", platform: "web" }),
 });
 expect(response.status).toBe(200);
 const enrollment = await response.json() as { credentials: { accessToken: string } };
 const authenticated = await TestClient.open(server, { origin: server.url }); cleanups.push(async () => authenticated.close());
 expect(await authenticated.request({ type: "hello", protocolVersion: 1, auth: { accessToken: enrollment.credentials.accessToken } })).toMatchObject({ type: "hello" });
 expect(await authenticated.request({ type: "projects.list" })).toMatchObject({ type: "projects.list", projects: [] });
 expect(server.auth.mode).toBe("required");
 expect(JSON.parse(await command(["auth", "devices", "list"], { KEMIRI_CHILD_PROCESS: "1" })).devices).toHaveLength(1);
}, 15000);
