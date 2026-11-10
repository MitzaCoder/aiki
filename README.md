# Aiki

Aiki is an early personal, cross-device agent harness built on
[pi durable](https://github.com/earendil-works/pi/tree/main/packages/durable).
**It is not ready for others to install yet.**

Original project code is [MIT-licensed](LICENSE). Bundled third-party code, fonts and icons retain their own licences;
see `apps/android/licenses/` and the notices alongside the bundled code.

One app is separate from every backend: it connects to many harness servers at once and shows their projects together.
Backends own their storage and run their agents and tools on their own machines. Design: `docs/DESIGN.md`.

## Local configuration and publication

Machine-specific configuration is **not tracked**. The deploying checkout keeps it under `deploy/local/` (or an
absolute `DEPLOY_CONFIG_DIR`). Start from `deploy/targets.example.json`, `deploy/backends.example.json` and
`deploy/android.example.properties`; example files are never selected automatically.

- `targets.json`: remote SSH targets, optional routing checks, service mode, identity paths and remote tool paths.
  `DEPLOY_TARGETS_FILE` takes precedence; the old `deploy/targets.json`, if present, remains a transition fallback.
  No target file means no remote targets.
- `backends.json`: optional suggestions for web clients. The build reads
  `AIKI_PUBLISHED_BACKENDS_FILE`, otherwise the local configuration directory. Missing means no suggestions.
  The deploy exports the stable absolute file path before building its temporary Git archive, so the deployed app
  retains the operator's suggestions without committing them.
- `config.env`: optional trusted shell configuration for deploy tooling, such as `DEPLOY_STATE_DIR` and
  `DEPLOY_WATCH_SERVICE`. This preserves existing state/lock/service identities during a source cleanup.
- `aiki.service`: optional private user-mode backend unit, copied to remote tooling instead of the public
  origin-free template. `DEPLOY_USER_UNIT_FILE` may select a differently named file. Host-managed system units are unchanged.
- `server-host.env`, `server-<target>.env`: optional per-installation `AIKI_*` settings. Deploy installs these atomically
  as mode 0600 at `${XDG_CONFIG_HOME:-~/.config}/aiki/server.env` on each target, outside releases. Override a source
  with `DEPLOY_HOST_ENV_FILE` / `DEPLOY_<TARGET>_ENV_FILE`, or destination with the corresponding `_ENV_DEST` variable.
  A changed file forces a backend restart even when the source commit did not change. The server loads it before
  registering durable state; explicit `AIKI_*` process settings win. `AIKI_ENV_FILE` selects another path (an explicit
  missing file is an error). Keep destination and unit environment aligned when overriding the default path.
- `web.env`: optional `AIKI_LEGACY_STORAGE_PREFIX`, injected as a Vite define into hosted builds. Missing/empty
  `aiki.*` localStorage keys and absent/empty IndexedDB databases are copied from that namespace before stores load.
  Notification registration cache data is copied as well; original state stays intact. Public builds omit it.
  `AIKI_WEB_ENV_FILE` selects another build-time env file.
- `android.properties`: private `harness.appOrigin`, `harness.publishedBackendsUrl` and optional external
  `harness.googleServicesJson`. Optional `harness.applicationId` preserves the installed application identity;
  `harness.preferencesPrefix` and `harness.notificationIntentPrefix` preserve existing device state and intents.
  Firebase client selection follows that application ID. The namespace stays `io.github.mitzacoder.aiki`, and a local
  application-ID override also enables an activity alias so existing shortcuts/notification taps still resolve.
  Keep the same signing key. The Android build wrapper loads the properties file automatically. `HARNESS_ANDROID_PROPERTIES` can
  select another file; Gradle properties and corresponding environment variables override file values.
  Direct Gradle invocations can instead use ignored `apps/android/local.properties`. A generic build has no published
  backend suggestions and an inert example app-link origin; no personal endpoint is built into public source.
- `denylist.txt`: one private term per line, matched case-insensitively by the publication guard. Prefix a term with
  `word:` for whole-word matching (avoids matching part of an unrelated code identifier). Do not put the protected
  terms in committed tests, documentation or the guard implementation itself.

Existing installations can retain all paths and unit names in `config.env`: `DEPLOY_HOST_ROOT`, `DEPLOY_HOST_SERVICE`,
`DEPLOY_APP_ROOT`, `DEPLOY_REMOTE_ROOT`, `DEPLOY_REMOTE_SERVICE`, or per-target `DEPLOY_<TARGET>_ROOT` / `_SERVICE`.
`DEPLOY_STATE_DIR` and `DEPLOY_WATCH_SERVICE` retain watcher state and identity without reinstalling its unit.
Set `DEPLOY_HOST_DATA_DIR` and `DEPLOY_VM_DATA_DIR` for VAPID sharing when existing notification keys live elsewhere.

Use `bun packages/server/src/main.ts --print-config` to inspect effective paths, binding, origins and storage identity
without opening or changing any data. For an existing store, set `AIKI_STATE_NAMESPACE` to its original document/task
namespace, `AIKI_PROJECT_CONTEXT_DIR` to its project prompt directory, and `AIKI_CONTEXT_EXTENSION` to its context
extension identity. Keep those values stable across releases and rollbacks. New installations need none of them.

Before **every push to a public remote**, run `bun scripts/check-public.ts` (use `--require-scanner` when Nix/Gitleaks
must be available). It checks only the intended current tracked tree, not the old private history, and invokes a
bounded Gitleaks scan when available. Review the exact refs separately: public publication is a clean starting
snapshot, never a push of the archived private history. Preserve third-party notices; Sora's LGPL requirements also
need review before distributing Android binaries.

## Topology

| Address | What |
| --- | --- |
| `https://harness.example.test` | the app, a static SPA served by Caddy on this host |
| `https://harness-pc.example.test` | backend on this host, listening on `127.0.0.1:7317` |
| `https://harness-vm.example.test` | backend on the remote VM, listening on `0.0.0.0:7317` |
| `https://harness-t14.example.test` | backend on the intermittent laptop, listening on `0.0.0.0:7317` (tailscale only); answers 502 while the laptop sleeps |

Backends are added, renamed and removed in the app itself (name + HTTPS origin, stored in that browser). The app keeps
one WebSocket per backend, groups projects by backend, and routes as `/b/<backend>/projects/<project>`. A backend is
any HTTPS origin; plain HTTP is accepted only for `localhost`/`127.0.0.1` during development. There is no login on a
backend, so each one accepts browser WebSockets only from the app's origin (`AIKI_ALLOWED_ORIGINS`).

Typing an address is rarely necessary:

- `deploy/local/backends.json` is the published list of backends. The app build copies it to `/backends.json` beside the
  app (see `apps/web/vite-plugin-published-backends.ts`), and the app fetches it at startup. A browser with no backends
  offers them as one-tap add buttons plus "Add all"; the backends page lists the ones not added yet. A host that
  publishes no file (or an unreadable one) simply suggests nothing, so the list is optional.
- The backends page makes a "connect another device" link, `<app origin>/connect#<encoded backends>`, with a QR code
  and a copy button. The list stays in the fragment, so it never reaches a server log; opening the link on the other
  device shows the backends, the user confirms, and each one is added there (a URL that device already has is skipped)
  before it lands on its projects. Only HTTPS origins can travel in a link.
- In the add form a bare name expands: `harness-pc` is that published backend, otherwise
  `https://<name>.<domain the published backends live under>` (or the app's own host's domain). The name field fills
  itself from the address's first label while it is left empty.

To suggest another backend, add it to `deploy/local/backends.json` and deploy; nothing in the code changes.

## Run

```sh
bun install
bun run start                     # backend: http://127.0.0.1:7317, API only
(cd apps/web && bun run dev)      # app: http://localhost:5173
```

Add `http://127.0.0.1:7317` as a backend in the app. The local backend must allow the dev server's origin:

```sh
AIKI_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 bun run start
```

Environment for a backend:

- `AIKI_HOST`: bind interface, default `127.0.0.1`; `0.0.0.0` for a machine reached over its network.
- `AIKI_PORT`: default 7317.
- `AIKI_DATA_DIR`: default `${XDG_DATA_HOME:-~/.local/share}/aiki`.
- `AIKI_ALLOWED_ORIGINS`: comma-separated browser origins allowed to open `/ws`. Unset means no browser
  origin is allowed; requests without an `Origin` header (native clients, tests, the health check) still work.
  Production sets `https://harness.example.test`.
- `AIKI_VAPID_KEY_FILE`: the Web Push VAPID key pair (see [Notifications](#notifications)). Default:
  `<data>/notifications/vapid.json`, generated on first start with mode 0600.
- `AIKI_VAPID_SUBJECT`: the VAPID `sub`. Default: the app's URL, the first HTTPS origin in
  `AIKI_ALLOWED_ORIGINS`.

The backend serves only the API. Every non-`/ws` route answers 404; the app is built and deployed separately.

## Notifications

The app holds one push subscription per browser and registers it with each backend it is connected to; a backend then
pushes its own events to the devices that want them: a coordinator reply, a worker's report or failure, a scheduled
task done (or failed/skipped), a deploy that failed or rolled back, a sign-in waiting for an answer, a compaction or a
memory maintenance that failed. Payloads are encrypted end to end (RFC 8291 aes128gcm) and signed with VAPID, so the
push service cannot read them. `packages/server/src/notifications.ts` is the only thing the rest of the server calls.

- **One key pair for every backend.** A browser holds one push subscription, so the key it subscribed with has to be
  the key every backend signs with. The host's backend keeps it in `<data>/notifications/vapid.json` (mode 0600,
  generated on first start, never committed); `AIKI_VAPID_KEY_FILE` moves it and
  `AIKI_VAPID_SUBJECT` overrides the `sub`, which defaults to the app's URL. The deploy copies the host's
  key to the VM when the VM's is missing or different (`deploy/vapid-key.sh`, before the VM restarts); it warns rather
  than failing, because the VM keeps working with the key it has.
- **By hand**, when the deploy cannot reach the VM:

  ```sh
  ssh user@vm.example.test 'umask 077 && mkdir -p ~/.local/share/aiki/notifications \
    && cat > ~/.local/share/aiki/notifications/vapid.json' \
    < ~/.local/share/aiki/notifications/vapid.json
  ssh user@vm.example.test systemctl --user restart aiki   # the key is read at start
  ```

  A device that subscribed against a different key must subscribe again; it learns the current key from
  `notifications.config`.
- **Devices** are persisted in `<data>/notifications/devices.json` (subscription, label, what the device calls this
  backend, preferences, last delivery), and the dedupe state in `<data>/notifications/state.json`, so a restart
  notifies nothing twice.
- **Filtering**: per kind on or off, muted projects, quiet hours in the device's own timezone (a window crossing
  midnight works; failures can be let through), and nothing while the device has a visible connection on that
  project. A push the service answers 404/410 for drops the device; any other failure is recorded as its last delivery
  and logged, never raised at the caller.

## Check

```sh
bun test && bun run typecheck
(cd apps/web && bun run check && bun run build)
```

## Deploy

This host deploys this repository to the app and to every backend whenever the `main` bookmark moves: this host's, the
remote VM's and the intermittent laptop's. Everything is in `deploy/`. The remote backends are listed in `deploy/local/targets.json`
(see "Remote targets" below); the laptop is intermittent, so a deploy that cannot reach it skips it and the watcher
catches it up later.

On each move:

1. `deploy/watch.sh` (the `aiki-deploy-watch` user service on this host) polls `refs/heads/main` with git only —
   running jj here would snapshot the working copy. A move starts a deploy; a failed deploy is logged and waits for
   the next move instead of retrying.
2. `deploy/deploy.sh <sha>` materialises that commit with `git archive` — never the working copy — and runs
   `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, the web check and the web build once on that tree.
   A failure stops the deploy before anything is published and records the failed attempt on every backend that
   answers (`deploy-status.json` below), so the app can say that the commit never started.
3. The app build goes to `/var/lib/aiki-web/releases/<name>`, then the `current` symlink moves. Caddy serves
   `current`. If the published files do not verify, `deploy/web.sh` restores the previous release. The release carries
   `/backends.json` — the app's published backend list, built from `deploy/local/backends.json` — and a real `connect.html`
   beside the `200.html` fallback, so `/connect` works whether Caddy rewrites to the fallback or to `{path}.html`.
   `web.sh` logs the published list it finds (or that there is none); it is optional, and a release without it simply
   suggests no backends.
4. The backend on this host is published under `~/.local/share/aiki-deploy/` (unless nothing it runs changed,
   see below), drains the running server until no tool call executes (see below), and is restarted with
   `systemctl restart aiki.service`,
   then health-checked deeply on `127.0.0.1:7317`. The system unit belongs to nix-config; while it does not exist the step logs a clear skip line and
   the rest of the deploy continues.
5. Then each remote target in turn (the VM, then the laptop), the same way: `deploy/vapid-key.sh` first shares this
   host's Web Push VAPID key pair with it when its copy is missing or different (one browser subscription has to verify
   against the key every backend signs with; it only warns when it cannot, and the target keeps whatever key it has;
   `AIKI_VAPID_KEY_FILE` names the host key, `DEPLOY_VM_DATA_DIR` the remote data directory). Then the tree and
   the tooling go over ssh, and `backend.sh` publishes, drains, restarts and health-checks there on its loopback. The VM
   is a `demo` user service that the deploy installs; the laptop is a system service from nix-config (restarted through
   polkit like this host's, no unit file installed). Each target is then checked over the tailnet (warning only).
6. Each backend rolls itself back to its previous release, restarts and re-checks if the new release is not healthy.
   Targets are independent: one failure is reported at the end and exits non-zero, but does not stop the others.

On every backend the release layout is `~/.local/share/aiki-deploy/`: `releases/<UTC timestamp>-<sha7>/`, an
`incoming/` tree while it is copied, `tools/` (the deploying host's `backend.sh`, `health-check.ts`, `deploy-status.ts`
and, on the VM, the unit), and `current` beside the releases. The data directory (`~/.local/share/aiki`) is
never touched, so switching releases keeps conversations. The newest 5 releases are kept, plus whatever `current`
points at.

Every release directory gets a `RELEASE.json` — `name`, the full `commit`, the commit's first line as `description` and
`deployedAt` — written by `deploy/backend.sh` before the release can start. It is what `server.status` reports as the
running release, so the app and the health check can tell which commit is live. A release from before this file existed
(a rollback target) simply reports no release; nothing needs it to be there.

A backend is only published and restarted when the commit can change what it runs. `deploy.sh` reads the commit each
backend runs from its `current/RELEASE.json` (over the existing ssh for the VM) and lists the paths that changed since
with `git diff --name-only --no-renames`. When every one is under `apps/web/`, `apps/android/`, `docs/` or
`deploy/test/`, a Markdown file at the root, or a script directly in `deploy/` (`*.sh`, `*.ts`: those go to `tools/` on
every deploy anyway), `deploy/local/targets.json` or `deploy/local/backends.json`, the backend keeps running: it gets the new tooling, `backend.sh <mode> unchanged` checks that it
answers `hello`, and the attempt is recorded as `ok` with `backendUnchanged: true`. The app then does not flag the older
running release as unexpected, and its release line says "<new> deployed, backend unchanged since <running>". Anything
else — `packages/**`, `package.json`, `bun.lock`, `deploy/systemd/**`, any other path — restarts as below, and so do an
unknown running commit (no `RELEASE.json`), a commit the repository lacks, a failing diff, a server that does not answer
the `hello`, and a target that just received the VAPID key (step 5; the server reads it at start). The app is always
published.

Before each restart the deploy drains the backend instead of waiting for it to be idle: the remote VM almost always has
workers running, so an idle wait would always time out. `deploy/health-check.ts --wait-idle` sends `server.drain` and
then polls it every `DEPLOY_IDLE_POLL_SECONDS` (5) until `toolCalls` is 0, at most `DEPLOY_IDLE_TIMEOUT_SECONDS` (600 =
10 minutes), then restarts anyway and logs that it did. While the drain lasts, every new tool call a model makes, in
every conversation, thread and worker, waits before it starts, so the count of executing calls can only fall. Each poll
asks for the drain again, which extends it by the server's default of 2 minutes, so a deploy that dies leaves held calls
waiting at most that long. Calls a running tool makes (a code mode script's) are neither held nor counted: the script's
own call covers them, and holding them would keep the script running.

What happens to a call held at the restart: the drain holds it in a `beforeTool` hook, before pi-durable commits the
call's intent. Its tool task is still in phase `call`, so after the restart the Harness resumes it from the start and
the tool runs once, as if it had never been held — for every tool, not only `replay: "safe"` ones. (A call cut off
after its intent, which the drain is there to avoid, would rerun only if replay-safe and otherwise reach the model as
`interrupted` and "may have partially run".) A generation in progress is cut off and asked again after the restart;
nothing is lost but its tokens.

A server without the `drain` feature (an older release, a rollback target) gets the old wait: `server.status` until no
conversation and no worker is running, with the same poll and cap. A server that is down, or has neither feature, is
not waited for.

The health check after the restart is deeper than `hello` (`deploy/health-check.ts --deep`): it asks for
`server.status` and fails unless `release.commit` is the deployed commit, then lists the projects and pages a
coordinator conversation (`conversation.page`) for each project that was open before the restart. Projects open lazily,
so right after a restart `projects.list` reports none open; the deploy therefore records the open ones just before
restarting (`--record-open-projects`, into `.open-projects` in the deploy root) and pages exactly those afterwards, which
opens them again. A project that was not open before stays unchecked, so a project with a vanished path cannot block
deploys. Any failure rolls the backend back as before. On a server without the `server-status` feature the commit check
is skipped — it prints that it did — and the rest still runs. It retries until `DEPLOY_HEALTH_TIMEOUT_MS`, so a release
that starts slowly is not rolled back early.

Each attempt ends with `~/.local/share/aiki-deploy/deploy-status.json` on every backend (temporary file, then
rename): `ok`, `failed` (nothing was published) or `rolled_back`, with the commit, its description, a message and when,
plus `backendUnchanged: true` for an `ok` that did not restart the backend, and, on a laptop that came back and is being
caught up, an optional `pending` note (below). The server serves it as `server.status.deploy`, so the app shows the
outcome without reading the deploy log.

### Remote targets, and the intermittent laptop

`deploy/local/targets.json` lists the remote backends: `name`, `label` (log lines say "VM backend: …"), `ssh` (`user@host`),
`tailnet` (the host the deploy requests over HTTP afterwards), `unit` (`user`: a systemd user unit that the deploy
installs from `tools/`; `system`: nix-config's unit, which the deploy only restarts), `bun` (the remote `bun` for a
system unit), `identity` (a private key, passed as `-i … -o IdentitiesOnly=yes`), `shell` (the remote login shell when it
is not bash: commands then go through `bash -c`), `port`, `optional` and `enabled`. `deploy/targets.ts` reads it. The
overrides that existed before still steer the VM (`DEPLOY_SSH_TARGET`, `DEPLOY_TAILNET_HOST`, empty skips the tailnet
check), and every target answers `DEPLOY_<NAME>_SSH_TARGET`, `_TAILNET_HOST`, `_BUN`, `_IDENTITY`, `_SHELL`, `_PORT`,
`_OPTIONAL` (1/0) and `_ENABLED` (0 leaves it out), e.g. `DEPLOY_laptop_ENABLED=0`; `DEPLOY_TARGETS_FILE` names another list.

The laptop is `optional`: it is often asleep or away.

- **Skip, not fail.** Before shipping, `deploy.sh` probes it (`ssh -o BatchMode=yes -o ConnectTimeout=6 … true`,
  `DEPLOY_PROBE_TIMEOUT_SECONDS`). No answer: the log says `laptop backend: SKIPPED …`, `~/.local/state/aiki-deploy/pending/t14.json`
  records the commit, and the deploy exits 0 for it. A laptop that answers and then fails (a health check, a rollback, an
  unhealthy server) is a real failure as for the VM. A step that fails because the laptop stopped answering is taken for it
  going away: pending again, not a failure.
- **A dropped connection never leaves a broken release.** For an optional target `backend.sh` runs with
  `DEPLOY_SURVIVE_DISCONNECT=1`: it ignores SIGHUP and SIGPIPE and writes through a `tee` into `last-deploy.log` in the
  deploy root, so losing the ssh session cannot stop it between moving `current` and the health check (a write to the
  closed pipe used to kill it exactly there). It ends by itself with `ok`, or rolls back. A lock (`.backend.lock`) keeps a
  second run out meanwhile. A half-copied tree sits in `incoming/`, which is never a release, and the next deploy clears it.
  A laptop that suspends in the middle of the restart answers late; its `deploy-status.json` says how it went.
- **Catch-up.** While a target is pending, `watch.sh` runs `deploy/deploy.sh --catch-up <main>` every
  `DEPLOY_CATCHUP_SECONDS` (120), in its own loop, so it never overlaps a deploy it started; `deploy.sh` also takes the
  same lock as a hand deploy (exit 75 when it is held; the watcher tries again). Per pending target it probes and reads
  the target's `current/RELEASE.json` and `deploy-status.json` in one ssh. Still away: nothing, silently. Already on main
  (or recorded `ok` for it, e.g. the deploy finished there after a drop), or its record says main already failed or rolled
  back there: the pending file is cleared (the next move of `main` tries again). Behind: that target alone gets main, no
  app and no host backend. The checks are skipped when a full deploy on this host already ran them for that commit (a
  marker `~/.local/state/aiki-deploy/verified/<sha>`), else they run once and leave the marker. A catch-up that fails
  is not repeated for that commit. A hand version: `deploy/deploy.sh --only=t14`.
- **What the app shows.** A backend that is away cannot say so itself: the app shows it disconnected, and the laptop's
  own `deploy-status.json` is stale until it is caught up. When it answers again and is behind, the catch-up writes a
  `pending` note into that file (`DeployStatus.pending`: `commit`, `description`, `message`, `since`; optional, no new
  feature flag) before it starts, and the release line reads "Catching up to a1b2c3d: back online, deploying …" until the
  real record replaces it. The Android app ignores the field. The skip itself is in the deploy log and the pending file.
- Rollback: `deploy/rollback.sh --target t14 [release]`, and `--list` / `--status`.

### Adding a backend host

1. **nix-config:** the `aiki` system service on the machine (runs `bun run start` in `current` of
   `~/.local/share/aiki-deploy`, as the user that owns the data, `AIKI_ALLOWED_ORIGINS=https://harness.example.test`,
   `AIKI_HOST=0.0.0.0` with the port open on tailscale0 only), a polkit rule so that user can restart it without a
   password, `bun` and `git` on the machine, ssh in with a deploy key (this PC's `~/.ssh/<host>`, listed in the machine's
   `authorizedKeys`), linger for a user unit.
2. **Caddy vhost** on this host: `harness-<host>.example.test` → `<tailnet IP>:7317` (nix-config), so the app can
   reach it over HTTPS.
3. **`deploy/local/targets.json`:** `name`, `label`, `ssh`, `tailnet`, `unit`, `bun`, `identity`, `shell`; `"optional": true`
   when the machine is often off. Check `ssh -o BatchMode=yes <ssh> true` works as this user from this host.
4. **`deploy/local/backends.json`:** `{ "name": "harness-<host>", "url": "https://harness-<host>.example.test" }`, so the app
   offers it. Deploy once by hand (`deploy/deploy.sh --only=<name>`, or the first move of `main`): a target needs a first
   release before `current` exists.
5. **Provider logins** on that machine, as the service user: whatever the models there use (the app's Backends and
   Settings pages start the sign-ins; credentials stay on that backend).
6. **`gh auth login`** as the service user (pull request and issue state and cards), and `acli` if Jira links matter.
7. **Notifications:** the VAPID key pair is copied by the deploy; the FCM service-account key is not: put it in
   `<data dir>/notifications/fcm-service-account.json` by hand (mode 0600) and restart the service.

A deploy refuses to run from inside the `aiki` unit's own cgroup — that is, from a tool of the server it is
about to restart: the restart would kill the script after `current` moved, before the health check and the rollback.
The message points at moving `main`, which is the supported way: the watcher is not in that cgroup.

The app root `/var/lib/aiki-web` is created and owned by `operator` in nix-config, as are Caddy, the
`aiki` system unit and the polkit rule that lets `operator` restart it. The unit must set
`AIKI_ALLOWED_ORIGINS=https://harness.example.test`; nix-config
(`<host-config>/default.nix`) is the only definition of that unit. The VM unit
(`deploy/systemd/aiki.service`, installed by the deploy) sets it too.

Setup once:

```sh
deploy/deploy.sh            # publish the app and both backends now
deploy/install-watcher.sh   # enable and start aiki-deploy-watch
```

The watcher records where `main` is when it starts and deploys only after `main` moves. The deploying user must have linger enabled
(`loginctl enable-linger <user>`, set by hand on 2026-10-30; nix-config leaves it unmanaged, so rebuilds keep it), so the
watcher runs without a session and starts at boot. The scripts do not set linger themselves.

By hand:

```sh
deploy/deploy.sh                       # deploy refs/heads/main now
deploy/deploy.sh <git rev>             # deploy another commit
deploy/deploy.sh --only=t14            # just the laptop (no app, no host backend)
deploy/deploy.sh --catch-up            # what the watcher runs for pending targets
deploy/rollback.sh --target t14 --list
deploy/rollback.sh --list              # VM backend releases
deploy/rollback.sh --target host --list
deploy/rollback.sh --target web --list
deploy/rollback.sh [--target vm|t14|host|web] [release-name]
deploy/rollback.sh --target host --status

journalctl --user -u aiki-deploy-watch -f              # deploy log (this host)
journalctl -u aiki -f                          # host backend
ssh user@vm.example.test journalctl --user -u aiki -f   # VM backend
ssh user@laptop.example.test journalctl -u aiki -f         # laptop backend (when it is awake)
ls ~/.local/state/aiki-deploy/pending                  # targets waiting for a deploy
```

Overrides: `DEPLOY_SSH_TARGET`, `DEPLOY_TAILNET_HOST` (empty skips the tailnet check; both are the VM's, see Remote
targets for the per-target names), `DEPLOY_TARGETS_FILE`, `DEPLOY_PROBE_TIMEOUT_SECONDS`, `DEPLOY_CATCHUP_SECONDS`, `DEPLOY_PORT`, `BUN`,
`DEPLOY_POLL_SECONDS`, `DEPLOY_KEEP_RELEASES`, `DEPLOY_HEALTH_TIMEOUT_MS`, `DEPLOY_IDLE_TIMEOUT_SECONDS`,
`DEPLOY_IDLE_POLL_SECONDS`, `DEPLOY_APP_ROOT`, `DEPLOY_HOST_ROOT`, `DEPLOY_HOST_SERVICE`, `DEPLOY_TARGET`,
`AIKI_VAPID_KEY_FILE` and `DEPLOY_VM_DATA_DIR` (the VAPID key pair, see [Notifications](#notifications)).
