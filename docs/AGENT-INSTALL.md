# Install Kemiri with a coding agent

Follow these steps in order. Report each check without copying credentials or pairing
links into chat. Linux is tested; macOS and Windows inside WSL are experimental.
Use the published prerelease pinned by `KEMIRI_VERSION` in step 2. Step 3 also
provides a forced Bun runtime and an exact-tag source-checkout fallback.
Do not use `/latest`: GitHub excludes prereleases from it.

Use only `kemiri` and `KEMIRI_*` on the installed release. Pilot.5 removed the old
command/process aliases; its own server.env is migrated once with an original .bak.
Pilot.3 and earlier users must update through pilot.4 (see step 6).

## 1. Establish boundaries

- Never use sudo, replace a global Bun, modify shell profiles, enable linger, or
  install a service without asking. Use `--no-service` on every installation.
- Keep the backend on `127.0.0.1`. Do not forward its port, change its bind address,
  disable device authentication, or configure a tunnel as part of local setup.
- Never import another backend's data, environment file or credentials. Never paste
  API keys, provider tokens, pairing URLs/codes or credential files into chat,
  screenshots or logs. Kemiri runs tools as the human's user, not in a sandbox.
- Stop on a failed command. Do not bypass checksums or overwrite an existing
  launcher, service or unmanaged directory. Ask before removing anything.

## 2. Preflight

1. Run `uname -s` and `uname -m`. Accept Linux or Darwin, x86_64/amd64 or
   aarch64/arm64 only. On Windows, run inside WSL, not PowerShell. Explain the
   experimental status on macOS/WSL before proceeding.
2. Check `command -v curl tar gzip git` and either `command -v sha256sum` or
   `command -v shasum`. Ask the human to supply missing utilities; do not use a
   system package manager without permission. Git is mandatory for the source path
   and project operations. Recommend jj for isolated workers; Tailscale is only
   needed later for phone access. No preinstalled Bun is required. With a matching release binary, the current
   installer needs neither Bun nor a dependency install. Older releases, macOS x64, Linux musl, source/ref/archive
   installs and `--runtime bun` use private pinned Bun 1.4.4; that fallback additionally needs `unzip`.
   Optional private zellij 0.45.1 does not replace global tools.
3. Work in a new user-owned scratch directory, not a project or an existing backend.
   Choose and record an absolute, empty install path and port:

   ```sh
   # Keep this pin in sync with site/install.sh; scripts/site.test.ts checks it.
   KEMIRI_VERSION=v0.1.0-pilot.5
   KEMIRI_ROOT="$HOME/kemiri-local"
   KEMIRI_PORT=7317
   export KEMIRI_PORT
   printf 'Install: %s\nData: %s/data\nConfig: %s/config\nLauncher: %s/.local/bin/kemiri\nPort: %s\n' \
     "$KEMIRI_ROOT" "$KEMIRI_ROOT" "$KEMIRI_ROOT" "$HOME" "$KEMIRI_PORT"
   df -h "$HOME" .
   ```

   Recommend at least 4 GiB free for downloads, dependencies and source build;
   this is a working allowance, not an installer-enforced minimum. Data and projects
   need additional space. If the path exists, inspect it; do not adopt unrelated
   contents. Check `$HOME/.local/bin/kemiri` too: only one managed launcher can occupy
   that path. For an existing installation, use the update procedure below instead.
4. Check the port with the OS listener tool (Linux: `ss -ltn`; macOS:
   `lsof -nP -iTCP:7317 -sTCP:LISTEN`). No listener may occupy the selected port,
   including a wildcard listener. If occupied, choose another free port and set
   `KEMIRI_PORT` accordingly in every terminal. Never kill a process to reclaim it.
   If neither listener tool exists, ask for help checking it; a failed HTTP request
   alone does not prove the port is free. Recheck with `kemiri doctor` after installing.

## 3. Install exactly one way

Keep these shell variables and the same HOME in subsequent commands. Both paths
use `--dir`, so data is `$KEMIRI_ROOT/data`, config is `$KEMIRI_ROOT/config`, and the
launcher is still `$HOME/.local/bin/kemiri`. No shell profile is edited.

