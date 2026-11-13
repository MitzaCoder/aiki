# Install Kemiri locally

The download below targets pilot.5. Pilot.4 remains the upgrade bridge. Pilot.3 itself uses `aiki`;
stop it and run `aiki update --version v0.1.0-pilot.4`, then use
`kemiri`. Existing config/data and service names are retained, with no re-pairing.
Pilot.5 reads only KEMIRI_* process settings and migrates its server.env.
Process settings beat file settings. Fresh installs use Kemiri XDG
roots. Existing legacy defaults are reused without copying; populated independent
old/new defaults require an explicit path. Recorded installation paths always win.

Kemiri runs your agents and tools as **your user**, with your filesystem access and provider spending authority.
Each person installs their own backend. This experimental installer is for Linux and macOS, x64/arm64; Windows
users run it inside WSL. There is no Node fallback. Fresh data starts with device sign-in **required**. This installer
keeps loopback binding; network/Tailscale HTTPS setup is separate. Do not forward the port or expose it casually.

## Upgrading existing installations

Use `kemiri` for commands and `KEMIRI_*` for settings. Pilot.5 removes
the old command and process-setting aliases. Startup rewrites old keys in its own
server.env once, preserving values and an original .bak; when both keys exist,
KEMIRI wins and the old assignment is dropped with a key-only log message.
Rename process/build settings yourself before updating. Existing installation
folders, credentials, pairings, service names and project context stay put.
Do not rename or delete them. Fresh installs use Kemiri folders. Pilot.4 is the
bridge: pilot.3 and earlier must update through it before pilot.5.

## Install

Install the `v0.1.0-pilot.5` prerelease after publication:

```sh
curl -fL https://github.com/MitzaCoder/kemiri/releases/download/v0.1.0-pilot.5/install.sh -o install.sh
# Read install.sh before running it.
sh install.sh --version v0.1.0-pilot.5
```

The short command is `curl -fsSL https://kemiri.dev/install.sh | sh`.
For a review before execution, download the domain bootstrap instead:

```sh
curl -fL https://kemiri.dev/install.sh -o install.sh
# Read install.sh before running it.
sh install.sh --version v0.1.0-pilot.5
```

The [small bootstrap](../site/install.sh) downloads the exact version's `install.sh` and `install.sh.sha256`
from GitHub Releases, validates the checksum, then runs that installer with the same arguments. No version
means the pinned `v0.1.0-pilot.5`, not latest. An explicit `--version TAG` selects both the installer and release;
`--version latest` is deliberately rejected. All other arguments (including `--no-service`) pass through.
It requires HTTPS for both downloads and redirects, never executes an unverified installer, and cleans its
temporary downloads on exit. The verified release installer still checks its own archives and runtimes.
Use the direct GitHub commands above if you prefer to inspect the full installer before execution.
Checksums fetched from the same publisher are not signatures. See [the site operations note](SITE.md)
for the trust boundary and how the pinned pilot is maintained.

Keep `--version` explicit for the first pilot install; it remembers the pilot channel for later updates. HTTPS checksums detect download
corruption; they are not a signature or protection against a compromised publisher. Bun 1.4.4 and zellij 0.45.1
archive hashes are pinned in the installer. They are private to Kemiri and never replace your global tools.
For releases with a matching executable, the current installer downloads it instead of Bun or node_modules.
It requires both the executable's `.sha256` sidecar and its matching entry in `SHA256SUMS` before execution.
Only an absent binary (HTTP 404), an unsupported binary platform, or `--runtime bun` selects the existing
pinned-Bun source/web fallback. Network errors or bad/missing checksums never trigger a weaker fallback.
Pilot.2 and later supply Linux x64/arm64 and macOS arm64 executables; pilot.1 predates them and uses Bun.

Install **git** for repositories, **jj** for isolated workers, and **Tailscale** for future phone access. Missing
tools are explained without blocking local setup (except git is required for `--ref`). On minimal Linux images,
bootstrap utilities `curl`, `tar` (with gzip), and `sha256sum` or `shasum` must be available; `unzip` is needed only
for the Bun fallback. No preinstalled Bun is needed, and a matching binary install downloads no Bun runtime or
JavaScript dependencies. macOS supplies these utilities and uses `shasum`. No sudo or system-wide package changes are made. Repository toolchains remain your choice.
`ffprobe` is optional for video metadata. A failed zellij download leaves chat usable; re-run to enable terminals.

