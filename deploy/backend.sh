#!/usr/bin/env bash
# The backend half of a deploy. Runs on one machine that hosts a aiki backend: this NixOS host (system
# service, mode `system`) or the remote VM (remote user service, mode `user`). deploy/deploy.sh copies it, with
# health-check.ts and deploy-status.ts, to the target's ~/.local/share/aiki-deploy/tools/ and calls it there, so
# the tooling is the deploying host's copy rather than the release's: a release that cannot start can still be rolled back.
#
#   backend.sh system release <name> <sha> [subject]   publish <incoming>/<name>, restart, verify (roll back on failure)
#   backend.sh system unchanged <sha> [subject]        no restart: <sha> changes nothing the backend runs; hello, record ok
#   backend.sh system rollback [<name>]                switch to <name> (default: the release before current), restart, verify
#   backend.sh system list                             releases, newest first, with current and rollback target marked
#   backend.sh system health                           protocol hello against the running server
#   backend.sh system status                           unit state, current release, listening sockets
#
# `user` does the same for systemd --user and installs the unit from tools/. `system` never installs a unit: the unit
# belongs to nix-config, and deploy only restarts it (a polkit rule lets the deploying user do that without a password).
#
# Before the restart it drains the backend (`server.drain`: new tool calls wait) and waits until no tool call executes,
# or, on a server without the `drain` feature, until it is idle (`server.status` says no conversation and no worker
# runs), polling every DEPLOY_IDLE_POLL_SECONDS (5) up to DEPLOY_IDLE_TIMEOUT_SECONDS (600), then restarts anyway and
# says so. A server that is down or has neither feature is not waited for. It then records which projects are open
# (`.open-projects` in the deploy root), because projects open lazily: right after the restart none is, and the deep health
# check (`deploy/health-check.ts --deep --open-projects --expect-commit`) pages those recorded ones, which opens them
# again, and fails if one of them does not page. Projects that were not open before stay unchecked. At the end of the
# attempt `<root>/deploy-status.json` records ok, failed or rolled_back for the app.
#
# Layout under ~/.local/share/aiki-deploy:
#   releases/<YYYYMMDDTHHMMSSZ>-<sha7>/   one folder per deploy, the repository tree as of that commit, with RELEASE.json
#   incoming/                             a tree being received; becomes a release when it is complete
#   tools/                                this script, health-check.ts, deploy-status.ts and (for the VM) the systemd unit
#   current -> releases/<name>            what the service runs
#   deploy-status.json                    how the last attempt went, served as `server.status.deploy`
#
# Server data is never rewritten here. Required auth refuses releases without recorded auth support.
#
# Over a link that may drop (DEPLOY_SURVIVE_DISCONNECT=1, set by deploy.sh for intermittent targets) it keeps going: see
# survive_disconnect.
#
# A deploy started from inside the aiki unit's own cgroup (a tool of the server it deploys) is refused: the
# restart kills it before the health check and rollback. Move the `main` bookmark instead; deploy/watch.sh deploys that.
set -euo pipefail

MODE=${1:-}
case $MODE in
system | user) shift ;;
*) echo "usage: backend.sh system|user release|unchanged|rollback|list|status|health ..." >&2; exit 2 ;;
esac

