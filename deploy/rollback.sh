#!/usr/bin/env bash
# Switch one deployed target back to an earlier release, restart it where there is a server, and verify it.
#
#   deploy/rollback.sh                        # the VM backend, to the release before the current one
#   deploy/rollback.sh <release-name>         # the VM backend, to a specific release
#   deploy/rollback.sh --target host          # the backend on this host
#   deploy/rollback.sh --target laptop           # any remote target of deploy/targets.json (vm, laptop, ...)
#   deploy/rollback.sh --target web           # the app served by Caddy
#   deploy/rollback.sh --list                 # releases on the target, newest first
#   deploy/rollback.sh --status               # current release, unit state, listening sockets
#
# The target defaults to `vm`; `DEPLOY_TARGET=host`, `DEPLOY_TARGET=web` or a target's name changes it. A laptop that does
# not answer is an error here (nothing is skipped by hand). If a backend's target release
# does not answer, it restores the release it came from, so a hand rollback cannot make things worse.
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
# Trusted, untracked machine configuration; never copied into an archived release.
export DEPLOY_CONFIG_DIR="${DEPLOY_CONFIG_DIR:-$REPO_DIR/deploy/local}"
if [[ -f $DEPLOY_CONFIG_DIR/config.env ]]; then source "$DEPLOY_CONFIG_DIR/config.env"; fi
BUN=${BUN:-bun}
HOST_SERVICE=${DEPLOY_HOST_SERVICE:-aiki.service}
APP_ROOT=${DEPLOY_APP_ROOT:-/var/lib/aiki-web}
TARGET=${DEPLOY_TARGET:-vm}

ARGS=()
while (($# > 0)); do
	case $1 in
	--target)
		TARGET=${2:-}
		shift 2
		;;
	--target=*)
		TARGET=${1#*=}
		shift
		;;
	*)
		ARGS+=("$1")
		shift
		;;
	esac
done

function log() { printf '%s [rollback:%s] %s\n' "$(date -Is)" "$TARGET" "$*"; }
function die() { log "ERROR: $*"; exit 1; }

# shellcheck source=deploy/targets.sh
source "$REPO_DIR/deploy/targets.sh"

case $TARGET in
web)
	if [[ ${ARGS[0]:-} == --list ]]; then
		AIKI_WEB_ROOT=$APP_ROOT bash "$REPO_DIR/deploy/web.sh" list
	elif [[ ${ARGS[0]:-} == --status ]]; then
		AIKI_WEB_ROOT=$APP_ROOT bash "$REPO_DIR/deploy/web.sh" status
	else
		log "asking the app deployer to roll back ${ARGS[0]:-to the previous release}"
		AIKI_WEB_ROOT=$APP_ROOT bash "$REPO_DIR/deploy/web.sh" rollback "${ARGS[0]:-}" ||
			die "app rollback failed; see the log above"
		log "rolled back the app"
	fi
	;;
host)
	systemctl cat "$HOST_SERVICE" >/dev/null 2>&1 || die "$HOST_SERVICE is not installed (nix-config adds it)"
	if [[ ${ARGS[0]:-} == --list ]]; then
		bash "$REPO_DIR/deploy/backend.sh" system list
	elif [[ ${ARGS[0]:-} == --status ]]; then
		bash "$REPO_DIR/deploy/backend.sh" system status
	else
		log "asking host backend $HOST_SERVICE to roll back ${ARGS[0]:-to the previous release}"
		bash "$REPO_DIR/deploy/backend.sh" system rollback "${ARGS[0]:-}" || die "rollback failed; see the log above"
		log "rolled back the host backend"
	fi
	;;
*)
	load_targets
	index=$(target_index "$TARGET") || die "unknown target ${TARGET}; use host, web or one of: ${TARGET_NAMES[*]}"
	use_target "$index"
	backend="$(remote_backend_env)bash $REMOTE_ROOT/tools/backend.sh $T_UNIT"
	if [[ ${ARGS[0]:-} == --list ]]; then
		tssh "$backend list"
	elif [[ ${ARGS[0]:-} == --status ]]; then
		tssh "$backend status"
	else
		log "asking $T_SSH to roll back ${ARGS[0]:-to the previous release}"
		if ! tssh "$backend rollback $(printf '%q' "${ARGS[0]:-}")"; then
			die "rollback failed; see the log above"
		fi
		log "rolled back the $T_LABEL backend"
	fi
	;;
esac
