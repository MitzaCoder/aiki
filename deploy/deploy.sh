#!/usr/bin/env bash
# Deploy one commit of this repository to every piece of the harness:
#   - the web app, to /var/lib/aiki-web/releases/<name> with a current symlink (Caddy serves it),
#   - the backend on this host, under ~/.local/share/aiki-deploy/ (system service from nix-config),
#   - the backend on each remote target of deploy/targets.json, under the same layout there: the remote VM (remote user
#     service) and the Laptop laptop (system service from nix-config, intermittent: see below).
#
#   deploy/deploy.sh                 # deploy refs/heads/main
#   deploy/deploy.sh <git rev>       # deploy any commit-ish (a sha, or another ref)
#   deploy/deploy.sh --only=laptop      # just that remote target (repeatable); no app, no host backend
#   deploy/deploy.sh --catch-up      # what the watcher runs: bring the pending intermittent targets up to main
#
# What it does, in order:
#   1. materialises the commit with `git archive` (never the working copy),
#   2. runs `bun test`, `bun run typecheck`, the web check and the web build on that tree once, and stops if any fails —
#      recording the failed attempt in each backend's deploy root first, so the app can show it,
#   3. publishes the built app to the app root, with rollback if the files do not verify,
#   4. ships the tree to this host's backend and the VM's, and lets deploy/backend.sh publish, drain the backend (new
#      tool calls wait) until no tool call executes, restart, health-check deeply and roll back each one independently — unless nothing that backend runs
#      changed since the commit it runs (`git diff` against its current/RELEASE.json touches only the app, docs and the
#      like): then it only gets the new tooling, a hello and an ok record with `backendUnchanged`, and is not restarted.
#
# A target that fails does not stop the others: the deploy reports every failure at the end and exits non-zero. The host
# app and backend steps skip with a log line while nix-config has not created their directory and unit yet.
#
# An intermittent target (`"optional": true` in targets.json: a laptop that is often asleep or away) gets a quick ssh
# probe first. No answer means it is skipped, not failed: a log line, and a "pending" file under
# $XDG_STATE_HOME/aiki-deploy/pending/<name>.json that the watcher's catch-up reads. The deploy still exits 0 for it.
# One that answered the probe and then fails is a real failure, except that a step failing while the target no longer
# answers is taken for the laptop going away (pending again). Its backend.sh runs detached from the ssh session
# (DEPLOY_SURVIVE_DISCONNECT), so a dropped connection cannot stop it between the switch and the health check; it ends
# on its own with ok or a rollback.
#
# Catch-up (`--catch-up`): for each pending target, one ssh reads its current/RELEASE.json and deploy-status.json. Not
# answering stays pending, silently. Already on the commit (or recorded ok for it, or already failed or rolled back for
# it) clears the pending file. Behind gets the commit, that target only, without the app and the host backend; the
# checks are skipped when this host already ran them on that commit (a `verified/<sha>` marker the last full deploy
# left), else they run once. It never overlaps another deploy: it takes the same lock, and exits 75 when it is held.
#
# It refuses to run from inside the aiki unit's cgroup (a server tool): restarting the unit there kills the
# deploy after `current` moved, before the health check and the rollback. Move the `main` bookmark instead.
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
# Trusted, untracked machine configuration; never copied into an archived release.
export DEPLOY_CONFIG_DIR="${DEPLOY_CONFIG_DIR:-$REPO_DIR/deploy/local}"
if [[ -f $DEPLOY_CONFIG_DIR/config.env ]]; then source "$DEPLOY_CONFIG_DIR/config.env"; fi
# The web build runs inside an archive; retain the deploying checkout's optional published list.
export AIKI_WEB_ENV_FILE="${AIKI_WEB_ENV_FILE:-$DEPLOY_CONFIG_DIR/web.env}"
export AIKI_PUBLISHED_BACKENDS_FILE="${AIKI_PUBLISHED_BACKENDS_FILE:-$DEPLOY_CONFIG_DIR/backends.json}"
PORT=${DEPLOY_PORT:-7317}
BUN=${BUN:-bun}
KEEP=${DEPLOY_KEEP_RELEASES:-5}
APP_ROOT=${DEPLOY_APP_ROOT:-/var/lib/aiki-web}
HOST_ROOT=${DEPLOY_HOST_ROOT:-$HOME/.local/share/aiki-deploy}
HOST_SERVICE=${DEPLOY_HOST_SERVICE:-aiki.service}
STATE_DIR=${DEPLOY_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/aiki-deploy}
LOCK=$STATE_DIR/deploy.lock
# One file per intermittent target the last deploy skipped, and one marker per commit whose checks passed on this host.
PENDING_DIR=$STATE_DIR/pending
VERIFIED_DIR=$STATE_DIR/verified
STATUS_WRITER=$REPO_DIR/deploy/deploy-status.ts
CGROUP_FILE=${DEPLOY_CGROUP_FILE:-/proc/self/cgroup}
# Set by --catch-up: say nothing unless something has to be done.
QUIET=0