BUN_VERSION=${DEPLOY_BUN_VERSION:-1.4.2}
# zellij runs the app's terminals (docs/DESIGN.md "Terminals"). The VM has none, so a pinned static release goes into
# ~/.local/bin like bun; the SHA-256 is that of the `zellij` binary inside the release archive (published beside it).
ZELLIJ_VERSION=${DEPLOY_ZELLIJ_VERSION:-0.45.1}
ZELLIJ_SHA256_X86_64=d006c521dcb475a6005d741e9dd7c5758e5a23b28dd60a5c10cebfa4876319dd
ZELLIJ_SHA256_AARCH64=2a2c0621e6f3b11ecbb05d66939a48000a2508604620aa20727a5fd61c49f451
PORT=${KEMIRI_PORT:-7317}
# The tooling that travels with this script into tools/ and runs next to it, so a copy from the release that is being
# deployed never lags behind the deploy that calls it.
SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
ROOT=${DEPLOY_BACKEND_ROOT:-${DEPLOY_HOST_ROOT:-$HOME/.local/share/aiki-deploy}}
RELEASES=$ROOT/releases
INCOMING=$ROOT/incoming
CURRENT=$ROOT/current
TOOLS=$ROOT/tools
HEALTH=$SELF_DIR/health-check.ts
STATUS_WRITER=$SELF_DIR/deploy-status.ts
STATUS=$ROOT/deploy-status.json
# Written before each restart and read after it: projects open lazily, so right after one `projects.list` reports none
# open and checking only those would check no conversation at all.
OPEN_PROJECTS=$ROOT/.open-projects
KEEP=${DEPLOY_KEEP_RELEASES:-5}
IDLE_TIMEOUT_SECONDS=${DEPLOY_IDLE_TIMEOUT_SECONDS:-600}
IDLE_POLL_SECONDS=${DEPLOY_IDLE_POLL_SECONDS:-5}
CGROUP_FILE=${DEPLOY_CGROUP_FILE:-/proc/self/cgroup}
# The server binds its port within a second or two; this is generous and keeps a broken release's rollback quick.
HEALTH_TIMEOUT_MS=${DEPLOY_HEALTH_TIMEOUT_MS:-20000}

if [[ $MODE == user ]]; then
	SERVICE=${DEPLOY_BACKEND_SERVICE:-aiki.service}
	BUN=${BUN:-$HOME/.local/bin/bun}
	UNIT_DIR=$HOME/.config/systemd/user
	UNIT=$UNIT_DIR/${SERVICE%.service}.service
	UNIT_SOURCE=$TOOLS/aiki.service
else
	SERVICE=${DEPLOY_BACKEND_SERVICE:-${DEPLOY_HOST_SERVICE:-${KEMIRI_SERVICE:-aiki.service}}}
	BUN=${BUN:-bun}
fi

: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR

function log() { printf '%s [deploy:%s] %s\n' "$(date -Is)" "$MODE" "$*"; }
function die() { log "ERROR: $*"; exit 1; }

function sc() {
	if [[ $MODE == user ]]; then systemctl --user "$@"; else systemctl "$@"; fi
}

# System units may belong to another OS account. Never relax auth.sock permissions.
# Configure passwordless sudo for this exact Bun/checker command when accounts differ.
function health() {
	local user=${DEPLOY_HEALTH_USER:-} current_user
	current_user=$(id -un)
	if [[ -z $user && $MODE == system ]]; then
		user=$(sc show "$SERVICE" --property=User --value) || return 1
		# An empty User means root for a real system unit. The service is required before checks.
		user=${user:-root}
	fi
	local command=("$BUN" run "$HEALTH")
	if [[ -n ${DEPLOY_HEALTH_ENV_FILE:-} ]]; then command=(env "KEMIRI_ENV_FILE=$DEPLOY_HEALTH_ENV_FILE" "${command[@]}"); fi
	if [[ -n $user && $user != "$current_user" ]]; then
		sudo -n -H -u "$user" -- "${command[@]}" "$@"
	else
		"${command[@]}" "$@"
	fi
}

function require_safe_release() {
	local output
	if output=$(health "--check-release=$RELEASES/$1" 2>&1); then return 0; fi
	log "REFUSING release $1: $output"
	return 1
}

function service_exists() {
	sc cat "$SERVICE" >/dev/null 2>&1
}

function require_service() {
	[[ $MODE == user ]] && return 0
	service_exists || die "system service $SERVICE is not installed; nix-config creates it"
}

# The server runs its tools inside its own cgroup, and a restart takes that whole cgroup down: a deploy started from
# there dies at `systemctl restart`, after `current` already moved, so neither the health check nor the rollback runs.
# The watcher (deploy/watch.sh) is not in the cgroup, so moving `main` is the road that works.
function refuse_inside_server_unit() {
	local cgroup
	[[ -r $CGROUP_FILE ]] || return 0
	cgroup=$(<"$CGROUP_FILE")
	case $cgroup in
	*"${SERVICE%.service}.service"*)
		log "REFUSING to deploy from inside the aiki server's cgroup ($CGROUP_FILE names $SERVICE)."
		log "The restart would kill this script after current moved, before the health check and the rollback."
		log "Move the main bookmark instead: deploy/watch.sh deploys when it moves (README, Deploy)."
		exit 2
		;;
	esac
}