### Published prerelease (preferred)

Download into the empty scratch directory. Use bounded downloads:

```sh
KEMIRI_RELEASE_URL=https://github.com/MitzaCoder/kemiri/releases/download/$KEMIRI_VERSION
curl --connect-timeout 15 --max-time 300 --retry 2 -fL "$KEMIRI_RELEASE_URL/install.sh" -o install.sh
curl --connect-timeout 15 --max-time 300 --retry 2 -fL "$KEMIRI_RELEASE_URL/install.sh.sha256" -o install.sh.sha256
sha256sum -c install.sh.sha256
# On macOS without sha256sum, use: shasum -a 256 -c install.sh.sha256
```

Require an `install.sh: OK` result. Read the downloaded `install.sh` before running
it. Checksums fetched over HTTPS detect corruption, not a compromised publisher.
This release prefers a standalone executable on Linux x64/arm64 and macOS arm64. The installer
requires its sidecar digest **and** matching
`SHA256SUMS` entry before running it. The Bun fallback fetches `kemiri-$KEMIRI_VERSION.tar.gz` (one `kemiri/` tree)
and its sibling `.sha256`, verifies them before extraction, and checks pinned Bun/zellij hashes.
A missing binary can select Bun; a download/checksum failure cannot.
Never skip a mismatch. Install with the explicit version:

```sh
sh install.sh --version "$KEMIRI_VERSION" --dir "$KEMIRI_ROOT" --no-service
```

To deliberately use the published source/private-Bun fallback on a supported binary
platform, choose this command **instead of** the preceding install command:

```sh
sh install.sh --version "$KEMIRI_VERSION" --runtime bun --dir "$KEMIRI_ROOT" --no-service
```

This verifies the release's source tarball and pinned private Bun, then installs
frozen dependencies. The release tarball already includes the neutral built web app;
no source build is needed. Do not force Bun after a checksum failure.

#### Domain alternative

The direct GitHub download above is preferred for an agent because you can inspect the full verified
installer before running it. The domain also serves a small bootstrap:

```sh
curl --connect-timeout 15 --max-time 300 --retry 2 -fL https://kemiri.dev/install.sh -o install-bootstrap.sh
# Read install-bootstrap.sh before running it.
sh install-bootstrap.sh --version "$KEMIRI_VERSION" --dir "$KEMIRI_ROOT" --no-service
```

Choose this **instead of** the direct installation, not in addition. It fetches the exact version's installer
and sidecar from GitHub Releases, requires a matching SHA-256, then forwards the same arguments.
Its default is the pinned pilot, and `--version latest` is refused. You review the bootstrap here; it executes
the checksum-verified release installer without a second review pause. If the human wants that pause,
use the direct GitHub path. Checksum failure is fatal; never retry through another path to evade it.
For later removal keep the reviewed bootstrap and substitute `install-bootstrap.sh` for `install.sh` below,
with the same explicit `--version "$KEMIRI_VERSION"`. See [SITE.md](SITE.md) for the trust model.

If downloads return 404, stop this path and check the version and asset names.
Use the following fallback if needed, not an unversioned installer or `/latest`.
Do not retry a checksum failure via another installation path.

### Source-checkout fallback

Resolve the selected release's annotated public tag once and record its full commit
hash. Do not substitute a moving main branch. Fetch that exact
commit and review its installer. The checkout is only for reading/running the
installer; `--ref` independently fetches a clean source tree from the public repo.
This path uses Git/HTTPS integrity, not release checksum files.

```sh
KEMIRI_REF=$(git ls-remote https://github.com/MitzaCoder/kemiri.git "refs/tags/$KEMIRI_VERSION^{}" | awk '{print $1}')
test -n "$KEMIRI_REF"
printf 'Source commit: %s\n' "$KEMIRI_REF"
git init kemiri-source
git -C kemiri-source fetch --depth 1 https://github.com/MitzaCoder/kemiri.git "$KEMIRI_REF"
git -C kemiri-source checkout --detach FETCH_HEAD
# Read kemiri-source/install.sh before running it.
sh kemiri-source/install.sh --ref "$KEMIRI_REF" --dir "$KEMIRI_ROOT" --no-service
```