function log() { if ((QUIET)); then return 0; fi; printf '%s [deploy] %s\n' "$(date -Is)" "$*"; }
function die() { QUIET=0; log "ERROR: $*"; exit 1; }

# shellcheck source=deploy/targets.sh
source "$REPO_DIR/deploy/targets.sh"
source "$REPO_DIR/deploy/server-env.sh"

CATCH_UP=0
ONLY=()
REV=""
while (($# > 0)); do
	case $1 in
	--catch-up) CATCH_UP=1 ;;
	--only=*) ONLY+=("${1#*=}") ;;
	--only)
		ONLY+=("${2:-}")
		shift
		;;
	-*) die "unknown option $1 (--only=<target>, --catch-up)" ;;
	*) REV=$1 ;;
	esac
	shift
done
REV=${REV:-refs/heads/main}

# The harness server runs its tools inside its own cgroup, and `systemctl restart` takes that cgroup down: a deploy
# started from there dies after `current` moved, with no health check and no rollback. The watcher is not in the cgroup,
# so moving `main` is the road that works.
if [[ -r $CGROUP_FILE ]] && grep -Fq "${HOST_SERVICE%.service}.service" "$CGROUP_FILE"; then
	log "REFUSING to deploy from inside the aiki server's cgroup ($CGROUP_FILE names $HOST_SERVICE)."
	log "The restart would kill this deploy after current moved, before the health check and the rollback."
	log "Move the main bookmark instead: deploy/watch.sh deploys when it moves (README, Deploy)."
	exit 2
fi

FAILURES=0
SKIPPED=()
function failed() {
	log "FAILED: $*"
	FAILURES=$((FAILURES + 1))
}