# What the server reports as `server.status.release`: the release it runs, read from the release directory.
function write_release_json() { # <release dir> <name> <sha> <description>
	if ! "$BUN" -e '
		const [dir, name, commit, description] = process.argv.slice(1);
		if (!commit) throw new Error("no commit given");
		const source = Bun.file(`${dir}/packages/server/src/server.ts`);
		const supportsDeviceAuth = await Bun.file(`${dir}/packages/server/src/device-auth.ts`).exists() &&
			await source.exists() && (await source.text()).includes("new DeviceAuth(");
		const release = { name, commit, description, deployedAt: new Date().toISOString(), supportsDeviceAuth };
		await Bun.write(`${dir}/RELEASE.json`, `${JSON.stringify(release, null, 2)}\n`);
	' "$1" "$2" "$3" "$4"; then
		log "WARNING: could not write $1/RELEASE.json; server.status reports no release for it"
	fi
}

# One string field of a release's RELEASE.json, empty when the release has none (an older release, a rollback target).
function release_field() { # <release dir> <field>
	local value=""
	value=$("$BUN" -e '
		try {
			const release = await Bun.file(`${process.argv[1]}/RELEASE.json`).json();
			const value = release[process.argv[2]];
			if (typeof value === "string") console.log(value);
		} catch {}
	' "$1" "$2" 2>/dev/null) || value=""
	printf '%s' "$value"
}

# The last attempt on this backend, as `server.status.deploy`: ok, failed or rolled_back. Extra arguments go to the writer
# (`--backend-unchanged`).
function write_deploy_status() { # <state> <sha> <description> [message] [writer options...]
	local state=$1 sha=$2 description=$3 message=${4:-} output
	shift 3
	if (($# > 0)); then shift; fi
	if [[ ! -f $STATUS_WRITER ]]; then
		log "WARNING: no $STATUS_WRITER; not recording $state in $STATUS"
		return 0
	fi
	if output=$("$BUN" run "$STATUS_WRITER" "$state" "$sha" "$description" "$message" "$@" "--out=$STATUS" 2>&1); then
		log "deploy status: $output"
	else
		log "WARNING: could not record $state in $STATUS: $output"
	fi
}

# Bun, same version as the development host, under ~/.local so nothing touches the Nix store.
function ensure_bun() {
	if [[ $MODE == system ]]; then
		command -v "$BUN" >/dev/null 2>&1 || die "bun is not on PATH; set BUN"
		return 0
	fi
	if [[ -x $BUN ]] && [[ $("$BUN" --version 2>/dev/null) == "$BUN_VERSION" ]]; then
		return 0
	fi
	local machine arch url
	machine=$(uname -m)
	case $machine in
	x86_64) arch=x64 ;;
	aarch64 | arm64) arch=aarch64 ;;
	*) die "no Bun build for $machine" ;;
	esac
	url="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-$arch.zip"
	log "installing Bun $BUN_VERSION into $HOME/.local"
	# A subshell so the download directory goes away on both success and failure.
	(
		set -euo pipefail
		tmp=$(mktemp -d)
		trap 'rm -rf "$tmp"' EXIT
		curl -fsSL -o "$tmp/bun.zip" "$url"
		mkdir -p "$tmp/x"
		if command -v unzip >/dev/null 2>&1; then
			unzip -q "$tmp/bun.zip" -d "$tmp/x"
		elif command -v python3 >/dev/null 2>&1; then
			python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/bun.zip" "$tmp/x"
		else
			echo "need unzip or python3 to unpack $url" >&2
			exit 1
		fi
		found=$(find "$tmp/x" -type f -name bun | head -n 1)
		[[ -n $found ]] || { echo "no bun binary inside $url" >&2; exit 1; }
		mkdir -p "$HOME/.local/bin"
		install -m 0755 "$found" "$BUN"
	) || die "installing Bun $BUN_VERSION failed"
	[[ $("$BUN" --version) == "$BUN_VERSION" ]] || die "$BUN does not report version $BUN_VERSION"
	log "Bun $BUN_VERSION in place"
}

