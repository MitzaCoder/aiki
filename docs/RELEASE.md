# Pilot release procedure

Target: **v0.1.0-pilot.4**, the first Kemiri GitHub prerelease. This document grants
no permission to push, tag, publish or move `main`. The owner approves those steps
separately. Never move `main` as a release step or run deployment/service scripts.
Historical pilot.3 notes are in [releases/v0.1.0-pilot.3.md](releases/v0.1.0-pilot.3.md).

## Compatibility and signing

Pilot.3 users run their installed pilot.3 installer, not the new one. It fetches
`aiki-TAG-*` binaries and requires exactly `Aiki TAG` from raw `--version`.
The workflow builds those with `--legacy-version-probe`; merely renaming a Kemiri
binary fails. Canonical binaries print `Kemiri TAG`. Installed bridge launchers
use `--kemiri-version` and fall back for rollback. Both source archives have the
same `aiki/` layout. Preserve existing folders, services, credentials and pairings.
Both `aiki`/`kemiri` commands and `AIKI_*`/`KEMIRI_*` settings remain supported.

**Android is signed locally, not in CI.** Pilot.3 run 43288165466 had checks,
three native binary jobs and draft staging only. Owner-signed Android assets were
attached separately. The current workflow also does not build/sign/attach Android.
Do not upload the key/password to GitHub. Reuse the permanent owner-held PKCS12
identity and alias `aiki-pilot`; never generate a replacement for an update.
Its public certificate SHA-256 is
`a97bdfae948d34c2589afb4bc78acce22f079d51e6aaa2e4025f7d7d38e611e2`.
Securely back up the external key and password. Losing either prevents normal
same-package updates. Public package remains `io.github.mitzacoder.aiki`;
versionName is `0.1.0-pilot.4`, versionCode **1000004** (pilot.3: 1000003).
Gradle derives these from the tag/explicit release input, defaulting to pilot.4.

The owner must review Sora LGPL-2.1 source/relinking materials, the generated
third-party catalogue and Google SDK terms before distributing. Notices/source
includes the pinned upstream Sora source, module sources and matching Kemiri source.
Generated licence metadata is not legal certification. See
[../apps/android/licenses/RELINKING.md](../apps/android/licenses/RELINKING.md).
Preparation builds only unsigned/debug-signed APKs. No phone or real-provider test
is part of this procedure. Real-network HTTPS pairing remains an Android invitation
gate. Native macOS service behavior remains experimental and needs acceptance.

## Exact asset list: 25 workflow assets, 35 final assets

Set `TAG=v0.1.0-pilot.4`. The tag workflow stages these **25** assets in a draft:

- `kemiri-v0.1.0-pilot.4.tar.gz`
- `kemiri-v0.1.0-pilot.4.tar.gz.sha256`
- `aiki-v0.1.0-pilot.4.tar.gz`
- `aiki-v0.1.0-pilot.4.tar.gz.sha256`
- `kemiri-v0.1.0-pilot.4-linux-x64`
- `kemiri-v0.1.0-pilot.4-linux-x64.sha256`
- `kemiri-v0.1.0-pilot.4-linux-x64.licenses.txt`
- `kemiri-v0.1.0-pilot.4-linux-arm64`
- `kemiri-v0.1.0-pilot.4-linux-arm64.sha256`
- `kemiri-v0.1.0-pilot.4-linux-arm64.licenses.txt`
- `kemiri-v0.1.0-pilot.4-darwin-arm64`
- `kemiri-v0.1.0-pilot.4-darwin-arm64.sha256`
- `kemiri-v0.1.0-pilot.4-darwin-arm64.licenses.txt`
- `aiki-v0.1.0-pilot.4-linux-x64`
- `aiki-v0.1.0-pilot.4-linux-x64.sha256`
- `aiki-v0.1.0-pilot.4-linux-x64.licenses.txt`
- `aiki-v0.1.0-pilot.4-linux-arm64`
- `aiki-v0.1.0-pilot.4-linux-arm64.sha256`
- `aiki-v0.1.0-pilot.4-linux-arm64.licenses.txt`
- `aiki-v0.1.0-pilot.4-darwin-arm64`
- `aiki-v0.1.0-pilot.4-darwin-arm64.sha256`
- `aiki-v0.1.0-pilot.4-darwin-arm64.licenses.txt`
- `install.sh`
- `install.sh.sha256`
- `SHA256SUMS`

