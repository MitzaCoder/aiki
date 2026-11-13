#!/bin/sh
# Kemiri's private runtime installer. Safe to pipe to sh; no prompts consume stdin.
set -eu
umask 077
BUN_VERSION=1.4.4
REPOSITORY=https://github.com/MitzaCoder/kemiri
# Keep populated legacy defaults in place, never create a second backend silently.
choose_default() {
 canonical=$1/kemiri; legacy=$1/aiki
 if [ -d "$canonical" ] && [ -d "$legacy" ] && [ "$(cd "$canonical" && pwd -P)" != "$(cd "$legacy" && pwd -P)" ] && [ -n "$(ls -A "$canonical")" ] && [ -n "$(ls -A "$legacy")" ]; then
  printf '%s\n' 'Both kemiri and aiki default directories contain data; choose an explicit --dir or KEMIRI_INSTALL_DIR/KEMIRI_CONFIG_DIR.' >&2; exit 1
 fi
 if [ -d "$legacy" ] && { [ ! -d "$canonical" ] || { [ -z "$(ls -A "$canonical")" ] && [ -n "$(ls -A "$legacy")" ]; }; }; then printf '%s\n' "$legacy"; else printf '%s\n' "$canonical"; fi
}
root=${KEMIRI_INSTALL_DIR-}
config=${KEMIRI_CONFIG_DIR-}
version=latest
channel=
ref=
archive=
runtime=auto
release_base=${KEMIRI_RELEASE_BASE_URL-$REPOSITORY/releases/download}
no_service=0
stage_only=0
uninstall=0
purge=0
custom_dir=0
say() { printf '%s\n' "kemiri: $*"; }
die() { say "$*" >&2; exit 1; }
need_value() { [ "$#" -ge 2 ] || die "$1 needs a value"; [ -n "$2" ] || die "$1 needs a value"; }
while [ "$#" -gt 0 ]; do
 case $1 in
 --version) need_value "$@"; version=$2; shift 2 ;;
 --channel) need_value "$@"; channel=$2; case $channel in pilot|stable) ;; *) die '--channel must be pilot or stable' ;; esac; shift 2 ;;
 --dir) need_value "$@"; root=$2; custom_dir=1; shift 2 ;;
 --ref) need_value "$@"; ref=$2; shift 2 ;;
 --archive) need_value "$@"; archive=$2; shift 2 ;;
 --runtime) need_value "$@"; runtime=$2; case $runtime in auto|bun|binary) ;; *) die '--runtime must be auto, bun or binary' ;; esac; shift 2 ;;
 --release-base-url) need_value "$@"; release_base=$2; case $release_base in https://*|http://127.0.0.1:*|http://localhost:*) ;; *) die 'Release base URL requires HTTPS (or loopback HTTP for local assets)' ;; esac; shift 2 ;;
 --no-service) no_service=1; shift ;;
 --stage-only) stage_only=1; no_service=1; shift ;;
 --uninstall) uninstall=1; shift ;;
 --purge) purge=1; shift ;;
 --help) printf '%s\n' 'Usage: install.sh [--version TAG] [--dir PATH] [--no-service]' '                  [--runtime auto|bun|binary] [--ref REF | --archive FILE]' '                  [--release-base-url URL] [--uninstall [--purge]]'; exit 0 ;;
 *) die "Unknown option: $1 (see --help)" ;;
 esac
done
if [ -z "$root" ]; then root=$(choose_default "${XDG_DATA_HOME:-$HOME/.local/share}"); fi
if [ "$custom_dir" = 1 ]; then config=$root/config; fi
if [ -z "$config" ]; then config=$(choose_default "${XDG_CONFIG_HOME:-$HOME/.config}"); fi
case $root in /*) ;; *) die '--dir must be an absolute path' ;; esac
case $root in /|"$HOME"|*/../*|*/..|*/./*|*/.) die 'Refusing an unsafe install directory' ;; esac
# Service formats and launcher paths must never contain control characters.
cr=$(printf '\r')
case $root in *"
"*|*"$cr"*) die 'Install paths must not contain line breaks' ;; esac
[ ! -L "$root" ] || die 'Install directory must not be a symlink'
if [ "$custom_dir" = 1 ]; then config=$root/config; fi
[ "$purge" = 0 ] || [ "$uninstall" = 1 ] || die '--purge requires --uninstall'
launcher=$HOME/.local/bin/kemiri
if [ "$uninstall" = 1 ]; then
 [ -f "$root/.aiki-managed" ] || die 'Not a Kemiri-managed install directory'
 if [ -x "$root/current/kemiri" ]; then exec "$root/current/kemiri" uninstall "$root" "$purge"; fi
 if [ -x "$root/current/aiki" ]; then exec "$root/current/aiki" uninstall "$root" "$purge"; fi
 exec "$root/runtime/bun-$BUN_VERSION/bin/bun" "$root/current/scripts/aiki.ts" uninstall "$root" "$purge"
