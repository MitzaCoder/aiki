#!/usr/bin/env bash
# Builds only a neutral APK. No signing passwords in command arguments, logs or GitHub.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/../../.." && pwd -P)
version=${1:?Usage: sign-release.sh vMAJOR.MINOR.PATCH[-pilot.N] OUTPUT_DIRECTORY SOURCE_COMMIT}
out=${2:?Output directory required}
commit=$(git -C "$root" rev-parse --verify "${3:?Exact source commit required}^{commit}")
git -C "$root" diff --quiet "$commit" -- apps/android || { echo 'Android source differs from the selected commit; commit/review it first' >&2; exit 1; }
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-pilot\.[1-9][0-9]*)?$ ]] || { echo 'Invalid release version' >&2; exit 2; }
key=$(realpath "${KEMIRI_RELEASE_KEYSTORE:?Set KEMIRI_RELEASE_KEYSTORE to the external keystore}")
password=$(realpath "${KEMIRI_RELEASE_PASSWORD_FILE:?Set KEMIRI_RELEASE_PASSWORD_FILE to its external password file}")
for file in "$key" "$password"; do
  [[ -f $file ]] || { echo 'Signing input missing' >&2; exit 1; }
  case "$file" in "$root/"*) echo 'Signing inputs must be outside the repository' >&2; exit 1 ;; esac
  [[ $(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file") == 600 ]] || { echo 'Signing inputs must have mode 0600' >&2; exit 1; }
done
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[[ -n $sdk ]] || { echo 'Set ANDROID_HOME (or run inside the Android Nix development shell)' >&2; exit 1; }
tools="$sdk/build-tools/37.0.0"
for tool in zipalign apksigner; do [[ -x $tools/$tool ]] || { echo "Missing Android tool: $tool" >&2; exit 1; }; done
mkdir -p "$out"
out=$(cd "$out" && pwd -P)
work=$(mktemp -d "${TMPDIR:-/tmp}/aiki-sign-release.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
printf 'Temporary build properties: %s\nRelease output: %s\nSource commit: %s\n' "$work" "$out" "$commit"
: > "$work/empty.properties"
# A fresh environment drops all operator AIKI/HARNESS/ORG_GRADLE_PROJECT and JVM overrides.
# Explicit -P values also beat any cached user-level Gradle properties. Never read deploy/local or local.properties.
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 TMPDIR="$work" \
  JAVA_HOME="${JAVA_HOME:-}" ANDROID_HOME="$sdk" \
  HARNESS_ANDROID_PROPERTIES="$work/empty.properties" \
  bash "$root/apps/android/scripts/build.sh" \
  "-Pkemiri.version=$version" \
  -Pharness.applicationId=io.github.mitzacoder.aiki -Pharness.preferencesPrefix=aiki \
  -Pharness.notificationIntentPrefix=io.github.mitzacoder.aiki \
  -Pharness.appOrigin=https://app.example.invalid -Pharness.publishedBackendsUrl= \
  -Pharness.googleServicesJson= -Pharness.pushRelayUrl= -Pharness.relayGoogleClientId= \
  -Pharness.relayEmailLinkDomain= -Pharness.relayPrivacyContact= \
  :app:checkReleaseVersion :app:checkReleaseRelayAuth :app:checkNeutralRelease
unsigned="$root/apps/android/app/build/outputs/apk/release/app-release-unsigned.apk"
name="kemiri-$version-android-universal.apk"
for brand in kemiri aiki; do
  for suffix in "" .sha256; do
    [[ ! -e $out/$brand-$version-android-universal.apk$suffix ]] || { echo 'Output APK exists; refusing to overwrite' >&2; exit 1; }
  done
done
"$tools/zipalign" -P 16 -f 4 "$unsigned" "$work/aligned.apk"
# env -i also prevents inherited JAVA_TOOL_OPTIONS from reaching apksigner.
env -i PATH="$PATH" JAVA_HOME="${JAVA_HOME:-}" HOME="$HOME" \
  "$tools/apksigner" sign --ks "$key" --ks-key-alias "${KEMIRI_RELEASE_KEY_ALIAS:-aiki-pilot}" \
  --ks-pass "file:$password" --out "$out/$name" "$work/aligned.apk"
env -i PATH="$PATH" JAVA_HOME="${JAVA_HOME:-}" HOME="$HOME" \
  "$tools/apksigner" verify --verbose --print-certs "$out/$name" | tee "$out/$name.signature.txt"
"$tools/zipalign" -c -P 16 4 "$out/$name"
bash "$root/apps/android/scripts/release-asset-checksum.sh" "$out/$name"
metadata="$root/apps/android/app/build/outputs/apk/release/output-metadata.json"
code=$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).elements[0].versionCode)' "$metadata")
fingerprint=$(sed -n 's/.*certificate SHA-256 digest: //p' "$out/$name.signature.txt")
digest=$(sha256sum "$out/$name" | cut -d ' ' -f1)
printf '{"tag":"%s","commit":"%s","package":"io.github.mitzacoder.aiki","versionName":"%s","versionCode":%s,"apkSHA256":"%s","certificateSHA256":"%s"}\n' \
  "$version" "$commit" "${version#v}" "$code" "$digest" "$fingerprint" > "$out/RELEASE-MANIFEST.json"
# The OSS plugin's release-generated catalogue is also shipped as a separate offline asset.
notices="$out/android-notices"
mkdir -p "$notices/generated"
cp -R "$root/apps/android/licenses/." "$notices/"
cp "$root/apps/android/app/build/generated/res/releaseOssLicensesTask/raw/third_party_licenses" "$notices/generated/"
cp "$root/apps/android/app/build/generated/res/releaseOssLicensesTask/raw/third_party_license_metadata" "$notices/generated/"
[[ $(wc -l < "$notices/generated/third_party_license_metadata") -gt 20 ]] || { echo 'Release dependency licence catalogue missing/placeholder' >&2; exit 1; }
cp "$root/apps/android/app/build/generated/third_party_licenses/release/dependencies.json" "$notices/generated/"
printf 'Signed APK: %s\nCertificate SHA-256 is printed above. Never modify the signed APK.\n' "$out/$name"