The owner adds these **10** assets and replaces only `SHA256SUMS`:

- `kemiri-v0.1.0-pilot.4-android-universal.apk`
- `kemiri-v0.1.0-pilot.4-android-universal.apk.sha256`
- `aiki-v0.1.0-pilot.4-android-universal.apk`
- `aiki-v0.1.0-pilot.4-android-universal.apk.sha256`
- `kemiri-v0.1.0-pilot.4-android-notices-and-source.tar.gz`
- `kemiri-v0.1.0-pilot.4-android-notices-and-source.tar.gz.sha256`
- `aiki-v0.1.0-pilot.4-android-notices-and-source.tar.gz`
- `aiki-v0.1.0-pilot.4-android-notices-and-source.tar.gz.sha256`
- `RELEASE-MANIFEST.json`
- `RELEASE-NOTES.md`

Android aliases must be byte-identical to canonical files, with separately named
checksum sidecars. Source aliases are byte-identical too; binary aliases are not
(the legacy version probe is intentionally different). Never distribute debug or
unsigned APKs, smoke executables, signing files, logs, Gradle caches or local config.

## 1. Freeze and check without publishing

Review the exact approved commit and public ref ancestry; never push private
archived history. Record the full approved commit as `COMMIT`. Use an isolated
checkout and Bun 1.4.4:

```sh
bun install --frozen-lockfile
# Scrub AIKI_*/KEMIRI_*; use disposable HOME/XDG/cache directories for root tests.
bun test
bun run typecheck
(cd apps/web && bun run check && bun test && bun run build)
bun apps/android/scripts/generate-protocol.ts --check
# Use an explicit empty external HARNESS_ANDROID_PROPERTIES, never operator config.
# Check pgrep -fa gradle before building; stop owned Gradle daemons afterwards.
apps/android/scripts/build.sh :app:checkReleaseVersion :app:testDebugUnitTest :app:assembleDebug
bun scripts/check-public.ts --denylist="$PRIVATE_DENYLIST" --require-scanner
bun scripts/check-public.ts --public-ci
```

Rehearse the real pilot.3 installed updater against local pilot.4 assets in an
empty environment/disposable HOME, with `USER` set, loopback-only distinct ports
and `--no-service`. Launch with `setsid`, stop only owned PIDs. Check both command
names, retained data/config/pairings, restart and rollback. This does not certify
native systemd/launchd behavior. The self-update acceptance recipe additionally
covers held tools, Cancel, force confirmation, checksum refusal, broken-candidate
health rollback and reconnect; never publish synthetic feed builds. Rollback
changes code, not data: all release storage changes must remain readable by the
retained release. Back up state/config while stopped and repositories separately.

After permission to push/run checks, run the non-publishing workflow on the approved
branch (as pilot.3):

```sh
timeout 30 gh workflow run release.yml --repo MitzaCoder/kemiri --ref APPROVED_BRANCH
```

Confirm the exact head SHA, successful checks and all three native binary jobs,
and skipped release job. `workflow_dispatch` cannot publish even on a tag.

## 2. Owner-only local signing

From the isolated exact-commit checkout, use JDK 21 and SDK/build-tools 37.0.0
(the Android Nix shell supplies them). Set only external-file paths in
`AIKI_RELEASE_KEYSTORE` and `AIKI_RELEASE_PASSWORD_FILE`; optional
`AIKI_RELEASE_KEY_ALIAS` defaults to `aiki-pilot`. These signing-script inputs still
use the legacy prefix (unlike runtime settings). Never print their contents.

```sh
TAG=v0.1.0-pilot.4
apps/android/scripts/sign-release.sh "$TAG" .preview/pilot-assets "$COMMIT"
apps/android/scripts/bundle-release-notices.sh "$TAG" .preview/pilot-assets "$COMMIT"
```

The signer refuses a differing Android tree, uses neutral empty properties and
`env -i`, checks manifest/DEX/notices/BuildConfig, aligns with `zipalign -P 16`,
signs with `apksigner` and writes `RELEASE-MANIFEST.json`. Compare its certificate
to the fingerprint above; verify package, versionName/code, commit and APK hash.
Inspect notices/source contents and the exact source marker. Emulator same-key
`install -r` acceptance must preserve saved settings; never uninstall to hide a
signature mismatch. Do not use the operator's phone.

## 3. After approval: tag, push one tag, inspect the draft

