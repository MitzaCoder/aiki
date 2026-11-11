#!/usr/bin/env bash
# Run once on the signing owner's computer. Never copy these files into a checkout or CI.
set -euo pipefail
umask 077
root=$(git -C "$(dirname "$0")/../../.." rev-parse --show-toplevel)
directory="$HOME/.config/aiki-release"
mkdir -p "$directory"
chmod 700 "$directory"
directory=$(realpath "$directory")
case "$directory/" in "$root/"*) echo 'Signing key must be outside the repository' >&2; exit 1 ;; esac
key="$directory/pilot.p12"
password="$directory/pilot-password.txt"
[[ ! -e $key && ! -e $password ]] || { echo 'Key/password already exist; refusing to replace signing identity' >&2; exit 1; }
command -v bun >/dev/null
keytool=${JAVA_HOME:+$JAVA_HOME/bin/}keytool
command -v "$keytool" >/dev/null
bun -e 'process.stdout.write(Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64") + "\n")' > "$password"
chmod 600 "$password"
"$keytool" -genkeypair -storetype PKCS12 -keystore "$key" -alias aiki-pilot \
  -storepass:file "$password" -keypass:file "$password" -keyalg RSA -keysize 3072 \
  -validity 10000 -dname 'CN=Aiki pilot release' < /dev/null
chmod 600 "$key"
printf 'Signing key: %s\nPassword file: %s\nBack up BOTH files securely, separately from the repository. Password not printed.\n' "$key" "$password"
"$keytool" -list -v -keystore "$key" -alias aiki-pilot -storepass:file "$password" | grep 'SHA256:'
