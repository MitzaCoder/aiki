#!/usr/bin/env bash
# Hash one canonical release payload; never create a legacy filename.
set -euo pipefail
asset=${1:?Canonical Kemiri asset path required}
name=$(basename "$asset")
[[ $name == kemiri-*-android-* && -f $asset ]] || { echo 'Expected a canonical Android release asset' >&2; exit 2; }
out=$(cd "$(dirname "$asset")" && pwd -P)
[[ ! -e $out/$name.sha256 ]] || { echo "Release output exists: $name.sha256" >&2; exit 1; }
(cd "$out" && sha256sum "$name" > "$name.sha256")