load_targets
# The remote targets this run is about: all of them, or the ones --only names, or (--catch-up) the pending ones that are
# behind, settled below once the commit is known. PARTIAL leaves the app and the host backend alone.
ACTIVE=()
PARTIAL=0
if ((${#ONLY[@]} > 0 || CATCH_UP)); then PARTIAL=1; fi
for only in "${ONLY[@]}"; do
	target_index "$only" >/dev/null || die "unknown target $only (deploy/targets.json: ${TARGET_NAMES[*]})"
done
if ((CATCH_UP)); then
	QUIET=1
	for index in "${!TARGET_NAMES[@]}"; do
		if [[ -n ${TARGET_OPTIONALS[index]} && -f $PENDING_DIR/${TARGET_NAMES[index]}.json ]]; then ACTIVE+=("$index"); fi
	done
	# Nothing waits for a laptop: nothing to look at, and no lock to take from a deploy.
	((${#ACTIVE[@]} > 0)) || exit 0
else
	for index in "${!TARGET_NAMES[@]}"; do
		if ((${#ONLY[@]} == 0)) || [[ " ${ONLY[*]} " == *" ${TARGET_NAMES[index]} "* ]]; then ACTIVE+=("$index"); fi
	done
fi

# How the last attempt went, on each backend target, for `server.status.deploy` and the app. Written even when nothing
# was published, so the app can say that the commit never started instead of leaving the last `ok` standing.
function record_host_status() { # <state> <message>
	local state=$1 message=${2:-} output
	if [[ ! -d $HOST_ROOT ]] && ! systemctl cat "$HOST_SERVICE" >/dev/null 2>&1; then
		log "host backend: no deploy root at $HOST_ROOT; not recording the $state attempt there"
		return 0
	fi
	if output=$("$BUN" run "$STATUS_WRITER" "$state" "$SHA" "$SUBJECT" "$message" "--out=$HOST_ROOT/deploy-status.json" 2>&1); then
		log "host backend: $output"
	else
		log "WARNING: host backend: could not record the attempt: $output"
	fi
}

# On the current remote target (use_target).
function record_target_status() { # <state> <message>
	# --out=- prints the JSON here, so the target needs nothing of ours to record an attempt that never got that far.
	local state=$1 message=${2:-} json
	if ! json=$("$BUN" run "$STATUS_WRITER" "$state" "$SHA" "$SUBJECT" "$message" --out=- 2>&1); then
		log "WARNING: $T_LABEL backend: could not build the $state record: $json"
		return 0
	fi
	if printf '%s\n' "$json" | tssh \
		"mkdir -p $REMOTE_ROOT && umask 022 && tmp=\$(mktemp \"$REMOTE_ROOT/.deploy-status.XXXXXX\") && cat >\"\$tmp\" && mv -T \"\$tmp\" \"$REMOTE_ROOT/deploy-status.json\""; then
		log "$T_LABEL backend: recorded the $state attempt on $T_SSH"
	else
		log "WARNING: $T_LABEL backend: could not record the $state attempt on $T_SSH"
	fi
}

# An intermittent target that did not answer, or went away: not a failure. The watcher's catch-up reads the file.
function pending_set() { # <reason>
	mkdir -p "$PENDING_DIR"
	"$BUN" -e '
		const [file, name, commit, subject, reason] = process.argv.slice(1);
		let since = new Date().toISOString();
		try {
			const earlier = await Bun.file(file).json();
			if (typeof earlier.since === "string") since = earlier.since;
		} catch {}
		await Bun.write(file, `${JSON.stringify({ name, commit, subject, reason, since }, null, 2)}\n`);
	' "$PENDING_DIR/$T_NAME.json" "$T_NAME" "$SHA" "$SUBJECT" "$1" ||
		log "WARNING: $T_LABEL backend: could not write the pending file in $PENDING_DIR; it will not catch up by itself"
}

function pending_clear() { rm -f "$PENDING_DIR/$T_NAME.json"; }

TARGET_STATE=""
function skip_target() { # <reason>
	TARGET_STATE=skipped
	SKIPPED+=("$T_NAME")
	QUIET=0
	log "$T_LABEL backend: SKIPPED, $1; pending: it catches up to ${SHA:0:12} when it answers again (the watcher checks every ${DEPLOY_CATCHUP_SECONDS:-120}s)"
	pending_set "$1"
}

# A failure that leaves the target's release untouched. The target says why the commit did not start. A target that is
# intermittent and no longer answers did not fail: it went away.
function failed_target() { # <message>
	if [[ -n $T_OPTIONAL ]] && ! probe_target; then
		skip_target "it stopped answering ($1)"
		return 0
	fi
	TARGET_STATE=failed
	failed "$T_LABEL backend: $1"
	record_target_status failed "$1"
}

function failed_host() { # <message>
	failed "host backend: $1"
	record_host_status failed "$1"
}

# Checks or the build failed on the deploying host: nothing is published anywhere, and every backend target says so.
function checks_failed() { # <message>
	local index
	QUIET=0
	if ((!PARTIAL)); then record_host_status failed "$1"; fi
	for index in "${ACTIVE[@]}"; do
		use_target "$index"
		record_target_status failed "$1"
	done
	die "$1"
}

# The commit in a RELEASE.json on stdin; nothing when there is none or it does not parse.
function release_commit() {
	"$BUN" -e '
		try {
			const release = JSON.parse(await Bun.stdin.text());
			if (typeof release.commit === "string") console.log(release.commit);
		} catch {}
	' 2>/dev/null || true
}

# Whether a changed path can change what a running backend does. Everything can — the unit, the manifests, the lockfile,
# packages/ — except the app (published on its own), the Android app, docs/, Markdown files at the root, the deploy's
# tests, the deploy's own scripts directly in deploy/ (which go to tools/ on every deploy anyway) and its two lists of
# hosts, targets.json and backends.json (the first is read by deploy.sh, the second is built into the app).
function path_affects_backend() { # <path>
	local path=$1 rest
	case $path in
	apps/web/* | apps/android/* | docs/* | deploy/test/*) return 1 ;;
	esac
	# A case pattern's `*` crosses `/`, so "directly in" is a check that no `/` is left.
	if [[ $path == *.md && $path != */* ]]; then return 1; fi
	rest=${path#deploy/}
	if [[ $path == deploy/* && $rest != */* && ($rest == *.sh || $rest == *.ts || $rest == targets.json || $rest == backends.json) ]]; then return 1; fi
	return 0
}

# Whether a backend can keep running <running commit> for this deploy: true only when every path that changed between
# it and $SHA cannot affect the server. An unknown running commit, one this repository lacks, or a diff that fails all
# mean restart, as before this check existed.
function backend_unchanged() { # <label> <running commit>
	local label=$1 running=$2 changed path
	if [[ -z $running ]]; then
		log "$label: its running commit is unknown (no current/RELEASE.json); publishing and restarting"
		return 1
	fi
	if ! git rev-parse --verify --quiet "$running^{commit}" >/dev/null ||
		! changed=$(git diff --name-only --no-renames "$running" "$SHA" --); then
		log "$label: cannot compare its running ${running:0:12} with ${SHA:0:12}; publishing and restarting"
		return 1
	fi
	while IFS= read -r path; do
		[[ -n $path ]] || continue
		if path_affects_backend "$path"; then
			log "$label: $path changed since its running ${running:0:12}; publishing and restarting"
			return 1
		fi
	done <<<"$changed"
	log "$label: nothing it runs changed since ${running:0:12}; not publishing or restarting it"
	return 0
}

mkdir -p "$STATE_DIR"
# One deploy at a time: the watcher and a hand deploy must not interleave.
exec 9>"$LOCK"
if ((CATCH_UP)); then
	# A deploy is running: it settles the laptop itself or leaves it pending; the next round looks again.
	flock -n 9 || exit 75
else
	flock -n 9 || die "another deploy is running (lock $LOCK)"
fi

cd "$REPO_DIR"
SHA=$(git rev-parse --verify --quiet "$REV^{commit}") || die "cannot resolve $REV to a commit"
SUBJECT=$(git log -1 --format=%s "$SHA")
NAME=$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:7}

# What a target has: the commit it runs and how the last attempt there went, from one ssh. Prints
# "<running commit>|<last attempt's state>|<last attempt's commit>"; fails when the target does not answer.
function remote_deploy_state() {
	local output
	output=$(tssh "cat $REMOTE_ROOT/current/RELEASE.json 2>/dev/null; printf '\\n---\\n'; cat $REMOTE_ROOT/deploy-status.json 2>/dev/null; true") || return 1
	printf '%s' "$output" | "$BUN" -e '
		const [release, status] = (await Bun.stdin.text()).split("\n---");
		const parse = (text) => { try { return JSON.parse(text ?? "") ?? {}; } catch { return {}; } };
		const text = (value) => (typeof value === "string" ? value : "");
		const [r, s] = [parse(release), parse(status)];
		console.log(`${text(r.commit)}|${text(s.state)}|${text(s.commit)}`);
	'
}

# 2a. Catch-up: which pending targets answer, and which of those are behind.
if ((CATCH_UP)); then
	BEHIND=()
	declare -A RUNNING_AT=()
	for index in "${ACTIVE[@]}"; do
		use_target "$index"
		probe_target || continue
		state=$(remote_deploy_state) || continue
		IFS='|' read -r running_commit last_state last_commit <<<"$state"
		if [[ $running_commit == "$SHA" ]] || [[ $last_commit == "$SHA" && $last_state == ok ]]; then
			QUIET=0
			log "$T_LABEL backend: answers again and already has ${SHA:0:12}; no longer pending"
			pending_clear
		elif [[ $last_commit == "$SHA" && ($last_state == failed || $last_state == rolled_back) ]]; then
			QUIET=0
			log "$T_LABEL backend: the deploy of ${SHA:0:12} already $last_state there; not retrying it until main moves"
			pending_clear
		else
			BEHIND+=("$index")
			RUNNING_AT[$index]=$running_commit
		fi
	done
	((${#BEHIND[@]} > 0)) || exit 0
	ACTIVE=("${BEHIND[@]}")
	QUIET=0
	for index in "${ACTIVE[@]}"; do
		use_target "$index"
		log "$T_LABEL backend: answers again and runs ${RUNNING_AT[$index]:0:12}; catching up to ${SHA:0:12}"
		# While the checks run the app can say why this backend is behind (the earlier record, with a pending note).
		tssh "$(remote_bun) run $REMOTE_ROOT/tools/deploy-status.ts pending $SHA $(printf '%q' "$SUBJECT") $(printf '%q' "back online, deploying $SUBJECT") --out=$REMOTE_ROOT/deploy-status.json" >/dev/null 2>&1 ||
			log "WARNING: $T_LABEL backend: could not note the pending deploy there (its tooling is not there yet?)"
	done
fi

log "deploying $REV = ${SHA:0:12} ($SUBJECT) as $NAME"
if ((PARTIAL)); then
	only_names=""
	for index in "${ACTIVE[@]}"; do only_names+=" ${TARGET_NAMES[index]}"; done
	log "only:$only_names (no app, no host backend)"
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/aiki-deploy-check.XXXXXX")
function cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

# 1. The commit, exactly as committed: no working copy, no .jj, no node_modules.
git archive --format=tar "$SHA" | tar -x -C "$STAGE" || checks_failed "could not archive ${SHA:0:12}; not deploying"

# 2. Checks and the app build, on that tree, once for every target. A partial deploy (a laptop catching up) skips them
#    when this host already ran them on this commit: the last full deploy left a marker.
if ((PARTIAL)) && [[ -e $VERIFIED_DIR/$SHA ]]; then
	log "checks: already passed on this host for ${SHA:0:12}; not running them again"
else
	log "checking: bun install --frozen-lockfile"
	(cd "$STAGE" && "$BUN" install --frozen-lockfile) || checks_failed "bun install failed on ${SHA:0:12}; not deploying"
	log "checking: bun test"
	(cd "$STAGE" && "$BUN" test) || checks_failed "tests failed on ${SHA:0:12}; not deploying"
	log "checking: bun run typecheck"
	(cd "$STAGE" && "$BUN" run typecheck) || checks_failed "typecheck failed on ${SHA:0:12}; not deploying"
	log "checking: web check"
	(cd "$STAGE/apps/web" && "$BUN" run check) || checks_failed "web check failed on ${SHA:0:12}; not deploying"
	log "checking: web build"
	(cd "$STAGE/apps/web" && "$BUN" run build) || checks_failed "web build failed on ${SHA:0:12}; not deploying"
	log "checks passed"
	mkdir -p "$VERIFIED_DIR" && : >"$VERIFIED_DIR/$SHA"
	# Only the newest few markers are worth keeping.
	(cd "$VERIFIED_DIR" && ls -1t | tail -n +21 | while IFS= read -r old; do rm -f -- "$old"; done) || true
fi

# 3. The app: a static release on this host, served by Caddy.
if ((PARTIAL)); then
	:
elif [[ ! -d $APP_ROOT ]]; then
	log "app: $APP_ROOT does not exist yet (nix-config creates it); skipping app deploy"
elif AIKI_WEB_ROOT=$APP_ROOT DEPLOY_KEEP_RELEASES=$KEEP bash "$REPO_DIR/deploy/web.sh" release "$NAME" "$STAGE/apps/web/build"; then
	log "app: deployed $NAME"
else
	failed "app: $APP_ROOT was not updated"
fi

# 4. The backend on this host. Its system unit comes from nix-config, which is not applied yet on some machines.
function publish_host() {
	rm -rf "$HOST_ROOT/incoming/$NAME"
	if ! mkdir -p "$HOST_ROOT/incoming/$NAME"; then
		failed_host "cannot prepare incoming in $HOST_ROOT"
		return 0
	fi
	if ! git archive --format=tar "$SHA" | tar -x -C "$HOST_ROOT/incoming/$NAME"; then
		failed_host "sending the tree failed"
		return 0
	fi
	if AIKI_PORT=$PORT DEPLOY_KEEP_RELEASES=$KEEP \
		bash "$REPO_DIR/deploy/backend.sh" system release "$NAME" "$SHA" "$SUBJECT"; then
		log "host backend: deployed $NAME"
	else
		failed "host backend: did not end up healthy"
	fi
}

if ((PARTIAL)); then
	:
elif ! systemctl cat "$HOST_SERVICE" >/dev/null 2>&1; then
	log "host backend: $HOST_SERVICE is not installed (nix-config adds it); skipping host backend deploy"
else
	mkdir -p "$HOST_ROOT/tools" "$HOST_ROOT/incoming" || failed "host backend: cannot create $HOST_ROOT"
	# The tooling is updated whether or not the release changes, so the next rollback or status uses this deploy's copy.
	tar -c -C "$REPO_DIR/deploy" backend.sh health-check.ts deploy-status.ts | tar -x -C "$HOST_ROOT/tools" ||
		log "WARNING: host backend: could not update the tooling in $HOST_ROOT/tools"
	if ! install_host_env; then die "cannot install host server environment"; fi
	HOST_RUNNING=$(release_commit 2>/dev/null <"$HOST_ROOT/current/RELEASE.json") || HOST_RUNNING=""
	if ((HOST_ENV_CHANGED == 0)) && backend_unchanged "host backend" "$HOST_RUNNING" &&
		AIKI_PORT=$PORT bash "$REPO_DIR/deploy/backend.sh" system unchanged "$SHA" "$SUBJECT"; then
		log "host backend: still runs ${HOST_RUNNING:0:12}; recorded ${SHA:0:12} as deployed without a restart"
	else
		publish_host
	fi
fi

# 5. The backend on each remote target (use_target has chosen it). Sets TARGET_STATE: ok, failed or skipped.
#
# 5a. Every backend signs Web Push with the same VAPID key pair, because a browser holds one push subscription: this
#     host's key is the source of truth and the target gets a copy before it restarts. Warning only — a target without it
#     keeps whatever key it has, and the deploy is not about notifications. The server reads the key when it starts, so a
#     target that just received a new key is restarted even when its code did not change (vapid-key.sh says "copied" or
#     "replaced" then).
VAPID_CHANGED=0
function share_vapid_key() {
	local vapid_output
	VAPID_CHANGED=0
	if vapid_output=$(DEPLOY_SSH_OPTIONS="${SSH_OPTS[*]}" DEPLOY_SSH_SHELL=$T_SHELL bash "$REPO_DIR/deploy/vapid-key.sh" "$T_SSH"); then
		[[ -n $vapid_output ]] && printf '%s\n' "$vapid_output"
		if grep -q -e 'copied the key to' -e 'replaced the key on' <<<"$vapid_output"; then VAPID_CHANGED=1; fi
	else
		[[ -n $vapid_output ]] && printf '%s\n' "$vapid_output"
		log "WARNING: $T_LABEL backend: the VAPID key was not shared; push subscriptions on $T_LABEL will not verify"
	fi
}

function publish_target() {
	local prepare="rm -rf $REMOTE_ROOT/incoming/$NAME && mkdir -p $REMOTE_ROOT/incoming/$NAME"
	# A laptop that went away mid-copy leaves half a tree in incoming/: nothing there is worth keeping.
	if [[ -n $T_OPTIONAL ]]; then prepare="find $REMOTE_ROOT/incoming -mindepth 1 -maxdepth 1 -exec rm -rf {} + ; $prepare"; fi
	if ! tssh "$prepare"; then
		failed_target "cannot prepare the incoming directory on $T_SSH"
		return 0
	fi
	if ! git archive --format=tar "$SHA" | tssh "tar -x -C $REMOTE_ROOT/incoming/$NAME"; then
		failed_target "sending the tree to $T_SSH failed"
		return 0
	fi
	log "tree and tooling on $T_SSH; publishing there"
	if tssh "$(remote_backend_env)AIKI_PORT=$T_PORT DEPLOY_KEEP_RELEASES=$KEEP bash $REMOTE_ROOT/tools/backend.sh $T_UNIT release $NAME $SHA $(printf '%q' "$SUBJECT")"; then
		log "$T_LABEL backend: deployed $NAME"
		TARGET_STATE=ok
	elif [[ -n $T_OPTIONAL ]] && ! probe_target; then
		# backend.sh runs detached there, so it ends by itself (ok, or back on the old release); the next catch-up reads which.
		skip_target "it went away while publishing; backend.sh there finishes or rolls back without us"
	else
		failed "$T_LABEL backend: did not end up healthy"
	fi
}

function deploy_target() {
	local running tools=(backend.sh health-check.ts deploy-status.ts)
	TARGET_STATE=""
	if [[ -n $T_OPTIONAL ]] && ! probe_target; then
		skip_target "it did not answer ssh within ${PROBE_TIMEOUT_SECONDS}s"
		return 0
	fi
	share_vapid_key

	if ! tssh "mkdir -p $REMOTE_ROOT/tools $REMOTE_ROOT/incoming"; then
		if [[ -n $T_OPTIONAL ]] && ! probe_target; then
			skip_target "it stopped answering"
		else
			TARGET_STATE=failed
			failed "$T_LABEL backend: cannot reach $T_SSH"
		fi
		return 0
	fi
	# The tooling travels flat into tools/: the unit (a user unit's) and the health check must be there even for a commit
	# that does not contain deploy/, and whether or not the release changes.
	local tooling_ok=0
	if tar -c -C "$REPO_DIR/deploy" "${tools[@]}" | tssh "tar -x -C $REMOTE_ROOT/tools"; then tooling_ok=1; fi
	if [[ $T_UNIT == user && $tooling_ok == 1 ]]; then
		local unit_source=${DEPLOY_USER_UNIT_FILE:-$DEPLOY_CONFIG_DIR/aiki.service}
		if [[ ! -f $unit_source ]]; then unit_source=$REPO_DIR/deploy/systemd/aiki.service; fi
		tssh "cat > $REMOTE_ROOT/tools/aiki.service" <"$unit_source" || tooling_ok=0
	fi
	if ! install_target_env; then tooling_ok=0; fi
	if ((!tooling_ok)); then
		failed_target "sending tooling to $T_SSH failed"
		return 0
	fi
	running=$(tssh "cat $REMOTE_ROOT/current/RELEASE.json 2>/dev/null" | release_commit) || running=""
	if ((VAPID_CHANGED || TARGET_ENV_CHANGED)); then
		log "$T_LABEL backend: its notification key or server environment changed; publishing and restarting"
		publish_target
	elif backend_unchanged "$T_LABEL backend" "$running" &&
		tssh "$(remote_backend_env)AIKI_PORT=$T_PORT bash $REMOTE_ROOT/tools/backend.sh $T_UNIT unchanged $SHA $(printf '%q' "$SUBJECT")"; then
		log "$T_LABEL backend: still runs ${running:0:12}; recorded ${SHA:0:12} as deployed without a restart"
		TARGET_STATE=ok
	else
		publish_target
	fi
}

for index in "${ACTIVE[@]}"; do
	use_target "$index"
	deploy_target
	[[ $TARGET_STATE == ok ]] && pending_clear

	# 6. The tailnet is how devices reach the backend. This is a warning, not a rollback trigger: the release itself
	#    answered the hello there.
	if [[ -n $T_TAILNET && $TARGET_STATE == ok ]]; then
		if "$BUN" run "$REPO_DIR/deploy/health-check.ts" "http://$T_TAILNET:$T_PORT" --alive-only --timeout-ms=10000; then
			log "reachable from here over the tailnet: http://$T_TAILNET:$T_PORT"
		else
			log "WARNING: ${SHA:0:12} is deployed but http://$T_TAILNET:$T_PORT does not answer from here; the server probably binds 127.0.0.1 (AIKI_HOST=0.0.0.0 in the unit?)"
		fi
	fi
done

# Where to read what each server says.
LOGS="journalctl --user -u ${DEPLOY_WATCH_SERVICE:-aiki-deploy-watch.service}"
for index in "${ACTIVE[@]}"; do
	use_target "$index"
	if [[ $T_UNIT == user ]]; then
		LOGS+="; $T_LABEL server: ssh $T_SSH journalctl --user -u $T_SERVICE"
	else
		LOGS+="; $T_LABEL server: ssh $T_SSH journalctl -u $T_SERVICE"
	fi
done
if ((!PARTIAL)); then LOGS+="; host server: journalctl -u $HOST_SERVICE"; fi

if ((${#SKIPPED[@]} > 0)); then
	log "skipped, pending catch-up: ${SKIPPED[*]} (not a failure; list in $PENDING_DIR)"
fi
if ((FAILURES > 0)); then
	log "deploy of $NAME finished with $FAILURES failed target(s)"
	log "logs: $LOGS"
	exit 1
fi
if ((${#SKIPPED[@]} > 0)); then
	log "deployed $NAME (${SHA:0:12}) to every target that answered"
else
	log "deployed $NAME (${SHA:0:12}) to every configured target"
fi
log "logs: $LOGS"
log "roll back: deploy/rollback.sh [--target ${TARGET_NAMES[*]} host web]"