These are future owner/coordinator commands, not preparation commands. Do not
move `main`, retarget a published tag, or publish a partial failed run.

```sh
TAG=v0.1.0-pilot.4
# COMMIT is the full approved merged commit, not a mutable branch name.
git tag -a "$TAG" "$COMMIT" -m "Kemiri $TAG"
git push origin "refs/tags/$TAG"
timeout 30 gh run list --repo MitzaCoder/kemiri --workflow release.yml --commit "$COMMIT"
timeout 1800 gh run watch RUN_ID --repo MitzaCoder/kemiri --exit-status
timeout 30 gh release view "$TAG" --repo MitzaCoder/kemiri --json isDraft,isPrerelease,tagName,assets
```

The workflow checks root/web, Android DTO generation and public-source hygiene,
smoke-tests all three native executables, builds neutral source/web, and stages a
**draft prerelease** using the reviewed `docs/releases/$TAG.md`. Missing notes or
wrong headings fail closed. It does not publish or sign Android.

## 4. Attach, verify, then publish only with permission

Download the draft into a fresh directory. Copy only the eight signed Android /
notices files and manifest from the local output. Copy `docs/releases/$TAG.md` as
`RELEASE-NOTES.md` and append exact commit, versionName/code, certificate and APK
hash from the manifest. Verify `aiki/RELEASE.json` inside both source archives has
the approved tag/commit and no personal backend suggestions. Do not replace
workflow code assets with local rebuilds. In the combined directory:

```sh
timeout 120 gh release download "$TAG" --repo MitzaCoder/kemiri --dir STAGING_DIR
# cd STAGING_DIR, then add the reviewed manual files described above.
for sidecar in *.sha256; do sha256sum -c "$sidecar" || exit 1; done
cmp "kemiri-$TAG-android-universal.apk" "aiki-$TAG-android-universal.apk"
cmp "kemiri-$TAG-android-notices-and-source.tar.gz" "aiki-$TAG-android-notices-and-source.tar.gz"
sha256sum kemiri-"$TAG"* aiki-"$TAG"* install.sh RELEASE-MANIFEST.json RELEASE-NOTES.md \
  | grep -v '\.sha256$' > SHA256SUMS
# Includes both brands' binaries, notices, archives and Android payloads.
timeout 120 gh release upload "$TAG" --repo MitzaCoder/kemiri \
  "kemiri-$TAG-android-universal.apk" "kemiri-$TAG-android-universal.apk.sha256" \
  "aiki-$TAG-android-universal.apk" "aiki-$TAG-android-universal.apk.sha256" \
  "kemiri-$TAG-android-notices-and-source.tar.gz" \
  "kemiri-$TAG-android-notices-and-source.tar.gz.sha256" \
  "aiki-$TAG-android-notices-and-source.tar.gz" \
  "aiki-$TAG-android-notices-and-source.tar.gz.sha256" \
  RELEASE-MANIFEST.json RELEASE-NOTES.md
timeout 30 gh release upload "$TAG" --repo MitzaCoder/kemiri SHA256SUMS --clobber
timeout 30 gh release edit "$TAG" --repo MitzaCoder/kemiri --notes-file RELEASE-NOTES.md
timeout 120 gh release download "$TAG" --repo MitzaCoder/kemiri --dir FRESH_VERIFY_DIR
```

In the fresh verification directory run `sha256sum -c SHA256SUMS` and every sidecar,
SDK `apksigner verify --verbose --print-certs` and `zipalign -c -P 16 4` against the
APK. Compare `aapt2 dump badging` with the manifest and trusted certificate. Inspect
notices/upstream hashes/source marker and exact 35-file asset list. Confirm draft
and prerelease flags and no local secrets/config. Keep draft until publication OK:

```sh
timeout 30 gh release edit "$TAG" --repo MitzaCoder/kemiri --draft=false --prerelease
```

Verify public downloads/checksums without credentials and old repository redirects.
The prepared site bootstrap/links point at pilot.4; deploy them only after assets
are public and verified, or the default install will fail closed on missing assets.
Until the domain cutover, install commands use the live `aikilabs.dev`; switch to
`kemiri.dev` only after HTTPS/download checks pass. See [SITE.md](SITE.md).
Invite one tester first, then remaining friends; phone invitations need their own
HTTPS/pairing check. Preserve exact assets, source and the secure key backup. Any
post-publication fix needs a new tag and increasing Android code.