# Whether the system unit's PATH (its `Environment=PATH=...`, read from systemd) has a zellij; false when it cannot be read.
function system_unit_has_zellij() {
	local environment path dir
	environment=$(systemctl show "$SERVICE" --property=Environment --value 2>/dev/null) || return 1
	path=$(printf '%s\n' "$environment" | tr ' ' '\n' | sed -n 's/^PATH=//p' | head -n 1) || true
	[[ -n $path ]] || return 1
	while IFS= read -r dir; do
		[[ -n $dir && -x $dir/zellij ]] && return 0
	done < <(printf '%s' "$path" | tr ':' '\n')
	return 1
}

# zellij for the terminals, as bun is: user mode installs the pinned static (musl) release into ~/.local/bin; system mode
# only says whether the service's PATH has one (the host's nix-config provides it). A missing zellij never fails a deploy:
# the app says "zellij is not installed on this backend" where the terminal would be.
function ensure_zellij() {
	if [[ $MODE == system ]]; then
		# The service's PATH is the unit's own (nix-config), not this ssh session's, so look there first. Only a warning:
		# a deploy never fails for want of zellij, the app says so where the terminal would be.
		if ! system_unit_has_zellij && ! command -v zellij >/dev/null 2>&1 && [[ ! -x $HOME/.local/bin/zellij ]]; then
			log "WARNING: zellij is not on the $SERVICE unit's PATH; terminals in the app will say so (nix-config: add zellij to the service PATH)"
		fi
		return 0
	fi
	local target=$HOME/.local/bin/zellij
	if [[ -x $target ]] && [[ $("$target" --version 2>/dev/null) == "zellij $ZELLIJ_VERSION" ]]; then
		return 0
	fi
	local machine arch sha
	machine=$(uname -m)
	case $machine in
	x86_64) arch=x86_64 sha=$ZELLIJ_SHA256_X86_64 ;;
	aarch64 | arm64) arch=aarch64 sha=$ZELLIJ_SHA256_AARCH64 ;;
	*) log "WARNING: no zellij build for $machine; terminals will be unavailable"; return 0 ;;
	esac
	local url="https://github.com/zellij-org/zellij/releases/download/v$ZELLIJ_VERSION/zellij-$arch-unknown-linux-musl.tar.gz"
	log "installing zellij $ZELLIJ_VERSION into $HOME/.local/bin"
	(
		set -euo pipefail
		tmp=$(mktemp -d)
		trap 'rm -rf "$tmp"' EXIT
		curl -fsSL -o "$tmp/zellij.tar.gz" "$url"
		tar -xzf "$tmp/zellij.tar.gz" -C "$tmp"
		[[ -f $tmp/zellij ]] || { echo "no zellij binary inside $url" >&2; exit 1; }
		[[ $(sha256sum "$tmp/zellij" | cut -d' ' -f1) == "$sha" ]] || { echo "zellij checksum mismatch for $url" >&2; exit 1; }
		mkdir -p "$HOME/.local/bin"
		install -m 0755 "$tmp/zellij" "$target"
	) || { log "WARNING: installing zellij $ZELLIJ_VERSION failed; terminals will be unavailable"; return 0; }
	log "zellij $ZELLIJ_VERSION in place"
}

function install_unit() {
	# The host's unit belongs to nix-config; deploy only restarts it.
	[[ $MODE == system ]] && return 0
	[[ -f $UNIT_SOURCE ]] || die "no unit file at $UNIT_SOURCE"
	mkdir -p "$UNIT_DIR"
	install -m 0644 "$UNIT_SOURCE" "$UNIT"
	systemctl --user daemon-reload
	# Linger should be enabled for the remote user, so an enabled unit also brings the server back after a reboot of the VM.
	systemctl --user enable "$SERVICE" >/dev/null 2>&1 || log "WARNING: could not enable $SERVICE at boot"
}

