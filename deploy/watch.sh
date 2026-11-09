#!/usr/bin/env bash
# Watch `refs/heads/main` in this repository and deploy every commit it moves to: the app on this host, and the backend
# here and on the remote VM.
#
# Runs as a systemd user service (deploy/systemd/deploy-watch.service.in, installed by install-watcher.sh); its
# output is the deploy log, so `journalctl --user -u mihai-harness-deploy-watch -f` shows what happened.
#
# git only, deliberately: this is a colocated jj+git repository, and running jj here would snapshot the working copy
# behind the user's back. `git rev-parse refs/heads/main` does not touch the working copy, and the commit it names is
# what deploy.sh deploys.
#
# The state file remembers the last `main` commit it saw, so a restart does not redeploy and a move that happened while
# the watcher was down is picked up when it starts again. A deploy is attempted once per move: a failed deploy is
# reported in the log and waits for the next move instead of retrying in a loop.
#
# Catch-up: an intermittent target (the Laptop laptop) that was asleep or away at a deploy is left pending
# ($XDG_STATE_HOME/mihai-harness-deploy/pending/<name>.json, written by deploy.sh). Every DEPLOY_CATCHUP_SECONDS (120) while
# something is pending, `deploy.sh --catch-up` probes it, and deploys the current main to it alone when it answers and
# is behind. It speaks only when it acts. It runs in this same loop, so it never overlaps a deploy the watcher started
# (deploy.sh's lock also keeps it from a hand deploy: exit 75, tried again next round). A catch-up that failed for a
# commit is not repeated for that commit.
set -uo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
# Trusted, untracked machine configuration; never copied into an archived release.
export DEPLOY_CONFIG_DIR="${DEPLOY_CONFIG_DIR:-$REPO_DIR/deploy/local}"
if [[ -f $DEPLOY_CONFIG_DIR/config.env ]]; then source "$DEPLOY_CONFIG_DIR/config.env"; fi
REF=${DEPLOY_REF:-refs/heads/main}
INTERVAL=${DEPLOY_POLL_SECONDS:-10}
CATCHUP_INTERVAL=${DEPLOY_CATCHUP_SECONDS:-120}
STATE_DIR=${DEPLOY_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/mihai-harness-deploy}
STATE=$STATE_DIR/last-seen-main
PENDING_DIR=$STATE_DIR/pending

function log() { printf '%s [watch] %s\n' "$(date -Is)" "$*"; }

mkdir -p "$STATE_DIR"
last=""
if [[ -f $STATE ]]; then last=$(<"$STATE"); fi
log "watching $REF in $REPO_DIR every ${INTERVAL}s"
linger=$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null || echo unknown)
if [[ $linger != yes ]]; then
	log "note: Linger=$linger for $USER, so this watcher stops when the last login session ends"
fi
if [[ -z $last ]]; then
	log "no earlier run recorded; taking the current $REF as the baseline (deploy.sh by hand gives each target its first release)"
else
	log "last seen $REF: ${last:0:12}"
fi

# The main commit a catch-up already failed for, and when the next one is due.
catchup_failed=""
next_catchup=$((SECONDS + CATCHUP_INTERVAL))

# Whether a laptop is waiting for a deploy.
function something_pending() {
	compgen -G "$PENDING_DIR/*.json" >/dev/null
}

while true; do
	if ((SECONDS >= next_catchup)); then
		next_catchup=$((SECONDS + CATCHUP_INTERVAL))
		current=$(git -C "$REPO_DIR" rev-parse --verify --quiet "$REF" 2>/dev/null || true)
		if [[ -n $current && $current != "$catchup_failed" ]] && something_pending; then
			bash "$REPO_DIR/deploy/deploy.sh" --catch-up "$current"
			status=$?
			case $status in
			0 | 75) ;;
			*)
				catchup_failed=$current
				log "catch-up of ${current:0:12} FAILED (exit $status); not retrying until $REF moves again"
				;;
			esac
		fi
	fi
	sha=$(git -C "$REPO_DIR" rev-parse --verify --quiet "$REF" 2>/dev/null || true)
	if [[ -n $sha && $sha != "$last" ]]; then
		printf '%s\n' "$sha" >"$STATE"
		if [[ -z $last ]]; then
			log "baseline ${sha:0:12}"
			last=$sha
		else
			log "$REF moved ${last:0:12} -> ${sha:0:12}; deploying"
			last=$sha
			started=$(date +%s)
			if bash "$REPO_DIR/deploy/deploy.sh" "$sha"; then
				log "deploy of ${sha:0:12} finished ok in $(( $(date +%s) - started ))s"
			else
				log "deploy of ${sha:0:12} FAILED in $(( $(date +%s) - started ))s; not retrying until $REF moves again"
			fi
		fi
	fi
	sleep "$INTERVAL"
done
