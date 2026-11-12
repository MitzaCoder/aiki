# Install Aiki with a coding agent

Follow these steps in order. Report each check without copying credentials or pairing
links into chat. Linux is tested; macOS and Windows inside WSL are experimental.
Use the published **`v0.1.0-pilot.1` prerelease**. Step 3 also provides a
source-checkout fallback. Do not use `/latest`: GitHub excludes prereleases from it.

## 1. Establish boundaries

- Never use sudo, replace a global Bun, modify shell profiles, enable linger, or
  install a service without asking. Use `--no-service` on every installation.
- Keep the backend on `127.0.0.1`. Do not forward its port, change its bind address,
  disable device authentication, or configure a tunnel as part of local setup.
- Never import another backend's data, environment file or credentials. Never paste
  API keys, provider tokens, pairing URLs/codes or credential files into chat,
  screenshots or logs. Aiki runs tools as the human's user, not in a sandbox.
- Stop on a failed command. Do not bypass checksums or overwrite an existing
  launcher, service or unmanaged directory. Ask before removing anything.

## 2. Preflight

1. Run `uname -s` and `uname -m`. Accept Linux or Darwin, x86_64/amd64 or
   aarch64/arm64 only. On Windows, run inside WSL, not PowerShell. Explain the
   experimental status on macOS/WSL before proceeding.
2. Check `command -v curl tar unzip git` and either `command -v sha256sum` or
   `command -v shasum`. Ask the human to supply missing utilities; do not use a
   system package manager without permission. Git is mandatory for the source path
   and project operations. Recommend jj for isolated workers; Tailscale is only
   needed later for phone access. No preinstalled Bun is required: the installer
   downloads private pinned Bun 1.4.4 and zellij 0.45.1 without changing global tools.
3. Work in a new user-owned scratch directory, not a project or an existing backend.
   Choose and record an absolute, empty install path and port:

   ```sh
   AIKI_ROOT="$HOME/aiki-local"
   AIKI_PORT=7317
   export AIKI_PORT
   printf 'Install: %s\nData: %s/data\nConfig: %s/config\nLauncher: %s/.local/bin/aiki\nPort: %s\n' \
     "$AIKI_ROOT" "$AIKI_ROOT" "$AIKI_ROOT" "$HOME" "$AIKI_PORT"
   df -h "$HOME" .
   ```

   Recommend at least 4 GiB free for downloads, dependencies and source build;
   this is a working allowance, not an installer-enforced minimum. Data and projects
   need additional space. If the path exists, inspect it; do not adopt unrelated
   contents. Check `$HOME/.local/bin/aiki` too: only one managed launcher can occupy
   that path. For an existing installation, use the update procedure below instead.
4. Check the port with the OS listener tool (Linux: `ss -ltn`; macOS:
   `lsof -nP -iTCP:7317 -sTCP:LISTEN`). No listener may occupy the selected port,
   including a wildcard listener. If occupied, choose another free port and set
   `AIKI_PORT` accordingly in every terminal. Never kill a process to reclaim it.
   If neither listener tool exists, ask for help checking it; a failed HTTP request
   alone does not prove the port is free. Recheck with `aiki doctor` after installing.

## 3. Install exactly one way

Keep these shell variables and the same HOME in subsequent commands. Both paths
use `--dir`, so data is `$AIKI_ROOT/data`, config is `$AIKI_ROOT/config`, and the
launcher is still `$HOME/.local/bin/aiki`. No shell profile is edited.

### Published prerelease (preferred)

Download into the empty scratch directory. Use bounded downloads:

```sh
AIKI_RELEASE_URL=https://github.com/MitzaCoder/aiki/releases/download/v0.1.0-pilot.1
curl --connect-timeout 15 --max-time 300 --retry 2 -fL "$AIKI_RELEASE_URL/install.sh" -o install.sh
curl --connect-timeout 15 --max-time 300 --retry 2 -fL "$AIKI_RELEASE_URL/install.sh.sha256" -o install.sh.sha256
sha256sum -c install.sh.sha256
# On macOS without sha256sum, use: shasum -a 256 -c install.sh.sha256
```

Require an `install.sh: OK` result. Read the downloaded `install.sh` before running
it. Checksums fetched over HTTPS detect corruption, not a compromised publisher.
The installer also fetches `aiki-v0.1.0-pilot.1.tar.gz` and its sibling `.sha256`,
compares SHA-256 before extraction, and verifies pinned Bun/zellij archive hashes.
Never skip a mismatch. Install with the explicit version:

```sh
sh install.sh --version v0.1.0-pilot.1 --dir "$AIKI_ROOT" --no-service
```

If downloads return 404, stop this path and check the version and asset names.
Use the following fallback if needed, not an unversioned installer or `/latest`.
Do not retry a checksum failure via another installation path.

### Source-checkout fallback

