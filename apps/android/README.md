# Harness for Android

Native Jetpack Compose client, package `com.mihaisaru.harness`, Android 12+
(API31). Streaming Markdown/tool transcripts, questions, image attachments,
main/background/worker navigation, signed artifact previews and SAF downloads,
Board/Memory/Workers/Schedules panels, provider/model settings and subscription
usage use the existing server protocol. Threads/artifacts remain feature-gated.

Jarvis and Neutral support system/light/dark. Jarvis uses restrained gradients,
static-by-default orbs, a glass-like composer and Lucide controls. This is **not
Haze blur**. Compact bundled syntax grammars/fonts are not every reference asset.
Push notifications go through Firebase Cloud Messaging (below); there is no voice implementation.

## Install and run

```sh
adb install -r ~/scratch/android-screens/harness-debug.apk
adb shell am start -n com.mihaisaru.harness/.MainActivity
```

On this host use the isolated emulator wrapper, never default adb:

```sh
apps/android/verification/device.sh start
apps/android/verification/device.sh install ~/scratch/android-screens/harness-debug.apk
# Only while the owned scratch real server is running:
apps/android/verification/device.sh adb reverse tcp:4790 tcp:4790
```

Parallel work gets its own device: `HARNESS_ANDROID_DEVICE=a` … `f` on every `device.sh` call selects
`emulator-5582` … `5592` with its own state under `~/scratch/android-cache/device-<x>`, backend port `4800` … `4850`
(reversed at start, `device.sh env` prints them) and captures under `~/scratch/android-screens/track-<x>`. All share
the read-only system image and the adb server on 5038. Unset is the original `emulator-5580` / 4790.

Round-two independent rendered review **passed**, including the final five exact
refinements; V1–V5 are closed. Runtime source is frozen at **64152b6**. The freshly
rebuilt, byte-verified replacement is `~/scratch/android-screens/harness-debug.apk`.
The previous APK is backed up as `harness-debug-before-round2-20261105T0704.apk`;
the previous `android-screens/FINAL` remains intact. Current candidate/archive:

- `~/scratch/android-screens/ROUND2/harness-android-r2-candidate.apk`
- **50,129,601 bytes**; SHA256
  `8eb003b6b9253a7cf74e099da8883a170c31fa9c46726740d35f405452bf7868`
- Debug APK, not a signed production release/store submission.

## Build and test

From the checkout root, using Bun only:

```sh
bun install --frozen-lockfile
bun apps/android/scripts/generate-protocol.ts --check
bun test apps/android/verification
bun run tsc --noEmit -p apps/android/verification/tsconfig.json
apps/android/scripts/build.sh :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --rerun-tasks
# To include BOTH live transport and fixture opt-ins, see verification/README.md.
```

Pinned: Nix/JDK21, SDK/build-tools37, AGP9.4.1 built-in Kotlin2.4.20,
Compose BOM2026.09.00. `scripts/build.sh` reuses realized host tools (or
`nix develop` elsewhere). Writable tools/caches/temp files stay in
`~/scratch/android-cache`. `build.sh` locks its own checkout (`.gradle/build.lock`); separate checkouts build at
once over the shared Gradle user home, which Gradle locks itself. No outer `flock` is needed.
Reuse the existing emulator image; monitor scratch free space (~14GB at this
checkpoint). Output: `app/build/outputs/apk/debug/app-debug.apk`.

Current gates (2026-11-07, with Track F notifications): **210 JVM tests / 43 suites**, 2 skipped (the live and fixture
opt-ins), 0 failures; assemble; lint **18 warnings / 0 errors**. Verification Bun: **7 tests / 49 assertions**.
Generation: **239 DTOs / 60 request overloads**. Root `bun test` and `bun run typecheck` pass. A full
`--rerun-tasks` gate takes 70–110 s on this host with warm caches. The round-two figures below are history.

## Push notifications (FCM) and project links

Firebase is optional at build time. The build reads the app's `google-services.json` from **outside the repo**, named
by the Gradle property `harness.googleServicesJson` or the environment variable `HARNESS_GOOGLE_SERVICES_JSON` (`~`
expands), and puts only its four public client values into `BuildConfig`; never copy the file into the checkout.
Without it the app builds and runs, and the Notifications screen says push is unavailable.

```sh
HARNESS_GOOGLE_SERVICES_JSON=~/scratch/android-sync/firebase/google-services.json \
  apps/android/scripts/build.sh :app:assembleDebug
```

