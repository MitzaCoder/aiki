# Push relay (emulator only)

Isolated Bun package, **not a root workspace**, not deployed and not used by any Aiki backend.
Implements T93's first half of the approved [design](../docs/research/push-relay-design.md).
No real Firebase project, login, credentials, key file, FCM or App Check service is used by the tests.
Do not deploy this package: T94's transactional rate budgets, switches, disable/delete cascade and reconciliation
are not implemented. D51 makes both relay accounts and relay push optional: Aiki works fully without them.
D52 settles the original parser, deletion, retry and lost-challenge questions as documented below.

## Exact emulator recipe

Requirements: Bun, Node (host has 24; function declares Node 22), Java (host has OpenJDK 25), `ss`.
No system installation is needed. From the repository root:

```sh
cd relay
bun install --frozen-lockfile
bun run typecheck
bun run build
# One-time, online setup: downloads Firestore emulator jar into the isolated cache.
bun run emulator:setup
# Bounded emulators:exec; starts all three emulators, runs checks, then stops them.
bun run test:emulator
# Full suite with OS-enforced isolation, when unprivileged user/network namespaces are available:
unshare -Urn sh -c 'ip link set lo up && bun run test:emulator'
```

`tools/emulators.ts` launches the installed Firebase CLI through its Node shebang with **`env -i`**.
Only explicit PATH, isolated HOME/XDG directories, CI/update/analytics suppression, a synthetic `demo-aiki-relay`
project ID and local test ports are supplied. The CLI cannot discover the operator's existing login/config.
Never run Firebase directly with the operator's HOME. No `.firebaserc` is used or committed.
State, CLI logs, HOME, config and cache are under gitignored `relay/.emulator/`; emulator jar is under
`.emulator/home/.cache/firebase/emulators/`. Generated `.emulator-config.json`, `.env.local`, `.firebase/`,
`*-debug.log*` and compiled `dist/` are ignored. Setup requires network; cached test runs do not.
The wrapper checks `ss -ltn` before startup, validates distinct ports, and applies a four-minute exec deadline
(two minutes for setup). Node 24 emits an expected warning about the declared Node 22 runtime.

Defaults, all bound to **127.0.0.1**:

| Service | Port | Override |
| --- | --- | --- |
| Auth | 19371 | `RELAY_AUTH_PORT` |
| Firestore | 19372 | `RELAY_FIRESTORE_PORT` |
| Functions | 19373 | `RELAY_FUNCTIONS_PORT` |
| Emulator hub | 19374 | `RELAY_HUB_PORT` |
| Logging | 19375 | `RELAY_LOGGING_PORT` |
| Firestore websocket | 19376 | `RELAY_WEBSOCKET_PORT` |
| Local fake FCM | 19377 | `RELAY_FCM_PORT` |

The UI is disabled. Auth tests additionally start the official Auth emulator's Express application in-process on
an ephemeral loopback port to obtain a real REST-issued token for `demo-other-relay` (API keys otherwise always map
to the primary emulator project). That listener and the fake FCM listener are explicitly closed in `afterAll`.
Functions discovery briefly uses an ephemeral loopback port. Test script names end in `.cases.ts`, not Bun's automatic
`test/spec` patterns: root `bun test` neither discovers them nor needs relay dependencies/Java.

For manual inspection, `bun run emulator:start` runs for at most ten minutes; the fake FCM listener exists only while
`bun run test:cases` is running, so do not expect a manual challenge to deliver without that test process. Prefer the
bounded exec recipe. If detaching for debugging, use `setsid -f ... > <ignored-log> 2>&1 < /dev/null`, record its PID,
and kill only that PID (never `pkill -f`). Do not start an Aiki server.

The test preload denies non-loopback fetch, socket/TLS connections, Bun/default/named DNS lookups and explicit DNS
queries. It replaces both DNS module namespaces because Bun does not synchronize their named exports. This guard is
defense in depth, **not a sandbox**. The successful `unshare -Urn` run is the stronger proof: the CLI, Java, Functions/Node, SDKs and tests all run with only
loopback and no outbound interface. It proves cached test execution needs no external connection, not real Firebase
IAM, FCM reachability, billing, production runtime or delivery. The Auth emulator itself writes synthetic sign-in links
to its platform log; application logging is restricted to `app_check valid|invalid`.

