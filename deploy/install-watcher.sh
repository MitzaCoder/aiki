#!/usr/bin/env bash
# Install the watcher as a systemd user service of the user running this script, and start it.
#
#   deploy/install-watcher.sh             # install + enable + start
#   deploy/install-watcher.sh --remove    # stop + disable + remove
#
# The watcher does not deploy on first start: it records where refs/heads/main is now, so the targets get their first
# releases from `deploy/deploy.sh` and every later one from `main` moving.
#
# The user manager (and with it this service) outlives logins only with linger on (`loginctl enable-linger <user>`, set on
# this host). The watcher warns on start when it is off.
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
# Trusted, untracked machine configuration; never copied into an archived release.
export DEPLOY_CONFIG_DIR="${DEPLOY_CONFIG_DIR:-$REPO_DIR/deploy/local}"
if [[ -f $DEPLOY_CONFIG_DIR/config.env ]]; then source "$DEPLOY_CONFIG_DIR/config.env"; fi
UNIT_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
WATCH_SERVICE=${DEPLOY_WATCH_SERVICE:-mihai-harness-deploy-watch.service}
UNIT=$UNIT_DIR/$WATCH_SERVICE

function log() { printf '%s [install] %s\n' "$(date -Is)" "$*"; }
function die() { log "ERROR: $*"; exit 1; }

if [[ ${1:-} == --remove ]]; then
	systemctl --user disable --now "$WATCH_SERVICE" 2>/dev/null || true
	rm -f "$UNIT"
	systemctl --user daemon-reload
	log "watcher removed; deployed releases are untouched"
	exit 0
fi

mkdir -p "$UNIT_DIR"
sed "s|@REPO_DIR@|$REPO_DIR|g" "$REPO_DIR/deploy/systemd/deploy-watch.service.in" >"$UNIT"
chmod 0644 "$UNIT"
systemctl --user daemon-reload
systemctl --user enable "$WATCH_SERVICE"
# `enable --now` leaves a running watcher on its old script, so restart it. A restart kills a deploy the watcher started,
# so wait for the deploy lock first and hold it while the watcher restarts.
STATE_DIR=${DEPLOY_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/mihai-harness-deploy}
mkdir -p "$STATE_DIR"
log "waiting for any running deploy to finish (lock $STATE_DIR/deploy.lock)"
flock "$STATE_DIR/deploy.lock" systemctl --user restart "$WATCH_SERVICE"

linger=$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null || echo unknown)
if [[ $linger != yes ]]; then
	log "note: Linger=$linger for $USER, so this service lives only as long as a login session."
	log "      To keep it running after logout: loginctl enable-linger $USER (not done here)."
fi
log "watching refs/heads/main; log: journalctl --user -u mihai-harness-deploy-watch -f"
systemctl --user --no-pager status "$WATCH_SERVICE" | head -n 12 || true
