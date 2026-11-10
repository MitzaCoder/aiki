# Continue

## Standalone relay demo stack

`relay/ bun run demo:stack [--minutes 1..120]` builds and starts scrubbed demo-only loopback Auth/Firestore/Functions
plus standalone fake FCM, explicitly enables demo control/enrollment and prints one readiness JSON line (including
PID and `/v1/` base URL). SIGTERM that PID or let the 30-minute default limit stop all owned processes. Captures are
private ignored JSONL; `/captured?after=0` returns messages/next, and `/mode` selects accepted/unregistered/rate_limited/
unavailable/timeout. README documents polling, detached start/stop and Android 10.0.2.2/adb reverse.

Generated function copies/config/HOME are isolated per Functions port; only the cached emulator jar is shared. Default
ports remain 19371–19377; the standalone HTTP enrollment smoke check uses 19671–19677 (other workers own 19471 and
19571 ranges). No package/root dependency changes and no production configuration or credentials. Operator/deploy
work follows in a separate commit; this demo never grants real-project access. Offline standalone gate: 2 pass / 51
assertions / 26.51s, including clean SIGTERM/port shutdown. Relay typecheck/build and public/Gitleaks pass.

## D53 relay format parity and backend audit

Based on rebased T94 `ynzrrnts` / `819b4841`. This supersedes T94's credential-framing and deletion-polling warnings.
Relay credentials now hash UTF-8 compact JSON ["aiki-push-v1","credential",fullBearer], lowercase hex at routes/create.
No production package import: checks read the frozen shared JSON only as data. The audit also fixed relay bugs hidden
by synthetic fixtures: envelope must be a canonical JSON string (not an object), with exact outer key order/text;
ciphertext must be 272–2,064 bytes and (bytes - 16) divisible by 256. Duplicate keys and noncanonical encodings reject.
Old emulator rows with raw bearer hashes need reset/phone-owned removal; there is no live migration or legacy fallback.

All 22 positive envelopes and both bearer/hash vectors pass byte-for-byte through the core to fake FCM; 21 applicable
negatives reject before FCM. The other 39 are explicitly classified: 25 require decryption or phone key/session
context; 14 are phone-only point/confirmation/sequence/plaintext-construction inputs. The fixture contains both
credential vectors, so none were invented or missing. No frozen fixture/library/backend contract files were edited.
D53 accepts the existing UTC-window approximation and treats 410 account_deleted after a delete request as complete
for the phone: authority/content records are erased before Auth, while reconciliation finishes final markers.

Two backend audit findings remain for the coordinator: transport.ts reads top-level code or error.code, not the
relay's string error. 403 account_disabled therefore becomes rejected without pausing; named 410 reasons collapse to
route_expired. D52/D53 relay errors were not redesigned. The backend document also overstates physical purge at
absolute expiry +24h; authorization expires in code, but TTL/repair are eventual. Retry-After, transient 429/5xx,
200 accepted/pending/failed and delete retry/204 handling otherwise match. README has the full audit and skip list.

Checks: relay 84 pass / 1,275 assertions / 56.52s (79.58s full offline namespace command); root 2,110 pass / 24,295
assertions / 176 files / 203.56s, zero failures or root retry. No relay auto-discovery. Typecheck/build/format and
public/Gitleaks pass. Existing 20/10, 31/21/1 and 33/13/9 SDK-operation assertions still pass. Emulators/helper processes
and test listeners stopped; no credentials, real Firebase project/login, main move, push, deployment or standalone
Aiki server. Recipe remains relay/ bun run build, then unshare -Urn sh -c 'ip link set lo up && bun run test:emulator'.

## Real-project push relay operator checklist (T100)

[Operator checklist](push-relay-operator-checklist.md) collects settled choices, twelve private fact questions,
operator-only setup, release-APK acceptance and the three-backend rollout/rollback. Linked from DESIGN's relay section.
Docs only: no real Firebase/Google access or configuration/credential inspection, emulator, server, tests or deployment.
The CLI is demo-only and has no delete action; production deploy/admin procedures and Android account/build seams
remain unbuilt. Auth runtime permissions, safe attended staging enrollment and shared Firestore rules need explicit
review; missing switches default enabled. The documented credential-digest mismatch must be resolved before integration.
Public-source denylist and Gitleaks checks pass. No main movement or push.

## Android relay plumbing, optional and off by default (T96)

Built without UI, Firebase Auth, credentials, devices, emulators, servers or deployment. Rebased the Android stack onto
`ynzrrnts` (server relay plus limits/account deletion) and reran Bun install. D51 remains strict: upgraded and fresh
settings default `relayEnabled=false`; receive and token/foreground hooks do not evaluate relay storage/client/account
factories while off. The pure registration sync still sends today's exact registerFcm request. Unsupported backends
stay direct; eligible signed-in backends select relay exclusively. Relay-selected sessions reject plaintext even after
local route deletion. No operator-phone behavior changes and no notification screen edits.

Private build property: `harness.pushRelayUrl` / `HARNESS_PUSH_RELAY_URL` → `BuildConfig.PUSH_RELAY_URL`, empty by default.
HTTPS only outside debug; debug accepts literal loopback/localhost and emulator-host HTTP. The encrypted store is
`datastore/aiki-push-relay.preferences_pb`, separately excluded from cloud backup/device transfer, AES-256-GCM with a
separate Keystore alias and injectable cipher. It contains installation/enrollment/token operation state, route
capabilities and staged PKCS8 keys, derived notification keys, backend/session/local routing identities, leases,
predecessors, monotonic backend clocks/uncertainty, admission windows/event dedupe, delete-only/backend unregister
queues, account/quota/deletion state and fixed diagnostic counters. Records and generated relay requests redact their
string representations. Admission commits before presentation. Retiring keys/windows prune together at thirteen hours;
reboot/uncertain clocks fail closed. Key loss discards relay state and sets `relayRecoveryRequired`, blocking receive
and direct registration until an explicit transport choice; the next UI must not clear that marker prematurely.

`RelayAccount` is the token/not-signed-in port; Android composition intentionally returns not-signed-in until the next
account/UI task replaces it. `RelayBackendRpc`/`HarnessRelayBackendRpc` and `RelayBackendAdapter` now use the actual
generated registerRelay/confirmRelay/syncRelay protocol on existing sockets. Order: staged create → register → verify
identity/HMAC and persist keys → relay activate → backend confirm. Retries keep one operation and original registration
preferences. Wrong identity/HMAC/unknown_request queues deletion with no downgrade. Fresh sync clocks avoid old receipt
timestamps; midpoint RTT uncertainty is included conservatively inside the five-minute skew. Renewals, preferences and
confirmed token-generation repairs sync back to the backend. Local removal/session sign-out/off is durable before
best-effort remote unregister; explicit off/on reuses the enrolled installation rather than consuming phone slots.
`RelayNotifications` is the lazy integration boundary for service, token callbacks and foreground maintenance.

D53: create hashes already use lowercase hex from RelayCrypto.credentialHash (the frozen JSON-framed digest); no raw
bearer hash workaround was added. `RelayAccounts` exposes typed status/quota snapshots and durable account deletion.
Deletion clears receive authority before HTTP, retains operation/Retry-After across 202 and reauthentication, and treats
200 deleted or subsequent account_deleted as complete. Any account_deleted management failure erases keys/routes/replay;
account_disabled retains sign-in but blocks relay mutation/reception. Real sign-in, privacy/consent, explicit account
switch/reset handling and account controls remain the next task, not an implicit pairing/first-run requirement.

Debug-only `DebugRelayReceiver` requires shell DUMP permission and invokes the same router. Delivery recipe (only on an
authorized test emulator): `adb shell am broadcast -a io.github.mitzacoder.aiki.DEBUG_RELAY -p io.github.mitzacoder.aiki
--es aiki '<captured JSON>'` on one line. It never enables/enrolls relay. `:app:checkReleaseRelaySeam` generates the merged
release manifest and rejects the component/action. See apps/android/README.md for the same recipe.

Final gates after the limits rebase: **784 JVM tests / 102 suites, 2 skipped, 0 failures/errors**, including 43 new T96
tests; debug assemble and lint pass (**0 errors, 36 warnings, 1 hint**); merged release-seam check passes. Protocol
check: 337 DTOs / 91 request overloads. Root typecheck and public/Gitleaks guards pass. No verification TypeScript was
changed; full root tests were not required (only Android/docs changes). D51 regression uses factories that fail if any
relay storage/account/client/backend is touched, asserts no relay file exists, and compares the old plaintext parser's
output; actual notification registration tests assert the unchanged direct token/device/preferences request and
exclusive relay choice. MockWebServer covers every management endpoint, typed fixed/unknown errors, Retry-After,
redirect refusal and response caps. No rendered proof is needed: this task exposes no new UI.


## Relay budgets and durable account cleanup (T94)

Updated the stale workspace and based this task on squashed T93 `xlqlowlw` / `56c592f5`, which includes T92.
Implementation is `xrntxzzk` / `6a271382`; the following docs commit records its handoff. Emulator-only, no backend
uses it. No real Firebase configuration/credentials/login, main movement, push, deploy, Aiki server or system install.

