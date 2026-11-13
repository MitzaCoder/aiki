# Android verification

Run from the checkout root with **Bun only**. All servers/state/tools are
scratch-only and loopback-only. No server/protocol/client/web source or lockfile
change is required. Installed-workspace dependencies are reused deliberately;
Android has no additional Bun workspace/package.

## Relay account proof (T97)

Use the standalone `relay/` demo launcher, never a real Firebase project, account, client config or FCM service.
Track x owns emulator and backend state for this proof. Set `HARNESS_ANDROID_DEVICE=x` on every wrapper/driver call.
Install with `install -r`. Keep synthetic client config outside the checkout and supply it through the private build
values listed in `apps/android/README.md`. Enable both debug fake controls and use `demo-aiki-relay` only. The fake
FCM source skips Messaging initialization and never enables FCM auto-init.

Assigned ports are Auth 19571, Firestore 19572, Functions 19573, hub 19574, logging 19575, websocket 19576 and fake FCM
19577. Start `bun run demo:stack --minutes 30` from `relay/` with all seven `RELAY_*_PORT` overrides, through `setsid -f`
and redirected logs/stdin. Use the readiness JSON's PID to stop it. The launcher scrubs the environment and seeds the
demo control document. `demo-seed.ts` explicitly exits after SDK cleanup because Bun can otherwise retain gRPC handles.

The proven Android configuration uses `adb reverse` for Auth 19571 and Functions 19573, with app URLs on
`127.0.0.1`. Direct host-alias HTTP worked in a shell, but Auth SDK operations failed in this emulator until reverse
was used. Do not substitute a real Firebase endpoint to diagnose that failure.

- `relay/deliver-captured.ts` polls the launcher's cursor-based capture endpoint and broadcasts `data.aiki` to the
  owned emulator's debug receive boundary. No tokens, nonces, ciphertext or links are printed. Start it only after
  stack readiness; its deadline is bounded by `RELAY_BRIDGE_SECONDS` (default 600). Restart it after a stack restart.
- `relay/open-email-link.ts` reads only the Auth emulator's OOB endpoint and opens a synthetic Hosting App Link on
  the owned emulator, without logging the one-time code or putting email in the URL. The domain and API key must
  match the synthetic build: `relay.example.test` and `demo-api-key-not-a-real-key`.
- `relay/fixtures.ts add-phone [synthetic@example.test]` enrolls another fake phone through the actual Auth and relay
  HTTP APIs and captured possession challenge. `google@example.test` uses the same unsigned demo Google identity
  as the debug provider. `pause`, `resume`, `phone-limit`, `rate-limit` and `restore-limits` change only the demo's
  control settings through `bun --no-env-file tools/operator.ts --emulator … --yes`, with the assigned port set.
  No fixture writes Firestore documents or chooses collection names. The operator tool scrubs its child environment;
  the demo stack seeds the required control document because a missing document now means paused.
- `launch-real.ts --fresh` accepts `ANDROID_VERIFY_AUTH_MODE=optional` and `ANDROID_VERIFY_RELAY_ENDPOINT` for one
  isolated real Kemiri backend. Its child receives only the explicit scratch environment and prints effective paths
  before startup. Pair/approve only that backend's device; use its owner socket/CLI, never live backend data.
- `DEBUG_RELAY` accepts either captured `aiki` or legacy plaintext `payload`, sharing the real FCM receive boundary.
  The existing `DEBUG_PUSH --es token demo-direct-token` can explicitly enable direct notifications while the relay
  switch remains off. All delivery receivers remain debug-only and DUMP-protected.

T97 evidence includes default-off before/after, privacy consent, email send/cooldown and cold/warm link return,
Google fake sign-in, encrypted backend test in the notification shade, another-phone removal, turn-off, sign-out,
fresh Google re-authentication and completed deletion, three scoped problem states, light/dark screens, and D51 first
run/backend/project/direct-receive interactions. Links in the paste field are masked and never saved in activity state.
The clock-lag regression uses a server-issued possession deadline, not a stricter comparison to an imperfect phone
wall clock. Existing strict identity, nonce, exact-receipt and expiry checks remain.

