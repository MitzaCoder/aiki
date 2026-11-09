#!/usr/bin/env bash
# The app half of a deploy. Runs on this host, where Caddy serves /var/lib/mihai-harness-web/current.
#
#   web.sh release <name> <build-dir>   publish a built SPA, point current at it, verify the files (roll back on failure)
#   web.sh rollback [<name>]            switch back to <name> (default: the release before current)
#   web.sh list                         releases, newest first, with current and rollback target marked
#   web.sh status                       current release and what it contains
#
# The directory is created and owned by the deploying user through nix-config. deploy/deploy.sh skips this step, with a log line, while
# it does not exist yet.
set -euo pipefail

ROOT=${MIHAI_HARNESS_WEB_ROOT:-/var/lib/mihai-harness-web}
RELEASES=$ROOT/releases
CURRENT=$ROOT/current
KEEP=${DEPLOY_KEEP_RELEASES:-5}

function log() { printf '%s [deploy:web] %s\n' "$(date -Is)" "$*"; }
function die() { log "ERROR: $*"; exit 1; }

function current_release() {
	if [[ -L $CURRENT ]]; then basename "$(readlink "$CURRENT")"; fi
}

function release_names() {
	[[ -d $RELEASES ]] || return 0
	find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r
}

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

function switch_current() {
	local name=$1
	[[ -d $RELEASES/$name ]] || die "no release $name"
	pushd "$RELEASES" >/dev/null
	ln -sfn "releases/$name" "$CURRENT.tmp"
	mv -T "$CURRENT.tmp" "$CURRENT"
	popd >/dev/null
	log "current -> $name"
}

# The app is static: prove the fallback page and immutable assets are in place. Caddy does the rest.
function verify() {
	local label=$1
	[[ -f $CURRENT/200.html ]] || { log "$label has no 200.html"; return 1; }
	[[ -d $CURRENT/_app ]] || { log "$label has no _app directory"; return 1; }
	find "$CURRENT/_app" -type f -print -quit | grep -q . || { log "$label has no built assets"; return 1; }
	# Public routes come out as real files beside the fallback, so a direct visit works even without the fallback.
	[[ -f $CURRENT/connect.html ]] || log "note: $label has no connect.html; /connect relies on the SPA fallback"
	if [[ -f $CURRENT/backends.json ]]; then
		log "$label publishes a backend list: $(tr -d '\n\t' <"$CURRENT/backends.json" | cut -c1-120)"
	else
		log "$label publishes no backend list (backends.json absent); the app suggests none"
	fi
	log "verified $label: 200.html and _app assets present"
	return 0
}

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
	local name=${1:-} build=${2:-}
	[[ -n $name && -n $build ]] || die "usage: web.sh release <name> <build-dir>"
	[[ -d $build ]] || die "no build directory at $build"
	[[ -f $build/200.html ]] || die "$build has no 200.html; run the web build first"
	[[ -d $ROOT ]] || die "$ROOT does not exist; nix-config creates it for the deploying user"
	[[ -w $ROOT ]] || die "$ROOT is not writable by $(id -un)"
	[[ ! -e $RELEASES/$name ]] || die "release $name already exists"
	mkdir -p "$RELEASES"
	local tmp=$RELEASES/.$name.tmp.$$ previous
	rm -rf "$tmp"
	mkdir -p "$tmp"
	if ! cp -a "$build/." "$tmp/"; then
		rm -rf "$tmp"
		die "copying $build failed"
	fi
	mv "$tmp" "$RELEASES/$name" || die "could not publish $RELEASES/$name"
	previous=$(current_release || true)
	switch_current "$name"
	if verify "$name"; then
		log "deployed app $name"
		prune
		return 0
	fi
	if [[ -n $previous ]]; then
		log "rolling back to $previous"
		switch_current "$previous"
		verify "$previous" || log "WARNING: $previous does not verify either"
	else
		log "no earlier app release to roll back to"
	fi
	return 1
}

function command_rollback() {
	local current target
	current=$(current_release || true)
	[[ -n $current ]] || die "nothing is deployed yet (no current symlink)"
	target=${1:-}
	if [[ -z $target ]]; then
		target=$(release_before "$current") || die "no release before $current to roll back to"
	fi
	[[ -d $RELEASES/$target ]] || die "no release $target"
	log "rolling back app $current -> $target"
	switch_current "$target"
	if verify "$target"; then
		log "rolled back app to $target"
		return 0
	fi
	log "restoring $current"
	switch_current "$current"
	verify "$current" || log "WARNING: the app is not verified"
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

function command_status() {
	log "root: $ROOT"
	log "current: $(current_release || echo none)"
	if [[ -L $CURRENT ]]; then
		du -sh "$CURRENT" 2>/dev/null || true
		ls "$CURRENT/200.html" >/dev/null 2>&1 && log "200.html: present" || log "200.html: missing"
	fi
}

case ${1:-} in
release) shift && command_release "$@" ;;
rollback) shift && command_rollback "$@" ;;
list) command_list ;;
status) command_status ;;
*) die "usage: web.sh release|rollback|list|status" ;;
esac
