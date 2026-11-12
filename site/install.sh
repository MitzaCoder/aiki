#!/bin/sh
# Aiki's static-site bootstrap. Review before running; no curl | sh needed.
# Fetch only an exact GitHub release installer, verify it, then forward arguments.
set -eu
umask 077
version=v0.1.0-pilot.3
explicit_version=false
fail() { printf 'aiki bootstrap: %s\n' "$*" >&2; exit 1; }
select_version() {
 while [ "$#" -gt 0 ]; do
  case $1 in
   --version)
    [ "$#" -ge 2 ] || fail '--version needs a release tag'
    version=$2; explicit_version=true; shift 2 ;;
   --dir|--archive|--ref|--runtime|--release-base-url)
    [ "$#" -ge 2 ] || fail "$1 needs a value"
    shift 2 ;;
   *) shift ;;
  esac
 done
}
select_version "$@"
case $version in
 ''|.|..|latest|*[!a-zA-Z0-9._-]*) fail 'Use --version with an exact release tag, not latest' ;;
esac
command -v curl >/dev/null 2>&1 || fail 'Install curl first'
if command -v sha256sum >/dev/null 2>&1; then
 checksum_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then
 checksum_tool=shasum
else
 fail 'Install sha256sum or shasum to verify downloads'
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/aiki-bootstrap.XXXXXXXX")
trap 'rm -rf "$work"' 0
trap 'exit 1' HUP INT TERM
base=https://github.com/MitzaCoder/aiki/releases/download/$version
fetch() {
 curl --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 --retry 2 -fL "$1" -o "$2"
}
fetch "$base/install.sh" "$work/install.sh"
fetch "$base/install.sh.sha256" "$work/install.sh.sha256"
# Parse one digest for this exact filename; never let a downloaded checksum file
# choose local paths to read. Reject missing, malformed or multi-entry sidecars.
expected=$(awk '
 NR != 1 || NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-fA-F]/ || ($2 != "install.sh" && $2 != "*install.sh") { bad=1 }
 END { if (NR != 1 || bad) exit 1; print tolower($1) }
' "$work/install.sh.sha256") || fail 'Invalid installer checksum file; nothing executed'
if [ "$checksum_tool" = sha256sum ]; then
 actual=$(sha256sum "$work/install.sh")
else
 actual=$(shasum -a 256 "$work/install.sh")
fi
actual=${actual%% *}
[ "$actual" = "$expected" ] || fail 'Installer checksum mismatch; nothing executed'
printf 'aiki bootstrap: verified GitHub release installer %s\n' "$version"
# The pinned default must also reach the release installer, whose own default
# might otherwise select latest (which excludes prereleases).
if [ "$explicit_version" = false ]; then set -- --version "$version" "$@"; fi
# Do not exec: this shell must remove its temporary directory when the child exits.
sh "$work/install.sh" "$@"
