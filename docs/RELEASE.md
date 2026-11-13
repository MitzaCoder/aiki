# Release procedure

The bridge is **v0.1.0-pilot.4**. This procedure describes **v0.1.0-pilot.5**,
the canonical-only release. Owner approval is required for publication.
Never move main, retarget a published tag, or deploy as a release step.
Past release notes under `releases/` remain historical records.

## Upgrade path

**Pilot.3 and earlier must go through pilot.4.** Stop the old release, run
`aiki update --version v0.1.0-pilot.4`, then use `kemiri` for later updates.
Pilot.4's installed installer already fetches `kemiri-TAG-PLATFORM` executables,
checks their sidecar and SHA256SUMS entry, and requires `Kemiri TAG`. The next
release no longer builds legacy asset names or the legacy version probe.

Important source-fallback limit: pilot.4's embedded installer still validates an
`aiki/` source tree. The next archive uses `kemiri/`. Pilot.4's normal supported
binary update works. Intel Macs and Linux musl x64/ARM64 have no standalone
asset; they always use the fallback. For these platforms or `--runtime bun`, download,
review and run the **new release's installer** with the same `--dir`, rather than
using pilot.4's embedded installer. Never weaken archive-path or checksum checks.
The retained pilot.4 binary may drive source activation and leave its old `aiki`
launcher; rehearsal confirms it selects pilot.5 harmlessly. Use `kemiri` thereafter.

Canonical activation writes only `kemiri` launchers. It removes an old `aiki` launcher only
when it belongs to that installation, and updates its recorded service launcher.
Server startup rewrites its own server.env keys to KEMIRI_* atomically, keeps the
original in .bak and logs key names only. Process/build/signing settings must be
renamed before updating. Both prefixes stay scrubbed from child/MCP environments.
Existing config/data folders, .aiki project context, storage IDs, sockets and
service/state names stay in place. Never rename them as part of this release.

## Assets

Workflow: **14 files** — source archive plus checksum, three platform executables
(linux-x64, linux-arm64, darwin-arm64) each with checksum and dependency notices,
install.sh, install.sh.sha256 and SHA256SUMS. Every payload name starts `kemiri-`
except the installer and manifest. Source archive layout is `kemiri/`.

Owner attachments: **6 files** — `kemiri-TAG-android-universal.apk`, its checksum,
`kemiri-TAG-android-notices-and-source.tar.gz`, its checksum,
RELEASE-MANIFEST.json and RELEASE-NOTES.md. Total: **20 assets**. No `aiki-*`
aliases, smoke executables, logs, signing inputs, private config or caches.

## Check before publishing

Use the exact approved commit in an isolated checkout, Bun 1.4.4, JDK 21 and SDK
37.0.0. Inspect `pgrep -fa gradle` first; stop owned Gradle daemons afterwards.
Run each gate in order, with isolated HOME/XDG and both private prefixes unset:

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
(cd apps/web && bun run check && bun test && bun run build)
bun apps/android/scripts/generate-protocol.ts --check
apps/android/scripts/build.sh :app:checkReleaseVersion :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
bun scripts/check-public.ts --denylist="$PRIVATE_DENYLIST" --require-scanner
bun scripts/check-public.ts --public-ci
```

Use an explicit empty external HARNESS_ANDROID_PROPERTIES, never operator config.
Rehearse pilot.4's installed updater with only canonical binary assets, disposable
HOME/XDG, USER set, loopback ports and no service operations. Verify retained
config/data/pairings, restart and rollback. The source-fallback exception above
must be in the next release notes. Self-update acceptance also covers held tools,
Cancel, force confirmation, checksum refusal and broken-candidate rollback.
A code rollback never rolls back data; retained releases must read the new state.

## Signing and publication (owner approval required)

Android is signed locally, not in CI. Public package stays
`io.github.mitzacoder.aiki`; reuse the permanent owner-held PKCS12 key and
`aiki-pilot` alias. Certificate SHA-256:
`a97bdfae948d34c2589afb4bc78acce22f079d51e6aaa2e4025f7d7d38e611e2`.
Never generate a new key for an update. Keep external inputs in
KEMIRI_RELEASE_KEYSTORE and KEMIRI_RELEASE_PASSWORD_FILE; optional
KEMIRI_RELEASE_KEY_ALIAS defaults to `aiki-pilot`. Do not print their contents.

```sh
# TAG and COMMIT are the owner-approved next release identity.
apps/android/scripts/sign-release.sh "$TAG" .preview/release-assets "$COMMIT"
apps/android/scripts/bundle-release-notices.sh "$TAG" .preview/release-assets "$COMMIT"
```

The signer uses neutral properties, checks manifest/DEX/notices/BuildConfig,
aligns with zipalign -P 16, signs once and writes RELEASE-MANIFEST.json. Verify
certificate, application ID, increasing version code, commit and APK hash. Test
same-key emulator `install -r` without clearing data; never use the owner's phone.
Native macOS service acceptance and real-network Android pairing remain gates.

Only after approval, push the single reviewed annotated tag. The release workflow
checks root/web, protocol generation and public hygiene, smoke-tests all three
native executables and stages a draft using `docs/releases/TAG.md`. Missing notes
or a non-Kemiri heading fail closed. It does not sign Android or publish the draft.

Download the draft into a fresh directory, add only the six reviewed manual files,
verify `kemiri/RELEASE.json` inside the source archive, all sidecars and APK
signature/alignment. Rebuild SHA256SUMS from payloads, notices, installer and manual
metadata, excluding checksum files themselves. Upload manual files and replace
only SHA256SUMS. Download everything again and verify hashes, exact 20-file list,
installer bootstrap and native version probes before owner-approved publication.
Do not replace workflow binaries with local builds. Do not publish partial runs.