Each backend needs the Firebase project's service-account key (Firebase console → Project settings → Service
accounts → Generate new private key) at `<data dir>/notifications/fcm-service-account.json` (or
`MIHAI_HARNESS_FCM_KEY_FILE`), mode 0600, then a restart; it logs `FCM on for Firebase project …` or `FCM off`.
Never commit or print it. The app's Notifications screen turns push on (asks for POST_NOTIFICATIONS on Android 13+),
registers the FCM token with every backend that has `fcm-push`, shows each backend's registration, last push and
"Send test", and keeps kinds, quiet hours and muted projects (the bell in a chat header mutes that project).

Web project links (`https://harness.example.test/b/<backend>/projects/<id>`, with `/threads/<t>`,
`/workers/<w>`, `/settings`, `?task=`, `#thread-<id>`, `#entry-<n>`) open in the app once the user lets it open that
domain (system settings → Harness → Open by default → Add link; on the emulator `adb shell pm
set-app-links-user-selection --user 0 --package com.mihaisaru.harness true harness.example.test`). The
`<backend>` is the web's ID, the slug of the name the backend was added with (`harness-pc`, `harness-vm` for the
published list); the app matches it by the slug of each backend's name, then by its host's first label, so a rename on
either side still opens. An unknown one closes any panel and opens the drawer with an "Unknown backend" note.

Debug builds accept what FCM would deliver from adb (it holds DUMP), for tests without Google:

```sh
D=apps/android/verification/device.sh
$D adb shell am broadcast -a com.mihaisaru.harness.DEBUG_PUSH -p com.mihaisaru.harness --es token fake-token  # turns push on
$D adb shell am broadcast -a com.mihaisaru.harness.DEBUG_PUSH -p com.mihaisaru.harness --es payload "'<NotificationPayload JSON>'"
```

## Verification: actual behavior versus appearance

See [verification/README.md](verification/README.md). Round-two evidence is staged
under `~/scratch/android-screens/ROUND2`. The curated delivery is
`ROUND2/FINAL/INDEX.md`: **48 byte-verified existing screenshots**, original
source/APK sidecars, native proof inventory and `delivery.json`. The full accepted
inventory contains288 inputs: eight protected images are screenshot-ineligible,
not passes. Reports: `WEB/PHASE2-FINAL-MATRIX-REVIEW.md` and
`WEB/PHASE2-FIVE-REFINEMENTS-REVIEW.md`. Exactly five PNGs were refined; other283
unchanged. Rejected pre-theme images remain historical, never acceptance.

- **Real imported server + deterministic faux model:** native composers initiate
  actual thread/board/worker/write/artifact tools. Persistence, streaming/Chord,
  signed HTTP, scoped input, four saving-owner combinations, same-name workers,
  handoff/revival, historical finish cutoffs and errors are real. No external
  model/provider credentials are used. Actual SAF destination bytes/hash and
  Media3 decoded-frame/seek/paused+playing renewal proofs are retained separately.
- **Additional actual visual checkout:** a long faux model name, genuine Working
  and Waiting threads, a running worker, task-linked question/pin, Thinking and
  consecutive write/read/bash calls supply stable rendered states. Board status
  groups and disabled schedules use real APIs; Memory uses the real MemoryStore
  because there is no public memory-write RPC.
- **Explicitly SYNTHETIC Usage backend:** populated account/rate-limit/chart
  appearance only. This does not verify OAuth, a real subscription or provider
  rate limits. Empty Usage on the actual scratch checkout is genuine.
- **Labeled contract fixture:** isolated schema/HTTP/transport/renderer checks;
  never substituted for real-server tool execution.

The eight-mode matrix is Jarvis/Neutral × light/dark × phone/tablet. Every new
matrix/onboarding capture has an original installed-source/APK-hash sidecar;
functional frames bind to source/hash in their associated proof JSON. Protected
provider dialogs are screenshot-ineligible: black captures are NOT visual passes.
Stable committed transcript,
loaded controls, empty-body completion and media READY+frame—not a header's
“Ready” label or an arbitrary delay—are the readiness criteria. Source review is
approved through64152b6; the independent eight-mode rendered gate is now passed
with its explicit secure/functional exclusions. Source64152b6 adds explicit48dp Copy actions to literal code/tool/file/output
sections, preserving full text including final newlines. Seven actual native tap→paste exact comparisons passed; see
`NATIVE/final-literal-required-copy.json` (write/read/command/stdout/code/error/diff).
Optional CodeMode probing is inconclusive and not an acceptance blocker. Historical Board worker IDs are deliberately non-navigable: mutable
current task ownership cannot establish historical worker provenance.