Built transactional route/account/IP/global send budgets, challenge/enrollment/signup/capacity budgets, bounded
pre-proof admission, kill/enrollment switches, recent-auth accounts/delete, minimal disabled markers, deliberate
re-enable/fresh enrollment, phone-only disable, leased resumable cascades and hourly v2 reconciliation. All pilot
ceilings are tunable in relayControl/settings, missing settings mean defaults, failed reads never do. Each external
attempt is charged with its durable send reservation; duplicate/status results are not charged as sends. Deletion
works with every budget exhausted and switches off. Global/IP daily counts survive UID deletion. Source IP appears
only as a daily HMAC bucket; key rotation and logical bucket expiry use UTC days.

Windows are **fixed UTC minute/hour/day counters**, not exact rolling limits: N per aligned window, at most 2N in any
rolling interval of the same width; a boundary test proves the bound. Coarse admission reserves up to 30 in-flight or
non-delivery requests/IP; validated new sends refund slots, so more than 30 simultaneous proof checks on a NAT may
temporarily get request_rate despite available send budget. Active account capacity counts active relay rows until
disable/delete; its next-day retryAt is a recheck time, not a guaranteed slot-reset. TTL and provider outages cannot
guarantee physical IP-bucket deletion exactly at 24h; midnight logical expiry plus indexed hourly repair is implemented.

Account work commits a blocking marker first, then uses owner leases, batches of 50 and durable phases; incomplete
work has no TTL. Completed disable retains only uid/state/cleanupComplete plus Auth identity and short-window counters.
Reconciliation checks Auth drift, resumes work, expires rows, prunes maps, removes orphan ownership and removes phones
after their last route or thirty route-less days. Scheduled export is discovered but automatic triggering is ignored
without Pub/Sub in this emulator suite; its plain core is called directly. Admin wrapper always re-execs env -i into
demo/loopback-only Auth/Firestore, has no operator HTTP endpoint and is smoke-tested.

README has exact commands/limits/API/storage/operator examples and acceptance mappings. accounts/status adds
quotas[{scope,budget,remaining,resetAt}], effective caps, active-account switches and pending deletion. Quota/capacity
errors carry fixed scope + retryAt and Retry-After; FCM transients retain D52. accounts/delete accepts {operationId},
requires auth_time within five minutes and returns 200 deleted only after relay/Auth erasure, else 202 deleting +
Retry-After. If Auth is removed before a finalization crash, revocation-checked polling cannot succeed: 410
account_deleted is not proof all relay work is erased. Reconciliation finishes it. No revocation bypass or new erasure
credential was silently added. Guaranteed authenticated final erasure receipts would need a separate protocol choice.

**Integration blocker found:** frozen T92 relayCredentialHash hashes compact JSON
["aiki-push-v1","credential",bearer], whereas approved T93 hashes the raw full bearer. A synthetic cross-check returned
credential_hashes_match=false. T94 intentionally changed neither contract. Reconcile framing/hex encoding before
server/Android transport uses them. The relay still validates strict outer keys only and never decrypts payloads.
Real-project GFE forwarding suffix also remains unverified by design; test it before IP budgets rely on it.

Verification: 80 emulator checks / 1,079 assertions, 52.42s tests / 75.58s full offline command, under unshare -Urn with
only loopback. Includes every cleanup-phase crash, quota contention/restart/churn/reset, direct Auth signup bypass,
disabled/deleted Auth drift, linked UID, no sensitive logs and metering. A late re-run exposed fixture clock bugs:
the hourly-expiry case crossed a calendar-hour reset and a newly REST-issued auth_time could be ahead of the frozen
relay clock; fixtures now anchor that hour and synchronize issuance time. Final full suite passes, no skipped checks.

Measured real SDK document operations (reads/writes/deletes): accepted send 20/10/0; first begin+confirm enrollment
31/21/1; deleting one phone/one route/one accepted-attempt account 33/13/9. Counts include proof/management budget
transactions and minimum empty-query reads, committed writes only, no transaction retry in the specimens. They
supersede the design's 6+6 send assumption, exclude Auth/FCM/TTL/platform costs, and are asserted by a regression test.

Root: 2,035 tests / 23,778 assertions / 169 files, 190.80s (includes T92; no relay test auto-discovery), zero failures,
no rerun. Root install 0.568s, typecheck 1.17s and public/Gitleaks pass (timed 2.33s). Relay frozen install 0.01s,
source/tests/tools typecheck 3.47s and build 1.63s, formatter passes. No new dependencies. All emulator/helper processes
and in-process Auth/fake FCM listeners stopped; post-run ports/process inspection is clean. Reproduce from relay/:
bun install --frozen-lockfile; bun run typecheck; bun run build; online once bun run emulator:setup; then
unshare -Urn sh -c 'ip link set lo up && bun run test:emulator'. Isolated state/cache and ports remain unchanged.

## Bound relay metadata and delete authority (T95 follow-up)

Rebased workspace onto the accepted merged tip `pxxrzxsu` before changing code. Relay receipts now have a scheduled
`purgeAt`: ten-minute pending expiry plus 24 hours until activation, then absolute expiry plus 24 hours. Revoked
status uses the same route horizon. Both are pruned after restart even when no sends or remote cleanup remain.
Delete-only entries now retain their absolute expiry and stop at absolute expiry plus 24 hours, independently of a
long Retry-After. Wrong-secret 404 keeps capped-backoff retries until then. Expiry atomically erases the capability
and marks cleanup done; a secret-free `cleanup_expired` diagnosis survives restart for only 24 hours, then is pruned.
Minimal transport-selection tombstones remain, so pruning history cannot revive stale direct notification rows.
Pre-retention v1 files are upgraded conservatively using known route expiry or the relay's maximum 90-day lifetime.

Three fake-clock tests cover activated/pending receipt and revoked-status boundaries, restart, wrong-secret capped
backoff, expiry erasure without further HTTP, bounded diagnosis and stopped timers. All 50 relay tests pass.
Exact fields and retention rules are in `docs/push-relay-backend-v1.md`; no protocol, crypto, Android or UI changes.
Full checks on the merged base pass: root 2,110 tests / 24,295 assertions / 176 files (193.96s); root typecheck
1.33s. Web: 918 tests / 13,722 assertions / 70 files (2.77s), zero check errors/warnings (17.16s), production build
passes (12.25s). Incremental Android test/assemble/lint passes (7.82s): XML has 741 tests / 95 suites, two existing
skips, zero failures/errors; lint has 36 warnings, zero errors. Android used an explicit empty private-properties
source and no Firebase config. Install checked 262 installs without changes (1.26s); DTO check confirms 337 models/
91 requests (0.10s); shared vectors match (0.03s); public/Gitleaks guard passes. No flaky rerun, protocol drift,
services left running, main move, push or deployment.

## Backend encrypted push relay (T95)

Backend relay transport is wired behind private `AIKI_PUSH_RELAY_ENDPOINT` (complete operator-approved HTTPS v1 base
URL; loopback HTTP only for tests). With no setting, no relay store/files/feature/response fields are introduced;
direct FCM and Web Push remain unchanged. D51 remains optional. No Android/web UI or account flow was changed.
The exact RPC shapes, file fields, retry rules, limitations and Android call order are in
[the backend v1 contract](push-relay-backend-v1.md); DESIGN's Notifications subsection was written first.

`fcm-relay-v1` additionally needs device-auth support and every relay call requires an actual authenticated session,
even in optional mode. Register with a durable operation ID; verify the backend-confirm HMAC; persist phone keys;
activate the relay route; then phone-confirm to activate the backend. A stable persisted registration reply survives
restart. Its serverTime is the original receipt time: use syncRelay's fresh serverTime after a delayed retry before
anchoring the phone clock. Identity always comes from the session, never labels/device IDs. Confirm retries cannot
remove a pending successor or resume a paused route. Direct/relay selection is serialized, and durable relay selection
suppresses stale direct rows before their removal so a crash or in-flight switch cannot double-send the event.

Mode-0600 `notifications/push-relay.json` owns routes/receipts/selections/safe revoked status and exact ciphertext
send/delete-only outboxes. Independent `push-relay-counters.json` witnesses the next per-key sequence; allocation is
durable before encryption, exact HTTP body before send. Partial counter restore/malformed keys require new keys.
A coherent rollback of both files is fundamentally undetectable locally: full-backup restoration must agree fresh
routes/keys, or a future independent non-rollbackable witness is needed. Receipt and delete retention is bounded as described above.
Public-source ignore/guard rules reject both private filenames. No exports/logs/config/device read exposes secrets.

