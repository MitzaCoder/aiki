#!/usr/bin/env bash
# Run after sign-release.sh, at the exact approved source commit. No signing material enters this bundle.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd -P)
version=${1:?Usage: bundle-release-notices.sh VERSION SIGNING_OUTPUT SOURCE_COMMIT}
out=$(cd "${2:?Signing output required}" && pwd -P)
commit=$(git -C "$root" rev-parse --verify "${3:?Exact source commit required}^{commit}")
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-pilot\.[1-9][0-9]*)?$ ]] || { echo 'Invalid release version' >&2; exit 2; }
[[ -s $out/android-notices/generated/third_party_license_metadata ]] || { echo 'Build release notices first with sign-release.sh' >&2; exit 1; }
work=$(mktemp -d "${TMPDIR:-/tmp}/aiki-notices.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
printf 'Temporary notices staging: %s\nSource commit: %s\n' "$work" "$commit"
stage="$work/android-notices-and-source"
mkdir -p "$stage/upstream"
cp -R "$out/android-notices/." "$stage/"
fetch() {
  local url=$1 name=$2 digest=$3
  curl --fail --location --retry 2 --max-time 120 --silent --show-error "$url" -o "$stage/upstream/$name"
  (cd "$stage/upstream" && printf '%s  %s\n' "$digest" "$name" | sha256sum -c -)
}
fetch https://github.com/Rosemoe/sora-editor/archive/87055c459e346cac6c619b3350f0bfba076228cc.tar.gz sora-editor-source.tar.gz 32b556cfd0585cbbe897a9e6cc84285af1b840b8ce90c6541941232690bb5c8d
fetch https://repo.maven.apache.org/maven2/io/github/rosemoe/editor/0.24.6/editor-0.24.6-sources.jar editor-0.24.6-sources.jar f448dad1e0f99806cd5895575863e800b20b0683f50a9362445af07e7f31aed4
fetch https://repo.maven.apache.org/maven2/io/github/rosemoe/language-textmate/0.24.6/language-textmate-0.24.6-sources.jar language-textmate-0.24.6-sources.jar c179e730f76d1756fe8f9762e06e298ffe6933ed168b3d56348b1545697d0b46
# Archive a commit snapshot, not working-copy/untracked files or private ancestors.
git -C "$root" archive --format=tar --prefix=aiki-source/ "$commit" | tar -xf - -C "$stage"
printf '%s\n' "$commit" > "$stage/AIKI-SOURCE-COMMIT.txt"
(cd "$stage/upstream" && sha256sum ./* > ../UPSTREAM-SHA256SUMS)
name="aiki-$version-android-notices-and-source.tar.gz"
[[ ! -e $out/$name ]] || { echo 'Notices archive exists; refusing to overwrite' >&2; exit 1; }
tar -czf "$out/$name" -C "$work" android-notices-and-source
(cd "$out" && sha256sum "$name" > "$name.sha256")
printf 'Notices/source asset: %s\n' "$out/$name"