Resolve the public main commit once and record its full hash. Fetch that exact
commit and review its installer. The checkout is only for reading/running the
installer; `--ref` independently fetches a clean source tree from the public repo.
This path uses Git/HTTPS integrity, not release checksum files.

```sh
AIKI_REF=$(git ls-remote https://github.com/MitzaCoder/aiki.git refs/heads/main | awk '{print $1}')
test -n "$AIKI_REF"
printf 'Source commit: %s\n' "$AIKI_REF"
git init aiki-source
git -C aiki-source fetch --depth 1 https://github.com/MitzaCoder/aiki.git "$AIKI_REF"
git -C aiki-source checkout --detach FETCH_HEAD
# Read aiki-source/install.sh before running it.
sh aiki-source/install.sh --ref "$AIKI_REF" --dir "$AIKI_ROOT" --no-service
```

The installer runs `bun install --frozen-lockfile` in its fresh source workspace
using its private Bun, then builds the web app without personal backend suggestions.
Allow several minutes. Do not run npm, pnpm or a global Bun install as a workaround.

## 4. Start and verify locally

```sh
export PATH="$HOME/.local/bin:$PATH"
aiki version
aiki doctor
```

Check the printed data/config paths match step 2 and `Port 7317: free` (or your
chosen port). Missing jj prevents isolated workers, not local chat. A failed zellij
download leaves app terminals unavailable; re-run the same installer to retry.

In a terminal the human can keep open:

```sh
aiki start
```

This stays in the foreground; it does not open a browser. Verify the startup data
and config paths before proceeding. In another terminal, with the same HOME, PATH
and `AIKI_PORT`:

```sh
aiki status
curl --connect-timeout 5 --max-time 10 -fS "http://127.0.0.1:$AIKI_PORT/aiki-local.json"
aiki open
```

Require `Running at http://127.0.0.1:7317; selected release ...` and
`{"local":true}`. This is the installed CLI's local discovery/liveness URL, not a
model-inference or authenticated protocol health test; there is no `/health` endpoint.
Open the printed loopback URL and confirm the web Welcome/device-sign-in page loads.
For headless verification, use a fresh browser profile and wait for **Welcome to Aiki**
in the rendered DOM before taking a screenshot; an early HTML response or fixed
virtual-time screenshot can capture the blank shell before hydration.
If no graphical browser is available, `AIKI_NO_BROWSER=1 aiki open` prints only;
tell the human to open it in a browser on the same machine. Do not publish a port
just to make browser automation possible.

For an unattended rehearsal only, after confirming the installation is disposable,
use a detached process with stdin closed and a bounded readiness check:

```sh
setsid -f sh -c 'echo $$ > "$1"; exec "$2" start' sh \
  "$AIKI_ROOT/rehearsal.pid" "$HOME/.local/bin/aiki" \
  < /dev/null > "$AIKI_ROOT/start.log" 2>&1
curl --connect-timeout 2 --max-time 2 --retry 20 --retry-connrefused --retry-delay 1 \
  "http://127.0.0.1:$AIKI_PORT/aiki-local.json"
aiki status
```

Stop only that recorded PID with `kill -TERM "$(< "$AIKI_ROOT/rehearsal.pid")"`
(in bash), after verifying it matches `$AIKI_ROOT/server.pid`. Never use `pkill`,
`killall`, a port-owner kill, or a real backend/service to manage the rehearsal.

## 5. STOP: let the human authorize access

Do not run `aiki pair` in captured tool output. Ask the human to run it privately
in another terminal while Aiki runs, open its one-time URL in the same browser,
confirm full owner access, then choose **Open Aiki**. The URL/code expires after ten
minutes; generating another cancels the unused earlier grant. Do not disable auth
if it expires. Every paired device has full owner access, not a limited guest role.
A first-run screenshot may show Welcome, but must not contain a pairing grant.

Then **STOP at each of these boundaries**; do not infer consent from permission to
install:

1. **Provider sign-in:** ask the human to open Settings and connect their model
   provider with a supported subscription login or API key. The human enters all
   secrets directly. Aiki uses pi-ai, not Claude Code/Codex CLI credentials;
   subscription eligibility and provider policy apply, and usage may cost money.
   Do not claim inference works just because a credential was saved.
2. **Project folder:** ask the human which folder to add, explain that agents can
   read/write it and run commands with their permissions, and let them add it in
   the web app and choose its coordinator model. Do not scan/import home folders,
   create a real project, or launch a model run without permission.
3. **Optional Linux user service:** ask whether they want login-time startup. Do
   not install it by default. After explicit consent, stop the foreground process
   with Ctrl-C, preview with `aiki service install --print`, then run
   `aiki service install` and verify `aiki status`. This manages only
   `aiki-local.service`, never the separate deployment service. No sudo or linger.
   If a user systemd session is unavailable, keep using foreground mode. macOS
   launch-agent support exists but remains experimental; ask separately before use.
