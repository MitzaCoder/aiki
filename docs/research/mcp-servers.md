# MCP server setup

Research only; checked 2026-11-12. No sign-ins or credentialled servers were started.

## What pi does now

Aiki installs `@earendil-works/pi-ai`, `pi-durable` and `pi-codemode` **1.5.1**. No `@mariozechner/pi-*`, `pi-mcp` or `pi-mcp-adapter` package is installed. Importing durable does not automatically give Aiki MCP configuration or connections.

The old badlogic/pi-mono repository now points to earendil-works/pi. Its [current built-in MCP](https://github.com/earendil-works/pi/blob/406e719a6bff6dd3639cadecc868ee61048ee4ed/packages/coding-agent/docs/mcp.md) defaults to **codemode exposure**: tools exist as `mcp__<server>__<tool>`, but their schemas appear neither as model tools nor in codemode's inline catalogue. A short `mcp_servers` prompt section names servers. Scripts search, describe and call tools; results can be filtered before reaching the model. Alternative exposures are deferred (`tool_search` loads selected schemas), direct, and hidden. Built-in connections start in the background; token laziness does not imply connection laziness.

Built-in configuration is `~/.pi/agent/mcp.json` plus trusted-project `.pi/mcp.json`, using `mcpServers`, e.g. `{"mcpServers":{"notion":{"url":"https://mcp.notion.com/mcp"}}}`; project entries replace matching global entries, or override enablement/exposure alone. Claude Code/Cursor entries copy across. Stdio uses `command`, `args`, `env`, `cwd`; HTTP uses `url`, `headers`, `oauth`. OAuth supports discovery, client metadata documents or dynamic registration, pre-registered clients, refresh, and pasted redirects for remote terminals. Tokens live separately in `mcp-auth.json`.

The separate [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter/tree/1382423d353a06146f1b720631dccbfe81a1905d) instead advertises one `mcp` proxy (~200 tokens, its estimate): search/list/describe/call through arguments, optional direct tools. Cached metadata allows discovery without live servers; connections are lazy with idle shutdown, although initial catalogue population connects servers. It reads `.mcp.json`, global `~/.config/mcp/mcp.json`, Pi files and reviewed imports from other clients. OAuth uses PKCE/discovery/registration; credentials default to OS keychain, with explicit encrypted-file support for headless setups. It also supports legacy SSE. It is a coding-agent extension, not a drop-in durable extension.

## Aiki integration and token cost

[Our extension](../../packages/server/src/codemode.ts) installs codemode for coordinator and workers, with a shared 256 MiB sandbox and conversation-specific callable tools. Background threads are coordinators with their own workers. Namespaces currently group workers, memory, schedules and artifacts; `models.*` is off.

Installed durable's `codemode/describe.js` budgets **3,000 estimated tokens**, using four characters/token, for declarations, excluding headings/glue. It round-robins the cheapest declaration from each namespace. Merely adding a Notion namespace therefore **does not** make it names-only.

`searchTools(query, {limit?, namespace?})` ranks callable metadata/declarations with BM25 and returns matching declarations; `describeTool(name)` returns one declaration; `describeNamespace(name)` returns description/instructions and tool names, not every schema. Discovery itself runs inside the sandbox; only returned/printed text enters context. Set a small search limit (e.g. three); the default returns up to eight declarations.

Register MCP tools with `deferred: true` and `callers: ["tools"]`, grouped under prefix `mcp__notion__`, plus a small separate server-summary prompt section. Deferred tools are omitted from the inline catalogue, including its namespace headings, so that summary is necessary. Keep metadata cached in the backend and register it before scripts start; discovery uses a script-start snapshot, not live network discovery. Refresh changed catalogues between turns. Check current permissions at execution too.

“`notion.*`” can be the presentation namespace; today's actual call is flattened, e.g. `tools.mcp__notion__notion_search(...)`. True nested JavaScript aliases would require extra work. Avoid a second generic proxy when durable already provides discovery and nested-call auditing.

**Estimate, not a live schema measurement:** Notion's [FAQ catalogue](https://developers.notion.com/guides/mcp/tools-faqs) contains **71 unique table-listed tool names**, including legacy/capability-gated tools. Count unique matches of `^\| \[\x60(notion-[a-z-]+)\x60\]` in its Markdown. Assuming 2–4 KB per description/input schema gives **35,500–71,000 tokens** at four characters/token. Actual negotiated tools vary by account/client. A measured 137-character server-summary example costs ~35 tokens by the same heuristic; budget **35–80 incremental tokens/server** for names-only discovery, then roughly 500–1,000 per selected schema under those assumptions. Three schemas cost ~1,500–3,000, not the whole catalogue. Existing codemode overhead is already paid. Discovered schemas/results still remain in conversation history; savings are not zero-cost execution or guaranteed billing reductions.

## Transports, Notion and headless OAuth

Prefer Streamable HTTP. [Notion's current docs](https://developers.notion.com/guides/mcp/get-started-with-mcp) specify `https://mcp.notion.com/mcp`; legacy SSE fallback is `/sse`. **Notion is no longer OAuth-only:** Business/Enterprise workspace owners can create MCP bearer tokens in the Developer portal. These are not ordinary REST integration tokens. All plans support interactive OAuth. The older local `notion-mcp-server` accepts integration tokens but is no longer actively maintained.

[Notion client guidance](https://developers.notion.com/guides/mcp/build-mcp-client) and [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)'s OAuth 2.1 model require authorization-code security with PKCE S256, protected-resource/authorization-server discovery and issuer validation. Support dynamic registration when advertised, otherwise a registered client or supported client metadata document; registration is not universally available.

The new standalone [pi-mcp](https://github.com/earendil-works/pi/blob/406e719a6bff6dd3639cadecc868ee61048ee4ed/packages/mcp/README.md) provides stdio/Streamable HTTP, configuration validation, injectable credential stores/refresh locks, and split `startMcpSignIn`/`completeMcpSignIn` with caller-chosen HTTPS callbacks. Current upstream is 1.5.2: check released-version/Bun compatibility before adopting. It excludes legacy SSE; add that only for a demonstrated need.

Proposed flow:

1. Authenticated owner starts Connect in web/Android; backend keeps expiring, one-use state and PKCE verifier bound to installation, server URL and initiating device.
2. Browser/Android Custom Tab opens consent. Redirect to an allowlisted **Aiki web-origin callback**, not backend loopback. The static SPA relays code/state to the originating backend using authenticated RPC when paired, or a narrowly scoped, expiring one-use completion capability issued at initiation. Phone-only users must not need to pair that browser. Bind trusted backend routing to the pending flow, never an arbitrary callback query URL. Android observes completion through its existing connection; no phone token storage is needed.
3. Backend validates state/issuer/exact redirect, exchanges code, stores registration and tokens in a separate MCP credential namespace alongside harness credentials. Refresh is serialized per grant and atomically persists rotated tokens; `invalid_grant` requires reconnect. Strip callback query immediately; no analytics/logging or open redirects.

Reuse [provider sign-in](../../packages/server/src/logins.ts)'s server-owned sessions, status broadcasts, cancellation and reload recovery. Its provider-specific `models.login` is not generic MCP OAuth. [Harness credentials](../../packages/server/src/credentials.ts) are 0600 JSON, **not encrypted**; extend storage deliberately without pretending pi-ai refreshes MCP grants.

## Scope, safety and screens

Global means **per backend**, not synced across backends. Keep shared server definitions/accounts globally; also allow project-only definitions in backend settings. Project overrides enable selected servers/tools and agent roles. Default new servers disabled in projects. Coordinator, workers, threads and scheduled runs receive only their effective project/role allow-list; workers cannot broaden it. Separate credentials for separate accounts.

Enforce allow-lists and approvals inside each nested tool call, not just UI visibility. Start read-only; unknown/write/destructive tools require explicit approval or owner allow-list. Server annotations are hints, not authority. Background agents must pause for approval. Do not blindly retry/replay writes after ambiguous failures. Treat server descriptions/results as untrusted content.

Stdio configuration **executes arbitrary backend code**, matching D63's [deployment-feed rationale](../DESIGN.md#project-deployment-feeds-t125-stage-5-of-t120). Recommend host-owner CLI provisioning only initially: executable plus argv, pinned package, explicit working directory and minimal environment through `childEnvironment`. No shell strings or secret-command interpolation. Never auto-run repository/imported JSON. Authenticated devices are already full owners, not a new security boundary; project enablement is least-privilege policy, not OS isolation. Review remote URLs/metadata for SSRF and forbid cross-origin credential forwarding.

Web and Android: backend Settings → MCP servers; Add presets (Notion, GitHub, Linear, filesystem) or paste `mcpServers` JSON into a validated review preview. Show transport, scope, requested permissions and secret inputs separately; block command imports pending host provisioning. Filesystem is host-local, not phone storage. Server details show Connect/Reconnect/Disconnect, signed-in workspace, status/error, tools with on/off and approval policy. Project settings select server and agent-role enablement. Capability-gate both clients. Never export secrets to repositories, prompts, tool schemas or diagnostics.

## Options and recommendation

1. **Native remote-first**: standalone pi-mcp plus durable discovery; Notion OAuth/token preset, backend-global accounts/project-role policy, web/Android settings. **8–12 engineer-days**, estimated including tests. Best token/batching fit; requires callback and credential integration. Defer stdio/SSE.
2. **Full native coverage**: option 1 plus host-owner stdio provisioning, reviewed JSON imports and broader presets; optional SSE adapter. **12–20 days total**. Broader compatibility, larger lifecycle/security surface.
3. **Proxy bridge**: adapt pi-mcp-adapter's proxy/config/keychain model to durable. **5–8 days for a spike**, not complete client UX. Reuses ecosystem imports/SSE; coding-agent APIs, headless keyring requirements and duplicated discovery make production effort uncertain.

**Recommend option 1**, then owner-provisioned stdio from option 2. Reuse transport/auth primitives, not the whole CLI extension. Validate one Notion connect → search/describe → filtered read → approved write → refresh/restart path before broadening presets.
