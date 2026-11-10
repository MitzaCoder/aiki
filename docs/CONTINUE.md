# Continue

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

The operator's backends run auth-capable releases in `optional` mode. All known clients (three backends; web browsers and
the Android app) registered stable migration claims, were approved once by exact claim ID, and now connect with their own
sessions. Backend origins are allowed through the owner CLI; trusted reverse-proxy addresses go into the private server
env files. Remaining: deploy that config, check `auth hosts list` shows no unknown host while every device stays
connected, then switch each backend with `auth mode required` (DESIGN "Cutting an existing installation over to required").
From agent shells, call the owner CLI with an explicit `AIKI_ENV_FILE` or `AIKI_DATA_DIR` (T82 isolation).

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
