# Device pairing and backend authentication

Proposal for T57, 2026-11-09. **Design only; no implementation or live testing.**
D32: every friend owns a separate backend. Authenticate devices, not friends on the operator’s backend.
Recommendation: one-time pairing → retained per-device session → immediate server-side revocation.
No accounts, central identity service, tunnel, multi-user roles or changes to tool permissions in v1.

## Basis and threat model

- Read [sharing research, security gate](sharing-the-app.md#security-gate-before-sharing-remotely).
  Today `/ws` trusts allowed browser Origins and accepts Origin-less clients; neither is authentication.
  Web/Android connect links export addresses, not grants. Artifact URLs alone already have expiring HMACs.
- Read [T3 Code remote access](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md)
  on November 9. Copy its direct-network model: fresh one-time QR/link per device, remembered sessions,
  device list/revoke and host CLI recovery. A pairing URL supplies neither connectivity nor TLS.
  Its SSH URL+code account flow uses T3 Connect; our proposal uses a backend-local bootstrap, not that service.
  Do not copy its account, relay or scope system as an implicit dependency.
- An admitted device can run shells/agents, read and change host files, manage credentials and spend
  provider money as the backend’s OS user. Treat pairing like handing over an SSH key, not joining a chat.
  All owner devices have full access, including pairing/revocation; no “safe read-only friend” claim.
- Defend against reachable strangers, hostile tailnet/LAN peers, malicious browser sites, DNS rebinding,
  stolen/replayed pairing links, lost devices and accidental secret leakage. TLS protects network traffic.
  Protect data-home files/backups with OS permissions; run as a non-root, least-privileged user.
- Tailscale provides encrypted transport, network membership and ACL-based reachability. It does not prove
  which app/device session is using a port, stop hostile allowed peers, or replace revocation inside the app.
  Keep tailnet ACL/firewall restrictions after auth; do not recommend public forwarding for the first pilot.
- A compromised authenticated browser, XSS, malicious hosted-app update, OS account or backend defeats
  full-owner auth. A compromised backend can lie and steal everything it handles. Device auth is not a
  tool sandbox, spending cap or protection from prompt-injected agents with shell access.

## First device: no network “claim the empty server” race

Fresh installs start `auth: "required"`, bound to loopback. Empty device state never authorizes strangers.
A local installer/CLI, running as the backend OS user, alone can request bootstrap grants via a protected
local control channel (Unix socket/named pipe, or equivalent owner-only file IPC), not an anonymous RPC.
Bootstrap is valid for 10 minutes, single-use and scoped to this backend; expired grants need CLI reissue.

**Same machine:** installer serves/opens the bundled UI on the loopback backend origin with
`http://127.0.0.1:<port>/pair#bootstrap=<256-bit-secret>`; print it if browser opening fails.
The fragment never reaches HTTP access logs. UI removes it with `history.replaceState` before other work,
shows “Full access to this computer,” and exchanges it via POST after the owner chooses Pair.
Bind redemption to the loopback listener and validate actual peer + Host + Origin; loopback alone is not
proof of ownership. Use the token as proof. A remote reverse proxy must not qualify as a local bootstrap.
If bundled UI is not shipped yet, a configured trusted hosted UI may redeem against loopback subject to
browser local-network permissions; this is a fallback, not the reliable local onboarding path.

**Headless over SSH:** an owner CLI prints the trusted app URL with backend address + random bootstrap
request ID, and a separate 12-character random base32 code. Open URL on a reachable browser, enter code,
check backend name/ID and address, then Pair. The code is the bootstrap secret; URL alone grants nothing.
Use HTTPS/WSS to the tailnet backend, or an explicit SSH port forward and loopback UI. Do not expose
plain HTTP to the LAN. Remote bootstrap requires an explicit CLI network-enable choice; required auth is
already enforced on that listener. No browser callback listener or central account is needed.
Only one active bootstrap grant per backend; at most five wrong code attempts, then invalidate it.
A CLI can issue another owner grant after devices exist for recovery; never reset auth by deleting data.

## Add a phone or another browser

```text
Signed-in owner -- auth.pairings.create --> backend (5-minute grant)
Owner displays QR/link -----------------> new device confirms address/full access
New device -- POST /auth/pairings/redeem -> backend reserves grant for one claim
Owner <-- auth.pairingRequested ---------- backend (matching short comparison code)
Owner -- auth.pairings.approve ----------> backend issues session to that claim only
New device -- claim secret/poll ---------> stores its own session; opens authenticated /ws
```

- QR/link uses a versioned fragment carrying backend ID, HTTPS origin, grant ID and 256-bit secret.
  Never put a retained session/refresh token in an export. Existing `v1` address-import links remain
  import-only; label them accordingly. New `v2` pairing payloads must not look like old address lists.
- Creation requires an authenticated owner session; default **Confirm new device on this device = on**.
  The option can be disabled when creating a grant for convenient scan-and-go; warn that anyone with
  that link can then acquire full access. Approval binds the exact claim, not a user-supplied device name.
- Redemption atomically changes unused → claimed; only one contender wins. Bad secrets do not consume
  a QR grant. A claimed grant cannot enroll another device, even if the first claim expires or is denied.
  Approval must occur before the original expiry; deny/cancel/page-close can invalidate unused grants.
- Receiver creates a random claim secret before redeeming; bounded idempotent retries with that secret
  recover a lost response. Pending claims have no ordinary RPC access; poll is claim-secret protected.
  Delivery of credentials is retryable only to that claim, encrypted transiently, expiring after 60 seconds.
  Acknowledgement deletes the delivery copy; permanently store token hashes, never plaintext credentials.
- Show identical comparison codes on both devices before approval, plus name, platform and address.
  Names/platform are untrusted labels. Warn against forwarding links/screenshots; cancel on mismatch.
- Pair one backend by default. A “connect these backends” bundle contains an independent one-time grant
  per selected backend, created only where the approving device is authenticated. Explain partial failures;
  never infer access to backend B from successful enrollment at backend A.

## Sessions, credentials and storage

- Persist a random stable backend ID independently of address and upgrades. A device session belongs to
  that ID; use TLS + exact approved origin for routing. Never send a token to a different origin after a
  redirect, DNS route discovery or backend-list edit. A new route requires an authenticated confirmation.
- Use opaque versioned tokens, not JWTs: `aiki_s1.<public-session-id>.<32-random-bytes-base64url>` for
  retained credentials; `aiki_a1.<public-access-id>.<32-random-bytes-base64url>` for access credentials.
  Separate bootstrap/pairing/claim prefixes and audiences. Server stores SHA-256 hashes of high-entropy
  secrets, checks in constant time, and looks up session state on every authorized request.
- Durable rows: session ID, backend ID, label/platform, created/last-used, expiry, revokedAt and token
  generation/hash; no client-supplied identifiers as authority. Owner-only storage (directory 0700,
  files 0600 or equivalent), atomic transactions, durable revocation before acknowledging success.
- Access token: 15 minutes, held in memory, bound to a retained session. Refresh via
  `POST /auth/session/refresh` using retained bearer credential; returns a fresh short-lived access token.
  Retained session: 180-day idle timeout, one-year absolute lifetime; UI warns ahead of re-pairing.
  Active sockets count as use, with throttled durable last-used writes; a restart preserves sessions.
- Rotate retained secrets every 30 days and after an explicit security action, not every reconnect.
  Client durably stages a random successor before rotation; server atomically accepts old → new hash.
  Permit 60-second idempotent retry of only that same successor/operation, never arbitrary reuse of old
  credentials. Coordinate browser tabs with a lock/transaction; resume staged rotation after a crash.
  Rotation does not revoke other devices. Revocation or absolute expiry invalidates every token generation.
- **Web recommendation:** IndexedDB for retained per-backend secrets and staged rotation; memory for
  access tokens. Keep `localStorage["aiki.backends.v1"]` addresses/names/IDs unchanged and secrets
  separate, keyed by backend ID + origin. Never serialize them in backend exports, URLs or debug state.
  localStorage is simpler but synchronous and easy to copy accidentally; neither store resists XSS.
  Storage denied/evicted: warn, use a memory-only session, explain that reopening will require pairing.
- An httpOnly Secure cookie protects against direct JS token reads for a same-origin bundled UI, but
  the operator’s hosted app calls other backend origins: cross-site cookies need SameSite=None and browsers may
  block/partition them. Do not depend on third-party cookies or build two auth systems for v1.
  Cookies would also need CSRF protection; httpOnly still cannot stop XSS from issuing shell commands.
- Use a strict web CSP, no third-party scripts on the pairing page, safe rich-text rendering and no
  analytics there. Hosted JS can exercise every saved backend credential; bundle a local UI as the safer
  distribution default. IndexedDB is not a security boundary from the hosted app’s own JavaScript.
- **Android recommendation:** Keystore AES-GCM encryption of retained tokens in a separate DataStore;
  existing address/preferences DataStore is not encrypted. EncryptedSharedPreferences is an alternative
  for existing integrations, not a requirement (deprecated API). Keep access tokens in memory; exclude
  encrypted credentials from backup/device transfer, handle missing keys with re-pair UI. APK upgrades
  retain keys/state; never require uninstall. Do not log deep links, codes or token-bearing OkHttp bodies.

## WebSocket authentication and negotiation

Keep protocol v1’s first `hello`, adding optional `auth: { accessToken }` in the request.
Required server accepts only a small, timed pre-auth hello; success enters the normal connection state.
No project lists, status, watches, terminal attachments or background side effects before authentication.
Authenticate **before** constructing/activating the ordinary `ClientConnection`; gate binary frames too.
An authenticated identity is immutable for that socket; close it to change devices.

- **First message (recommended):** works in browser WebSocket APIs and Android, does not leak via URL or
  handshake logs, and fits today’s hello. Cost: temporarily accepting an unauthenticated upgraded socket;
  cap pre-auth message at 8 KiB, 5-second timeout, connection count and handshake rate.
- **Subprotocol token:** browser-settable and rejectable at upgrade, but abuses protocol negotiation,
  risks proxy/header logging and token echo, and has header-size/character constraints. Do not use.
- **Query token:** easiest at upgrade but leaks into request logs, URLs and diagnostics. Do not use for
  device sessions. Browser WebSocket cannot set a normal Authorization header; native-only headers
  would split the transport design. Bearer Authorization is appropriate for ordinary HTTP fetches.
- Add public, minimal `GET /auth/status` → backend ID, auth mode and auth version; no project/device data.
  Response must be no-store. It solves discovery before an authenticated hello; CORS uses exact Origins.
  Pairing/refresh HTTP replies are also no-store, never redirects and never cookie-dependent.
- Authenticated hello adds `auth: { mode, sessionId, accessExpiresAt }` and explicit feature flags
  `device-auth-v1`, `device-pairing-v1`, `device-management-v1`. Update both feature schema/list and Android
  generated models. Do not infer auth support from the existing “missing features = baseline” fallback.
- Renew access before expiry with refresh, then `auth.renew { accessToken }` on the live socket; only the
  same session is accepted. Allow 60 seconds to renew, then close. Do not drop healthy chats every 15 min.
  Check revocation/expiry at dispatch and queued operation start, not only once at hello.
- Missing/bad hello credentials return existing error envelope with `auth_required` / `auth_invalid` and
  close 4401; revoked session closes 4403 (`auth_revoked`), expired access 4401 (`auth_expired`). No secrets
  in reasons. Updated clients stop reconnect loops and show Pair/Session revoked/Update needed per backend.
- Old clients work unmodified in off/optional mode, but required mode rejects before any work. Their generic
  connection error cannot be fixed remotely; migration must update them before switching required on.
  New clients use legacy handshake only for explicitly known legacy backends; once auth was advertised,
  pin that fact and reject downgrade/404 rather than silently falling back. Never replay auth to an old server.

## HTTP, artifacts and other surfaces

- All private HTTP routes require `Authorization: Bearer <access-token>`, with the same session checks.
  Explicit public exceptions: minimal auth discovery, bounded bootstrap/pair/refresh exchanges, static UI,
  signed artifact GET/HEAD, CORS OPTIONS and a content-free health check. Public does not mean unlimited.
- Keep signed artifact URLs for image/video tags, range requests and external viewers without custom
  headers. In required mode only authenticated `artifacts.url` may mint; validate access and derive URLs
  from configured/validated backend origin, not arbitrary Host/Forwarded headers. Reduce default TTL from 4h
  to 10 min; clients renew URLs on expiry without reloading their whole session.
- Extend HMAC payload/version with issuing session ID and check its revocation on each GET/HEAD.
  URLs remain narrow bearer grants: anyone holding one can read that artifact until expiry/revocation.
  Already downloaded bytes cannot be revoked. Optional mode temporarily keeps legacy artifact minting;
  reject old URL formats at required cutover and let upgraded clients remint. No public share links in v1.
- Hostile HTML/SVG artifacts must not execute on a token-bearing UI/backend origin: attachment or isolated
  sandboxed preview, restrictive CSP, nosniff, Referrer-Policy: no-referrer and private/no-store caching.
  Abort tracked in-flight artifact streams when their issuing session is revoked; bytes already sent remain.
- Existing notification surfaces are WS RPCs: `notifications.config/register/registerFcm/unregister/device/
  test/presence/interaction`. Authenticate all; bind subscription/FCM rows to the caller’s auth session,
  not a self-asserted notification deviceId. No anonymous registration or test-push endpoint.
  Revoking a session deletes/disables its subscriptions, clears held deliveries and presence, stops queued
  pushes, and prevents token re-registration under the revoked identity. Already sent pushes cannot retract.
  Push click URLs contain routing IDs only, never session tokens; click must authenticate before fetching.
- Keep the operator’s current push working during migration by binding existing subscriptions after authenticated
  re-registration. Friends get their own push credentials or no push: never distribute the operator’s Firebase admin
  key/shared private VAPID key. Multi-backend web-push key/subscription ownership is separate follow-up;
  device auth alone does not solve that. Any later inbound push callback needs its own verified signature.
- Terminal list/open/resize/close/kill and every binary input/ack/output frame are behind socket identity.
  Revocation immediately detaches all that session’s terminal connections. Keep host PTYs/jobs running for
  other owner devices; explicitly offer a separate “stop jobs/kill terminals” action for incident response.
- Codemode, shell, file tools, credential/provider login RPCs and coordinator/worker behavior stay unchanged
  behind auth. Gate all dispatch paths, not a hand-picked sensitive RPC list. Revocation cancels queued
  device requests and detaches watches; it cannot undo shell commands or automatically stop existing agents.
  Owner sees that warning and can stop work separately. No sandbox-strengthening claim.

## Device list, revocation and recovery

Per-backend Settings → Devices (web and Android): this device marker, editable label/platform, created,
last seen, connected count, expiry and Revoke. Show active unused pairing grants with expiry and Cancel.
One owner device may revoke another or itself; self-revoke is sign out. Warn before revoking the last device;
recovery remains available through the OS-user CLI over local access/SSH, even with no working UI session.

Proposed authenticated RPCs: `auth.devices.list`, `auth.devices.rename`, `auth.devices.revoke`,
`auth.pairings.create/list/cancel/approve/deny`, `auth.renew`; events `auth.devicesChanged`,
`auth.pairingRequested`, `auth.sessionRevoked`. Requests use session/grant/claim IDs, never token hashes.
CLI equivalents: `auth devices list/revoke`, `auth pair`, `auth revoke-all` via protected local control.
Commit revocation → invalidate access/retained secrets and created unused grants → close all matching sockets
4403 → detach terminals/watches and disable push. Recheck active state for work racing with the commit.
Audit grant/session IDs, approval/revocation and coarse timestamps, not secrets or full IP histories.

## Host, Origin, abuse and logging

- Validate Host/authority against configured exact public endpoints and loopback host:ports on **every**
  route, including artifacts/bootstrap. Never trust wildcard hosts or automatically add request Hosts.
  Exact browser Origin allow-list on WS and HTTP; reject `null`, mismatched schemes/ports and disallowed
  Origins, including same-site sibling origins. Missing Origin is allowed for native clients only subject
  to actual token authentication, never a bypass. CORS is not auth; no wildcard + credentials.
- Reverse proxies must preserve intended Host and strip client-supplied Forwarded/X-Forwarded-* headers.
  Honor forwarding only from explicitly trusted proxies; do not treat their loopback connection as a local
  owner. Validate canonical endpoints before minting links. Together these checks block DNS rebinding;
  TLS and app secrets are still required. Enrollment must never fetch arbitrary user-supplied URLs (SSRF).
- Initial tunable limits: enrollment attempts 5/min per grant and source, 30/min backend-wide; five failed
  headless codes invalidate that grant. Grant creation 10/hour/session, 5 pending grants/session;
  cap all outstanding claims/pre-auth sockets globally, polls at 1/sec/claim, exponential client backoff.
  Refresh/handshakes also have per-session/source/global limits. Return 429 + Retry-After; limit before
  parsing large payloads. Do not globally lock valid sessions due to guessed IDs; peer IP trusts proxy rules.
- Redact Authorization, hello/renew credentials, QR fragments, codes, refresh/claim bodies, signed URL query
  strings, push tokens and OAuth callback values in server/proxy/client logs, errors and support bundles.
  No frame/body tracing for auth messages. Only the explicit owner CLI bootstrap display may reveal a code;
  do not send that display to persistent service journals. Pair pages disable referrers/analytics; clear fragments.

## the operator migration: three backends, existing browsers and Android, one approval

Use per-backend `auth: "off" | "optional" | "required"`; off is explicit local development only, never default.
Optional preserves today's unauthenticated power **only on existing private tailnet/loopback listeners**.
It is a temporary compatibility window, not safe network sharing. No friend backend ships this way.

1. Deploy auth-capable protocol/server in optional mode to all three; ship web + signed Android update
   preserving localStorage/backend IDs, DataStore, push IDs, drafts and APK signing identity. No data reset.
2. Updated clients silently generate durable per-backend migration claim secrets and register pending claims
   on their existing connections. Bind proof to those secrets, not IP, Origin, client name or notification ID.
   Reconnect can recover a pending claim. This grants no new owner authority yet; legacy traffic still works.
3. Trusted existing deployment/local SSH control collects a fixed manifest of the actual clients across
   all three backends and opens one owner-only approval bundle. Bootstrap authority for each backend comes
   through protected local control, never the unauthenticated old socket. One **Approve these devices on
   these three backends** screen also enrolls the approving browser. No per-backend QR scan or phone entry.
   The deployment-assisted bundle is migration-only, expires, and contains separate backend capabilities.
4. Approval authorizes exactly the displayed claim IDs/secret hashes on each backend. Clients automatically
   exchange their stored claim proof for their own retained credentials, persist, reconnect authenticated,
   rebind push subscriptions and acknowledge. Use a durable batch ID so partial/retried approvals are safe;
   no cross-backend atomicity assumption. Keep optional until every inventory entry has acknowledged.
5. Exercise authenticated reconnect/restart, artifacts, push and terminals on all three + phone; then switch
   each backend to required through trusted deployment. Close remaining legacy sockets, disable migration
   enrollment, delete bundle capabilities and retain a redacted completion inventory. No second approval.

**Limit:** old clients have no identity today. Tailnet presence cannot prove a claimant is the operator’s device.
The single approval must review a closed inventory; names/IPs are hints, never sufficient auto-enrollment.
A client not updated/seen cannot be safely grandfathered. Wait for all known clients (including an offline
phone/browser) before cutover; otherwise the “no break, one approval” promise is impossible. New unknown
clients use normal pairing afterward. Do not silently enroll everyone who happened to reach optional mode.
Keep rollback auth-aware; never automatically roll required installations back to an unauthenticated server.

## Effort, acceptance and decisions

Rough engineering days, one familiar engineer; replaces the earlier research’s optimistic 5–9 day auth range:
server/protocol/CLI + persistence/limits/artifact/push gates **4–6**; web storage/pairing/devices/multi-tab **3–4**;
Android secure storage/transport/pairing/devices **3–4**; migration automation + integration/security tests **2–3**.
Total **12–17 days**; excludes installer/UI bundling, tunnel/push broker, packaging and external security audit.

Before exposure, tests must cover Origin-less unauthorized requests, Host/Origin/rebinding/proxy checks,
bootstrap races, expired/replayed/concurrent claims, wrong codes/rate limits, rotation crashes/multi-tab,
revocation of live WS/binary terminal/HTTP streams/push, expiry renewal, disk restart, old/new combinations,
downgrade refusal, secret-free logs, and the complete three-backend + phone single-approval rehearsal.
No services or test sessions were run for this proposal.

Questions for the operator (recommended answers):
1. One full owner per backend, no colleague/read-only access? **Yes; defer scopes and multi-user sharing.**
2. Keep hosted cross-origin web support? **Yes; opaque bearer sessions in IndexedDB, not third-party cookies.**
3. Confirm every added device? **On by default; explicit grant-level opt-out for private QR handoff.**
4. Session expiry acceptable? **15-minute access, 30-day rotation, 180-day idle / one-year absolute session.**
5. First remote path? **Tailscale + HTTPS, no new relay or public port-forwarding guide.**
6. One-approval migration constraint? **Use deployment-assisted fixed inventory; wait for all clients before
   required. Approve that bounded legacy exception, never blanket tailnet auto-enrollment.**
7. Artifact revocation versus old links? **Session-bound 10-minute signed URLs; transparently remint old ones.**
8. Lost-device revocation stops running jobs? **No; detach immediately, offer explicit stop/kill separately.**
9. Friends’ push? **Own keys or off initially; do not share the operator’s private push credentials.**