function switch_current() {
	local name=$1
	[[ -d $RELEASES/$name ]] || die "no release $name"
	pushd "$RELEASES" >/dev/null
	# Relative to the deploy root, so the symlink survives the deploy root being moved as a whole.
	ln -sfn "releases/$name" "$CURRENT.tmp"
	mv -T "$CURRENT.tmp" "$CURRENT"
	popd >/dev/null
	[[ -d $CURRENT ]] || die "current does not point at a release directory"
	log "current -> $name"
}

function current_release() {
	if [[ -L $CURRENT ]]; then basename "$(readlink "$CURRENT")"; fi
}

# The release deployed before <name>, by name order (names start with a UTC timestamp, so they sort by time).
function release_before() {
	local boundary=$1 name
	while read -r name; do
		[[ -d $RELEASES/$name ]] || continue
		if [[ $name < $boundary ]]; then
			printf '%s\n' "$name"
			return 0
		fi
	done < <(release_names)
	return 1
}

function release_names() {
	[[ -d $RELEASES ]] || return 0
	find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r
}

# Restart between tool calls, so a deploy does not cut off a command mid-run: a server with `drain` holds new tool calls
# and the restart waits for the executing ones (held calls run after it); an older server is waited for until nothing
# runs. The wait is advice: the restart happens anyway after DEPLOY_IDLE_TIMEOUT_SECONDS, and a server that is down or
# has neither feature is not waited for at all.
#
# The projects the deep check has to page afterwards are recorded before the restart: they are the ones open right now,
# and the restart closes them. Recording never fails; a server that cannot answer leaves the file empty.
function record_open_projects() {
	local output
	# The deploy account writes this file; the service account only reads it after restart.
	output=$(health "http://127.0.0.1:$PORT" --record-open-projects=-) || output=""
	if [[ -n $output ]]; then printf '%s\n' "$output" >"$OPEN_PROJECTS"; else : >"$OPEN_PROJECTS"; fi
	chmod 0644 "$OPEN_PROJECTS"
	local count=0
	while IFS= read -r line; do
		if [[ -n $line ]]; then count=$((count + 1)); fi
	done <<<"$output"
	log "open before restart: $count project(s) open before the restart"
}

function wait_for_idle() {
	local output
	if ! sc is-active --quiet "$SERVICE"; then
		log "not waiting for $SERVICE to be idle: it is not running"
		return 0
	fi
	output=$(health "http://127.0.0.1:$PORT" --wait-idle \
		"--idle-timeout-ms=$((IDLE_TIMEOUT_SECONDS * 1000))" "--idle-poll-ms=$((IDLE_POLL_SECONDS * 1000))" 2>&1) || true
	while IFS= read -r line; do
		[[ -n $line ]] && log "idle: $line"
	done <<<"$output"
}

function restart_and_verify() {
	local name=$1 dir=$RELEASES/$1 output commit
	wait_for_idle
	record_open_projects
	log "restarting $SERVICE"
	if ! sc restart "$SERVICE"; then
		log "$SERVICE failed to start"
		unit_logs
		return 1
	fi
	# A release from before RELEASE.json existed reports no commit; the deep check then skips that comparison.
	commit=$(release_field "$dir" commit)
	if output=$(health "http://127.0.0.1:$PORT" "--timeout-ms=$HEALTH_TIMEOUT_MS" --deep \
		"--open-projects=$OPEN_PROJECTS" ${commit:+"--expect-commit=$commit"} 2>&1); then
		log "healthy: $output"
		return 0
	fi
	log "$name failed its health check: $output"
	unit_logs
	return 1
}

function unit_logs() {
	if command -v journalctl >/dev/null 2>&1; then
		if [[ $MODE == user ]]; then
			journalctl --user -u "$SERVICE" -n 30 --no-pager || true
		else
			journalctl -u "$SERVICE" -n 30 --no-pager || true
		fi
	else
		log "no journalctl; see systemctl status $SERVICE"
	fi
}

# Newest KEEP releases stay, plus whatever current points at: a rollback target must not disappear.
function prune() {
	local current name index=0
	current=$(current_release || true)
	while read -r name; do
		index=$((index + 1))
		if [[ $name == "$current" ]] || ((index <= KEEP)); then
			continue
		fi
		rm -rf "${RELEASES:?}/$name"
		log "removed old release $name"
	done < <(release_names)
}

