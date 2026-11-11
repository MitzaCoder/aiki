#!/usr/bin/env bash
# Additive, origin-side observation only. Never wait for journaling, never inherit the deploy lock.
# Missing tooling, full disks, lock contention, stale status, or a hung observer cannot affect deployment.
JOURNAL_BASE=$(( $(date +%s%3N) * 1000 ))
JOURNAL_ID="attempt-$JOURNAL_BASE-$$"
JOURNAL_INDEX=0
# Snapshot existing local metadata before any publish. Parsing/writing stays off the critical path.
JOURNAL_HOST_STATUS=$(<"$HOST_ROOT/deploy-status.json") 2>/dev/null || JOURNAL_HOST_STATUS=""
JOURNAL_HOST_RELEASE=$(<"$HOST_ROOT/current/RELEASE.json") 2>/dev/null || JOURNAL_HOST_RELEASE=""
JOURNAL_HOST_BASELINE=$(printf '%s\n---\n%s' "$JOURNAL_HOST_RELEASE" "$JOURNAL_HOST_STATUS")
JOURNAL_NAMES=""
if ((!PARTIAL)); then JOURNAL_NAMES="web,host"; fi
for journal_index in "${ACTIVE[@]}"; do
	JOURNAL_NAMES+="${JOURNAL_NAMES:+,}${TARGET_NAMES[journal_index]}"
done

function journal_event() { # target state [previous] [local-root | remote]
	JOURNAL_INDEX=$((JOURNAL_INDEX + 1))
	local sequence=$((JOURNAL_BASE + JOURNAL_INDEX)) target=${1:-} state=${2:-queued} previous=${3:-} source=${4:-}
	(
		exec 9>&-
		local status=""
		if [[ $source == remote ]]; then
			# An additional read runs ONLY in this disposable observer, never in the deploy path.
			status=$(timeout 2s ssh "${SSH_OPTS[@]}" "$T_SSH" "$(remote_command "cat $REMOTE_ROOT/current/RELEASE.json 2>/dev/null; printf '\n---\n'; cat $REMOTE_ROOT/deploy-status.json 2>/dev/null")") || status=""
		elif [[ -n $source ]]; then
			status=$(printf '%s\n---\n%s' "$(<"$source/current/RELEASE.json")" "$(<"$source/deploy-status.json")") || status=""
		fi
		# Its own lock; never a deploy lock. Both acquiring it and running the writer are bounded.
		timeout 3s flock -w 1 "$STATE_DIR/deploy-journal.lock" "$BUN" run "$REPO_DIR/deploy/deploy-journal.ts" \
			"$STATE_DIR/deploy-journal.json" "$REPO_DIR" "$JOURNAL_ID" "$sequence" "$SHA" "$JOURNAL_NAMES" "$PARTIAL" "$target" "$state" "$previous" "$status" "$JOURNAL_HOST_BASELINE"
	) >/dev/null 2>&1 </dev/null &
	return 0
}
