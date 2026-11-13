#!/usr/bin/env bash
# Publish a byte-identical old filename, with checksums naming each asset separately.
set -euo pipefail
asset=${1:?Canonical Kemiri asset path required}
name=$(basename "$asset")
[[ $name == kemiri-*-android-* && -f $asset ]] || { echo 'Expected a canonical Android release asset' >&2; exit 2; }
out=$(cd "$(dirname "$asset")" && pwd -P)
legacy="aiki-${name#kemiri-}"
for target in "$legacy" "$name.sha256" "$legacy.sha256"; do
  [[ ! -e $out/$target ]] || { echo "Release output exists: $target" >&2; exit 1; }
done
cp "$out/$name" "$out/$legacy"
cmp "$out/$name" "$out/$legacy"
(cd "$out" && sha256sum "$name" > "$name.sha256" && sha256sum "$legacy" > "$legacy.sha256")