function command_release() {
	local name=${1:-} sha=${2:-} subject=${3:-}
	[[ -n $name ]] || die "usage: backend.sh $MODE release <name> <sha> [subject]"
	refuse_inside_server_unit
	require_service
	local incoming=$INCOMING/$name dir=$RELEASES/$name previous
	[[ -d $incoming ]] || die "nothing to publish at $incoming"
	[[ ! -e $dir ]] || die "release $name already exists"
	ensure_bun
	ensure_zellij
	mkdir -p "$RELEASES"
	mv "$incoming" "$dir"
	# Before anything can start it: the release says which commit it is, for `server.status` and the deep health check.
	write_release_json "$dir" "$name" "$sha" "$subject"
	log "release $name: bun install --frozen-lockfile"
	if ! (cd "$dir" && "$BUN" install --frozen-lockfile); then
		write_deploy_status failed "$sha" "$subject" "bun install failed for $name"
		die "bun install failed for $name"
	fi

	previous=$(current_release || true)
	if ! require_safe_release "$name"; then
		write_deploy_status failed "$sha" "$subject" "release $name refused: required auth compatibility could not be verified"
		return 1
	fi
	install_unit
	switch_current "$name"
	if restart_and_verify "$name"; then
		log "deployed $name (${sha:0:12})${subject:+ — $subject}"
		write_deploy_status ok "$sha" "$subject"
		prune
		return 0
	fi
	if [[ -z $previous ]]; then
		log "no earlier release to roll back to; the server stays on $name and is not answering"
		write_deploy_status failed "$sha" "$subject" "$name failed its health check and there is no earlier release"
		return 1
	fi
	if ! require_safe_release "$previous"; then
		write_deploy_status failed "$sha" "$subject" "$name failed; rollback to $previous refused: required auth compatibility could not be verified"
		return 1
	fi
	log "rolling back to $previous"
	install_unit
	switch_current "$previous"
	if restart_and_verify "$previous"; then
		log "rolled back to $previous; $name is kept for inspection but is not deployed"
		write_deploy_status rolled_back "$sha" "$subject" "$name failed its health check; $previous is running"
	else
		log "rollback to $previous failed too; the server is down"
		write_deploy_status failed "$sha" "$subject" "$name failed its health check and so did the rollback to $previous"
	fi
	return 1
}

# deploy.sh found that <sha> changes nothing this backend runs (only the app, docs and such since the running release),
# so nothing is published and nothing restarts: a light hello says the server is up, and the attempt is recorded as ok
# with `backendUnchanged`, so the app does not mistake the older running release for a stale one. A server that does
# not answer fails this, and deploy.sh then publishes and restarts as usual.
function command_unchanged() {
	local sha=${1:-} subject=${2:-} output
	[[ -n $sha ]] || die "usage: backend.sh $MODE unchanged <sha> [subject]"
	require_service
	if ! output=$(command_health 5000 2>&1); then
		log "not answering, so not leaving it as it is: $output"
		return 1
	fi
	log "unchanged, not restarted: $output"
	write_deploy_status ok "$sha" "$subject" "" --backend-unchanged
}

function command_rollback() {
	local current target commit subject
	refuse_inside_server_unit
	require_service
	current=$(current_release || true)
	[[ -n $current ]] || die "nothing is deployed yet (no current symlink)"
	target=${1:-}
	if [[ -z $target ]]; then
		target=$(release_before "$current") || die "no release before $current to roll back to"
	fi
	[[ -d $RELEASES/$target ]] || die "no release $target"
	if ! require_safe_release "$target"; then
		commit=$(release_field "$RELEASES/$current" commit)
		write_deploy_status failed "${commit:-unknown}" "" "rollback to $target refused: required auth compatibility could not be verified"
		return 1
	fi
	log "rolling back $current -> $target"
	install_unit
	switch_current "$target"
	if restart_and_verify "$target"; then
		log "rolled back to $target"
		# A hand rollback is not a deploy attempt, but it does move what runs: say so instead of leaving a stale `ok`.
		commit=$(release_field "$RELEASES/$target" commit)
		subject=$(release_field "$RELEASES/$target" description)
		if [[ -n $commit ]]; then
			write_deploy_status rolled_back "$commit" "$subject" "rolled back by hand from $current to $target"
		else
			log "$target has no RELEASE.json; not recording the hand rollback in $STATUS"
		fi
		return 0
	fi
	if ! require_safe_release "$current"; then
		commit=$(release_field "$RELEASES/$current" commit)
		write_deploy_status failed "${commit:-unknown}" "" "restore to $current refused: required auth compatibility could not be verified"
		return 1
	fi
	log "restoring $current"
	switch_current "$current"
	restart_and_verify "$current" || log "the server is down"
	return 1
}

