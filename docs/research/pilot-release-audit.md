# First tagged pilot release audit

Audited 2026-11-11 for 2–5 invited colleagues/friends. **Readiness: conditional. Do not tag current main yet.**
No phone push is an accepted limitation, not a blocker. Recommend **`v0.1.0-pilot.1`**, a GitHub prerelease,
with a signed, neutral Android APK alongside the local web/backend installer.

Audited local `main` and GitHub `main`: **`5592be4fb960f6cdb7dd0e12be4261bf843cee6e`**.
The audit workspace initially had an identical tree. No code fixes, tags, pushes, publishing, deployment,
main movement, real Firebase access or physical-phone actions were performed.

## Release gates

1. **Current tag automation fails on a clean runner.** `.github/workflows/release.yml` runs
   `bun scripts/check-public.ts`, but the guard requires a nonempty ignored private denylist. Checkout supplies
   none, and the workflow creates none. Reproduced exit 1: “Private denylist missing”. Keep the guard; explicitly
   provision a protected CI secret/file without logging its contents, or design a reviewed public-CI mode that
   retains generic/scanner checks and a separate mandatory operator private-term scan. Do not commit protected terms
   or weaken the guard just to make CI green. The clean workflow has never run successfully.
2. **There is no installable production APK delivery yet.** Gradle builds an **unsigned** release APK; the workflow
   does not set up Android, test/build it, sign it or attach it. Choose the permanent signing identity and artifact
   owner, sign and verify the neutral release APK, and complete a fresh-install plus in-place-upgrade smoke before
   giving it to testers. For this small pilot, local owner signing and a reviewed manual attachment are sufficient;
   signing secrets need not enter GitHub CI. Automating that signing is not itself a pilot requirement.
3. **Finish Android redistribution review.** README explicitly leaves Sora LGPL review open. Both pinned Sora
   `editor` and `language-textmate` 0.24.6 POMs declare LGPL v2.1. The repository's Android license directory has
   font/Termux notices and relay dependency notes, but no Sora LGPL notice/source/relinking instructions. The APK
   includes some transitive AndroidX licenses, not a complete distribution notice bundle. Decide and provide the
   applicable notices, corresponding library source and required rebuild/relink materials before APK distribution;
   copying the root MIT license alone does not settle dependency obligations. Review transitive and Google SDK
   terms too. This is an unresolved distribution gate, not a legal conclusion that all app code must change license.

**Phone-use acceptance gate:** before inviting someone specifically to try Android, demonstrate their own backend's
reachable HTTPS address and matching-code pairing with the final signed APK. The installer deliberately binds
loopback; installing an APK does not make the computer reachable. A short assisted Tailscale/HTTPS setup is acceptable
for 2–5 people. No new tunnel service or Firebase relay is needed. This audit did not perform that network/device test.

## What exists and what CI proves

GitHub repository: `MitzaCoder/aiki`, public, default branch `main`. Read-only `gh` queries found **zero tags,
zero releases and zero Actions runs** (`actions/runs.total_count = 0`). There is no existing green CI evidence to
substitute for these gates. Prior local full-stack evidence is in `docs/CONTINUE.md`; it is not a signed-release or
cross-platform acceptance claim.

The only workflow is `Release`. Its push-tag glob is `v[0-9]*.[0-9]*.[0-9]*`, a GitHub glob, not a SemVer regex;
**`v0.1.0-pilot.1` matches**. The builder separately validates the version syntax. Branch pushes and pull requests
have no workflow here. It pins Bun 1.4.4, frozen-installs, runs root tests/typecheck, web check/build/tests, Android DTO
check and the public guard, then builds and publishes. A hyphenated tag sets `--prerelease`; otherwise it publishes
stable. The workflow creates the release immediately, not as a draft, and never creates the tag itself.

Current automatic assets, if the guard were supplied:

- `aiki-v0.1.0-pilot.1.tar.gz`: versioned backend source and neutral prebuilt web app, not a compiled executable.
- `aiki-v0.1.0-pilot.1.tar.gz.sha256`.
- `install.sh` (no separate installer checksum today).

