#!/usr/bin/env bash
# Share this host's Web Push VAPID key pair with a remote backend.
#
# Every backend signs with the same key pair, because a browser holds one push subscription: the subscription it
# registers with one backend must verify against the key the others sign with. The host's backend is the source of
# truth, so its key file is copied to the remote one when the remote's is missing or different.
#
#   deploy/vapid-key.sh [user@host]     # default: DEPLOY_SSH_TARGET, else user@vm.example.test
#
# The key is never committed and never generated here: a backend that has none creates one at its next start, and the
# next deploy shares it. A failure is a warning, not a deploy failure — the remote backend keeps the key it has, and
# push subscriptions registered against another key stop verifying until the key is shared.
#
# Overrides: KEMIRI_DATA_DIR or DEPLOY_HOST_DATA_DIR (this host's data directory),
#            KEMIRI_VAPID_KEY_FILE (the key file itself),
#            DEPLOY_VM_DATA_DIR (the remote data directory, expanded on the remote side),
#            DEPLOY_SSH_OPTIONS (extra ssh arguments, split on spaces: the target's key, BatchMode, ConnectTimeout),
#            DEPLOY_SSH_SHELL (the target's login shell when it is not bash: commands then go through `bash -c`).
set -euo pipefail

SSH_TARGET=${1:-${DEPLOY_SSH_TARGET:-}}
if [[ -z $SSH_TARGET ]]; then printf "A remote target argument or DEPLOY_SSH_TARGET is required.\n" >&2; exit 2; fi
DATA_DIR=${KEMIRI_DATA_DIR:-${DEPLOY_HOST_DATA_DIR:-$HOME/.local/share/aiki}}
VAPID_FILE=${KEMIRI_VAPID_KEY_FILE:-$DATA_DIR/notifications/vapid.json}
# Kept single-quoted on purpose: $HOME belongs to the remote shell.
REMOTE_DATA_DIR=${DEPLOY_VM_DATA_DIR:-'$HOME/.local/share/aiki'}
REMOTE_VAPID=$REMOTE_DATA_DIR/notifications/vapid.json

# shellcheck disable=SC2206 # split on purpose
SSH_OPTIONS=(${DEPLOY_SSH_OPTIONS:-})
SSH_SHELL=${DEPLOY_SSH_SHELL:-}

# ssh runs a command through the user's login shell; a shell that is not bash gets a bash of its own to run it.
function remote() { # <command>
	local command=$1
	if [[ -n $SSH_SHELL && $SSH_SHELL != bash ]]; then command="bash -c '${command//\'/\'\\\'\'}'"; fi
	ssh "${SSH_OPTIONS[@]}" "$SSH_TARGET" "$command"
}

function log() { printf '%s [vapid] %s\n' "$(date -Is)" "$*"; }
function warn() { log "WARNING: $*"; }

if [[ ! -f $VAPID_FILE ]]; then
	log "no key at $VAPID_FILE yet; the backend creates one at its next start and the next deploy shares it"
	exit 0
fi

if ! local_sum=$(sha256sum "$VAPID_FILE" | cut -d' ' -f1); then
	warn "cannot read $VAPID_FILE; not sharing a key"
	exit 0
fi

if ! remote_sum=$(remote "if [ -f \"$REMOTE_VAPID\" ]; then sha256sum \"$REMOTE_VAPID\" | cut -d' ' -f1; fi"); then
	warn "$SSH_TARGET did not answer; its backend keeps its own key"
	exit 0
fi

if [[ $local_sum == "$remote_sum" ]]; then
	log "$SSH_TARGET already has this key"
	exit 0
fi

# A private temporary file next to the target, then a rename: a reader never sees a half-written key pair. 0600, like the
# backend writes it, because a VAPID private key signs for every subscription of this user.
if remote "umask 077 && mkdir -p \"\$(dirname \"$REMOTE_VAPID\")\" && cat > \"$REMOTE_VAPID.incoming\" && mv -f \"$REMOTE_VAPID.incoming\" \"$REMOTE_VAPID\"" <"$VAPID_FILE"; then
	if [[ -n $remote_sum ]]; then
		log "replaced the key on $SSH_TARGET; a device that subscribed against the old one must subscribe again"
	else
		log "copied the key to $SSH_TARGET"
	fi
else
	warn "could not copy the key to $SSH_TARGET; copy it by hand (README, Deploy) or push notifications there stop verifying"
fi