The installer runs `bun install --frozen-lockfile` in its fresh source workspace
using its private Bun, then builds the web app without personal backend suggestions.
Allow several minutes. Do not run npm, pnpm or a global Bun install as a workaround.

## 4. Start and verify locally

```sh
export PATH="$HOME/.local/bin:$PATH"
kemiri version
kemiri doctor
```

Check the printed data/config paths match step 2 and `Port 7317: free` (or your
chosen port). Missing jj prevents isolated workers, not local chat. A failed zellij
download leaves app terminals unavailable; re-run the same installer to retry.

In a terminal the human can keep open:

```sh
kemiri start
```

This stays in the foreground as a supervisor with a child server; it does not open
a browser. Verify the startup data and config paths before proceeding. In another
terminal, with the same HOME, PATH and `KEMIRI_PORT`:

```sh
kemiri status
curl --connect-timeout 5 --max-time 10 -fS "http://127.0.0.1:$KEMIRI_PORT/aiki-local.json"
kemiri open
```

Require `Running at http://127.0.0.1:7317; selected release ...` and
`{"local":true}`. This is the installed CLI's local discovery/liveness URL, not a
model-inference or authenticated protocol health test; there is no `/health`
endpoint. The historical `/aiki-local.json`, `auth.sock`,
`.aiki-managed`, `.aiki-install.json`, `aiki-local.service` and macOS launch-agent
`io.github.mitzacoder.aiki.local` names remain internal in pilot.5; do not rename them.
Open the printed loopback URL and confirm the web Welcome/device-sign-in page loads.
For headless verification, use a fresh browser profile and wait for **Welcome to Kemiri**
in the rendered DOM before taking a screenshot; an early HTML response or fixed
virtual-time screenshot can capture the blank shell before hydration.
If no graphical browser is available, `KEMIRI_NO_BROWSER=1 kemiri open` prints only;
tell the human to open it in a browser on the same machine. Do not publish a port
just to make browser automation possible.

For an unattended rehearsal only, after confirming the installation is disposable,
use a detached process with stdin closed and a bounded readiness check:

```sh
setsid -f sh -c 'echo $$ > "$1"; exec "$2" start' sh \
  "$KEMIRI_ROOT/rehearsal.pid" "$HOME/.local/bin/kemiri" \
  < /dev/null > "$KEMIRI_ROOT/start.log" 2>&1
curl --connect-timeout 2 --max-time 2 --retry 20 --retry-connrefused --retry-delay 1 \
  "http://127.0.0.1:$KEMIRI_PORT/aiki-local.json"
kemiri status
```

Stop only that recorded PID with `kill -TERM "$(< "$KEMIRI_ROOT/rehearsal.pid")"`
(in bash), after verifying it matches `$KEMIRI_ROOT/supervisor.pid`. The child PID is in
`server.pid`; the supervisor stops it. Wait for both PID files and the listener to
disappear before cleanup. Never use `pkill`, `killall`, a port-owner kill, or a real
backend/service to manage the rehearsal.

## 5. STOP: let the human authorize access

Do not run `kemiri pair` in captured tool output. Ask the human to run it privately
in another terminal while Kemiri runs, open its one-time URL in the same browser,
confirm full owner access, then choose **Open Kemiri**. The URL/code expires after ten
minutes; generating another cancels the unused earlier grant. Do not disable auth
if it expires. Every paired device has full owner access, not a limited guest role.
A first-run screenshot may show Welcome, but must not contain a pairing grant.

Then **STOP at each of these boundaries**; do not infer consent from permission to
install:

1. **Provider sign-in:** ask the human to open Settings and connect their model
   provider with a supported subscription login or API key. The human enters all
   secrets directly. Kemiri uses pi-ai, not Claude Code/Codex CLI credentials;
   subscription eligibility and provider policy apply, and usage may cost money.
   Do not claim inference works just because a credential was saved.