Hard-wrap functional disposition: current-source Board grouped drag, accessible
reorder, CAS conflict/rotation/draft retention/Save mine, first-backend8-mode forms,
native confirmed Stop/Q1 answer and seven required clipboard cases passed.
Artifact wrap and exact unsent Copy paste were reached, but its helper failed
while clearing/re-finding the draft before native delete. Current-source native
confirmed-delete/oldURL404/rotation/TTL is **not certified**; SAF and Media3 renewal
repeats were stopped/not completed. Retained earlier SAF27224eb and Media3 proofs
keep their original identities; do not call them new64152b6 repeats. All probe/
capture loops stopped by user hard wrap; no known new app defect was established.

Known boundaries: no physical camera/QR scan, external provider/account/OAuth,
real subscription usage, physical-device decoder or native push claim. Emulator
software codec preference is goldfish/ranchu-only; physical codec ordering is
unchanged. Combined network-drop + image-picker rotation is not device-proven;
ambiguous-admission/recreation safety has JVM coverage. Connect HTTPS links remain
unverified/user-choice (no autoVerify/assetlinks/deployment). No push or manual deployment; validated main promotion is the separate final
release step after green checks.

## Architecture and stable interfaces

Kotlin: `app/src/main/kotlin/com/mihaisaru/harness/`:

- `core/`, `data/`, `protocol/`: tolerant serialization, Chord, one WebSocket per
  backend, generated RPC/events, lifecycle watches and DataStore.
- `navigation/`: saved backend/project/thread/worker routes; full-screen phone
  panels and tablet side panels with movable composition retaining editors.
- `features/chat/`, `features/panels/`, `features/settings/`, `features/usage/`:
  scoped feature screens; main/background composers writable, workers read-only.
- `features/tasks/`: pure ports of the web's `lib/tasks.ts` and `lib/task-chat.ts` (tested against the same cases),
  `TaskLinks`/`LocalTaskLinks` and the task sheet shown for `Destination.Task`. `features/refs/`: the `RefLinks`
  seam and `RefChips`.

The generator turns unions told apart by a constant (`RefStatus`, `RefDetails`, `ScheduleSpec`, `AuthEvent`) into
sealed interfaces whose unknown variants decode as `Unknown<Name>` with their JSON; string-literal unions are
`String`. Build generated DTOs with named arguments. `data/FeatureRequests.kt` holds the requests that need a hello
feature (refs, cache stats, storage, task history, board notes, prompt cache and link settings) and refuses them with
`unsupported_feature` otherwise. `data/ProjectBoard.kt` is the one live board per project (`context.board`). Rendered
Markdown takes `LocalTextLinkers` to turn task mentions and refs into links.

Entry points remain `ChatScreen`, `ArtifactScreen`, `PanelsScreen`,
`SettingsScreen`, `UsageScreen` with `ProjectScreenContext`. Reuse the application
repository's BackendSession/client; do not create a socket per panel. Feature
checks come from negotiated hello. Collect before snapshots, cancel by lifecycle,
and protect pushes from stale reads. Provider refresh publishes to the shared
model catalog. ConversationWatch owns a subscription, not the socket.

Mutations are never blindly replayed. Ambiguous retry retains its admission ID,
not a transport correlation ID. Composer attachments live in a ViewModel with
saveable pending identity/drafts. Chord `t` removes a UTF16 **prefix**, not suffix.
Generated DTOs preserve unknown/open data; required nulls are encoded, optional
nulls omitted unless explicitly cleared. Android work does not change server,
protocol, TypeScript client or web sources.

Connect payloads are validated all-or-nothing and always previewed. Supported:
`harness://connect#v1.…` and canonical HTTPS `/connect#v1.…`. Camera hardware is
optional; ZXing4.3.0/CaptureActivity is packaged, not physically verified. Signed
media capabilities are short-lived in memory, never persisted/telemetried.
Atkinson Hyperlegible Next (the web's sans) and JetBrains Mono keep their bundled OFL licenses in `licenses/`.