For D54's email-only consent proof, leave the Web client ID empty and set the debug fake Google switch false.
Keep the synthetic Firebase config, relay endpoint, email domain and fake FCM source configured. The turn-on screen
then offers only email and Not now, with no Google name/photo point. Merely opening consent needs no running relay
stack or Firebase Auth object. The fake Google switch counts as configured only when explicitly true.

This cannot prove real Google sign-in, real email delivery, verified App Links, FCM delivery, Play services behavior
or release-signed sideloading. The release APK seam/auth checks are static packaging gates, not real-service acceptance.

## Device sign-in verification

`ANDROID_VERIFY_AUTH_MODE=optional` on `launch-real.ts --fresh` selects a migration-capable scratch backend;
its default remains `off` for existing tool fixtures. Each track reverses its own backend port and the next port.
Use owner CLI grants/migration approval against that scratch data directory, never a real backend. After enrolling a device,
the owner CLI can switch it to required; initial fixture seeding deliberately uses an anonymous connection. Pairing proof uses
the real HTTP exchanges and app socket, not the synthetic fixture. Keep generated grant links, codes and claim/session
proofs in temporary files, never logs or committed fixtures. Install with `install -r`; never uninstall to change auth state.

## Backends are not interchangeable

| Backend | What it establishes |
|---|---|
| Imported checkout server + local faux model | Actual tools, storage, threads/workers/board/artifacts, streaming/Chord, signed HTTP and native initiation |
| `ANDROID CONTRACT FIXTURE` | Schema/transport/HTTP/renderer cases only; not genuine tools or service semantics |
| `SYNTHETIC Usage - no provider login` | Explicitly synthetic populated Usage/account/chart appearance only |

A faux **model** chooses deterministic tool calls; the actual imported server
executes them. This is not an external-provider/OAuth/account test.

## Current round-two checkpoint

Frozen app-source **64152b6**, final branch `feat/android-r2-final`:
**168 JVM tests /39 suites /0 skips/failures/errors**, assemble, lint
**18 warnings /0 errors**; verification Bun **7 tests /49 assertions**;
183DTOs/52overloads generation; root/verification TS and web check/build pass.
Root Bun930/5,274 including the two added UI-attribute helper tests; final consolidated
count belongs in the final evidence index. Complete source audit plus Board,
composer and theme narrow audits approve source, not rendered acceptance.

Candidate APK/installed source/hash/size: `ROUND2/installed-post-review-candidate.json`.
Fresh `ROUND2/NATIVE/*.capture.json` sidecars identify app source/hash, mode and
real-versus-synthetic data. `NATIVE-PRE-THEME` is rejected historical coverage.
Final rendered review and five refinements passed; see `ROUND2/FINAL/INDEX.md`.
Fresh final all-opt-in gates passed168 JVM/39 suites/0 skips/failures/errors,
assemble and lint18 warnings/0 errors. Root gates930 tests/5274 assertions,
typechecks/generation and web check/build passed. No root `check` script exists;
web `check` is the available check gate. Logs: `~/scratch/android-cache/r2-ship-*`;
Gradle `r2-real-jvm-Fa5SmQ/`. The rebuilt APK is byte-identical to the8eb... candidate.
Previous APK is backed up; previous FINAL retained. All capture/probe loops stopped.

Current-source artifact native delete/404/rotation/TTL certification did not
complete: wrap and exact unsent Copy paste were reached, then draft-clear helper
navigation failed. Current-source SAF/media repeats were not completed. Earlier
SAF27224eb and Media3 callbacks remain historical identified-source proof; optional
CodeMode clipboard is inconclusive. Do not infer execution from these helper
scripts. Unfinished helper edits were archived in scratch, not shipped as passes.

## Reproducible gates (no emulator)