## Layout and dependencies

- `src/core.ts`: small HTTP-independent router. Ports live in `ports.ts`; `admission.ts`, `enrollment.ts`,
  `installations.ts`, `routes.ts`, `send.ts` and `delete.ts` own their respective state transitions. Firestore, Auth,
  FCM, clock, CSPRNG and App Check are injected; trusted connection IP is supplied for T94 metering.
- `src/documents.ts`: an interface and runtime-checked Firestore converter per collection. Invalid stored types fail
  closed. Handlers have no `any` rows. Each transaction documents its atomic guarantee.
- `src/validation.ts`: strict schemas, canonical base64url, IDs, envelope byte budget, domain-separated bearer hashing.
  Deliberately independent of `packages/`; later cross-check against shared protocol vectors.
- `src/index.ts`: one v2 `onRequest` export `relay`, Node 22 declaration, ADC production wiring, 30-second timeout,
  min instances 0/max 2, ten-second FCM deadline. No credential file.
- `src/startup.ts`: production rejects emulator/test configuration; emulator requires a demo project and loopback
  Auth/Firestore, always uses local fake FCM. No App Check bypass exists. Discovery uses default fake port until
  `.env.local` overrides it at invocation. App Check is monitored only; backend send/status/delete never require it.
- `firestore.rules`: deny every direct client read/write, including authenticated clients.
- `firestore.indexes.json`: TTL overrides and disabled automatic indexes; only installation cascade query fields indexed.
- `src/client-address.ts`: extracts only the GFE-appended rightmost X-Forwarded-For address for the direct 2nd-gen
  endpoint, never a client-supplied earlier value. Missing/malformed metadata is empty (T94 must fail closed).
  Emulator mode ignores forwarded headers and accepts only its loopback peer. See Google's
  [function headers](https://docs.cloud.google.com/functions/docs/reference/headers) and
  [load-balancer headers](https://docs.cloud.google.com/load-balancing/docs/https#x-forwarded-for_header).
  **Verify the actual forwarding suffix on the real project before IP limits rely on it.** Extra load balancers or
  proxies change the topology: do not guess another hop or trust a caller-selected earlier entry.
- `tools/emulators.ts`, `checks/network-guard.ts`: scrubbed launcher and network guard. `checks/emulator.cases.ts`
  imports concern-specific `.cases.ts` modules; `checks/support.ts` alone owns fixtures and emulator lifecycle.
- `.prettierrc.json`: tabs, double quotes, 120-column target. `bun run format:check` enforces formatting.
  `bun run typecheck` covers production source, tests and tools; only production source is built into `dist/`.

Pinned direct dependencies: `firebase-admin` 13.6.0, `firebase-functions` 6.6.0;
dev: `firebase-tools` 14.22.0, TypeScript 5.9.3, `@types/bun` 1.3.10, Prettier 3.6.2.
Initial install: 708 packages, approximately 298 MiB `node_modules`; Firestore jar approximately 61 MiB under the
isolated HOME, plus approximately 30 MiB Bun cache (92 MiB total emulator state after checks). Firebase CLI uses
`HOME/.cache/firebase/emulators` for the jar despite XDG_CACHE_HOME; both locations remain isolated.
Build output is not committed. Bun blocks two optional dependency postinstalls; no trust override is needed.

## HTTP API

Base path in emulator: `http://127.0.0.1:19373/demo-aiki-relay/us-central1/relay/v1/`.
All endpoints POST **UTF-8 JSON bytes with `Content-Type: application/octet-stream`** (D52),
`Cache-Control: no-store`, no cookies/redirects. Do not use a JSON content type: it enables upstream parsing/logging.
The handler reads rawBody, enforces byte caps and parses JSON itself. Other media types reaching it return fixed
415 `unsupported_content_type`. Management body maximum 8192 bytes;
send body maximum 4096 bytes. IDs/operation IDs/challenge IDs/message IDs/key IDs are canonical unpadded base64url
encoding of 16 bytes (22 characters). Nonces: challenge 32 bytes (43 chars); envelope 12 bytes (16 chars).
Digest fields are lowercase 64-character hex SHA-256. Unknown keys are rejected, including all FCM overrides.
No operation returns an FCM token, account UID, profile, secret or stored credential digest.

Phone endpoints use `Authorization: Bearer <Firebase ID token>` for this project, verified email and Google/password
provider only. Password here means Firebase's verified email provider claim, **not proof of email-link UI**;
unverified password, custom and anonymous tokens fail. Verification always requests revocation checking; `getUser`
is uncached. Missing Auth user gives `410 account_deleted`; disabled user/account gives `403 account_disabled`;
Auth infrastructure errors give `503 relay_unavailable`. Account row is created only by first enrollment.

| Endpoint | Exact body | Success JSON (200 unless noted) |
| --- | --- | --- |
| `accounts/status` | `{}` | `{state,phones,routes,phoneLimit:3,routeLimit:24}`; state `unenrolled` before enrollment |
| `installations/list` | `{}` | `{installations:[{installationId,state,createdAt,lastManagementAt}]}`; timestamps numeric milliseconds, last management nullable |
| `installations/begin` | `{installationId,operationId,token}` | `{challengeId,deadline}` |
| `installations/confirm` | `{installationId,operationId,challengeId,nonce}` | `{installationId,generation}` |
| `installations/token/begin` | same as begin | same as begin |
| `installations/token/confirm` | same as confirm | same as confirm |
| `installations/delete` | `{installationId}` | 204; removes that phone's token, challenges and routes, not other phones |
| `routes/create` | `{installationId,routeId,operationId,sendHash,deleteHash,predecessorId?}` | `{routeId,state,leaseExpiresAt,absoluteExpiresAt}`; initially pending |
| `routes/activate` | `{installationId,routeId}` | same route result, active; atomically disables predecessor |
| `routes/renew` | `{installationId,routeId}` | same route result; unchanged if at least seven days remain |
| `routes/delete` | `{installationId,routeId}` | 204 |
| `send` | `{routeId,messageId,envelope}` | 200 `{state:"accepted",code:"accepted"}`, `{state:"failed",code:"token_invalid"}` or `{state:"pending"}`; transient failures described below |
| `send/status` | `{routeId,messageId}` | 200 `{state:"unknown"}`, `{state:"pending"}`, `{state:"accepted",code:"accepted"}`, `{state:"failed",code:"token_invalid"}` or `{state:"retry",code,retryAt}` |
| `delete` | `{routeId}` | 204 for any absent route with a well-formed delete bearer, including never-existing/already-deleted/purged routes; existing wrong-secret route is 404 |

Send/status bearer: `aiki_push1.<routeId>.<32-byte secret>`; delete-only bearer:
`aiki_push_delete1.<routeId>.<independent 32-byte secret>`. `sendHash`/`deleteHash` are SHA-256 of those **full strings**
(without `Bearer `), not just secrets. Schemes are disjoint, stored hashes compared with `timingSafeEqual`.
Pending/disabled/expired routes never send. Leases last 30 days, renew only under seven days, absolute life 90 days.
An initial pending route reserves a slot for ten minutes. One pending successor per active predecessor is allowed,
up to 24/account in addition to the 24 active/initial-pending slots; only activation releases predecessor's slot.

FCM challenge is data-only, normal priority, max five-minute TTL, one `aiki` string containing:
`{v:1,type:"challenge",installationId,operationId,challengeId,nonce,deadline}`.
The confirm must echo the challenge under the original UID/installation/operation; five validly shaped wrong replies
exhaust it. Expired reservations release capacity synchronously, not via TTL. Begin retries return the same metadata
without resending while their 24-hour operation receipt is retained. A **new operation ID** atomically replaces the
phone's pending challenge, deletes the old challenge and sends a fresh nonce immediately, without waiting for expiry.
The active token does not move until confirmation. Only a completed challenge moves global token ownership or increments
token generation. Operation receipts contain no nonce or raw token; T94 charges each new challenge operation.
A replayed confirm is a receipt lookup only and cannot reapply a token switch.

Envelope is exactly `{v:1,r,k,m,n,c}`, where `r=routeId`, `m=messageId`, `c` is canonical base64url ciphertext plus
at least a 16-byte tag. Only the outer envelope keys are strict. The relay does not decrypt or inspect plaintext;
unknown fields inside the encrypted payload are the phone's concern (T92). FCM data is exactly `{aiki:compactEnvelopeJson}`, serialized data
JSON <=3584 UTF-8 bytes; normal notification sends use fixed Android high priority and the stored installation token.
TTL is min(12 hours from **first reservation**, remaining lease), never refreshed on ambiguous retry. Sender cannot
choose project, token, topic, condition, notification, priority or collapse options.

Only `accepted` and `token_invalid` are terminal stored results. A different digest under the same message ID is 409.
An ambiguous in-flight/crashed attempt returns 200 `{state:"pending"}` with `Retry-After` seconds until its 60-second
lease; retries before then do not call FCM. A timeout/FCM 5xx records `state:"retry"`, `code:"fcm_unavailable"` and
`retryAt`, returning **503 `{error:"fcm_unavailable"}`**. FCM 429 similarly returns
**429 `{error:"fcm_rate_limited"}`**. Both include `Retry-After` (seconds, rounded up, at least 1).
Transient backoff is 60 seconds and never shortens an ambiguous lease. An identical retry before retryAt returns the
same error without FCM; after retryAt it reserves a new external attempt. `send/status` returns the retry code and
numeric-millisecond retryAt without performing delivery. Pending status also has Retry-After.

Attempt IDs fence stale result writers. TTL stays anchored to the first reservation through every retry. Once 12 hours
from the first reservation have passed, send returns 410 `message_expired`; lease expiry returns 410 `route_expired`.
Status can still report retained terminal attempt metadata while its route remains valid. There is no payload queue
and **no exactly-once promise**. `unregistered` purges only the actual sent generation; a concurrent confirmed
replacement survives. The same message's terminal `failed/token_invalid` result remains queryable/idempotent; new
message IDs get 410 `token_invalid` until the phone challenges a replacement.

Fixed result codes: `accepted`, `token_invalid`, `fcm_rate_limited`, `fcm_unavailable`.
Error responses are `{error:<fixed code>}`:

- 400 `invalid_request`; 401 `unauthorized`; 403 `admission_denied`, `account_disabled`.
- 404 `not_found` (unknown/wrong send capability and cross-account management indistinguishable; delete has the
  absent-route 204 exception above). Delete rejects a send/malformed bearer before any lookup.
- 405 `method_not_allowed`; 413 `body_too_large`; 415 `unsupported_encoding`, `unsupported_content_type`.
- 409 `operation_conflict`, `installation_inactive`, `installation_exists`, `phone_limit`,
  `route_limit`, `challenge_invalid`, `challenge_expired`, `route_inactive`, `message_conflict`.
- 410 `account_deleted`, `route_expired`, `route_inactive`, `token_invalid`, `message_expired`.
- 429 `fcm_rate_limited`; 503 `fcm_unavailable`, `relay_unavailable` (never raw SDK error text).

## Firestore data model

All lifecycle timestamps above are numeric milliseconds; `purgeAt` is a Firestore Timestamp for TTL. TTL is never
a permission check. Single-field wildcard indexing is disabled; cascade query fields are explicitly indexed.

| Collection / document ID | Fields |
| --- | --- |
| `accounts/{uid}` | uid, state, createdAt, lastManagementAt, phoneAllowance, routeAllowance; `phones` map of installation ID to deadline/challengeDeadline, `routes` map of route ID to installationId/deadline/predecessorId. These bounded maps serialize capacity transactions. Expired entries pruned on management mutations/status. |
| `installations/{installationId}` | uid, state (pending/active/token_invalid/deleted), token/tokenHash nullable, generation, createdAt, lastManagementAt, deadline, challengeDeadline, pendingOperationId, confirmation receipt (operationId/challengeId/nonceHash/replacing/generation), last 32 completedOperations; deleted rows retain uid/generation/create time and purgeAt only. |
| `challenges/{installationId}_{operationId}` | uid, installationId, operationId, replacing, challengeId, nonceHash, tokenHash, stagedToken, deadline, attempts, purgeAt; deleted atomically on completion. |
| `challengeOperations/{installationId}_{operationId}` | uid, installationId, tokenHash, replacing, challengeId, deadline, purgeAt; 24-hour idempotent begin receipt, no token or nonce; retained across replacement/completion, erased on phone removal. |
| `tokenOwners/{sha256(token)}` | uid, installationId, generation; one global owner; replaced only in confirm transaction. Old owner's token scrubbed atomically. |
| `routes/{routeId}` | uid, installationId, operationId, sendHash, deleteHash, predecessorId nullable, state, createdAt, pendingUntil, leaseExpiresAt, absoluteExpiresAt, generation, purgeAt. Physically deleted on revoke; no send/delete credential tombstones. |
| `routeRevocations/{routeId}` | purgeAt only, through original absolute expiry +24 hours; no UID/installationId/credential hashes. Prevents a stale phone create retry from reviving deleted authority, **not** used to authorize delete. |
| `sendAttempts/{routeId}_{messageId}` | uid, routeId, messageId, digest, reservedAt, state, code when settled, leaseUntil, retryAt for transient failure, attemptId, purgeAt; no ciphertext/token/provider reply. |

TTL: challenges/challenge-operation receipts/attempts/deleted installations 24 hours; active route purge lease +24 hours.
All delete-only receipt tombstones are removed. The secret-free revocation marker is retained solely for create/revoke
race safety; deletion of an absent route writes nothing, including when that marker exists.
TokenOwners has no TTL; confirmation/invalidation/removal updates it atomically. T94 must scrub orphan ownership and
expired installations/challenges/challenge-operation receipts/routes/attempts and prune account maps; no silent token
restoration. Account cleanup must include challengeOperations. routeRevocations deliberately cannot be linked to a UID.
Index/TTL placeholders also cover future `rateLimits`, `relayControl`, `accountCleanup`; no such rows are written yet.

## D52 residual and lifecycle decisions

The upstream framework still returns its own 400 and may log a body excerpt for malformed **application/json**
requests before our function runs. This is a documented non-protocol residual, not a production blocker under D52:
real clients use octet-stream exclusively, so their bytes never reach that parser. HTTP checks prove successful
JSON-looking octet-stream enrollment, fixed handler errors for scalar/malformed JSON and no body-probe values in
the emulator's framework log. Other content types reaching the handler get fixed 415/no-store.

One successor per predecessor is enforced at the relay. The phone enforces one per backend session because the relay
never receives backend/session identity. Backend create retries must not reuse a revoked route ID; the anonymous
revocation marker also rejects delayed create retries during the original authority's lifetime.

## Section 12 acceptance coverage (this half)

All test names below are in `checks/<concern>.cases.ts`, imported by the single emulator entry point.
Each table row is the in-scope part of a section 12 acceptance item; nothing below claims T94 or client acceptance.

| Acceptance item | Test coverage |
| --- | --- |
| Verified email-link/Google enroll without approval; no profile copy | admission: “verified email-link and Google enroll…” |
| Missing/anonymous/custom/unverified/wrong-project/revoked admission denied | admission: “missing, anonymous, custom, unverified, wrong-project and revoked…” |
| Cross-account reads/management denied; two phones separately scoped; phone removal preserves other phone | installations: “cross-account management denied; two phones are separately scoped…” |
| Concurrent last enrollment slot has one winner; expired reservations release slots | enrollment: “concurrent last phone slot has exactly one winner…” |
| Wrong UID/installation/challenge; token string alone cannot answer; five replies maximum | enrollment: “wrong UID, installation and challenge fail…” |
| Challenge normal priority, random nonce, hash storage and idempotent begin/confirm | enrollment: “challenge has 256-bit nonce, normal priority, hashes only…” |
| Replacement needs possession; old confirm cannot revert ownership | enrollment: “token replacement is atomic, old confirm cannot revert it…” |
| Lost enrollment/replacement challenge superseded by new operation; old operation stays idempotent | enrollment: “new operation replaces a lost enrollment challenge…” and “new token operation replaces…” |
| Pending routes cannot send; phone/account caps; one successor per predecessor and atomic activation | routes: “pending cannot send; eight per phone…” and “pending route reservations expire…” |
| Lease renewal window, ninety-day absolute lifetime, code-enforced expiry; delete after expiry | routes: “renew only under seven days…” |
| Capability A cannot send/manage B or select FCM options; send/delete schemes disjoint | routes: “capability A cannot send B…”; delete: “delete scheme is rejected before any Firestore lookup…” |
| Direct Firestore client reads/writes denied | installations: “direct client Firestore reads and writes denied” |
| Corrupt/oversize/reserved outer keys/wrong version rejected before FCM; fixed destination/options | send: “corrupt, reserved keys…” and “serialized data cap and HTTP body cap…” |
| Duplicate/concurrent sends, lost reply, conflicting digest, minimal status | send: “duplicate sends and lost HTTP reply…” |
| Crash after FCM acceptance; ambiguous lease; first-reservation TTL | send: “crash after FCM acceptance…” and “remaining route lease caps TTL…” |
| Transient 429/5xx/timeout retry only after retryAt; terminal results remain stored | send: “FCM 429 and 5xx…”, “transient 429/503 results retry…”, “in-flight attempt is pending…” |
| Concurrent token rotation versus stale invalid-token result | send: “UNREGISTERED purges only sent token generation…” |
| Create/confirm/revoke races never revive authority | enrollment: “delete racing confirm or creation…”; delete: “create retry and activation racing a revoke…” |
| Delete blocks later sends; A/B/C routes independent; absent delete idempotent | delete: “three backend routes…” and “absent delete returns 204 forever…” |
| Out-of-band Auth disable/delete and account state block next send/challenge | admission: “Auth disable/delete outside relay…” |
| No sensitive application log/error output | send: “full flow logs contain no identity…”; HTTP: “octet-stream JSON-looking client bytes…” |
| Production startup refuses test seams; App Check monitor-only | startup: “production refuses every emulator/bypass flag…”; admission: verified enrollment observes invalid App Check |
| HTTP routing, POST-only, caps/auth/no-store; real Admin Auth/Firestore/local fake FCM | HTTP: “routing, POST only…”, “real Admin Auth/Firestore…”, “real HTTP send/status/delete…” |
| No outbound network; trusted source-address extraction | router: “network guard rejects…”; startup: “trusted client address…”; whole suite passes in isolated network namespace |
| Typed stored documents fail closed | installations: “Firestore converters fail closed…” |

Deferred, not falsely counted: T94 budgets/global admission caps/kill switch/operator disable/account deletion/reconciliation
and their crash/restart/UID-churn tests; ECDH/AEAD/replay/client registration/transport outboxes (T92 and subsequent server/
Android work); provider linking UI/conflict handling, OS delivery, web worker lifecycle and real-project acceptance.
Verified email-provider claim does not prove email-link UI use; this is the design's explicit admission boundary.

## Next task / integration boundary

T94 adds route/account/IP/global transactional request/send/challenge/daily limits, admission caps, durable control
switches, operator disable, recent-auth `accounts/delete`, resumable `accountCleanup` and hourly orphan reconciliation.
Charge before every external attempt; completed-result/status lookups must not spend send budget. Preserve first
reservation times, generation fencing, bounded membership and delete-without-budget behavior. Check control/account
state in the reservation transaction, fail closed on unreadable state, and perform uncached Auth state lookup.
This package has neither production quota protection nor a live deployment recipe.

Server transport must persist ciphertext/message IDs and delete-only outbox entries, pin the relay URL, use only route
capabilities, never phone Firebase tokens/FCM addresses, and keep Notifier's policy before transport. Do not advertise
this relay to clients yet. Use octet-stream, honor Retry-After and retain the same digest/message ID; an absent-route
204 completes the delete outbox indefinitely. Cross-check validators against T92's shared
vectors without coupling root installation to firebase-tools.