No APK, AAB, desktop installer or per-platform backend executable is produced. The archive builder copies only
tracked allow-listed files into clean staging, excludes Android/deploy/local configuration and dependencies,
forces empty web backend suggestions/legacy prefix, and installs from `bun.lock`. Installation still downloads
platform dependencies: this is not an offline/self-contained distribution.

## Supported platforms versus tested platforms

| Component | Declared/packaged support | Evidence boundary |
| --- | --- | --- |
| Backend/local web | Linux x64/arm64, glibc or musl; macOS Intel/Apple Silicon; Windows through WSL only | Earlier clean non-root Debian lifecycle/browser rehearsal is recorded in CONTINUE. This audit reran targeted installer/auth/static-serving tests and built the neutral archive. macOS, WSL, musl and arm64 execution are not certified here. |
| Runtime | Private Bun **1.4.4**, six pinned SHA-256 archives; x64 baseline avoids AVX2 | Installer verifies download hash and exact runtime version, no Node fallback/global replacement. Other platform hashes were inspected, not downloaded/executed again. |
| Terminals | Private zellij **0.45.1**, four OS/architecture pins | Failed download leaves chat usable and explains the limitation. Git/jj and repository toolchains remain user prerequisites. |
| Android | **Android 12 / API 31+**, target/compile API 37; one universal APK contains `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` native libraries | Neutral release build and manifest/DEX seams pass here. ABI presence is not physical-device testing. No iOS or Play/store release is promised. |

Advertise the initially exercised Linux path as the assisted pilot baseline. Invite other host platforms only with
explicit experimental status and one clean-user install/update smoke on the tester's actual platform. Do not block a
Linux-only pilot on testing every declared target or on completing single-binary packaging.

## Neutral APK, no Firebase required

Built exact audited code using the Android wrapper with a scrubbed environment, an explicit empty private-properties
file, and explicit neutral Gradle overrides for every private production build field. This avoids the wrapper's
otherwise automatic `deploy/local/android.properties` lookup, caller environment and Gradle-property precedence.
A public build must use the same isolation; simply running the wrapper in the operator checkout is not sufficient.

Generated release configuration:

- Package `io.github.mitzacoder.aiki`; preferences `aiki`; matching notification intent prefix.
- `DEBUG=false`, `versionCode=1`, `versionName=0.1.0` (currently hardcoded, **not** derived from the tag).
- App origin/host `https://app.example.invalid` / `app.example.invalid`; relay email host `relay.example.invalid`.
- Empty published-backend URL, Firebase app/API/project/sender fields, relay endpoint, OAuth client ID,
  email-link domain and privacy contact. No operator backend suggestions or account configuration.
- `checkReleaseRelayAuth` and its dependent merged-manifest seam check pass; debug fake providers/receivers are absent.

The manifest removes automatic Firebase initialization, disables FCM auto-init and deactivates Analytics.
`FirebasePush.initialize` returns before Firebase initialization when its app ID is empty. Relay settings are absent
with an empty endpoint; off-default relay use does not open its account/storage/client. Backend pairing, projects,
providers and foreground interaction use the normal backend connection, not Firebase or a relay account.
Firebase/Google libraries remain bundled, but credentials, a Firebase project and a Google account are not required
for ordinary use. No real-service behavior was asserted or tested.

Inspection of generated config, APK manifest/ABIs and unpacked bytes found no operator configuration. A private-term
binary scan had substring matches in third-party public-suffix data: three also occur in the cached upstream Guava
public-suffix class, and one in the APK's public-suffix resource. These are dictionary collisions, not copied operator
endpoints; protected terms are intentionally not reproduced here. Source private-term/generic checks and Gitleaks pass.

Audit-only unsigned APK: **50,039,563 bytes**, SHA-256
`73274e1756759e5b56544e90f942991fb4180e337b58fe6a732dbdd5f4f9a304`.
`apksigner verify` fails as expected (missing signature). **Do not distribute this audit APK as an installable release.**
The final signed APK will have a different digest.

