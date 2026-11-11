<p align="center">
  <img src="apps/web/static/icons/icon-192.png" width="64" height="64" alt="Aiki" />
</p>

<h1 align="center">Aiki</h1>
<p align="center"><strong>One conversation. A whole team at work.</strong></p>

Aiki is a personal AI workbench. Talk to one coordinator that plans the work, delegates to background agents, and brings questions and results back to you.

<p align="center">
  <a href="#try-aiki">Try Aiki</a> · <a href="#why-aiki">Why Aiki?</a> · <a href="docs/INSTALL.md">Install guide</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/graph-dark.webp" />
  <img src="docs/assets/readme/graph-light.webp" alt="Aiki's live task graph: three families of connected task cards, a row of status and needs-you counters, search, and small creatures marking active workers and threads." />
</picture>

*A living map of the work. Real app, [synthetic demo](docs/assets/readme/README.md).*

**First pilot: `v0.1.0-pilot.1`.** Linux tested; macOS and Windows through WSL are experimental. Android is a native app installed via APK. No phone push in this pilot.

## Why Aiki?

### Delegate the work, not the context

Give the coordinator the goal. It can split independent work among background workers and keep longer conversations in threads. Pick coordinator and worker models using your own provider accounts.

### See what needs you

A shared task board keeps the plan visible as a **list, board or graph**. The graph groups related work into families; little creatures show where workers and threads are active. Search for a task, family or worker. Questions, warnings and work ready for review surface together, so you can answer on the task instead of searching a long transcript.

### Come back to the work

Durable runs resume after backend restarts. Open the same projects in the web app or native Android app. Read worker reports, open terminals, and inspect artifacts and before/after screenshots attached to tasks.

## Try Aiki

Use the [first pilot prerelease](https://github.com/MitzaCoder/aiki/releases/tag/v0.1.0-pilot.1); downloads become available when it is published. Download and review its installer:

```sh
curl -fL https://github.com/MitzaCoder/aiki/releases/download/v0.1.0-pilot.1/install.sh -o install.sh
# Review install.sh before running it.
sh install.sh --version v0.1.0-pilot.1 --no-service
aiki start
```

Keep the explicit `--version`: `/releases/latest` and unqualified updates ignore prereleases. Use this release's checksums to verify downloads.

In another terminal:

```sh
aiki open
aiki pair
```

Open the one-time pairing URL in the same browser and confirm device sign-in. Then connect a provider, choose a project folder and pick its coordinator model. Keep pairing links private.

The installer brings its own pinned Bun and zellij, plus the web app. No root or global runtime install. You need git; install **jj** for isolated worker workspaces and the tools your project uses. If `aiki` is not found, follow the installer's PATH instruction.

[Download the signed Android APK](https://github.com/MitzaCoder/aiki/releases/download/v0.1.0-pilot.1/aiki-v0.1.0-pilot.1-android-universal.apk) (Android 12+). Your phone needs your own backend reachable over HTTPS, for example with assisted Tailscale setup. The APK is not a tunnel.

[Full install guide](docs/INSTALL.md) · [Pilot notes and limits](docs/releases/v0.1.0-pilot.1.md) · [Android build instructions](apps/android/README.md)

### Install with your coding agent

Give your agent this prompt:

> Install Aiki from https://github.com/MitzaCoder/aiki. Follow docs/AGENT-INSTALL.md exactly and stop where it says to ask me.

The [agent guide](docs/AGENT-INSTALL.md) checks the install and pauses for your sign-ins and choices. It includes a source fallback if the pilot download isn't published yet.

## One plan, different views

Prefer columns? The same tasks are a board, too. See what's working, blocked, waiting or ready for review without losing the questions attached to each task.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/board-dark.webp" />
  <img src="docs/assets/readme/board-light.webp" alt="The same synthetic project in Aiki's board view: task columns, assigned workers, review questions and waiting notes." />
</picture>

## Your machines. Your providers.

- **Several backends, one app.** Each backend runs agents and tools on its own machine, with its own storage and credentials. The app brings their projects together.
- **Bring your subscriptions or API keys.** Provider sign-in runs through pi-ai, not the Claude Code or Codex CLI. Subscription eligibility and provider policy apply; API keys are an alternative. Model usage is billed by your provider.
- **Pair your devices.** Fresh installs require device sign-in. Phone access needs separate HTTPS/network setup; the local installer stays on loopback. A pairing link is not a tunnel.
- **Notifications, with limits.** Web Push and native notification plumbing exist. Independent-user Android push is not a ready pilot feature; do not rely on phone alerts yet.

Aiki runs commands with **your user permissions**, filesystem access and provider spending authority. Each approved device has full owner access. Use your own backend; this is not a sandbox or a multi-user service. Do not expose its port to the internet.

## Built in the open

Built on [pi durable](https://github.com/earendil-works/pi/tree/main/packages/durable), with a Bun/TypeScript backend, Svelte web app and Kotlin/Compose Android app.

[Design](docs/DESIGN.md) · [Source setup](docs/INSTALL.md#development-and-release-testing) · [Operator reference](docs/OPERATIONS.md) · [Report an issue](https://github.com/MitzaCoder/aiki/issues)

Original Aiki code is [MIT-licensed](LICENSE). Bundled dependencies, fonts and icons keep their own licences; see the notices alongside them and [Android licences](apps/android/licenses/).