Existing dedupe/hold/interaction/filter/TTL/preview policy runs first. Retry checks current session/preferences/archive,
resends identical bytes with 5-second exponential jitter capped at 15 minutes, honors Retry-After, and stops at event
+12h/route expiry. At 100 queued messages/route, drop newest without allocating a sequence. Terminal route results
pause new sends; after token/route repair the phone explicitly syncs resume:true, which never replays old events.
Counter inconsistency cannot resume and requires fresh keys. No direct/plaintext fallback. Test success says accepted,
never delivered. Revoke/unregister/expiry stop local sends immediately and atomically erase send authority/keys into a
delete-only outbox before old rows disappear. Cleanup retries independently across restart; 204 or the relay purge horizon erases its secret.
Safe status distinguishes pending cleanup from done; still-signed-in phones can read it after unregister.

Checks at the final implementation: root 2,082 tests / 24,144 assertions / 172 files, zero failures (194.45s);
47 relay fake-HTTP/simulated-phone cases included. Root typecheck passes. Web 897 tests / 13,636 assertions,
zero check errors/warnings and plain bun run build passes. Android: 741 tests / 95 XML suites, two existing skips,
zero failures/errors; assemble and lint pass (36 warnings, zero errors). Android builds used an empty explicit private
properties source and no Firebase config. Protocol generation check (337 DTOs/91 request overloads), crypto-vector
check, install and public/Gitleaks guard pass. The first root run caught the expected unconditional feature-list
assertion; it was corrected for the now-conditional feature. No flaky-test rerun was needed.

The exact strip-only-compatible PushRelayError constructor fix from the coordinator is included in the protocol
commit. All new protocol/client TypeScript is erasable. No Firebase emulator, real relay/provider calls, private
credentials/config inspection, phone/emulator, UI proof, main movement, push or deployment was needed/performed.

## Plain notification wording (T98 follow-up)

Notifications now say **On (shared subscription)** and **On (own subscription)**, with **Needs re-subscribe**
("This backend's push key changed."), **Needs sync** ("Reopen the app while signed in."), **Off** and
**Unavailable** with its reason. The backend hint is "Each backend pushes on its own. If a subscription changes,
reopen the app while signed in." Implementation terms stay in code/docs, not settings labels, hints or authored
errors. Worker-start and registration-limit errors use ordinary notification/backend wording too. No subscription,
key, worker, backend or deploy behavior changed.

Updated unit/browser copy assertions, including a rendered-page check against implementation jargon.
Web: 918 tests / 13,722 assertions; check has zero errors/warnings; build and root typecheck pass.
No full root test run for this copy-only change; server files are untouched. Public-source checks pass.
Real Chromium mixed-key and operator legacy regression assertions pass, including zero subscribe/unsubscribe
calls for the three shared-key backends. Four refreshed after screenshots (desktop/phone, light/dark) and the
refreshed after interaction recording are saved on T98 with the existing tags. All fixture servers and Chromium
were stopped by PID. No main move, push, deployment, phone or emulator operation.

## Independent web push keys and subscriptions (T98)

Each independent backend now uses an opaque `/push/<sha256>/` registration served by `/push-worker.js`, separate
from the root app shell. Push-only workers have no fetch/resource cache/claim behavior. Same-key legacy backends keep
their existing root subscription and endpoint: no migration, rotation, re-subscribe or operator deploy change on load.
Fresh explicit enablement may also share root for a same-key group; a fresh pair of independent keys gets two scoped
workers. The persisted backend/origin/scope/key map contains no credentials; browser subscription objects come from
their registrations. Removal prunes its scope; root is released only after its last known user, conservatively retaining
it while an undiscovered offline backend might still use it. New scoped registrations are capped at 24 and dormant
unmapped registrations are removed. This is an application cap, not a measured portable browser limit.

Both workers now only mark a changed scope in IndexedDB and notify open pages. A ready signed-in page repairs that
scope's backend rows, not every configured backend. Repair generations prevent clearing a newer concurrent change.
No anonymous worker sockets or bearer material in Cache Storage. A browser that cannot expose its existing root key
keeps that subscription untouched and requires explicit enablement rather than guessing a key or migrating scopes. Settings show own-key/legacy, explicit per-backend
re-subscribe on key change, sync-needed, off and unavailable states; Brave guidance remains. Web push needs no relay
account (D51: an account is optional and only for Android relay notifications). Offline shared-root removal cannot
revoke an unreachable backend’s remote row without also disrupting other users of that root: remove while reachable
or revoke that backend’s device session. No hidden remote cleanup/auth bypass was introduced.

Server tests pin default VAPID path, 0600 creation/narrowing, restart persistence, malformed-file refusal and both
operator overrides. Static-serving tests pin JavaScript MIME/no-store behavior; root script location already permits
narrower scopes, so no `Service-Worker-Allowed` override is needed. `deploy/vapid-key.sh` is unchanged.
No protocol or Android changes.

Final checks: root 1,961 tests / 23,324 assertions, no failures or retries; root typecheck passes.
Web 917 tests / 13,709 assertions; check has zero errors/warnings; production build passes.
Chromium integration phases in `apps/web/scripts/push-browser.md` passed with six required-auth `createSetup` backends:
mixed independent/shared keys, each authenticated row and signed loopback send, an existing untouched legacy root,
separate independent scopes, disable/re-enable/removal, explicit key-change repair, marked-scope repair and the operator's
three-shared-backend regression (zero subscribe/unsubscribe calls, root only, no errors). Key-change proof seeds the
previous saved key; marker proof simulates expiry. Unit tests exercise actual worker events and signed-out deferral.
The separate server-test parent also passed all checks: root 1,941 tests / 23,251 assertions, web 897 / 13,636.
Only PushManager/permission use stubs; real push-service acceptance and non-Chromium browser limits need consented
follow-up. Style pass uses typed page/CDP helpers and one statement per line. No new runtime dependencies.

T98 artifacts include desktop/phone light/dark affected-row before/after screenshots and before/after Chromium
recordings. Initial top-of-page baseline screenshots are also retained, but the later affected-row pairs are the useful
comparison. All isolated servers and Chromium were stopped by PID. No live backend data or credentials were used,
no phone/emulator was touched, and no main move, push or deployment was performed.

## Push relay D52 rework (T93)

Reworked the emulator-only `relay/` package on top of `xlqlowlw`. D52 is implemented: clients send UTF-8 JSON bytes
with `Content-Type: application/octet-stream`; rawBody caps/parsing and fixed no-store errors stay inside the handler.
Other media types reaching it get 415. Malformed non-protocol application/json still hits the framework's own parser;
an HTTP test documents that residual. Another proves valid JSON-looking octet-stream enrollment plus scalar/malformed
handler errors and no client body probes in framework logs. Nothing is deployed or used by a backend. D51 makes relay
accounts and push optional; Aiki works fully without them.

Absent route + well-formed delete bearer now returns 204 indefinitely; existing wrong delete secret returns generic
404; wrong schemes fail before lookup. Route credentials are physically erased. Only a secret-free
`routeRevocations/{routeId}` marker (purgeAt, no UID/hash) remains through original absolute expiry +24h to prevent
stale create/revoke races from reviving authority. This is not a delete receipt or lookup dependency. Phone route
deletion is also idempotent. Challenge replacement with a new operation immediately deletes the previous challenge;
24h `challengeOperations/{installationId}_{operationId}` receipts preserve same-operation idempotence without a raw
token/nonce. Phone removal erases those receipts too; T94 account cleanup must include them.

Accepted/token-invalid are the only terminal sends. FCM 429 returns 429 fcm_rate_limited; timeout/5xx return 503
fcm_unavailable, each with Retry-After and a persisted retryAt. Same digest before that time does not call FCM; after
it reserves another attempt, preserving first-reservation TTL. In-flight/crashed reservations stay pending with their
60s lease/Retry-After. send/status adds retry with code/retryAt; terminal token-invalid remains queryable. Conflicting
digests still 409; elapsed message/route lifetime is 410. README has exact API, storage, error codes and an acceptance
table linking every in-scope design item to tests.

Source is split by admission/enrollment/installations/routes/send/delete/router, with ports and runtime-checked typed
Firestore converters for every collection; no any rows in handlers. Tests mirror those concerns with one support
file/lifecycle. Formatting uses tabs/double quotes/120 columns and Prettier 3.6.2; typecheck now includes tests/tools.
The trusted-client-IP adapter takes only the direct GFE-appended rightmost XFF entry, never earlier client values;
missing/malformed metadata fails closed. Verify the real ingress suffix before IP budgets rely on it.