2. **Project folder:** ask the human which folder to add, explain that agents can
   read/write it and run commands with their permissions, and let them add it in
   the web app and choose its coordinator model. Do not scan/import home folders,
   create a real project, or launch a model run without permission.
3. **Optional Linux user service:** ask whether they want login-time startup. Do
   not install it by default. After explicit consent, stop the foreground process
   with Ctrl-C, preview with `kemiri service install --print`, then run
   `kemiri service install` and verify `kemiri status`. This manages only
   `aiki-local.service`, never the separate deployment service. No sudo or linger.
   If a user systemd session is unavailable, keep using foreground mode. macOS
   launch-agent support exists but remains experimental; ask separately before use.
4. **Optional phone pairing:** ask separately about HTTPS/network setup and the
   [signed Android APK linked in the README](../README.md#try-kemiri)
   (`kemiri-$KEMIRI_VERSION-android-universal.apk` on the selected release).
   The phone needs this backend reachable over HTTPS, for
   example through an explicitly authorized Tailscale setup. `kemiri pair` emits a
   loopback first-device link, not a phone tunnel. Do not send that loopback link
   to a phone or expose the backend on all interfaces. Follow the app's assisted
   remote setup only with the human; no independent-user phone push in this pilot.

At a STOP, report what is installed/running, the non-secret local URL and the next
human action. Pause until they reply. A disposable rehearsal normally ends at
Welcome. With explicit authorization to rehearse pairing, an agent may redirect
`kemiri pair` into a private file (mode 0600),
open its URL in a fresh local browser profile, confirm full access there, and choose
**Open Kemiri**. Never log the grant, capture it in a screenshot or retain the file.
Stop before provider/project setup; service and phone steps are not automatic tests.

## 6. Update or uninstall only when asked

Stop the foreground process (Ctrl-C), or remove the authorized local service with
`kemiri service remove`. Back up `$KEMIRI_ROOT/data` and `$KEMIRI_ROOT/config` while stopped,
and project repositories separately. Protect backups like secrets.

**Existing pilot.3 and earlier:** use the old command only to reach the bridge:
stop it, back up, then run `aiki update --version v0.1.0-pilot.4`. For an authorized
user service use `aiki service remove` before updating. Do not go directly to
pilot.5. Once on pilot.4, normal standalone installs use
`kemiri update --version "$KEMIRI_VERSION"`, then `kemiri start` (or the separately
authorized `kemiri service install`). Keep existing folders and pairings.

**Pilot.4 Bun/source installs, Intel Macs and Linux musl:** the embedded updater
requires an `aiki/` archive and rejects pilot.5's `kemiri/` archive. Instead,
download, checksum-check and review the selected release's installer as in step 3,
then run it with `--version "$KEMIRI_VERSION" --no-service` and the **same recorded
absolute --dir**, if originally used. Preserve custom install/config settings;
never select a new root. Add `--runtime bun` if deliberately retaining Bun. Source
activation driven by pilot.4 can retain a harmless old `aiki` launcher selecting
pilot.5; use `kemiri` thereafter. See [INSTALL.md](INSTALL.md#updating-rollback-backup-and-removal).

```sh
kemiri update
# Or select an exact reviewed tag with: kemiri update --version TAG
# Source installs can instead select a newly reviewed exact public commit:
kemiri update --ref FULL_COMMIT_HASH
kemiri start
# In another terminal:
kemiri status
```

Select only one update command. Updates follow the saved pilot/stable channel; `--channel pilot|stable`
switches it, and `--version TAG` wins. Older installers need one exact-tag update to gain channel support.
Settings → About has release notes and a backend-wide daily-check switch. Binary and Bun installs share the
same saved version/channel identity; source checkouts have no notices by default. New binary-aware updaters
prefer an executable; `kemiri update --runtime bun` explicitly selects the pinned-Bun path. Rollback can cross
runtime types without changing the saved channel. To move directly from an older updater to a binary release,
review/rerun the new installer with the same `--dir` and an explicit tag; an older updater may first install
that release through Bun.
Manual CLI updates do not restart the server. `kemiri rollback` selects the
retained previous code release while stopped, but does not undo database migrations;
read release notes before downgrading. The app's separately confirmed **Update now**
uses the running supervisor to restart, check health and automatically restore the
previous code on failure. It does not roll back data. See
[the supervised update procedure](INSTALL.md#updating-rollback-backup-and-removal).

Use the reviewed external installer from step 3 for removal, with the same `--dir`.
For a source checkout its path is `kemiri-source/install.sh` instead of `install.sh`:

```sh
sh install.sh --dir "$KEMIRI_ROOT" --uninstall
# Only with separate, explicit approval to delete conversations and credentials:
sh install.sh --dir "$KEMIRI_ROOT" --uninstall --purge
```

These are alternatives: an ordinary uninstall removes the runtime needed to run
purge, so reinstall before a later purge. Ordinary uninstall retains data/config
and ownership metadata; purge deletes data/config permanently. Neither deletes
project repositories. Do not delete the scratch/install directories until the
human has decided what to retain.

## Troubleshooting

These are pilot.5 installer/CLI messages (absolute paths and ports may vary).
Do not paste surrounding secret output into a report.

| Message | Action |
| --- | --- |
| `curl: (22) The requested URL returned error: 404` | Check the version and asset names. Use the source fallback if needed. |
| `kemiri: Install unzip to prepare the Bun fallback` | Ask for the named bootstrap utility; similarly for curl/tar. |
| `kemiri: Install sha256sum or shasum to verify downloads` | Supply a checksum utility; never skip verification. |
| `kemiri: Kemiri binary checksum mismatch; nothing activated` / `kemiri: Bun checksum mismatch; nothing activated` / `kemiri: Kemiri archive checksum mismatch; nothing activated` / `kemiri: zellij checksum mismatch` | Stop; retry only on a trusted connection. Do not bypass hashes. |
| `kemiri: Private Bun could not run or has the wrong version; see docs/INSTALL.md` | Check OS/architecture/libc compatibility. Do not replace global Bun. |
| `kemiri: Directory is not a Kemiri-managed installation; choose an empty --dir` | Choose an empty user-owned absolute path, not existing backend state. |
| `kemiri: Another launcher exists at /home/example/.local/bin/kemiri; refusing to overwrite it` | Inspect the existing installation with the human; do not overwrite it. |
| `kemiri: Another install is running (or a stale .install-lock remains)` | Confirm no installer is running before asking to remove a stale lock. |
| `Not responding at http://127.0.0.1:7317. Run kemiri start or inspect your user service.` | Check the matching foreground terminal/log, paths and port. Status exits nonzero. |
| `Port 7317: in use; kemiri status checks whether it is Kemiri. Set KEMIRI_PORT for another port.` | Pick a free port before start; pass it to every command or, with permission, set it in `$KEMIRI_ROOT/config/server.env`. |
| `kemiri: KEMIRI_PORT must be 1–65535` | Choose a decimal port in range. |
| `kemiri: Kemiri is running. Stop its supervisor before changing releases.` / `kemiri: Kemiri is running. Stop the foreground process (Ctrl-C) or your user service before changing releases.` | Stop the correct installation before start/update/rollback/service installation. |
| `kemiri: Kemiri's supervisor is already running` | Use the already running installation; do not remove a live supervisor.pid. |
| `kemiri: server.pid already exists. If a previous process crashed, confirm it is stopped before removing this stale file.` | Verify the recorded PID is stopped; ask before removing the file. |
| `kemiri: No systemctl user service manager. Continue with kemiri start.` | Use foreground mode; do not create a system service. |
| `kemiri: Another local Kemiri service exists; refusing to overwrite/remove it` | Ask the human to identify the existing service. |
| `kemiri: No previous release retained` | No code rollback is available; do not downgrade data blindly. |

For Welcome requiring device sign-in, follow step 5. For provider failures, let the
human check eligibility or try an API key; never request their secret in chat.
See [INSTALL.md](INSTALL.md) for paths and experimental macOS checks.
