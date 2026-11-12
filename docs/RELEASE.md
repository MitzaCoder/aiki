# Pilot release procedure

Target: **v0.1.0-pilot.3**, GitHub prerelease. This document grants no permission to
push, tag, publish or move `main`. Do those steps only after the owner's explicit go.
Releasing is independent of the deployment watcher; never move `main` as a release
step or run deployment/service commands. The earlier audit is in
[research/pilot-release-audit.md](research/pilot-release-audit.md).

## Signing ownership and remaining review

The pilot uses one permanent owner-held local PKCS12 key, outside the repository
and GitHub. Run `apps/android/scripts/create-release-key.sh` once on the signing
computer. It refuses to replace an existing identity, creates the config directory
with mode 0700 and key/password files with mode 0600, uses a cryptographically random
password, and never prints that password. The script prints the paths and public
certificate fingerprint. **Securely back up both files before distribution**; losing
the key or its password prevents normal same-package updates. Never attach those
files to a release or send them to CI. Keep the alias `aiki-pilot` with the backup.
Pilot.3 must reuse pilot.2's owner-held key; do not create a replacement identity.
Preparation builds only unsigned/debug-signed APKs. The owner signs the approved
source commit locally and attaches the result to the draft by hand.

The owner must review the final Sora LGPL-2.1 source/relinking materials, generated
third-party catalogue and Google SDK terms before distributing. The APK carries
Sora, font and Termux notices; the notices/source asset also carries the complete
pinned upstream Sora source, module sources and matching Aiki source. Generated
metadata can contain a licence URL instead of full text and is not legal
certification. See `apps/android/licenses/RELINKING.md`. This preparation does not
claim that all Aiki code must be relicensed or that every obligation is settled.

One assisted phone/backend HTTPS pairing test on the invited tester's network
remains an acceptance gate for Android invitations. Emulator installation and
local-state preservation do not certify real network reachability, retained-auth
renewal, camera scanning or background behavior. No physical-phone or real-provider
operation is part of release preparation. Linux is the tested host baseline;
macOS/WSL remain experimental.

## Exact published asset list

For `TAG=v0.1.0-pilot.3`, publish exactly these files (not the staging directories):

| Asset | Produced by |
| --- | --- |
| `aiki-v0.1.0-pilot.3.tar.gz` | Tag workflow: neutral backend/source and built web |
| `aiki-v0.1.0-pilot.3.tar.gz.sha256` | Tag workflow |
| `aiki-v0.1.0-pilot.3-{linux-x64,linux-arm64,darwin-arm64}` | Tag workflow: three native executables |
| Each executable's `.sha256` and `.licenses.txt` | Tag workflow |
| `install.sh` | Tag workflow, repository installer |
| `install.sh.sha256` | Tag workflow |
| `aiki-v0.1.0-pilot.3-android-universal.apk` | Local signing script |
| `aiki-v0.1.0-pilot.3-android-universal.apk.sha256` | Local signing script |
| `aiki-v0.1.0-pilot.3-android-notices-and-source.tar.gz` | Local notices bundler |
| `aiki-v0.1.0-pilot.3-android-notices-and-source.tar.gz.sha256` | Local notices bundler |
| `RELEASE-MANIFEST.json` | Local signing script: source commit, tag, package, versions, APK hash and certificate hash |
| `RELEASE-NOTES.md` | Copy the reviewed friend-facing notes, adding exact manifest details |
| `SHA256SUMS` | Owner, after downloading the exact workflow assets and adding local assets |

Do not distribute the unsigned APK, debug APK, upgrade-test pilot.4 APK, Gradle
cache, private properties, signing files or preparation logs. `*.signature.txt` is
local verification evidence, not a required published asset. Checksums detect
corruption, not a compromised publisher; send the certificate fingerprint by a
trusted invitation channel too.

## 1. Freeze and check the source, without publishing

Review the final merged commit and **exact ref ancestry** intended for public push;
never push private archived history. Record its full commit ID as `COMMIT`. Work in
an isolated checkout of that commit. Use Bun 1.4.4 only. Install with
`bun install --frozen-lockfile`, then run:

```sh
bun test
bun run typecheck
# In apps/web:
bun run check
bun test
bun run build
# Back at the repository root:
bun apps/android/scripts/generate-protocol.ts --check
```

For debug Android gates select an explicit empty external properties file using
`HARNESS_ANDROID_PROPERTIES`, never operator `deploy/local/android.properties`:

```sh
apps/android/scripts/build.sh :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

The local owner must supply the ignored private denylist, without logging its
contents, and run `bun scripts/check-public.ts --require-scanner` on that tree.
Also run `bun scripts/check-public.ts --public-ci` to reproduce clean-runner mode.
The latter skips **only** private terms and requires Gitleaks; it is not a replacement
for the owner's pre-push scan. Default/local mode still fails without a nonempty
private denylist. Do not put the denylist into the release checkout's tracked files.

Before tagging, run the same non-publishing GitHub checks on the approved branch:
`gh workflow run release.yml --repo MitzaCoder/aiki --ref APPROVED_BRANCH`.
Confirm its exact head SHA, successful checks job and skipped release job. Manual
runs cannot stage/publish even when the selected ref is a tag. For an unmerged
workflow change, the temporary `ci/release-check` branch push also triggers checks.
Delete that temporary branch after the run concludes. This does not replace the
local private-term scan or grant permission to move main or a release tag.

## 2. Build and sign locally

From the isolated exact-commit checkout, use the Android Nix shell (or set JDK 21
and Android SDK/build-tools 37.0.0). Set these external-file environment variables
in the local shell, never their contents in commands/logs:

- `AIKI_RELEASE_KEYSTORE`: path printed by the key-creation script.
- `AIKI_RELEASE_PASSWORD_FILE`: path printed by that script.
- `AIKI_RELEASE_KEY_ALIAS`: optional, default `aiki-pilot`.

```sh
TAG=v0.1.0-pilot.3
# Set COMMIT to the full approved commit; it is not a mutable branch name.
apps/android/scripts/sign-release.sh "$TAG" .preview/pilot-assets "$COMMIT"
apps/android/scripts/bundle-release-notices.sh "$TAG" .preview/pilot-assets "$COMMIT"
```

The signer refuses an Android tree that differs from the selected commit. It uses
`env -i`, an empty temporary properties file and explicit neutral overrides, builds
and checks the release's manifest/DEX/notice assets and neutral BuildConfig, aligns
with `zipalign -P 16`, signs with `apksigner`, verifies the signature, and prints the
certificate SHA-256 fingerprint. Review `RELEASE-MANIFEST.json` and compare the
certificate against the backed-up identity. Package must be `io.github.mitzacoder.aiki`.
VersionName must be `0.1.0-pilot.3`, code **1000003**; the Android README documents
the increasing numeric scheme and current-pilot default. Firebase/relay/backend suggestion
fields are empty; example App Link hosts are intentionally inert.

The notices bundler downloads three hash-pinned Sora source archives and snapshots
only the specified Aiki commit, not ignored/untracked files or ancestors. Inspect
its contents and source marker. Keep generated notice JSON/offset metadata together
with the licence bytes. No signing key is needed for library replacement/rebuilding.

Install the retained signed pilot.2 APK on an owned emulator, launch, and create
synthetic saved settings. Install the signed pilot.3 APK with `adb install -r`, then
confirm saved settings survive a cold process start and code is 1000003. A further
same-key pilot.4 upgrade rehearsal must use a separate smoke-only output directory. Try the unsigned release APK with
`adb install -r`: it must fail for missing certificates. Record results. Never
uninstall to work around a signature mismatch, never distribute the smoke-only
pilot.4, and never test on the operator's physical device. No server is needed for
this saved-settings test; HTTPS pairing/auth renewal is a separate acceptance gate.

## 3. After the owner's go: push the one tag and inspect its draft

Do not perform this section during preparation. In the reviewed checkout, after
the exact-ref private scan and owner approval:

```sh
git tag -a "$TAG" "$COMMIT" -m "Aiki $TAG"
git push origin "refs/tags/$TAG"
gh run list --repo MitzaCoder/aiki --workflow release.yml --commit "$COMMIT"
gh run watch RUN_ID --repo MitzaCoder/aiki --exit-status
gh release view "$TAG" --repo MitzaCoder/aiki --json isDraft,isPrerelease,tagName,assets
```

The workflow frozen-installs, runs root/web gates, checks Android DTO generation,
runs the explicit public CI guard, builds and smoke-tests each executable on its
native runner, builds neutral source/web assets and checksums, then creates a **draft**
release using `docs/releases/$TAG.md` as its GitHub notes (missing notes fail closed). It does not build/sign/attach Android.
A hyphenated tag makes a prerelease. If it fails, inspect the failed run; do not
manually publish a partial release or retarget a public tag. One publisher only.

## 4. Attach local assets, verify downloads, then publish with permission

Download the workflow assets into a fresh staging directory. Copy the locally
signed APK, its checksum, notices/source archive, its checksum and manifest there.
Copy `docs/releases/v0.1.0-pilot.3.md` as `RELEASE-NOTES.md`; append the exact commit,
versionCode/name, certificate fingerprint and APK digest from the manifest. Verify
the workflow archive's `aiki/RELEASE.json` records the same tag/commit and the web
has no personal backend suggestions. Do not substitute a locally rebuilt backend
archive for the workflow asset without reviewing its different checksum.

In that combined staging directory, verify every executable's checksum plus the
archive, APK, notices and installer sidecars. Preserve the workflow's executable
coverage when replacing its aggregate checksum file:

```sh
sha256sum "aiki-$TAG.tar.gz" "aiki-$TAG-linux-x64" "aiki-$TAG-linux-arm64" \
  "aiki-$TAG-darwin-arm64" "aiki-$TAG-"*.licenses.txt install.sh "aiki-$TAG-android-universal.apk" \
  "aiki-$TAG-android-notices-and-source.tar.gz" RELEASE-MANIFEST.json \
  RELEASE-NOTES.md > SHA256SUMS