fi
case $(uname -s) in Linux) os=linux ;; Darwin) os=darwin ;; *) die 'Supported systems: Linux and macOS. On Windows, run this inside WSL.' ;; esac
case $(uname -m) in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=aarch64 ;; *) die 'Supported architectures: x64 and arm64' ;; esac
# Baseline x64 works without AVX2. Linux musl is a separate Bun target.
libc=
if [ "$os" = linux ] && command -v ldd >/dev/null 2>&1; then
 if ldd --version 2>&1 | grep -qi musl; then libc=-musl; fi
fi
case $os-$arch$libc in
 linux-x64) target=linux-x64-baseline; checksum=e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76 ;;
 linux-aarch64) target=linux-aarch64; checksum=baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e ;;
 linux-x64-musl) target=linux-x64-musl-baseline; checksum=6e9c37098b293920aed28bfb51ab240e26d23bfdd9bbfecb3ad428ac166549bc ;;
 linux-aarch64-musl) target=linux-aarch64-musl; checksum=57f01b02ac7113c61c935f28f38c2eab849e3c970dab21f8b640a87b1ef65009 ;;
 darwin-x64) target=darwin-x64-baseline; checksum=d4a155adfbfd09155eb3ba05c9e3a544f39297d7a68616d3c7759f67ab5c47dc ;;
 darwin-aarch64) target=darwin-aarch64; checksum=c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510 ;;
 *) die 'No pinned runtime for this platform' ;;
esac
for command in curl tar; do command -v "$command" >/dev/null 2>&1 || die "Install $command and re-run this installer"; done
sha256() {
 if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
 elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
 else die 'Install sha256sum or shasum to verify downloads'; fi
}
fetch() { curl --connect-timeout 15 --max-time 300 --retry 2 -fsSL "$1" -o "$2"; }
for command in git jj tailscale; do
 if ! command -v "$command" >/dev/null 2>&1; then
  case $command in
   git) say 'Missing git: install it for repository operations (https://git-scm.com/downloads).' ;;
   jj) say 'Missing jj: isolated workers need it (https://jj-vcs.github.io/jj/latest/install-and-setup/).' ;;
   tailscale) say 'Missing Tailscale: needed later for phone access (https://tailscale.com/download). Local setup can continue.' ;;
  esac
 fi
done
if [ -e "$root" ] && [ ! -f "$root/.aiki-managed" ]; then
 # Refuse an existing backend data directory: never adopt the owner's installation.
 if [ ! -d "$root" ] || [ -n "$(ls -A "$root")" ]; then die 'Directory is not a Kemiri-managed installation; choose an empty --dir'; fi
fi
for candidate in "$launcher"; do
 if [ -e "$candidate" ] || [ -L "$candidate" ]; then
  if [ ! -f "$root/.aiki-install.json" ] || ! grep -Fq "# Aiki launcher: $root" "$candidate"; then die "Another launcher exists at $candidate; refusing to overwrite it"; fi
 fi
done
mkdir -p "$root"
mkdir "$root/.install-lock" 2>/dev/null || die 'Another install is running (or a stale .install-lock remains)'
printf '%s\n' aiki-installer-v1 > "$root/.aiki-managed"
work=$(mktemp -d "$root/.incoming.XXXXXX")
cleanup() { rm -rf "$work"; rmdir "$root/.install-lock"; }
trap cleanup EXIT HUP INT TERM
bun=$root/runtime/bun-$BUN_VERSION/bin/bun
ensure_bun() {
if [ ! -x "$bun" ]; then
 command -v unzip >/dev/null 2>&1 || die 'Install unzip to prepare the Bun fallback'
 say "Downloading private Bun $BUN_VERSION ($target)"
 fetch "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-$target.zip" "$work/bun.zip"
 [ "$(sha256 "$work/bun.zip")" = "$checksum" ] || die 'Bun checksum mismatch; nothing activated'
 unzip -q "$work/bun.zip" -d "$work/runtime"
 mkdir -p "$root/runtime/bun-$BUN_VERSION/bin"
 mv "$work/runtime/bun-$target/bun" "$bun"
 chmod 755 "$bun"
fi
[ "$("$bun" --version)" = "$BUN_VERSION" ] || die 'Private Bun could not run or has the wrong version; see docs/INSTALL.md'
}
if [ "$runtime" = binary ] && { [ -n "$ref" ] || [ -n "$archive" ]; }; then die '--runtime binary cannot be combined with --ref or --archive'; fi
if [ -n "$ref" ]; then
 [ -z "$archive" ] || die '--ref and --archive are mutually exclusive'
 command -v git >/dev/null 2>&1 || die '--ref requires git; use a release instead'
 case $ref in -*|*[!a-zA-Z0-9._/-]*) die 'Invalid git ref' ;; esac
 git init -q "$work/git"
 git -C "$work/git" fetch --depth 1 "$REPOSITORY.git" "$ref"
 version=ref-$(git -C "$work/git" rev-parse FETCH_HEAD)
 mkdir "$work/source"
 git -C "$work/git" archive FETCH_HEAD | tar -xf - -C "$work/source"