The default tries to install and start a **user** service. Without a user systemd session (Linux) or a logged-in
launchd GUI session (macOS), continue in the foreground instead:

```sh
sh install.sh --version v0.1.0-pilot.5 --no-service
export PATH="$HOME/.local/bin:$PATH"   # if the installer says it is missing
kemiri start                             # keep this terminal open
# In another terminal:
kemiri open                              # http://127.0.0.1:7317
```

Welcome discovers this computer automatically but cannot read projects/providers before device sign-in. Keep Kemiri
running and run `kemiri pair` in another terminal. It asks the existing local owner socket for a ten-minute one-time
URL and code (the code is already included in the URL). Open that URL in the same browser, confirm full access,
and choose **Open Kemiri**. Treat the URL/code as secrets; do not paste them into logs, screenshots or support reports.
Re-running `kemiri pair` cancels any unused earlier bootstrap grant. Sign in or save an API key in the existing account settings,
choose a project folder, then choose its coordinator model. Providers still connect directly through pi-ai;
Claude Code and Codex CLIs are not required. Subscription access is subject to provider policy/account eligibility;
paid API keys are the straightforward alternative. A saved credential is not proof of successful inference.

## Notion sign-in

Pilot.3 fixes “Could not start MCP sign-in” on local installs opened through either
`localhost` or `127.0.0.1`. Both exact local callback origins are accepted at the
actual Kemiri port. If you added the pilot.2 `KEMIRI_ALLOWED_ORIGINS` workaround to
`server.env`, you can keep or remove those local entries after upgrading. Preserve
any other explicitly trusted origins you still need; never add a wildcard.

Use **Copy sign-in link** to finish sign-in in another browser, then paste its
callback URL back into the initiating app if needed. Notion requires an account
before consent; no account is needed to start sign-in and open its authorize page.

## Commands and paths

- `kemiri start`: foreground, loopback only. Ctrl-C closes it cleanly. It never auto-opens a browser.
- `kemiri open`: open the local URL; prints it if no browser is available. `KEMIRI_NO_BROWSER=1` prints only.
- `kemiri pair`: print a one-time local first-device URL and code using this installation’s running owner socket.
- `kemiri auth ...`: existing owner commands, explicitly targeting this installation: `status`, `devices list`,
  `devices revoke ID`, `mode required`, `migration list`, and the other source owner-CLI commands. These and `pair`
  work from a normal shell, SSH, or an agent child shell; they do not depend on an inherited backend or port setting.
- `kemiri status`: check the selected port for Kemiri's local discovery endpoint; nonzero when unavailable.
- `kemiri health-check`: owner-socket protocol/status health, including installed version/channel for update notices.
- `kemiri version`: selected release and Bun engine version (embedded for binary installs).
- `kemiri doctor`: tool availability/versions, local paths, platform and whether the configured port is free.
- `kemiri service install|remove`: user unit `aiki-local.service`, or launch agent
  `io.github.mitzacoder.aiki.local`. `--print` generates the platform's definition without writing or running it.
  Linux users who want startup before login may choose to enable linger themselves; Kemiri never does so.
- `kemiri update`: newest release on the saved channel (pilot includes prereleases; stable excludes them).
  `--channel pilot|stable` switches channel; `--version TAG` selects an exact tag instead.
  `--runtime bun` forces the source/private-Bun fallback; `--runtime binary` requires a matching executable.
- `kemiri rollback`: select the retained previous release, swapping it with current.

Default installation root: `${XDG_DATA_HOME:-~/.local/share}/kemiri`; runtime under `runtime/`, immutable releases
under `releases/` (a binary release contains `kemiri` and `.ready`), backend state under `data/`, with `current`
and `previous` symlinks. The launcher checks the selected release, so rollback works across both runtimes.
An explicit runtime change at the same tag prepares a separate immutable `TAG-bun` or `TAG-binary` directory;
the recorded version/channel remain the release's original identity. Configuration defaults to
`${XDG_CONFIG_HOME:-~/.config}/kemiri`. The canonical launcher is `~/.local/bin/kemiri`; an owned stale `~/.local/bin/aiki` launcher is removed. With `--dir /absolute/empty/path`, both
state and config live there (`data/`, `config/`). Existing unmanaged directories or another launcher are refused.
Re-running the same version reuses its ready release and does not reinstall dependencies. A normal uninstall
retains the tiny ownership metadata so reinstalling into the same root reuses your data/config.

