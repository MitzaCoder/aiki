#!/usr/bin/env bash
# Sourced by deploy.sh and rollback.sh: the remote backend targets (deploy/targets.json, see deploy/targets.ts) as arrays,
# and the few helpers that talk to one of them. Needs REPO_DIR and BUN, and a `die` and `log` of the caller's.
#
#   load_targets             fills TARGET_NAMES[] ... TARGET_PORTS[] (one entry per target, same index) from targets.ts
#   target_index <name>      the index of a target, or fails
#   use_target <index>       sets T_NAME T_LABEL T_SSH T_TAILNET T_UNIT T_BUN T_IDENTITY T_OPTIONAL T_PORT and SSH_OPTS
#   tssh <command>           ssh to the current target, with its options; the command goes through bash even when the
#                            target's login shell is another (remote_command)
#   probe_target             quick "does it answer" ssh for the current target; for a target that is not optional it is
#                            always true (a down VM is a real failure, not something to skip)
#   remote_bun               the `bun` the current target's remote shell runs
#
# Kept single-quoted on purpose: $HOME belongs to the remote shell.
REMOTE_ROOT=${DEPLOY_REMOTE_ROOT:-'$HOME/.local/share/aiki-deploy'}
# How long the probe waits for a laptop to answer, and how long an ssh to an intermittent target may sit silent.
PROBE_TIMEOUT_SECONDS=${DEPLOY_PROBE_TIMEOUT_SECONDS:-6}

TARGET_NAMES=() TARGET_LABELS=() TARGET_SSHS=() TARGET_TAILNETS=() TARGET_UNITS=() TARGET_BUNS=()
TARGET_IDENTITIES=() TARGET_OPTIONALS=() TARGET_PORTS=() TARGET_SHELLS=()
SSH_OPTS=()

function load_targets() {
	local lines line
	lines=$("$BUN" run "$REPO_DIR/deploy/targets.ts") || die "cannot read the deploy targets (deploy/targets.json): $lines"
	TARGET_NAMES=() TARGET_LABELS=() TARGET_SSHS=() TARGET_TAILNETS=() TARGET_UNITS=() TARGET_BUNS=()
	TARGET_IDENTITIES=() TARGET_OPTIONALS=() TARGET_PORTS=() TARGET_SHELLS=()
	while IFS= read -r line; do
		[[ -n $line ]] || continue
		local name label ssh tailnet unit bun identity optional port shell
		IFS='|' read -r name label ssh tailnet unit bun identity optional port shell <<<"$line"
		TARGET_NAMES+=("$name")
		TARGET_LABELS+=("$label")
		TARGET_SSHS+=("$ssh")
		TARGET_TAILNETS+=("$tailnet")
		TARGET_UNITS+=("$unit")
		TARGET_BUNS+=("$bun")
		TARGET_IDENTITIES+=("$identity")
		TARGET_OPTIONALS+=("$optional")
		TARGET_PORTS+=("$port")
		TARGET_SHELLS+=("$shell")
	done <<<"$lines"
}

function target_index() { # <name>
	local index
	for index in "${!TARGET_NAMES[@]}"; do
		if [[ ${TARGET_NAMES[index]} == "$1" ]]; then
			printf '%s' "$index"
			return 0
		fi
	done
	return 1
}

