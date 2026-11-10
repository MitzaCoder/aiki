#!/usr/bin/env bash
# Sourced by deploy.sh. Env files are private, stable installation config, never archived release contents.
# Missing sources mean a fresh installation using normal AIKI defaults. No file contents are logged.
function install_host_env() {
	HOST_ENV_CHANGED=0
	local source=${DEPLOY_HOST_ENV_FILE:-$DEPLOY_CONFIG_DIR/server-host.env}
	[[ -f $source ]] || return 0
	local destination=${DEPLOY_HOST_ENV_DEST:-${XDG_CONFIG_HOME:-$HOME/.config}/aiki/server.env} temporary
	if ! cmp -s "$source" "$destination"; then HOST_ENV_CHANGED=1; fi
	mkdir -p "$(dirname "$destination")" || return 1
	temporary=$(mktemp "${destination}.XXXXXX") || return 1
	if install -m 0600 "$source" "$temporary" && mv -f "$temporary" "$destination"; then return 0; fi
	rm -f "$temporary"
	return 1
}

function install_target_env() {
	TARGET_ENV_CHANGED=0
	local prefix=DEPLOY_${T_NAME^^}
	prefix=${prefix//-/_}
	local file_variable=${prefix}_ENV_FILE destination_variable=${prefix}_ENV_DEST
	local source=${!file_variable:-$DEPLOY_CONFIG_DIR/server-$T_NAME.env}
	[[ -f $source ]] || return 0
	# The default's HOME is expanded by the remote shell, not on the deploying host.
	local destination=${!destination_variable:-'${XDG_CONFIG_HOME:-$HOME/.config}/aiki/server.env'}
	local previous current
	current=$(sha256sum <"$source") || return 1
	previous=$(tssh "if [[ -f \"$destination\" ]]; then sha256sum <\"$destination\"; fi") || return 1
	if [[ $previous != "$current" ]]; then TARGET_ENV_CHANGED=1; fi
	tssh "umask 077 && mkdir -p \"\$(dirname \"$destination\")\" && tmp=\$(mktemp \"$destination.XXXXXX\") && cat >\"\$tmp\" && mv -f \"\$tmp\" \"$destination\"" <"$source"
}