The installed CLI deliberately uses its recorded data/config directories, not another backend's inherited
`KEMIRI_DATA_DIR`, `KEMIRI_CONFIG_DIR` or `KEMIRI_ENV_FILE`. Activation creates an empty owned `server.env` when absent;
the installed CLI loads that explicit file, never a fallback HOME/XDG file. It uses T82’s shared loader and immutable
private settings snapshot, not process-environment assignments or a second isolation layer. The source and installed
entry points then use the same startup/auth dispatcher and live-owner socket check. Startup prints effective data/config
paths before importing the server. CLI-spawned helpers use the same shared child-environment scrubber. Keep
persistent storage identity settings stable; never borrow another installation's environment or credential files.
Source/deploy entry points use KEMIRI_* only; update unit/deploy inputs before deployment.

Change port by putting `KEMIRI_PORT=17317` in this installation's `server.env`, or supplying `KEMIRI_PORT` to both
`kemiri start` and `kemiri open`. The installer prints the default URL; `kemiri open` resolves your configured port.
Linux service definitions capture the installation-time PATH so git/jj installed through user toolchains are found.
Reinstall the user service after changing tool paths. macOS logs are under the install root at `service.log`;
Linux logs use the user journal.

## Updating, rollback, backup and removal

**One-click updates:** on a release with self-update support, use **Update now** beside the navigation version
or in Settings → About. Review the exact from → to version and release notes, then confirm. Any paired owner
device can do this; the backend logs its session ID. The backend downloads and verifies the same binary or
source/private-Bun fallback as `kemiri update`, on the saved pilot/stable channel. When ready, it holds new tool calls and waits only for commands already running,
not agents or turns. It shows “Waiting for 1 running command (bun test, 3m)…” with Cancel.
After five minutes, “Restart anyway” appears and requires a second confirmation:
running commands may be killed and unsafe to retry. Set `KEMIRI_UPDATE_WAIT_TIMEOUT_MS`
in `server.env` to change this cap. The prompt keeps new calls held until the commands
finish or you choose. Cancel releases them without changing the running release.
Conversations and held calls resume after restart. Cancel is unavailable during restart.

`kemiri start` keeps a small supervisor alive, whether started in a terminal, systemd --user or launchd. It stops
its child before switching code, restarts and checks the owner-only health socket for up to 30 seconds. Failure
restores the retained code and restarts it automatically. Clients reconnect and show “Updated to v…” or
“Update failed, rolled back: …”. A rollback whose old code is also unhealthy reports that separately.
No service-manager command is needed during an update. Keep the supervisor running until the outcome appears.
An interrupted switch is restored on the next `kemiri start`. The supervisor and `server.pid` locks must not be
removed while their processes are alive. Native macOS launchd rehearsal is still required.

**Manual CLI updates/rollback:** stop Kemiri first (Ctrl-C for foreground; `kemiri service remove` for an installed
user service), run `kemiri update` or `kemiri rollback`, then `kemiri start` or `kemiri service install`.
The CLI refuses changes while the supervisor/server runs. Download/checksum/build failures leave the selected
release unchanged. An interrupted install can leave `.install-lock`; remove it only after confirming no installer
is running. `install.sh --stage-only` prepares a release beside the current one without activating it.
Source/development checkouts and deploy-watcher hosts cannot self-update; About explains why.

Settings → About shows available versions and release notes. Installed releases check the public GitHub API
about once a day, without credentials; turn this off there for the whole backend. Dismissal hides the bottom-left update notice
for that version, not the About row. Source/deploy checkouts do not check unless explicitly enabled in About.
**Pilot.3 and earlier users:** stop it, run `aiki update --version v0.1.0-pilot.4`, then
`kemiri update --version v0.1.0-pilot.5` and `kemiri start`. For a user service, use `aiki service remove` before updating
and `kemiri service install` afterwards. Keep existing folders and data.
**Pilot.3 and older releases lack the self-update API/supervisor.** This stopped manual
upgrade acquires it before you can use the button.
Later binary updates use plain `kemiri update`. For pilot.4 source/Bun fallback upgrades to pilot.5, download and review that release’s installer and run it with the same `--dir`: pilot.4’s embedded installer only accepts the old archive layout. Self-update changes the backend, never Android's APK.
Install the Android APK over the old app; the release uses the same owner signing key,
versionName `0.1.0-pilot.5`, code 1000005.
An older installer without channel support needs that first exact-version update to acquire this behavior.
For an installation whose updater predates binary support, download/review the new installer and rerun it with
an explicit reviewed `--version TAG` and the same `--dir` to switch directly. An old updater may first install the
new release through Bun; subsequent updates use its binary-aware installer. Never bypass checksum verification.