```sh
bun install --frozen-lockfile
bun apps/android/scripts/generate-protocol.ts --check
bun test apps/android/verification
bun run tsc --noEmit -p apps/android/verification/tsconfig.json
bun run typecheck
(cd apps/web && bun run check && bun run build)
bun test

# Separate terminal: optional fixture must be alive for BOTH opt-ins.
PORT=4791 bun apps/android/verification/fixture.ts
PANELS_FIXTURE_ORIGIN=http://127.0.0.1:4791 \
  bun apps/android/verification/check-real-jvm.ts --all

# Actual tool/HTTP/window contracts, isolated ephemeral port, exits after proof:
PORT=0 bun apps/android/verification/launch-real.ts --contracts
```

`check-real-jvm.ts --all` starts/stops an isolated real server and invokes the
build wrapper with all JVM tests, lint and assemble rerun. The wrapper locks its
own checkout; other checkouts build in parallel:

```sh
apps/android/scripts/build.sh \
  :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --rerun-tasks
```

Without live/fixture flags the two explicit opt-ins skip; a normal offline pass
is not the all-opt-in result. Current nonfatal lint delta from15 baseline:
Modifier ordering in PanelSupport/WorkbenchComponents and optional Modifier's
missing default in ProviderSettings. No unrelated root notification-default or
web-switch failure remains in the imported base. Nonfatal web chunk-size warning
is not a failing build.

## Real imported server

```sh
PORT=4790 bun apps/android/verification/launch-real.ts --fresh
# Or --seed for populated actual-tool state, without501-save/destructive stress.
# Optional supported signer TTL for bounded checks; interactive default30s:
ARTIFACT_URL_TTL_MS=2000 PORT=0 bun apps/android/verification/launch-real.ts --smoke
# Normal unchanged production main, isolated directories, no injected model:
PORT=0 bun apps/android/verification/launch-real.ts --normal
```

This calls `packages/server/src/server.ts:startServer`, never a substitute
handler. `--fresh`, `--seed`, `--contracts` allocate unique
`~/scratch/android-verification-real-smoke-*` roots with isolated HOME, data,
credentials, TMPDIR/cache/config/source directories. Source PNG/MP4/binary files
are precopied, but **artifact records/bytes come from genuine artifact_save**;
text/worker files use the actual write tool. Only local faux credentials exist.
Symlink escapes are rejected. The launcher forwards no provider/account tokens.

Default interactive port is4789; the integrator reserves4790. Use **PORT=0** for
parallel contracts (4792 may already be owned—never kill an unknown process).
Without `--fresh`, the persistent real root is `android-verification-real`;
normal mode uses `android-verification-normal`. These servers are not sandboxes
for untrusted clients. Never add a production project or use systemctl/deploy.

The full contract probes genuine thread start/list/peek/send/finish/stop/archive,
claim/handoff/revival/release, same-name workers under different coordinators,
four saving-owner combinations, actual failed calls, escaped/bracketed notices,
and two historical finish cuts. HTTP proves GET/HEAD, single206 ranges,416,
wrong/tampered/expired403, renewed200, attachment bytes and delete404.
Real Cache-Control is **private,max-age3600**, unlike fixture **no-store**;
client signed-image caching is disabled. Never persist/log signed capabilities.

The501-save codemode probe establishes recent-list-window absence is **not**
deletion: an old artifact misses list500, remains in the filtered owner/thread
list and downloads byID. Pure navigation regressions separately cover the exact
**same owner**, old task-filtered metadata handoff before viewer routing.
Historical Board worker IDs render non-navigable ID chips; current task ownership
cannot identify their origin after handoff/release/worker-ID reuse.

## Native execution and retained scratch scenarios

Only the integrator owns **emulator5580 / adb5038**; parallel tracks set
`HARNESS_ANDROID_DEVICE=a`…`f` for their own device (`emulator-5582`…`5592`,
backend port `4800`…`4850`, state `device-<x>`). Always use `device.sh`:

```sh
apps/android/verification/device.sh start
apps/android/verification/device.sh install /absolute/path/to/candidate.apk
apps/android/verification/device.sh adb reverse tcp:4790 tcp:4790
apps/android/verification/device.sh phone  # also tablet / landscape
```

It reuses the installed API37 x86_64 image, KVM/SwiftShader, no snapshots or image
download. Writable state/caches live under `~/scratch/android-cache/device`.
Every native run below uses current labels/bounds and fresh hierarchy dumps;
media may prevent XML idle, so decoded-frame/callback evidence replaces stale
XML, never silently reuses it. Capture PNG happens before its slower XML attempt.

After adding a fresh4790 backend through native Settings:

```sh
HARNESS_ANDROID_DEVICE_CAPTURES=$HOME/scratch/android-screens/ROUND2/NATIVE \
  bun apps/android/verification/round2-native-tools.ts
```

This refuses populated revision-dependent state. Thirteen inputs use **native
composers**, with RPC reads/assertions only:

| Where | Input/effect |
|---|---|
| Main | `R2 start`: board T1, background contract-proof |
| Background automatic | claim, thread_send, write, four artifact_save |
| Background | `R2 scoped`: main entries unchanged |
| Background | `R2 worker`, `R2 handoff`, `R2 finish` |
| Main | `R2 return`: ownership back/revival |
| Background | `R2 late`, `R2 finish`: historical cuts5/6 |
| Main | `R2 main save`, `R2 main worker`: all four saving-owner cases |
| Main | `R2 bad message`, `R2 bad save`, `R2 failure`: actual errors |

Additional controls include R2message/inspect/stop/archive/flood. Do not repeat
start/handoff on retained populated state. Evidence is `native-real-tools.json`
and its explicitly earlier installed-build provenance. Retained original4790
project is `project-5981defd89`; never restart it casually during final QA.

An additional fresh **4795** actual visual checkout uses
`ANDROID_VERIFY_LONG_MODEL=1 PORT=4795 ...launch-real.ts --fresh`. Configure its
scratch project name `Native visual states (faux)` and write actual startup
projectID/path/origin to `ROUND2/visual-real-project.json`; register the backend
natively. `round2-visual-native.ts` then sends actual native controls for Working
and Waiting threads, worker, task-linked question, Thinking, consecutive coding
calls and four artifact saves. These are real service state, not fake responses.
Visual dataset runs and their exact project IDs are recorded in
`ROUND2/visual-dataset-runs.json`; current target is `visual-real-project.json`.
The prior run was ended with native confirmed Stop plus a native question answer,
asserted against actual server state. The fresh run’s isolated long-running
bash/worker tools must be stopped before delivery. Helpers with retained IDs
must be adapted from the actual startup manifest for a fresh replay; their
scratch guards must not be relaxed.

## Native final evidence helpers

All examples set `HARNESS_ANDROID_DEVICE_CAPTURES=$HOME/scratch/android-screens/ROUND2/NATIVE`:

- `round2-media-final-ui.ts` (earlier proof: `round2-media-ui.ts`): actual4790 Media3 READY+decoded frame, seek, paused and
  playing signed-source renewal with position/play state retained. Goldfish/ranchu
  software codec preference only; no physical-device decoder claim.
- `round2-saf-ui.ts`: real document picker rotation/recreation, stable artifact
  identity, save, **read actual destination bytes/stat/hash** matching256-byte
  source. Set destination filename after recreation: DocumentsUI resets its own
  in-progress filename; the app's save handoff survives.
- `round2-board-ui.ts`: same-status native drag, accessible Move up, actual CAS
  competitor, retained draft through rotation, explicit Save mine/latest revision.
- `round2-artifact-actions-ui.ts`: fresh native tool-created text artifact; rendered
  wrap-height change, Copy text then exact paste into an **unsent** composer,
  deletion cancel/confirm, actual list/HTTP404 and unavailable after rotation/TTL.