else
 if [ "$version" = latest ]; then
  [ "$channel" != pilot ] || die 'For a first pilot install use --version TAG; afterward kemiri update follows the saved channel'
  latest=$(curl --connect-timeout 15 --max-time 30 -fsSLI -o /dev/null -w '%{url_effective}' "$REPOSITORY/releases/latest")
  version=${latest##*/}
 fi
fi
case $version in ''|.|..|*[!a-zA-Z0-9._-]*) die 'Version must be a release tag (letters, numbers, dot, dash, underscore)' ;; esac
release_name=$version
release=$root/releases/$release_name
# Explicit runtime changes prepare another immutable directory, never mutate the selected executable.
if [ -f "$release/.ready" ]; then
 if [ "$runtime" = bun ] && [ -x "$release/kemiri" ]; then release_name=$version-bun; fi
 if [ "$runtime" = binary ] && [ ! -x "$release/kemiri" ]; then release_name=$version-binary; fi
 release=$root/releases/$release_name
fi
checksum_for() {
 awk -v name="$2" 'NF == 2 && $2 == name && length($1) == 64 && $1 !~ /[^0-9a-fA-F]/ { hash=tolower($1); count++ } END { if (count != 1) exit 1; print hash }' "$1" || die 'Missing or ambiguous binary checksum; nothing activated'
}
if [ ! -f "$release/.ready" ]; then
 prepared_binary=0
 binary_platform=
 case $os-$arch$libc in linux-x64) binary_platform=linux-x64 ;; linux-aarch64) binary_platform=linux-arm64 ;; darwin-aarch64) binary_platform=darwin-arm64 ;; esac
 if [ "$runtime" != bun ] && [ -z "$ref" ] && [ -z "$archive" ] && [ -n "$binary_platform" ]; then
  asset=kemiri-$version-$binary_platform
  binary_url=$release_base/$version/$asset
  say "Looking for standalone Kemiri $version ($binary_platform)"
  code=$(curl --connect-timeout 15 --max-time 300 --retry 2 -sSL -w '%{http_code}' "$binary_url" -o "$work/kemiri") || die 'Binary download failed; nothing activated'
  case $code in
  200)
   fetch "$binary_url.sha256" "$work/binary.sha256"
   fetch "$release_base/$version/SHA256SUMS" "$work/SHA256SUMS"
   expected=$(checksum_for "$work/binary.sha256" "$asset")
   manifest=$(checksum_for "$work/SHA256SUMS" "$asset")
   [ "$expected" = "$manifest" ] && [ "$(sha256 "$work/kemiri")" = "$expected" ] || die 'Kemiri binary checksum mismatch; nothing activated'
   chmod 755 "$work/kemiri"
   identity=$("$work/kemiri" --version) || die 'Standalone binary could not execute on this platform; nothing activated'
   [ "$(printf '%s\n' "$identity" | head -n 1)" = "Kemiri $version" ] || die 'Standalone binary version mismatch; nothing activated'
   mkdir "$work/source"
   mv "$work/kemiri" "$work/source/kemiri"
   prepared_binary=1 ;;
  404) say 'No matching binary asset; using the pinned Bun fallback' ;;
  *) die "Binary download returned HTTP $code; nothing activated" ;;
  esac
 fi
 if [ "$runtime" = binary ] && [ "$prepared_binary" = 0 ]; then die 'No standalone binary for this release/platform'; fi
 if [ "$prepared_binary" = 0 ]; then
 if [ -z "$ref" ]; then
  if [ -n "$archive" ]; then
   [ -f "$archive" ] || die 'Local archive not found'
   cp "$archive" "$work/aiki.tar.gz"
   [ -f "$archive.sha256" ] || die 'Local archive needs a sibling .sha256 file'
   cp "$archive.sha256" "$work/aiki.sha256"
  else
   url=$release_base/$version/kemiri-$version.tar.gz
   fetch "$url" "$work/aiki.tar.gz"
   fetch "$url.sha256" "$work/aiki.sha256"
  fi
  expected=$(awk 'NR==1 {print $1}' "$work/aiki.sha256")
  if [ "${#expected}" != 64 ] || [ "$(sha256 "$work/aiki.tar.gz")" != "$expected" ]; then die 'Kemiri archive checksum mismatch; nothing activated'; fi
  # Our release format is a single kemiri/ tree of regular files and directories.
  tar -tzf "$work/aiki.tar.gz" > "$work/files"
  awk '$0 !~ /^kemiri\// || $0 ~ /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}' "$work/files" || die 'Unsafe archive paths'
  tar -tvzf "$work/aiki.tar.gz" > "$work/types"
  awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" {bad=1} END {exit bad}' "$work/types" || die 'Links are not allowed in release archives'
  mkdir "$work/source"
  tar -xzf "$work/aiki.tar.gz" -C "$work/source" --strip-components=1
 fi
 if [ ! -f "$work/source/bun.lock" ] || [ ! -f "$work/source/scripts/aiki.ts" ]; then die 'Not a Kemiri release'; fi
 ensure_bun
 say "Preparing Kemiri $version with the frozen lockfile"
 (cd "$work/source" && "$bun" install --frozen-lockfile)
 if [ ! -f "$work/source/apps/web/build/200.html" ]; then
  (cd "$work/source/apps/web" && KEMIRI_PUBLISHED_BACKENDS_FILE="$work/no-backends.json" KEMIRI_LEGACY_STORAGE_PREFIX="" "$bun" run build)
 fi
 # A generic install never retains published backend suggestions.
 rm -f "$work/source/apps/web/build/backends.json"
 fi
 printf '%s\n' "$version" > "$work/source/.ready"
 mkdir -p "$root/releases"
 [ ! -e "$release" ] || die 'Incomplete release directory exists; remove it before retrying'
 mv "$work/source" "$release"