4. **Optional phone pairing:** ask separately about HTTPS/network setup and the
   signed Android APK. The phone needs this backend reachable over HTTPS, for
   example through an explicitly authorized Tailscale setup. `aiki pair` emits a
   loopback first-device link, not a phone tunnel. Do not send that loopback link
   to a phone or expose the backend on all interfaces. Follow the app's assisted
   remote setup only with the human; no independent-user phone push in this pilot.

At a STOP, report what is installed/running, the non-secret local URL and the next
human action. Pause until they reply. A disposable rehearsal ends at Welcome;
provider, project, service and phone steps are not automatic acceptance tests.

## 6. Update or uninstall only when asked

Stop the foreground process (Ctrl-C), or remove the authorized local service with
`aiki service remove`. Back up `$AIKI_ROOT/data` and `$AIKI_ROOT/config` while stopped,
and project repositories separately. Protect backups like secrets.

```sh
aiki update
# Or select an exact reviewed tag with: aiki update --version TAG
# Source installs can instead select a newly reviewed exact public commit:
aiki update --ref FULL_COMMIT_HASH
aiki start
# In another terminal:
aiki status
```

Select only one update command. Updates follow the saved pilot/stable channel; `--channel pilot|stable`
switches it, and `--version TAG` wins. Older installers need one exact-tag update to gain channel support.
Settings → About has release notes and a backend-wide daily-check switch. No source-checkout notices by default.
Updates do not restart the server. `aiki rollback` selects the
retained previous code release while stopped, but does not undo database migrations;
read release notes before downgrading. There is no automatic health rollback.

Use the reviewed external installer from step 3 for removal, with the same `--dir`.
For a source checkout its path is `aiki-source/install.sh` instead of `install.sh`:

```sh
sh install.sh --dir "$AIKI_ROOT" --uninstall
# Only with separate, explicit approval to delete conversations and credentials:
sh install.sh --dir "$AIKI_ROOT" --uninstall --purge
```

These are alternatives: an ordinary uninstall removes the runtime needed to run
purge, so reinstall before a later purge. Ordinary uninstall retains data/config
and ownership metadata; purge deletes data/config permanently. Neither deletes
project repositories. Do not delete the scratch/install directories until the
human has decided what to retain.

## Troubleshooting

Installer/CLI errors below are literal (paths, port and tool names may vary).
Do not paste surrounding secret output into a report.

| Message | Action |
| --- | --- |
| `curl: (22) The requested URL returned error: 404` | Check the version and asset names. Use the source fallback if needed. |
| `aiki: Install unzip and re-run this installer` | Ask for the named bootstrap utility; similarly for curl/tar. |
| `aiki: Install sha256sum or shasum to verify downloads` | Supply a checksum utility; never skip verification. |
| `aiki: Bun checksum mismatch; nothing activated` / `aiki: Aiki archive checksum mismatch; nothing activated` / `aiki: zellij checksum mismatch` | Stop; retry only on a trusted connection. Do not bypass hashes. |
| `aiki: Private Bun could not run or has the wrong version; see docs/INSTALL.md` | Check OS/architecture/libc compatibility. Do not replace global Bun. |
| `aiki: Directory is not an Aiki-managed installation; choose an empty --dir` | Choose an empty user-owned absolute path, not existing backend state. |
| `aiki: Another launcher exists at ~/.local/bin/aiki; refusing to overwrite it` | Inspect the existing installation with the human; do not overwrite it. |
| `aiki: Another install is running (or a stale .install-lock remains)` | Confirm no installer is running before asking to remove a stale lock. |
| `Not responding at http://127.0.0.1:7317. Run aiki start or inspect your user service.` | Check the matching foreground terminal/log, paths and port. Status exits nonzero. |
| `Port 7317: in use; aiki status checks whether it is Aiki. Set AIKI_PORT for another port.` | Pick a free port before start; pass it to every command or, with permission, set it in `$AIKI_ROOT/config/server.env`. |
| `aiki: AIKI_PORT must be 1–65535` | Choose a decimal port in range. |
| `aiki: Aiki is running. Stop the foreground process (Ctrl-C) or your user service before changing releases.` | Stop the correct installation before start/update/rollback/service installation. |
| `aiki: server.pid already exists. If a previous process crashed, confirm it is stopped before removing this stale file.` | Verify the recorded PID is stopped; ask before removing the file. |
| `aiki: No systemctl user service manager. Continue with aiki start.` | Use foreground mode; do not create a system service. |
| `aiki: Another local Aiki service exists; refusing to overwrite/remove it` | Ask the human to identify the existing service. |
| `aiki: No previous release retained` | No code rollback is available; do not downgrade data blindly. |

For Welcome requiring device sign-in, follow step 5. For provider failures, let the
human check eligibility or try an API key; never request their secret in chat.
See [INSTALL.md](INSTALL.md) for paths and experimental macOS checks.