function command_list() {
	local current target name
	current=$(current_release || true)
	target=""
	if [[ -n $current ]]; then target=$(release_before "$current" || true); fi
	while read -r name; do
		local marks=""
		[[ $name == "$current" ]] && marks="$marks current"
		[[ -n $target && $name == "$target" ]] && marks="$marks rollback-target"
		printf '%s%s\n' "$name" "$marks"
	done < <(release_names)
}

# The last attempt in one line, for `status`.
function status_summary() {
	if [[ ! -f $STATUS ]]; then
		printf 'none recorded (%s)' "$STATUS"
		return 0
	fi
	"$BUN" -e '
		try {
			const status = await Bun.file(process.argv[1]).json();
			const message = typeof status.message === "string" ? ` (${status.message})` : "";
			console.log(`${status.state} ${String(status.commit).slice(0, 12)} at ${status.at}${message}`);
		} catch {
			console.log("unreadable");
		}
	' "$STATUS" 2>/dev/null || printf 'unreadable'
}

function command_status() {
	log "mode: $MODE ($SERVICE)"
	log "current: $(current_release || echo none)"
	log "release: $(release_field "$CURRENT" name) $(release_field "$CURRENT" commit)"
	log "last attempt: $(status_summary)"
	if [[ $MODE == user ]]; then
		log "linger: $(loginctl show-user "$USER" --property=Linger --value 2>/dev/null || echo unknown)"
	fi
	if [[ $MODE == user ]]; then
		log "zellij: $("$HOME/.local/bin/zellij" --version 2>/dev/null || echo missing)"
	elif system_unit_has_zellij; then
		log "zellij: on the $SERVICE unit's PATH"
	else
		log "zellij: not on the $SERVICE unit's PATH (terminals will say so)"
	fi
	sc --no-pager status "$SERVICE" || true
	ss -ltnp 2>/dev/null | grep -F ":$PORT " || log "nothing listening on port $PORT"
}

function command_health() {
	health "http://127.0.0.1:$PORT" "--timeout-ms=${1:-5000}"
}

# For a target reached over an unreliable link (a laptop): DEPLOY_SURVIVE_DISCONNECT=1 makes release, unchanged and
# rollback finish when the ssh session that started them drops. Without it the next log line would be a write to a closed
# pipe: SIGPIPE ends the script after `current` moved and before the health check, which is the one moment a rollback
# is needed. So SIGHUP and SIGPIPE are ignored, the output goes through a `tee` that keeps writing to its file when
# the pipe is gone (`last-deploy.log` in the deploy root, the last run only), and a second run waits out the first by
# refusing (a lock) instead of racing it.
function survive_disconnect() {
	trap '' HUP PIPE
	mkdir -p "$ROOT"
	exec 8>"$ROOT/.backend.lock"
	if ! flock -n 8; then
		log "another backend.sh is still running here (lock $ROOT/.backend.lock); not starting a second"
		exit 75
	fi
	exec > >(exec tee --output-error=warn-nopipe "$ROOT/last-deploy.log" 2>/dev/null) 2>&1
}
case ${1:-} in
release | unchanged | rollback)
	if [[ ${DEPLOY_SURVIVE_DISCONNECT:-} == 1 ]]; then survive_disconnect; fi
	;;
esac

case ${1:-} in
release) shift && command_release "$@" ;;
unchanged) shift && command_unchanged "$@" ;;
rollback) shift && command_rollback "$@" ;;
list) command_list ;;
status) command_status ;;
health) shift && command_health "$@" ;;
*) die "usage: backend.sh $MODE release|unchanged|rollback|list|status|health" ;;
esac