fi
# App terminals use a private, pinned zellij too; no system-wide install.
if [ ! -x "$root/tools/bin/zellij" ]; then
 case $os-$arch in
 linux-x64) ztarget=x86_64-unknown-linux-musl; zsha=d7bda1e18c30a688833ae7627f1d6a253bbba5349a4bc48e4f0ec008aaf75ed1 ;;
 linux-aarch64) ztarget=aarch64-unknown-linux-musl; zsha=7c0725cd433299eaf171d673df3b8e7ceceae1b06f8265ba552ff3b9c3c82ea0 ;;
 darwin-x64) ztarget=x86_64-apple-darwin; zsha=37a1b29f222722f9e7cca2bf506b6d9a816858b5ff80facdb03fd577a8cf08e3 ;;
 darwin-aarch64) ztarget=aarch64-apple-darwin; zsha=78eb322772b92f0fe94c2dbd70477575959f0de0da5913176d49ec70639f79e0 ;;
 esac
 if fetch "https://github.com/zellij-org/zellij/releases/download/v0.45.1/zellij-no-web-$ztarget.tar.gz" "$work/zellij.tar.gz"; then
  [ "$(sha256 "$work/zellij.tar.gz")" = "$zsha" ] || die 'zellij checksum mismatch'
  mkdir -p "$root/tools/bin"
  tar -xzf "$work/zellij.tar.gz" -C "$root/tools/bin" zellij
  chmod 755 "$root/tools/bin/zellij"
 else say 'Could not download zellij. App terminals are unavailable; re-run the installer to retry. Chat still works.'; fi
fi
if [ "$stage_only" = 1 ]; then
 say "Staged $version at $release; running release unchanged"
 exit 0
fi
# Prefer a binary lifecycle driver even when selecting a historical Bun release: its old CLI may write a Bun-only launcher.
driver=
for candidate in "$release/kemiri" "$root/current/kemiri" "$root/previous/kemiri" "$root/current/aiki" "$root/previous/aiki"; do
 if [ -x "$candidate" ]; then driver=$candidate; break; fi
done
if [ -n "$driver" ]; then
 "$driver" activate "$root" "$config" "$version" "$launcher" "$channel" "$release_name"
else
 ensure_bun
 "$bun" "$release/scripts/aiki.ts" activate "$root" "$config" "$version" "$launcher" "$channel" "$release_name"
fi
# Print the export literally for the user's shell.
# shellcheck disable=SC2016
case :$PATH: in *:"$HOME/.local/bin":*) ;; *) say 'Add ~/.local/bin to PATH: export PATH="$HOME/.local/bin:$PATH"' ;; esac
say "Ready. Run: $launcher start"
say "Then: $launcher open (or visit http://127.0.0.1:7317). Fresh installs require device sign-in. Run kemiri pair in another terminal and open its one-time URL here."
# Enrollment is issued only by the running server\'s owner socket, through kemiri pair.
if [ "$no_service" = 0 ]; then
 if ! "$launcher" service install; then say 'User service unavailable. Continue with kemiri start; inspect kemiri doctor.'; fi
fi