## Signing and upgrade continuity

Recommended: owner-held release keystore, strong interactive password, separate protected/offline backup of key,
alias and recovery details. Do not reuse a debug key, create a new key per build, commit keys or place passwords in
commands/logs. Record the public signing-certificate SHA-256 in release metadata. Align the unsigned APK with SDK
`zipalign` (including 16-KiB alignment), sign using SDK `apksigner`, then run `apksigner verify --verbose --print-certs`
and `zipalign -c -P 16 4`. Never modify the APK after signing. No key was created/accessed during this audit.

Keep package ID, signing certificate and existing storage prefixes stable for every upgrade. Increase `versionCode`
monotonically on each subsequent APK; add explicit version inputs or update the hardcoded values before that release.
The first pilot may retain code 1/name 0.1.0 if notes explicitly map it to `v0.1.0-pilot.1`; changing the display name to
match the tag is desirable, not a first-install blocker. Do not imply the current tag workflow sets Android versions.
Maintain a manifest mapping tag, commit, APK code/name, digest and certificate.

Test a second same-key, higher-code build over the first without uninstalling: backend list, drafts and retained
authentication must survive app/process restart and an access-token renewal. Never recommend uninstalling to repair a
signing mismatch: it destroys device-local state/Keystore authority and requires re-pairing. An existing operator/debug
installation can update only with its original package/key; this new public key is not automatically compatible with it.
Future Play distribution must plan signing-key continuity before enrollment. Later Firebase setup can associate the
same package/certificate; no Firebase decision is needed for this no-push pilot.

## Proposed artifact set

Keep the existing three assets, and add:

- **`aiki-v0.1.0-pilot.1-android-universal.apk`**, signed release, no private/Firebase/relay configuration.
- `aiki-v0.1.0-pilot.1-android-universal.apk.sha256`.
- `aiki-v0.1.0-pilot.1-android-notices-and-source.tar.gz`, containing the reviewed redistribution materials above,
  including exact dependency versions, applicable notices/source and rebuilding/relinking instructions.
- `SHA256SUMS` for installer/archive/APK/notice bundle, and `RELEASE-NOTES.md` with exact commit, Android
  code/name/certificate, prerequisites, no-push limitation, steps below and backup/update warnings.

No split APKs are needed for this size of pilot; no AAB is needed for sideloading. Checksums detect corruption,
not a compromised publisher. The Android signature provides app upgrade identity; keep its certificate fingerprint
available through a trusted invitation too. A repository-generated source zip alone is not a reviewed LGPL solution.

## Short tester instructions

1. Use your own computer, repository and provider account. A device gets full filesystem/shell/provider-spending
   authority on that backend, not read-only colleague access. Start with an API key if subscription eligibility/policy
   is uncertain. Install git/jj and the bootstrap utilities listed in `docs/INSTALL.md`.
2. Download and inspect `install.sh` from the **specific prerelease**, then run:
   `sh install.sh --version v0.1.0-pilot.1 --no-service`.
   Add the printed launcher directory to PATH if needed. Run `aiki start`, then `aiki open` in another terminal.
3. With it running, run `aiki pair` locally, open its one-time URL in that browser and confirm full access. Never send
   the URL/code in support reports. Connect your provider, choose a project folder/model and run one small task.
4. For Android, first arrange private HTTPS access to **your** backend (assisted Tailscale Serve is a reasonable
   option). Retain loopback binding and required device auth. Configure the exact public backend origin/Host allow-list,
   artifact origin and actual trusted reverse proxy as described in DESIGN; do not expose the raw port or disable auth.
   Verify reachability from the phone. A connect QR or APK supplies neither HTTPS nor a tunnel.
5. Verify/download the signed APK, allow installation from that download source and install it. In the paired browser's
   backend Devices page create a fresh pairing link. On Android use Settings → Backends → Paste pairing link, review
   the exact backend/full access and approve the matching comparison code in the already signed-in browser. Paste is
   the reliable generic-build path: the example App Link origin is inert and physical QR scanning is not certified.
   Do **not** use the computer-only `aiki pair` bootstrap URL on the phone. No relay sign-in or notification permission
   is needed for ordinary use. The computer must stay awake/reachable; background push is unavailable in this pilot.
