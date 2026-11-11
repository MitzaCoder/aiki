#!/usr/bin/env bash
# Chrome for Testing's dedicated headless shell, not a distro Chromium/snap wrapper.
set -euo pipefail
version=157.0.8103.50
digest=7bf0d41e424efd1d6281c4162993ab9dc5de92fac213c211614905a71c057d0f
cache=${1:?Usage: setup-test-browser.sh CACHE_DIRECTORY OUTPUT_DIRECTORY}
output=${2:?Output directory required}
mkdir -p "$cache" "$output"
archive="$cache/chrome-headless-shell-$version-linux64.zip"
if [[ ! -f $archive ]]; then
  temporary=$(mktemp "$cache/download.XXXXXXXX")
  trap 'rm -f "$temporary"' EXIT
  curl --fail --location --connect-timeout 15 --max-time 180 --retry 2 \
    "https://storage.googleapis.com/chrome-for-testing-public/$version/linux64/chrome-headless-shell-linux64.zip" -o "$temporary"
  printf '%s  %s\n' "$digest" "$temporary" | sha256sum --check
  mv "$temporary" "$archive"
  trap - EXIT
fi
# Cache only the archive. Always verify and freshly extract, so cached executable edits cannot bypass the hash.
printf '%s  %s\n' "$digest" "$archive" | sha256sum --check
unzip -q -o "$archive" -d "$output"
binary="$(cd "$output" && pwd -P)/chrome-headless-shell-linux64/chrome-headless-shell"
"$binary" --version
if [[ -n ${GITHUB_ENV:-} ]]; then printf 'CHROMIUM_BIN=%s\n' "$binary" >> "$GITHUB_ENV"; fi
printf 'CHROMIUM_BIN=%s\n' "$binary"
