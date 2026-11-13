# Push relay (emulator-verified; operator-run deployment only)

Isolated Bun package, **not a root workspace**. These checks deploy nothing and never use a real Firebase project.
Implements T93 and T94 of the approved [design](../docs/research/push-relay-design.md).
No real Firebase project, login, credentials, key file, FCM or App Check service is used by the tests.
Real-project IAM/provider/ingress acceptance is not complete. [DEPLOY.md](DEPLOY.md) contains the reviewed-to-be-run
operator procedure, private Functions parameters, database/rules/index cases and explicit ADC operator CLI; this is not
permission for the agent to log in, inspect config or deploy. D53 resolves the credential-digest framing mismatch. T94's budgets, switches, durable cleanup and reconciliation are implemented. D51 makes both relay accounts and relay push optional: Kemiri works fully without them.
D52 settles the original parser, deletion, retry and lost-challenge questions as documented below.

## Exact emulator recipe

Requirements: Bun, Node (host has 24; function declares Node 22), Java (host has OpenJDK 25), `ss`.
No system installation is needed. From the repository root:

```sh
# Root compiler/test helpers are needed for relay checks/e2e, not for deployed runtime dependencies.
bun install --frozen-lockfile
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
Per-stack HOME/config/cache and captures are under gitignored `relay/.emulator/`; CLI debug logs in `relay/` are also
ignored and must stay private. Emulator jar is under
`.emulator/home/.cache/firebase/emulators/` (linked into each stack's private HOME). Generated
`.emulator-config-<functions-port>.json`, per-stack function copies/`.env.local`, `.firebase/`,
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

### Standalone demo stack

From `relay/`, after the one-time install/cache setup above:

```sh
mkdir -p .emulator
setsid -f bun run demo:stack --minutes 30 > .emulator/demo-stack.log 2>&1 < /dev/null
# Wait for the one JSON readiness line in the log, or .emulator/stack-19373/ready.json.
# Read the pid from that JSON, then stop only that PID:
kill -TERM <pid-from-ready-json>
```

`demo:stack` builds automatically, starts Auth/Firestore/Functions plus a **standalone fake FCM** listener,
and explicitly seeds `relayControl/settings` enabled with enrollment open. It never contacts real FCM, Auth or
Firestore. It accepts only `--minutes <1..120>` (default 30), a fixed synthetic `demo-aiki-relay` project and the
seven port variables above. There is no project/host override. It stops its own listener and asks the CLI to stop
all owned emulators on SIGTERM/SIGINT/SIGHUP, failure or deadline. Stop by the readiness JSON's PID, not a broad
process-name match; wait for its exit/ports to close before reusing them. Nothing starts an Kemiri server.

The readiness object includes `pid`, `projectId`, `functionBaseUrl` (ends in `/v1/`),
`authEmulatorHost`, `firestoreHost`, `databaseId`, `fakeFcmUrl` and `captureFile`. CLI/build logs go to stderr; readiness is one
stdout JSON line. A previous run's `ready.json` is discarded before startup and removed on handled shutdown. Wait for
this run's **new** readiness line; after an abrupt kill, verify process ownership rather than blindly trusting an old PID
file (PIDs can be reused). Each stack has its own generated config, function snapshot, fake-FCM `.env.local`, HOME and
capture file under ignored `.emulator/stack-<functions-port>/`. Distinct complete port sets can coexist even in
the same checkout; only the downloaded jar cache is linked/shared. Rebuild/restart a demo to pick up source changes.

```sh
curl -s 'http://127.0.0.1:19377/captured?after=0'
curl -s -X POST http://127.0.0.1:19377/mode -H 'Content-Type: application/json' --data '{"mode":"unavailable"}'
```

`GET /captured?after=n` returns `{"messages":[...],"next":N}`; indices start at **1**, so `after=0` returns
everything, and subsequent polls use the previous `next`. Each message is also appended as one JSON line to
`captureFile`: `index,time,token,data,priority,ttlMs`, with time in Unix milliseconds. No captures are printed.
Only use synthetic demo identities/tokens; captures contain possession nonces and encrypted payloads and must stay
ignored/private. A fresh run starts a fresh file/cursor. A driver can forward `message.data` to the phone test
delivery hook; fake acceptance alone does not prove phone delivery/decryption.

`POST /mode` accepts exactly `{"mode":"accepted|unregistered|rate_limited|unavailable|timeout"}` (choose one).
Default is accepted; every send is captured even on failure. Timeout is a deterministic ambiguous reply, not an
indefinitely open connection. Both POST endpoints require JSON content type.

Android Emulator sees host loopback as **10.0.2.2**: replace the host in the printed URLs for emulator-side clients,
but do not change the listeners' bind address. Alternatively run `adb reverse tcp:19373 tcp:19373` and
`adb reverse tcp:19371 tcp:19371` so the app can keep loopback Functions/Auth URLs; reverse any additional port the
driver actually needs, using that stack's selected ports. A host-side capture-forwarding driver uses ordinary host
loopback. `RELAY_DATABASE_ID` can choose a validated named demo database (default `(default)`); seed and Functions use
the same ID, and readiness reports it. It never changes the synthetic project or loopback hosts. This is emulator-only plumbing, not a release URL or a real Firebase login recipe.

`bun run test:demo` starts an alternate-port stack (19671–19677), performs email-link emulator sign-in and phone
enrollment entirely through HTTP, reads/confirms the captured challenge, checks capture cursors and all five fake
results, signals its PID and verifies every port closed. It also checks named-database HTTP isolation. Run it offline as
`unshare -Urn sh -c 'ip link set lo up && bun run test:demo'`.
Other workers reserve 19471–19477 and 19571–19577; default relay ports remain 19371–19377.

Bare `bun run emulator:start` still runs for at most ten minutes without standalone fake FCM; prefer `demo:stack`
for manual/end-to-end drivers and the bounded exec recipe for checks.

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
  Deliberately independent of `packages/`; checks read the shared vectors as data without production imports.
- `src/index.ts`: one v2 `onRequest` export `relay`, Node 22 declaration, ADC production wiring, 30-second timeout,
  min instances 0/max 2, ten-second FCM deadline. No credential file.
- `src/startup.ts`: production rejects emulator/test configuration; emulator requires a demo project and loopback
  Auth/Firestore, always uses local fake FCM. No App Check bypass exists. Discovery uses default fake port until
  `.env.local` overrides it at invocation. App Check is monitored only; backend send/status/delete never require it.
- `firestore.rules`: deny every direct client read/write in a database solely owned by relay. Never overwrite shared
  rules with it: use the exact guarded blocks in `firestore.shared.rules.example` and DEPLOY.md.
- `firestore.indexes.json`: TTL overrides and disabled automatic indexes; only installation cascade query fields indexed.
- `src/client-address.ts`: extracts only the GFE-appended rightmost X-Forwarded-For address for the direct 2nd-gen
  endpoint, never a client-supplied earlier value. Missing/malformed metadata is empty (T94 must fail closed).
  The loopback-bound emulator ignores forwarded headers and uses a fixed loopback admission IP because its worker
  receives serialized requests without a peer socket; core checks inject reserved synthetic IPs. See Google's
  [function headers](https://docs.cloud.google.com/functions/docs/reference/headers) and
  [load-balancer headers](https://docs.cloud.google.com/load-balancing/docs/https#x-forwarded-for_header).
  **Verify the actual forwarding suffix on the real project before IP limits rely on it.** Extra load balancers or
  proxies change the topology: do not guess another hop or trust a caller-selected earlier entry.
- `tools/emulators.ts`, `checks/network-guard.ts`: scrubbed launcher and network guard. `checks/emulator.cases.ts`
  imports concern-specific `.cases.ts` modules; `checks/support.ts` alone owns fixtures and emulator lifecycle.
- `.prettierrc.json`: tabs, double quotes, 120-column target. `bun run format:check` enforces formatting.
  `bun run typecheck` covers production source with pinned relay TypeScript 5.9, then checks/tests/tools and imported
  integration helpers with the root compiler. Only production source is built into `dist/`; runtime stays self-contained.

Pinned direct dependencies: `firebase-admin` 13.6.0, `firebase-functions` 6.6.0;
dev: `firebase-tools` 14.22.0, TypeScript 5.9.3, `@types/bun` 1.3.10, Prettier 3.6.2.
Initial install: 708 packages, approximately 298 MiB `node_modules`; Firestore jar approximately 61 MiB under the
isolated HOME, plus approximately 30 MiB Bun cache (92 MiB total emulator state after checks). Firebase CLI uses
`HOME/.cache/firebase/emulators` for the jar despite XDG_CACHE_HOME; both locations remain isolated.
Build output is not committed. Bun blocks two optional dependency postinstalls; no trust override is needed.

## T94 budgets, switches and account lifecycle

### Implemented limits

All numeric limits are tunable nonnegative integers under `relayControl/settings.limits`. Missing numeric values use
these code defaults; missing settings/boolean switches mean **paused/closed**, not enabled; an unreadable/malformed document fails closed. A value of zero exhausts that budget. Operator changes do
not reset counters. All applicable ceilings compose; an exhausted budget wins, with the latest reset among ties.

| Limit keys | Pilot default |
| --- | --- |
| routeMinute / routeDay | 30 / 500 |
| accountMinute / accountDay | 60 / 2,000 |
| ipMinute / ipDay (sends) | 120 / 5,000 |
| managementMinute / managementDay (source IP) | 10 / 200 |
| requestMinute (coarse proof/status/duplicate admission) | 30 |
| accountChallengeHour / accountChallengeDay | 3 / 10 |
| ipChallengeHour / ipChallengeDay | 10 / 20 |
| enrollmentDay (new enrollment operations/account) | 20 |
| newAccountIpDay / newAccountDay (whole relay) | 5 / 20 |
| activeAccounts / activePhones | 100 / 300 |
| relaySendDay / relayChallengeDay | 5,000 / 100 |
| accountPhones / phoneRoutes / accountRoutes / pendingChallenges | 3 / 8 / 24 / 3 |

**Window algorithm:** minute/hour/day counters are fixed, UTC-aligned windows, identified by
`floor(serverNow / width) * width`. Each has one count and startedAt, never one durable timestamp per event.
N requests fit each aligned window; an arbitrary rolling interval of the same width can contain **at most 2N**
because it intersects at most two aligned windows. The boundary test demonstrates that exact worst case.
This is the documented approximation permitted by the brief, not a claim of the original design's exact rolling
minute bound. Hours are aligned calendar hours; daily windows reset at UTC midnight.

A new external send reserves route/account/IP/global allowance **in its attempt transaction**, including ambiguous
or transient retries after the lease/retryAt. Completed result, status and too-early retry lookups spend no send
allowance. Failed/expired/replaced challenges retain their charge. A same-operation begin receipt spends no new
challenge/enrollment allowance. Well-formed new enrollment operations also spend enrollmentDay on structural/capacity
rejection; only the enrollment counter commits on that rejection, not external-challenge/new-account budgets.
Token replacement consumes challenge budgets but is not a new-phone enrollment attempt.

Before expensive Auth/route lookups, a random in-document coarse IP reservation occupies one of requestMinute slots.
Validated new external sends refund that slot; statuses, duplicate results, invalid proofs and new enrollment/create
requests retain it. Successful non-status management operations otherwise refund it while spending management quotas.
Thus steady valid sends can use the larger send budgets, but **more than 30 simultaneous proof checks** on one NAT can
temporarily get request_rate even if send allowance remains. This is deliberate bounded admission, not a positive Auth
cache. There are no counters keyed by unverified route/message IDs; an invalid-proof flood on one IP keeps one bounded
IP row, no send-attempt rows. Firestore contention can still yield safe transient 503s.

Deletion paths bypass all these budgets, even with switches off. This means a well-formed absent-route delete still
costs a Firestore lookup: D52's indefinite 204 and guaranteed cleanup availability cannot also make that lookup subject
to an exhausted proof budget. This residual abuse cost is explicit, not a promise that application quotas cap hostile
invocation/Firestore/Auth bills. Direct Auth signup also bypasses relay admission caps (tested).

Source-IP bucket IDs are daily HMAC-SHA-256 values, not raw IPs. relayRuntime/state retains only the current day's
random key and bounded live account/phone membership. Daily aggregate global/IP counters survive deletion; UID/route
counters are erased by account deletion, while disable retains short-window counters so re-enable refunds nothing.
IP buckets expire logically at UTC midnight (at most 24 hours). TTL and hourly indexed expiry cleanup physically
erase them eventually; **Firestore TTL/outages cannot guarantee physical removal exactly at 24 hours**.
The first request after midnight rotates the key; reconciliation also rotates it when accounts are present.

Active capacity means active relay rows/reserved or enrolled phones, not just phones that sent recently. Pending
phone capacity expires in five minutes; account capacity remains occupied until disable/delete. Active-capacity
exhaustion has no known reset: enrollment_capacity's retryAt is the next UTC-day recheck time, not a promise of a free
slot. Daily-account admission limits have a real midnight reset. New accounts and phones reserve capacity atomically.

### Switches and status

A fresh deploy starts paused: missing `relayControl/settings`, `{}` or omitted booleans mean `enabled=false` and
`enrollmentEnabled=false`. Tests/demo explicitly seed enabled switches. `seed-control` creates paused settings before
operator deployment. No read/parse failure can become permission. Numeric limits alone never enable the relay.

`enabled:false` pauses send/challenge/route-create/activate/renew request paths with 503 relay_disabled, including
idempotent calls on those write paths. `send/status`, inventory and account status remain readable subject to request
budgets; deletion remains available. The reservation and final pre-FCM check both read uncached control/account state.
Already in-flight FCM cannot be recalled. `enrollmentEnabled:false` prevents new relay accounts/phones, not existing
phone token replacement, route maintenance or Firebase Auth signup.

`accounts/status` adds `quotas:[{scope,budget,remaining,resetAt}]` (15 bounded entries), effective phone/route caps,
and for an active account relayEnabled/enrollmentEnabled. A deleting marker reports state deleting and
deletionPending true. Values are advisory snapshots; request authorization always rechecks durable state.
Quota errors are `{error:<scope>,retryAt:<epoch-ms>}` plus Retry-After seconds, rounded up. Scope codes distinguish
route_rate/account_rate/ip_rate/request_rate/challenge_rate/enrollment_rate/relay_capacity/enrollment_capacity.
Transient FCM errors keep D52's error-only bodies and Retry-After.

### Durable cleanup and authentication

`accounts/delete` requires `{operationId}`, verified/revocation-checked phone identity and auth_time no older than
five minutes (future auth_time is refused too). It first commits a deleting marker plus relayAccountCleanup work. The
marker blocks every send/challenge/create/renew before any cascade. Work uses a 60-second owner lease, batches of 50,
and at most 100 phase steps per run. Each batch and phase advance commit together. Crashes/outages leave pending work;
retries and the hourly core resume it. Completed work is deleted, never TTL-expired while unfinished.

Phases: auth_disable (disable only), routes, installations, challenges, operations, attempts, owners, counters
(delete only), auth_delete (delete only), finish. Disable changes Auth disabled and revokes refresh tokens before
erasing relay state, retaining only Auth identity, a minimal uid/state/cleanupComplete marker and short-window abuse
counters. Re-enable is explicit, requires completed cleanup, and restores no phone/route. Deletion erases UID-specific
counters too, deletes Auth, then removes the final account marker/work. Global/IP counters and unlinkable route
revocation markers are not refunded. A phone-only removal/sign-out preserves other phones and account budgets.

**Android completion (D53):** after a delete request, **410 account_deleted means complete for the phone**, just like
200 deleted. Routes, tokens, challenges, attempts and UID-specific counters are erased before the Auth user is deleted.
A crash afterward can leave only blocked account/cleanup/capacity bookkeeping; reconciliation finishes those final
markers. The phone can finish local erasure and stop polling on 410. Required revocation checking is not bypassed,
and no new deletion credential is retained. Before Auth removal, 202 deleting remains pending with Retry-After;
repeated requests reuse the durable operation.

The v2 `onSchedule` export `reconcile` runs every 60 minutes. Its plain `reconcileRelay` core checks uncached Auth
state, queues the same durable cascade for missing/disabled users, resumes work, prunes capacity maps, removes orphan
ownership and expires records in code. Expiry queries for high-volume attempt/operation/quota rows are indexed so
hourly repair does not reread every unexpired send. Account/route/installation scans are pilot-bounded.
Functions emulator discovers the scheduled export but does not run the production HTTP/OIDC Scheduler job; tests
call its plain core directly. The suite does not claim production Scheduler/IAM acceptance.

### Operator commands (no operator HTTP endpoint)

Start `demo:stack` separately for HTTP drivers, or bounded `emulator:start` for admin-only inspection. From relay/:

```sh
bun --no-env-file tools/operator.ts --emulator status --yes
bun --no-env-file tools/operator.ts --emulator pause --yes
bun --no-env-file tools/operator.ts --emulator enrollment close --yes
bun --no-env-file tools/operator.ts --emulator limits set relaySendDay 5000 --yes
bun --no-env-file tools/operator.ts --emulator account disable '<uid>' --yes
bun --no-env-file tools/operator.ts --emulator account enable '<uid>' --yes
bun --no-env-file tools/operator.ts --emulator account delete '<uid>' --yes
bun --no-env-file tools/operator.ts --emulator phone disable '<installation-id>' --yes
bun --no-env-file tools/operator.ts --emulator reconcile --yes
```

Replace placeholders only with the synthetic fixture IDs you intend to change. Add `--database '<database-id>'` for
a named database (default `(default)`); use that stack's `RELAY_*_PORT` values. `seed-control` creates missing settings
paused, but refuses to overwrite existing settings; a demo already seeded enabled settings. `resume` enables operations
without opening enrollment, and `enrollment open` is separate. Limits never reset counters. Status returns only switches,
limits, today's aggregate counters and reserved capacity, not identity/token rows.

**Every operation, even status reads, needs `--yes`; omit it for a plan with no SDK/ADC/network access.** Emulator apply
re-executes under `env -i`, isolated HOME/XDG, a demo-only project and validated loopback ports. Account/phone targets
and provider errors are never echoed. `admin.ts` is an alias using the same explicit mode/syntax, not the old JSON settings
interface. Busy/partial cleanup returns `complete:false,retryAfterSeconds:60`; repeat or reconcile, never delete its work.

The same tool supports an explicitly selected real project with the operator's ADC, using
`--project '<project-id>' --confirm-real-project` **instead** of `--emulator`. It refuses any emulator variable in
real mode. Nobody has run that path against a real project here. See [DEPLOY.md](DEPLOY.md) for exact commands,
least-privilege IAM, sole/shared database rules/indexes, paused deployment, alerts, provider shutdown, ingress verification,
log retention and rollback. Account erasure deletes the project-wide Auth identity, including a lost/disabled account;
review shared-app impact. Neither relay switch stops direct Auth signup/email charges.

T101 gates exercise every command through the real CLI entry, absent-switch pause/deletion, namespace isolation,
sole/shared compiled rules, private deploy-config merging, named-database selection and shared export identity/region.
All are emulator/local-file checks; IAM, named-database rule association, TTL timing and alert/control acceptance need
real-project verification by the operator.

### Metered Firestore operations

These are **actual SDK calls against the emulator**, not static estimates: failed transaction reads count, committed
set/update count as writes, deletes are separate, and empty queries count as one minimum read. No retry happened in
the measured specimens. Index-storage work, TTL, Auth API calls, FCM and platform logs are not Firestore document ops.

| Specimen | Reads | Writes | Deletes |
| --- | ---: | ---: | ---: |
| One accepted send, including proof reservation/refund, quotas and final result | 20 | 10 | 0 |
| First enrollment, begin + confirm, including management/proof admission | 31 | 21 | 1 |
| Entire account deletion: one phone, one route, one accepted attempt and its UID counters | 33 | 13 | 9 |

The design's 6-read/6-write send assumption is superseded. Uncached Auth checks also add provider API latency/quota.
Transaction retries, larger cascades and reconciliation add operations; these numbers are not a bill or cost ceiling.

### D53 frozen-format cross-check

Credential hashing now agrees with the frozen library/vectors: SHA-256 over UTF-8 compact JSON
`["aiki-push-v1","credential",<full bearer>]`. routes/create receives lowercase hex; the fixture's base64url digest is
compared byte for byte after decoding. Both bearer schemes are present in the fixture, as are both direction-negative
vectors. No credential/bearer vectors were missing, and no frozen files were changed.

The cross-check found and fixed these relay bugs:

1. The raw-full-bearer hash did not use the frozen JSON domain frame (0/2 digest vectors matched before the fix).
2. send accepted only an object envelope, but every frozen sendBody and the server serialize envelope as a string
   (0/22 positive envelopes were accepted before the fix). The wire now requires the canonical string, not an object.
3. Ciphertext length admitted unpadded/truncated/oversize data. It now requires 272–2,064 decoded bytes and
   `(ciphertextBytes - 16) % 256 == 0`, matching the frozen padded plaintext format.
4. Object normalization lost duplicate keys and non-canonical text. Serialized envelopes must now exactly equal the
   canonical v/r/k/m/n/c JSON, rejecting duplicates, whitespace, key reorder and alternate numeric/escape forms.

checks/shared-vectors.cases.ts reads ../packages/protocol/test-vectors/push-relay-v1.json only as test data.
Production imports neither packages/ nor the fixture. All 19 encryption and 3 opaque-payload receive vectors go
through the real core as send bodies, using the fixture's hashes to create the route, and reach fake FCM byte for
byte. The fixture's delete bearer then receives idempotent 204. The 21 applicable negatives reject before FCM:
15 public-envelope failures, 2 wrong bearer directions and 4 FCM maps submitted as unsupported POST bodies. The FCM
map tests are schema rejection, not a claim that clients may supply raw FCM data. Unknown fixture additions fail
classification rather than silently disappearing from coverage.

The remaining 39 negatives are explicitly excluded from keyless rejection:

- Authentication/context (9): ciphertext, tag, nonce, aad-r/k/m, wrong-key, wrong-key-id, wrong-session. The relay
  has no AES key or registered phone key/session context. A well-formed opaque envelope remains transport-valid.
- Encrypted plaintext (16): invalidUtf8, excessivePadding, extra, sequenceOverflow, eventIdLength, negativeTime,
  tooLongLived, duplicateWrapper, duplicatePayloadWrapper, wrapperNumber, wrapperWhitespace, payloadArray, payloadNull,
  payloadString, payloadInvalidLiteral, payloadInvalidNumber (all prefixed plaintext- in the fixture). These require
  decryption; plaintext-unpadded is instead rejected because its ciphertext length reveals invalid padding.
- Other phone-only inputs (14): point-short/prefix/infinity/offCurve/outOfField; transcript/swapped-direction;
  sequence--1/01/18446744073709551616/1.0/empty/1e3; identity-overflow. Points, confirmations, plaintext sequence and
  plaintext construction are not inputs to the relay API. T92 tests those operations.

Derived cases also exercise nonzero base64 padding bits, canonical text, legacy object rejection, cipher bounds and
exact 4,096-byte send-body acceptance versus 4,097-byte rejection. Old emulator rows containing raw bearer hashes
must be reset or removed by the owning phone; there is deliberately no legacy-hash fallback and no live migration.

### Backend contract audit (D52/D53)

Checked docs/push-relay-backend-v1.md and packages/server/src/push-relay/transport.ts:

| Behaviour | Result |
| --- | --- |
| POST octet-stream JSON, no-store, no redirects | Matches; canonical string envelope is now accepted |
| 200 accepted removes the send; 200 pending retries | Matches; pending includes Retry-After |
| 429/503/other 5xx/timeouts transient | Matches; known quota/operator/FCM codes survive, unknowns are sanitized; Retry-After honored |
| Terminal 200 failed/token_invalid | Matches: top-level code is recognized |
| 403/404/410/409 and unknown 4xx | Matches after the T99 server parser fix: named pause/terminal reasons survive |
| Delete 204 erases outbox secret, all other statuses retry including 404 | Matches D52 absent/wrong-secret behaviour |
| First-reservation TTL and duplicate ambiguity | Matches; server's 10s deadline may time out around FCM acceptance, handled by persisted IDs/60s lease |

The D53 audit found a server parser that ignored string `{error:"code"}` and backend wording that overstated physical
purge at the cleanup horizon. Both are resolved in the incoming T99 server change `wmqnkmvw`, not by changing relay
errors or authorization semantics. The server now consumes named account/token/route/quota/FCM reasons; local
cleanup_expired erases its own delete authority, not proof that eventual Firestore TTL has physically removed every row.
The end-to-end cases exercise real flat relay errors and persisted retry/deletion against isolated Kemiri backends.
See [the acceptance record](../docs/push-relay-acceptance.md) for exact scope and remaining real-project gates.

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
| `accounts/status` | `{}` | `{state,phones,routes,phoneLimit,routeLimit,quotas,...}`; state `unenrolled` before enrollment; quota and pending-deletion fields below |
| `accounts/delete` | `{operationId}` | 200 `{state:"deleted",deletionPending:false}` only after confirmed erasure; otherwise 202 `{state:"deleting",deletionPending:true}` + Retry-After |
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
`aiki_push_delete1.<routeId>.<independent 32-byte secret>`. `sendHash`/`deleteHash` are lowercase hex SHA-256 over
UTF-8 compact JSON `["aiki-push-v1","credential",fullBearer]` (without the HTTP `Bearer ` prefix), not raw bearer or
secret hashes. Schemes are disjoint, stored hashes compared with `timingSafeEqual`.
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

The send body's envelope field is a **canonical JSON string**, not an object. Its decoded outer shape is exactly
`{v:1,r,k,m,n,c}` in that order, where `r=routeId`, `m=messageId`. c is canonical base64url for 256-byte-bucket padded
ciphertext plus the 16-byte tag: 272–2,064 bytes, `(bytes - 16) % 256 == 0`. Only the outer envelope keys are strict. The relay does not decrypt or inspect plaintext;
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
Error responses are `{error:<fixed code>}`; quota/capacity errors additionally include numeric-millisecond `retryAt`:

- 400 `invalid_request`; 401 `unauthorized`, `recent_auth_required`; 403 `admission_denied`, `account_disabled`.
- 404 `not_found` (unknown/wrong send capability and cross-account management indistinguishable; delete has the
  absent-route 204 exception above). Delete rejects a send/malformed bearer before any lookup.
- 405 `method_not_allowed`; 413 `body_too_large`; 415 `unsupported_encoding`, `unsupported_content_type`.
- 409 `operation_conflict`, `installation_inactive`, `installation_exists`, `phone_limit`,
  `route_limit`, `challenge_invalid`, `challenge_expired`, `route_inactive`, `message_conflict`.
- 410 `account_deleted`, `route_expired`, `route_inactive`, `token_invalid`, `message_expired`.
- 429 `fcm_rate_limited`, `route_rate`, `account_rate`, `ip_rate`, `request_rate`, `challenge_rate`,
  `enrollment_rate`, `relay_capacity`, `enrollment_capacity`.
- 503 `fcm_unavailable`, `relay_unavailable`, `relay_disabled`, `enrollment_disabled`, `enrollment_capacity`,
  `client_address_unavailable` (never raw SDK error text). `cleanup_pending` / `account_not_disabled` are fixed 409
  operator-core errors, not exposed through a new operator HTTP API.

## Firestore data model

All lifecycle timestamps above are numeric milliseconds; `purgeAt` is a Firestore Timestamp for TTL. TTL is never
a permission check. Single-field wildcard indexing is disabled; cascade query fields are explicitly indexed.

| Collection / document ID | Fields |
| --- | --- |
| `relayAccounts/{uid}` | uid, state, createdAt, lastManagementAt, phoneAllowance, routeAllowance; `phones` map of installation ID to deadline/challengeDeadline, `routes` map of route ID to installationId/deadline/predecessorId. These bounded maps serialize capacity transactions. Expired entries pruned on management mutations/status. A completed disable retains only uid/state/cleanupComplete. |
| `relayInstallations/{installationId}` | uid, state (pending/active/token_invalid/deleted), token/tokenHash nullable, generation, createdAt, lastManagementAt, deadline, challengeDeadline, pendingOperationId, hadRoutes, confirmation receipt (operationId/challengeId/nonceHash/replacing/generation), last 32 completedOperations; deleted rows retain uid/generation/create time and purgeAt only. |
| `relayChallenges/{installationId}_{operationId}` | uid, installationId, operationId, replacing, challengeId, nonceHash, tokenHash, stagedToken, deadline, attempts, purgeAt; deleted atomically on completion. |
| `relayChallengeOperations/{installationId}_{operationId}` | uid, installationId, tokenHash, replacing, challengeId, deadline, purgeAt; 24-hour idempotent begin receipt, no token or nonce; retained across replacement/completion, erased on phone removal. |
| `relayTokenOwners/{sha256(token)}` | uid, installationId, generation; one global owner; replaced only in confirm transaction. Old owner's token scrubbed atomically. |
| `relayRoutes/{routeId}` | uid, installationId, operationId, sendHash, deleteHash, predecessorId nullable, state, createdAt, pendingUntil, leaseExpiresAt, absoluteExpiresAt, generation, purgeAt. Physically deleted on revoke; no send/delete credential tombstones. |
| `relayRouteRevocations/{routeId}` | purgeAt only, through original absolute expiry +24 hours; no UID/installationId/credential hashes. Prevents a stale phone create retry from reviving deleted authority, **not** used to authorize delete. |
| `relaySendAttempts/{routeId}_{messageId}` | uid, routeId, messageId, digest, reservedAt, state, code when settled, leaseUntil, retryAt for transient failure, attemptId, purgeAt; no ciphertext/token/provider reply. |

Additional typed collections:

| Collection / document ID | Fields and retention |
| --- | --- |
| relayControl/settings | enabled/enrollmentEnabled default false, partial limits default numerically; no credentials |
| relayRuntime/state | ipDay, current ipKey, accounts UID membership, phones installationId → uid/deadline; pilot-bounded capacity |
| relayRateLimits/ip-day-hmac, global, account-hash, route-hash | day, windows name → count/startedAt, bounded requests id/at, purgeAt; UID only on authenticated account/route rows |
| relayAccountCleanup/uid | uid, operationId, mode, phase, leaseOwner/leaseUntil, purgeAt reserved metadata (not applied to unfinished work); no token/profile/content; no TTL on unfinished work |

TTL: challenges/challenge-operation receipts/attempts/deleted installations 24 hours; active route purge lease +24 hours.
All delete-only receipt tombstones are removed. The secret-free revocation marker is retained solely for create/revoke
race safety; deletion of an absent route writes nothing, including when that marker exists.
relayTokenOwners has no TTL; confirmation/invalidation/removal and reconciliation update it atomically. The hourly core
scrubs orphan ownership and expired records, prunes maps and removes installations after the last route (hadRoutes)
or thirty days without a route. relayRouteRevocations deliberately cannot be linked to a UID. Query indexes cover UID
cascades and due expiry; other automatic indexes remain disabled.

## D52 residual and lifecycle decisions

The upstream framework still returns its own 400 and may log a body excerpt for malformed **application/json**
requests before our function runs. This is a documented non-protocol residual, not a production blocker under D52:
real clients use octet-stream exclusively, so their bytes never reach that parser. HTTP checks prove successful
JSON-looking octet-stream enrollment, fixed handler errors for scalar/malformed JSON and no body-probe values in
the emulator's framework log. Other content types reaching the handler get fixed 415/no-store.

One successor per predecessor is enforced at the relay. The phone enforces one per backend session because the relay
never receives backend/session identity. Backend create retries must not reuse a revoked route ID; the anonymous
revocation marker also rejects delayed create retries during the original authority's lifetime.

## Section 12 acceptance coverage (T93 and T94)

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

### T94 acceptance coverage

| Requirement | Test coverage in checks/ |
| --- | --- |
| Defaults, fail-closed malformed/missing/unreadable control | budgets: “missing control uses every pilot default…”; “specific control-read outage…” |
| Concurrent send edge; durable restart; fixed-window bound | budgets: “transactional send ceilings…”; “fixed UTC minute windows…” |
| Route/phone/UID churn; daily reset; source-IP key rotation | budgets: “IP/NAT and global daily scopes…”; “account sends persist across route rotation…” |
| Global sends/new-account caps across distinct IPs; deletion refunds nothing | budgets: “global daily sends and new-account budgets…”; “new-account caps do not refund…” |
| Global account/phone reservation, expired slot release | budgets: “global account and phone capacity reservations…” |
| Invalid-proof storage bound; status/duplicates spend requests not sends | budgets: “invalid-proof floods…”; “status and identical completed lookups…” |
| Challenge account/IP/global budgets; failed/expired/replaced challenges | budgets: “replacement, failed and expired challenges…”; “IP and relay challenge ceilings…” |
| Enrollment attempts include capacity rejection; duplicate begin exempt | budgets: “every well-formed new enrollment attempt…” |
| NAT management limits, reset fields and daily allowance | budgets: “management/NAT minute and daily windows compose…” |
| Kill/enrollment semantics; final pre-FCM check; deletion with every budget exhausted | budgets: “kill and enrollment switches…”; “management request budgets are IP-scoped…” |
| Direct Auth signup bypasses relay caps | budgets: “new-account caps do not refund after deletion; direct Auth signup…” |
| Disable/delete block before cascade; crash/resume every phase; all phones erased | lifecycle: parameterized “cleanup resumes after a crash at phase…” (10 phases) |
| Recent auth/revocation, pending deletion/status, Auth-erased polling residual | lifecycle: “account deletion requires recent revoked-checked authentication…”; “Auth-erased deletion polling…” |
| Re-enable requires fresh enrollment; old routes never revive; marker minimal | lifecycle: “operator disable/re-enable…”; “disabled marker stays minimal…” |
| One-phone disable/sign-out preserves other phones and counters | lifecycle: “one-phone disable and sign-out…” |