Back up `data/` and your config directory **while stopped**, plus repositories separately. These include provider
credentials, conversations, artifacts and absolute repository paths: protect backups like secrets. A code rollback
does **not** undo database migrations, so consult release notes before downgrading. Automatic health rollback
has the same limitation: release storage changes must remain backward-compatible. No nightly channel or unattended
scheduled installation is enabled; each update requires an owner's confirmation.

```sh
sh install.sh --uninstall               # keeps state/config; removes its launcher/runtime/releases/tools/service
sh install.sh --uninstall --purge       # also deletes state/config; never deletes project repositories
# Add the same --dir used during installation, if any.
```

After an ordinary uninstall, re-run the installer to use the preserved state or to make the purge command available
again. Purging is permanent. The owner's separate `deploy/` installation, watcher, units and data are never managed
by this CLI. The local service refuses to overwrite an unrelated unit/agent at its chosen path.

## Development and release testing

For source testing instead of a published release, use an explicit git ref (not a moving `main` watcher):

```sh
sh install.sh --ref COMMIT_OR_TAG --dir "$HOME/aiki-test" --no-service
```

This fetches a clean source archive from the public repository, installs the frozen lockfile and builds the web
app without personal backend suggestions. A release tarball already contains the neutral prebuilt web app.
Locally, with Bun 1.4.4, build and install archives without creating a tag or a GitHub release:

```sh
bun scripts/build-release.ts --version v0.0.1-test.1 --out .preview/releases
sh install.sh --version v0.0.1-test.1 --archive .preview/releases/aiki-v0.0.1-test.1.tar.gz --dir "$HOME/aiki-test" --no-service
# Build a second version, stop the test server, then:
kemiri update --version v0.0.1-test.2 --archive .preview/releases/aiki-v0.0.1-test.2.tar.gz
kemiri rollback
```

The builder uses an explicit source allow-list, a clean staging directory, frozen dependencies and a neutral web
build; no `deploy/local`, Android config, node_modules or environment files enter the tarball. Dependencies retain
their notices when installed; Bun and zellij keep their upstream licences. `.github/workflows/release.yml` runs
checks on a `vMAJOR.MINOR.PATCH[-pilot.N]` tag and stages a draft with the tarball, checksum, installer and installer checksum.
The owner attaches the locally signed APK and notices before publication; see [RELEASE.md](RELEASE.md).
The workflow does not create tags. The CLI remembers pilot/stable independently of rollback; neither channel updates automatically.

### Single-binary release assets

CI also builds `aiki-VERSION-linux-x64`, `aiki-VERSION-linux-arm64` and
`aiki-VERSION-darwin-arm64`, each with a sibling `.sha256`. They join the existing assets on a
**draft**, never an automatically published release. Linux binaries require glibc; x64 uses Bun's
baseline target. The release also contains `SHA256SUMS`, covering the executables, source archive and
installer. macOS signing/notarization is separate. The installer and `kemiri update` prefer matching binaries;
macOS x64, Linux musl, older releases and `--runtime bun` retain the source/private-Bun path.

Build and smoke locally on Linux x64, without tags, GitHub releases or service management:

```sh
bun install --frozen-lockfile
bun scripts/build-binary.ts --version v0.0.0-test.72 --target bun-linux-x64-baseline --out .preview/binaries
bun scripts/build-binary.ts --version v0.0.0-test.72 --target bun-linux-x64-baseline --out .preview/binaries \
  --archive .preview/binaries/aiki-v0.0.0-test.72.tar.gz --smoke
python3 scripts/smoke-binary.py --binary .preview/binaries/aiki-v0.0.0-test.72-linux-x64 \
  --smoke .preview/binaries/aiki-v0.0.0-test.72-linux-x64-smoke
```

