#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# This can point at the stable deploy checkout even when building an archived tree.
private_properties="${DEPLOY_CONFIG_DIR:-$(pwd -P)/../../deploy/local}/android.properties"
if [[ -z ${HARNESS_ANDROID_PROPERTIES:-} && -f $private_properties ]]; then export HARNESS_ANDROID_PROPERTIES=$private_properties; fi
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOME/scratch/android-cache/gradle}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/scratch/android-cache/xdg}"
export TMPDIR="${TMPDIR:-$HOME/scratch/android-cache/tmp}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$HOME/scratch/android-cache/android}"
mkdir -p "$GRADLE_USER_HOME" "$XDG_CACHE_HOME" "$TMPDIR" "$ANDROID_USER_HOME" .gradle
# One build at a time in this checkout (its build/ and configuration cache); other checkouts build in parallel. The
# shared Gradle user home is safe for that: Gradle locks its caches across processes.
exec 9>.gradle/build.lock
flock 9
# Already-realized toolchain from the pinned flake on this host. No SDK downloads,
# duplicate images, or writable SDK overlays. Else use nix develop.
if [[ -z "${JAVA_HOME:-}" && -d /nix/store/1slz0vmmgsd7p6i4c0jaywkpw56wl2yg-openjdk-21.0.12+8 ]]; then
  export JAVA_HOME=/nix/store/1slz0vmmgsd7p6i4c0jaywkpw56wl2yg-openjdk-21.0.12+8
fi
if [[ -z "${ANDROID_HOME:-}" && -d /nix/store/5ai22w9xb688944faml6jn1p38x1nira-androidsdk/libexec/android-sdk ]]; then
  export ANDROID_HOME=/nix/store/5ai22w9xb688944faml6jn1p38x1nira-androidsdk/libexec/android-sdk
fi
# This shell keeps the lock while Gradle runs; Gradle and its daemons never get the descriptor.
if [[ -n "${JAVA_HOME:-}" && -n "${ANDROID_HOME:-}" ]]; then
  ./gradlew --console=plain "$@" 9>&-
else
  nix --extra-experimental-features 'nix-command flakes' develop --command ./gradlew --console=plain "$@" 9>&-
fi