function use_target() { # <index>
	local index=$1
	T_NAME=${TARGET_NAMES[index]}
	T_LABEL=${TARGET_LABELS[index]}
	T_SSH=${TARGET_SSHS[index]}
	T_TAILNET=${TARGET_TAILNETS[index]}
	T_UNIT=${TARGET_UNITS[index]}
	T_BUN=${TARGET_BUNS[index]}
	T_IDENTITY=${TARGET_IDENTITIES[index]}
	T_OPTIONAL=${TARGET_OPTIONALS[index]}
	T_PORT=${TARGET_PORTS[index]:-${PORT:-7317}}
	T_SHELL=${TARGET_SHELLS[index]}
	local prefix=DEPLOY_${T_NAME^^}
	prefix=${prefix//-/_}
	local root_variable=${prefix}_ROOT service_variable=${prefix}_SERVICE
	local health_user_variable=${prefix}_HEALTH_USER health_env_variable=${prefix}_HEALTH_ENV_FILE
	T_HEALTH_USER=${!health_user_variable:-}
	T_HEALTH_ENV_FILE=${!health_env_variable:-}
	REMOTE_ROOT=${!root_variable:-${DEPLOY_REMOTE_ROOT:-'$HOME/.local/share/aiki-deploy'}}
	T_SERVICE=${!service_variable:-${DEPLOY_REMOTE_SERVICE:-aiki.service}}
	# A target that is not optional gets exactly `ssh <target> <command>`, as before targets were a list.
	SSH_OPTS=()
	if [[ -n $T_IDENTITY ]]; then SSH_OPTS+=(-i "$T_IDENTITY" -o IdentitiesOnly=yes); fi
	if [[ -n $T_OPTIONAL ]]; then
		# Never ask a question, give up on a silent connect, and notice a dead connection instead of hanging on it.
		SSH_OPTS+=(-o BatchMode=yes -o "ConnectTimeout=$PROBE_TIMEOUT_SECONDS" -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
	fi
}

# A command for the remote shell. ssh runs it through the user's login shell; when that is not bash (fish on the Laptop has
# no `tmp=$(...)` and a different `if`), the command goes to a bash of its own, single-quoted.
function remote_command() { # <command>
	local command=$1
	if [[ -z $T_SHELL || $T_SHELL == bash ]]; then
		printf '%s' "$command"
	elif [[ $T_SHELL == fish ]]; then
		# fish single quotes treat \\ and \' as escapes and have no '\'' trick: escape both inside the quotes.
		local quoted=${command//\\/\\\\}
		quoted=${quoted//\'/\\\'}
		printf "bash -c '%s'" "$quoted"
	else
		printf "bash -c '%s'" "${command//\'/\'\\\'\'}"
	fi
}

function tssh() { # <command>
	ssh "${SSH_OPTS[@]}" "$T_SSH" "$(remote_command "$1")"
}

function probe_target() {
	[[ -n $T_OPTIONAL ]] || return 0
	ssh "${SSH_OPTS[@]}" "$T_SSH" true >/dev/null 2>&1
}

function remote_bun() {
	if [[ -n $T_BUN ]]; then
		printf '%s' "$T_BUN"
	elif [[ $T_UNIT == user ]]; then
		printf '%s' '$HOME/.local/bin/bun'
	else
		printf '%s' bun
	fi
}

# The environment a remote backend.sh gets besides the port: the system unit's bun, and for an intermittent target that
# the script outlives a dropped connection (backend.sh DEPLOY_SURVIVE_DISCONNECT). Empty for the VM.
function remote_backend_env() {
	local text="DEPLOY_BACKEND_ROOT=$REMOTE_ROOT DEPLOY_BACKEND_SERVICE=$(printf '%q' "$T_SERVICE") "
	if [[ -n $T_HEALTH_USER ]]; then text+="DEPLOY_HEALTH_USER=$(printf '%q' "$T_HEALTH_USER") "; fi
	if [[ -n $T_HEALTH_ENV_FILE ]]; then text+="DEPLOY_HEALTH_ENV_FILE=$(printf '%q' "$T_HEALTH_ENV_FILE") "; fi
	if [[ $T_UNIT == system && -n $T_BUN ]]; then text+="BUN=$T_BUN "; fi
	if [[ -n $T_OPTIONAL ]]; then text+="DEPLOY_SURVIVE_DISCONNECT=1 "; fi
	printf '%s' "$text"
}

function remote_backend_mode() {
	printf '%s' "$T_UNIT"
}