The builder uses the same compiler as `bun build --compile`, a neutral staged web build, explicit
embedded web/worker/WASM files and frozen dependencies. The smoke executable is test-only and is
never uploaded as a release asset. Use `bun-linux-arm64` or `bun-darwin-arm64` for the other targets;
cross-compilation alone does not establish that they run. CI smoke-tests each on its native runner.
The smoke script uses temporary isolated paths, an empty environment and no Bun on runtime PATH.

The standalone binary accepts `start`, `status`, `health-check`, `version`, `--print-config`, `pair`
and `auth`. It defaults to loopback and required device sign-in on fresh data. Use explicit temporary
`KEMIRI_DATA_DIR`, `KEMIRI_CONFIG_DIR`, `KEMIRI_AGENT_DIR`, `KEMIRI_CLAUDE_DIR` and HOME for experiments;
never aim a test at an existing backend. When invoked through the installed launcher, this same executable
also runs the shared installer lifecycle/service/update/rollback CLI. It uses T137's existing installation
metadata and private installed-version/channel settings, not a separate binary identity marker.

Original part-1 local measurements: Linux x64 binary **122.80 MiB**, versus **410.52 MiB** for the neutral installed
source/dependencies plus pinned Bun. Five warm startup medians were **353.1 ms** binary and
**404.8 ms** installed Bun CLI. These are not cold-start or inference benchmarks. Full methodology,
other target sizes and the original part-1 measurements are in
[the binary build note](research/single-binary-build.md).

For a Linux installed-runtime rehearsal, build a binary and a differently versioned source archive, then run:

```sh
bun scripts/smoke-install.ts --binary .preview/binaries/aiki-v0.0.0-test.72-linux-x64 \
  --binary-version v0.0.0-test.72 --archive .preview/releases/aiki-v0.0.1-test.1.tar.gz \
  --bun-version v0.0.1-test.1
```

This serves local assets/checksums on loopback, installs into printed temporary HOME/data/config paths with no
Bun on child PATH, and checks fresh binary installation, both runtime update directions, rollback, health/update
identity, required auth and the Welcome HTML shell. Bun fallback uses a private copy of the test runner's pinned
Bun as its download-cache fixture. A fake zellij avoids unrelated downloads. All owned processes and temp trees
are removed afterward. `--release-base-url URL` is available for local mirrors/tests (HTTPS, or loopback HTTP);
normal installs/updates use the public GitHub release assets.

### Troubleshooting

- Pilot download returns 404: check the version and asset name. `/latest` ignores pilots.
  For source testing or a fallback, use `--ref` or a locally built `--archive`.
- Permission errors: choose an empty user-owned `--dir`; do not run as root.
- Checksum mismatch: retry on a trusted connection; do not bypass verification.
- Bun cannot execute: verify OS/architecture and Linux libc compatibility. x64 uses the baseline build (no AVX2
  requirement); Linux musl has separate pins. Very old CPUs/libc/kernel versions may need a newer OS.
- Welcome asks for device sign-in: this is expected for new data. Run `kemiri pair` while Kemiri is running, open its
  one-time URL in that browser and confirm. An expired/used URL needs a fresh `kemiri pair`; never disable auth to fix it.
- Page opens but is disconnected: verify `kemiri status`, configured port, and that the URL is loopback. Remove stale
  saved backends only in this browser's Settings. Static hosted web deployments do not auto-discover a local server.
- Port in use: `kemiri doctor`; choose another `KEMIRI_PORT`. Kemiri never kills a process to reclaim a port.
- Provider auth fails: check account eligibility and provider policy; try an API key. Never attach credentials to
  a support report. No provider credentials are imported from the owner's or vendor CLI installations.
- Missing jj: chat/shared checkout can work; isolated workers cannot. Install jj and restart with it on PATH.

### Manual macOS checklist (not tested on Linux)

On both Apple Silicon and Intel: verify the pinned download hashes and execution, frozen install/build from a ref,
paths with spaces/quotes, browser opening, required-mode loopback HTTP/WebSocket, owner-socket `kemiri pair`,
first-device sign-in and provider/project setup. Generate and inspect the
plist; in a disposable account test launchctl bootstrap/bootout, login restart, PATH discovery and `service.log`.
Then test update/rollback while stopped, running-process refusal, normal uninstall/reinstall and purge. Confirm no
global Bun, shell profile, unrelated launch agent or existing backend is changed. Cross-compilation is not testing.