```

Attach only the manual assets, not the key, logs or entire local output directory:

```sh
gh release upload "$TAG" --repo MitzaCoder/aiki \
  "aiki-$TAG-android-universal.apk" "aiki-$TAG-android-universal.apk.sha256" \
  "aiki-$TAG-android-notices-and-source.tar.gz" \
  "aiki-$TAG-android-notices-and-source.tar.gz.sha256" \
  RELEASE-MANIFEST.json RELEASE-NOTES.md
# Replace only the workflow's aggregate with the verified combined manifest.
gh release upload "$TAG" --repo MitzaCoder/aiki SHA256SUMS --clobber
gh release edit "$TAG" --repo MitzaCoder/aiki --notes-file RELEASE-NOTES.md
```

Use `gh release download "$TAG" --repo MitzaCoder/aiki --dir FRESH_VERIFY_DIR` to
verify the actual attachments. In that fresh directory run `sha256sum -c SHA256SUMS`,
every individual checksum file (including all three executables), SDK `apksigner verify --verbose --print-certs`
and `zipalign -c -P 16 4` against the downloaded APK. Compare package/version from
`aapt2 dump badging` to the manifest, and compare the certificate fingerprint to the
trusted local key. Unpack the notices asset and check its source marker, upstream
hashes and Aiki source tree. Confirm the draft has exactly the listed assets and
is marked prerelease. Confirm that no password/key/local config or private host
entered an attachment. Keep the draft until the owner approves publication:

```sh
gh release edit "$TAG" --repo MitzaCoder/aiki --draft=false --prerelease
```

Finally inspect the public release and download checksums again without privileged
credentials. Invite one tester first using the exact prerelease link, then the
remaining friends after setup succeeds. Check their own HTTPS/pairing path before
inviting phone use. Preserve the signed APK, its exact source materials, manifest,
checksums and secure signing-key backup. A fix after publication is a new pilot tag
and higher Android code, never a rewritten tag or an uninstall instruction.
