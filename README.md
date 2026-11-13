<p align="center">
  <img src="apps/web/static/icons/icon-192.png" width="64" height="64" alt="Kemiri" />
</p>

<h1 align="center">Kemiri</h1>

Kemiri is a personal AI workbench: one coordinator delegates to background agents and brings questions and results back to you. [kemiri.dev](https://kemiri.dev)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/graph-dark.webp" />
  <img src="docs/assets/readme/graph-light.webp" alt="Kemiri's live task graph: soft clusters of task bubbles, relationship lines, and small creatures marking active workers and threads." />
</picture>

*Real app, [synthetic demo](docs/assets/readme/README.md).*

## Why Kemiri?

- **Delegate work.** Give the coordinator a goal; choose models from your own providers.
- **See what needs you.** Tasks, questions and reviews share a list, board or graph.
- **Come back later.** Runs resume after backend restarts; reports and artifacts stay with tasks.

## Upgrading existing installations

Use `kemiri` for commands and `KEMIRI_*` for settings. The next release removes
the old command and process-setting aliases. Startup rewrites old keys in its own
server.env once, preserving values and an original .bak; when both keys exist,
KEMIRI wins and the old assignment is dropped with a key-only log message.
Rename process/build settings yourself before updating. Existing installation
folders, credentials, pairings, service names and project context stay put.
Do not rename or delete them. Fresh installs use Kemiri folders. Pilot.4 is the
bridge: pilot.3 and earlier must update through it before the next release.

## Try Kemiri

[Current pilot: `v0.1.0-pilot.5`](https://github.com/MitzaCoder/kemiri/releases/tag/v0.1.0-pilot.5). Linux tested; macOS/WSL experimental; no phone push.

```sh
curl -fL https://github.com/MitzaCoder/kemiri/releases/download/v0.1.0-pilot.5/install.sh -o install.sh
# Review install.sh before running it.
sh install.sh --version v0.1.0-pilot.5 --no-service
kemiri start
```

Alternative download: `curl -fL https://kemiri.dev/install.sh -o install.sh`, then the same review/run steps. This small [bootstrap](site/install.sh) verifies the versioned GitHub release installer before running it. Keep `--version`: GitHub's latest release excludes prereleases. Verify direct downloads with the release checksums. You need git; install jj for isolated workers. The installer prefers a standalone executable on Linux x64/arm64 and macOS arm64; private Bun remains a fallback. It also supplies zellij.

Short version: `curl -fsSL https://kemiri.dev/install.sh | sh`.
From pilot.3 or earlier, stop it, run `aiki update --version v0.1.0-pilot.4`, then `kemiri update --version v0.1.0-pilot.5` and `kemiri start`. Keep existing folders. For a user service, use `aiki service remove` before updating and `kemiri service install` afterwards. Install the new Android APK over the old one (same signing key).

In another terminal:

```sh
kemiri open
kemiri pair
```

Open the private pairing URL in the same browser. Then connect a provider, choose a project folder and pick a coordinator model.

[Download the signed Android APK](https://github.com/MitzaCoder/kemiri/releases/download/v0.1.0-pilot.5/kemiri-v0.1.0-pilot.5-android-universal.apk) (Android 12+). Your phone needs your backend reachable over HTTPS; the APK is not a tunnel.

### Install with your coding agent

> Install Kemiri from https://github.com/MitzaCoder/kemiri. Follow docs/AGENT-INSTALL.md exactly and stop where it says to ask me.

The [agent guide](docs/AGENT-INSTALL.md) covers checks, sign-in boundaries and a source fallback.

## Board view

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/board-dark.webp" />
  <img src="docs/assets/readme/board-light.webp" alt="The same synthetic project in Kemiri's board view: task columns, assigned workers, review questions and waiting notes." />
</picture>

Kemiri runs commands with **your permissions** and provider spending authority. Every paired device has full owner access. This is not a sandbox or multi-user service. Keep the backend private.

Built on [pi durable](https://github.com/earendil-works/pi/tree/main/packages/durable). Original code: [MIT](LICENSE); dependencies keep their own licences.

[Install guide](docs/INSTALL.md) · [Pilot notes](docs/releases/v0.1.0-pilot.5.md) · [Design](docs/DESIGN.md) · [Operations](docs/OPERATIONS.md) · [Issues](https://github.com/MitzaCoder/kemiri/issues)