- `round2-seed-real-ui.ts`: guarded real Board groups, disabled schedules and
  genuine MemoryStore; `ANDROID_NATIVE_UI_ORIGIN=http://127.0.0.1:4795` targets the
  additional visual server. Does not replace the native-tool proof.
- `round2-captures.ts Jarvis Light phone`: stable full cell, also Neutral/Dark/tablet.
  `round2-matrix.ts` serializes exactly8 distinct cells, retains only matching-APK
  completed jobs, and stops at the first failure. Each image retains its ORIGINAL
  source/hash; do not relabel carried-forward unchanged panels.
  Includes empty Usage, loaded long-name controls, expanded Thinking/coding,
  question/pin, Working/Waiting/Stop, Memory detail/maintenance, worker/thread
  schedule editors including scrolled own-workspace/report/footer, and viewers.
- `round2-first-run.ts`: back up owned emulator preferences, clear only local app
  data, capture true first-backend forms in eight modes, restore connections
  byte-identically in finally. No remote/auth/provider change. Never run alongside
  another emulator script.

The matrix must be **eight** complete Jarvis/Neutral × light/dark × phone/tablet
cells. Stable committed visible transcript, loaded defaults, non-loading empty
body and fresh video READY+frame are required, not just headerReady/fixed sleeps.
A deliberately long faux model display name tests complete bounded controls.
Approved64152b6 adds explicit48dp Copy actions. `round2-code-copy-ui.ts` verifies
tap → paste into an empty UNSENT composer → exact committed arguments/results,
including final newline and Markdown-looking literal bytes. The seven required actual comparisons passed: `NATIVE/final-literal-required-copy.json`.
Optional CodeMode probing is separate/inconclusive; no app bug is certified.
The default clipboard script stops after the seven required cases; additional
CodeMode-script probes require an explicit optional flag. Replays need a FRESH
owned4796 server/project (`ANDROID_VERIFY_LONG_MODEL=1 PORT=4796 ...launch-real.ts
--fresh`, then `bun .../round2-visual-setup.ts literal`). The script registers that
backend natively and refuses a populated proof project, avoiding repeated-card
ambiguity. Never repeat successful cases on retained evidence merely for coverage.

`round2-index.ts` inventories34 named frames per cell, binds PNG bytes and original
APK provenance, and rejects stale affected chat on `--require-complete`.
`INDEX-STAGED.md` is not independent rendered signoff. Protected provider-dialog
black captures are intentionally screenshot-ineligible, **NOT visual passes**;
do not weaken SecureOn to obtain images. Matrix/onboarding frames carry per-image
sidecars; functional images bind to source/hash in their associated proof JSON.

Queued `round2-final-probes.ts` waits for all8 successful matrix children before
any device command, then serializes final native Stop/answer, first-backend forms,
Board, artifact actions and SAF. `round2-after-probes.ts` waits for those before
fresh Media3 renewal. Optional CodeMode-output appearance is separate/nonblocking.
These scripts being present is NOT proof that their native checks have passed.

## Explicitly synthetic and historical helpers

`PORT=4794 bun .../round2-usage-fixture.ts` supplies schema-validated synthetic
Usage/account/chart appearance, visibly labeled **SYNTHETIC / no provider login**.
It proves no real provider/account/OAuth/rate-limit behavior. Actual servers have
genuine empty subscription usage. The4791 fixture remains useful for adversarial
schemas/expiry/transport but cannot establish real tool behavior.

Earlier `device-navigation.ts`, `final-real-ui.ts`, `final-fixture-ui.ts` and
previous-round captures are historical/navigation probes, not current final
thread/artifact proof. Connect links are previewed and manifest-resolvable but
HTTPS remains unverified/user-choice; no autoVerify/assetlinks/deploy. No physical
QR/camera/OAuth/external provider/native push/physical decoder claim. Combined
network-drop + image-picker rotation remains device-unverified (pure JVM safety
coverage is separate). Final acceptance needs independent code **and rendered**
reviews; candidate screenshots are not signoff. Root/main is not advanced here.
