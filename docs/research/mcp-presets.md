# MCP presets (T157 / D73)

Checked 2026-11-12. This is configuration research, not a claim that real vendor
accounts, refresh grants or tools were exercised. The T157 catalogue artifact
contains the broader vendor survey. The implementation exports one backend-owned
catalogue to both clients; there is no client-side duplicate vendor list.

## Added

Ten remote presets join Notion: Atlassian (Jira + Confluence, flat `tools=all`),
GitHub (fine-grained bearer token, `/readonly`), Linear (`/readonly`), Sentry,
Context7 (anonymous, optional bearer key), Cloudflare Docs, Vercel, Supabase
(`read_only=true`), Postman (`/minimal`), and AWS Knowledge. Each definition links
its vendor documentation. GitHub links fine-grained token creation. Context7 links
its optional key dashboard. OAuth entries use discovery and dynamic registration.

Registered-app presets: Slack, Asana V2, PagerDuty and Canva. Each links app
creation and gives a short setup list. Slack requires an internal/Marketplace
app; Asana requires an MCP app rather than an ordinary PAT. PagerDuty API keys
are not bearer tokens. Canva's current developer guide requires app credentials
despite advertising anonymous DCR. HTTPS redirects, tenant policy, app approval,
permissions, plan limits and actual consent remain vendor-dependent.

All 15 remote URLs (including Notion and the four registered-app entries) were
probed using an unauthenticated curl MCP initialize POST with JSON/SSE Accept.
Context7, Cloudflare Docs and AWS Knowledge returned 200. The other twelve
returned OAuth 401. No redirects were followed and no access token was supplied.
The exact URLs are the exported definitions; probe results are a T157 artifact.

Four command presets use the existing reviewed-command flow: Playwright
(`npx @playwright/mcp@latest`), Chrome DevTools
(`npx chrome-devtools-mcp@latest`), Firebase
(`npx -y firebase-tools@latest mcp`), and community Postgres MCP Pro
(`uvx postgres-mcp --access-mode=restricted`, write-only `DATABASE_URI`).
These processes run on the backend, not on the browser or phone. Nothing is
installed or executed by selecting a preset. Latest-version commands are vendor
examples, not pinned reproducible dependencies; review the executable and args.

### Deliberate substitutions and omissions

- The historical `@modelcontextprotocol/server-postgres` is archived and explicitly
  disclaims security guarantees. The survey's AWS Labs alternative places direct
  connection credentials in argv and is primarily an AWS integration. Neither
  meets the requested database-env-secret setup. Instead, the maintained
  [Postgres MCP Pro README](https://github.com/crystaldba/postgres-mcp) was checked
  for its documented `DATABASE_URI` environment and restricted mode. It is clearly
  labelled community, not official PostgreSQL. Enforce a real read-only DB role.
- Google Workspace was **not added**. The survey confirmed Drive/Docs MCP resource
  URLs, but their anonymous initialize returns 200 without a usable OAuth resource
  challenge or discoverable root metadata. A client ID alone does not supply the
  missing discovery contract. Google also requires `access_type=offline` (and
  sometimes `prompt=consent`), which pi-mcp's current settings do not expose.
  Workspace preview/API enablement and scopes are additional prerequisites. Do not
  advertise a working preset until the vendor OAuth metadata and offline-parameter
  path are verified. No guessed endpoints or community impersonation were added.

## Registered-client implementation

pi-mcp 1.5.2 exports `McpOAuthSettings.clientId`, `clientSecret`, `callbackUrl`, and
its provider supplies that `clientInformation` before attempting DCR. Aiki uses
those settings for start, completion and refresh. The settings live under the
same backend-only MCP credential as tokens, survive refresh/restart, and are
removed with the server or replaced by a pasted bearer token. There is no extra
OAuth implementation and no manually editable authorization/token endpoint.

The exact callback is `<web origin>/mcp/oauth/callback`, selectable/copyable before
sign-in. Local installed shells permit both fixed localhost and 127.0.0.1 origins
at their actual port (T156), but vendor registration may still require HTTPS.
Fields clear before requests; only a boolean says an app is saved. Neither app ID
nor secret is repopulated or returned with server metadata. Reflected app
credentials in tool metadata/results are redacted, alongside access/refresh tokens.
PKCE S256, issuer/state checks, paired-device ownership, expiry and one-use
completion remain the original flow. Fake public and confidential no-DCR issuers
exercise completion, refresh, restart and secrecy. No real app was registered.

## CLI setup

Atlassian/GitHub show the acli/gh hint in preset review and server details. Pick an
active project on this backend, then submit the fixed plain-language setup request
using the same coordinator `conversation.submit` as chat. Acknowledgement precedes
navigation; failure does not navigate, replay or retry a write. The button itself
installs nothing. It never sends to a worker or background thread.

## Replaying proof

Run `mcp-presets-demo.ts`, a web preview/dev server and an owned headless Chromium;
then `mcp-presets-proof.ts`. Set independent `MCP_WEB_ORIGIN`, `MCP_CDP`,
`MCP_DEMO_OUTPUT` and `MCP_PROOF_OUTPUT`. Optional `MCP_DEMO_PORT` keeps the synthetic
backend address stable for an emulator. The fixture replaces only Slack's resource
URL in its own process, with a no-DCR fake issuer and a faux coordinator. The video
includes the safe callback copy-back path used by auth-off fixtures. Never use real
accounts or installed backend data. Android's `mcp-presets-proof.ts` requires an
explicit free emulator track; the physical device is never used.