Recipe remains: from relay/, `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, online once
`bun run emulator:setup`, then `bun run test:emulator`; offline proof:
`unshare -Urn sh -c 'ip link set lo up && bun run test:emulator'`. Launcher uses env -i, isolated HOME/XDG,
demo-aiki-relay, loopback 19371–19377, disabled UI and bounded emulators:exec. Jar cache:
`.emulator/home/.cache/firebase/emulators/`. Runtime declares Node 22; available Node 24 runs the function locally.

Checks: 41 emulator tests / 518 assertions / 27.40s test time (50.54s full offline command); all pass.
Root: unchanged 1,937 tests / 23,224 assertions / 168 files / 212.89s, no flaky rerun. Root install 1.216s,
typecheck 1.22s, public/Gitleaks 1.13s pass. Relay frozen install 0.01s, source+checks typecheck 2.93s, build 1.36s;
format check passes. Relay dependencies now ~306 MiB (Prettier added). No root workspace/dependency changes.
All Auth/Firestore/Functions/hub/logging/helper processes shut down; in-process Auth/fake FCM listeners closed;
port/process inspection finds none remaining. No real Firebase login/config/credentials, main movement, push, deploy
or Aiki server. T94 limits/switches/disable/account deletion/reconciliation remain deliberately untouched.

## Relay payload compatibility and reviewability (T92 follow-up)

Review found a real version-skew flaw: a crypto-layer list of payload keys/kinds would reject
new backend fields on older phones. Both receivers now validate the authenticated payload only
as a JSON object within the plaintext cap, preserving unknown fields and kinds for the caller.
Envelope and plaintext wrapper keys/lengths/order/encodings remain strict; payload JSON is not
canonicalized or reserialized for comparison. Wrapper-prefix/suffix and independent payload-slice
parsing reject duplicate wrapper fields. Padding remains minimal 256-byte ASCII-space buckets.
Sender preparation still takes typed NotificationPayload, bounds known fields, truncates preview,
preserves fitting extensions and drops extensions only in the encrypted fallback. No duplicated
kind list remains. TypeScript distinguishes RelaySendPlaintext from opaque received RelayPlaintext.

Android's existing parseNotificationPayload ignores unknown DTO fields via wireJson, but returns
null for an unknown kind (except test). The new JVM test confirms both outcomes after decryption;
that parser/service is unchanged. Thus a new field no longer blocks supported kinds, while old
apps retain direct-FCM behavior for unfamiliar kinds. DESIGN also records D51: relay accounts and
relay push are optional, and Aiki works fully without them.

Reformatted source/tests to one statement per line, TS tabs and about 120 columns; added public
API guarantees and named helpers. The shared file now has 19 sender encryptions, 3 opaque receive
cases and 60 rejections. All 15 original encryption envelope strings are unchanged; generator
--check passes after formatting alone. Gradle now declares the shared file as a test input, so
fixture-only edits invalidate its test cache rather than silently reusing old results. Kotlin's
JSON tree parser accepts non-JSON primitive tokens; receiver syntax validation rejects those
without imposing any payload schema or numeric normalization.

Follow-up final checks: root 2,035 pass / 23,778 assertions / 169 files, zero failures (191.57s);
98 relay tests / 554 assertions. JVM XML: 741 tests / 95 suites, 2 skipped, zero failures/errors;
97 relay tests. Combined: 2,776 tests, 2 skipped, zero failures. Assemble and lint pass (0 errors,
36 existing warnings); typecheck, Android generation (330 DTOs / 88 overloads), vector --check and
public/Gitleaks checks pass. No root protocol generator exists. No new runtime dependencies,
UI/service wiring, device access, live servers, main movement, push or deploy.

## Encrypted relay v1 library and shared vectors (T92, initial checks)

Unused libraries only: `packages/protocol/src/push-relay.ts` (exported) and Android notifications'
`relay/RelayCrypto.kt` / `RelayAdmission.kt`. No existing sender/service, RPC, UI or feature flag changed.
The frozen reference is `docs/push-relay-v1.md`; DESIGN's Notifications subsection points there.
The one synthetic fixture is `packages/protocol/test-vectors/push-relay-v1.json`, regenerated by
`bun scripts/generate-push-relay-vectors.ts [--check]`; JVM tests read that file directly, not a copy.
It contains fixed P-256 scalars 1/2, agreement/HKDF/HMAC/capability hashes, 15 exact encryptions,
51 typed rejections, persistent replay-window states and expiry/skew boundaries. Both languages
independently encrypt to the same bytes, decrypt them, and round-trip random production keys/nonces.

Choices frozen: compact canonical JSON/field order, integer Unix milliseconds, canonical u64 strings,
ASCII-space padding to minimal 256-byte buckets (including the 2,048-byte cap), bounded identities/
routing/title, Unicode-code-point preview truncation, encrypted minimal fallback without truncating
routing IDs, credential hash over `["aiki-push-v1","credential",fullBearer]`, and string `envelope`
in the send body. Production encryption has no nonce override; injected fixed nonces are test-only.
The review follow-up above fixes the initial payload version-skew flaw. JS digest comparison is
constant-work for public lengths, not a JIT timing guarantee.

Integration must allocate/persist sequences and ciphertext retry outboxes, pin expected local route/
backend/session, acquire trusted monotonic-anchored backend time, and serialize admission per session.
`RelayAdmission.admit` calls synchronous atomic durable persistence before returning permission to display;
a throwing callback commits neither memory nor replay/event state. Reboot uncertainty fails closed.
Persist/restore per-key windows and cross-key event dedupe; later storage must retire old keys/windows
within 13 hours, never reset a live key's counter/window, and wrap/exclude keys and state from backup.
No storage, concurrency wrapper or clock-offset acquisition is implemented here.

Final checks: root 2,019 tests / 23,701 assertions / 169 files, zero failures (182.91s), including
82 new relay tests. JVM XML: 724 tests / 94 suites, 2 skipped, zero failures/errors (80 new relay tests);
assemble succeeds; lint has zero errors, 36 existing warnings. Combined: 2,743 tests, 2 skipped,
zero failures. Typecheck, Android protocol generation (330 DTOs / 88 overloads), relay vector drift
check and public/Gitleaks scans pass. Root `scripts/generate-protocol.ts` does not exist.
No new dependencies, devices/emulators, live servers, Firebase config inspection, main move, push or deploy.

## Web retained-session recovery (T91)

Reproduced on main in real headless Chromium, paired to a fresh required-mode createSetup backend: advancing only
its clock past access expiry/grace produced 4401/auth_expired, persistent Session expired and a stuck transcript.
Reload recovered the retained session. The fixed web app instead discovers/refreshes once per backoff attempt and
reconnects automatically, keeping the project and draft. Proactive renewal failures join that same backoff loop;
short successful hellos do not reset it. Only structured invalid/expired/revoked rejection at the retained exchange
clears credentials/proofs; bare status, discovery/Host rejection and transient failures preserve them. Web Locks read
the latest rotated credential and serialize rejection cleanup. A late refresh cannot reopen a stopped client.
Artifact downloads use signed URLs and uploads use socket RPC, not access-bearer fetches. A raw expired-access HTTP
probe returned 401 (browser fetch saw CORS failure); HTTP refresh/rejection classification is covered separately.

Tests first: 13 initial failures, plus late-renewal and discovery-notice regressions failed before their fixes.
All 20 new recovery tests pass. Rebased onto `sppsrlul` (deploy-test fixes, Zellij startup fix and relay design),
keeping all incoming documentation sections with T91 first. Root: 1,937 tests / 23,224 assertions, zero failures,
180.87 seconds. Web: 897 tests / 13,636 assertions, zero check diagnostics and production build passes. Root typecheck
and public/Gitleaks checks pass. The incoming stack resolves the earlier deploy-fixture failures. A deploy interrupted
the first root run; rerunning also exposed an old copied checkout under an ignored scratch HOME. It was moved outside
the workspace before the clean full run. Keep scratch HOMEs/checkouts outside the repo: Bun discovers ignored tests.
Existing T91 desktop/dark before/after screenshots and the eight-second recovery recording remain valid; no new proof.
Demo services were already stopped by PID; no live data, main move, push or deployment by this worker.

## Firebase-only push relay design (T63)

`docs/research/push-relay-design.md` records D38/D47/D49: Firebase-only relay, thin Google/email-link accounts and open
sign-up within limits, not an implementation. Only phones sign in; backends keep route capabilities, never account
credentials. Separate account UID/installation IDs, FCM possession challenge, per-session ECDH/HKDF/AES-GCM routes,
leases, durable delete-only revoke retries, staged three-backend rollout and per-backend web VAPID remain.
Recommended pilot: 3 phones/account, 8 routes/phone (24/account), 2,000 sends/account/day; global 5,000 sends/day,
100 challenges/day, 20 new relay accounts/day and 100 active accounts, plus IP limits. Direct Auth signup bypasses
relay caps: email-link mail is 5/day without billing, 25,000/day billed; Identity Platform adds MAU exposure above
50,000 free Tier-1 MAU. Do not enable it solely for the relay; neither Functions caps nor relay quotas cap Auth bills.
Both sign-in methods work from a configured sideloaded release APK. Required private facts now include OAuth consent/
clients, release SHA-1/SHA-256, Hosting App Links domain/sender and Identity Platform status/effective quotas. Privacy
text precedes sign-in; no copied profile, required in-app account deletion, durable cascades and disabled-account state
cover all phones. Remaining setup/limit/retention choices are in sections 11/13. Revised emulator-first scope: 22–33
engineering days plus external waits/observation. Public-source guard and Gitleaks pass; no runtime tests (docs only).
No Firebase credentials/config inspected, dependencies installed, services/emulators started, main moved or push/deploy.

## Reliable root tests (T83)

Five separate causes: activity deduplication was asserted on whole-project pushes that also carry attention/links;
now it is checked at the activity publisher, retaining socket working/idle/reply assertions. The nightly test advanced
its fake clock after a fixed sleep, before scope discovery could finish; it now awaits evaluation before advancing.
The cap fixture performs 100 durable transactions/digests; its justified loaded-machine budget is 30 seconds, not five.
Terminal startup has a product race, fixed in the following commit: list-sessions probes can panic Zellij 0.45.1 in
RemoveClient before session_data exists. That fix awaits the first screen-clear render without probing, handles split
escapes/small screens, and orders startup output after terminal.open. Its DESIGN update and render/order regressions
cover the backend change; the test-only commits here do not include it.
Finally, deploy fixtures fetched real Zellij archives into fake homes: a final-check run stalled on GitHub and hit
five test timeouts plus the 280-second command limit. All synthetic hosts now have private terminal stubs; any curl
attempt fails a test assertion. No deployment script behavior changed.

CPU-pinned stress: activity 2/30 failures before, 0/30 after; cap 31/32 heavily starved before, 0/32 after; scoped
terminal 3/12 in the primary heavy batch before, 0/36 after. Nightly did not fail in 42 natural stress runs; forcing
advance-before-discovery reproduced its timeout once. It passes 30 stress runs after synchronization. Passing
artifact revocation deliberately errors its HTTP response stream: Bun logs auth_revoked at artifacts.ts controller.error;
the reader catches it, and this is not an unhandled test rejection (isolated suite 5 pass, zero errors). No suppression.

Previous full-stack root checks (including the following terminal fix), three consecutive runs: each 1,913 pass / 23,162 assertions / 165 files, zero failures, in 210.44s,
194.54s and 190.22s. Typecheck and public guard pass. No retries/skips/assertions removed, UI changes, main movement,
push or deployment. Only the cap's measured bounded workload received a larger test timeout.

## Brave push-service guidance (T89)

Web Settings → Notifications now explains the exact push-service `AbortError`: in Brave, enable “Use Google services
for push messaging” under Settings → Privacy and security, restart, then retry. The raw browser message stays below
in smaller text; other errors are unchanged. The pure mapping in `notifications.ts` has four new unit tests.
Web: 882 tests pass, check has zero errors/warnings, build passes; root typecheck and public guard pass.
Four desktop light/dark before/after screenshots on T89 use headless Chromium, an isolated createSetup backend and
stubbed permission/subscribe calls. No dependencies, main move, push or deployment.

## Preserve Android sessions through access expiry (T90)

Android now backs off and refreshes its retained credential before reconnecting after access rejection, including 4401.
Only structured retained refresh/rotation rejection (401 auth_invalid/auth_expired or 403 auth_revoked), explicit session
revocation or user sign-out clears it. Discovery/Host errors, bare HTTP status and transient failures preserve it.
Short successful hellos no longer reset reconnect backoff. Unreadable storage surfaces a sanitized error and retries;
no synthetic signed-out record, automatic key replacement on invalidation or key creation while decrypting. Existing
ciphertext must be readable before an ordinary write. Review caught the permanent-key pairing trap: explicit new pairing
alone can now replace a confirmed permanently invalidated/unrecoverable key. A durable marker preserves every affected
ciphertext/auth pin before replacing the shared alias; only the explicitly paired origin is overwritten. Other backends
remain separately pairable after the key replacement, and interrupted resets remain explicitly retryable. Temporary
failures and ordinary corruption never permit reset. The new enrollment regression failed before this amendment. DESIGN was updated before implementation; findings now separate the fix from the
unknown incident trigger. Normal renewal is one minute before access expiry; clean app starts/restarts already refresh,
and deploy drain does not hold auth calls, so neither APK replacement nor deployment alone explains the incident.

Tests first: five of six initial recovery tests failed; all eight access-recovery tests pass. Four additional review
regressions cover permanent-key enrollment (both exception types), multiple backends, interrupted recovery, and refusing
reset for temporary/corrupt storage. Full Android: 644 tests, two existing skips, zero failures/errors; assembly and lint
pass (36 warnings, zero errors). First foreground check hit
the tool timeout during lint; the same command completed successfully in the background retry. Track-w synthetic
createSetup demo proves before/after with screenshots and short recordings on T90: old build loses its session after
forced access expiry; fixed build reconnects automatically. All demo paths were under a fresh temporary root and the
server was stopped by PID. No physical phone or live backend changed. Public/Gitleaks checks pass.

No server/protocol/web code change. Existing server codes suffice when interpreted in retained-endpoint context.
Root/web checks were not rerun for this Android-only fix. Automatic web recovery remains a coordinated shared-client
transport/browser-renewal follow-up; web retains its credential for reload. Already-deleted Android credentials cannot
be restored by an update: re-pair each backend from Settings → backend → Devices or explicit-target owner CLI, without
losing projects, conversations or drafts. No main movement, push or deployment.

## Android session-expiry investigation (T90)

Investigation only; no runtime or UI change. See `docs/research/android-session-expiry.md` for storage/signing,
installer-startup review, error mapping and recovery. Android maps every 4401 close to session expiry, then deletes
its retained credential without trying refresh; auth HTTP 401/403 also clear it (including forbidden Host). Short-lived
access expiry can therefore permanently lose a still-valid retained session. Two isolated JVM diagnostics reproduce
4401 and Host-403 deletion; kept as task artifacts, not permanent tests that would encode the bug as intended behavior.
Existing Android auth tests: 25 pass; server auth suites: 48 pass / 2,031 assertions. Typecheck and public/Gitleaks
checks pass. Full suites were not rerun for documentation-only changes. Exact incident trigger remains
unconfirmed without phone auth logs; no speculative fix. Live observations are only in private task evidence.
The auth store, encryption alias, signing setup and origin normalization did not change in the installer/task-row stack;
server platform is metadata, not a different token lifetime. Other Android clients share the destructive close path;
web stops on 4401 too but retains its credential for reload. Re-pair per backend from browser Settings → backend → Devices
(or explicit-target owner CLI); projects, conversations and drafts remain. No live mutations, main move, push or deploy.

## Compact task rows (T87)

Android and web at every width now use subtask progress as the disclosure; parent/plain content keeps identical
columns. Children retain only the 14dp/px guide. Gist, parent link, grouped relation/count menus and progress flow
inline. Minimum touch hit areas grow invisibly; full target tooltips, TalkBack/keyboard access, expansion persistence,
attention visibility and reduced motion remain. Shared waiting summaries avoid case-insensitive duplicate prefixes.
Both commits are rebased onto installer stack `twqrurtr`; every earlier continuation section is retained below.
Task-list source and the task-family DESIGN contract are unchanged from the accepted captures; no new media is needed.
Android: 632 tests, two existing skips, assembly/lint pass (36 warnings, zero errors). Web: 878 tests, zero check
diagnostics and build pass. Root: 1,912 tests / 23,125 assertions and typecheck pass; the rebased run passed first try
in 203 seconds with no flaky-test rerun. Public guard and Gitleaks pass.
T87 has 12 synthetic before/after captures, two playable folding recordings and blocker-menu proof. Android parent
104→82dp, blocker/found-while 116→82dp, normal 62→62dp; same phone/scroll shows 6→7 complete rows. Web phone parent
100→82px, no leading shift even in the narrow desktop sidebar. No protocol/backend changes, main move, push or deploy.

## Local installer and Welcome (T71)

Latest merge verification: the twelve-commit stack now follows the duplicate-report fix and required-mode rollout
docs. All sections are retained. Root: 1,911 tests / 23,121 assertions pass on the first run; typecheck passes.
Web check has zero errors/warnings and build passes; public guard/Gitleaks pass. No installer executable changes,
container rerun, new media, main movement or push. The earlier platform limitations below still apply.

The ten-commit installer stack is rebased on T82/task families/graph, including the later docs-only rollout note.
Private Bun 1.4.4/zellij 0.45.1, versioned releases and required local first-device sign-in remain. The CLI uses
T82’s `childEnvironment`/`loadServerEnv` and passes an explicit owned file/data/config snapshot to the shared
`runServerEntry`; it no longer sets backend values in `process.env`. Source and installed starts share T82’s live-owner
preflight. `aiki pair` addresses its recorded socket; `aiki auth ...` delegates owner commands with an explicit target,
including from child-marked shells without a port setting. Every CLI helper spawn uses the existing scrubber too.
Owned-file port resolution, private-only file settings, scrubbed helpers, child owner commands and live-owner refusal
are regression-tested. Effective data/config are printed before backend state opens.

Clean non-root Debian with env-i/temp paths passes install/rerun, child-marked owner commands, pairing, actual Chromium
Welcome/provider/project setup, update/rollback retaining sign-in, uninstall/reinstall and purge. All three original
server logs are retained. No visible flow change: existing T71 screenshots/recording still apply, no new media captured.
Root: 1,902 tests / 23,064 assertions pass; one initial existing migration-cap timeout passed in isolation and the
full retry, without changing that test. Web: 877 tests / 13,585 assertions; zero check errors/warnings, build passes.
Typecheck, generator --check (330 DTOs / 88 overloads, exit 0), shellcheck and public/Gitleaks pass. Real services,
macOS/WSL execution, remote HTTPS/phone setup and provider inference remain untested. No main move, push, tag or
live-service action. The T82 lifetime-lock caveat remains unchanged; single-binary packaging is still T72.

## One delivery per worker answer (T85)

Spawn and steer reporters can share a final answer. Their old per-call IDs wrote duplicate transcript copies and
board timeline events; the unchanged-text guard suppressed wakes, not those copies. This predates pi 1.5.1 (the
November 9 test expected two copies). Reports now use the worker conversation/final-entry ID, with admission,
board changes and reporter completion in one commit. Distinct unchanged answers remain passive. Old checkpoints
recover the answer and preserve already-decided delivery. Schedule workers share the fix; explicit thread finish
calls already deduplicate and now have review/record restart regressions.

Fake-model tests cover first/second reports, two and three submissions sharing one answer, busy coordinators with
user steers, restart before the coordinator handles a report, schedule review/record and replayed thread summaries.
Rebased onto main `509eb285` (settings isolation plus rollout docs), retaining all continuation sections. The user
confirmed every observed repeat followed interrupting sends and arrived at the next step, not as a fresh wake.
The two-interrupt cases now explicitly count one final answer, one transcript report and one timeline entry.
Root rerun: 1,887 tests / 23,005 assertions, zero failures; typecheck passes. The first root run hit the terminal
scope test's `scoped-ok` timeout and exceeded the command limit; the one full rerun passed. Web check: zero
errors/warnings; build passes. Public guard and Gitleaks pass. No live data/logs were read; no UI, dependencies,
main move, push or deployment.

## Device sign-in rollout status (T57/T69)

The operator's backends now run **required** device sign-in. All known clients (web browsers and the Android app on three
backends) were approved once by exact migration claim ID and connect with their own sessions. Each backend allows its
public origin through `auth hosts allow`; the reverse proxy's source address is in `AIKI_TRUSTED_PROXIES` in the private
server env files. Anonymous sockets get `auth_required` (4401) and unknown Hosts 403; deep deploy health checks pass in
required mode through the owner socket. New devices pair from Settings → backend → Devices. To back out on one backend:
`auth mode optional` (never delete auth state). From agent shells, call the owner CLI with an explicit `AIKI_ENV_FILE`
or `AIKI_DATA_DIR` (T82 isolation). The push relay for friends is T63; this work only binds existing push rows to sessions.

## Agent command environment isolation (T82)

Rebased onto task families/graph and board messages (`e9c693ff`), retaining T80/T81. The entry point captures settings
privately; env-file values never enter `process.env`.
Every spawn uses `childEnvironment`, removing backend `AIKI_*` settings. The sole marker `AIKI_CHILD_PROCESS=1`
suppresses automatic installation env-file discovery. Marker-only `auth` refuses even a live default data path;
explicit `AIKI_ENV_FILE` or `AIKI_DATA_DIR` permits deliberate owner access. Pair/list/revoke/mode/claim-list/approval
pass from normal/SSH shells and both explicit agent routes, including a real bash-tool regression. Owner CLI never
runs server-start ownership checks. Real isolated entry points prove env-file auth mode, backend/public origins,
trusted proxies and web-app URL reach server/CLI. DESIGN inventories every setting; a native-env guard prevents
new direct-read bypasses. Spawn inventory also flags new sites. PATH/HOME/XDG, provider/tooling, SSH, locale and
worker Android variables remain. Pi forces `inheritEnv: false`; Bun's implicit spawns may reuse native startup env,
so every spawn still needs the explicit helper.

Live-owner preflight retries every 100 ms for 3 seconds; missing/refused sockets proceed immediately. Shutdown holds
the socket through asynchronous writes. Immediate/stale restarts and a 150-ms overlap during shutdown flush pass.
Systemd already serializes replacement; the grace is below deploy's 20-second health budget. This is not a lifetime
lock: simultaneous first starts or an existing server without owner control remain follow-up. Always isolate source
experiments on temp data/config paths. Required deploy health/deep/drain and rollback guards pass unchanged (63 tests).
Latest checks: AIKI-unset root 1,878 tests / 22,948 assertions, first run; typecheck; web check zero errors/warnings
and build; public guard/Gitleaks pass. The earlier T80/T81 base also passed inherited root (1,837 / 12,246).
All servers used synthetic temp fixtures; no live data/config, main, push or deploy was touched.

## Bubble club graph (T79)

Bubble club is the only graph; alternate looks/flag are removed. Camera and List/Board/Graph choices are local per
backend/project under name-neutral keys. Captions avoid nodes/each other, hide at low zoom and expose full-title
tooltips. Aspect-aware initial layout pre-settles before SVG; updates retain tasks, animate worker travel and fade
completion. TasksPanel is untouched. The synthetic demo script has loopback controls for reports, moves, arrivals,
completion and 80-task load; it never uses installed data or real worker tools.

T79 has six normal/dense after screenshots, a 15-second live recording and browser/performance JSON. Live travel,
completion, stable arrivals, saved framing/view, phone pinch/tap, keyboard and reduced motion pass. 80 tasks/10
workers, three 240-frame Chromium runs: median 16.7ms, p95 16.7–16.8ms, mean 17.38–17.51ms; first graph paint
87–90ms. Occasional 133–150ms mount/closed/Fit intervals remain; no deeper profiling was pursued. Stacked above web
and Android family folding, preserving every continuation section and both DESIGN contracts. Web: 872 tests, zero
check errors/warnings and build pass; root: 1,857 tests and typecheck pass on the first run; public guard passes.
Isolated createSetup (default auth off) production-build smoke folds/unfolds a list family, opens the graph with
22 active tasks and six workers, and retains folding across view switches. No page errors or new media. No dependencies,
main move, push or deployment. Android still needs the native graph, gestures, accessible focus and motion contract.

## Android task families (T74)

Android now shares the web's same-status family and always-visible attention rules. Quiet families default folded;
explicit choices persist per backend/project/parent in local `DeviceSettings.taskFamilyExpansion`. Native controls
have expanded/collapsed TalkBack descriptions, static progress rings and 14dp guides. Attention sections start open;
cross-status children retain their own groups and parent links. No web, protocol or backend behavior changes.
Both changes are rebased onto main `tqplwulm`. Android: 631 tests (two existing skips), assembly and lint pass
(36 warnings, zero errors); generator check exits 0 (330 DTOs / 88 overloads). Root: 1,837 tests and typecheck pass;
web: 852 tests, zero check diagnostics and build pass. All continuation sections were retained, ours first.
The final plain root run and an `AIKI_*`-cleared run both pass. A prior nightly-maintenance timeout did not reproduce
in the six-test file on either this stack or plain main; no unrelated code was changed. Task-list source/behavior is
unchanged by the rebase, so existing T74 visual proof still applies. No new media, main move or push.

## Collapsible web task families (T74 / D44)

The task list now uses C only, without a dev flag. Quiet same-status children start folded; parent choices persist
per backend/project under `aiki.task-families.v1`. Cross-status or cross-section children stay in their own group
with a parent breadcrumb. Review, blocked, waiting, question and warning rows never fold away; same-status
attention descendants stay nested and visible. Attention sections start open. Counts include folded work. Native
Enter/Space buttons, nested lists and reduced-motion rules preserve keyboard/touch access. Android remains deferred;
it will need these visibility rules and scoped local expansion choices.
Rebased onto the renamed main as well. Web: 825 tests, zero check errors/warnings and build pass; root: 1,720 tests
and typecheck pass. Added-line public-source
scan passes. T74 has nine after screenshots plus a recording of keyboard expansion, reload persistence and live
attention escaping a collapsed family. No main move, push or deployment.

## Stable migration inventory (T81)

Migration claims now wait 14 idle days (30-day absolute cap), refreshing last-seen on proof-bound polls and registration.
Idle expiry revives the same ID/code. Approval lasts 14 days; sessions are minted only when collected, with 60-second
retry delivery and revoke-before-remint if unacknowledged. Pairing/bootstrap keep their strict existing rules. Inventory
includes all states/last-seen; `migration list --pending --json` filters pending. No wire fields or authVersion change.
Web/Android preserve proofs through expiry/network errors, retry quietly, and stop only on explicit denial. Android's old
ambiguous stopped message recovers once; the old web proof recovers on reload. Approved offline devices can collect even
following required-mode cutover. New tests cover lifetimes, offline approval/restart, remint, inventory and client recovery.
Checks: root 1,817 tests and typecheck; web 832 tests, zero check errors/warnings and build; generator check exit 0
(330 DTOs / 88 overloads); Android 612 JVM tests, two existing skips, zero failures/errors, debug assembly and lint
(36 warnings, zero errors). Public guard and Gitleaks pass. T81 holds synthetic web reload and emulator-u recovery
screenshots/recordings. No live backend, phone, main or remote changed.

## Required-mode deploy health checks (T80)

Required local health checks now run only hello/status/drain/list/page through the owner socket and normal RPC dispatch;
no deployment credential, device or session is created. Optional/off/older servers retain anonymous WebSocket checks;
remote warning-only checks accept valid required discovery. System checks run as the unit's User, using noninteractive
sudo only when accounts differ; same-account installations need no permission change. DESIGN documents private env/user
overrides and required-cutover prerequisites. Releases record auth support; read-only persisted-mode guards refuse
pre-auth rollback (including failed manual-rollback restoration), even with the backend stopped, and record the refusal.
Deploy a known-good metadata-bearing release while optional before cutover. Never use old tooling to bypass the guard.
Root: 1,808 tests, zero failures, typecheck; web: 829 tests, zero check errors/warnings, build. Generator check exits 0:
330 DTOs / 88 overloads. Public guard/Gitleaks pass. Protocol untouched; no Android rebuild, live data access or deploy.

## Full device sign-in rehearsal (T68)

The renamed merged stack passes root 1,784 tests and typecheck; web 824 tests, check (zero errors/warnings) and build;
Android 608 tests (zero failures/errors, two existing skips), assembly and lint (36 warnings, zero errors).
Generation exits 0: 324 DTOs / 87 overloads. Public guard and Gitleaks pass. The owner CLI also finds its running
backend when only the private server env file supplies the data directory; a subprocess regression locks this in.

Three data-bearing scratch backends defaulted optional; an empty directory defaulted required. Real pre-auth web/APK
updates retained addresses, names, notification IDs/settings and a synced draft. Both clients registered claims quietly;
six comparison codes matched the fixed CLI inventory. Exact batch approval authenticated them without reload and left
strangers unapproved. Fixed web push sync to upsert before reading the legacy row, which is not yet readable by the new
session. Regression fails before and passes after; web/FCM rows then bind on all three. Synthetic push transport/tokens
only, not live delivery. Eight-second artifact URLs reminted on all three web backends; native media remained visible.

Required cutover and disk/client restarts retained sign-in. Android created a link for a fresh browser; matching-code
approval succeeded. Web revocation signed Android out on that backend, removed its push row and detached its live native
terminal while the host job kept writing. T68 holds screenshots and short recordings. No real backend, phone, provider
or deploy was used. Rehearsal processes and emulator are stopped; main was not moved and nothing was pushed.

At rehearsal time optional deep deploy checks passed on all three; required checks failed with auth_required.
T80 above now performs equivalent private checks over owner control. Discovery alone remains insufficient. Old web shows generic reconnects, not auth-specific refusal;
Android's terminal retains generic connection-lost wording after revoke, while Backends/Devices correctly show signed out.

## Web device sign-in (T66)

Web now implements the Device sign-in contract: isolated IndexedDB retained credentials and proofs, exact-origin/auth
pinning, Web Locks staged rotation/crash recovery, live access renewal, `/pair` (v2 and bootstrap), app-wide comparison
approval, backend Devices/QR/rename/revoke, and quiet optional-mode migration notices/polling. Address exports stay
import-only. Push sync rebinds an existing subscription after authentication; artifact leases retain their existing
remint/video-position behavior and retry failed remints. DESIGN records web storage and rollout details. No server or
protocol changes were needed in this web change; it builds on the committed Aiki-prefix server contract.

Checks: root 1,750 tests and typecheck; web 819 tests (18 auth tests), zero check errors/warnings and build pass.
Android generation check exits 0 (324 DTOs / 87 overloads); public guard passes. T66 has synthetic desktop/phone,
light/dark before/after screenshots plus a two-context Chromium pairing/approval/authenticated-connect/revoke recording.
No live data or backends were used; nothing was pushed or deployed. Keep optional mode until known clients are approved
and have rebound push. Browsers without Web Locks refuse unsafe retained-token rotation; local bootstrap still expects
the web UI on the backend loopback origin (the server does not yet bundle it).

## Device sign-in security acceptance (T68)

Independent server tests add 18 HTTP/WS/owner-socket cases to the existing 46 auth cases. Fixed three reproduced bugs:
forwarding metadata containing only `X-Forwarded-Proto`/other forwarding headers could qualify for local bootstrap;
guessed retained IDs or anonymous exchanges could exhaust valid devices' refresh/rotation budgets; expired pairing
approval closed a healthy owner's socket. Invalid retained proofs now have a separate backend budget. No wire change.
The reusable `device-auth-migration.test.ts` rehearses three optional backends, two browsers, Android and a stranger:
fixed CLI inventory, exact/idempotent batch approval, delivery/ack, expiry, required cutover and disk restart.
Live tests cover streamed artifact abort, both push rows, queued-input cancellation and zellij detach with host-job survival.

Root: 1,750 tests and typecheck pass. Web: 801 tests, check (zero errors/warnings), build pass. Android generation check:
324 DTOs / 87 overloads, exit 0; no protocol changes here, so no Android rebuild. Public guard passes. Real web/Android
credential storage and downgrade refusal remain client-worker checks: servers provide stable backend ID, `/auth/status`
and explicit auth feature flags; clients must pin advertised support and reject later missing flags/404, never infer auth
from the legacy baseline list. Tests simulate missing flags, not a malicious replacement server or real proxy/TLS network.
Nothing deployed or pushed.

## Android device sign-in (T67)

Android now discovers/pins auth per origin, stores retained sessions and staged claim/rotation proofs in a separate
Keystore AES-GCM DataStore excluded from backup/transfer, authenticates hello, renews live sockets and stops on sign-out.
Settings has pairing-link paste, Devices, one-time QR/share grants, global matching-code approval and optional-mode
migration notices/polling. Claims survive process death; credentials precede ack. Rotation can recover a committed
successor beyond the old-token retry window. Existing image/video renewal is reused; downloads re-mint once on failure.
FCM registration already runs on every new ready connection, including authenticated reconnects. No relay is added.

Root: 1,732 tests and typecheck pass; web: 801 tests, check zero errors/warnings and build pass. Android XML: 608 tests,
zero failures/errors, two existing skips; debug assembly and lint pass (34 warnings, zero errors). Generator --check exits
0: 324 DTOs / 87 overloads. Verification: 7 tests / 49 assertions and its TypeScript check pass. Public guard passes.
T67 holds emulator-only before/after light/dark settings, Devices/QR, pairing/comparison, approval, waiting and revoked
screens plus pairing/approval recordings. Real scratch bootstrap/pair/approve/revoke and migration registration ran;
the same migration claim survived an in-place APK upgrade. No physical camera, live FCM or hardware-key invalidation
claim. Install the normal configured APK in place, keep backends optional, approve each phone claim through the owner
CLI, verify authenticated Devices and push re-registration before required cutover. Never uninstall to migrate.

## Stage-1 auth compatibility and Aiki wire prefixes (T65 follow-up)

Optional/off keeps the old artifact origin derivation (explicit public URL, otherwise forwarded proto/host or Host),
without requiring newly configured backend origins/proxies. Required mode stays strict; cutover closes authenticated
sockets carrying an unapproved legacy minting origin too. New handshake quotas, pending cap, hello size cap and timeout
apply only in required mode. Legacy WS Origin rejection and signed-artifact CORS match pre-auth behaviour. Legacy
notification RPCs remain usable even after another tab binds that notification ID; re-registration preserves its binding
so revocation still cleans it up. Auth management remains private. Eleven new compatibility tests cover this, including
unchanged deploy health-check hello, saved-open-project inventory and deep status/list/page checks in optional mode.
Required deployment checks still need an authenticated session (or equivalent owner-only private checks), not merely
`/auth/status`. New wire secrets now use `aiki_s1/aiki_a1/aiki_c1/aiki_p1/aiki_b1`; comparison fixture is `VE2X-TWTS`.
Existing `AIKI_` environment names are unchanged. Checks: root 1,732 tests and typecheck; focused auth 46;
web 801 tests, zero check errors/warnings and build; Android 584 tests (two existing skips), assembly and lint
(zero errors, 35 warnings). Generator check (324 DTOs / 87 overloads) and public guard pass. See DESIGN for the
updated contract. No deployment was run.

## Device sign-in server/protocol (T65)

Server device authentication now has durable owner sessions, protected hello/renew, bootstrap/pairing claims, refresh/
rotation, migration batch approval, revocation, session-bound ten-minute artifact URLs and session-bound push rows.
New directories start required; pre-existing data defaults optional; tests explicitly use off unless testing auth.
Owner commands run through `bun packages/server/src/main.ts auth ...` and the owner-only `<data>/auth.sock`, not network
management endpoints. Configure/allow backend origins before required cutover; optional keeps legacy routing.
The full client contract, link encoding and comparison fixture are at the top of DESIGN. Auth support is explicit:
`LEGACY_HARNESS_FEATURES` excludes the three new auth flags, including generated Android defaults. Protocol generation:
324 DTOs / 87 overloads. Added 35 server auth tests. Root suite: 1,721 tests; web: 801 tests, zero check errors/warnings
and build; Android: 584 tests (two existing skips), assembly and lint (zero errors, 35 warnings). Typecheck, generation
and public-source guard pass. No UI, relay, deployment or cross-backend migration bundle was built; do not switch existing
backends to required until updated clients have claimed, been approved, acknowledged and rebound push.


## Usage analysis and subscription resets (T78)

Phase-one web prototype adds role/model/project/task usage over the 90-day log. `usage-breakdown` adds optional
`cache.stats.usage` and local-calendar Today; internal compaction/extraction/maintenance usage begins accumulating
with this release. `subscription-resets` adds explicit confirmed one-shot Claude/Codex reset consumption, fresh
read-only grant discovery, request UUID deduplication and unknown-outcome handling; no real reset was triggered.
See DESIGN and `research/usage-analysis.md` for recording gaps, tab decisions and undocumented provider contracts.
Android DTOs are generated; its usage screen is intentionally unchanged pending web review. Log schema is 2;
legacy logs migrate additively and internal calls cannot be backfilled. Web has five keyboard-accessible tabs and
Today/7/30-day periods, model totals plus role splits, cost-ranked tasks and clearly qualified waste signals.
Checks: root 1,715 tests and typecheck; web 810 tests, zero check errors/warnings and build; generator check exit 0
(305 DTOs / 79 overloads); Android 584 tests (two existing skips), unit tests and debug assembly pass. Focused server
regressions pass (30 tests). T78 holds synthetic before/after captures in desktop light/dark and phone dark for all
tabs, reset confirmation/result, browser checks and an 11.6-second interaction recording. No real reset, push or deployment.


## Anthropic subscription user agent (T76)

Anthropic chat models override pi-ai 1.5.1's old user agent with `claude-cli/2.1.311`.
Catalog tests retain the no-fallback policy; fake API-key and OAuth HTTP tests verify the wire header,
cache-warm fingerprint and continuation. No real provider requests. Root: 1,700 tests and typecheck pass;
web check has zero errors/warnings and build passes. Public guard and Gitleaks pass. No deployment or push.

## Aiki identity and existing installations (T70)

Rebased onto the pi 1.5.1 integration upgrade; all checks below were rerun on that base. Its upstream storage-format
and downgrade caveats still apply (see the upgrade notes below).
Public packages/settings/storage now use Aiki identifiers. The mechanical rename is a separate commit; its replay
script stays in private local configuration. The server loads an optional XDG `aiki/server.env` before registering
durable kinds; `--print-config` is read-only. Per-target private env sources preserve existing data/config paths,
bindings, origins, document/task namespaces and project context identities. Deploy roots/services, user unit source,
watcher state and identity remain locally configurable; no installed unit, live data, bookmark or remote was changed.

Hosted browser builds opt into namespace migration through private `web.env`; localStorage, IndexedDB and push
registration caches retain originals. Native properties retain application ID, preference and notification intent
prefixes; an activity alias retains existing explicit intents. DataStore and notification channels are unchanged.
Three running-target config simulations match; hosted output retains the exact three suggestions. Emulator update
retained preference bytes and old activity intents. T70 has synthetic browser/native screenshots and recordings.

Root: 1,698 tests pass normally and with deployment configuration; typecheck passes. Web: 805 tests, zero check
errors/warnings, build passes. Generator: 299 DTOs / 78 overloads, exit 0. Android local and public builds both pass
unit tests, assembly and lint: 584 tests, two existing skips, no failures/errors; public lint has 37 warnings.
Publication guard and Gitleaks pass; the copyright notice is the only protected-name match. Private configuration,
three baseline snapshots, a read-only simulation and an unapplied host-config patch are prepared in the stable
checkout's ignored local directory. No manual data move, reinstall or host rebuild is needed for this release.


## Pi 1.5.1 upgrade (T73)

All six direct pi dependency pins moved from 1.4.0 to npm's latest 1.5.x, 1.5.1; telemetry and schema
transitives match. Fable 5.2 now uses the native catalog; the empty extension mechanism retains synthetic
coverage. Native pricing, limits and thinking match the old row. Temperature stays omitted through managed
effort, without a local flag. Native Fable now enables Opus 5 fallback by default; the Anthropic provider
policy clears fallback lists to preserve the no-silent-switch decision. Top-level effort is now low,
with the chosen effort still sent per message. New native Anthropic threads are isolated from cache warming
by stripping `thread` and setting `disableContinuation`; fake HTTP verifies headers, betas, zero-output
stream override and continuation of the real reply afterward.

Compatibility edits use Chord's context/json subpaths and tagged watch calls/ends, the single-argument
report callback, tagged Session ends and SQLite `runCounted`. Compaction notices read the current
`compactionFailure.trigger`. SQLite migrations are unchanged (schema 2); a synthetic database actually
written by 1.4.0 reopened with 1.5.1 and preserved its transcript while migrating pi.live v1 to v3.
Upstream also migrates generation v1 to v2 and tool v1/v2 to v3; downgrading active upgraded tasks is not safe.
Codemode adds local-reference search/declaration fixes and preserves non-finite console numbers; TypeBox
tools remain accepted after the pi-schema transition. Root: 1,686 tests pass; web: 801 tests, zero check
errors/warnings and build pass. Protocol check: exit 0, 299 DTOs / 78 overloads, unchanged; Android build
tests were not needed. Public guard and Gitleaks pass. No real provider requests, deployment or push.

## Compact task header (T62)

Web and Android remove the task summary and its divider. Waiting note/since/return date and subtask done/total now wrap
in header metadata; section navigation keeps question/warning counts, stored open+handling feedback totals and
total/running worker counts. Older backends without feedback totals fall back to timeline counts. Existing blocked
callouts remain. No new backend reads. Android lazy sections start at zero: both nav taps and scroll-spy use that index.
DESIGN records the shared contract. Root: 1,686 tests and typecheck pass; web: 801 tests, zero check errors/warnings,
build passes. Android: 584 tests (two existing skips), assembly and lint pass (35 warnings, zero errors). Generation:
299 DTOs / 78 overloads, unchanged; public guard passes. T62 has synthetic before/after light/dark screenshots for
web desktop/phone and native phone, including review, waiting with subtasks/feedback, and blocked tasks, plus section-nav
recordings on both platforms. Nothing was deployed or pushed.

## Board Markdown (T60)

Web board prose uses `CardMarkdown`, a compact variant of the safe chat renderer, including warnings, decisions,
answered questions and expanded board-tool cards. `markdownText` in protocol parses plain option labels, pins,
Needs-you rows and notification bodies before truncation; options still submit their original source.
Long cards fold rendered content, never a Markdown substring. DESIGN describes the shared web/native contract.
Android uses `BoardMarkdown` over compact `RichMarkdown`, and a CommonMark-based `markdownText` for the same plain
surfaces. Chat defaults and code controls are unchanged. Web: 801 tests, zero check warnings/errors, build and root
typecheck pass; root: 1,685 tests pass. Android: 584 tests (two existing skips), assembly and lint pass (no errors);
protocol generation is unchanged (299 DTOs / 78 overloads). Synthetic UI proof is on T60. Throwaway server demos should keep a `ViewClient` watch open while seeding and capturing.

## Current state

Aiki is an early personal cross-device agent harness built on pi durable. Packages use `@aiki/*`; native sources use
`io.github.mitzacoder.aiki`. Bun only for TypeScript; see `DESIGN.md` and the root README for architecture and setup.
Original project code is MIT; bundled third-party licences still apply.

## Publication preparation

The owner chose a fresh public starting snapshot, with detailed history retained privately. The publication audit
found no confirmed credential leak. Do not push old private ancestors to a public remote. Do not create or push a
public repository, squash main, or move main without the coordinator's explicit follow-up instruction.

Machine-specific deploy targets, backend suggestions, backend unit, Android properties and guard terms live in ignored
`deploy/local/` in the stable deploying checkout. The deploy exports its stable backend-list path into the archived
web build; target loading retains the old in-tree transition fallback. No example configuration is auto-deployed.
Local state/service overrides preserve existing deployment behavior. No installed watcher unit was changed.

Never commit personal infrastructure, employer/work information, credentials or live session measurements/excerpts.
Use reserved example domains and synthetic fixtures. Run `bun scripts/check-public.ts` before public pushes and review
which refs would be sent. The guard reads private literal terms from local configuration; do not copy them here.

## Checks

Required: root `bun test`, `bun run typecheck`; web `bun run check`, `bun run build`, `bun test`; protocol generator
`--check`; Android wrapper unit tests and debug assembly. Current cleanup passes: root 1,676 tests; web 793 tests,
check (zero errors/warnings) and build; root typecheck; generator (299 DTOs / 78 request overloads); Android 577 tests,
zero failures/errors and two existing skips, plus debug assembly. Local config simulation preserves the existing
remote targets, web suggestions and native build origins. Public snapshot guard and Gitleaks pass. Detailed evidence
is on the task. Do not run deploy scripts or restart the live backend from its tools.

## Architecture notes

Backends own durable project data and tools. Clients connect to multiple backends; feature negotiation supports
version drift. Needs-you summaries are built before sockets open. Cache warming is a guarded provider operation,
not a conversation turn. Passive duplicate worker reports must not wake the coordinator. Device authentication and
portable packaging remain separate work; source publication does not make a backend safe for public exposure.