6. For backend updates: stop, back up state/config and repositories, use `aiki update --version EXACT_PILOT_TAG`, restart
   and check `aiki status`. APK updates install over the existing app, never uninstall first. Backend code rollback does
   not reverse data migrations; Android downgrades are not a recovery strategy. Report only redacted symptoms/version.

**Prerelease trap:** README's `/releases/latest/download/install.sh` and bare `aiki update` select stable releases,
not this prerelease. With no stable release they cannot bootstrap it. Invitations must link the exact tag and show
`--version`; publishing a misleading stable release solely to make `/latest` work is not recommended.

## Authorized future release procedure (not executed)

1. Resolve the guard workflow failure, signing ownership and redistribution gates in separate reviewed work.
   Prefer a draft-release staging step so signing, attachments and review finish before public availability; today's
   workflow publishes immediately. An authorized manual release can substitute for APK automation, but must not race
   the existing auto-publish job. Decide one publisher before tagging.
2. Pin the final commit/tree. If code changes, run required root/web gates and relevant Android gates on that tree.
   Use existing exact-tree evidence where valid; do not repeatedly run the entire suite for docs-only edits. Perform
   the actual chosen host-platform and signed-APK install/upgrade smoke. No Firebase acceptance is needed while omitted.
3. In an isolated clean checkout, build neutral archive/APK with frozen inputs and Bun 1.4.4. Set `GITHUB_SHA` to the
   exact commit for a manual archive build (otherwise its RELEASE.json falls back to the version string). Set explicit
   empty Android production overrides as above, sign locally, verify config, manifest/DEX, signatures, notices and hashes.
   Run the private source guard/scanner and review the **exact tag/ref ancestry** to be sent; never push archived private
   history. Do not move `main` or use the host deployment scripts to make a release.
4. Only after explicit release authorization, create/push the one approved prerelease tag at that commit. Check the
   matching workflow run and all artifacts; stage the signed APK/notes/notices through the selected draft/manual path.
   Review downloaded artifact hashes and the signing certificate, then publish the prerelease when authorized. Never
   retarget/reuse a published tag to fix it; issue `pilot.2` and a higher Android versionCode.
5. Invite one tester first, then the remaining 1–4 after local setup and (where requested) phone pairing succeed.
   Make no automatic-update, push, macOS/WSL certification or sandbox/multi-tenant claims.

## Checks performed in this audit

- Read-only GitHub main/tags/releases/workflows/runs inspection; main matched the hash above, no releases/runs.
- Bun 1.4.4 frozen install: 255 packages; no tracked lockfile change.
- Installer, fresh required-mode local SPA/owner-socket pairing and static-serving tests: **12 pass / 72 assertions**.
- Service-definition/public-guard unit tests: **8 pass / 29 assertions**. Combined targeted: **20 pass / 101 assertions**.
- Root typecheck, Android generated protocol check (**337 DTOs / 91 overloads**) and installer shell syntax pass.
- Neutral source/web release build passes, **1,089 archive entries**, correct main metadata; no deploy, Android,
  node_modules, `.env` or `backends.json` archive entries. Audit archive SHA-256:
  `44d759eb17a5be46e79fdea1f101f12c3989eb631a8e27cfd53113fe9a8815b5` (timestamps make later builds differ).
- Neutral `:app:checkReleaseRelayAuth` passes, including release assemble, vital lint and merged-manifest seam.
  APK unsigned status/config/size/ABIs inspected. No install, signing or upgrade smoke was represented as done.
- Clean-checkout public guard fails as described; supplying the operator's external denylist makes the source
  private/generic guard and required Gitleaks scan pass. No protected values were copied into this report.
- Full root/web/JVM suites, full Android lint, emulator/UI, actual provider inference, remote networking and signed-device
  lifecycle were **not repeated**. Existing CONTINUE evidence was reviewed; there is no UI change requiring new media.
