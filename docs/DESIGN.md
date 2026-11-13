# Design

## Public site and documentation identity (T167)

Kemiri is the public product name; canonical marketing and support addresses are
`https://kemiri.dev` and `support@kemiri.dev`. The public repository is
`https://github.com/MitzaCoder/kemiri`. This marketing move does not move paired
backend origins, OAuth callbacks, persisted identities or installed data. Current
guides use `kemiri` and `KEMIRI_*`; the `aiki` command and `AIKI_*` settings remain
compatible until a later release. Historical release notes and protocol literals
keep their original names. See SITE.md for the owner-operated DNS/mail cutover.

## Kemiri compatibility bridge (T167)

Kemiri is the command and fresh XDG config/data default; `aiki` remains a same-root
launcher alias. Recorded installation paths, service paths, ownership markers and
storage/wire identities remain authoritative. Existing default `aiki` directories
are reused without copying; independent populated defaults require an explicit path.
Settings resolve process KEMIRI → process AIKI → file KEMIRI → file AIKI → default.
Both prefixes are private and scrubbed from children, which receive both child markers.
The bridge publishes canonical Kemiri assets and explicitly compiled legacy Aiki
version-probe binaries for pilot.3. Installed wrappers use `--kemiri-version` for
those binaries; source archives retain the `aiki/` layout and `scripts/aiki.ts` entry.
Updates never rename a service or migrate data. Both task trailer spellings are read;
agents continue writing `Aiki-Task:` until the dual reader is deployed.

## Versioned full-height HTML previews (T165 / T166 / T162)

Resolve the selected retained snapshot before reading its bytes, then apply the current-theme prelude to those bytes.
Web keys the player and its source lease by the selected immutable address; Android renews and reads that address
before rebuilding the origin-less WebView document. Bare IDs still follow latest, and pinned IDs keep their snapshot.
Android's HTML branch stays outside the details scroller: version controls and Page/Source sit above a weighted WebView,
with metadata and actions behind Info. WebView owns scrolling and pinch zoom. Web frames also allow modal dialogs
for printing (owner approval Q188); origin isolation remains unchanged.

## HTML artifact design and privacy (T165 / D74)

Every project is offered the bundled `html-artifacts` skill through the ordinary lazy skill catalogue. Only its name,
short description and read path enter the prompt; the body and four self-contained templates are read on demand.
User/project design instructions outrank the defaults. Source and binary releases both ship the skill and templates.

HTML previews on web (dialog and new tab) and Android prepend theme defaults with zero-specificity selectors, matching
`--tone-*` colours, type, spacing and radius tokens. The document's `data-theme` follows the app's light/dark choice;
changes reload an open preview (interactive page state resets). Author styles still win. A floating Print control and
print CSS are supplied without granting an app origin: web never grants `allow-same-origin`, Android never adds a bridge.
Android maps `window.print()` to a gesture-checked internal navigation handled by native PrintManager.
Q188 permits `allow-modals` in both web artifact frames, so the visible Print button can open the browser's print dialog.

The per-project **Block artifact pages from sending data** switch defaults off. Restored previews fail closed until
their project's summary arrives, so an enabled policy never has a brief unprotected first load; a known older project
without this field defaults off. On, a first-in-head meta CSP allows
inline scripts/styles and cdnjs, HTTPS/data/blob images and media, cdnjs/data fonts, but denies fetch/XHR/WebSocket and
form submission. This reduces outgoing channels, not all exfiltration: allowed image/media/CDN requests and explicit
external navigation can still send data. It is not a promise of an offline page. Google Fonts only work with the switch
off; self-contained files need no network. A later page policy cannot loosen the injected policy. Opaque-origin
isolation remains the primary boundary, whether CSP is on or off. The pinned library list lives with the skill.

## Artifact versions (T166 / D74)

Identity is project + scope + sanitized file basename (case-sensitive). A task ID is the scope when supplied,
otherwise the conversation (thread ID + worker ID). Workers on one task can update the same artifact. Titles and
source directories are not identity. Omitting/changing taskId changes scope. Re-saving appends a snapshot of bytes and all metadata,
including saver thread/worker and saved time (`createdAt`), and replaces the card under its stable artifact ID.
`artifacts.list` includes retained version metadata; optional `artifactId` finds one outside the recent-list window.
`artifactId~version` addresses a snapshot with the existing signed URL API. A bare ID follows latest, including board references. URL minting pins even latest to a version so an already
issued capability cannot change content. HMAC binds the full version address; all existing auth and sandbox rules stay.

Legacy index rows read as version 1 without writes or byte moves. Only the next save extends their metadata. Existing
same-name cards are not merged retroactively (no lost IDs or history). Version 1 retains its original file location;
new snapshots use `<artifactId>.versions/<number>/<name>` (a sibling cannot collide with any legacy filename).
A project write queue serializes copy/index publication; replay receipts keep a durable tool rerun from creating
another version. Keep the most recent 20 snapshots
(`ARTIFACT_VERSION_LIMIT`), with monotonic numbers even after pruning. Publish the index before pruning old bytes;
a crash can leave extra bytes but never references missing bytes. Deleting the artifact deletes all versions.
Web and Android artifact dialogs and full-screen media viewers select retained metadata and fetch its version address;
cards show the total saves. Old servers still show a single snapshot without controls. Editing tags targets latest,
not an older snapshot. Bare-ID web preview leases refresh on the version push; Android poster and image-cache keys
include the version so a new card thumbnail cannot reuse old pixels. Source diff is deferred.

The tool API is unchanged. Re-saving answers `Saved version 3 of report.html`; the description's added sentence is
66 UTF-8 bytes, +13 cl100k_base / +14 o200k_base tokens (measured with js-tiktoken; descriptions 194 → 207 / 208).
No tokenizer is added to the app or tool.

## MCP preset catalogue and registered OAuth apps (T157 / D73)

Add server offers a searchable catalogue grouped by issue tracking, code, docs,
observability, cloud, databases, design and productivity, and browsers and testing.
Presets describe authentication, link vendor documentation and token/app creation,
and never connect or enable a project automatically. Command presets populate the
existing exact-command review, including environment-secret names. Read-only vendor
routes are preferred. Only documented, non-secret URL options are allowed; access
credentials never belong in a URL.

Registered OAuth apps use pi-mcp's `clientId` / `clientSecret` settings, not a
second OAuth implementation. Users register the exact displayed web-origin callback
`/mcp/oauth/callback`, then paste an app ID and optional secret. Both stay only in
backend MCP credentials; forms clear before sending and neither is returned in
catalogue responses. The callback and settings survive refresh/restart, while PKCE,
state, issuer, one-use completion and paired-session binding remain unchanged.
Local installs accept the two fixed loopback shell origins from T156; a vendor may
still require an HTTPS callback or administrator app approval. Unsupported vendor
OAuth discovery is not presented as a working integration.

Atlassian and GitHub explain that agents often work better with acli / gh. Their
button submits a plain setup request through the existing coordinator conversation
submission path, then opens that chat. Select a project on this backend if none is
selected; do not create a project, install software or sign in automatically.


## Installed self-update (T139 / D65)

Only a managed release started through the installed CLI's supervisor can self-update.
Source checkouts, `--ref` installs and deploy-watcher backends report a reason instead.
Any authenticated paired owner can start/cancel an update; the session ID and action
are logged, never its token. Clients confirm the exact from → to version and link
release notes. Restart anyway is offered only after the wait cap and requires a separate confirmation.

The existing installer gains stage-only mode: identical platform selection,
checksum verification and private Bun fallback, but no activation, launcher rewrite
or garbage collection. Backend-wide state is persisted separately from update
notices. After staging, acquire the deploy watcher's `ToolCallDrain` hold: new
model tool calls wait in pi-durable's `beforeTool` hook, before execution intent.
Only already executing calls delay the switch; conversations, workers, generation
and opening harnesses do not. Held calls resume after restart. Nested calls belong
to the already running outer call and are not held separately. With zero executing
calls the backend switches immediately. Cancel releases the hold without changing
the release. After `AIKI_UPDATE_WAIT_TIMEOUT_MS` (default 300000 / five minutes),
the waiting state shows command names and elapsed time plus Restart anyway and
Cancel. The cap never silently releases calls or forces a restart; a second
confirmation warns that running commands may be interrupted and unsafe to retry.
New admission is blocked only during the final switch.
No URL, shell argument or service name comes from a client.

`kemiri start` is a persistent supervisor, both in a terminal and as the service's
main process. It owns its child, stops it before activation, starts the selected
release and probes the owner-only health socket for up to 30 seconds. Failed
activation/startup/health restores the retained release using the same code swap
as `kemiri rollback`, then starts it again. systemd and launchd keep supervising the
same parent: no service-manager command or detached cgroup escape is needed.
The small supervisor remains resident until a full stop/start; later releases must
keep its transaction/health contract backward-compatible. An interrupted switch is recovered from the persisted transaction on next start.
Clients reconnect normally and read the persisted outcome. Code rollback cannot
undo data migrations; release authors must retain backward-compatible storage.

Pilot.3 and older releases lack this supervisor/API and require one manual `kemiri update` while
stopped before one-click updates are available. Android updates the backend, not
its APK. Native macOS service behavior requires native rehearsal.

## Version in navigation (T155)

The desktop projects sidebar and phone drawer reserve a quiet footer link below
Usage and Settings for the connected backend's identity. It opens Settings →
About, where update notices remain available with release notes, the exact
manual `kemiri update` instructions and per-version dismissal. An enabled,
undismissed update changes the footer to `Kemiri v… → v… available` plus an accent
dot; dismissal removes that announcement, not the running version or About's
details. Eligible installed backends also expose T139's Update now control here
and beside this navigation footer. The former chat update banner is removed on both clients to avoid a
duplicate notice. Existing Android updates also use notes/manual backend update
instructions; no APK installer path is introduced. The collapsed rail uses `v` with
the full label as its accessible name and tooltip. Both clients follow the open
project's backend; outside a project they prefer the first ready backend, then
the first configured one. A reconnect retains its last known identity.

Version precedence is installed release (`server.status.updates.installedVersion`),
release tag or short commit (`server.status.release`), then `dev` for a known
source checkout. Before status arrives, or on older backends without status,
hello's server version is the fallback. Installed metadata is the identity used
by `kemiri version`; packaged `release.name` is also used by standalone
`aiki --version`. Hello's package constant alone cannot identify a source deploy.
No answer means unknown, not the client's version presented as the backend's.

**Update controls stay quiet (T161).** The footer spot, About and the update dialogs use the app's shared `Button`
variant and size tokens instead of hand-made tall buttons. Only the one action that starts an update keeps the primary
emphasis (`Update now` in the footer spot and in About, `Confirm update` in the dialog); Cancel, Restart anyway,
Release notes and the About Dismiss are ghost/text controls at text or icon size. Restart anyway keeps its warning
colour and explains itself in a title; every icon-only control carries an `aria-label` and a tooltip. Nothing here is
`min-h-11` any more: the footer spot must not look like a form submit in the sidebar.
Web adds its bundled package version only
when it differs; Android uses the same backend text and keeps its own build in
About. Labels normalize a release's optional `v` prefix. About also shows the
backend identity for source checkouts; no protocol or polling change is needed.

## Chat file attachments (T140 / D66)

Chat accepts arbitrary files without unpacking archives. Uploads go to private,
per-conversation `attachments` directories beneath backend project data, never
into the project checkout. Each file is capped at 50 MiB; server-generated IDs
and sanitized, ID-prefixed basenames prevent traversal and collisions. Original
safe names stay in chip metadata. Downloads
use authenticated backend HTTP requests, force attachment disposition and disable
sniffing. `ChatFileStore.removeConversation` removes the entire conversation folder;
project-open reconciliation removes folders for absent durable conversations.
Kemiri currently archives conversations rather than deleting them; archives retain
files because their transcripts and download links still exist.

The additive `chat-files-v1` feature leaves protocol version 1 and existing image
blocks intact. New clients upload bytes over HTTP (not the 32 MiB WebSocket), then
submit opaque file IDs. The server resolves only files belonging to that
conversation and adds a short name/size/MIME/absolute-path line to ordinary message
text, so old clients and workers can read it too. Small UTF-8 text-like files
(under 100 KiB) are additionally fenced with their name. Binary and large files
remain path-only; archives stay zipped. PDF native input is capability-gated by
both pi-ai's content types/provider adapters and model modalities, not by model
name. Where the installed pi-ai cannot represent documents, PDFs use bounded text
extraction rather than invented provider blocks. `unpdf` 2.1.0 (MIT; bundled PDF.js
Apache-2.0) is pure JS with no required native dependencies. It is lazy-loaded on
first PDF use and remains embedded in Bun-compiled executables. Extraction walks
at most 200 pages and inlines at most 100 KiB UTF-8, with page count, truncation
notice and original tool path. Image-only, encrypted or malformed PDFs keep their
original path without extracted text; no OCR, rendering or archive expansion.
Installed pi-ai 1.5.1's `UserMessage.content` is text/image only and its
`MODEL_INPUT_MODALITIES` is `["text", "image"]`. Its Anthropic, OpenAI and Codex
adapters expose no document/file content block. Therefore **no current model gets
native PDFs**. Upstream would need document/file user-content types, catalog PDF
modality/limits and Anthropic Messages document / OpenAI Responses input_file
conversion (including the Codex adapter), plus replay/serialization support.

Web and Android main/background chat composers show removable name/size/type
chips before send and downloadable chips in history. Their pickers, web drop/paste
and Android share intents accept any MIME. Task-sheet reply pickers use the same
file upload path to main's conversation, carrying the task ID on submission.
Existing image behavior stays compatible. All uploaded content is untrusted
user input, never harness instructions. HTTP upload is `POST /attachments/<projectId>`
with raw bytes, Content-Type, `name` and optional `threadId` query parameters;
response metadata is versioned by the advertised capability. `fileIds` on submit
are resolved within that conversation only. The transcript's text suffix
`[aiki-files-v1]` carries JSON metadata lines followed by optional fenced text;
clients hide this suffix behind chips while old clients read it as ordinary text.
HTTP download is the metadata's backend-relative `/attachments/<project>/<conversation>/<id>`;
both operations require device authentication except in explicitly off mode.
Files omitted from a composer are retained until conversation cleanup, so another
queued message or client can still reference them. Raw binary files use HTTP,
not oversized WebSocket submissions. Only metadata enters Android saved state.
Legacy native images retain their existing transport; small inline file text also
travels in ordinary transcript updates.

Name: Kemiri (command and fresh data directory: `kemiri`; legacy aliases remain supported).

## Pilot release identity and notices

Release CI has an explicit `check-public.ts --public-ci` mode: generic source checks
and mandatory Gitleaks still run; only the unavailable private-term scan is skipped.
Local/default checks remain fail-closed without the ignored private denylist, and the
owner must run them on the exact proposed public refs before a tag push. Tag automation
stages a draft, not a public release, so the owner can attach/review local signed assets.
No signing key or password is stored in the repository or GitHub. Release CI installs
hash-pinned jj before root tests: workspace/schedule/storage integration tests require
the real tool, not an optional skip. Toolchain versions are reported. Deploy fixture
ordering uses a shared request/restart trace rather than comparing external date
output with JavaScript wall-clock values; production deployment behavior is unchanged.
See `docs/research/pilot-release-ci.md` for runner failure evidence and reproduction.
The same read-only checks job runs for manual dispatches and the temporary release-
check branch; only successful push-tag events enter the separate write-permission
release/draft job. CI pins and hashes the dedicated CFT headless shell, not the
runner's rolling desktop Chromium. Browser tests share bounded process-group
ownership, concurrent output collection and explicit CI sandbox/resource settings;
real DOMPurify coverage remains required. See that research note for the pin and
local developer override.

The neutral Android signing script uses an empty external properties file, `env -i`
and explicit public build overrides; package ID is `io.github.mitzacoder.aiki` and
Firebase/relay/backend suggestions are empty. Version inputs are `aiki.version`, then
`AIKI_RELEASE_VERSION`, then the CI tag. Android names omit `v`; numeric codes allocate
major/minor/patch slots and order pilot N below stable (formula in Android README).
Dev builds default to `0.0.0-dev` / 1. Keep package, signing certificate and storage
prefixes stable across upgrades. Local owner signing, backup and manual APK attachment
are the pilot path; no deployment or main move is part of releasing.

Android Settings has an offline About and licences section. Explicit LGPL-2.1 Sora
0.24.6 notices/source/relinking instructions and bundled font/Termux notices supplement
the Google OSS plugin's generated release dependency catalogue. A separate notices-and-
source asset includes pinned upstream source and the matching Aiki commit snapshot.
Java/AAR inputs become combined DEX; an already signed APK cannot simply load a replaced
JAR. The documented rebuild path permits modified-library debugging, with a separately
signed/identified APK. These are technical materials, not legal certification; the
publisher still reviews the final distribution. See `docs/RELEASE.md`.

## Standalone executable builds

`build-binary.ts` compiles a clean neutral source/web release with pinned Bun 1.4.4. A single
`packaged-resources.ts` boundary is replaced at build time: exact web URL/file imports, explicit
bundled worker files, QuickJS/Photon WASM and release metadata. Dependencies are not rewritten.
Static assets stay inside Bun's executable filesystem, with no extraction/cache race. Codemode
keeps upstream's off-thread timeout/cancellation; Photon uses serialized disposable image workers,
not the spike's blocking host-thread fallback. Binary entry registration covers variable OAuth
and Bedrock loaders; source installs keep their published dependency layout.

The binary's standalone CLI starts the same server/private-settings dispatcher and provides
owner-socket status/health, auth/pair, version and print-config. Static SPA serving reuses the
installed server's fixed loopback host/origin, path, MIME and cache rules. Implicit Bun dotenv,
bunfig, tsconfig and package autoloading is disabled; explicit Aiki server.env loading is retained.
Fresh state still requires device sign-in. Generic release metadata never discovers a deploy root.
Embedded version metadata alone does not mark a standalone run as installed: release-update checks
remain off until explicitly enabled or supplied an installed-release identity.

Native standard-runner CI builds Linux x64 baseline, Linux arm64 and macOS arm64, runs isolated
no-Bun-on-PATH production/faux acceptance and generates checksums. The existing tag-only draft
job rechecks/downloads these beside its source/installer assets; no auto-publication is added.
Canonical `kemiri-TAG-PLATFORM` binaries print `Kemiri TAG`. Explicit `--legacy-version-probe` builds
`aiki-TAG-PLATFORM` binaries printing exactly `Aiki TAG` for pilot.3’s old installer. Both expose
`--kemiri-version`; installed wrappers use it for user version requests and fall back for old releases.
Source assets are published under both names, with identical `aiki/` top-level layout. All assets get
independent checksum entries. Activation creates both launchers even when invoked by the old installer,
honors recorded launchers and refuses unrelated files before switching links. Existing `.service-path`
selects the service; update does not rename or duplicate it.

Binary releases also embed the shared installed CLI and installer script. The installed launcher selects the
current release's executable, or its source CLI with private Bun; bare standalone runs still have no installation
identity. Binary updates unpack only the installer script into an owned 0700 temporary directory for the host
shell, then remove it. Host tools remain external. See [build measurements and limits](research/single-binary-build.md).


## Installed-release update notices

The installed CLI passes its recorded version/channel in the private settings snapshot; `--ref` and source/deploy
entry points do not. Installation metadata remembers pilot/stable, inferred from the first tag for old installs;
`kemiri update --channel` changes it only after successful activation. Explicit `--version` wins; rollback swaps code
without changing channel or data. Both CLI selection and notices use SemVer ordering, including numeric prereleases.
The CLI queries the public releases list then uses the existing checksum-verifying installer, with no auto-restart.

`release-updates.json` in backend data holds the opt-in/out, per-version dismissal, ETag, channel candidates and
next-check budget. Default checks require an installed release; an explicit About switch enables source checkouts.
A 60-second startup delay and persisted 24-hour request floor include errors/restarts. Conditional unauthenticated
GitHub requests have a 15-second timeout, no retries/pagination; 403/429 extend the floor with Retry-After/reset.
Offline/invalid responses keep the last cache quietly. Corrupt settings fail closed without stopping the backend.
`release-updates` advertises `server.updates.set`; optional `server.status.updates` has `schemaVersion: 1`, so old
clients keep working. Settings/dismissal are backend-wide, across projects and devices. Web/Android About retain
the row after dismissal; the navigation version footer announces undismissed updates (T155), replacing the original
chat banner. Notices alone never download or install; an owner-confirmed self-update
uses the separate T139 transaction above.

## Local installer and first run

The public installer prefers a versioned executable for Linux glibc x64/arm64 and macOS arm64. It validates
both the exact-name `.sha256` sidecar and `SHA256SUMS` entry before chmod/execution. Only a missing asset (404),
an unsupported binary platform, or explicit `--runtime bun` chooses the source/web archive and private,
checksum-pinned Bun runtime; network or checksum errors fail closed. Source/ref/local-archive installs retain
that Bun path. macOS x64 and Linux musl use pinned Bun; Windows uses WSL. Release CI includes the aggregate
manifest alongside the existing checksums and still creates drafts only. `~/.local/bin/kemiri` and its
`aiki` alias select the same immutable release under `${XDG_DATA_HOME:-~/.local/share}/kemiri`
for fresh installs, with separate `data/` and XDG config. Legacy recorded/default roots are retained. `--dir` puts configuration there too,
for isolated installs. Updating prepares dependencies before switching `current`; `previous` retains one rollback
candidate. Manual CLI updating/rollback never restarts a running process or reverses storage migrations: stop first and
back up before upgrades. Uninstall preserves data/config unless explicitly purged. The owner's `deploy/` remains
independent; no installer action uses its units, roots or watcher.

Both runtime types use T137's `.aiki-install.json` version/channel, explicit data/config targeting and installed
private settings. Executable presence selects runtime, not identity. Explicit same-tag runtime changes use
`TAG-bun`/`TAG-binary` release directories, with an optional directory name in that same metadata; normal releases
keep the legacy version-only layout. Each current/previous link, metadata file and launcher is replaced
atomically; they are not one filesystem transaction.
A retained binary lifecycle driver activates historical Bun releases so their older CLIs cannot strand rollback
behind a Bun-only launcher. Rollback preserves channel and mutable data, including across runtime types.

The installed CLI and standalone binary opt into `AIKI_WEB_DIR`. The server then serves the static SPA after API routes, with
GET/HEAD, safe path resolution, no-store HTML/service-worker responses and immutable hashed assets. Its fixed
loopback origins are accepted for WebSockets; no reflected Host/Origin allow-list. `/aiki-local.json` advertises
same-origin discovery; hosted builds without this endpoint retain their existing multi-backend setup. Fresh local
installs bind loopback only and retain required device authentication. The public shell and discovery do not grant
API access. `kemiri pair` delegates `pair --local` to the existing owner-only socket, printing its ten-minute one-time
URL and the code already included in that URL. Existing `/pair` confirmation signs this browser in; no auth protocol,
mode downgrade, automatic grant issuance or remote exposure is added. Pairing output is sensitive, never a server log.

Before authentication, local Welcome explains `kemiri pair`; provider/project data is not requested or displayed.
After pairing, a fresh local backend with no provider/project shows Welcome, reusing account settings and the folder picker.
Credentials stay on the backend and providers remain direct pi-ai integrations; paid API keys are a clear option,
and subscription sign-in remains subject to the provider's terms. After adding a folder, existing project settings
choose the coordinator model. Generic release builds never include personal backend suggestions or local config.

The installed CLI builds an explicit private snapshot with T82’s `childEnvironment` and `loadServerEnv`, naming its
owned env file/data/config plus loopback and static assets. It passes that snapshot to the same `runServerEntry`
used by the source executable; it never populates `process.env` with server settings. File-selected port settings
therefore work too; explicit `AIKI_PORT` remains the one supported calling-shell server override. Every CLI-spawned
helper uses `childEnvironment`. `kemiri auth ...` delegates the existing owner commands with that explicit target;
`kemiri pair` addresses its recorded owner socket and uses the actual owner-provided URL, independent of shell port
settings. Normal, SSH and `AIKI_CHILD_PROCESS=1` shells use the same target. PID bookkeeping is update safety only;
the shared T82 socket preflight decides whether backend data already has a live owner.

## Installation identity and private compatibility

Server settings accept canonical `KEMIRI_*` and legacy `AIKI_*` inputs. Fresh installations use XDG `kemiri`
data/config folders; existing defaults are reused in place. Independent populated old/new defaults require an
explicit selection. Recorded installation paths win and no service is renamed. The entry point loads one optional
`server.env` from the selected config root (`KEMIRI_ENV_FILE` beats `AIKI_ENV_FILE`) before identity imports.
Precedence is process KEMIRI → process AIKI → file KEMIRI → file AIKI → default. Empty values retain each
setting’s semantics. A missing default file is fine, but an explicit missing file is an error. Conflicting aliases
produce one stderr warning with names only, never values or machine-readable stdout.
`--print-config` resolves paths, binding and origins without opening data or starting a listener.

### Server settings and child commands

The executable reads process settings plus the private env file into an immutable internal `serverSettings` object
before importing identity-bearing modules. File values never enter `process.env`; after capturing the real environment,
the executable removes both `AIKI_*` and `KEMIRI_*` settings there too. Existing resolvers read the private object, so deploy/unit
settings, precedence, owner CLI lookup and import-time storage identities remain unchanged. Programmatic server users
retain process-environment defaults unless they explicitly configure that object.

Every host process uses the shared `childEnvironment` helper: pi's execution environment (coordinator, worker,
background thread, scheduled worker/thread, direct bash/powershell and codemode calls), terminal PTYs and zellij/scope
commands, workspace `jj`, memory `git`, host `git`/`jj`/`gh`/`acli`, and artifact `ffprobe`. Both private prefixes
are removed, including unknown future settings and per-exec overrides. No internal command needs the server's settings.
Only **`AIKI_CHILD_PROCESS=1` and `KEMIRI_CHILD_PROCESS=1`** are generated, never copied. Either marker tells
a nested entry point not to rediscover the parent's `server.env` through inherited HOME/XDG directories. An explicit
`KEMIRI_ENV_FILE` (or legacy alias) still opts in; explicit new data/config settings still work. Intentional
owner CLI invocations from an agent therefore require an explicit installation env file or data-directory setting;
marker-only `auth` refuses before connecting, even if the user's default data directory has a live owner. For example:

```sh
AIKI_CHILD_PROCESS=1 AIKI_ENV_FILE=/path/to/private/server.env bun packages/server/src/main.ts auth status
AIKI_CHILD_PROCESS=1 AIKI_DATA_DIR=/path/to/backend-data bun packages/server/src/main.ts auth status
```

These explicit routes also support pair/devices/mode/migration commands. Server-start ownership checks are never run
by the `auth` branch: the owner CLI connects to the running owner's socket instead of opening backend state.

PATH, HOME, XDG directories, locale, SSH agent, provider and other tooling variables remain inherited, including
worker-selected `HARNESS_ANDROID_DEVICE` and Android SDK variables. Terminals additionally retain their existing
service-manager/zellij scrub and terminal defaults. This prevents accidental installation reuse, not deliberate access:
agents still run as the backend's OS user. Same-user default data paths may coincide. Always use explicit temporary
data/config directories for source-server experiments; do not rely on changing only HOME or the port.

Every spawn must pass its environment explicitly. In this Bun version an implicit `Bun.spawn` can use the native
startup environment even after `process.env` was changed. Likewise pi merges `process.env` back into `shellEnv`, so
`AgentExecutionEnv` forces `inheritEnv: false` with a fully constructed child environment. A spawn-inventory regression
requires review of new direct spawn sites; do not bypass the shared environment for new helpers. Deployment remains
outside this path: the watcher installs private env files and systemd starts the server itself, not an agent command.

Before touching any data directory, startup probes its owner Unix socket. A live listener refuses startup with a clear
message after retrying a live listener every 100 ms for up to 3 seconds; timeout/unknown errors fail closed rather
than unlinking the socket. A missing/refused socket allows startup immediately, and stale socket cleanup remains
supported. Shutdown retains the owner socket through all asynchronous writes and releases it last. Tests cover an
immediate restart, a stale socket and a new start while the old stop is still flushing (150 ms overlap). Systemd
already waits for the old process to exit before starting its replacement; the extra grace period is below deploy's
20-second health budget. This is a small second defence, **not an exclusive lifetime lock**: simultaneous first
starts and existing servers with owner control disabled are not covered. A full race-proof directory lock is follow-up.

All backend legacy `AIKI_*` inputs are listed below; every row also accepts the same suffix with `KEMIRI_`. Consumers use the private snapshot (explicit process settings beat env
file values; explicit programmatic options still win). Only the loader captures the raw incoming environment. An
exact-statement regression guards the capture/child-environment boundaries against new direct `process.env` or
`Bun.env` reads, including aliases and computed keys.

| Settings | Consumer |
| --- | --- |
| `AIKI_DATA_DIR`, `AIKI_CONFIG_DIR`, `AIKI_AGENT_DIR`, `AIKI_CLAUDE_DIR`, `AIKI_HOST`, `AIKI_PORT` | `data-dir.ts` resolvers; entry point/server/runtime/owner CLI |
| `AIKI_ALLOWED_ORIGINS` | `origins.ts` |
| `AIKI_STATE_NAMESPACE` | `state-identity.ts` |
| `AIKI_PROJECT_CONTEXT_DIR`, `AIKI_CONTEXT_EXTENSION` | `context.ts` |
| `AIKI_AUTH_MODE`, `AIKI_BACKEND_ORIGINS`, `AIKI_PUBLIC_URL` | `device-auth.ts`; public URL is the backend-origin fallback |
| `AIKI_PUBLIC_URL` | `artifacts.ts` legacy optional/off origin |
| `AIKI_TRUSTED_PROXIES` | `server.ts` HTTP forwarding/local-bootstrap decisions |
| `AIKI_WEB_APP` | `device-auth-cli.ts` owner pairing URL |
| `AIKI_ARTIFACT_MAX_BYTES` | `artifacts.ts` |
| `AIKI_FCM_KEY_FILE` | `fcm.ts` |
| `AIKI_PUSH_RELAY_ENDPOINT` | `push-relay/settings.ts` |
| `AIKI_VAPID_KEY_FILE`, `AIKI_VAPID_SUBJECT` | `notifications.ts` |
| `AIKI_DISK_LOW_PERCENT`, `AIKI_DISK_LOW_BYTES` | `disks.ts` |
| `AIKI_WORK_FINISHED_MINUTES` | `work-finished.ts` |
| `AIKI_TOOL_CALL_CAP_MINUTES` | `tool-caps.ts` |
| `AIKI_DEPLOY_STATUS_FILE` | `server-status.ts` |
| `AIKI_TERMINALS`, `AIKI_ZELLIJ` | `terminals.ts` (explicit terminal env/options may override) |
| `AIKI_TIMEZONE` | `schedules.ts` |
| `AIKI_INSTALLED_VERSION`, `AIKI_UPDATE_CHANNEL` | Installed CLI identity for the read-only release notice; absent for source/ref entry points |
| `AIKI_WEB_DIR` | `main.ts` private-snapshot opt-in to serving public local SPA assets |
| `AIKI_ENV_FILE` | `server-env.ts` raw startup file selector; private owner-CLI explicit-target guard |
| `AIKI_CHILD_PROCESS` | Generated child marker; `server-env.ts` discovery suppression and private owner-CLI guard |

Deployment's standalone `health-check.ts` deliberately keeps its own read-only env-file/path resolution. It runs in
the watcher/service-user environment, not the backend's command environment; tests cover required owner-socket deep
checks/drain and persisted-mode rollback refusal, including when the backend is stopped.

Durable document/task kinds use `AIKI_STATE_NAMESPACE` (default `aiki`); the context extension and project context
folder can also be configured. These are storage identities, not display names. Set them before the first restart of
an existing installation and keep them stable. This avoids rewriting session identities for a source-name change.
Dependency upgrades can still migrate their own formats; consult the version-upgrade notes before rolling back.

Deployment receives per-target env files from private `deploy/local/server-<target>.env` (`host` for this machine),
installs them atomically in the target's XDG config directory before restart, and never includes them in release
archives. Roots, service identities and private unit sources remain local overrides. Health/drain negotiate protocol
features, never the server's display name. The watcher unit and state directory need not change.

Hosted builds can supply `deploy/local/web.env` with `AIKI_LEGACY_STORAGE_PREFIX`: before stores load, browser state
is copied to empty `aiki.*` keys without removing the source. Service-worker registration state is copied too; old
shell caches are not reused. Public builds configure no legacy prefix. Native builds can override application ID,
preference prefix and notification intent prefix from private Android properties. DataStore and channel names stay
stable, as do the existing `harness://connect` links; `aiki://connect` is also accepted. Signing identity must stay
unchanged to update an installed app. None of this grants backend access or changes the authentication contract.

Decisions so far. Why each was made is noted where it isn't obvious.


## Device sign-in

The backend is the authority; every admitted device is a full owner (shell/file/provider access), not a scoped user.
There is no account service or push relay. TLS and network ACLs are still necessary. Auth does not stop host jobs.

### Discovery, modes and credentials

`GET /auth/status` returns only `{backendId,mode,authVersion:1}`. The random stable backend ID survives address changes
and restart. Pin auth support and the exact backend origin: never fall back to legacy auth after advertisement, follow
redirects with credentials, or send credentials to edited/discovered addresses without authenticated confirmation.
Mode is `off|optional|required`, persisted in `auth.sqlite`. A directory containing pre-existing data without an auth
setting starts **optional**, an empty/new directory **required**. `off` is explicit development only. Owner CLI changes
mode; `AIKI_AUTH_MODE` / `startServer({auth:{mode}})` override for development/tests. Optional retains all old
ordinary RPCs and legacy signed URLs, but anonymous callers cannot manage devices or grants. Required authenticates
before constructing the ordinary connection. Switching required closes all legacy connections, authenticated sockets whose legacy artifact origin is not approved,
and migration enrollment.

Tokens: retained `aiki_s1.<32 lowercase hex session ID>.<43 unpadded base64url characters, 32 random bytes>`;
access `aiki_a1.<32 lowercase hex access ID>.<same random format>`. Retained idle expiry 180 days, absolute 365 days;
access 15 minutes. Only hashes are retained (constant-time secret comparisons), plus encrypted 60-second claim delivery
copies. Storage directory 0700, files 0600. Access held only in client memory; retained web credentials belong in IndexedDB,
Android in Keystore-encrypted separate storage, never address exports, backup, logs or localStorage backend lists.

Refresh every access lifetime. Every 30 days durably stage a fresh retained successor with the **same session ID** before
rotation. POST rotate using the old bearer. Atomically commit old→new; retries with that old token accept only the identical
successor for 60 seconds (including after restart). Coordinate browser tabs. The response never returns a retained token.
Active sockets count as session use, last-used disk writes throttled to one/minute. Revocation/expiry is checked on requests.

### HTTP contract

All bodies/replies JSON, `Cache-Control: no-store`, never cookies or redirects. Errors `{error:{code}}`, with HTTP 400
malformed, 401 invalid/expired credential, 403 revoked/closed migration, 409 used grant or conflicting claim/batch, 429
rate limit (`Retry-After` seconds; RPC errors use `error.data.retryAfter`). Host/Origin rejection uses
`forbidden_host` / `forbidden_origin` with 403 on required/new-auth routes. Unknown resources expose no private content.
Exact allowed Origin CORS on new auth HTTP and required-mode routes;
OPTIONS allows `Authorization, Content-Type` and `GET, POST, OPTIONS`. No wildcard credential CORS. Missing Origin does not
supply authority. Public exchanges below carry their own proofs. Other private HTTP requires access bearer in required.
Body cap 8 KiB. IDs/secrets/labels must be strings, labels <=120, platform <=40, claim IDs 1–80 ASCII alphanumeric/underscore/
hyphen. A client generates random claim ID and `aiki_c1.<32 random bytes base64url>` claim secret **before** redemption and
persists them for lost-response recovery. Pair secrets are `aiki_p1.<32 bytes base64url>`; local bootstrap `aiki_b1.<32 bytes>`.

- `GET /auth/status`: response above; no auth.
- `POST /auth/bootstrap/redeem`: `{requestId,code,claimId,claimSecret,label,platform}` for headless; local URL uses
  `{requestId:"local",code:<aiki_b1 secret>,claimId,claimSecret,label,platform}`. Same claim delivery as pairing, no owner approval.
  Local redemption requires an actual loopback peer, loopback Host, and no proxy forwarding. Ten-minute one-use grant,
  one active bootstrap; five wrong codes invalidate. Only owner CLI creates these (no network “empty server” race).
- `POST /auth/pairings/redeem`: `{grantId,secret,claimId,claimSecret,label,platform}`. Atomic unused→claimed, bad secret
  does not consume. Return **ClaimResult** `{claimId,state,comparisonCode,credentials}`. States `pending|approved|denied|
  acknowledged|expired`. `credentials` null unless approved/delivery still live. Claim-result schema same on every exchange.
- `POST /auth/claims/poll`: `{claimId,claimSecret}` → ClaimResult. Max one/sec/claim. Approvals deliver only to the bound
  claim proof; retryable 60 seconds after issue. Pairing/bootstrap expiry requires re-pairing. Migration delivery follows
  the longer approval/retry rules below; a poll never creates authority without an explicit owner approval.
- `POST /auth/claims/ack`: `{claimId,claimSecret}` → `{ok:true}`; idempotently deletes encrypted delivery. Persist session first.
- **Credentials**: `{backendId,sessionId,sessionToken,accessToken,accessExpiresAt,sessionExpiresAt,rotateAfter}`; timestamps
  ISO8601 UTC. `sessionExpiresAt` is min(idle,absolute); refresh returns updated expiry.
- `POST /auth/session/refresh`: `Authorization: Bearer <retained>`, empty JSON `{}` →
  `{backendId,sessionId,accessToken,accessExpiresAt,sessionExpiresAt,rotateAfter}`.
- `POST /auth/session/rotate`: retained bearer, `{successorToken}` → `{sessionId,rotateAfter}`.
- `POST /auth/migration/claims`: optional only, `{claimId,claimSecret,label,platform}` → ClaimResult. Re-registration with
  same proof updates last-seen without creating a new claim. Pending migration expires after 14 idle days since last seen,
  with a 30-day absolute cap since creation. Poll and re-registration refresh last-seen (disk writes at most once/minute).
  Re-registering an idle-expired proof revives the same claim ID and comparison code within the absolute cap. Denial and
  expired approval never revive. No auto enrollment.

Migration approval is valid for 14 days, independent of pending-claim idle/absolute expiry. Approval records permission,
not a session: the first proof-holder poll mints the session and starts the existing encrypted 60-second delivery window.
An offline device can collect days later, including after required-mode cutover. If delivery lapses without acknowledgement,
the next poll revokes the unacknowledged session before minting a replacement; there is never more than one live session
per claim. Explicit session revocation blocks replacement. Approval expiry revokes any unacknowledged session. Pairing and
bootstrap retain their stricter grant lifetimes and do not remint. ClaimResult fields and authVersion are unchanged.

The migration inventory includes pending, approved (including not yet collected), acknowledged, expired and denied states
and first/last-seen times; `auth migration list --pending --json` filters pending only. All retained migration rows share a
100-claim cap. Terminal rows are purged 30 days after their latest creation, last-seen or approval-expiry timestamp, so
churn cannot exhaust that cap permanently. Owner batch approval remains exact and idempotent.

Clients keep one durable proof per backend, re-register at launch/reconnect, and poll with backoff while open (normally
30 seconds). Expiry and network errors preserve the proof and retry registration; only explicit denial stops migration.
Anonymous optional-mode work continues. The old web build kept its expired proof, so reload/re-registration recovers it.
Android recovers the stage-one ambiguous `migrationStopped` expiry/denial message once when optional with no session or
explicit sign-out; it durably creates a replacement proof before sending. New explicit denials retain the proof and a
separate terminal message. An old ambiguous denial cannot be distinguished from expiry, but recovery never grants access:
the owner must explicitly approve the replacement ID.

Enrollment limits: 5/min/grant+source and 30/min/backend; 10 grants/hour/session, 5 pending/session; 500 global pending
claims (all retained migration rows additionally capped 100); refresh source/global/session limits. Required-mode handshakes additionally
limit source/backend/session attempts (30/120/60 per minute), 100 outstanding pre-auth sockets, five seconds and 8 KiB
for hello. Optional/off legacy handshakes have none of these new quotas/timeouts/caps (the existing 32 MiB frame cap
remains); a post-deploy reconnect storm must not lock out old tabs behind one proxy. Use backoff on 429.

### WebSocket contract

`hello` adds optional `auth:{accessToken}`. Response adds `backendId` and
`auth:{mode,sessionId,accessExpiresAt}` (last two null for anonymous). Optional response fields allow older-server decode.
Features `device-auth-v1`, `device-pairing-v1`, `device-management-v1` are explicit, not baseline fallback inference.
Shared `LEGACY_HARNESS_FEATURES` excludes all three; transport and generated Android defaults use that list.
Required-mode pre-auth first frame must be textual hello <=8 KiB within five seconds. Optional/off retains old
JSON/binary-JSON hello handling without the new timeout or hello-size cap. No binary/ordinary activity before required auth.
Identity is immutable per socket. `auth.renew {accessToken}` → `{accessExpiresAt}`; same session only, 60-second renewal
grace after access expiry (ordinary dispatch remains blocked after expiry). Error envelope `auth_required|auth_invalid|
auth_expired` and close 4401; `auth_revoked` and 4403. Reasons contain only the code.
Android treats access rejection (including 4401) as reconnectable: preserve the retained credential, back off, refresh it
once before opening the next socket, and retry transient refresh failures with backoff. Only a structured
`auth_invalid`/`auth_expired` 401 or `auth_revoked` 403 from a retained-session refresh/rotation exchange clears the
retained credential and stops reconnecting (an explicit session-revocation event or user sign-out also clears it).
Bare HTTP status, Host rejection, network failures and 5xx never revoke local credentials. Unreadable encrypted storage
or unavailable Keystore keys remain untouched and surface a storage error, not expiry; retries must not replace keys
or overwrite unreadable records. Only an explicit new pairing may recover a key definitively reported permanently
invalidated/unrecoverable. Before replacing that shared key, durably mark its existing ciphertext records unreadable;
replace only the explicitly paired origin's record. Other origins keep their ciphertext/pins until separately paired.
Temporary key/storage failures and ordinary ciphertext corruption never authorize replacement, even during pairing. Proactive renewal normally refreshes one minute before access expiry; delayed renewal
must not turn the 15-minute access lifetime into a device sign-out. Web follows the same retained-endpoint distinction:
a 4401/access rejection reconnects through discovery and one retained refresh per backoff attempt. HTTP access rejection
must not clear retained credentials. Bare HTTP errors (including 401/403), Host rejection, timeouts, restart windows and
5xx preserve them; only the structured retained-endpoint codes above clear the session and enrollment proofs.
Short-lived successful web hellos do not reset backoff; a connection must remain ready for one minute before resetting.
Clients without a credential preparation callback still stop on auth rejection rather than retrying anonymously.

Every RPC includes normal `type,id`, response echoes both. Management requires authenticated session even optional/off:

- `auth.devices.list {}` → `{devices:[Device]}`. Device `{id,label,platform,createdAt,lastSeenAt,connectedCount,expiresAt,current}`.
- `auth.devices.rename {sessionId,label}` → `{}`; `auth.devices.revoke {sessionId}` → `{}`. Self revoke signs out.
- `auth.pairings.create {confirm?}` (default true) → `{pairing:Pairing,secret}`; expires five minutes. Secret returned once.
- `auth.pairings.list {}` → `{pairings:[Pairing]}` (caller-created unexpired grants).
- `auth.pairings.cancel {grantId}` → `{}`; `auth.pairings.approve {grantId,claimId}` / `.deny` same → `{}`.
  Only the creating session approves, exact claim bound, before original expiry. Claimed grants never admit another device.
- Pairing `{id,expiresAt,confirm,state,claimId,comparisonCode,label,platform}`; nullable last four until claimed;
  state `unused|claimed|approved|denied|cancelled`. No hashes anywhere on wire. No mode-changing network RPC.
- Events `auth.devicesChanged {}` (reload list), `auth.pairingRequested {pairing}` to creator,
  `auth.sessionRevoked {sessionId}` before closing affected sockets.

### Byte-exact pairing link and comparison

Old v1 address links are import-only. New link `<webApp>/pair#pair=v2.<payload>`.
`payload` is unpadded RFC4648 base64url of UTF-8 of compact JSON array
`[backendId,backendOrigin,grantId,secret]` in exactly that order (no spaces). JSON strings use JSON.stringify escaping;
all generated IDs and secrets ASCII. Origin canonical `https://host[:port]` (HTTP only loopback), no slash/path/userinfo.
Helpers `encodePairingFragment`/`decodePairingFragment` exported by protocol enforce format and canonical encoding.
Client removes fragment with history.replaceState before network activity, disables analytics/referrers, confirms full access.

Comparison input UTF-8 bytes of `aiki-device-claim-v1\n` + backendId + `\n` + grantId + `\n` + claimId + `\n` +
**full prefixed claimSecret**, no trailing newline. SHA-256; take first five bytes; encode those 40 bits as eight RFC4648
uppercase base32 characters (`ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`, MSB first, no padding), display `XXXX-XXXX`.
`deviceComparisonCode` shared async helper implements this. Fixture: backend `backend-example`, grant `grant-example`,
claim `claim-example`, secret `aiki_c1.` followed by 43 `A` characters produces `VE2X-TWTS`. Migration uses literal grantId `migration`. Never approve by
label, source address or code alone: owner approval names exact claim ID(s). Labels/platform/source are untrusted hints.

### Revocation, artifacts, notifications and routing

Durable revoke precedes acknowledgement; invalidate all generations and unused grants created by that session, close its
sockets 4403 (detach watches/terminals), remove push/FCM registrations and held presence/deliveries, abort its artifact
streams. Host PTYs, agent turns and jobs keep running. Already sent bytes/push cannot be retracted.
`artifacts.url` retains `{url,expiresAt}`, default TTL ten minutes. Session-bound token query:
`token=v2.<unix expiry seconds>.<i|a>.<sessionId>.<base64url HMAC-SHA256>`; HMAC input UTF-8
`artifact-v2\n<projectId>\n<artifactId>\n<expiry>\n<i|a>\n<sessionId>` (no trailing newline).
Validate session on GET/HEAD; required rejects unbound old URLs. Optional anonymous minting retains legacy signature
format. Clients remint on expiry without reloading sessions. Responses private/no-store, nosniff, no-referrer, restrictive
sandbox CSP; hostile HTML/SVG attachment. URLs narrow bearer grants, not public share links.
Authenticated notification registration binds stored subscription/FCM token to session, not caller deviceId. Authenticated
re-registration rebinds existing legacy subscription. Anonymous registrations remain optional/off only. Legacy notification RPCs retain their old full authority during
that compatibility window, including updates/reads/test/unregister after another tab has bound the same notification
ID. An unauthenticated legacy re-registration preserves an existing auth-session binding (it never removes it), so
revocation still removes the subscription. Required mode and authenticated callers enforce session ownership. No relay here.

Backend origins configured through CLI hosts or `AIKI_BACKEND_ORIGINS` comma-separated canonical origins /
`auth.backendOrigins` (the existing explicit `AIKI_PUBLIC_URL` is also a fallback configured origin).
Stage 1 needs no new origin/proxy configuration: optional/off artifact minting deliberately retains the old
`requestOrigin()` priority: `AIKI_PUBLIC_URL`, else X-Forwarded-Proto + X-Forwarded-Host (or Host), else the
request origin. Forwarded headers are included even from unconfigured proxy peers in these compatibility modes.
This is a temporary legacy exception, not an approved Host or proxy entry. Required rejects mismatched Host
(including scheme/port); optional records/logs once per host without auto-allowing it. Required artifact URLs use only
validated origins, never this legacy fallback. Configure approved backend origins/proxies before required cutover. Loopback exact host:listener-port accepted. Origin allowlist `AIKI_ALLOWED_ORIGINS` remains
separate. For required routing and source/security decisions, only X-Forwarded-Host/Proto/For headers are used,
and only for peers configured in `AIKI_TRUSTED_PROXIES` / `auth.trustedProxies`.
Required artifact origins come only from allowed backend origins, never an untrusted forwarded authority.
For legacy `/ws`, optional/off preserves normalized Origin matching: missing Origin is allowed, disallowed Origin
returns the original plain-text 403. Legacy signed `/artifacts/` GET/HEAD/OPTIONS remains accessible with missing or
disallowed Origin, merely omitting CORS headers; allowed preflight retains `Range`. Required mode rejects disallowed
Origins before any artifact access. New auth HTTP always uses exact Origin matching.

### Deploy checks and rollback safety

`deploy/health-check.ts` stays standalone (Bun/OS imports only). It probes `GET /auth/status`: off/optional and older
servers without that route keep the anonymous WebSocket checks. Required uses `health-check <JSON request>` on the
owner-only `<data>/auth.sock`, not a network exemption or a stored deployment credential. Only hello, server status,
drain, project list and conversation page are allowed there; they use the same `ClientConnection` dispatch as ordinary
RPCs, with a fresh local-only connection per request. No device, pairing grant, retained/access token or session is
created. This is simpler than minting and expiring a second kind of bearer identity. The public HTTP router never
exposes this command, and anonymous network hello still fails required authentication. Checks match the socket's
backend ID and listener port to public discovery, so another local backend cannot satisfy them.

Deep checks still verify the expected commit and page the projects saved before restart; wait-idle still drains/polls.
The checker loads the same private env-file aliases or selected XDG default as the entry point (explicit process values
win), then resolves `AIKI_DATA_DIR` or `${XDG_DATA_HOME:-~/.local/share}/aiki`, including `~` expansion. The warning-only
remote tailnet check uses `--alive-only`: a valid required auth status counts as alive without trying a local socket.
Discovery alone never replaces the on-target release/project checks.

User units run the checks as the deploying/service account. For system units, `backend.sh` reads the unit's `User` and
uses `sudo -n -H -u <service-user>` when it differs from the deploy account (an empty system `User` means root).
`DEPLOY_HEALTH_USER` can override this choice; `DEPLOY_HEALTH_ENV_FILE` selects a non-default service env file. Remote
overrides are `DEPLOY_<TARGET>_HEALTH_USER` / `DEPLOY_<TARGET>_HEALTH_ENV_FILE` in private deploy config. Before required
cutover, ensure the service account can execute Bun and read the copied checker, release and saved-open-project file;
configure noninteractive sudo for the checker command if accounts differ, or run deployment as the service account.
Match any service-specific data-dir/XDG overrides through its private env file. Do not chmod the socket or data directory
for deployment: they stay 0600/0700. Saved project IDs are captured on stdout (`--record-open-projects=-`) and written by
the deploy account, so the service account needs no write access to the deploy root. Existing same-account setups need
no permission change. Approved backend origins/proxies and client migration are still prerequisites for required mode.

New `RELEASE.json` files record `supportsDeviceAuth`, detected from the archived server's auth implementation, not the
deploy tool's version. Before any backend release switch (including automatic rollback and restoration after a failed
manual rollback), the checker reads `auth.sqlite` **read-only**, even if the server is down. Persisted required mode
refuses targets without `supportsDeviceAuth: true`; corrupt/unreadable auth state also refuses the switch. The deploy
status says the rollback was refused and retains the failed auth-capable release instead of exposing an old anonymous
server. Releases without that metadata are conservatively ineligible in required mode: deploy at least one known-good
release with this tooling while still optional before cutting over. Keep the current deploy tooling for rollback; do
not invoke old rollback scripts, manually repoint releases, change auth mode during a deploy, or delete auth state to
force a downgrade. No script can protect a manual bypass by the host owner.

### Cutting an existing installation over to required

The order an operator follows on each backend, all through the owner CLI (`auth …`) or private deploy config:

1. Deploy auth-capable releases while existing data starts `optional`; update every client in place.
2. Let updated clients register migration claims; `auth migration list --json` is the inventory. The owner checks each
   device's code (web: Settings → backend → Devices; Android: the same screen) and approves exactly those claim IDs with
   `auth migration approve --batch <id> <claimId…>`. `auth devices list` then shows each one connected.
3. Allow every address clients use: `auth hosts list` shows hosts seen while optional; `auth hosts allow <origin>` for
   each real one (the scheme clients see, e.g. `https://` behind a TLS proxy). Set `AIKI_TRUSTED_PROXIES` in the private
   server env file to the reverse proxy's source address (loopback for a local proxy, its tailnet address for a remote
   one), so forwarded Host/Proto count only from it. Deploy once more so the env file is installed and a release with
   `supportsDeviceAuth` exists as a rollback target.
4. Confirm no unknown hosts appear in `auth hosts list` and every inventory device still connects; then
   `auth mode required`. Anonymous sockets close, migration enrollment closes, and new devices use pairing links.
5. Rollback to optional is `auth mode optional` (never deleting auth state); deploy rollbacks refuse pre-auth releases.

### Android device sign-in

Android keeps each origin's retained token, staged rotation successor, auth-advertisement pin and pending claim proof in
`aiki-device-auth.preferences_pb`, a separate DataStore encrypted using an Android Keystore AES-256-GCM key. The exact
origin is authenticated additional data. Backup and device-transfer rules exclude that file. Missing/invalid keys discard
credentials but keep the downgrade pin: show Pair, never fall back anonymously. In-place APK upgrades preserve auth;
access tokens and generated outgoing grant links remain memory-only. Neither address exports nor saved UI state contain
session tokens. Never follow redirects for auth HTTP or authenticated WebSocket upgrades.

Each backend discovers status before hello, pins identity/origin, refreshes its retained credential and authenticates hello.
It renews on the live socket one minute before access expiry. Rotation stages the same-session successor durably before
sending it; crash recovery retries that successor and can prove a committed rotation with the successor after the old-token
retry window. Auth failures/4401/4403/revocation stop reconnect loops and show per-backend sign-in state. Legacy servers
without advertised auth retain their existing handshake. A successful reconnect re-registers enabled FCM subscriptions.

Settings → Backends offers Paste pairing link; HTTPS `/pair` is an unverified, user-choice intent handler like `/connect`.
The receiver confirms the exact address/backend ID and Full access to this computer before storing a claim, redeeming,
adding the address and connecting. Headless bootstrap also asks for the separate 12-character code. Incoming-link state
survives configuration changes in memory, not a secret-bearing Bundle. A staged claim resumes after process death;
approved credentials are durable before acknowledgement. Polling waits at least one second and honors Retry-After.
Old address-link exports explicitly say they do not grant access.

A backend's Devices page lists this-device identity, labels/platforms, creation/last-seen/expiry, connected counts, rename
and confirmed revoke/sign-out (including last-device recovery warning). Add a device defaults to matching-code approval,
warns if disabled, and shows a one-time QR/share link, countdown and Cancel. Pending grants can be cancelled independently.
Approval dialogs appear anywhere in the app and bind the exact backend/grant/claim, not labels. Device-change events reload
lists. An optional anonymous connection stages a migration claim without interrupting ordinary use, displays its comparison
code in Backends and Devices, and polls with backoff. Denial/expiry leaves optional anonymous use intact. Approval stores,
acknowledges and reconnects authenticated. Each backend migrates separately.

Existing image/video URL renewal remains in use: renew before expiry and on bounded load failures; Media3 retains playback
position/play state when changing URLs. Downloads mint after destination confirmation and re-mint once on failure, reopening
the new destination in truncate mode. No signed URLs are persisted. Emulator verification does not establish physical camera,
Keystore invalidation hardware behavior or live FCM delivery; crypto failure paths use an injectable cipher in JVM tests.

### Owner CLI and migration

`bun packages/server/src/main.ts auth ...` reaches the **running** backend over `<data>/auth.sock` (0600, directory 0700).
Select directory with `AIKI_DATA_DIR`; never delete auth data to recover. Commands:
`status`; `mode off|optional|required`; `pair [--local] [--backend <origin>] [--web-app <origin>]`;
`devices list|revoke <id>`; `revoke-all`; `hosts list|allow <origin>|remove <origin>`;
`migration list [--json]`; `migration approve --batch <batchId> <claimId...>`.
Remote `pair` is explicit network enable via `--backend` (must already be allowed); web app from `--web-app`,
`AIKI_WEB_APP` or first allowed browser origin. Output `<webApp>/pair#bootstrap=v1.<base64url UTF8 compact JSON
[backendId,backendOrigin,requestId]>` and a **separate** 12-character uppercase base32 code. Local prints
`<loopbackOrigin>/pair#bootstrap=<aiki_b1 secret>` (bundled UI not shipped; trusted hosted UI can use explicit route).
Only CLI displays secrets, never service journal. Local channel commands never expose hashes/session tokens.

Updated legacy clients persist pending claim proofs, register via HTTP, display comparison codes and poll. Owner reviews
fixed `migration list` inventory (ID/code/label/platform/first/last-seen/coarse source), approves **exact IDs** under durable
batch ID. Same batch+ordered IDs retry is idempotent; altered set rejected. Poll/ack is identical to pairing. Each backend
has separate authority; no global atomicity. Keep optional until every known client has acknowledged and re-registered
push, including offline phones. Required closes migration; do not silently grandfather reachable peers. No deployment
bundle generator or cross-backend approval UI is included in this server contract.


### Web client storage and device screens

The web client keeps retained session tokens, staged rotation successors, migration/claim proofs and the auth-support
pin in IndexedDB `aiki-device-auth`, keyed by stable backend ID plus the exact canonical origin. Address-list persistence
whitelists ID/name/URL; exports and v1 connect links remain address-only imports, never sign-in. Access tokens stay in
private memory and are not included in reactive connection/debug state. Failed storage falls back to memory with a
visible warning that reopening requires pairing. An edited origin never inherits another origin's credentials.

Discovery precedes each socket. Only an unpinned explicit 404 permits legacy discovery; network errors, a changed backend
ID and a pinned 404 cannot downgrade authentication. An explicit auth hello also pins support. Optional/off anonymous
hello is deliberate mode negotiation, not a fallback after refresh failure. Access rejection reconnects independently per
backend, preserving the open project, drafts and watch state. Only missing credentials, explicit sign-out/revocation or
definitive retained-session rejection stop reconnects and show Pair this backend / This device was signed out / Session
expired. Network and rate-limit failures back off. Access refresh and `auth.renew` run one minute before expiry without
replacing healthy sockets. A proactive refresh/renewal failure joins the same reconnect/backoff path instead of running
a second refresh loop; definitive retained rejection stops it. Artifact HTTP uses signed URLs (expired URLs are reminted
through socket RPC); uploads are socket RPC, not bearer HTTP fetches.
Web Locks serialize retained read-stage-rotate-refresh-commit, including definitive rejection cleanup, across tabs. Read
the latest stored session inside the lock, never an old in-memory token: a different tab may already have rotated it.
The staged identical successor is resumed after a crash. Browsers without Web Locks may refresh but refuse unsafe
rotation rather than race another tab.

`/pair` clears its fragment before startup/discovery, has no referrer or analytics, and supports v2 invitation links,
headless v1 bootstrap links and same-backend-origin local bootstrap secrets. The static hosted app does not itself
serve the backend's loopback UI. The page confirms the address/ID and full-owner access, persists the claim proof before
redemption, shows the comparison code and polls no faster than once per second with Retry-After/backoff. It stores
credentials before ack; interrupted delivery can resume from IndexedDB on `/pair` without retaining the invitation
secret. Interrupted ack is retried on connection. Adding an address happens only after the receiving user's Pair choice.

Backend settings embed Devices: this-device labels, rename, platform, connected count, creation/last-seen/expiry,
revoke/sign-out with last-active-device recovery warning, pending grants and cancellation. Add a device defaults to
confirmation and displays a QR, private copyable link and countdown. Disabling confirmation warns about full access.
The app-wide approval dialog traps focus, compares the code and approves/denies the exact claim. Requests queue per
backend; claimed grants can also be reviewed from Settings after a reload.

Optional-mode migration never waits on or interrupts ordinary work. Persisted proofs are registered once per page
lifetime (idempotently after reload), then polled every 20 seconds, or 10 seconds with Devices open. Errors back off;
429 prevents page-driven polling before Retry-After. A quiet per-backend notice and Devices show the comparison code;
expired/denied enrollment offers a fresh explicit request. Approval stores/acks and reconnects authenticated. Push sync
includes the authenticated session ID in its signature, re-registering an existing subscription under that session.
Keep the backend optional until known browsers and offline clients have been approved and have re-registered push.

Existing shared artifact URL leases already remint before expiry and on image/video errors, and preserve video position
when swapping sources. Failed remints retry without refreshing the rest of the page; downloads mint at click time.
This works with ten-minute session-bound URLs without sending device tokens into media/download URLs.

## Projects sidebar: Needs you

Feature `sidebar-attention` adds optional `ProjectSummary.attention`: separate open question/warning counts,
review and waiting counts with the next return instant, failed workers/threads and all running workers.
The existing activity supplies coordinator state and unread replies. Summaries are computed by the existing
server board/worker/thread watches, persisted beside activity and pushed through `project.state`; clients never
watch every project's board. Missing summaries retain the older activity-only behaviour. On upgrade, missing files
are built once from durable documents before accepting connections, without opening Harnesses or starting agents.
A closed project's next waiting deadline has a small server timer: only when due does it open that project and let
the board's existing return-to-review transaction run. Archived projects never arm this timer.

The sidebar gathers questions, warnings, failures and quieter reviews across backends in a warm **Needs you**
panel, with a count of outstanding actions (not just rows). It shows three rows, with a keyboard-accessible
more disclosure. Empty means no panel. Questions/failures lead; reviews follow. Links open the project,
its first question's task where known, or the board for reviews. Waiting tasks are not urgent until the
server returns them to review. Below are calm project rows with one glyph, one status line and an unread dot.
Backend connection labels appear only when disconnected; backend groups, Add and archives remain.
The 56px rail carries per-project action counts; the phone drawer uses the same attention panel.
Web and Android share ordering and count rules, including activity-only fallback for older backends.

## Topology

- A static web app connects to multiple independent backends over HTTPS/WebSocket. Each backend owns its local
  projects, conversations, credentials and tools; clients never open backend databases directly.
- Default server binding is loopback. Browser origins must be explicitly allowed; the Origin check is not user
  authentication. Keep current installations on a trusted private network, not the public Internet.
- Deployment targets, suggested backends and private service/build values live in ignored `deploy/local/` files.
  The watcher runs from the stable checkout. It archives the selected commit, checks it, publishes the web app,
  drains and updates each backend independently, health-checks and rolls back failures. Intermittent targets remain
  pending and catch up when reachable. Deployment state and installed watcher identity may be overridden locally.
- The archived web build receives the stable absolute local backend-list path via environment, never private config
  copied into the source archive. Missing config publishes no suggestions. Legacy in-tree targets remain a read-only
  transition fallback. Public examples are never automatically deployed.
- User-mode backend units may be supplied locally; system units remain managed by the host's configuration.
  `README.md` documents setup and the local files. New installations must configure browser origins explicitly.
- Protocol features are additive; a client hides unsupported capabilities rather than assuming every backend updates
  at the same time. Native build origins and app-link hosts are generated from private build properties.

## Tools

- Tools run on the backend's machine, against repos checked out there.

## Command MCP servers and reviewed import (T142 / D72)

Any paired device may add a backend command server after explicit confirmation
of the exact executable, argument array, working directory and environment names
(values masked). Changing the executable or arguments requires confirmation again.
Commands run directly, never through a shell, with the backend user's PATH via
`childEnvironment`. Environment overrides live only in `mcp:<id>` credentials,
not definitions, diagnostics or prompts. The installed pi-mcp 1.5.2
`StdioTransport` provides process-group shutdown, bounded framing and stderr capture.
Connections start lazily on discovery/use or explicit refresh; idle children stop
after five minutes. Crashes reconnect with capped exponential backoff, never
replaying an in-flight tool call. Disconnect/remove/backend shutdown cancel restarts.
Settings show status and a bounded, secret-redacted stderr tail. Cached tools retain
the existing deferred discovery, project/role restrictions and Off/Ask/Allow policy.

JSON import accepts `mcpServers` or a bare server map. Clients review valid and
invalid rows before any save, select entries, and rename collisions. Command rows
require the same command confirmation. HTTP aliases are accepted; only Bearer
Authorization headers map to write-only tokens; unsupported headers are explained
rather than silently lost. Explicit SSE imports use a small bounded HTTP+SSE
adapter with same-origin endpoint enforcement, bearer credentials and no replay;
stdio and Streamable HTTP use pi-mcp directly. Import text/secrets remain
transient client state and are never exported to project files.

## MCP servers

T154: Web and Android offer Copy sign-in link next to Sign in. Copy starts
consent without opening a browser, or reuses the current in-memory pending URL;
the hint tells the owner to open it in their signed-in browser and come back.
The pending Paste callback URL field remains visible. Authorization URLs are
never persisted. A callback browser without the initiating local state/session
shows “Sign-in almost done” and a full callback Copy button, without submitting
the code. It strips the address-bar query and keeps the copy value only in memory.
Automatic completion requires a locally saved backend/flow pair and that flow
still pending on the authenticated backend. Callback query parameters never
select a backend. On web, clipboard failures leave a selectable URL for manual
copy; Android reports a failed copy instead of claiming success.

Keep the existing binding: authenticated device session ID, not socket ID and
not backend-wide. The same paired session can reconnect/reload and paste; a
different paired session cannot complete or cancel it. Access/session-token
renewal retains that identity; revocation, re-pairing or backend restart requires
starting over. Auth-off connections remain socket-bound
because they have no authenticated device identity. PKCE, issuer validation,
ten-minute expiry and consume-before-exchange remain unchanged.

Web settings (stage 3) are gated by `mcp-servers`. Backend settings → MCP
servers lists status and tool count, adds backend-provided presets or a named
URL, and opens server details. Details offer write-only pasted-token connection,
refresh, disconnect, confirmed removal, and a filterable plain-text tool catalogue
with Off / Ask / Allow. Catalogue rows are compact: name and server hint share
one line, a one-line plain-text description expands on click/tap to its full text,
and a smaller policy control sits inline on desktop (below on phone). Normal
desktop rows target 56–72px. Annotations are labelled as server hints, not
guarantees. OAuth-capable presets (including Notion) and saved OAuth grants show
Sign in using `startMcpOAuth`. Live flow events and `mcp.list` restore waiting,
failed, cancelled, expired and connected states. Pending sign-ins offer Cancel
and a write-only Paste callback URL field for completion on the initiating device.
Project settings → MCP starts every server and role disabled; coordinator, workers
and background threads are independent choices saved on change. Existing board
questions carry exact-argument approvals, including long JSON on phone screens.

**The MCP dialogs are one scroll region (T161).** Add/edit, Import JSON and Confirm command keep the ordinary narrow
dialog width (32rem, 36rem for the JSON and command reviews) and may use the height the screen has: at most
`min(90dvh, 52rem)`, with a header and footer that stay put and one scroll region between them
(`lib/dialog-layout.ts`). The preset catalogue from T157 then scrolls with the fields and is never a box with its own
scrollbar inside the dialog: nested scroll areas were the bug (the catalogue was a 254px window in a 512px dialog, and
the footer buttons scrolled away from the fields). The width is deliberately unchanged: what was wrong was text that
could not wrap. A preset's description used `truncate` (nowrap), so its min-content width became the grid column's and
the content spilled past the dialog's edge on a phone; descriptions and preset prose now wrap (`break-words`), the
scroll region, the form column and the inputs may shrink below their content (`min-w-0`, `width: 100%`), and no part of
the dialog scrolls sideways. Only the shared primary submit keeps the primary emphasis; Cancel and Back are ghost
buttons. The server details view keeps the ordinary page scroll for its tool list.

Android exposes capability-gated Backend settings → MCP servers and Project
settings → MCP. Backend screens list status/tool counts, presets or URL setup,
write-only token entry, OAuth, refresh/disconnect/removal, and compact searchable
plain-text tool rows with Off/Ask/Allow. Project enablement and role choices
start off. Server descriptions are untrusted text, never Markdown or links.
Android starts OAuth against BuildConfig.APP_ORIGIN (the configured web origin);
the backend still validates its allowlist. There is no per-backend web-origin
field in discovery/hello: an origin mismatch is explained, not guessed from the
socket URL. The exact /mcp/oauth/callback HTTPS app link uses the existing
configured app-link host. State maps only to the initiating in-memory backend
session; callback completion reuses its client. Custom Tabs return through that
link when the OS permits, with Paste callback URL as recovery. Pending flows and
callback URLs are never saved in Android state or storage; process death requires
starting sign-in again. OAuth status broadcasts update progress and cancellation.

Stage 2 adds server-owned OAuth flows through the allowlisted web origin at
`/mcp/oauth/callback`, with a pasted redirect fallback for unpaired browsers.
Pending flows are one-use, ten-minute, URL/device-bound state and PKCE; grants
and dynamic registrations remain in URL-bound `mcp:<id>` credentials. pi-mcp
owns discovery, issuer checks, PKCE and serialized refresh; Kemiri owns routing,
expiry, cancellation, status broadcasts and secret-safe errors. Invalid grants
require sign-in, not automatic browser launches. Notion supports OAuth or an MCP
token. Web and Android settings and Android app-link interception are described above.

Ask requests remain answerable for seven days. The exact-call approve-once
window lasts fifteen minutes from the answer, not from the question. Expired or
removed-tool/server requests withdraw their open board questions. Invalidated
receipts for closed projects survive until the next project bind can withdraw
the board question; a list or removal without a binding cannot forget it.

The core is backend-global remote Streamable HTTP with pasted bearer tokens or
OAuth. T142 adds command and explicit legacy SSE transports plus reviewed imports
as described above. Definitions and
cached catalogues live in `mcp/servers.json`; project/role enablement defaults off.
Credentials use a separate MCP namespace in the harness credentials file, with a
versioned token/OAuth record supporting stage-2 refresh grants.

Use standalone pi-mcp transport/client primitives if the Bun compatibility probe
passes; never its CLI extension. Require HTTPS except loopback development HTTP,
reject URL credentials, and reject redirects rather than forwarding authorization.
Never expose transport errors verbatim. Tool descriptions and results are untrusted.

Tools register before scripts as deferred, tools-only durable tools under
`mcp__<server>__<tool>`. Discovery is namespaced; no schemas enter the 3,000-token
inline catalogue. A short, harness-written server summary names connected servers
only. Registration filters project and role; execution rechecks live policy.

Off refuses, Allow executes once, and Ask returns immediately with a board question.
The owner confirmed this nonblocking flow (Q147). Options are Approve once, Always
allow this tool, Deny. Once binds the project, conversation, server, tool and exact
argument hash, expires, and is consumed before dispatch. Workers route questions
to their coordinator. Answers wake through the existing board route; writes are
never automatically retried after an ambiguous failure. Approval storage and board
routing sit behind a small interface. D72 permits command provisioning from any
paired device after confirmation.

Compatibility: standalone `@earendil-works/pi-mcp` 1.5.2 imports and runs under
Bun with pi-ai/pi-durable/pi-codemode 1.5.1 unchanged. Its client follows catalogue
pagination and its Streamable HTTP transport accepts an injected `AuthProvider`.
The fake peer proves initialization, bearer auth, GET-stream list notifications,
search/describe/call and restart. No CLI extension or fallback SDK is installed.
Transport headers are time-bounded, catalogues limited to 1,000 tools/2 MiB per
message, and redirects rejected. Known bearer/access/refresh values are redacted
from cached metadata and call results as defense against reflected credentials.

Storage: `mcp/servers.json` holds definitions, tool policies, cached catalogues,
connection intent, per-project role choices, and exact-call approval receipts
(seven-day questions, fifteen-minute approve-once windows from the answer). `credentials.json` holds `mcp:<server-id>` entries, hidden from provider
credential RPCs. The normal pi credential union supports token (`api_key`) and
OAuth (`access`, `refresh`, `expires` plus grant metadata); MCP adds
`mcp: {version: 1, serverUrl, oauth?, env?}` and refuses a URL-mismatched credential.
`oauth` holds pi-mcp discovery, registration and token state; the top-level
access/refresh/expires mirror it for redaction and diagnostics. PKCE verifier
and pending OAuth state exist only in memory, not the credential file. Both files
are 0600 atomic JSON. No secrets are stored in project files. Disconnect disables
registration/calls until refresh; restart preserves intent and cached metadata,
but reports disconnected until a lazy call or explicit refresh reconnects.
Scheduled worker runs follow coordinator scope; scheduled background threads
keep background scope. Old conversation role upgrades preserve other filters.

Settings RPCs: `mcp.list` (including presets), `mcp.add`, `mcp.token.set` (null
clears), `mcp.refresh`, `mcp.policy.set`, `mcp.remove`, `mcp.disconnect`,
`mcp.project.get`, `mcp.project.set`. Capability: `mcp-servers` (not assumed for
legacy hello). Server responses contain only auth kind/hasCredential, never
credentials. Tokens are write-only; generated Android token DTO diagnostics are
redacted. `mcp.oauth.start {serverId,redirectUri}` returns flowId,
authorizationUrl and numeric expiresAt; an empty authorizationUrl means the grant
was refreshed without browser consent. `mcp.oauth.complete` accepts flowId/state/
code/iss or a full redirectUrl, consumes before exchange, then connects and returns
the server. `mcp.oauth.cancel {flowId}` aborts. `mcp.oauth.changed {flow}` broadcasts
pending/succeeded/failed/cancelled/expired; `mcp.list` includes optional oauthFlow
and signing_in/needs_sign_in server statuses. Completion/cancel bind to the
initiating device session (or the original socket without device authentication).
Authenticated tabs can reload/rejoin; backend restart discards pending flows but
preserves completed grants. Cancellation never drops an already-rotated refresh.

The web helper `startMcpOAuth(backend,serverId)` saves only backend/flow IDs under
`aiki.mcpOAuth.<state>` and opens consent (or leaves settings open for copy-only
start); the callback strips its query before async completion. Old backend-only
routes safely fall back to copy-back. No routing authority comes from callback parameters. An
unpaired browser shows Copy URL for pasting into the initiating device. Android
must intercept the same stable callback path and submit its full URL to the
originating backend using its existing device session; never store MCP tokens
on the phone. Stage 3 owns settings screens. DCR is supported; missing DCR reports
that a registered client is required. Hosted client metadata documents and
pre-registered-client configuration are not implemented (fixed callback path).
Installed shells add only their two fixed HTTP loopback callback origins
(`localhost` and `127.0.0.1` at the actual bound port), matching the shell's
existing auth/WebSocket rule. Source backends still require explicit origins;
no Host header or arbitrary redirect address can extend the allowlist. OAuth
start errors reach the web UI as the backend's safe reason rather than a generic
message. Registration failures report HTTP status and recognized OAuth error
codes, never remote descriptions/bodies that could reflect secrets.

Real published pilot.2 reproduces the missing callback-origin failure on both
hostnames before discovery. A patched standalone build and an explicitly configured
dev backend both complete Notion discovery/DCR and open authorization, which leads
to Notion's account login. No real Notion account or grant was used. Fake peers
continue to prove completion, session binding, PKCE and secret-safe error mapping.

Measured by `packages/server/test/mcp.test.ts`, using a synthetic createSetup
project and chars/4 (ceiling), replaying the effective system sections and model
tool definitions, with the inline catalogue included exactly once:

| Case | Estimated tokens |
| --- | ---: |
| No MCP enabled | 14,223 |
| One connected 71-tool synthetic Notion-sized server | 14,275 |
| Increment (summary plus prompt section framing) | 52 |
| Summary text alone | 45 |
| Full synthetic catalogue (234,473 characters, never inlined) | 58,619 |
| Actual `searchTools("page search", {namespace:"notion", limit:3})` result (8,985 characters) | 2,247 |

Fixture descriptions plus schemas are 2–4 KB/tool. The inline codemode section
is byte-identical with and without these tools: deferred tools consume none of
its 3,000-token declaration budget. Baseline is the full Kemiri prompt, not the
inline budget. Search cost is incurred only if the script returns/prints those
three results; scripts may instead retain them privately and return filtered data.
These are heuristic context costs, not provider billing/tokenizer measurements.

## Code mode

- pi-durable's `codemode` extension, installed for the coordinator and every worker alike: always on (no setting),
  offered alongside the tools themselves, not instead of them — the model may call a tool directly or write a
  script that calls `await tools.<name>(args)` in one round trip. One `CodemodeSandbox` (a worker-thread pool, 256 MB
  per script) is shared by every project a backend opens.
- `callers` on a tool (pi-durable's own mechanism) decides what a script may do versus what only the model may do
  directly: starting, messaging, stopping or forgetting a worker, and saving, deleting or running a schedule, stay
  model-only; reading them (`worker_list`, `worker_peek`, `schedule_list`), and all of memory (`memory_*`), are open
  to scripts. A script can never start another script (pi-durable's own `codemode` tool is `callers: ["model"]`).
  `models.*` (the model catalog, classifiers, image generation) is off, since it is not part of this harness's tool
  surface.
- The coordinator's tool-call cap (`tool-caps.ts`) wraps `codemode` like `bash`/`powershell`, so a whole script is
  capped the same way a long `bash` call is; a nested `bash` call a script makes is capped too, for free, since the
  cap wraps the tool by name in the registry and a nested call resolves the same wrapped tool a model call would.
  Workers keep neither cap.
- The extension must be installed last in the registry: pi-durable orders prompt sections by each one's first
  install, not anything structural, so installing `codemode` before the extension that renders the SYSTEM.md
  preamble put its section ahead of the preamble pi-durable always expects first.
- Web: a `codemode` call is its own card (not a coding tool, so it breaks a coding group): a one-line summary, the
  script collapsed on its own toggle and shiki-highlighted, the nested calls as slim lines (live from
  `pi.live.nestedTools` while running, from the result's `details.calls` once settled), and the script's own output.
  A nested `bash`/`powershell` call that exited non-zero reads amber, like a plain `bash` card; any other nested
  failure, or the call itself, reads red and collapsed like any other failed tool.

## Conversations

- A project is a directory on a backend's machine, picked with the app's folder browser.
- One root coordinator conversation per project. The user talks only to
  it. It only plans, delegates and reviews; workers do the edits.
- The coordinator decides per worker whether it needs isolation (its own
  jj workspace) or works in the shared checkout. Nothing is fixed in code.
- Project storage lives in the data directory, not in the repo.

### Messages waiting in the queue

The web sends every message with `whenBusy: "steer"`. While a run is busy, pi-durable keeps the input in the
conversation's `pi.inbox` and places it as a `pi.user` entry at a boundary: a steer at the run's next tool boundary
(one at a time, in submission order), a follow-up when the turn ends. The text used to leave the composer and show
nowhere until then. Feature `queued-inputs` shows it (design decisions in order):

- **What the server adds** (`packages/server/src/queued-inputs.ts`; a `QueuedInputs` per watch, the window tracker in
  `window.ts` applies it): `ConversationView.queued` lists the inputs waiting (`id` = submission ID, `requestId`, `mode`,
  `text` without the `[task T7] ` prefix, `taskId`, `images`, `at`); absent when none wait, so the ops stay empty-free.
  `pi.inbox` was already in `docs` but has no request ID, no time and, once placed, nothing linking an item to its
  entry. When an item leaves the queue the watch reads the durable submission record (`placed`/`done` carry the entry) and
  tags the `pi.user` entry with `submissionId`, in the same view update that emptied the queue. `at` is the time the
  server first saw it (the submit, or the first watch), in memory only. Every sender queues here, the harness's own
  notes too (worker reports, check-ins, thread notes); the app tells them apart by text and draws only typed ones.
  Worker conversations (read-only) get no `queued`.
- `conversation.submit` answers with `status: "queued" | "placed"`. A re-sent `requestId` finds the original admission, so
  Retry cannot send twice.
- **Withdrawing one** (`conversation.withdraw { projectId, threadId?, submissionId }`, pi-durable's
  `abortSubmission`): `withdrawn`, `already_placed` (the run took it first) or `gone` (settled unanswered earlier, or not
  this conversation's). Abort still withdraws all of them; the app keeps the text of what Stop took (below).
- **What is left over is not lost.** A follow-up or steer still queued when a run ends is placed at the final boundary and
  continues the run; after a failed run `afterFailedRun: "continue"` (`runtime.ts`) starts the next run with it. Tests:
  `packages/server/test/queued-inputs.test.ts` (steer, withdraw, follow-up left over, duplicate request ID).

Web (`lib/waiting.ts` pure, `lib/waiting.svelte.ts` state, `UserMessage.svelte`, wired in `ProjectChat.svelte`; threads use
the same code through `threadId`):

- A waiting message is the user's own bubble at the end of the transcript, below the running turn: a quieter bubble
  (translucent, outlined, dimmed), a status line with three pulsing dots ("Waiting · reaches the coordinator at its next
  step", "… the thread …", or "sent when the current turn ends" for a follow-up) and **Edit** / **Cancel**. Several stack in
  order; a task chip shows above, as on a sent message. Pulse, rise, slide and ring are off under reduced motion.
- **Hand-off**: the waiting bubble and the entry the run places it as are one element. The key is `msg-<requestId>` for
  what this screen sent (`WaitingMessages.inputKeys`: submission -> key, handed to `buildTranscript`) and
  `input-<submissionId>` for anything else, so a message sent from another device or before a reload hands over too.
  Matching is by submission ID, never text; only an entry the server could not tag falls back to "a new untagged user
  entry with the same text, once each". On hand-off the status line slides away, the bubble fills in and one soft ring
  settles; the time and copy button take its place.
- **Edit** withdraws it and puts its text (and task) back in the composer in front of what is being written
  (`Composer.restore`); **Cancel** withdraws it. If the run took it first, a note says so and nothing changes.
- **Stop** withdraws every waiting message. A message that leaves the queue with no entry and not by this screen's own
  Cancel/Edit stays as a "Not sent · taken out of the queue before it was read" bubble with Edit and Dismiss, so the
  text is never lost (kept in memory; a reload forgets it).
- **A send that fails** stays as a bubble with its text and the error, with **Retry** (same request ID), **Edit** and
  **Dismiss**; the composer clears either way. On a backend without `queued-inputs` the old behaviour stays: the text goes
  back in the composer and the error shows above it.
- A send while idle shows nothing extra (the entry arrives at once); only sends made while a run was busy, or that failed,
  get a bubble.
- Reconnects: the comparison of two views restarts after the watch was away, so entries placed meanwhile are not taken
  for withdrawals. A queued answer the view never lists (the run took it first) is dropped after 4 s.

**Android** (not built): decode `ConversationView.queued` and `EntryRecord.submissionId` (Models.kt is regenerated),
add `conversation.withdraw` and the submit `status` to the data layer (generated `Requests.kt` has the overload), and port
`waiting.ts` (waiting list, `departures`, status wording) with the same keying so a waiting bubble becomes the entry in
place: a dimmed bubble with a status row and Edit/Cancel in the chat list, a Retry bubble for a failed send, the Stop
leftover.

## Adding a project: the folder picker

- The browser cannot see host paths, so the picker (`FolderPicker.svelte`, "Choose a folder") asks the backend:
  `filesystem.list` (one directory's subfolders), `filesystem.complete` (folder names for a typed path) and, to change
  folders, `filesystem.create`, `filesystem.rename` and `filesystem.delete`. Server side: `directory-listing.ts`
  (list, complete) and `directory-edit.ts` (create, rename, delete, name rules, safety checks).
- Features: `filesystem` (list), `filesystem-complete` and `filesystem-edit` (create/rename/delete). The app hides
  what the backend does not advertise: no completion means a typed path is only followed on Enter, no edit means no
  "New folder" and no ⋯ menu on rows. New entry fields (`repoKind`, `modifiedAt`) are optional;
  an older backend simply shows no time and a plain "repo" badge.
- Reading: entries are sorted repos first, then by name; a repo has `.git` or `.jj` (`repoKind` "jj" wins when both,
  as in a colocated checkout). Each row shows its last-modified time, short and relative. The server caps a listing at
  500 folders; sorting and the filter run in the app (`lib/folder-picker.ts`).
- One text field does two jobs: plain text filters the current folder at once; text that starts with `/` or `~` is a
  path. A path asks `filesystem.complete` (debounced) and the list shows the matching folders; Enter opens the typed
  folder (or its only match), Tab completes the common prefix and, when that adds nothing, steps into the matches. `~` is the backend user's home, expanded by the
  server (and by the app from the listing's `home`, so an older backend works too). Completion never errors on a
  missing folder; it just returns nothing.
- Keyboard: ArrowDown/Up move between rows (real focus, so the focus ring shows), Enter opens a folder, Backspace in an
  empty field or on a row goes up, Escape clears the field and only then closes the dialog.
- Quick places (a "Places" popover): Home, the parent folders of the backend's added projects (deduped) and recent
  picks. Recent picks and the last folder opened are kept per backend in `localStorage`
  (`aiki.folder-picker.v1`); the picker starts at the last folder and falls back to Home when it is gone.
- Each row has a visible "Use" button (pick without opening) and a ⋯ menu with Rename and Delete, reachable by touch;
  the footer's "Use this folder" picks the current one.
- Changing folders, safety rules (the server enforces all of them; the app only mirrors what it can for a clear
  message):
  - Names: not empty, not `.` or `..`, no `/` or NUL, at most 255 bytes, and never an existing name in that folder
    (rename uses `rename(2)`, which would replace an empty folder, so the server checks first). Shared check:
    `validateFolderName` in the protocol package.
  - A folder that is an added project, or contains one, is never renamed or deleted. Neither is the filesystem root,
    the server user's home or one of its ancestors, or the data directory (and its ancestors). A symlink is never
    renamed or deleted through the picker (it is not the folder).
  - Rename and Delete ask for confirmation in the UI (a small dialog; Rename's is its name field).
  - **Delete is for empty folders only (decided).** `filesystem.delete` is `rmdir` after a check: a folder with anything
    in it, hidden files included, is refused with "This folder is not empty" and nothing is touched. There is no
    recursive delete, no typed-name confirmation and no trash. The app asks for a plain confirmation first.
  - Errors come back as readable messages: `permission_denied` for EACCES/EPERM, `invalid_path` with the reason for
    everything else (exists, not empty, a project, bad name). The dialog shows them and stays open.

## Context

What a conversation's model is given besides the transcript. Clients read it with `conversation.context` (the `context`
feature) and get it pushed as `conversation.context.changed` while they watch the conversation.

- **AGENTS.md**: the user's agent directory first (`~/.pi/agent`, or `AIKI_AGENT_DIR` when the server's `HOME`
  is not the user's, as under a system service), then every `AGENTS.md` — or `CLAUDE.md` when a directory has no
  `AGENTS.md` — from the filesystem root down to the conversation's cwd, so the nearest file is last and wins. In the
  prompt each file is a `<project_instructions path="…">` block; the response lists the files with their scope
  (`global` for the agent directory, `project` otherwise) and content.
- **System prompt files**: the harness's own `SYSTEM.md` and `APPEND_SYSTEM.md`, not pi's, so the user's pi files are
  never sent to the harness's models. They come from the harness's config directory (`AIKI_CONFIG_DIR`, else
  `${XDG_CONFIG_HOME:-~/.config}/aiki`) and from the project's `<cwd>/.aiki/`, one file per name — the
  project's wins over the config directory's and the two are never combined (pi's precedence, its placement). `SYSTEM.md`
  is the prompt's preamble (pi's section name and position: the leading text, not wrapped in a tag) and
  `APPEND_SYSTEM.md` the addendum right after it, both ahead of the AGENTS.md files and the skills, in the coordinator and
  in every worker (a worker in a jj workspace reads its checkout's `.aiki/`). pi's SYSTEM.md replaces its default
  base prompt — role, tool list, rules, docs — while context files and skills stay; this harness writes no base
  instructions of its own, so SYSTEM.md only fills that preamble slot and never replaces the harness's coordinator or
  worker sections, the AGENTS.md files or the skills. Symlinks are followed, and an empty file counts as none.
- **Skills**: three sources, in this order. The harness's own: `<configDir>/skills/*/SKILL.md` and
  `<cwd>/.aiki/skills/*/SKILL.md`. pi's: `<agentDir>/skills/*/SKILL.md` and `<cwd>/.pi/skills/*/SKILL.md`.
  Claude Code's: `<claudeDir>/skills/*/SKILL.md` (its home — `AIKI_CLAUDE_DIR`, else `~/.claude`) and
  `<cwd>/.claude/skills/*/SKILL.md`, plus the skills of the plugins Claude Code records as installed and enabled in
  `<claudeDir>/plugins/installed_plugins.json` and the `enabledPlugins` maps of `~/.claude/settings.json`,
  `.claude/settings.json` and `.claude/settings.local.json`; a plugin's skills are namespaced `plugin:skill` as
  Claude Code namespaces them, a user or managed install is global and a project or local one belongs to its project.
  Claude Code's `skills/synced/` (skills downloaded from claude.ai) and its `.trash/` are deliberately not read.
  Name and description come from the YAML frontmatter (the directory name when it has none). They are offered in the
  prompt like pi's `<available_skills>` — name, description, absolute path — and the model reads the file with its
  `read` tool when a task matches; `read` in the response says whether this conversation's transcript already did.
  A name clash keeps the first: harness over pi over Claude, and within a source global over project. A skill whose
  `SKILL.md` real path was already loaded is dropped too, so one symlinked into two places is offered once.
- Both are sections of one extension installed for the project, so the coordinator and every worker have them: a worker's
  cwd is its jj workspace when isolated, and it reads that checkout's files. Workers get no worker tools, and the worker
  tools themselves refuse to run outside the coordinator conversation.
- Files are re-read before every turn, so an edit applies to the next turn without a restart. The rendered text depends
  only on file content and absolute paths, in a fixed order: an unchanged turn renders the same sections, pi-durable
  writes no `pi.system` entry, and the provider's prompt cache keeps hitting. Nothing per-turn (timestamps, sizes,
  counters) and no conversation state such as a skill's `read` flag belongs in a section.
- The response also carries the full system prompt the next request would use, the tools with the extension that
  registered each, where the tools run (`cwd`), and the server's home directory (`homeDir`), so a client can show paths
  as `~` without guessing where home is. Every file folded into the prompt is listed in prompt order with its kind
  (`system`, `append` or `agents`), scope, path and content.
- `usage` reports how full the context is and when it compacts: the tokens the next request would send and the model's
  window, the background and blocking thresholds in tokens, how many compaction summaries the conversation has and when
  the last one was, and whether a compaction runs now. A backend from before this field omits it, and the app then
  hides the usage block rather than showing zeros.
- Prompt cache misses: a request that re-billed, at the full input price, prompt tokens the previous request had and
  the provider should still have cached. The rules are the pi coding agent's (`cache-stats.js`), in one pure
  `CacheMissTracker` in `packages/protocol/src/cache-misses.ts` that the server and the app share: missed = the smaller
  of the two prompts minus this request's cache read, ignored up to 1024 tokens, priced at what this request paid for
  its uncached tokens minus the cache-read rate; a `pi.compaction` or `pi.reset` starts over; a provider that never
  reported cache use counts nothing. Each miss gets a reason: a model switch, changed instructions (a `pi.system` entry
  since the previous request: an edited AGENTS.md or a new skill), idle past the cache's lifetime, or unexplained. The
  lifetime is the previous request's, read from its usage: an hour when it wrote to Anthropic's one-hour cache
  (`usage.cacheWrite1h > 0`, what the "long" retention below asks for), five minutes when it wrote to the other, and
  the one before it when it wrote nothing; so a 20-minute gap under the one-hour cache is unexplained, not idle, in the
  transcript, the Info tab and the request log alike (`CacheMiss.cacheTtlMs` says which lifetime applied). Compaction
  summaries and the memory agent ask for no cache and are not transcript entries, so they never count.
- `usage.cacheMisses` (optional; a backend from before it omits it) totals them over every entry of the conversation,
  read incrementally with the compaction count, and counts the unexplained ones apart: those mean the start of the
  prompt changed between two requests, which the stable sections above are meant to prevent. The Info tab's usage block
  shows one line for them (a warning when some are unexplained). The transcript derives the per-request misses itself
  from the entries it already has: a miss of at least 20k tokens or $0.10 gets a muted line under its reply ("Cache
  miss after 12m idle: 84k tokens re-billed (~$0.42)"), the same for main, threads and workers; the reply's footer
  shows the cached tokens next to ↑/↓. The first request of the loaded window has nothing to compare with until
  earlier entries are paged in.

### Request log and cache statistics

Every backend keeps one row per model request of its conversations (main, threads, workers) in
`<data dir>/request-log.sqlite` (bun:sqlite, `request-log-store.ts`), for 90 days (pruned at start and daily), so cache
misses can be analysed with real numbers rather than per-conversation totals.

- A row: project, conversation and its kind (`main`, `thread`, `worker`, `other`) with thread, worker, board task and
  schedule IDs; provider and model; the response's timestamp; input, cache read, cache write (and the 1-hour part when
  Anthropic reports it), output, each cost and the total; prompt tokens; the idle gap since the conversation's previous
  request; the miss (tokens, cost, reason, every miss, no threshold) by the protocol's `CacheMissTracker`; what woke the
  agent; pi-ai's cache retention; what changed in the prompt; `live` or `backfill`; the response's duration.
- Live capture (`request-log.ts`), off the request's path: the `aiki.request-log` extension (hooks only, no section or
  tool, so no prompt changes; workers and threads keep it) has a `beforeRequest` hook on pi-durable's generation task
  that tags the last message object with the project and conversation. The server's `Models` is wrapped (after the
  subscription usage wrapper): `streamSimple` finds the tag, copies the message list, chains an `onPayload` that keeps
  the provider payload pi-ai built, and once the response ends queues the row. Untagged requests (compaction summaries,
  the memory agent; they ask for no cache) are not logged. Rows are worked out one at a time after a `setTimeout(0)`;
  any failure is logged (the first five, then every hundredth) and dropped, and a log that will not open leaves the
  server without it and without the `cache-stats` feature.
- Conversations are told apart by `identify` in `ProjectManager.#openRuntime` (coordinators, the thread records, every
  coordinator's worker list), cached once known.
- What woke the agent (`wakeOf`) comes from what arrived since the previous answer: tool results are the turn going on
  (`continue`); nothing new, or the same messages again, is a `retry`; otherwise the last user message's prefix
  (`[check-in]`, `[worker `, `[thread `, `[from `, `[board]`), a worker's or thread's first message (`brief`, or
  `schedule` when a schedule started it), a later message to a worker (`coordinator`), else the user's message.
- Prompt fingerprints (`prompt-fingerprint.ts`): hashes of the leading system message's text, each named section and
  each tool definition, of every later message (timestamps and usage left out), and of the provider payload's top-level
  parts, per element for lists, with `cache_control` left out because it moves to the newest message by design. Each
  request is compared with the conversation's previous one (kept per conversation in `prompt_state`, so a restart still
  compares) and the differences are stored as codes that `describePromptChange` (protocol) words: `restart` (the first
  transcript message changed: a summary or a reset; the tracker starts over), `base`, `section[+-]:key`,
  `tool[+-]:name`, `tools-order`, `update:keys` (instruction updates sent mid-conversation; these also make the miss
  `instructions_changed`), `history:i/n` (an earlier message differs), `wire:part[i]`. An empty list means nothing sent
  differed, so a miss then was the provider's own. Not seen: request headers (beta flags), the provider's cache state
  and routing, and the frames of a WebSocket transport (the payload is the body pi-ai built).
- Read-back (`request-backfill.ts`): requests made before the log existed (`liveSince`, stamped when the file is
  created) are read once per project from its `session.sqlite`, through pi-durable's own `SqliteStorage` over a
  read-only connection (`ReadOnlySqlite` skips the migration's two no-op statements and refuses any other write), in
  the background after start, yielding between pages. Identities come from the thread and worker documents, else the
  conversation's owning task. Wakes come from the inputs in the transcript; fingerprints and retention cannot, so those
  rows have `changes` and `retention` null and `source: "backfill"`. A project's live rows wait for its read-back so the
  tracker goes on from its last row. The rows and the `backfills` mark are one transaction; a failure leaves the
  project unmarked for the next start.
- `cache.stats` (feature `cache-stats`; `days` 1–120, default 30; optional `projectId`; `utcOffsetMinutes` for the
  days) answers `CacheStats` (`cache-stats.ts`): totals; wasted cost by reason, project, conversation kind and model;
  per wake the wakes, the turns' cost (every request until the next wake) and the misses; per day; the 20 conversations
  that lost the most; the 100 costliest misses with what changed; and what a one-hour cache would have done: idle
  misses under an hour saved, every other cache write priced as a 1-hour write by pi-ai's `calculateCost` (twice the
  input price), Anthropic Messages models only (Codex has no write price or retention option). Requests that had it
  already (retention `long`, or a one-hour write for rows read back) are left out and counted in `alreadyLong`, so the
  Usage screen says it was on for them and proposes it only for the rest.
- The Usage modal shows a "Prompt cache" section per backend with the feature (`CacheSection.svelte`, wording in
  `lib/cache-stats.ts`): spend, reuse and what was billed again, a cost-per-day bar, why, what woke the agents, what
  would help (the one-hour cache, and halving the wakes the harness causes: check-ins, reports, board changes,
  thread posts, retries), by project/conversation/model, the conversations that lost the most, and each miss with what
  changed. `bun run cache-report` in `packages/server` prints the same in a terminal (`--conversation P:ID` lists one
  conversation's requests; `--backfill` reads a data directory's transcripts in first, for a copy of another backend's).

### Usage analysis (T78 web prototype)

The Usage modal has Overview, By role, By model, Projects & tasks, and Waste tabs. A shared Today / 7 days /
30 days picker applies to recorded requests, not to the provider's live subscription windows. Today starts at local
midnight; the other ranges are rolling. Tab arrows, Home and End move focus and selection. Old backends keep the
subscription overview and existing cache report; `usage-breakdown` advertises the additive `cache.stats.usage` field.
Android keeps its existing usage screen in this phase; generated DTOs include the optional analysis for a later UI.

Usage totals count input, cache read, cache write and output separately, including keep-warm calls. Groups rank by
catalog-price equivalent, not cache-miss cost: caller role (scheduled runs take precedence over worker/thread),
provider/model × role, project, board task and conversation. All shares use the same recorded total. These are not
subscription percentages or invoices: providers do not expose a per-request conversion into subscription allowance,
account attribution is not recorded, and other clients can consume the same subscription.

Existing request rows already identify coordinator/worker/thread, schedule, board task and keep-warm. New recording
adds an optional internal purpose for coordinator compaction, memory extraction and backend memory maintenance,
observing their `completeSimple` calls without logging prompt content or affecting the call. Internal requests are
not cache-miss comparisons; they cannot be backfilled from transcripts. Internal conversation ID 0 means no linked
conversation (not the coordinator). The log schema is now 2 (additive purpose column); old readers can still open a legacy log read-only, but old writers
refuse a newer schema rather than silently dropping attribution. The 90-day retention still applies. Ordinary calls continue deriving
role from their identity, so historic attribution works without guessing new internal purposes.

Waste shows observed prompt reuse (read / all prompt tokens), rebilled-cache estimates, failed/aborted response
cost, keep-warm cost and unexpected writes, largest prompts, and check-in/retry pressure. These are investigation
signals, not a claim that the work was useless. Never-read writes, useless warming, no-action check-ins, reports
never used and context re-sent specifically because of compaction require cache-prefix lifecycles or semantic/run
outcome linkage that we do not have. Errors without returned usage and upstream worker compaction remain gaps.
Codemode executes tools, not a separate model call; titles are not generated by a separate model service here.

Subscription windows continue displaying provider reset times. Claude OAuth usage/profile and rate-limit headers,
Codex wham usage and rate-limit events/headers, and OpenCode Go usage expose automatic reset timestamps.
`subscription-resets` adds optional saved-reset discovery and `subscriptions.reset`: Claude's read-only
`cedar_ember=1&skip_spend=1` / `at_wall=1&skip_spend=1` probes and Codex's reset-credit list. Public provider-client
code documents these undocumented contracts; discovery failure means unknown, not zero. OpenCode Go has no known
manual reset contract. Each grant shows remaining count, expiry, covered limits and current usability.
Claude usage/discovery/reset requests share a versioned CLI User-Agent, never model calls. Anthropic reset discovery has
its own hourly cache, independent of window/header samples, invalidated after a confirmed spend. Discovery
runs even when the normal usage response omits program markers. Optional givesBackWeekly and unavailableReason
preserve narrower Fable grants (even when type is full) and provider reasons without inferring broad coverage.
Web limit-reset rows group only matching label/program/scopes/expiry/usability, retain one grant ID per spend,
and explain weekly give-back separately from a full weekly refill. The provider's seven_day_overage_included
scope is the Fable allowance; launch/tenure grant labels normalize to Fable reset only with matching narrow
coverage and weekly give-back. Android places the same groups after its window grid, uses 48dp labelled
buttons and a Material confirmation, and announces results through a dismissible snackbar.
Reset for free opens a keyboard/focus-managed
confirmation naming the number available and irreversible effect; Cancel never sends a mutation. Result status
is announced, and uncertain outcomes block further spending in that view.
Consumption requires an explicit confirmation, a fresh availability check, one grant and one request UUID; the server
coalesces duplicates and rejects concurrent provider resets. No automatic redemption or mutation retry. Claude posts
to its profile organization's `reset_rate_limits`; Codex posts to `wham/rate-limit-reset-credits/consume` with its
account header/body. Only a positive `reset` result is success; transport uncertainty is shown as unknown and must be
checked at the provider before trying again. These APIs can change or reject the OAuth surface. Tests use fake HTTP
only; no real reset is triggered. Research details are in `research/usage-analysis.md`.

### One-hour prompt cache

Coordinators can wait longer than a provider's short cache lifetime. A later wake can rebill an otherwise reusable
prompt. Projects therefore choose long retention for coordinators (the default), all conversations, or none.
The setting is a policy choice, not a guarantee of savings; provider behavior and workload both matter.

- What "long" does is pi-ai's, per API: Anthropic Messages (and Bedrock) send `cache_control` with `ttl: "1h"` (a write
  costs twice the input price instead of 1.25 times; reads are the same); OpenAI's own Responses/Completions APIs ask
  for a longer `prompt_cache_retention` where the model's compat allows; Codex reads `cacheRetention` only for "none",
  so "long" changes nothing there.
- Workers keep short retention by default to avoid paying a larger write premium for short-lived conversations.
  `all` remains available for workloads with long-running tool calls.
- How (`cache-retention.ts`): pi-durable's stream options are the Harness's, the same for every conversation, so the
  `aiki.cache-retention` extension (a `beforeRequest` hook only: no section, no tool, so prompts stay byte-stable;
  workers and threads keep it) tags each turn's last message with its conversation's retention, read from the project
  at every request, and `PromptCacheRetention.applyTo` wraps `Models` outside the request log's wrapper, adding the
  retention to that request's options so the log records it (`retention`). A request that sets its own keeps it
  (compaction summaries and the memory agent ask for "none"); untagged requests are left alone.
- `ProjectSummary.longPromptCache` (absent on older servers, and the web app then hides the setting) and
  `projects.configure`'s `longPromptCache` (null restores the default); `project.json` files without it read as the
  default. Project settings has a "Prompt cache" card with one select, saved when picked; a change applies from the next
  request. Web and Android show it alongside the coordinator keep-warm controls below.

### Coordinator cache keep-warm (T46 / D30)

Anthropic Messages coordinator conversations (main and background threads, never workers) can refresh their last
real request out of band. Project settings `keepPromptCacheWarm` and `promptCacheWarmHours` are optional on the wire;
old files default to true and 8 hours (choices 1/2/4/8). This is separate from `longPromptCache`. Unsupported providers
remain inactive. The hint is “Uses cached-input tokens while idle. Claude only.”

The isolated transport adapter reuses the exact final Anthropic request body, changing only `stream: false` and
`max_tokens: 0`. The provider still builds authentication and headers. System, tools, thinking, tool choice and cache
breakpoints stay unchanged; no synthetic user message or transcript entry is made. Unsupported zero-output shapes
are not refreshed. Usage and equivalent cost are recorded with source `keepWarm`, never as ordinary requests/misses.
Timers use the previous actual cache-write TTL (50 minutes for 1 hour, 4 minutes for 5 minutes), stop at the selected
idle cap measured from the last real request, and never catch up an expired cache. Turns, compaction/reset, model or
prompt changes, disable, close, errors and cold reads invalidate maintenance. Restart restores private request snapshots for opened coordinator conversations only. Credentials and callbacks are never
persisted. The current model/agent, context head, rendered system/tools revision, account/header fingerprint, actual TTL
and idle cap must still match. Overdue-but-live schedules wait a staggered 30–60 seconds; expired snapshots are dropped,
never replayed to rebuild a cold cache. Closed historic projects are not awakened.

Clients derive one quiet UI-only summary per idle stretch from request-log records, anchored to a real response.
No pings means no line. Refresh updates do not scroll, notify, or mark a conversation busy. Detail includes time span,
cached tokens, equivalent spend and stop reason. History has the request log’s 90-day retention, independent of
transcript paging; it is never part of model context.

### Show UI changes (`uiProof`)

Agents prove UI work (web pages, app screens) with screenshots and videos. That habit used to live only in the
coordinator's own worker briefs; now the harness makes it the default for every project, and only for user interfaces
(no backend or terminal recordings).

- Setting: `Project.uiProof` is `off`, `screenshots` or `screenshots-and-videos` (default; a `project.json` without it,
  or with a value the server does not know, reads as the default). Stored with the coordinator config, set with
  `projects.configure`'s `uiProof` (null restores the default), shown as `ProjectSummary.uiProof`. Feature `ui-proof`
  (clients hide the setting without it).
- Prompt: `uiProofParagraph(project, role)` in `workers.ts` adds one paragraph to the coordinator section (main and threads) and
  to the worker instructions; `off` adds nothing. The text depends only on the setting, so the prompt stays byte-stable
  while the setting does not change. A changed setting reaches a coordinator's prompt the way the check-in
  paragraph does (the next prompt build); a worker keeps the instructions it was created with.
- The coordinator's version also tells it to put the rule in worker briefs, and to work out the demo recipe the first
  time a project needs one (how to start the app, test data, how to drive the UI, where artifacts may live) and keep it
  in project memory. Workers' version leaves that out.
- Web: Project settings → Coordinator, group "Show UI changes", one select with the three values. Android: the same row
  in the same section.

## Workers

Status: backend, protocol, client and web UI done (milestone 2).

- A worker is a child conversation of the project's coordinator, built on pi-durable's
  background-subagent pattern. A background anchor task owns the conversation, so it outlives the coordinator's turns;
  a background reporter task delivers one message, waits for the answer and posts the report back. Both are background,
  so the coordinator's abort and idle waits never reach a worker; only `conversation.abort({ background: true })` does.
- Worker amendments use `worker_send` with `interrupt: true` (steer into the current run); queue only a separate next
  task. Several submissions can share one final answer. That answer is delivered once, keyed by the worker conversation
  and final assistant entry (`worker-answer:<conversation>:<entry>`), not by each submission's sending call. Report
  admission, worker/board changes, the single timeline event and reporter completion share one transaction. A second
  reporter for the same answer exits without a passive transcript copy, timeline entry, push or turn. Admission and
  forgetting stay serialized. Older checkpoints recover their answer from the original submission; already-decided
  legacy notify checkpoints retain their delivery choice and do not repeat their board changes. Failures without an
  answer retain the sending-call key. Distinct answers equal to that worker's previous report, and the exact
  one-line worker answer `Nothing new.`, are passive writes: kept in the coordinator transcript without a turn or push.
  Workers use that line only for an already-covered queued request with no new result, warning or question. Coordinators
  end without a chat reply for already-handled or unchanged reports, just as for uneventful check-ins.
- `worker_forget` marks the worker done and withdraws its queued inputs in one commit, without aborting its running
  answer or tools. Pending reporters never deliver new work to a forgotten worker. Late output (including failures) is
  recorded only, keeps done status, and cannot change its board task or notify devices. Missing/pruned records count as
  forgotten; conversation identity prevents an old reporter affecting a reused worker ID. Decisions and delivery are
  durable together, so late delivery cannot race past release.
- A coordinator answer with no content produces no web turn or Android row; tool/thinking steps remain when present.
  No UI change is needed for silent turns.
- Only the worker's final answer enters the coordinator's context, as a message starting with
  `[worker <id> reported]` (or `[worker <id> failed: <reason>]`); a check-in starts with `[check-in]`. Both prefixes are
  exported by the protocol (`WORKER_REPORT_PREFIX`, `CHECK_IN_PREFIX`) and the client has helpers to recognise them
  (`isWorkerReport`, `parseWorkerReport`, `isCheckInMessage`), so the app can render them differently from the user's
  messages. The worker's transcript stays in its own conversation, which clients can watch and page read-only.
- The coordinator keeps every tool and gains six: `worker_spawn` (`id`, `task`, `title`, `isolation`, `model`,
  `thinkingLevel`), `worker_send` (`id`, `message`, `interrupt`), `worker_stop` (`id`), `worker_peek` (`id`,
  `entries?`), `worker_list`, `worker_forget` (`id`, `removeWorkspace`). Workers get the coding tools and none of these,
  so they cannot start workers. A system prompt section tells the coordinator to plan, delegate, review reports and
  merge.
- `worker_peek` describes one worker without waiting for its report: status, how long since it last produced anything,
  the tool calls and results it is running, and the tail of its text and thinking. It is the same digest the check-ins
  carry, just larger, and it is trimmed to a few hundred tokens.
- Check-ins: while at least one worker runs, the harness wakes the coordinator every `checkIns.intervalMinutes` minutes
  (default 10, on by default; per project, in `project.json` and the project summary) with an input starting with
  `[check-in]` that carries that digest for each running worker and asks it to judge whether one is stuck or on a wrong
  path. The input is submitted as a follow-up, so it never interrupts a run: the coordinator handles it at its next turn
  boundary. Nothing is sent while no worker runs, and at most one check-in waits in the inbox at a time. The wait is a
  durable sleep in a background task (`aiki.worker-checkin`), and the input's request ID derives from the task and the
  deadline, so a restart neither loses a check-in nor repeats one; the next deadline is computed from the current time,
  so a paused process cannot burst a backlog.
- The list is a durable document on the coordinator conversation (`aiki.workers`), so it and the statuses survive a
  restart. Statuses: `running`, `idle` (answered, waiting), `failed`, `stopped`, `done` (forgotten; the last 20 stay as
  history).
- Isolation is the coordinator's choice per worker: `shared` (the project directory) or `workspace`, a `jj workspace`
  the server creates under `<data>/projects/<id>/workspaces/<worker>`, never inside the repo, branching off the
  coordinator's `@` so it sees the current checkout. Workspace isolation needs a jj repository; without one the tool
  fails with a message that says to use `shared`.
- Merge: the worker commits in its workspace and puts the change ID in its report; the coordinator rebases or squashes
  that change into the project's working copy and hands conflicts to a new worker. `worker_forget` removes the
  workspace once the work is merged.
- Model: the one named in `worker_spawn`, else the one the user picked in the composer (stored with
  `workers.defaults.set`, and also sent with `conversation.submit` as `workerModel`/`workerThinkingLevel` for a backend
  that predates that request, or stored with the coordinator conversation), else the project's `workerModels` default,
  an ordered preference list the first available model of wins. There are no built-in defaults: with none of them the
  tool errors with what to set.
- Thinking level, in order: the one `worker_spawn` names, the one the user picked with the model in the composer, the
  level the project's `workerModels` entry carries for that model. A model the coordinator names without a level still
  takes its list entry's level; with none, the model's own default applies.
- Worker input request IDs derive from the sending tool call; report IDs derive from the final answer. A rerun after
  a crash neither sends a message nor posts a report twice. T85 reproduced duplicate transcript/timeline entries when
  spawn and steer reporters shared an answer: the old per-call report key treated each as different, and the unchanged
  guard still wrote passive copies and timeline events. This predates pi 1.5.1: the earlier quiet-report test explicitly
  expected two transcript entries for that one answer. The 1.5.1 compatibility change adapted watch envelopes and
  session/report callbacks, not report delivery. The user confirmed all observed repeats followed interrupting sends
  and appeared at the next coordinator step, not as fresh wakes. No live data was needed. Busy-coordinator tests
  explicitly assert one final answer and one transcript/timeline report after an initial task plus two interrupts,
  alongside a user steer and
  restart before its next turn (reports themselves intentionally use `followUp`, not `steer`). Schedule worker reports
  share the same answer-keyed admission for both `review` and `record`.
- Protocol: the `workers` feature; `workers.list`; `workers.defaults.set` stores the composer's pick as if it had been
  picked with a message (an older backend answers `unknown_request`, and the client falls back to sending it with the
  next message); the `workers.state` event pushes the project's whole list and defaults on every change;
  `conversation.watch` and `conversation.page` take a `workerId`; each worker's `spawnedByCallId` links the
  coordinator's tool call in the transcript to it; `ProjectSummary.workerModels` (an ordered preference list, set with
  `projects.configure`'s `workerModels`) is the project default, each entry a model plus an optional `thinkingLevel`
  (`null` or absent means the model's default; older clients and old `project.json` files read the same list);
  `ProjectSummary.checkIns` and `projects.configure`'s
  `checkIns` (null resets to the defaults) carry the check-in settings, `longPromptCache` the one-hour prompt cache
  (Context → One-hour prompt cache).
- Web app: a right sidebar with three tabs, shared by the coordinator's chat and the worker transcript page, and hidden
  per tab when the backend lacks its feature. Info shows the conversation's context (`conversation.context`, live from
  `conversation.context.changed`) for scanning: a Context usage block above the overview (a bar of the tokens the next
  request would send against the model's window with tick marks at the background and blocking thresholds, the numbers
  in k tokens, the compaction count and when the last one was, "Compacting…" while one runs, and a "Compact now" action
  for the coordinator only, whose small dialog takes optional instructions and sends `conversation.compact`), hidden
  when the backend sends no `usage`; an overview of four counts (AGENTS.md files, skills read/offered, tools,
  prompt size and token estimate) that jumps to its section; human paths (`~` for the server's home, project-relative
  inside the project, absolute on hover/copy); the system prompt files (`SYSTEM.md` as "System prompt override",
  `APPEND_SYSTEM.md` as "Appended instructions"); AGENTS.md files labelled global, project or parent folder, with size and
  collapsed rendered markdown; the skills this conversation read in their own group and the rest folded, each
  grouped by source (Harness, pi, Claude) and then by scope (global, project), with a filter;
  tools grouped by extension, one line each and filtered; and the system prompt with its size, token estimate, a
  monospace viewer and copy. Workers
  is the panel per project (status, title, model, isolation/workspace, last report or failure) that used to have its own
  sidebar. Memory is the read-only browser for what the backend remembers (`memory.list`/`read`/`search`/`history`, live
  from `memory.changed` and re-read on reconnect): a global/project switch (the project's scope first, remembered per
  browser) for the files and the history, a search box over both scopes whose hits are labelled Global or Project and show
  the section and a snippet with the matches highlighted, the topic files by title, summary, tags and updated time with archived ones
  behind a toggle, an opened file's front matter (tags, links to other memories, source conversation) above its rendered
  body, and the scope's commits. Nothing edits or pins memory in the app. The sidebar resizes from its left edge (360px default, 280px to 60% of the window, double-click resets,
  keyboard-accessible), remembers width, open state and tab per browser, expands to fill the chat area below the header,
  and becomes a full-screen sheet below 72rem. A read-only worker transcript page shares its turns and tool cards with
  the chat but has no composer, because the user talks only to the coordinator. A compact worker card in the
  coordinator's transcript links each `worker_*` call through `spawnedByCallId`; report, failure and `[check-in]`
  messages render as their own cards instead of user bubbles. The composer carries a worker model and thinking picker
  that saves the choice at once (`workers.defaults.set`) and, on a backend that predates it, still travels with each
  message (`workerModel`/`workerThinkingLevel`). Project settings has a Worker models section for the project's ordered
  default list: models are added from the shared catalog search, reordered, removed or cleared, and every change is
  saved at once (`projects.configure`). Each row also carries a thinking-level picker (the composer's `EffortPicker`)
  showing the levels the model supports, and choosing one saves the list at once.
- Candidate, not decided (`docs/research/dsh.md`): named worker presets, a bundle of tools, prompt sections and
  skills that `worker_spawn` selects, instead of only replacing a worker's instructions as text.

## Threads

Decided with the user on 2026-11-04; contracts in `packages/protocol/src/threads.ts` and `artifacts.ts`.

The user's goal: talk to one place and never worry which thread they are in. So a project has one **main** thread
(the coordinator they talk to, where the app opens) and any number of **background threads**: full coordinators for
big, long work, started by main or by a schedule. There is no "new thread" button; the user asks main.

- **Roles.** Workers are main's hands for small tasks; background threads are its teammates for big ones. A
  background thread has the coordinator's tools (workers, board, memory, code mode, history) and runs in its own
  workspaces, never in the project checkout. One level only: a thread cannot start threads, and workers still start
  nothing. Same project only; backends never talk to each other.
- **Main relays.** Status ("how's the Jira run?" → `thread_peek`), steering ("tell it to skip PR 123" →
  `thread_send`) and taking work back (`thread_stop`, then the task). Main sees only summaries, questions and
  digests, never a thread's transcript; check-ins list running threads like workers.
- **Shared state.** The project's board is shared: a task carries `ownerThreadId`, and a thread claims a task
  (compare-and-set on the revision) before working on it, releases or hands it over. Memory is shared, and every
  coordinator thread may write it (writes are serialized and committed).
- **Messages.** `thread_send` delivers `[from <thread>] …` at the receiver's next step. A reply never wakes an idle
  receiver, and each thread has an hourly cap, so threads cannot ping-pong. Requests and hand-overs only.
- **Finishing.** A background thread ends with `thread_finish` and a summary, which reaches the thread that started
  it (main for schedules) as `[thread <id> finished] …`, reviewed or recorded (`onFinish`). Threads started by a
  schedule archive 7 days after finishing; others stay until archived. Unlike worker submissions, summaries come from
  one explicit finish call, keyed `thread-finished:<thread>:<call>`, with no per-submission reporter fan-out. Replaying
  that call before and after restart leaves one summary in both review and record modes (T85 regression tests).
  To wait (for a report, an answer, a message)
  a thread ends its turn; its prompt says so, and `thread_finish` is refused while its workers run or a board
  question it asked is open, since weaker models read "wait for the answer" as "finish".
- **Schedules.** A schedule of kind `thread` starts a background thread with the user's own prompt (nothing
  prefabricated), with its model and thinking level per schedule.
- **In the app.** Everything a thread does shows in main as compact cards (started, live status, needs you, finished
  with its summary and artifacts). Open questions from every thread sit above main's composer and the answer goes to
  the thread that asked; notifications open main with the card highlighted. A Background tab in the right sidebar
  lists the threads; each can be opened (a full chat you may type into). The left sidebar keeps one row per project
  with a "2 in background" note.

Backend (`packages/server/src/threads.ts`, `coordinators.ts`), as built on 2026-11-04:

- **Shape.** A background thread is a child conversation of main's, owned by a background anchor task like a worker;
  a kickoff task delivers its brief once (request ID from the starting call or schedule slot). The list is a durable
  document on main (`aiki.threads`). `Coordinators` registers main and every thread (inside the creating commit,
  and on open before anything resumes), so the worker, board, memory, history and compaction tools answer any
  coordinator and refuse workers.
- **Extensions.** Threads keep every coordinator extension except `thread-start-tools` (`thread_start`,
  `thread_stop`, `thread_archive`, main's "threads" prompt section) and the schedule tools, which stay main's; main
  removes `thread-finish-tools` (`thread_finish`); workers remove all thread tools. `thread_list`, `thread_peek`
  and `thread_send` are for every coordinator. A thread's coordinator section is its own variant
  (`threadCoordinatorSection`); its identity and workspace are its instructions; main's section stays byte-identical
  and the threads paragraph is a separate static section.
- **Workers per thread.** Each coordinator's worker list lives on its own conversation, and reports go back to it; the
  board and the worker model defaults stay main's. `workers.list`/`workers.state` carry every thread's workers with
  `threadId`; worker IDs are unique per thread only.
- **Workspaces.** `<data>/projects/<id>/threads/<thread>/checkout`: a jj workspace (`harness-thread-<id>`) when the
  project is jj, else a plain directory the prompt says to make git worktrees in. A thread's `shared` workers run
  there; its `workspace` workers get jj workspaces under `threads/<thread>/workers/` (`harness-<thread>-<worker>`).
  Nothing removes a thread's workspace yet.
- **Status.** `done` and `stopped` are written by the tools; `running`/`idle`/`failed` follow a watch on the
  thread's transcript (a run in progress or running workers is `running`, a run ending in an error is `failed` and
  posted once per error entry). Writing to a done or stopped thread (the user in the app, a non-reply message, a
  board answer to its question, a task handed to it, an unblocked task it owns) revives it. Stopping or finishing
  releases the open board tasks it held; a settled task keeps its owner.
- **Messages.** At most 10 `thread_send` per sender per rolling hour, main included; a rerun of the same call counts
  once. A reply (`reply: true`) to an idle receiver is a write.
- **Schedules.** `kind: "thread"` runs as `<scheduleId>-<yyyy-mm-dd-hhmm>`; the next run is skipped while the
  previous thread is `running` or `idle` (a failed or stopped one does not block). `onReport` is `onFinish`, and a
  `record` thread does not keep main's check-ins going.
- **Archive.** Schedule-started threads archive 7 days after `finishedAt` (applied by the clock in every view,
  persisted on writes); bringing one back (`archived: false`) also turns its auto-archive off. Only done, stopped or
  failed threads can be archived.
- **Memory.** Extraction from compactions runs for every coordinator: one `MemoryExtractionService` per background
  thread (started for the threads that exist on open and for each one registered later), its progress kept apart
  from main's in `memory-extraction.json` (`threads: { <conversationId>: <entryId> }`; entry IDs are unique across the
  project's conversations, so the app finds an extraction by its compaction entry alone).

## Artifacts

Files a thread or worker keeps for the user (demo videos, screenshots, logs, reports): `artifact_save` copies a file
from its working directory into the project's artifact store on that backend (`<data>/projects/<id>/artifacts/`).
The app lists them per thread, worker and task, and plays videos, shows images and reads text inline, from a signed
URL with byte ranges. They stay on the backend; publishing them elsewhere is up to the user's instructions.

Status: backend done (`packages/server/src/artifacts.ts`, `artifact-tools.ts`); the app is not built yet.

- Store: `<data>/projects/<id>/artifacts/<artifactId>/<name>` plus `index.json` (the `Artifact` rows, newest last). A
  save copies into `<artifactId>.partial/` and renames it into place before the index names it. MIME from the
  extension and the first bytes (the bytes win, except a media extension on a container that holds video or audio:
  `.mkv`, `.weba`, `.ogv`); kind from the MIME; `durationSeconds` from `ffprobe` when it is on PATH. One file may
  have `AIKI_ARTIFACT_MAX_BYTES` (default 2 GiB); a project's total is unbounded.
- `artifact_save { path, title?, note?, taskId? }`: every conversation (workers keep it, scripts may call it). The
  path is relative to the conversation's cwd or absolute (`~/` expands); after symlinks it must be a regular readable
  file under that cwd, the project directory or the system temp directory, and nothing in the data directory except
  the project's worker workspaces and the background threads' directories (`threads/<thread>/`: checkouts and their
  workers' workspaces). `threadId` is the coordinator's thread, or for a worker the thread whose workers list holds
  it; `workerId` comes from that list. The ID is memoized, so a rerun saves once.
- Protocol: `artifacts.list` / `artifacts.url` / `artifacts.delete` in `connection.ts`; `artifacts.changed` to every
  connection on each save and delete.
- HTTP: signed `GET|HEAD|OPTIONS /artifacts/<projectId>/<artifactId>?token=…`; session-bound v2 capabilities and
  legacy optional-mode format are specified under **Device sign-in**. HMAC-SHA256 with `<data>/artifacts-secret`,
  valid ten minutes, constant-time verification; 403 without a valid token/active issuing session. One byte range
  (206/416), inline or attachment (`download`), `private, no-store`, `nosniff`, no-referrer and sandbox CSP.
  HTML/SVG force attachment. Required mode uses exact Origin CORS and validated backend origins (or loopback);
  optional/off preserves legacy CORS and forwarded/Host origin derivation during migration, as specified above. Revocation aborts the issuing session's tracked streams.

### Artifact tags and the task media carousel

Decided with the user on 2026-11-08. Contract in `packages/protocol/src/artifacts.ts` (`Artifact.tags`,
`artifacts.update`, the tag helpers), feature `artifact-tags`. Web code: `apps/web/src/lib/media-gallery.ts` (pure logic,
tests in `apps/web/test/media-gallery.test.ts`) and `apps/web/src/lib/components/artifacts/Media*.svelte`. Android ports it
later from this section.

- **Tags are free-form short words.** `Artifact.tags` is optional (a row saved before tags, or by an older server, reads as
  none; a row with no tags has no key). The server normalises with `normalizeTags` from the protocol package, so every
  client can run the same function before it sends: trim, lowercase (NFKC), runs of whitespace, `,`, `;`, `/` and `\`
  become one `-`, characters other than letters, digits, `-`, `_`, `.`, `+`, `:` are dropped, separators trimmed from the
  ends, **at most 24 characters** per tag, duplicates dropped (the first wins), **at most 12 tags** per artifact (the rest
  are dropped). `SUGGESTED_ARTIFACT_TAGS`: web, android, phone, desktop, tablet, dark, light, before, after.
- **Saving.** `artifact_save` takes an optional `tags` array. Its description carries fixed text
  (`ARTIFACT_TAG_GUIDANCE`) that asks the model to tag screenshots and videos by platform and state, e.g. a web screenshot of
  the phone layout in dark mode is `web, phone, dark`, and a before/after pair the same tags except `before` and `after`;
  the worker/coordinator report rules say the same in one sentence. The text is a constant, so prompts stay byte-stable.
- **Changing tags from the app.** `artifacts.update { projectId, artifactId, tags }` replaces the tags with the normalised
  list (an empty list clears them) and answers `artifacts.update { artifact }` with the stored row; the server also pushes
  `artifacts.changed` (`deleted: false`) to every connection, which the live lists already take in as a replacement. Only
  tags can change. Errors: `unknown_artifact`. The app offers tag editing only when the hello's features hold
  `artifact-tags`; on older backends it still shows no tags (there are none).
- **The Files section of a task** shows the task's artifacts in two parts. **Media** (images and videos) is a carousel;
  **other files** (text, audio, anything else) stay the simple row list under it, opening `ArtifactDialog` as before. Media
  is ordered **oldest first** (save order), so a before/after sequence reads in order and "3 of 8" is stable while new
  ones arrive at the end.
- **The viewer's size follows the kind (T161).** `ArtifactDialog` sizes itself with `artifactDialogSizing`
  (`lib/dialog-layout.ts`): a Markdown page may reach `min(90dvh, 64rem)` tall and `min(60rem, 92vw)` wide, an HTML page
  the same height and `min(75rem, 92vw)` wide, and images, audio and files keep exactly the size they had.
  The text body of a roomy viewer no longer caps itself at 60dvh with its own scrollbar
  (`ArtifactText`'s `roomy`): the dialog's one scroll region scrolls the document, so a long report reads as one page.
  Chat cards and lists keep their compact caps.
- **An HTML artifact is shown as a page (T161, owner feedback F52).** An HTML report is a page a worker wrote to be
  seen, so the viewer defaults to rendering it, not quoting it. `ArtifactText` puts its bytes in an `<iframe>` that fills
  the roomy dialog's body (a viewport-based height, `clamp(16rem, calc(90dvh - 14rem), 46rem)`), and a small segmented
  control in the bar switches **Page** / **Source**; the choice is kept for the session (a module-scoped variable, like
  the video details panel), and Copy always copies the source. Chat cards and lists render the page in the smaller
  compact frame. The external-link button still opens the same page in a tab of its own.
- **The sandbox is the same in both places.** `ARTIFACT_FRAME_SANDBOX` (`lib/artifact-preview.ts`) is
  `allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals` and both frames carry it. Scripts, charts and print dialogs work, and the
  document is still in an **opaque origin**: without `allow-same-origin` its `localStorage` throws, its cookies are its
  own and gone with it, and it cannot read this page's DOM or the app's storage. Its requests to the backend are
  cross-origin, without credentials, and answered only with CORS for the app's own origin, so it cannot act as the
  reader. The dialog's frame carries the document as `srcdoc`, never as a `blob:` URL made by the page (which inherits
  the app's origin), and both frames send no referrer. The new tab's wrapper page is written by the app
  (`sandboxedArtifactDocument`), names the artifact with escaped text and clears `opener`. No CSP is added inside the
  frame: `default-src`/`connect-src` lists would break the external scripts, fonts and images a report may load, while
  the opaque origin already denies it the backend's answers and the app's session. The backend's own `attachment` +
  `Content-Security-Policy: sandbox` for HTML/SVG over HTTP stays as it is.
- **Android renders the same page (T162).** The artifact screen (`features/chat/ArtifactScreen.kt`, which is also the route
  a chat card opens) shows an HTML artifact in a `WebView` the way the web shows it in its frame: the page by default,
  with the same Page/Source segmented control in the preview's bar. The choice is kept while the process lives
  (`ArtifactPageChoice`, the web's module variable) and never written to storage; Copy still copies the source, and the
  Wrap toggle disappears while the page is drawn. The screen is the only place an HTML artifact is read on Android:
  chat cards and lists show a file row or a thumbnail, never an inline page, so there is no compact frame. The page
  fills all remaining height below a compact Page/Source bar, edge to edge horizontally, respecting the navigation
  scaffold's system insets. HTML uses a non-scrolling column with a weighted viewport: WebView owns page scrolling,
  while Source has its own full-height text scroller. The info button holds the title, facts, note, source path and
  Save/Delete actions instead of taking document space. Other media keep the scrolling details sheet. WebView
  enables pinch zoom with hidden zoom buttons and disallows ancestor touch interception so both vertical scrolling
  and horizontal panning stay inside the page (including against the phone navigation drawer). The app bar stays
  visible; there is no separate immersive mode.
- **The WebView's policy is the sandbox (T162).** A WebView has no `sandbox` attribute, so the missing pieces are removed
  one by one in `features/chat/ArtifactPage.kt`: `artifactPagePolicy()` turns JavaScript **on** (charts, counters) and
  everything else off — `domStorageEnabled`, `allowFileAccess`, `allowContentAccess`, both file-URL grants,
  `setGeolocationEnabled`, `saveFormData`, `savePassword`, multiple windows and script-opened windows
  (`javascriptCanOpenWindowsAutomatically`), with `MIXED_CONTENT_NEVER_ALLOW` and media only after a gesture. **No
  JavaScript bridge is ever installed**: `addJavascriptInterface` appears nowhere in the app, so the page can compute in
  its own document and call nothing of ours. The document is loaded with `loadDataWithBaseURL(null, html, "text/html",
  "utf-8", null)`: no base URL means no origin for cookies, storage or same-origin requests, the WebView counterpart of
  an opaque origin. The app has no WebView cookies to share (`CookieManager` is never used) and the WebView's own jar is
  never read back. A link tapped inside the page never navigates the frame: `shouldOverrideUrlLoading` takes `http` and
  `https` only (`isExternalBrowserLink`) and hands those to the external browser with an `ACTION_VIEW` intent, while
  every other scheme — `intent:`, `content:`, `file:`, `javascript:`, `data:`, an app deep link — is dropped.
- **A page over the preview limit opens as source on Android too.** `ARTIFACT_HTML_PAGE_LIMIT` (256 KiB, the web's
  `TEXT_PREVIEW_BYTES`) caps what an HTML preview keeps, so a longer page starts in Source with the web's note ("The
  first 256 KB of 3 MB; a page cannot be shown whole, so this is its source; download it for the rest"); Page still
  draws the part that loaded and the note says the page is partial. Other text kinds keep Android's 1 MiB preview.
- **A page over the preview limit opens as source.** `TEXT_PREVIEW_BYTES` (256 KiB) cuts a long artifact, and half a
  document does not render as the worker wrote it. The viewer then starts in Source with the usual note
  ("the first 256 KiB of 3 MB … a page cannot be shown whole, so this is its source; download it for the rest"), and
  Page still draws what loaded, with the note saying the page is partial. Markdown and other kinds keep the source view
  they had.
- **Filter chips** above the carousel: `All` and one chip per tag with its count, most used first, then alphabetical;
  untagged media is only in All. A chip filters the carousel (and the viewer); a tag whose last item went away falls back to
  All. Shown only when some media has a tag.
- **The carousel.** One large slide at a time, the neighbours peeking (slide 84% of the available width, with no desktop
  width cap since D27's full-width Files section). The inline stage height follows the available width, with an 18rem
  minimum and a 60dvh ceiling; it stays fixed as slides change so the scroll pitch is constant. It is a native scroll-snap row
  (`scroll-snap-type: x mandatory`, `scroll-snap-stop: always`), so touch swipes get the platform's momentum and snapping;
  the neighbours are dimmed and scaled slightly, with the scale following the scroll position. Arrow buttons (hidden on
  touch-only devices), ←/→, Home and End when the carousel has focus, and a **thumbnail strip** below (the current one
  outlined and kept in view) move between slides. The active slide is the one nearest the centre; tapping a peeking
  neighbour scrolls to it. Moves are a 220 ms own ease-out animation (`MEDIA_MOTION`). Reduced motion: no animated scrolling and no scale animation.
- **The caption** under the slide: title, its tags as chips (the editor's entry point), the facts line, and the note as
  Markdown clamped to three lines with "more". It cross-fades when the slide changes. The slide's accessible name is
  "Screenshot 3 of 8: <title>" ("Video 3 of 8: …"; the position is among the filtered media).
- **Videos** play in the slide with the existing `ArtifactVideo` (resume place, speed, controls). Only the active slide and
  its neighbours mount a video player at all; the others show the first-frame thumbnail. A video **pauses when it stops
  being the active slide**, and the viewer starts the video if the slide's was playing. Full images load only for slides
  within one step of the active one; the strip and the far slides use the lazy thumbnail (`ArtifactThumb`), so 50 items cost
  50 small elements and a handful of loaded images.
- **The viewer** is the same carousel full screen (`MediaViewer.svelte`): one slide per screen width, image zoom and pan
  with the existing maths (`lib/artifacts.ts`: wheel, pinch, double tap/click, +/−/0), the title bar, the caption below,
  the thumbnail strip, and tag editing. It opens from a slide with a **shared-element zoom**: the image is animated from the
  slide's on-screen rectangle to its fitted rectangle (FLIP with the Web Animations API), the backdrop fading in. **Swipe
  down at fit** (or Escape, the close button, a click beside the image) closes it; the image follows the finger, the
  backdrop fades, and on release it flies back **into the slide the viewer ended on** (the carousel is scrolled to it first).
  Horizontal swipes at fit change slide natively (touch-action `pan-x`); zoomed, the image pans instead. A tap on an image slide
  opens the viewer; a video slide has an expand button (its own tap plays it). Reduced motion: a plain fade, no flight.
- **Before/after compare.** `comparePairs` pairs media by this rule: only **images**; a `before` item and an `after` item are
  a pair when their *other* tags are the same set (`web, phone, before` pairs with `web, phone, after`; `before` alone pairs
  with `after` alone). Several items with the same other tags pair in order: the first `before` with the first `after`, the
  second with the second, by save time. An item whose other tags have no partner, or an item carrying both `before` and
  `after`, is unpaired. Both items must be in the filtered set; filtering by `before` alone hides the offer, so with a tag
  filter the pair is found among what the filter shows. Each pair is **one slide**, at the position of its earliest member,
  showing the compare view by default: the *after* image over the *before*, a draggable divider (touch drag on the handle only, so a
  swipe elsewhere still changes slide), a `role="slider"` handle with ←/→ (Shift for a bigger step, Home/End to the ends),
  "Before" and "After" labels. The strip uses the after image with a split badge; slide positions and the strip count the
  pair once (filter chip counts still count source artifacts). A **Show singly / Compare pairs** toggle in the slide and
  viewer switches all pairs to ordinary individual pages, keeping access to either image, its tags and download. The choice
  is stored per device (`aiki.media-separate.v1` on web, `DeviceSettings.mediaSeparate` in Android DataStore);
  compare is the default. The after image supplies the pair caption; its accessible slide name is
  "Before and after: <caption>". Opening a pair by tap or expand opens compare in the viewer too. Compare retains its
  existing fit-only view (zoom/pan are available on the individual pages). Divider drags start only at the handle; swipes
  elsewhere still change slides. Its keyboard controls are unchanged.
- **Editing tags in the app.** In the caption (and the viewer) a pencil opens an inline editor: the current tags as removable
  chips and an input that completes from the task's tags, then the project's other tags (read from the project's newest
  artifacts), then the suggested set. Enter or comma adds, Backspace on an empty input removes the last, Escape closes.
  Each change is one `artifacts.update`; the live list brings the stored row back. The input runs `normalizeTag` first.
- **Accessibility.** The carousel is a labelled region (`aria-roledescription="carousel"`) with slides as groups
  (`aria-roledescription="slide"`, "Screenshot 3 of 8: …"), the active slide announced politely when it changes, visible
  focus rings on every control, all motion off under `prefers-reduced-motion`.
- **Android** (built, `apps/android/.../features/tasks/media/`): `HorizontalPager` with `contentPadding` peeking, a `LazyRow`
  strip, a viewer in its own `Dialog` with a hand-made shared-element flight (the slide's picture rectangle is read with
  `positionOnScreen`, the viewer animates a top-left-origin transform from it, `flightTransform`), zoom/pan/pull-down in
  `pointerInput`, and a compare slider whose divider drags only from its handle strip. Motion numbers are `MediaMotion`
  (`slideMs`, `captionMs`, `viewerOpenMs`, `viewerCloseMs`), the same names and values as the web's `MEDIA_MOTION`.
  Differences are listed in `docs/CONTINUE.md`.

## Tasks as the place to read

Status: backend done in `packages/server` (2026-11-05); the web side is built in parallel.

Decided with the user on 2026-11-05; contract in `packages/protocol/src/board.ts` (report, snapshots, warnings,
`board.task.history`), `conversation.ts` (`submit.taskId`), `notifications.ts` (`task_review`, `taskId`), feature
`task-reports`.

The problem: with several subjects going at once, results, reports and worker check-ins from all of them mix in the
chat, and a question or warning about one subject gets buried. The answer: the task is what the user reads; the chat
is where they talk.

- **Every subject is a task.** The coordinator creates a board task for each subject the user brings up, before
  replying, and says which task it filed the message under. No exceptions for now; we will see if it is too much.
- **A report per task, rewritten in place.** Three short Markdown sections, `now`, `results` (with evidence:
  commit, artifact, test run) and `next`. A write replaces the sections it names; agents rewrite and shorten rather
  than append. Plain English, terse, nothing made up. No length limits in code: the prompts carry the rule, and we
  watch how the models do.
- **Who writes.** Workers update `now` (and may add to `results`) of the task they were spawned for, through their
  own tool. The coordinator owns status, `results`, `next`, questions and decisions. Background threads report on
  the task they were started for. Report writes have their own revision and never conflict with the user's edits.
- **Questions and warnings are separate items**, board questions linked to the task (`kind: "warning"` for warnings),
  so a rewrite cannot drop them. They stay until the user answers or acknowledges them.
- **History.** A report write may name a milestone; that and every status change save a snapshot. The task page
  steps through snapshots and shows what changed between two.
- **Only the user closes.** The agents move a task to `review` when it is ready for the user (a `task_review`
  notification goes out); `done` and `dropped` are the user's. A worker's report no longer moves its task to
  `review`: that is now the coordinator's call after checking the work.
- **Talking about a task.** A message can name a task (`submit.taskId`, shown as a chip; the input starts with
  `[task T12] `), from the chat's composer or from the reply box on the task page. Both go to main, which forwards to
  a background thread when that thread owns the task.
- **Quoting.** Text selected in the chat or a task can be quoted into the next message: it goes in as Markdown
  blockquotes before the typed text, so the coordinator reads exactly what was quoted, and the chat shows them as a
  small quote at the top of the user's bubble.
- **The chat stays short.** Worker reports, check-ins, thread results and board changes show as one line each with a
  link to their task. The coordinator's replies are a line or two that name the task; the detail goes in the report.
- **Across tasks.** A Tasks view lists every task grouped by what it needs: needs you (open questions and warnings),
  ready for review, blocked, working, to do, recently closed. Full width it can also be a board with a column per status
  ("Tasks board" below). The chat stays the home screen; tasks open in a sheet over it (`?task=T12`), full screen on a
  phone.
- **Rows that scan.** Each group is one rounded card (iOS inset-grouped style), its rows split by hairlines; only
  "Needs you" rows are tinted. A row is a status dot (a soft pulse while working; ⚠ or ? when a warning or question
  waits), the title at medium weight in at most two lines with a one-line gist under it, and a narrow column with the
  time over the task ID. The group names the status, so a row says it only under "Needs you". Refs show as small chips
  under the gist (two, then "+N"); the sheet lists them all, links clickable. The chevron shows only on hover.
- **Short titles, refs apart.** A task's title is a short, plain outcome ("Complete the example change"); its tickets and
  pull requests go in its `refs`, as full links (the coordinator looks a link up with `gh` or `acli` when it only
  knows the number). The board tool's description and the coordinator prompt say so; nothing in the code limits a
  title's length.

### Task changes and integration refs (T124)

The backend observes repositories, not agent chat. `task-changes.json` beside `project.json` is an atomic,
private, versioned project ledger, further scoped by canonical Git common-directory. It holds task/change
attribution (`trailer`, `workspace`, `worker-declaration`, `manual`), optional thread/conversation/run,
optional stable jj change ID and latest concrete hashes. A rewrite replaces hashes for that identity.
Conflicting task sets produce diagnostics, never an automatic union; `declareChanges(..., "manual")`
corrects attribution after verifying objects and board IDs. Structured worker declarations have the same
verified internal API; no new prompt-heavy tool is added. No attribution is inferred from chat hashes.

Portable trailers occupy the final message paragraph: repeat `Aiki-Task: T1` or use `Aiki-Task: T1, T2`.
Keys/IDs are case-insensitive; IDs normalize to uppercase `T` plus a positive decimal number.
Other Git trailers may coexist. Unknown project-board IDs are ignored with a diagnostic, not guessed.
Squashes/merges must retain trailers. Task membership on a merge includes its newly reachable ancestors.

`projects.configure.integrationRef` (feature `task-changes`) accepts `"auto"` (default: local main,
then master), a full Git ref such as `refs/heads/integration`, or `null` to disable integration observation.
Old clients keep working and preserve this setting when omitted. Web Project settings → General has
a **Delivery** group. Its independently feature-gated Integration branch row offers Automatic (main
or master), Custom ref, and Off. Custom input accepts local `refs/heads/...` or maps a validated plain
branch name into that namespace; it never creates/moves the branch. Modes save immediately; custom
text saves on blur or Enter with the existing settings' saved/error feedback. Missing repositories/refs do nothing.
Attach and changing refs baseline without history backfill. Open projects poll every 10 seconds.
Projects remain lazy across server restarts: previously attached projects catch up from their persisted
tips when next opened, never by opening/resuming them solely for observation at startup.
Disabled observation pauses the cursor; enabling the same ref catches up. No-ref gaps
also retain the last tip. Ref deletion is not treated as a landing. Configured ref changes baseline anew.

Git refs/objects supply reachability differences in both directions. Git-backed non-colocated jj workspaces
also use their Git store. Stable jj IDs are optional metadata read only with `--ignore-working-copy`;
observation never snapshots/imports a working copy. Removed ancestry is separate from conventional
`This reverts commit <full hash>.` declarations, which retain ancestry and identify the undone change.
Neither is a claim about pushed or deployed code. Non-Git-backed jj adapters, publication/tag observation
remain later work; remote refs may be explicitly selected but are not labelled as pushes. Deployment feeds
are a separate opt-in observer described below.

An isolated workspace captures its initial parent before the worker runs. Before forget (even if the
workspace is kept) or storage cleanup, committed base→tip membership is recorded, excluding the current
working-copy commit. Single-task workers get fallback provenance; retitled/reused, shared or multi-task
work requires trailers. Missing historical bases never guess. Explicit invalid IDs cannot fall back.
Bases live outside the checkout and have a private `.jj` marker to handle directory reuse; cleanup removes
the cursor, not attributed changes. All worker provenance is durable before destructive cleanup.

Each attributed ref move stores one structured fact: ID, repo/ref, previous/tip, task IDs, landed commits,
unreachable commits, declared reversions and timestamp. An outbox retries after crashes. The observer's
optional `onChangesLanded(fact: ChangesLanded): Promise<void> | void` defaults to no-op; consumers deduplicate
`fact.id` (at-least-once). Runtime projects these facts into one existing `milestone` timeline row per task
per advance, with hashes/subjects in detail, including archived/closed tasks without reopening. No new
wire timeline fields: stage 3 can fold the durable structured facts into Delivery. In the same board
transaction, each attributed task receives one `noteTaskFact` commit fact marking Results and Next stale,
with counts and ref in the reason (landed, removed or reverted). The existing timeline `fact.id` guard
also deduplicates freshness and nudge admission: retries neither increment eventSeq nor re-nudge, even
after outbox admission. Unattributed changes do nothing. No push notifications, publication or deploy
outcomes are generated.

### Project deployment feeds (T125, stage 5 of T120)

Feature `task-deploys` adds optional `projects.configure.deployFeed`: an absolute trusted local
file path, or `null`/absent (default: no deployment observation). Omitted settings preserve it.
Only file feeds are supported. A settings-configured command would give the settings API remote
code execution; the harness never executes one, invokes deployment, or moves an integration ref.
Web Project settings → General → Delivery exposes an independently `task-deploys`-gated Deploy
status feed row: Off or File path. The absolute backend-local path saves on blur or Enter; server
validation failures stay inline beside the field. ProjectSummary carries only the configured path,
not feed health/last-attempt status, so the UI does not invent an observer-status line. Existing
task-activity clients display the canonical Now line; legacy clients get its existing mirror and at
most one milestone per attempt.
Android Project settings includes a Delivery section when either `task-changes` or `task-deploys`
is offered. Each control is independently feature-gated: Integration branch offers Automatic (main or master),
Custom ref (bare branch names become `refs/heads/<name>`), and Off; Deploy status feed offers Off or
an absolute file path. Picks save immediately and text saves on blur/Done, matching neighbouring settings,
with per-field server errors inline. The summary currently carries no feed-health status, so none is invented.
Existing task-activity clients display the canonical Now line; legacy clients get its existing mirror and at most one milestone per attempt.

The JSON envelope is `{ version: 1, repository, projectId?, events: [...] }`. `repository` must
equal the project's canonical Git common-directory (including Git-backed jj); optional projectId
must match too. Each event is a **complete attempt snapshot**, not a target delta:
`{ attemptId, sequence, intendedCommit, expectedTargets, targets, observedAt, taskIds?, changeIds? }`.
Sequence is a positive, strictly increasing safe integer across the journal. Attempt IDs and target
names are bounded ASCII identifiers. Targets are keyed by exactly the expected set; each holds
`{ state, previousCommit?, servingCommit?, backendUnchanged?, message? }`. States:
queued/running/ok/failed/rolled_back/pending. Full object hashes are required. Attribution hints
never grant membership: ledger corrections/portable trailers and verified repository ranges do.

The reader accepts only regular files, reads at most 2 MiB plus a sentinel byte, and rejects
malformed/oversized documents before any projection. JSON parsing is bounded by that byte limit;
at most 4096 snapshots, 64 targets/snapshot, 2000 message characters and 2048 commits/range are
accepted. Git reads have 10-second timeouts/output bounds. Snapshot replacement must use an atomic
rename. A bounded retained journal can recover only the attempts it still contains, not evicted history.
The writer must not reuse sequences after trimming. Regressing feeds, changed attempt identity,
unknown objects and wrong scopes are rejected, not interpreted as success.

On open, then directory watch plus a 10-second fallback, consume the feed. Closed projects have
no watch/poll and remain lazy across restart. Unreadable/invalid feeds mark known deployment sources
unknown without manufacturing a failure or nudge; a valid reread restores the last projection even
when its sequence has not advanced. Disabling hides, but retains, that projection and cursor.
Private `task-deploys.json` persists sequence,
attempt membership/order, per-target last verified success and a replayable outbox. Freeze the
union of each target's last verified success → intended commit at attempt admission, using supplied
previousCommit when there is no observed success, or when retention has advanced the oldest feed
sequence past the cursor: pre-gap success cursors cannot override the retained attempt's own baseline.
An old cursor resumes at the first retained unseen snapshot without an error or sequence reset;
attempt/sequence dedupe survives repeated polls and restart. Missing baselines do **not** backfill all
history: bootstrap the journal once before relying on task fan-out. Attempts cannot change target
sets or intended commit. Verified unchanged means the intended revision is covered, while the older
serving commit remains visible. Rollback restores the serving baseline, not the attempted revision.
Offline/pending never means ok. A late older attempt may update its own history but not newer Now
or target success cursors.

One board transaction fans each snapshot to every attributed task, including done/dropped/archived,
without reopening. A persistent per-feed sequence guard deduplicates outbox replay independently of
timeline retention. One existing milestone per task/attempt evolves in place, retaining its initial
time, attempted commit, per-target state/serving commit and messages. Structured snapshots remain
in the cursor/feed for the later Delivery grouping. Unattributed attempts produce no task rows/facts.
No new pushes are sent: existing global `Notifier.deployProblem` behavior is unchanged.

Now precedence uses unresolved deploy failure first (retained through retries until those targets
verify ok), active deploy third, and delivery seventh. Text is age-free: “Deploy failed on 1 of 3
targets”, “Deploy queued for 5ed27fe”, “Deploying 5ed27fe · 2 of 3 targets ready”, “Live on all
backends” only for verified all-target success, otherwise “Live on 2 of 3 targets · 1 pending”.
Clients own the local since time. Landing says “landed · not deployed yet” only while a feed is
configured. Delivery expires after 24 hours as before. Attempt outcomes call `noteTaskFact` with
actor harness for Results/Next; starts/progress invalidate Next only. Closed tasks never nudge.

**This repository's observer instance:** `deploy/deploy.sh` sources `deploy/journal.sh` after
resolving the commit/holding the existing deploy lock. Disposable background observers close that
lock descriptor immediately; they read local/remote status only, then use a **separate** journal
lock (1-second acquisition, 3-second outer timeout) and atomic rename to write
`<deploy state directory>/deploy-journal.json`. The private deploy state directory remains selected
by `DEPLOY_STATE_DIR`/XDG state configuration. The owner sets this project's deployFeed to that
absolute path using projects.configure; no actual machine path belongs in committed config.
Starts, target outcomes, catch-up and unchanged verification become snapshots. Catch-up resumes
the latest matching intended commit's attempt. Reads of remote status are background-only with
a 2-second timeout, preserving rollback/serving details without adding waits to deployment.
Time-based monotonic journal sequences leave room for per-attempt events; concurrent writer arrival
is sorted and deduplicated. The existing per-backend deploy-status.json contract is untouched.

Observation is deliberately failure-tolerant: no waits/traps, no deployment decision or health-check
changes, no journal error propagated into deployment's exit status. Missing tooling, contention,
unreadable status or invalid output loses observation, never a deployment. The writer automatically
retains the newest **200 attempts or 1 MiB**, whichever fits fewer, with at most 4096 snapshots.
Each atomic replacement trims whole oldest attempts and their replay inputs/sequence reservations.
Frozen start baselines, stable attempt IDs/order, verified target checkpoints and a sequence high-water
mark survive trimming; even clock regression cannot reuse sequence intervals. A single unusually noisy
attempt compacts to its latest full snapshot instead of filling the file. No operator archival or feed
path changes are needed. Projects closed beyond retention resume from what remains without inventing
the evicted outcomes. The initial host baseline is
seeded from the existing local ok deploy status (including unchanged verification), falling back to
its serving release; targets with no prior verified journal baseline remain unattributed for that
initial attempt. Non-Git-backed jj deployment attribution remains deferred.

### Waiting tasks (D29, T42)

- `waiting` means the work is finished but something outside the user's control, named by the user, remains
  (a review, release or reply). It is distinct from blocked work. The user or coordinator supplies a required short
  `waitingFor` note and optional ISO `waitUntil`; the task stores optional `waiting: { note, since, until?, by }`.
  Leaving waiting clears this record; status snapshots and the timeline retain it.
- Dated waits return to review on the server, including overdue waits after restart. The server persists pending
  return notices, sends a `task_review` through Notifier (including its 15-second hold), and sends the owning
  coordinator a deduplicated `[board]` follow-up. Undated waits do not wake up.
- Lists place a collapsed `Waiting · N` group immediately after Review; rows show the note, elapsed waiting time
  and optional return date. The kanban has a Waiting column after Review, including the legacy board panel.
- The task header metadata includes “Waiting for … · since … · back on …” (T62; previously the Dashboard summary). Its header replaces Done/Drop/Reopen
  actions with a compact bordered status button: colour dot, status name and a chevron that rotates when open.
  It is the header's only status display. Web has hover/pressed surfaces, a keyboard focus ring and “Change status”
  tooltip; Android uses an outlined button with native pressed feedback and an accent focus border. Disabled/read-only
  states show a plain chip without a chevron. The menu stays unchanged: To do, In progress, Blocked, Ready for review,
  Waiting, Done, Dropped, with colour dots and short hints. Waiting opens a required note and optional date form,
  quick date picks and Save/Cancel.
  Saves use the existing revision-checked user path. Web is keyboard accessible; Android uses a native menu.
- Feature `task-waiting` is appended to feature lists. New fields remain optional; old boards require no migration.
  Android protocol models are regenerated, not edited by hand.
- **Compatibility finding.** Android already decodes statuses as `String` with `ignoreUnknownKeys`: the unmodified main
  APK keeps waiting tasks visible in the default Tasks list and kanban, falling back to To do rather than crashing.
  Its legacy board panel has a fixed status list; new clients include Waiting and preserve future unknown statuses
  there as To do. Old web clients also decode JSON without enum rejection, but their old kanban can omit unknown
  statuses until refreshed; the new web falls back to To do. No wire downgrade or enum migration is needed.
- **Work-day start (T48).** General settings → Appearance → Waiting tasks has “Work day starts at”, default
  **08:00**, stored per device (web localStorage `aiki.work-day-start.v1`; Android DeviceSettings/DataStore).
  General preferences are not backend-synced; drafts have their own separate sync path. The device's current local
  zone interprets this wall time. Tomorrow, In 3 days and Next week retain **+1 / +3 / +7 calendar days**, not Monday.
  Quick picks and the date picker resolve to an exact UTC ISO timestamp on the client before saving. Past choices
  advance by calendar days until future; DST gaps shift forward and overlaps choose the earlier instant on both clients.
  The Waiting form previews “Back on …, HH:mm”; summaries and rows include local return date and time. Editing only
  the note preserves an existing exact deadline; changing the preference does not reschedule saved tasks.
- **Implementation details.** Dates are normalized to UTC ISO timestamps. The coordinator board tool has no user zone:
  its date-only `waitUntil` deliberately remains midnight UTC; a full timestamp preserves its instant.
  Editing a waiting note retains `since`; an unrelated save preserves its author and date. Saving the waiting form
  with no date removes a previous deadline. Repeated waiting edits save their own history snapshot and timeline
  detail. Undoing a kanban move out of Waiting restores its note and date through the normal save path.

### Automatic task activity (T122, stage 2 of T120)

`task-activity` advertises optional `task.activity`: `{ kind, text, since, refs, actor?, count? }`.
`text` is canonical, plain, and has no age or clock time. `since` is an ISO state/phase start,
not a heartbeat. Clients render elapsed time locally; waiting/review/done/dropped may say
“since” with a local time/date. Search text, not a rendered age. `refs` names Q/F/task/run/change
sources. `actor` is `{ id, kind, name, threadId, conversationId, runId }`; kind is worker,
coordinator or thread. IDs include thread, conversation and run: worker names are reusable.
`count` is the question count, live worker count or landed change count, depending on kind.
Missing flag or activity retains the old-backend display; never infer activity from old prose.
The web Report Now row renders canonical activity text with a quiet local age and a small kind dot:
failure is error-toned, questions/waits/feedback need attention, active work/deploys pulse gently,
review uses its review tone, and idle/closure are muted. The pulse respects reduced motion. List and
board gists share that line; graph task selection opens the same sheet (the bubble graph itself has
no report gist). One shared minute timer updates only activity-line components, never board state or
search indexes. Unknown/not-started omit an age; state/delivery text already containing “since” does
not get a duplicate suffix. Search indexes canonical activity text only. An explicit hello capability
and the optional field are both required; missing either preserves the existing prose UI.
Android displays this read-only line in the existing Report Now row, list rows, board cards and
Graph's report detail. A small kind-coloured dot distinguishes failure (error), questions/waits
(attention), work (active), review, and quiet states. List rows and board cards keep the age inline
with the canonical text in one naturally wrapping Text, with a muted age span; report details
retain the age below. Ages share one locally ticking minute clock and are included in TalkBack's description. Text already
containing “since” does not receive another age. Search indexes canonical text, never rendered
ages. Both the `task-activity` feature and the optional field are required; otherwise Android keeps
its existing report rendering. Historical report snapshots are unchanged.

A pure project-local reducer reads durable source records and board facts, first match wins:
1. Unresolved deploy failure, then worker/thread failure.
2. Blocking open question; questions default blocking, warnings nonblocking. `blocksWork`
   can override that. “Waiting for your answer to Q131 and 1 more · 2 workers still running”.
3. Attributed deploy in progress from an opt-in project deployment feed.
4. Live task-focused worker/coordinator/thread. Latest phase/state start wins; ties sort by
   actor ID. “fern is working on Card view” or “fern is testing the card view · +1 worker”.
5. Unhandled (open, not handling) feedback: “Feedback F8 is waiting for the coordinator”.
6. Unresolved task blockers, then blocked/waiting/review state. “Blocked by T42”,
   “Waiting for external review”, “Ready for your review”. The time is separate in `since`.
7. Latest attributed delivery for 24 hours unless newer work supersedes it. Without a feed:
   “3 changes landed on main”; configured feeds add “not deployed yet” or verified live/pending outcomes.
   Ref removals/reverts without a new landing clear that delivery fallback. One expiry timer
   republishes a changed view, without a storage write; there are no per-second writes.
8. Done/Dropped (settledAt), Not started (creation), or Idle (last linked run ended, else creation).
   An unreachable source gives “Status unknown” rather than an unsupported work claim.

Closed tasks ignore lingering work/focus, but retain failures and delivery. Retry of a source's
conversation clears its earlier failure; reusing its name in another conversation does not.
An optional warning `activitySourceId` links acknowledgement to exactly one failed source.
Answering/withdrawing a question and handling feedback change activity immediately. Stop,
forget, release and handoff end only their own source, not other workers. A thread release
ends its coordinator focus, not its independently running workers. On opening a project,
persisted worker records and durable transcript run control reconcile sources: idle/stopped/
finished transcripts cannot claim working. Missing transcripts become unknown. Legacy Now
is never a phase; existing historical snapshots keep their original prose.

Worker title is the initial work description. Optional `task_progress.now` remains compatible
but is a short phase, whitespace-normalized/bounded to 160 characters, changed only when the
phase really changes. It expires with that run, including queued/resumed runs. Generation
hooks use durable first-entry run identity, not token/tool activity. Worker request hooks
read the stored run marker first and enter a transaction only when it changes (with a
transactional recheck); subsequent requests in the same run are read-only. A truly empty
harness transaction is discarded before storage/publication, but avoiding the transaction
also avoids opening/normalizing the board on every model request. Workers keep evidenced
`addResult` and explicit milestones. Coordinators keep writing Results/Next; legacy
`write_report.now` sets that coordinator's turn-local phase and task focus. Task-tagged
submissions establish focus, including feedback and further task-scoped inputs placed in
the same turn. Moving a task, writing its report, spawning/sending its worker, or asking/
deciding on it also implies focus in the action's existing transaction. These touched tasks
stay focused for the rest of the turn. A background thread's own initial taskId is focused
while it runs a turn, not every task it holds. Ownership/claim alone is not activity.
Focus/phase ends on turn end, failure, stop or release; no phase carries into a later turn.
There is no prompted focus action or extra agent call.
All project prompts state that Now is automatic and ask agents for Results/Next, not prose Now.

Every emitted task mirrors `activity.text` into legacy `report.now` for old clients. This is a
read projection, not a report rewrite: `report.updatedAt`, `updatedBy`, `revision`, Results/Next
section dates/versions/coverage and task eventSeq are untouched. Raw legacy strings in stored
reports are ignored for live rendering; history/snapshots remain immutable. Phase/activity
changes add no timeline rows, snapshots, freshness facts, nudges or model calls. Ordinary
board document transitions push immediately; clients tick ages without polling writes.
The scheduled-report path still records Results and review state; it cannot leave prose Now.

### Report freshness (T121, stage 1 of T120)

The web Report section shows section-local ages (ticking locally every 30 seconds), uncovered event
counts and quiet “needs update” reasons only when both the capability and freshness metadata exist.
The Report header’s icon is a one-tap “This looks out of date — ask the agent to update” action:
no dialog, section choice or reason field. Success shows a check and “Asked the agent to update” for
four seconds, also announced politely; errors appear in a dismissible error toast. On narrow screens
the header wraps the confirmation rather than overlapping its title. Empty finished Results metadata
omits the repeated missing-write/work-finished explanation. Now and Timeline
remain unchanged. Missing metadata retains the original Report rendering, without inferred ages.

`task-freshness` advertises deterministic Results/Next coverage. Now stayed agent-written in stage 1; stage 2 above replaces it;
report rewrites and stale marks add no timeline rows. `task.eventSeq` is a persisted monotonic count of
meaningful task facts, independent of the bounded timeline. The optional `report.freshness.results` and
`.next` each contain `writtenAt` (nullable ISO date), `writtenBy` (nullable BoardWriter), `version`,
`coveredEventSeq` (nullable for legacy), `approximate`, `stale`, `eventsSince`, and `reasons` (up to three
short causes). Next can also carry `waitsOn: string[]` for explicit Q/task/change/deploy dependencies.
Clients show “written 2 h ago · 6 events since · needs update”; approximate dates say “about”. Empty
Results at review/done say “No results yet · work finished”. Shared report dates/revisions remain for
old clients; refreshing Now never refreshes either section date. Missing feature or missing freshness
metadata means the old backend UI, never an inferred freshness claim. Missing hello.features does not
imply this feature. All existing wire fields and requests remain valid.

Android's Report shows section-local ages and uncovered event counts below Results/Next in one muted,
wrapping metadata line. Only “needs update” is emphasized; reasons remain muted and use semicolons.
A speech-bubble alert icon at the header's right edge, beside its timestamp, requests an update in one
tap, with no dialog, section choice or reason. Its 48 dp target has the TalkBack label “This looks out of
date. Ask the agent to update”. It sends only projectId and taskId to board.report.stale. Success shows
“Asked the agent to update” beside a check for four seconds, announced with a polite live region; errors
use the usual inline error message. Status never changes. Empty Results on review/done are explicit.
Ages reuse the sheet's local 30-second clock; Now and Timeline are unchanged. Without task-freshness
the Report retains its earlier display.

`board.report.stale` takes `projectId`, `taskId`, optional `sections: ["results", "next"]` (omitted means
both written sections, plus empty Results at review/done; a nonempty explicit subset is still allowed),
and optional `reason` (1–160 characters), retained for existing clients. The web sends neither optional
field. User requests default to “you asked for an update”, are immediately due (no trailing debounce),
and rearm delivered-version suppression. They merge with anything already due; repeated taps while
one request is pending/frozen/in flight add no fact or nudge. After the prior receipt completes, a
new deliberate tap can ask again even without a rewrite. Explicit owner requests are allowed on done
and dropped tasks without reopening them; only written sections and empty Results on done need work.
It returns the task and broadcasts normal board state. It never changes status. The request and automatic detection are gated
by the feature; disabling it does not delete existing prose or metadata. The bounded small-model audit
below uses the same `markReportStale` path as this action.

`show_task` prints `eventSeq`; `board.write_report` and worker `task_progress` accept optional
`coveredEventSeq`. Workers can call `task_progress` without report fields to read their task and sequence
before writing. A changed-prose rewrite that omits coverage covers the task's current sequence at write
time, so ordinary agent rewrites clear stale badges even after a task was read through list or discussed
in chat. Agents that read earlier and write later can pass the sequence they read: explicit coverage is
clamped to the current sequence without regressing prior coverage, and concurrent newer facts stay stale.
A no-op covers nothing, whether coverage is omitted or explicit. A substantive rewrite
bumps only that section's version and date; identical prose does not clear staleness or rearm nudges.
A covered rewrite clears its stale causes and rearms that section. An uncovered rewrite retains its
pending admission or delivered suppression, rather than creating a nag loop. Milestones are authored
facts: non-coordinator milestones invalidate only sections not substantively rewritten with the milestone; they may advance
explicit coverage over their own event only when no unseen sequence gap precedes it.

The reducer `noteTaskFact(state, taskId, fact)` (and BoardService method) is the entry point for lifecycle
facts and later verified commit/deploy adapters. Internal facts carry an actor (user, coordinator, worker,
or harness; omitted/unknown attribution conservatively means harness). Automatic facts on done/dropped
tasks never become stale or nudge: closing clears automatic stale causes, pending admissions and
undelivered batches. An explicit owner request survives normalization/closure until its prose is
updated. Other tasks in
cancelled batches remain pending for rebatching. Reopening does not retroactively invalidate old facts.
Coordinator-authored facts (main or any thread) only count, except moving to review with empty Results:
that real gap invalidates Results and may nudge. Worker start/resume never invalidates either section.
Other actors’ answers/withdrawals (nonempty Next; any task question without waitsOn), resolved blockers,
handoffs, stage changes and feedback invalidate Next; worker outcomes/stop, thread finish/failure and
verified harness outcomes still invalidate. Results invalidates on outcomes, non-coordinator decisions
and addressed feedback. All meaningful facts still bump eventSeq/eventsSince, including closed tasks
and suppressed nudges. Causes preserve the first important reasons and latest cause.
No individual tool/progress/poll is a fact. Legacy dates are approximate from the shared report timestamp,
coverage unknown: normalization itself neither creates a fact nor queues a nudge.

At turn end the “discussed in chat” fallback only considers tasks explicitly named in user inputs
(valid typed IDs, even a short `T12?`, or a `[task T12, feedback F3]` scope). Harness-only turns answering
`[check-in]`, `[board]`, `[reports]`, worker/thread reports or `[from …]` messages never qualify: their
structured lifecycle rules already cover task facts. An outgoing coordinator reply or delivered thread
message must also mention that same task outside quotes/code/links/transport prefixes/templates, with
at least 40 other characters. Incidental reply IDs and unscoped user messages without task IDs do not
qualify. Done/dropped tasks never count. Successful report or feedback-state board tool results,
including nested tool results, exclude that task for the whole run. Otherwise only Results/Next sections
not written after the relevant user input's transcript timestamp become stale and may nudge (latest
user timestamp per task when several inputs are placed in one run). This covers a queued user message
already reflected in a preceding turn's report. At most one harness-detected chat fact per task per turn;
this is a coverage warning, not an inference that the reply contains new facts. Outgoing thread messages
are durably held until the sender's run ends so a later write in that turn can cover them; harness-only
turns consume and discard these candidates too. Two bounded snippet/source references are retained
internally; no chat is added to the timeline. T135 narrows the earlier reply-only heuristic to avoid
no-op rewrites and cross-task `[reports]` ping-pong. The age backstop runs at most hourly per project
(last sweep persisted), only for in_progress/review/waiting and only when meaningful activity is newer than a section at least two hours
old. Coordinator-authored facts and starts/resumes do not refresh that activity clock, so the backstop
cannot turn them into delayed self-nudges. Quiet old reports never wake anyone; the sweep is a coverage
warning, not another counted fact.

Stale marks are synchronous. Automatic nudge defaults are 30 s trailing and a 2 min maximum from the
first trigger; explicit owner requests are due immediately but use the same durable follow-up queue;
BoardService `reportTimings` injects trailing/max/age/sweep/token limits in tests. Pending task sections and
versions merge into a durable burst. Due tasks batch by owning running/idle coordinator, otherwise main,
in one `[reports]` line of approximately 100 tokens. Overflow stays pending; a durable in-flight receipt
prevents another batch to that coordinator until the previous input settles. The frozen outbox stores the
exact content, target and admission key (task + both section versions + burst), before submit. Delivery
reuses the board's durable `whenBusy: "followUp"` path: idle coordinators wake, busy turns are never steered
or interrupted. Replay after admission reuses the same request ID, then acknowledges the outbox; startup
reconstructs timers and receipt waits without inventing activity. Delivery suppresses unchanged versions
of both sections even if another cause becomes stale just afterward. Badges/counts continue updating;
only a covered rewrite rearms. No model tokens are spent on detection and there are no freshness pushes.

### Report audit (T126, stage 6 of T120)

D60 makes this second opinion **on by default**, superseding the optional/off proposal in the research
note. `report-audit` advertises settings/status support; absent features never imply this capability.
Project settings → Coordinator has a feature-gated **Report check** group on the web: Automatic
(default), Off, or Choose a model using the existing catalogue picker. Mode/model changes save at once;
the daily token budget saves on blur or Enter, with the neighbouring settings' saved/error feedback.
Choosing model mode without a prior model waits for a selection before saving. The status uses only
the server's effective model and token use on one muted line, then last-run time and state/reason
on a second; the browser never predicts the
automatic choice. Ages tick locally. A missing advertised feature hides the group, even before hello.

Android Project settings → Coordinator includes a feature-gated Report check group beside Show UI changes.
Mode offers Automatic, Off, or Choose a model using the searchable model picker. The daily token budget
saves on leaving the field (default 65,000). Two muted status lines show effective model/provider and
UTC-day token use, then last run and state or reason. Missing `report-audit` hides the group.
`projects.configure.reportAudit` replaces the project setting:
`{ mode: "auto" | "off" | "model", model?: ModelRef, dailyTokens: number }`; null restores
`{ mode: "auto", dailyTokens: 65000 }`. Model mode requires a catalogued model ref; explicit model
choice can be larger, but the same token limits apply. Settings survive older clients' unrelated writes.
ProjectSummary includes optional `reportAudit` and `reportAuditStatus` (`effectiveModel`, UTC `day`,
`tokensUsed`, `lastRunAt`, `state`, `reason`). States are idle/running/checked/error/budget/off/unavailable.
A closed project's last status is read without opening a Harness; its JSON mirror is display-only.
Summary effective-model resolution is cached for 60 seconds across projects sharing the same mode/ref;
pending credential checks are coalesced, and a changed mode/ref uses a different cache entry.
The board document owns the authoritative budget and coverage. No client/model default changes apply
to coordinators, workers or memory: this audit is the **sole server-chosen model default**.

Auto uses the first credentialed provider listing `claude-haiku-5-5`: anthropic, then opencode-go;
otherwise credentialed openai's `gpt-5-nano`; otherwise the cheapest small openai-codex catalog model.
Small Codex entries have input price <=0.25 and output <=1.5 per million tokens, sorted by estimated
2600-input/100-output price, then ID. The current catalog chooses `gpt-6-luna` (0.1/0.5), not a flagship.
The same `checkAuth` contract as `describeModels` is used. No suitable credentials/catalog entry means
idle/unavailable with "no signed-in provider offers a small model"; no request or login is attempted.
Anthropic thinking is off (the simple API can otherwise increase maxTokens for a thinking budget);
other reasoning models use minimal thinking. Non-reasoning models have no thinking option. Hidden
thinking blocks are ignored by the verdict parser, but their tokens still count toward usage.

Open projects check hourly through the board clock and when main's coordinator activity becomes idle.
Every trigger requires at least one hour since the last admitted run, using persisted `lastAttempt`;
new evidence or a restart does not bypass that spacing. Idle is the preferred moment to admit a call,
not a per-turn opportunity; the hourly timer catches projects whose coordinator never goes idle.
Admission rechecks the spacing in the durable transaction before reserving tokens.
Archived projects, disabled freshness, closed/done/todo tasks, quiet covered reports and tasks whose
unchanged section versions have pending/outbox/delivered nudges are excluded. Only uncertain active
(in_progress/review/waiting), non-deterministically-stale sections with uncovered task facts qualify;
coverage also detects changed timeline revisions/chat evidence after an audit. Quiet migration alone
makes no request. One invocation chooses at most four tasks (one call), with bounded title, Results/Next
and ages, recent timeline lines and mentioning snippets. Serialized evidence is valid JSON, <=600
estimated tokens/task; instructions plus framing fit within 2600 estimated input tokens. Output is
capped at 100 tokens. There are no tools, tool loop, conversations or prompt-cache writes.

All task/chat/timeline text is explicitly untrusted evidence, delimited and JSON-escaped. Only strict
JSON lines with supplied task IDs, exactly results/next keys and values `fine` or `stale: <short reason>`
are accepted. Extra keys, duplicate task rows, prose, malformed/partial JSON, tool blocks, errors and
truncated responses are ignored as a whole and logged once. A stale verdict uses `markReportStale`
with `audit: ` reason prefix: normal durable batched nudge, never direct report edits/status changes.
Fine/truncation never clears deterministic stale state. A section rewritten during a call is protected
by its version; closed tasks cannot be marked by a late response.

Before requesting, persist task eventSeq/evidence coverage and reserve estimated input + 100 output
against the UTC-day project budget. Insufficient remaining budget makes no call. Success settles to
provider-reported input + cache reads/writes + output (including thinking); project status reports
this total. Errors/timeouts/stop retain the reservation conservatively when usage is unknown. Provider
tokenizers may differ from the estimator; reported overages stop later calls rather than hiding usage.
A 30-second abort/race bounds even hanging providers; close aborts/waits for this service before storage
closes. Concurrent triggers share one promise. Restart restores admission, so unchanged evidence is
not retried even after failure/crash/stop; new evidence is eligible later. Audit-created stale facts
are not their own new evidence. Provider results flow through `observeInternalModels` with purpose
`report_audit`: usage breakdown labels **Report audit**, attributed to project/model (not a fake task
or conversation). No prompt text is stored in the request log. No audit-specific pushes are added.

### Tasks board

Decided with the user on 2026-11-06. Web only; protocol addition: the optional `note` on `board.task.save` (feature
`board-moves`). Code: `apps/web/src/lib/kanban.ts` (columns, sorting, moves, the remembered view), `TaskBoard.svelte`,
`TaskCard.svelte`, `TaskMoveMenu.svelte`, `TaskMoveDialog.svelte`, `TasksView.svelte`.

- **Where.** The sidebar's Tasks tab at its usual width keeps the list. Expanded (its expand control), or as the
  full-screen sheet on a narrow window, it is the full-width Tasks view with a List | Board | Graph switch, remembered
  locally per backend/project (`tasks.view.v2:`, list by default). The Tasks button in the header opens this project's
  last choice: the list beside the chat, or the board/graph full width. The chat stays the home screen.
- **Columns by status.** To do, Working, Blocked, Ready for review, Waiting, Done. Done holds done and dropped tasks (dropped
  ones greyed and struck through), newest first, the 12 newest then "Show N more"; archived ones only with "Show
  archived". A task with an open question or warning stays in its status column, tinted like its list row; the
  toolbar's "Needs you" count (tasks waiting on the user plus questions about no task) filters to them. Questions
  about no task sit above the columns. No swimlanes.
- **Sorting.** To do by the board's `order`, which is the user's priority (drag within To do, or the menu's "To the
  top / Up one / Down one"); Working by time in progress, longest first; Ready for review by how long it has waited,
  longest first (`updatedAt`); Blocked by order; Done by when it closed.
- **Cards.** What a list row says (status dot, title, gist, refs chips with live state, time, ID) plus, when there is
  one, the worker running on it, the open tasks it waits for and the background thread that holds it. The title's
  link covers the card and opens the task sheet; chips and the menu sit above it.
- **Moves are instructions.** A move is a `board.task.save` of the status alone (revision-checked; a conflict snaps
  the card back and says so), so it reaches the coordinator like any user edit: as a line in the debounced
  `[board] The user changed the board:` input. The coordinator section says what a move means, in fixed text: to
  in_progress is "start it now", back from review carries what still needs doing, done and dropped are the user
  closing the task, the todo order is the priority, and a move of a task a background thread holds is passed on to
  it. Ready for review takes no drops and the card menu never offers it; Waiting also takes no bare drops, since it needs a note. The task sheet's status menu offers every status. Moving a task from
  review back to Working asks for a short reason (required); it rides on the save as `note` and the `[board]` line
  reads `...; the user says: "..."`. On a backend without `board-moves` it goes as a message about the task instead
  (`[task T1] Back to working: ...`). Moving to Blocked asks, optionally, what it waits on (its blocked reason);
  leaving Blocked clears the reason. After a move a small notice says what happened, with Undo (not for a move that
  carried a reason).
- **Dragging and the keyboard.** Mouse and pen drag (pointer events, not HTML drag and drop): a copy follows the
  pointer, the column under it lights up, To do shows where the card lands, Done splits into Done and Dropped, Escape
  cancels, edges scroll. Every card has a "Move to…" menu, which is also the keyboard and touch path.
- **Live.** When an agent moves a task, a copy of its card flies over the board from its old place to its new one
  (a column's own scroll box would clip the card itself); not under `prefers-reduced-motion`, and not for the card
  the user just dropped.
- **Phones.** Below 640px of board width one column shows at a time, with the column names as tabs and a swipe
  (scroll snap) between them; no dragging, the menu moves cards.

### Collapsible task families (T74 / D44)

The web task list uses collapsible families, with no prototype switch or query flag. Kanban remains unchanged.
Quiet same-status children nest beneath their parent with a 14px guide/indent capped visually at three levels.
A task having subtasks never adds a leading column: status, title, status line and trailing time/ID keep exactly the
same positions as plain rows at every width. The neutral direct-subtask progress pill (ring, done/total excluding
dropped, and a small rotating chevron) is the disclosure itself; non-foldable families show progress without a
chevron. Parent links, grouped relation glyphs/counts and progress share a compact inline meta line with the gist
where it fits, with no padded metadata row. Grouped relations expose every target in their menu and full tooltip
and accessible description. Waiting notes already beginning with “waiting for” (case insensitive) are not prefixed again. Root families and siblings
retain priority order; nesting puts a parent before its children. Section counts still include folded rows.

**Visibility takes precedence over collapsing.** Nest only when parent and child share both status and section. A
child in another status, or in Needs you when its parent is not, keeps its own row in the original group, with a
muted `↳ T57` link to the parent. Review, blocked, waiting, open-question and open-warning descendants always remain
visible, even if the saved parent choice is collapsed; any required ancestor path remains visible too. Do not show
an ineffective disclosure when every nested child must stay visible. A newly blocked/review/waiting task or question
therefore appears immediately without requiring the user to reopen a family. Waiting sections start open (the user
may still explicitly fold a whole section); recently closed starts folded unless it contains an open question or
warning. Filtered, archived or missing
parents leave visible children at the group root with a parent link. The linked-task focus filter still applies.

**Choices and access.** Quiet families default collapsed. Explicit true/false choices persist per parent in the
project/backend-scoped local key `aiki.task-families.v1:<backend>:<project>`; nested choices survive closing their
ancestor. Storage failure falls back to in-memory choices. Progress disclosures are separate native buttons with
`aria-expanded`, Enter/Space support, visible focus and expanded hit areas that do not consume layout space. Hierarchy is expressed with real nested lists,
not an ARIA tree, so the list retains ordinary Tab navigation (no new arrow-key mode). No expansion animation; reduced
motion also disables existing row/status motion. Found-while, blocked-by and related glyph links have accessible names
and native title tooltips. Feedback counts, ref links and task navigation remain.

**Android (T74).** The Compose list follows the same nesting, ordering, attention visibility, parent links and
progress rules, with 14dp guides capped at three visible indent levels. Parent expansion is stored in the existing
local device settings record under the name-neutral `taskFamilyExpansion` field, keyed by backend origin, project
and parent ID; true and false choices both survive app restarts and closing an ancestor. Progress disclosures have
48dp minimum touch hit areas, without reserving that layout width/height, TalkBack expanded/collapsed state descriptions
and native keyboard activation. No disclosure column is reserved for parents or descendants. Relation glyphs/counts
use the same invisible minimum touch expansion; grouped menus retain individual target navigation. No expansion
animation is used; the existing reduced-motion setting also stops working-dot motion. Small relation controls
supply spoken labels and long-press tooltips instead of browser title tooltips. Explicit list filters and section
folding remain user controls; attention sections start open. No protocol/backend change is needed.

### Combined task search (T114)

The existing List and Board filters now include one project/backend-scoped search field on web and Android.
The list (including the narrow sidebar) switches from status groups to one relevance-ordered result list while
searching. Board uses the same matches but retains its status columns and their normal sorting. Graph has its own
search and is not involved. Empty queries restore the ordinary list, family disclosures and ordering.

Both clients own the same small scorer and BM25 implementation, without a JS-only search dependency. Shared
expectations in `packages/protocol/test-vectors/task-search.json` assert fuzzy scores, UTF-16 highlight ranges,
exact IDs/refs, merged ordering and family context on TypeScript and Kotlin. Simple character lowercase preserves
UTF-16 offsets; body tokens are Unicode letters/numbers. No stemming, accent removal or semantic expansion.

**Ranking.** A whole trimmed query equal to `T112`/`112`, PR `#4316` or ticket `ABC-123` is an exact hit (case
insensitive). PR and ticket keys are extracted from refs/labels, not arbitrary body occurrences. Title and ref
labels/titles use a best-subsequence dynamic program: each letter earns 10, a word/camel-case start adds 8,
consecutive letters add 6, and position `p` adds `2 / (p + 1)`. Whitespace in the fuzzy query is ignored. Title
score has weight 1, refs 0.7; the strongest short-field score is `F`. Precomputed lowercase fields/boundaries and
reused scratch arrays avoid retokenizing/reallocating per field on typing (web also visits only matching character
positions). Best-path backtracking supplies title highlights; refs need scores only.

Body BM25 indexes description, report now/results/next and feedback text. `k1 = 1.2`, `b = 0.75`,
`idf = ln(1 + (N - df + 0.5) / (df + 0.5))`, and each term contributes
`idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / averageLength))`. All query words must match; only the
last word expands to vocabulary prefixes, unless the query ends in whitespace. Prefix alternatives take their
maximum contribution, not their sum. Words contribute additively to body score `B`. The merged score is:

- exact: `4`;
- fuzzy: `2 + F / (F + 40)`;
- body-only: `1 + B / (B + 4)`.

Thus body frequency never overtakes a short-field hit, nor fuzzy an exact identifier. Ties retain index insertion
order. Updating the board compares document text, adjusts only changed/deleted postings and maintains document
frequencies/length totals. The sorted vocabulary is refreshed after changes, never rebuilt for each keystroke.
Feedback is absent from board DTOs: clients read timelines only for tasks with nonzero feedback counts and cache by
timeline revision; reads run asynchronously with bounded concurrency, independently of the query. Failed reads retry
on a later board update. Ref metadata enriches short fields when the existing ref-status watch supplies titles.

**Context and controls.** Missing ancestor rows are inserted before their first matching descendant and dimmed;
cycle guards prevent malformed families looping. Search does not fold away matching subtasks. Existing explicit
the linked-task filter and archived visibility remain authoritative, including for context ancestors. List
“Show closed” reads/writes the existing recently-closed section expansion choice; closed tasks stay out until it is
on. Board retains its existing Done/archived rules. Title letters are highlighted without HTML injection; body-only
hits get a bounded one-line snippet. No matches has its own message. Escape and Clear empty the field. Queries persist
per backend/project under web `aiki.task-search.v1:` keys and Android private `aiki.task-search.v1` preferences;
no query, index or ranking is sent to the server. Changing search never alters tasks or their normal priority order.

### Animated task graph (T79)

Connected work was reverted at the owner’s request (F22 on T103); Android is unchanged.

Bubble club is the chosen web graph: soft clusters and round worker creatures, without a look flag or alternate
renderers. Expanded Tasks offers List | Board | Graph; the narrow sidebar stays a list. The choice is local per
backend/project under the name-neutral `tasks.view.v2:` key. Graph is read-only; tasks open the existing sheet.

- Active tasks appear by default; Show closed adds faded done/dropped tasks. Archived tasks stay out. Parent families
  gather together, including nested descendants. Solid parent, dotted found-while, dashed related and arrowed blocked-by
  edges have a legend. Arrows point from the blocked task to what it needs. Status has colour and spoken words;
  parent progress rings show done/total. Review, open questions/warnings and failed workers mark attention.
- Existing board/worker/thread watches supply real shapes. The graph reads the project-wide worker list without
  changing the chat's thread filter. Running creatures type and sway gently; idle ones breathe and sleep. Changed
  nonempty reports send one spark, never a periodic fake report. Reassigned workers travel to their new task;
  finished/removed workers fade away. Threads are bigger characters linked to their tasks and workers.
- A small deterministic layout module pre-settles new nodes before rendering. Existing task positions stay fixed on
  watch replacements; arrivals ease in and updates never refit the camera. Collision bounds include caption space.
  Label placement excludes nodes and other labels; minor labels disappear at low zoom or when no safe slot remains.
  Hover/focus reveals a full-title tooltip and highlights family/blockers. Every node is keyboard focusable.
- Initial cluster columns follow the viewport aspect ratio; retained positions do not reflow on resize or watch updates.
  First open fits the active graph with padding on desktop and phone. Fit resets framing explicitly. Drag nodes or
  pan the background; wheel, buttons and pinch zoom. Camera state is local per backend/project under
  `task-graph.camera.v1:`. Resizing preserves world centre and zoom. No link editing or task moves.
- Reduced motion disables floating, typing, transitions, departing fades and sparks, retaining status, progress and
  attention. List remains the full accessible reading path. Android keeps its separate native family graph below.
- Synthetic proof uses the throwaway backend seed script. Loopback-only controls exercise reports, reassignment,
  completion, task arrival and 80 tasks/10 workers. No installed data or real worker tools are used.

**Android family graph and project canvas (T115–T116).**

Native Tasks offers List | Board | Graph, remembered per backend/project with the old global choice as a fallback.
Graph starts at one readable family, preferring a linked selection, otherwise the most needs-you tasks after crew
loads. Previous/next and a family picker preserve tree order. Hidden ancestors and cyclic parentage retain stable
family identity; roots without subtasks still get their own group. Cards use status colours, marks and words, quiet
subtask guides, overlapping reason marks, waiting dates, quiet age, family progress and unfinished holds-up totals.
Compose creatures stand above the card edge: rounded bodies, antennae, busy typing/sway, resting eyes/breathing/z,
and a failure mark. Workers and non-main threads are keyed by identity; canvas reassignment travels in world space,
arrivals/finishes fade, and a changed non-empty report emits one bounded drawn spark. Disabled animations, background
lifecycle and obscuring phone dialogs stop decoration without dropping status, report text or Updated marks.

The horizontal summary highlights rather than removes context, and offers the next matching family. Search ranks
ID, title, family, worker and thread matches using the web weights. Picking a result reveals/selects it. Selection
is stored by ID, so watched replacements update the scrollable native bottom sheet in place, including a missing-task
notice; wide windows use a 360dp side panel. Relationship links select their endpoints, and Open task opens the
existing TaskSheet. Back dismisses the sheet, then selection/highlight, then the canvas to family view, then returns to List. Loading, empty,
all-closed/Show closed, no-match and offline/reconnecting states keep stale content rather than clearing the board.
Controls have 48dp targets, card semantic names include reasons/progress/crew, and the lazy list supplies tree-order
TalkBack traversal. Text and sections scroll/wrap with system font scaling; the view switch wraps at large sizes.

The compact native toolbar gives overlapping counters a full-width scroller below the view choice. Search and a
badged Changes/history icon sit together; connection tint/dot and a spoken Live/Reconnecting/Offline state stay
compact, with full connection status/age in overflow alongside Show closed/overview/line legend. A pinch out or
All families opens the project canvas at readable cards. Floating 48dp family/Fit/zoom/Regroup icons, pan,
pointer-anchored pinch and double-tap change only the camera. A fixed 300×104dp canvas body holds ID/status, two
title lines and one compact reason/progress/quiet/holds-up row, with a 32dp crew band above and 12dp between occupied
rows. Initial system-font scaling is retained until Regroup, not recomputed from watched content. Native slots are
larger than web slots to hold real system text. The pure layout port retains hidden named
slots, two arrival reservations, family positions and ancestry until explicit Regroup; only overflowing growth can
move a colliding region. Structural inputs exclude status, reports and crew. Shared web-generated layout vectors
check exact card/pill/region/slot geometry through hiding, arrivals and overflow.

Cards yield to single-line pills, then screen-sized family dots at world-anchored region centres. Detail hysteresis
is asymmetric: leave cards below 12/14 zoom and pills below max(12/22,48/72); re-enter 8% higher. All text stays at
least 12sp on screen. Dot fit frames anchors instead of tall hidden card bounds, limits zoom to preserve readable
132–168dp screen-space label budgets (expanded for large fonts), and never detaches anchors. Explicit word-boundary
wrapping permits two label lines with an end ellipsis; full names remain in TalkBack. Counts inside the ring refer
to visible tasks; the small badge counts unique needs-you tasks, not summed overlapping reasons. Ring segments use
the visible status mix. On a phone, readable spacing can require panning rather than fitting every family at once.
Only nodes/crew within 180dp of
the viewport compose. Solid subtask routes use branch gutters; found-while is dotted, blocked-by dashed with an arrow
toward the prerequisite, related dash-dot. Nonparent routes are scoped to the selected task/family and cross-family
routes use exterior corridors. Canvas nodes expose button semantics in tree/slot order; family view remains the
complete linear reading path.

Changes retains 50 session entries, fixed one-second batches, latest report lines and an unseen-entry count. Entry
links explicitly reveal/select their task; incoming changes never refit the camera. Cards get a 1.5s glow/Updated
mark; closed work lingers with a faded fill for 4.5s and keeps its named slot. An off-screen changes chip reveals
only on a tap. Weak board-scoped session storage preserves bounded history through responsive remounts. First load,
remount and reconnect establish a baseline after the shared board and crew reads complete for the current socket
generation; no guessed delay or invented reconnect arrivals. The pause/clock handling is graph-local, not a new
background service. Physical-device frame/battery budgets and a full TalkBack session remain unmeasured.

Pure Kotlin semantics live under `features/tasks/graph/`. `apps/android/scripts/graph-vectors.ts` generates the shared
synthetic `test-vectors/task-graph-v1.json` from the actual web model; `--check` detects parity drift. JVM tests compare
all task details, counters, search weights/order and cycle/diamond-safe dependency counts, plus native family order,
closed selection retention, quiet boundaries, scoped preference serialization and Back transitions.

The pure web model, family layout, change helpers and busy fixture remain only for Android vector generation,
with their regression tests; the web bubble renderer does not import them.

### Ticket and pull request links

Decided with the user on 2026-11-06 (cards on 2026-11-07). Contract in `packages/protocol/src/refs.ts` (features
`ref-status` and `ref-details`).

- **Link settings per project.** `ProjectLinks`: a Jira site, ticket prefixes ("EX") and GitHub repositories
  ("owner/name"), in `project.json` as `links` (null: filled in automatically) and in `ProjectSummary.links` (optional,
  with `detected`). Filled in by the server (`project-links.ts`) from the project's git remotes (jj's without git),
  the prefixes named at least three times in the last 300 commit subjects, and the host's `acli` login, taken as the
  Jira site only when the commits name tickets. Editable in project settings ("Tickets and pull requests"); "Fill in
  automatically" sends `links: null`.
- **One resolution.** `resolveRef` (protocol) is the only place a ref becomes an address, used by the app for links
  and by the server for status: GitHub and Jira URLs as themselves, `#123` only with exactly one repository,
  `name#123` for a repository the project has, `owner/name#123` always, `EX-1234` through the Jira site. In running
  text (`refMentions`) a key links only with a listed prefix, since "UTF-8" has the same shape; a ref links whatever
  its prefix.
- **Where text links.** Every `Markdown` on a project screen (chat replies, task reports, worker reports, files)
  through the `ref-links` context, user messages and the task sheet's title; never inside code spans or blocks,
  Markdown or HTML links, tags or addresses. Row titles stay plain: the row is the task's link.
- **Chips open their target.** A row's link starts at its title and stretches over the row (`::after`); the ref
  chips sit above it (`.ref-chip`, `z-index: 1`), so neither link is inside the other and a click on a chip opens its
  ticket or PR in a new tab without opening the task. On touch screens a chip's tap area reaches past its edges, and a
  tap opens its card instead (below).
- **Live state.** `refs.status` answers the state of the refs the host can read: pull requests (open, draft, merged,
  closed, checks passing/failing/running on the latest commit) and issues through `gh api graphql` (one query for up
  to 40, about one point of GitHub's 5,000 an hour), Jira tickets through `acli jira workitem search` (one search for
  up to 50, only for the site `acli` is logged in to). Cached on the server (`ref-status.ts`): open things 2 minutes,
  finished ones and missing ones 30 minutes, concurrent asks share one read, a failed read keeps what was known, and a
  source whose tool is missing, logged out or rate limited rests 10 minutes. What cannot be read is left out, never
  an error. The app reads the board's refs when they change, every 2 minutes while the page is visible and on coming
  back to it (`ProjectRefStatus`). Chips get a dot in the task tones (open like working, draft or not started like to
  do, merged or done like done, closed like dropped, failing checks like blocked); the sheet lists each ref with its
  state in words and its title.
- **Cards.** Every link to a pull request, issue or Jira ticket on a project screen has a card: chips on rows and
  board cards, the task sheet, linked keys and numbers in chat, reports and user messages. One `RefCardHost` per
  screen listens to the page (no wrapper per link, so `{@html}` Markdown links get cards too). A pull request's card:
  repository and number, title, author, state, branch → base and whether it conflicts (while open), checks counted
  ("16 passed, 1 failing") with the failing ones named, reviews (approved by, changes requested by, waiting on), lines
  added and removed, files, last update. An issue: people, labels, comments, the start of its description. A ticket:
  key, type, status, title, priority, assignee, reporter, parent (the epic), sprint, the start of its description,
  last update. All: the tasks whose refs name the same thing (by `refIdentity`, so `#12` and its URL are one; each
  opens the task sheet) and an "Open in GitHub" / "Open in Jira" button. With a mouse it opens after 400 ms of hover
  (150 ms when moving from one card's link to the next) and stays while the pointer is on it; keyboard focus opens it,
  Tab from the link goes into it, Escape closes only the card (not the sheet it sits in) and gives focus back; a click
  on the link still opens GitHub or Jira. On a touch screen a tap opens the card and not the link; a tap elsewhere
  closes it. Inside a dialog (the task sheet) the card is placed in the dialog, so its focus trap and outside clicks
  leave it alone, and it stays inside the dialog's visible part; elsewhere it sits under its link, over it near the
  bottom, kept 8 px inside the window (`placeCard`). Code: `lib/ref-card.ts`, `RefCard.svelte`, `RefCardHost.svelte`.
- **Details on demand.** `refs.details` (one ref) is asked when a card first opens, through `gh api graphql` (one
  query; GitHub's check tallies by state, more pages of checks only to name failing ones) and `acli jira workitem
  view --fields *navigable` (the sprint field is found by its shape, since each site numbers its custom fields).
  Cached on the server (`ref-details.ts`) for a minute, finished things 10 minutes, missing ones 5; asks that arrive
  together share one read; a failed read answers what was known; a missing or logged-out tool rests 10 minutes. The
  app keeps an answer for a minute too. Without the tool, the login or the feature the card shows what is known: the
  label, the link, the state last read for the board and the tasks naming it, never an error.
- **Older clients and backends.** Everything is optional on the wire: an older backend sends no `links` and lists no
  `ref-status` or `ref-details`, so only full URLs link, no state shows and cards carry only what the app knows; the
  Android app ignores all of it.

### Task links and feedback

Decided with the user on 2026-11-09 (decisions D23 to D25). Contract in `packages/protocol/src/board.ts`, feature
`task-links`; code in `packages/server/src/board.ts` (links, feedback, timeline), `workers.ts` (events and prompt),
web `TaskSheet`, `TaskRelations`, `TaskFeedback`, `TaskTimeline`, `TaskRelationChips`, `TaskFilters`, `lib/task-relations.ts`.

The problem: an agent that finds a bug or more to build while working files it as a new task with nothing tying it to
where it came from, and every round of feedback grew the description. The fix is links between tasks, feedback as
its own list, and a timeline; the description stays the original ask and the report stays "where it is now".

- **Four kinds of link, each shown from both sides.** Stored on the task that declares it (`parent`, `foundWhile`,
  `related`, `blockedBy`); the board view derives the other side (`subtasks`, `ledTo`, `blocks`).
  - `subtask of` / `has subtasks` (`parent`): loose. It is a link and nothing more: the parent shows its subtasks and
    their progress (`subtaskCount`, "2/5 done"; dropped subtasks are left out of the total), but a parent can go to
    review or close with subtasks open, and subtasks stay their own cards. At most one parent; no cycles (also checked
    through any depth).
  - `found while working on` / `led to` (`foundWhile`): the origin of a task discovered during work on another. At most
    one; no cycles.
  - `blocked by` / `blocks` (`blockedBy`): unchanged, presented with the others.
  - `related to` (`related`): a symmetric see-also, many. Stored on both tasks, so each side lists the other.
  - There is no "duplicate of".
  - A link to a task that is archived, done or dropped stays and is shown dimmed. The board view leaves archived tasks
    out, so it lists the archived ones that a shown task links to in `archivedLinks` (id, title, status).
  - Links bump no revision when added with the `link` / `unlink` tool actions (they are not part of what the user edits);
    `board.task.save` takes optional `parent`, `foundWhile` and `related` (left out keeps them, null clears the first
    two) and bumps the revision as any save does. The web app does not edit links; only the coordinators do.
- **Feedback entries.** Each `conversation.submit` with a `taskId` (the "[task T…] " messages, in main's chat and in a
  thread's) records the user's text, the time, the chat it came through (`threadId`) and an image count as an entry on
  the task: `F3`, an ID unique on the board (a counter, never reused). A message re-sent with the same request ID finds its
  entry. Past messages are not backfilled. The message the coordinator reads starts `[task T12, feedback F3] `, so it can
  refer to the entry; older readers take the task ID up to the comma.
  - State: `open` → `handling` → `addressed`, or `dismissed` ("not needed"). An addressed entry carries a short note
    of what addressed it: a commit, a result, "answered in chat" (the tool refuses `addressed` without one). Each change
    is kept with who made it (`changes`).
  - Who sets it: coordinators (main and threads) through the `board` action `feedback` (`handling`, `addressed`, or `open`
    to put it back); the user dismisses and reopens in the app (`board.feedback.set`), and the coordinator that holds the
    task hears of it as a `[board]` follow-up. Workers do not touch feedback: they keep the task's `now` through
    `task_progress` as before, and the coordinator, which reads their report, marks the entry addressed. This keeps one
    writer who has seen the evidence.
  - The task carries `feedback` counts (open, handling, addressed, dismissed); the entries live beside the task's
    snapshots (the per-task history document), so the board document does not grow with every message. The badge and
    the compact `list` count open plus handling.
- **The timeline** (`board.task.timeline`, optional `kinds`): in time order, the task's feedback entries and each state
  change, status moves, workers started and reported or failed, questions asked and answered, decisions, report
  milestones and link changes (from both ends). Built when asked from what the board holds (questions, decisions),
  the snapshots (status moves and milestones) and a small event log in the task's history (workers, links; capped at 500).
  The answer also carries the task's feedback entries, open first. `task.timelineRevision` changes whenever the history
  gains something the board document does not show, so a reader knows to read it again. `board.task.history` is
  unchanged.
- **Coordinator tool.** `add_task` and `update_task` take `parent`, `foundWhile` and `related`; `link` and `unlink` add
  or remove one link (`id`, `link`, `to`), refusing a second parent or origin (unlink first, or `update_task`);
  `feedback` sets an entry (`id` of the task, `feedbackId`, `state`, `note`). `list` shows `↳T8`, `found while T4`,
  `led to T9`, `3 subtasks (2 done)`, `related T5`, `blocks T7` and `2 open feedback`; `show_task` adds the links with
  titles, the feedback entries (open first) and the latest 15 timeline entries.
- **Coordinator prompt.** One passage in the tasks section: a "[task T12, feedback F3] " message is feedback, not for the
  description; mark it handling when acting and addressed with evidence when done; a task found while working on another
  always gets `foundWhile`; a planned piece of a bigger task gets `parent`; a see-also gets `related`.
- **Web.** Task sheet: a Related section grouped by kind (each link opens the task; closed and archived ones dimmed), the
  subtasks with status chips and a progress bar, a Feedback section (open first, state and note, Dismiss / Reopen), and
  a Timeline with kind filters. Rows, cards and the legacy board panel show a "↳ T8" chip on subtasks, a subtask count
  on parents and an open-feedback badge. The "Top-level only" filter is removed for now on web and Android;
  saved choices are ignored, so they cannot hide subtasks. The remaining filter, in all three renderers and kept in
  `tasks-view.svelte.ts`, is "Linked to T8", which keeps that task, every task it links to or that links to it, and
  everything below it (its subtasks and the tasks found while working on it or on them, to any depth); it is set from the
  sheet's "Show with linked" and cleared with its chip. The feedback and timeline come from one read, `board.task.timeline`,
  repeated when the task's `timelineRevision`, feedback counts, status or report move; the timeline section is folded by default.
- **Compatibility.** Every new field is optional on the wire; boards written before links and feedback load as having
  none. A backend without `task-links` shows none of the above in the app. Android follows the same feature gate and presentation.

### Hourly task timeline groups (T123, stage 3 of T120)

Capability `task-timeline-groups` adds optional `board.task.timeline.grouped: true`. Opt-in responses
add `groups` and `timelineRevision`; old `entries` and `feedback` are unchanged, including their filters.
Without both capability and opt-in, those new fields are absent. Clients choose groups **or** flat entries,
never concatenate them; absent groups means fallback, empty groups means no matching facts. The web sheet
opts in only with the explicit capability and renders collapsed group buttons with local ranges, kind,
label and fact count. Failure/open-question labels keep their emphasis. Expansion is keyed by opaque ID
and survives revisions, filters and order changes. Existing kind chips filter inside groups, recalculating
visible ranges/counts/labels with the server's failure/question/outcome priorities; unfiltered labels stay
server-authored. Expanded facts retain T118's rich rows, focusable entries and details, adding start →
outcome times for evolving sources. Newest-first/order toggle, local day headings and the 400px/48dvh
scroll region are retained; groups sort by starting hour/start, never evolving end. Grouped history reads
follow task.timelineRevision while the sheet is open (plus reconnect/task changes), not report/activity
pushes. Missing capability preserves the T118 flat UI. The Android contract follows below.
display retain the T118 order/toggle/bounded-height/day-group/richer-row contract.

Android requests groups only when the capability is explicit, otherwise leaving T118 unchanged. Groups replace
flat rows (including successful empty results), start collapsed and retain expansion by opaque ID across refreshes.
Each 48dp-or-larger button announces its local time range, category, fact count, label and expanded state to TalkBack.
Failures and open questions keep warning tones/icons in collapsed labels. Expanded rows retain actor, local start/end,
start → outcome and inspectable evidence. Kind filters are sent to the server so ranges, counts and labels reflect
only matching entries; filter choices remain available while filtering. The sheet rereads on `timelineRevision`,
including folded source updates, without forcing a scroll jump. The existing persisted reading direction, local day
headings and bounded nested scroll remain. The web contract is described above.

Each group is `{ id, kind, hour, range: { start, end }, revision, factCount, label, entries }`.
Kinds `work`, `decisions`, `delivery` mean Work, Decisions and feedback, Delivery. The bucket is the
entry's **starting UTC clock hour**, with at most three nonempty groups per task/hour. Localise displayed
times without regrouping by end time. Groups and entries are chronological on the wire, sorted by immutable
start, not progress. A run crossing hours stays in its starting group while the range end advances.
The group ID is task/hour/category-derived; expansion must use opaque IDs, not positions or labels.
Filters apply to expanded entry kinds before ranges, counts and labels are computed; omit empty groups.

Expanded `BoardTimelineFact` retains the existing seven wire kinds and entry fields (`at` is the start),
adding required `id`, `endAt`, `revision`, `group`, `outcome`, `factCount`, optional `source` category and
optional typed `actor`. Source IDs are stable task/source-derived hashes, not hashes of evolving labels.
One worker or thread episode, Q, F, deploy attempt or branch advance is one source entry. A worker episode
includes thread/conversation/run identity, so retries/name reuse cannot merge unrelated work. Initial thread
claim becomes its run in place; subsequent release/handoff entries remain inspectable. Answers and feedback
handling evidence stay in detail. Each attributed deploy attempt keeps intended and per-target serving commits,
latest target states/messages in detail; target updates replace, not append. Branch advances use durable fact IDs.
Local changes/check outcomes can use the keyed reducer when explicitly declared; no inference from tool logs,
chat or report text. Existing producers and source attribution rules are unchanged.

`revision` advances when an entry changes; group revision is the sum of visible entry revisions. `factCount`
counts meaningful lifecycle facts (start/outcome, asked/answered, feedback state changes), not intermediate
phases or target-detail refreshes. The monotonic per-task `timelineRevision` now covers Q/decision changes
as well as source/history updates; clients refresh cheaply from it. No new pushes or model turns are added.
Labels prefer failures, then open questions, over later routine successes. Otherwise combine worker outcomes
and status (`2 workers reported; ready for review`), latest Q/F (`Q1 answered; F1 addressed`), or landed changes
and latest attempt (`3 changes landed; live on 3/3 targets`). Failures and questions remain in existing attention
sections too; the hourly budget never hides an urgent signal behind a delayed flush.

Metadata edits, report rewrites, stale marks, phases, thread messages, check-ins, artifacts and tools are excluded.
Stable evolving source projections are bounded to 500 entries in task history, separately from legacy events.
Legacy events and immutable snapshots fold on read without upgrade/backfill writes; historical prose is not
converted into activity. New worker/thread/ownership projections do not manufacture additional flat rows.
Kotlin DTOs are generated from the protocol; clients must explicitly gate grouped display and preserve legacy fallback.

## Judgment, writing and resources

Status: backend done in `packages/server` (2026-11-05); the web side is built in parallel.

Decided with the user on 2026-11-05, after the overnight Android run (the coordinator spent four of five hours
re-certifying screenshots, reused a worker under a stale name, wrote dense jargon, and filled 11 GB of a VM's disk).

- **Knowing when to stop.** No time budgets. The board tracks each task's `inProgressMinutes` across every spell in
  progress. Check-ins state each running worker's task time as a plain fact and ask the coordinator to weigh what the
  remaining work would still add against what is already achieved, to stop or narrow work that is mostly polishing or
  re-verifying, and to ask the user with a board question when it cannot judge whether going on is worth it. The
  prompts say verification has diminishing returns: verify what the task's acceptance asks for, then stop.
- **Honest names.** `worker_send` takes an optional `title`: handing a worker a new task retitles it, and the prompt
  asks the coordinator to do that whenever the task changes.
- **Writing.** One short writing rule in every coordinator and worker prompt (plain words, short sentences, no coined
  labels, say what was done and what was not), plus per-model notes the user edits: Markdown files in
  `<configDir>/models/`, named by a provider/model pattern (`openai-codex--gpt-*.md`, `claude-bridge--*.md`; `--`
  stands for `/`, `*` is a wildcard), appended to the prompt of every conversation on a matching model, shown in the
  Info panel as context files of kind `model`. The text changes only when the model or a file changes (cache rule).
- **Notifications that fit long runs.** `work_finished`: once, when a project goes quiet (main idle, no workers or
  threads running) after at least 10 minutes of work, with the last reply's first line. Per-worker reports are off by
  default; `reply` is not sent while the project still has workers or threads running.
- **Resources.** `server.status` reports free disk for the data directory and every project's filesystem; below the
  threshold (default 15% or 10 GiB, whichever is smaller) main's check-ins carry one line about it and a `disk_low` notification goes out
  once. `projects.storage` measures each project's worker and thread workspaces, and `projects.storage.clean`
  removes finished ones; archiving a thread removes its checkout. The harness warns and never blocks.

## Scheduled tasks

Status: protocol, app (`packages/client`, `apps/web`) and backend (`packages/server`) done; event triggers are built
(2026-11-08, see below).

- A schedule is a brief the harness runs as a worker of the project's coordinator, whether or not anyone is around.
  It carries its own worker model and thinking level (null resolves like any worker: the composer's pick, then the
  project's worker models), its isolation (`shared` or its own jj workspace) and what the report does: `review` wakes
  the coordinator for a turn, `record` keeps it for the user's next message.
- The rule is an interval (every N minutes, 5 to 10080), a daily time, chosen weekdays at a time, five-field cron, or
  an event ("Event triggers", below). Every time is in the backend's timezone, never the browser's; the backend names
  it in every list it sends.
- Each schedule keeps its last 20 runs newest first: when, trigger (`schedule`, `catch-up`, `manual`), outcome
  (`started` with the worker, `skipped` or `failed` with the reason), and its `nextRunAt` (null while disabled).
  A run while the previous one is still running is skipped, not queued.
- The coordinator creates and edits schedules with its own tools; the app marks those "Created by the coordinator".
  Protocol: the `schedules` feature, `schedules.list` (list + timezone), `schedules.save` (create without a
  `scheduleId`, replace with one), `schedules.delete`, `schedules.run`, and the `schedules.state` push carrying the
  project's whole list.
- The app: Project settings has a "Scheduled tasks" card (hidden without the feature) listing each schedule's rule in
  plain words, its next run relative and absolute in the backend's timezone, its last run's outcome, a pause switch,
  Run now, edit and delete behind a confirmation, and a collapsible run history linking each started run's worker.
  The editor is a dialog with the four repeat rules, model/thinking pickers, isolation, on-report choice and enabled.
  The task sheet's worker rows and the worker cards in the transcript badge a worker a schedule started with that schedule's title.
  Each row with a task (`taskId`) has a small link to it.

### Schedules

Status: backend done (protocol, coordinator tools and CLI-less clock); the web side is built in parallel.

A schedule is a brief that runs as a worker of the project's coordinator on a clock. It is not a separate kind of
conversation: when it fires, the harness does what `worker_spawn` does — same model resolution, same isolation, same
brief and instructions, same report — with the schedule's title, brief, model, thinking level and isolation.

- Shapes: `interval` (every N minutes, 5 to 7 days, anchored to when the schedule was created so it does not drift),
  `daily` and `weekly` (a `HH:MM` wall-clock time, weekly with one or more weekdays), and `cron` (five fields; numbers,
  `*`, ranges, steps and lists, no month or weekday names so it means the same everywhere). All times are read in the
  backend's timezone (`schedules.list` reports it; `AIKI_TIMEZONE` overrides the host's clock, and `UTC` is the
  fallback). Each schedule has an `enabled` flag and can be run on demand whether it is enabled or not.
- What a report does (`onReport`): `review` posts it to the coordinator and wakes it, exactly like any worker's report;
  `record` appends it to the coordinator's transcript as an ordinary user entry (so the app draws it as a report card and
  the model sees it) **without starting a turn** — it reaches the model with the user's next message. A `record` run
  starts no check-ins either, since a check-in would wake the coordinator.
- Cleanup: a `shared` run is forgotten (`done`, dropped from the active list) as soon as it reports, so nobody has to
  merge anything; a `workspace` run stays idle with its workspace until the coordinator merges its change and calls
  `worker_forget`.
- Overlap: a run is recorded `skipped` with "previous run still running" while the previous run of the same schedule is
  still `running`; nothing queues up behind it.
- History: the last 20 runs per schedule (`at`, `trigger` = `schedule` | `catch-up` | `manual`, `outcome` =
  `started` | `skipped` | `failed`, `workerId`, `message`), newest first. The whole list is pushed to every connection
  as `schedules.state` on any change.
- Durability and the closed project: schedules live in `projects/<id>/schedules.json`, next to `project.json`, and are
  read without opening a Harness. One server-level scheduler (`ScheduleStore` + `ScheduleScheduler`) reads every
  project's persisted `nextRunAt`, arms a single timer for the soonest, and **opens that one project only when a
  schedule of it is due**; nothing opens projects at boot just to schedule them. The persisted `nextRunAt` is the alarm,
  so a process that was off sees it in the past and runs the schedule once on startup with trigger `catch-up`, then
  moves `nextRunAt` past now: several missed slots cost one run, never a burst, and a restart cannot duplicate one. The
  run is written to the history before the worker starts, its worker ID is `<scheduleId>-<yyyy-mm-dd-hhmm>` in the
  backend's timezone, and the reporter's request IDs derive from `<scheduleId>:<due time>`, so a retried slot finds the
  worker and the messages it already started instead of starting them again.
- **One board task per clock schedule** (decided with the user on 2026-11-09, a trial). Runs of a clock schedule used
  to start workers with no task, which showed only under "Workers without a task". Now each clock schedule has one
  board task, "Scheduled: <schedule title>", made by the harness on the first run. Its description says it collects
  the schedule's runs and names `settings#schedule-<id>` (plain text: the server does not know the app's backend ID,
  so it cannot write a link that resolves). Every run's worker (or thread) is given that task, so the task lists the
  runs' workers and shows the running one's automatic activity (`task_progress.now` supplies only a short run phase).
  - **Where the link lives.** The board's `task.scheduleId` is the link, and it is how the harness finds the task: the
    schedule's task is the open (todo, in_progress, blocked, review) task with that `scheduleId`. It already was that
    for `thread` schedules and for the "needs attention" task a failed run opens; those are now the same task, titled
    the same. The schedule record also keeps `taskId` (optional on `Schedule`; the harness sets it, the user's edits
    keep it, an event rule has none) and each run's `taskId` in the history, only so the app can link to it without
    loading the board. The board decides which task a run gets; `taskId` on the schedule is the task of its latest run.
  - **Reuse.** An open task is reused. If the user closed it (done or dropped) or deleted it, the next run makes a
    fresh one and stores its ID. Run now uses the same task. A schedule that existed before this gets its task on
    its next run; there is no migration.
  - **Status.** The worker's spawn moves the task to `in_progress` (a new task starts as `todo` and the spawn moves
    it, so the history shows `review → in_progress`), a failed start or run moves it to `blocked` with the reason,
    as before, and a skipped run ("previous run still running") also marks it blocked, as before. Success depends on
    `onReport`: with `review` nothing else happens, the coordinator is woken by the report, checks it and moves the task
    to `review` like for any worker's task. With `record` nobody is woken, so the harness does what the coordinator
    would: `results` becomes the latest run (time, worker and the start of its report; the full report stays on the
    worker), `now` is cleared, and a task still `in_progress` goes to `review`, without a `task_review`
    notification (the user chose a quiet schedule). A task someone else moved is not moved. Only the user closes the
    task: closing it is how they say "read it", and the next run starts a new one.
  - **Threads and events.** A `thread` schedule's thread claims the same task when it starts (as it did).
    Event runs are unchanged: one task per event run, no `scheduleId`.
  - "Workers without a task" stays: it catches a coordinator's own `worker_spawn` without a task.
- Tools (coordinator only; workers remove the extension, like the worker tools): `schedule_list`, `schedule_save`
  (create without an `id`, edit with one; schedules it creates are `createdBy: coordinator`), `schedule_delete`,
  `schedule_run`.
- Deploy: the deploy watcher's idle wait counts running workers, so a long scheduled run delays a deploy up to its
  10-minute cap. That is accepted.

### Event triggers

Decided with the user on 2026-11-08. The first event is "a GitHub pull request review was requested from me". Contract in
`packages/protocol/src/schedules.ts` (feature `schedule-events`); code in `packages/server/src/schedule-events.ts`.

A trigger is not a new thing. It is a scheduled task whose "when" is an event instead of a clock: same store, same
editor, same run history, same model, thinking level, isolation, `onReport` and `kind` (`worker` or `thread`). The
brief is the user's instructions; for the first use, a `thread` schedule whose brief says "review the PR and record a
demo video". The mechanism does not review anything itself.

- **The rule.** A new `ScheduleSpec` member `{ kind: "github-review-requested", repos?: string[] }` next to
  interval/daily/weekly/cron. Its `nextRunAt` is always null (there is no next time); the clock never looks at it.
  Features missing from an older backend hide the choice in the app; an older app shows a schedule it cannot read as
  "an event rule".
- **Where it listens.** The schedule belongs to a project and fires only for pull requests in that project's GitHub
  repositories (`Project.links.githubRepos`, filled in from the git remotes unless the user set them; see "Ticket and
  pull request links"), or in the schedule's own `repos` when it lists some (`owner/name`, case-insensitive). With
  neither it fires for every repository the account is asked to review in.
- **Polling, no webhooks.** Backends are Tailscale-only with no public endpoint, so the backend polls with its `gh`
  login every 2 minutes (`GITHUB_REVIEW_POLL_MS`), through `host-commands.ts` (which never throws). It polls only while
  at least one *enabled* event schedule exists: saving or deleting a schedule re-checks at once, and with none the timer
  is not armed. One poll serves every project and schedule. A failed poll (no `gh`, logged out, rate limited, bad
  JSON) is logged, its message is kept as the schedule's `eventState.error`, and the next tick tries again; it never
  fires anything and never changes what was seen.
- **The account** is whatever `gh` is logged in as (`viewer`). Both direct requests and
  requests to a team the account belongs to count.
- **How a request is read.** One `gh api graphql` call: the search `is:pr is:open review-requested:@me` (it matches
  direct and team requests; `user-review-requested:@me` is direct only), 100 newest-updated pull requests, each with
  its pending `reviewRequests` and its last 30 `ReviewRequestedEvent`s (id, time, reviewer), plus the PR fields the
  brief needs. The account's teams come from `gh api user/teams` (cached an hour). A pull request's request to the
  account is its **latest `ReviewRequestedEvent` whose reviewer is the account or one of its teams and who is still
  pending**; if no pending target is recognisably the account's (team membership unreadable, parent teams) it falls back
  to the latest event of any pending team request, since the search says some request matches. Cost: one point of the
  5,000 an hour, 30 calls an hour. Not used: the notifications API (`reason: review_requested`) does not say direct
  from team, mixes in read state the user changes elsewhere, and keeps a thread alive on every later comment, so it
  cannot tell a request from a push; webhooks need a public address.
- **What counts as new.** The key of a request is `<owner/repo>#<number>@<event id>`. New pushes change nothing about
  it, so they never fire. A re-request (after a removal or after the account reviewed) is a new `ReviewRequestedEvent`
  with a new ID and so fires again; requesting the account *and* its team separately counts twice. Several events
  between two polls fire once, for the latest.
- **Seen keys are persisted** per schedule in `projects/<id>/schedule-events.json` (`seen`: key to the last time it
  was still open; entries not seen for 7 days are dropped, which also bounds the file). A restart or a repeated poll
  finds the key and does nothing; a key is recorded only after its run was handled (started, skipped or failed), so a
  fire that could not even open the project is retried on the next tick. A run that *failed to start* is not retried
  by the poll (it would fail every two minutes); it is in the history and on the board, and Run now retries it.
- **No flood.** The first poll after a schedule is created, enabled again or given a different set of repositories
  (its "scope") records every request that exists then as seen without firing, and fires only for later ones. A
  schedule saved while disabled keeps no state; turning it on starts from a fresh baseline, so requests that arrived
  while it was off are not run. Requests that arrive while the server is off, with the schedule enabled, fire on the
  first poll after it starts.
- **Run now.** It polls GitHub at once and runs every matching request not handled yet. If there is none it runs the
  newest open request again as a new run (so you can try the instructions on a PR that is already in front of you),
  and if no request is open at all it records a skipped run ("no open review requests from you"). The answer carries
  the newest run; each is in the history.
- **One run per event, concurrently.** The clock's "skip while the previous run is running" rule does not apply
  across pull requests: different PRs run at once. The IDs derive from the schedule, the PR and the request time
  (`<schedule>-<repo>-<number>-<8 hex of the sha-256 of schedule, repo#number and request time>`, at most 48
  characters): the worker or thread ID, the board task lookup and the request IDs of the reporter. A retried event
  finds what it already started instead of starting it twice, exactly as a clock run does. A run by hand adds
  its own time to the hash.
- **The brief** is the user's brief, then a fixed block the harness appends (`eventBriefBlock`): the PR's URL,
  repository, number, title, author, base and head branches, head commit, who or which team was requested and the
  request time, and one fixed sentence: nothing is posted to GitHub (no review, comment, approval or push) until
  the user explicitly approves it on the task. The text never varies except for those facts, so prompts stay
  byte-stable.
- **Each event has its own board task**, titled with an outcome ("Review PR: <title>", the PR's own title clipped),
  its refs holding the PR URL, created by the harness as `todo`. The `thread` run claims it (as `thread_start` takes
  a `taskId`); a `worker` run gets it as its `taskId`, like `worker_spawn`. It does not carry the schedule's
  `scheduleId`: that link is for the one task per schedule that failed, clock worker and clock thread runs share ("One board task per clock schedule"). The user reads the
  review on the task and talks about it there.
- **History.** `trigger: "event"` (new), `at` is the request time, `ref` (new, optional) the PR URL and `taskId` (new,
  optional) the task. A started run lists its worker or thread as usual.
- **The app** words the rule "When a review is requested from you on GitHub" (with the repositories, if the schedule
  has its own), and shows "Checks GitHub every 2 minutes" with the last check's time or error (`eventState`, new
  optional field of `Schedule`: `checkedAt`, `error`) instead of "next run". The editor's repeat choice gains the event
  rule and a repositories field.
- **Not done.** Other events (CI failed, issue assigned); webhooks; Android (it ignores the new rule's fields and
  lists an event schedule as a rule it does not know).

## Archiving projects

Decided with the user on 2026-11-08. A project that is finished with can be **archived** and **unarchived** later.
Archiving is only hiding and pausing: the data, memory, conversations, board and artifacts stay exactly as they are.
Nothing is deleted, and there is no delete feature.

- **Contract** (`packages/protocol/src/projects.ts`, feature `project-archive`). `ProjectSummary.archived` (optional;
  absent means not archived, so a summary from an older server reads right) and `projects.configure { archived: boolean }`.
  It is a `configure` field, not a new request: it is one more persisted per-project setting, it answers with the same
  summary, and it goes out as the same `project.state` push, so no new response, event or client method is needed.
  `archived: false` and absent are the same (the file only carries `"archived": true` while archived). The web app hides
  the action and the Archived list on a backend without the feature.
- **Persistence.** `Project.archived` in `project.json`, written only while true. A restart reads it back.
- **Schedules keep their own state.** Each schedule's `enabled` is never touched, so unarchiving restores exactly the
  old state. While the project is archived, `ScheduleStore.due` and `nextDue` skip it, so the clock never fires it, never
  arms a timer for it and never opens it (a catch-up on a restart does not either). A race (a due run read just before
  archiving) is stopped in `ProjectManager.fireSchedule`. Run now is the user's own act and still works.
- **Event triggers.** `ScheduleEventPoller.#reconcile` treats an archived project as having no listening schedules: it
  is not a target, so it never counts for "is there anything to poll", and its seen-key state is *forgotten*, exactly as
  when a schedule is switched off. Unarchiving wakes the poller; every enabled event schedule then has no state and takes
  a fresh baseline, so review requests that arrived while archived are not run. (This is the same path as re-enabling a
  schedule.) A tick already reading GitHub when the project is archived skips it (`#check` re-reads the flag).
- **Clock schedules on unarchive.** A clock schedule whose `nextRunAt` fell in the past while archived is moved to its
  next slot after now (`ScheduleStore.resume`), so missed slots do not run as one catch-up the moment the project
  returns. Schedules whose next run is still ahead are left alone.
- **Notifications.** `Notifier.deliver` drops an event whose `projectId` is archived (the key is still claimed, so
  nothing replays when the project returns). Events without a project (deploy, disk, login prompts) are unaffected.
- **Work in progress.** Archiving is **refused** (`project_busy`) while the project's coordinator is working, a worker
  runs, or a background thread runs (its status is `running`; an idle one that is only waiting is not running). The
  message names them: `Can't archive while 2 workers and 1 background thread are running: stop them first`. Stopping them
  for the user is not trivial or safe (a worker can be mid-merge, a thread holds a task), so the user does it. Only an
  open project can be running: a closed one is archived without being opened.
- **Opening it still works.** The project's URL opens it as before; nothing blocks the conversation. The app shows a
  banner "This project is archived" with an Unarchive button. An archived project that is open keeps its Harness until
  the process restarts.
- **The app.** Project settings has an "Archive project" card with a confirmation that says what happens. The drawer
  and the projects sidebar list only projects that are not archived, and end with a collapsed "Archived (N)" section
  (only when there are some) whose rows open the project and carry an Unarchive button. If the project the page shows
  gets archived, the page stays on it with the banner.
- **Android** (out of scope): the field is regenerated into its models, the app ignores it, so its drawer still lists
  archived projects until it learns the flag.

## Chat drafts

What a user has typed in a chat's composer and not sent lives on the backend, per chat, and follows the user between
devices (web and Android). The device keeps a local copy as a cache: it restores instantly, works offline and is pushed
when the backend is reachable again. Feature `chat-drafts`; a backend without it leaves every device on its local cache.

- **A chat** is a project plus `main` or a thread ID (`threadId`; the web's `draftKey` is the same pair per backend).
  Workers have no composer. The web task reply also uses this store, under a reserved `threadId` namespace
  `task-reply:<taskId>`; this is a draft key, not a background thread. It cannot overwrite the main or a real thread's
  draft. Its Composer clears that draft on send; the submit uses `keepDraft: true` so the coordinator draft stays intact.
  Android's task reply can adopt this same namespace when it follows the Dashboard design.
- **A draft** (`DraftContent`) is the text, the picked task (`taskId`) and the quotes waiting above the text, plus
  `attachments` (references, below). Empty means no text (after trimming), no task, no quotes, no attachments, and is
  stored as no draft.
- **Entries** (`ChatDraft`) are what the server keeps per chat: `{ projectId, threadId, revision, updatedAt, author,
  content }`. `revision` counts up by one per change of that chat. `content` is `null` for a cleared draft: the entry stays
  as a tombstone so a stale device can tell "cleared" from "never saw it". `author` is `{ deviceId, name? }` as the
  writer sent it (the web uses its notification device ID and a name like "Pixel 8"; the server's own clear on submit
  has no author).

### Protocol

- `drafts.get { projectId, threadId? }` -> `{ drafts: ChatDraft[] }`: one chat's entry (an empty list when there is none)
  or every entry of the project, tombstones included.
- `drafts.set { projectId, threadId, content | null, baseRevision, device? }` -> `{ applied, draft }`. `baseRevision` is
  the revision the writer last saw (0 for none). It is a compare-and-set:
  - it matches the entry's revision (or the chat has no entry and it is 0): the entry is replaced, `revision + 1`,
    `applied: true`, `draft` is the new entry;
  - it does not match: nothing is written, `applied: false`, `draft` is the current entry (what the writer lost to);
  - exceptions that count as applied without a new revision: the content equals what is stored (a retry after a lost
    answer), and clearing a chat that has nothing stored (`draft: null`). So a clear that crosses the server's own clear
    on submit is not a conflict.
- Push `drafts.changed { projectId, threadId, draft: ChatDraft }` to every connection except the writer's, after every
  change: another device's `drafts.set`, and the clear on submit (that one goes to every connection, the sender's too).
  Expiry is silent.
- `drafts.attachment.put { projectId, mimeType, data }` -> `{ attachment }` and
  `drafts.attachment.get { projectId, attachmentId }` -> `{ attachment, data }` (see Attachments).
- Errors: `bad_request` for a draft over the caps; `unknown_project`. No new error codes. A request on a server without
  the feature is `unknown_request`, as for any feature.

### Server

- `DraftStore` (`packages/server/src/drafts.ts`) keeps `projects/<id>/drafts.json` (`{ version: 1, drafts: { <threadId>:
  entry } }`) written atomically with `writeJsonFile`, one write queue per project, so a restart keeps every draft. The
  store takes `now` from the server's clock.
- Clear on submit: a `conversation.submit` that the coordinator accepted (run started or queued as a waiting message),
  from any device, clears that chat's draft (a tombstone with the next revision, pushed to every connection).
  Submissions the harness makes itself (schedules, board edits, check-ins) do not touch drafts. Two guards keep text
  typed after sending: the server skips a draft written at or after the moment the message arrived, and a submit with
  `keepDraft: true` (the web's Retry of a failed send, which sends old text) clears nothing.
- Expiry: an entry (draft or tombstone) not changed for 30 days is dropped when the project's file is read or written.
- Caps, checked on `drafts.set` (`bad_request` over them): `text` 100 000 characters, a quote 50 000, at most 20 quotes,
  text and quotes together 200 000 characters, at most 8 attachments, at most 100 entries per project (the least recently
  changed one goes when a new chat would be the 101st). Clients check the same numbers (`draftWithinLimits`) and keep an
  over-sized draft on the device only, without an error.

### Attachments

A composer attaches images (png, jpeg, webp or gif, up to 5 MiB each, up to 8 a message: "Image attachments" below) and
`conversation.submit` carries them inline as base64 `image` blocks (`ImageContent`). Putting such bytes in the draft would repeat them in every `drafts.set`, every
`drafts.changed` push and every `drafts.get`, to every device, on a phone's connection. So a draft holds *references*:
`{ id, mimeType, size, name? }`, `id` being the SHA-256 of the bytes in hex.

- The bytes go up once, by `drafts.attachment.put` (same limits as a message's: those four types, 5 MiB), stored
  content-addressed as `projects/<id>/draft-attachments/<sha256>` (the same bytes twice is one file). Another device
  that sees a draft with an attachment it does not have asks with `drafts.attachment.get` and caches the bytes.
- Submitting is unchanged: the device that sends holds the bytes and sends the inline block as before. No server-side
  change to `conversation.submit`, and `conversation.submit` never reads a draft.
- A file nothing references is deleted: after each write to a project's drafts (a set, a clear, the clear on submit, an
  expiry) the server removes every blob no entry points to that is older than 10 minutes (the grace is for the upload
  that comes just before the `drafts.set` that names it). The files are never served over HTTP; they only come back
  through `drafts.attachment.get` with the type the uploader declared.
- Why not the artifact store: artifacts are for the agents' files, show in the Artifacts list, are never swept and carry
  tags; a draft's image is temporary and private to the composer. Why not an upload endpoint: the WebSocket already
  carries base64 images and has a 32 MiB post-auth frame limit, so there is no second channel to authenticate
  or build. The whole socket, including binary frames, is behind the Device sign-in gate.
- Both composers use this (web and Android); at most `DRAFT_MAX_ATTACHMENTS` = 8 references, as many as a message
  carries images.

### Sync rules (the client's side; `apps/web/src/lib/drafts-sync.ts`, to port to Android)

Per chat a client holds `local` (what the composer shows), `synced` (`{ revision, content }`: the last entry known to be on
the server, from its own accepted write, a push or a read) and a flag `dirty` = `local` differs from `synced.content`.

1. **Writing.** A change to `local` starts a debounce of 500 ms; every further change restarts it. The write goes out when
   it fires, on blur of the composer, when the user leaves the chat (the composer is destroyed) and when the page is
   hidden. `drafts.set` carries `baseRevision = synced.revision`. An accepted answer becomes `synced`; if `local` changed
   meanwhile, it is dirty again and the debounce runs again. One write in flight per chat.
2. **A remote entry** (a push, the answer to a refused write, or the read when the chat is opened or the connection comes
   back) with `revision <= synced.revision` is old and ignored. Otherwise `decideRemote` says:
   - **adopt**: its content equals `local`; `synced` becomes it and nothing else happens;
   - **apply**: `local` is not dirty, so the composer takes the remote content (text, task, quotes). If the composer is
     focused and the user edited it less than 3 s ago it **defers** instead (re-decided when that time has passed or
     on the next event), so text never changes under a cursor in the middle of typing. A caret in an untouched box is
     kept where it was, clamped to the new length;
   - **conflict**: `local` is dirty. Last writer wins on the server: the device keeps its local content, takes the
     remote revision as `synced.revision` and writes again at once (no debounce) with that base. That write wins, because it
     is the later one. The other device then gets a push; if it has nothing unsynced it applies it, if it has, it
     does the same. Two devices typing into the same chat at once therefore settle on whoever finishes last, and no
     device ever drops text it has not sent. (Unfocused and dirty is the same conflict: the device was offline or a write is
     in flight, and the text is kept.)
3. **Refused write** (`applied: false`): the answer's `draft` is handled as a remote entry (rule 2), so it ends in the
   conflict branch and one re-write; at most 3 attempts in a row, then the next change or push tries again.
4. **Sending** empties the fields (so `local` is empty and the clear is written at once). The server also clears, and its
   push (revision above the writer's) is *adopt*, as both are empty. A send the coordinator did not accept puts the content
   back into `local`, which is a change like any other. With waiting messages (`queued-inputs`) the web's send goes
   through `WaitingMessages`: a failure stays on the message's own bubble (text + Retry) and does *not* come back into
   the composer or the draft, so the text is never in both; Retry sends with `keepDraft`. "Edit" on a waiting bubble
   calls the composer's `restore`, which is a change like any other: it becomes the draft and syncs.
5. **Local cache** (`localStorage["aiki.drafts.v1"]`, the format of the first web-only version plus `rev` and
   `base`): every change to `local` is saved there at once, with the `synced` it knows. It is the draft when the backend
   has no `chat-drafts`, when the connection is down or not yet up, and it is restored synchronously on mount, so typing
   never waits for the network. When the connection is up (and again after each reconnect) the client reads the chat's
   entry and runs rule 2 with the cached `synced`, which is how text typed offline is pushed (it is dirty against the last
   synced content, so it is a conflict at worst, meaning it wins) and how a remote change made meanwhile is taken. An
   entry that is empty is kept in the cache while its `base` is not, so clearing offline is not undone by the read.
   Entries older than 30 days are dropped, as on the server.
6. **The hint.** When the composer applied (or restored) a remote draft whose `author.deviceId` is not this device's, it shows
   "Draft from <name>" in small subtle text under the box until the user types or sends. Nothing is shown otherwise.

Not done on purpose: no per-character merge (two devices on one chat at once is rare and last writer wins is easy to
explain), no draft history, no notification when a draft arrives, and nothing on the project list ("draft" dots).

### Android: how the app does it

Built as the section above describes, from the same rules and constants:

1. **Cache** (`data/DraftCache.kt`): a memory map written behind to its own DataStore (`harness-drafts`, one preference per
   backend + project + chat, the same entry as the web's: draft, `rev`, `base`, 30-day expiry, an empty draft kept while the
   backend still holds a non-empty one). Started from `HarnessApplication.onCreate`, so a chat opened after a cold start
   restores at once. Images a draft holds are files named by their SHA-256 in the cache directory (losing them is harmless:
   the backend has the bytes). This replaced `rememberSaveable(context.route)` in `ChatScreen`; the image no longer lives in
   a ViewModel.
2. **Sync** (`features/chat/DraftSync.kt`, pure Kotlin, tests `app/src/test/.../drafts/`, which mirror
   `drafts-sync.test.ts`): `decideRemote`, `DraftSync`, the caps. It runs on an app-lifetime scope so the last write after
   leaving a chat is not cancelled with the screen. One difference from the web: a write the backend refuses for good
   (`bad_request`: a cap, an unknown attachment) is not retried until the next change.
3. **The screen** (`features/chat/ChatDraft.kt`, `rememberChatDraft`): `ChatScreen` reads and writes the same state as before
   (`value`, `taskId`, `quotes`, `attachment`) through it. It reads the chat's entry when the chat opens and on every
   reconnect, follows `drafts.changed`, writes on blur and when the app stops, and leaving the chat flushes. `deviceId` is
   the notification device ID, `name` is `Build.MODEL`. The composer's "Draft from <name>" hint sits under the text box.
4. **Attachments**: a picked image is hashed (SHA-256), written to the cache, and the draft points at it; the upload
   (`drafts.attachment.put`) happens just before the `drafts.set` that names it, once per process per image. A draft that
   arrives with a reference is fetched with `drafts.attachment.get` (Send waits until the bytes are in), and the message
   still carries the inline base64 block. Several images per draft (see "Image attachments").
5. No `keepDraft` is needed: Android's retry of a failed send only works while the composer holds exactly the text that
   was sent, so the server's clear is right.


## Image attachments

Every box where the user writes a message to the coordinator takes images: pasted from the clipboard, dropped on the
box, or picked with an attach button. Several per message, text optional. Web: the main composer, a thread's composer
(the same component with `threadId`) and the task sheet's reply box. Android: the chat composer and the task reply box.
Not covered: a board question's answer (`board.answer` is a board request that carries text only, the harness writes the
message to the coordinator itself) and the form fields (task and schedule editors, context).

- **Limits** (`packages/protocol/src/images.ts`; one set for every client): png, jpeg, webp or gif; 5 MiB per image;
  8 images per message; 20 MiB for all of a message's images (base64 is a third bigger, and the WebSocket frame is
  32 MiB, so more would drop the connection instead of being refused). The server checks a `conversation.submit`
  (`inputImagesError`) and answers `bad_request` with the reason; the app checks first and says what is wrong under the box.
  A draft holds the same number of references (`DRAFT_MAX_ATTACHMENTS`).
- **What the model gets**: the `image` blocks in the user message, in order, after the text (task prefix first). A model
  that does not read images (`ModelInfo.input` lacks `image`) gets pi-ai's placeholder text "(image omitted: model does
  not support images)"; the web composer says so under the thumbnails when it knows the model.
- **Shrinking before sending** (`apps/web/src/lib/chat/images.ts`, pure decisions: `planImage`): an image within the
  limits and at most 2000 px on its long edge goes as it is (a screenshot PNG stays a PNG, a GIF stays animated). A
  larger one is drawn onto a canvas at 2000 px and re-encoded in its own format (png stays png); if it is still over
  5 MiB, or the type is not one of the four (bmp, avif, a HEIC the browser can read), it becomes a JPEG (white behind
  transparency), stepping the size down by a quarter until it fits (never below 800 px). A GIF over the limits is
  refused, because re-encoding would lose the animation. Android does the same decisions with `BitmapFactory` (see below).
- **Drafts**: an attached image is hashed (SHA-256) and the draft holds the reference; the bytes go up once with
  `drafts.attachment.put` just before the `drafts.set` that names them (the web's `draftChannel.write`). Another device
  reads the bytes with `drafts.attachment.get` and shows thumbnails (a quiet placeholder meanwhile); Send waits until they
  are there. The bytes of this device's own images live in memory (`imageBytes`, 96 MiB, oldest out first) and, once
  uploaded, on the backend. The local draft cache holds the references only, so a reload without a backend that has the bytes
  (no `chat-drafts`, or offline) shows those images as "not available" thumbnails to remove; the read is tried again when the
  connection is back. The web uploads an image again whenever a write names it after one that left it out, because the
  server sweeps what no draft names (`UploadTracker`).
- **A sent message** shows its images above the bubble, small, and a click opens the same lightbox as artifacts. A sent
  message with no text is only images.
- **Waiting messages** keep their images: the screen's own send holds the bytes, so the waiting bubble shows the thumbnails,
  Retry sends the same content and Edit puts text and images back in the composer. An input from another device (or
  after a reload) is only known by `queued[].images`, the count: the bubble says "2 images", and Edit gives the text
  back and says the images cannot be taken back (the server lists no bytes for queued inputs).
- The web task sheet's reply box reuses the main `Composer` (D27). Text and image references have a separate per-task
  draft under `task-reply:<taskId>`, with the same cache, backend sync, attachment upload and failed-send retention as
  chat drafts. On older backends text is device-local and image bytes only stay in the page's memory cache.

**Android** (`features/chat/ImageAttach.kt` pure decisions, same cases as the web's tests in `ImageAttachTest`; `ImageAttachUi.kt`
the picker, receiver and thumbnails):

- The chat composer's text field is a state-based `BasicTextField` (`ChatDraftState.textState`, with `value` as a plain-value
  view of it), because only that kind takes `Modifier.contentReceiver`. The receiver gets what is pasted (long press, Ctrl+V,
  `KEYCODE_PASTE`) and what the keyboard commits (Gboard's "Image" suggestion of a copied picture, stickers, GIFs); the images in
  it are read at once, as the keyboard's permission to read ends with the call, and anything else (text) falls through to the
  field. The attach button opens the picker for several (`GetMultipleContents`). The task reply box does the same
  (`OutlinedTextField(state = …)` plus a button), with its images in memory only.
- Thumbnails (64 dp, × to remove, a tap opens `ImagePreview` full screen) sit above the text; `ChatDraftState.images` holds
  `DraftImage(ref, bytes?)`, bytes null while another device's image is read (cache, then `drafts.attachment.get`); Send waits
  for them. Reading stops at 24 MB (`INPUT_IMAGE_MAX_READ_BYTES`); the file's own bytes decide its type (`sniffImageType`);
  shrinking uses `BitmapFactory` and turns an EXIF-rotated photo first. A problem shows in the composer's error banner.
- A retry of a failed send is the same admission: `PendingAdmission` keeps one digest of all the images in order, and the
  content is the text block then the images.
- Not on Android: a waiting-message bubble (the queue is not built there, see "Messages waiting in the queue"), so the
  count/thumbnail rules above are web only for now; several images in one sent message show as one transcript row each.
- Debug builds only: `adb shell am broadcast -a io.github.mitzacoder.aiki.DEBUG_COPY_IMAGE -p io.github.mitzacoder.aiki --es label Shot
  --ei width 1200 --ei height 700` draws a picture and puts it on the clipboard (an emulator cannot copy one); then
  `adb shell input keyevent KEYCODE_PASTE` with a message box focused, or tap the keyboard's "Image" suggestion.

## Terminals

Decided with the user on 2026-11-08. The user can open a **terminal on a backend from the app**: a real PTY on that
machine, streamed over the app's existing WebSocket. Web first; Android later, so everything on the wire is specified
here and nothing depends on xterm.js.

- **What it is.** A shell as the backend's own user, on the backend's own machine (the same power as an agent's `bash`).
  No separate service or port: it rides the `/ws` connection and its rules (the origin check, the tailnet in front).
  Anyone who can already drive the app on a backend can open one. It is a feature (`terminal`) the server can turn off
  (`AIKI_TERMINALS=off` or the server option `terminals: false`): then it is not advertised, and a request
  for it is refused (`unknown_request`). This is the one feature whose reach is "run anything", so it is stated here
  and in the Security note below rather than assumed.
- **Every terminal is a zellij session.** The PTY runs `zellij attach --create <session>`. Closing the page, losing
  the connection, a server restart or a deploy only *detaches* the client; the zellij server and everything running in
  it carry on, and reopening reattaches with the screen intact (zellij redraws it). zellij is preferred to tmux (the
  user's choice); it is also what the user already runs by hand, so the same sessions can be attached from a shell.
  Without zellij the backend says so (see "Availability") instead of failing obscurely; a plain-shell mode
  (`multiplexer: "none"`, not selectable from the app) exists for tests and has no reattach.
- **Surviving a deploy.** The backend's systemd unit has `KillMode=mixed`, so a restart SIGKILLs everything left in
  the unit's cgroup, and a zellij server started from the server's PTY is in that cgroup (it daemonises, but systemd
  tracks cgroups, not parents). Chosen: start the attach client with **`systemd-run --user --scope`**, which asks
  the *user's* systemd manager to move the process into a transient scope under `user@<uid>.service/app.slice`; the zellij server the
  client forks lives and dies there, outside the unit's cgroup. Why this and not the others, and the experiment, are
  below. It needs the user manager running: the VM's backend already is a user service (linger on); the PC and the T14
  run the backend as a *system* service and need **lingering** for the user (`users.users.aiki.linger = true`), and
  the server needs `XDG_RUNTIME_DIR=/run/user/<uid>` (the server sets it for the child itself, a system unit has none).
  When the user manager or `systemd-run` is not there, the PTY is started plainly, the session still works, and
  `terminal.list` says `survivesRestart: false` so the app can warn that a restart ends the terminals.
- **Not chosen.** (b) zellij session resurrection re-creates the layout and re-runs commands but is not the same
  process: a `top` or a build is restarted, a `sleep` loses its place; it stays on as the fallback zellij does by
  itself (a session whose server died is listed `exited` and attaching resurrects it). `systemd-run --user --unit`
  (a transient *service*): works too, but the attach client would be the service's main process, so a service per
  client has to exist and be cleaned up; a scope is created and removed with its processes. A server-side daemon of
  our own to hold the PTYs: that is zellij's job.
- **Protocol** (`packages/protocol/src/terminal.ts`, feature `terminal`). Control is JSON like everything else;
  the bytes of the terminal are **binary frames**, not JSON, so a `cat` of a big file costs no base64 or parsing.
  - `terminal.list` → `{ available, multiplexer: "zellij"|"none", version?, reason?, survivesRestart, sessions, attached,
    limits }`: whether a terminal can be opened (and if not, a sentence why: "zellij is not installed on this backend"),
    every session zellij knows with `exited` (resurrectable) and whether this connection has it attached, the
    terminals this connection has attached, and the limits. Doubles as the reattach list.
  - `terminal.open { cwd?, session?, prefix?, cols, rows }` → `{ terminalId, session, created, cols, rows }`. `session`
    attaches to or creates that name (zellij names: letters, digits, `.`, `_`, `-`, at most 48); without it a **new**
    session `<prefix>-<n>` is made (n: the first number not in use; the app's prefix is the project's name slug, so
    `example-core-1`, default `term`). `cwd` is where a new session's first shell starts (the project's folder, a worker's
    workspace); it is ignored when attaching to an existing session. `terminalId` is a number scoped to the connection,
    used in the binary frames. Opening a session twice attaches twice (zellij allows many clients).
  - `terminal.resize { terminalId, cols, rows }`, `terminal.close { terminalId }` (**detach**: the client is stopped,
    the session lives on), `terminal.kill { session }` (**end the session**: its processes are stopped and an exited one
    is deleted from the list). All answer with the same type and the `terminalId`/`session`.
  - Events: `terminal.closed { terminalId, reason: "exited"|"killed"|"error", exitCode?, message? }` when the
    attach client ended without being asked (the session ended, `Ctrl-o d`, zellij crashed; "exited" covers both) and `terminal.resync
    { terminalId }`: output was dropped, reset the screen; the next frames repaint it.
  - **Binary frames**, big-endian: `kind u8 | terminalId u32 | payload`. `1` output (server→client, payload: bytes of the
    PTY as read, batched); `2` input (client→server, payload: bytes to write, at most 64 KiB, otherwise
    `bad_request`); `3` ack (client→server, payload: `u32` count of output bytes the client has processed since its last
    ack). Input is binary so that a paste, a key bar and Ctrl-codes need no escaping and no parsing; text input is its
    UTF-8. A client that cannot send binary frames cannot type: Android's OkHttp and every browser can.
- **Output stays bounded.** The server reads the PTY as fast as it is written and coalesces: output is sent after 8 ms or
  32 KiB, whichever comes first, in frames of at most 32 KiB. The client acks what it has *rendered* (xterm's write
  callback, so a slow phone paces the server and not the socket). The server may have 256 KiB of output unacked per
  terminal; beyond that it queues, up to 2 MiB. If a client falls further behind (a `cat` of a gigabyte on a bad
  link), the queue is **dropped**, the terminal is marked behind, and when the client catches up the server sends
  `terminal.resync`, then forces a repaint (zellij redraws the whole screen when its client's size changes; the server
  bounces the PTY size by one column and back). The result is never an unbounded buffer and never a flooded socket; a
  plain shell loses what it dropped, a zellij session loses nothing but the scrolled-away lines. Input is not
  rate-limited beyond the frame cap; the PTY's own buffer paces it.
- **Server** (`packages/server/src/terminals.ts`, `TerminalHost`). `Bun.spawn(..., { terminal })` of the bun already
  installed (1.4.4 on the PC and T14, 1.4.2 pinned on the VM; `Bun.Terminal` is there since 1.3.5), so no native
  dependency: no node-pty, nothing to build on NixOS or the VM. A Bun terminal has no pause, which is why flow control is
  the ack window above and not a stopped read. One `TerminalHost` per server holds the attach clients; each connection
  owns the terminals it opened and **detaches them (kills only the attach client) when its socket closes**; the same on
  `stop()`. Limits: 8 terminals per connection, 16 per server (`terminal_limit`), cols 1–500, rows 1–200, input frames
  64 KiB. Session names are checked (`bad_request`) so they cannot be an option or a path. The shell's environment is
  the shared child environment above (no server settings; only the `AIKI_CHILD_PROCESS` marker), with
  `TERM=xterm-256color`, `COLORTERM=truecolor`, `SHELL` set to the user's login shell when unset (a system unit has none), and `XDG_RUNTIME_DIR` for the user manager. `terminal.list` runs
  `zellij list-sessions --no-formatting`; kill runs `zellij kill-session` then `delete-session`.
  Opening a new session waits for its first screen-clear render (up to 30 seconds), never polling list-sessions during
  initialization: Zellij 0.45.1 can panic handling a probing client's disconnect before its session state exists.
  Startup output is held behind the `terminal.open` response. Early input waits for raw mode and the first screen
  clear, including an escape sequence split across PTY chunks; readiness does not depend on screen size or byte count.
- **Availability and installation.** The server finds zellij through `AIKI_ZELLIJ`, then `PATH`, then
  `~/.local/bin/zellij`. The PC and the T14 already have it on the service's PATH through
  `/home/user/.local/bin` (home-manager's `programs.zellij`), but that is an accident of the PATH line:
  nix-config's `aiki.nix` should list `zellij` in its `lib.makeBinPath` with the other tools, and the host
  should declare `users.users.aiki.linger = true`. The VM has no zellij: `deploy/backend.sh` gains `ensure_zellij`
  beside `ensure_bun`, which installs the pinned static (musl) release into `~/.local/bin` and checks its SHA-256.
  A backend without zellij answers `terminal.list` with `available: false` and the reason; `terminal.open` fails with
  `terminal_unavailable` and that sentence, and the app shows it where the terminal would be.
- **The app** (web). A *Terminal* button in the project header (the ⋯ menu on a phone) and *Open terminal in this
  worker's workspace* on a worker's page open the full-page view `/b/<backend>/terminal` (query: `project`, `worker`,
  `session`). It has tabs, one per attached terminal, a "+" to start a new session in the project's folder, and a list
  of the backend's other sessions to attach (exited ones say so); closing a tab detaches, a separate "End session" kills
  after a confirmation. xterm.js (`@xterm/xterm`, fit and web-links addons) takes its colours from the active app theme
  (`--background`, `--foreground`, the accent for the cursor and selection, one ANSI palette per light and dark),
  fits to its box on every resize (`ResizeObserver`, the soft keyboard included, using `visualViewport`), links open in a
  new tab, copy copies the selection (Ctrl-Shift-C / Cmd-C) and paste reaches the PTY as one input. On a phone a key
  bar sits above the soft keyboard: Esc, Tab, Ctrl (sticky), Alt (sticky), the arrows, `|`, `~`, `/`, `-`. When the
  socket drops the view says so and reattaches by itself with the same session names once the connection is back (the
  client library does this: `openTerminal` returns a handle that reopens on `ready`).
- **Security.** The terminal is a shell as the backend's user: the same reach as an agent's `bash` tool, which the user
  already hands to every coordinator and worker. Who can open one is exactly who can drive the app on that backend:
  a valid full-owner device session in required mode, plus the exact browser Origin allowlist
  (`AIKI_ALLOWED_ORIGINS`). Legacy optional/off traffic retains its former access during migration;
  tailnet reachability alone is never enrollment authority. Revocation detaches terminals without killing host jobs. Turn it off per backend with `AIKI_TERMINALS=off`. The server never logs terminal input or output.
- **Android** must port: the `terminal.*` JSON (generated into `Models.kt`), the binary framing and the ack window (a
  terminal emulator view is the work; the protocol has nothing web-specific), the reconnect-and-reattach loop, the
  key-bar keys as byte strings (Esc `\x1b`, Tab `\t`, arrows `\x1b[A`..., Ctrl as `byte & 0x1f`), and resize on
  every layout change.

### Android

Decided with the user on 2026-11-08 (T8). The app has the same terminal as the web: the same entry points, tabs, sessions
list, key bar, "ended" overlay, theme colours and reconnect-and-reattach, over the same protocol. Nothing on the server
changed.

#### Which emulator

Two options were weighed; the choice is **(a), a native terminal view: Termux's `terminal-emulator` and `terminal-view`
sources, vendored and patched for a remote PTY.**

| | (a) Termux `terminal-view` (native `View`) | (b) WebView with xterm.js as an asset |
|---|---|---|
| Soft keyboard | A real `InputConnection` written for terminals: no composing region, backspace and Enter arrive as keys, Ctrl/Alt from the key bar and a hardware keyboard go through `KeyHandler` (Termux's key map: function keys, Home/End, the modifier combinations). | xterm.js listens on a hidden `<textarea>`; Gboard's composition, autocorrect and the "229" key events are its long-standing weak spot on Android, and a WebView adds its own focus and IME-resize quirks. |
| Selection | Long-press selects a word with the platform's handles and a Copy / Paste action bar; the selection follows the output and survives a scroll. | xterm.js has no touch selection: no long-press, no handles. Copy would be a button on a selection a finger cannot make. |
| Scrolling | Finger scroll and fling through the scrollback, mouse-wheel and touch scroll turned into arrow keys on the alternate screen (`less`, `htop`, `vim`), and mouse reporting (zellij uses it) work. | The viewport scrolls natively but flings and the alternate screen are the page's own; a pinch zooms the page, not the text. |
| Speed | Draws straight to a `Canvas` from the row buffer; a `cat` of a big file costs one invalidate per batch. No second process. | A WebView is a renderer process of tens of MB, started per screen; every output byte crosses the JS bridge (base64 or a string) before xterm sees it. |
| Size | About 7.7k lines of Java and no native code once the process part is gone (Termux's own aar carries four `libtermux.so`). | xterm.js is 345 KB minified (the WebGL addon another 250 KB) plus an HTML shell, and the WebView itself is a system component to keep in sync. |
| Offline | Everything is in the APK. | Also bundled, but the page needs `file:`/asset loading rules, a `WebViewAssetLoader`, and a bridge that survives the WebView being recreated. |
| Maintenance | The sources are a snapshot of v0.118.1 (Apache 2.0); the part that changes with the platform is small and stable (Termux has had them for years). Our patches are listed in `app/src/main/java/com/termux/PATCHES.md`. A fork we own, with no upstream release train to follow. | The web's own xterm.js, so the wire code is shared with the web's client. But touch, IME and the WebView's life cycle are where the bugs would be, and they are not ours to fix inside xterm.js. |

(b)'s one real advantage is sharing code with the web (the same `onData` and addons). It does not outweigh a keyboard that
is wrong on a phone, which is the device this is for. The terminal screen is not shared with the web anyway; what is shared
is the protocol, and that is already generated.

Why the sources are vendored and not a dependency: Termux publishes the two libraries only on JitPack (the build's
repositories are Google and Maven Central, and `FAIL_ON_PROJECT_REPOS` keeps them so), and `TerminalSession`, the one class
`TerminalView` talks to, is a `final` class that forks a local process through JNI. A remote PTY has no process to fork, so
the class has to change; vendoring all of it takes the JNI library (four ABIs) out of the APK too. The patches are small and
listed in `app/src/main/java/com/termux/PATCHES.md`: `TerminalSession` becomes a session with a byte sink and a size callback
instead of a process; the emulator no longer answers colour and termcap queries (zellij forwards them and the replies land
in the shell as typed text); the view tells its client about a tap while the program has mouse reporting on (zellij does),
so the keyboard shows and a link opens; the selection classes read their strings and handle drawables from the app's
resources and expose the selected text. The licence is Apache 2.0 (`apps/android/licenses/APACHE-2.0-termux-terminal.txt`;
the Termux app itself is GPLv3, and these two libraries are its stated exception).

#### How the app does it

- **Wire** (`data/HarnessClient.kt`, `data/TerminalFrames.kt`, `data/TerminalHandle.kt`). The socket now handles binary
  frames: `onMessage(ByteString)` goes through the same ordered queue as text, so a frame that follows its `terminal.open`
  answer finds the terminal registered (the reader loop registers it when it sees the answer, before the caller wakes).
  `terminal.closed` and `terminal.resync` are routed the same way and are not emitted on `events`. `TerminalFrames.kt` is the
  port of `encodeTerminalFrame`, `decodeTerminalFrame` and `encodeTerminalAck`. `TerminalHandle` is the port of the client
  library's `TerminalSession`: it opens (or attaches by name), keeps the session attached across reconnects (it listens to the
  client's connection, which now carries a `generation` that changes with every socket that became ready, and to the socket
  drop itself, so a drop that is over before the state flow is read is still noticed), acks what the emulator has *consumed*,
  chunks input at 64 KiB, and reports `attaching / attached / reconnecting / ended / failed / detached` with the same final
  error codes as the web. One difference from the web library: the reset before a repaint travels *in order with the
  output* (the handle tells its consumer "reset" ahead of the first output after a reattach), because output can reach the
  reader thread before the open call returns.
- **Tabs** live in a `TerminalDeck` per backend session (like the project board), not in the screen. The activity is
  recreated on rotation and the emulators with their scrollback must survive it, so the deck owns the tabs, their handles and
  their emulators (`TerminalScreenSession`); the screen shows the active one. Leaving the terminal screen detaches every tab
  after four seconds (a rotation comes back within that; going back to a project does not), and the tab list is kept in
  `SharedPreferences` per backend (`aiki.terminal-tabs.v1`, the web's format) so the next visit, or a restart of the
  app, reattaches the same sessions. `parseTabs`, `reconcileTabs`, `terminalTarget`, `sessionForPrefix`, `terminalPrefix` are
  ports with the web's tests (`TerminalLogicTest`). Like the web, entering from a project picks the lowest-numbered running
  session of the project's prefix, and reattaching a tab whose session had exited resurrects it.
- **Screen** (`features/terminal/`). A route `Destination.Terminal(backendKey, projectId?, workerId?, session?)` with its own
  header (back, title, Sessions, connection badge), a tab strip with a pinned "+", banners, the empty and unavailable states,
  the active tab's `TerminalView`, the key bar and the overlays. Only the tab in front has a view: every view would be a
  full-size sibling, and Compose gives a sibling above the active one its touches. Entry points: *Terminal* in the project
  header (in the ⋯ menu on a phone, the row on a tablet) and a terminal button on a worker's page (its workspace, or the
  project's folder for a shared-checkout worker), both gated on the `terminal` feature like the web and hidden otherwise; the
  screen itself says "This backend has no terminals" for a route to a backend that has none.
- **Sessions list**: a bottom sheet with every session (open in a tab, running, exited), Attach, End with the web's two-step
  confirmation, and New terminal.
- **Key bar**: the web's two rows (Esc, Tab, Ctrl, Alt, ←, ↓, ↑, →; `|` `~` `/` `-`, then Paste and Copy). Ctrl and Alt are
  sticky and apply to the next key typed on the soft keyboard too (the view client's `readControlKey`/`readAltKey`, which is
  how Termux does it); arrows follow the emulator's cursor-key mode (`ESC O` or `ESC [`). The bar's buttons are Compose
  and take no Android focus, so the keyboard stays up while they are pressed. It is always shown, tablets included.
- **Keyboard and size**: the view fits the emulator to its box (`TerminalView.updateSize`) and the session sends
  `terminal.resize` when the columns or rows change. The screen has `imePadding`, so the box, with the key bar inside it,
  shrinks above the soft keyboard; split screen and rotation are ordinary layout changes. A new session starts at the size the
  last view measured and attaches only once it knows one (or after 1.5 s), so nothing is reflowed after zellij has drawn.
  The soft keyboard asks for characters, not key codes (`shouldEnforceCharBasedInput`: no composing text, no suggestions).
  Font: JetBrains Mono, 12 sp on a phone and 14 sp on a tablet, a pinch steps it between 8 and 24 and the choice is kept.
- **Theme**: the web's `xtermColors` ported (`terminalPalette(tones, dark)`), fed from `Jarvis.colors` (`primary` is the
  Material primary), painted into the emulator's colour table (and into Termux's default scheme, which a reset falls back to);
  a theme or light/dark change repaints open terminals.
- **Reconnect**: a drop (or the OS cutting the socket while the app is in the background) sets the tab to "Reconnecting";
  when the client is ready again the handle opens the same session by name, the emulator is reset and zellij repaints it.
  A backend restart is the same path (checked: a loop running in the session kept counting through a restart of the backend
  and a force-stop of the app).
- **Clipboard and links**: long-press selects with the platform's handles and floating Copy/Paste, the key bar's Paste and
  Copy buttons do the same (Copy is enabled while something is selected), and a paste is one input (bracketed if the program
  asked for it). A tap on an `http(s)` URL in the output opens it, also while zellij has mouse reporting on; the check is one
  row of the screen (a URL that wraps is not joined). zellij also turns mouse reporting on, so a finger scroll becomes wheel
  events for it and enters its scroll mode (Esc leaves it).
- **Not the same as the web**: no page title or browser history; "End session" is only in the Sessions list; copy is the
  platform's selection and not Ctrl-Shift-C; no WebGL, so the powerline separators of zellij's bars come from the
  system's fallback fonts (the arrows draw, the Nerd Font icons of a shell prompt are boxes, as in the web without a Nerd
  Font); a terminal that asks the emulator for its colours or a termcap entry gets no answer (see `PATCHES.md`); only the tab
  in front has a view, so a tab's scroll position is not kept across a tab switch (its screen and scrollback are).

### Surviving backend restarts

A terminal process in the backend service's own cgroup is killed when the service restarts. When supported, start its
zellij server in an independent user scope and reconnect to the same named session after a backend restart. Do not
restart the live backend from its tools to test this. Use isolated transient units and synthetic sessions instead.
The server test suite covers session detachment; reconnecting clients must retain the session name and retry safely.

## Memory and compaction

- Two kinds of memory: per project and global (about the user). Both are
  per user, so both live in the data directory, never in the repo (repos
  can be shared).
- Memory is unlimited, kept in small granular files, well maintained, and
  read through search tools.
- Compaction: no known problems with pi's, so build on pi durable's
  compaction rather than replacing it.
- Design below, approved.
- Load each project's `AGENTS.md` and the user's skills from
  `~/.pi/agent/skills`, like pi (done in the server: see [Context](#context)).

## Memory and compaction design

Status: approved; revised with the user on 2026-11-04 (decisions below).

Implemented 2026-11-04 (memory core; see `docs/CONTINUE.md` for the details): both scopes with git and an FTS5
index per scope, the four coordinator tools, the catalog section with its prompt-cache key (the newest compaction head,
so only a new conversation or a compaction changes its text), and the `memory.list/read/search/history` requests plus
the `memory.changed` event, and the app's read-only Memory tab. Implemented 2026-11-05 (compaction of the coordinator,
phase 2): the thresholds as fractions of the model's window, the summary through `beforeCompact`, `ConversationContext.usage`
and `conversation.compact`, and the `history` tool. Implemented 2026-11-05 (phases 3 and 4): extraction of memories after
every coordinator compaction as its own durable task, one commit per scope sourced from the `pi.compaction` entry, and
`memory.undo` reverting an extraction or maintenance commit (refused with `memory_conflict` when later commits touched
the same files); and memory maintenance, with per-backend settings (model, thinking level, nightly time, after how many
writes), a server-level clock that walks the scope directories without opening a project, one commit per run with a
readable log, and `memory.status`/`memory.maintain`/`memory.settings.set`. In the app (hidden without the
`memory-maintenance` feature): the Memory tab labels every commit by kind and undoes an extraction or a maintenance
commit (a conflict is explained, an undone one is marked), shows each scope's maintenance state with a "Run maintenance
now" action, a compaction marker names the memories its entry saved and offers their undo, and the backends page picks
the maintenance model, thinking level, nightly time and write count ("Off" without a model). Undo is still the only
memory action in the app. Only the board is still to build.

Decisions of 2026-11-04:

- Build order: memory core first, then compaction, then extraction at compaction, then maintenance, then the board.
- Each backend keeps its own memory and never syncs it: the remote VM's stays on the VM. Memory starts empty, nothing
  is imported.
- No pinned memories for now. The only memory text in the system prompt is the instructions and a short catalog,
  refreshed only when a conversation starts and at each compaction (when the prompt changes anyway), so a memory write
  never costs a prompt-cache miss.
- Workers get no memory tools and no memory in their prompt: only what the coordinator puts in their brief.
- The web app shows memory read-only (browse, search, history). No editing or pinning in the app for now.
- Maintenance runs with a model chosen per backend.
- Compaction thresholds as fractions of the model's context window: a background summary starts at 35%, the next
  request waits for one at 50%.
- Phases 3 and 4 (2026-11-04): extraction runs after a coordinator compaction lands, as its own durable background
  task over the compacted entries (the summary call stays as it is), with the coordinator's model; its writes are one
  commit linked to that `pi.compaction` entry. Undo reverts a whole extraction or maintenance commit (`memory.undo`),
  refused when later changes touched the same files. Maintenance: per-backend settings (model, thinking level, nightly
  time default 03:00, after 20 writes), no model means no maintenance; runs per scope only when the scope changed;
  each run is one commit. Undo is the only memory action in the app; it stays otherwise read-only.

### Three kinds of state

The coordinator works from three things, kept apart because they live for
different lengths of time:

1. **Memory**: durable facts that outlive any task. Global memory is about
   the user (preferences, habits, how they like to work). Project memory
   is about the project (conventions, decisions and why, gotchas, where
   things are).
2. **Board**: the coordinator's working state for the project. Goals,
   open questions, pending decisions, and every worker with its task,
   model, isolation, workspace and status.
3. **Transcript**: the conversation itself. Compacted when it grows.

### Memory

Unlimited, split into topic files, and read by search: the coordinator
builds its context from only the parts relevant to the task.

**Files**

- One markdown file per topic (for example "testing", "deploy", "how the
  user reviews code"), not per fact: search returns the matching sections,
  so files need not be tiny. Sections are `##` headings. Global memories in `global/memory/`, each project's in
  `projects/<project>/memory/`, both in the data directory.
- Front matter: `title`, a one-line `summary`, `tags`, `links` to related
  memories, `created`, `updated`, `source` (conversation and entry it
  came from), and `status` (active, superseded by another, or archived).
- The files are the source of truth. The user reads them in the web app (read-only for now).
- Each memory directory is a git repository; every write is a commit. That
  gives history and undo without extra code.

**Search**

- A SQLite FTS5 index (BM25 ranking) with one row per section (file title,
  summary, tags, heading, section text), derived from the files and
  rebuilt when they change. FTS5 works in Bun's
  `node:sqlite` (checked).
- No semantic search at first: pi-ai has no embeddings API. The model makes
  up for it by searching with several phrasings, and by tags and links. If
  that misses too much, add embeddings (for example a local model on the
  host) and merge both rankings.
- The index also records how often and when each memory was retrieved,
  for maintenance.

**Tools**

- `memory_search`: query, scope (global, project or both), tags, limit.
  Returns matching sections (file id, title, heading, snippet), never whole
  files.
- `memory_read`: chosen sections, or whole files, with their links.
- `memory_write`: add or edit a section, or create a topic file. Before
  creating something, it returns close matches, so the writer updates the
  existing topic instead of duplicating.
- `memory_archive`: retire a whole topic file. Outdated facts inside a
  file are edited out; git history keeps them.
- The coordinator has all of them. Workers have none; they put what they learned in their reports and the
  coordinator decides what to keep.

**What is always in context**

- No pinned sections for now (decided 2026-11-04).
- A short catalog: counts per tag, so the model knows what exists to
  search for. Rendered when the conversation starts and at each compaction, not on every write.
- Everything else only through search; no automatic recall at first. The
  system prompt tells the coordinator to search memory before planning
  each task, and to pass
  relevant memories to workers in their briefs.

**Writing**

- The coordinator writes memories as it learns them.
- After each compaction of the coordinator lands, a durable background task
  reads the part that compaction replaced and asks the coordinator's model for
  the durable facts worth keeping, so facts aren't lost when the coordinator
  forgot to save them. They are written through the same merge rules as
  `memory_write` (an existing topic is updated, never duplicated), one commit
  per scope, of kind `extraction` and sourced from the `pi.compaction` entry.
  Nothing worth keeping means no commit, and a failure never blocks anything.
  The web app shows each one with an undo.

**Changes and undo**

- Every memory commit says what made it through git trailers: `tool`, `hand`
  (an edit made outside the harness), `extraction`, `maintenance` or `undo`,
  the conversation an automatic write came from, and which commit an undo
  reverts. History derives the kind, the source and whether a change can be
  undone from them, so hand edits and tool writes are labelled too.
- `memory.undo` reverts a whole `extraction` or `maintenance` commit with
  `git revert`. It is refused with `memory_conflict` when a later commit
  touched any of the same files, or when the change was already undone; the
  revert is a commit of its own and marks the original as undone.

**Maintenance**

A durable background pass per memory scope, on the backend's own clock (one
loop, not one per project, so a project nobody opens is maintained too). It
runs nightly at a time the user chooses (start: 03:00 in the backend's
timezone) when the scope changed since its last run, and after a number of
writes since that run (start: 20), with a model the user chooses; no model
means no maintenance. The last run's commit is the mark the write count is
counted from, so both survive restarts, and one run per scope runs at a time.
Each run is a model loop over that one scope with the memory tools, and:

- merges duplicate sections and topic files that overlap;
- resolves contradictions: the newer fact wins, the older one is edited
  out (git history keeps it);
- splits a file only when it mixes unrelated topics or grows unwieldy;
- fixes titles, summaries, tags and links so search finds them;
- archives memories that are stale or never retrieved in a long time
  (archived ones stay searchable on request);

Each run is one git commit with a readable log of what it did. Its outcome
(`ok`, `nothing_to_do`, or `failed` with the reason) is what `memory.status`
reports; `memory.changed` is pushed when a run starts and when it ends, and
`memory.maintain` starts one by hand. The web app lists the changes, with undo.

### Board

Decided with the user on 2026-11-04; contract in `packages/protocol/src/board.ts`. Implemented in
`packages/server/src/board.ts`, with the harness's moves in `workers.ts` and `schedules.ts` (`docs/CONTINUE.md` has the
detail).

- A pi durable document on the coordinator's conversation, not free text, so it never has to be recalled from a
  summary. It holds tasks, questions waiting on the user, and decisions. No worker presets.
- Tasks: title, description, an optional acceptance line, `refs` (links to tickets and PRs, or their keys and
  numbers), status (`todo`, `in_progress`, `blocked`, `review`, `waiting`, `done`, `dropped`), `blockedBy` (acyclic), advisory
  `writeScopes`, and the workers that ran them (a task may take several runs: a retry, a review, a conflict fix).
  `refs` is optional on input: a save without it keeps the task's refs (so the Android app, which does not know them,
  never clears them), and tasks saved before refs read as none. How refs link and show their state: "Ticket and pull
  request links" above.
- The coordinator changes it with a `board` tool. The harness changes it itself: a worker spawned for a task moves it
  to `in_progress`, its report to `review`, its failure to `blocked` with the reason; the coordinator marks `done`
  after merging. When a task's blockers are all done, the harness tells the coordinator (it never spawns on its own).
  Write scopes only warn, and only between running `shared` workers; workspace workers cannot collide that way.
- The user edits it in the app (add, edit, reorder, drop tasks, move them between columns; answer questions). Every
  row has a compare-and-set `revision`, so a stale edit is refused instead of overwriting a newer one. The user's
  edits reach the coordinator as `[board]` inputs, with the user's reason for a move when they gave one (`note`); an
  answer reaches it like a message.
- Questions waiting on the user show as a badge in the projects sidebar, a pinned card above the composer, and a
  `board_question` notification.
- Scheduled runs stay off the board unless one fails or is skipped: that opens one `blocked` task for the schedule,
  updated (not duplicated) by later failures.
- `done` and `dropped` tasks are archived 7 days after they settle: out of the coordinator's view, still in the app.
- Not a system prompt section: it changes too often. The coordinator reads it through the tool; compaction carries a
  compact view of it (below). In the app it is a Board tab in the right sidebar with each task's workers nested. There is
  no Workers tab: workers open from their task, from the transcript's tool cards, and from notifications and deep links.
  The few workers no task lists (started without a `taskId`) show under the tasks as "Workers without a task".

### Compaction of the coordinator

Implemented 2026-11-05 in `packages/server/src/compaction.ts` (`docs/CONTINUE.md` has the detail); this section is the
design it follows.

pi durable's compaction does the mechanics (thresholds, background
summaries, placing them at turn boundaries, retry on context overflow). A
`beforeCompact` hook supplies the summary, built from:

1. The model's narrative summary of the compacted part (pi durable's
   prompt, plus: keep the user's intent, decisions and their reasons, and
   anything promised but not done).
2. The user's own messages from the compacted part, verbatim, newest first,
   within a token budget. They are short and carry the most signal. The
   harness's own inputs (worker reports, check-ins) are not the user's.
3. A compact view of the board, never summarized and within about 1.5k tokens: `in_progress`, `review` and
   `blocked` tasks and open questions in full; `todo` tasks one line each, the most recent 20 then "+N more";
   the latest 10 decisions; tasks done since the last compaction one line each; nothing archived. Over budget, the
   todo list shrinks first, then the done list; active tasks and questions are never cut. It ends with a note that
   the full board is always available through the `board` tool. It replaced the worker list the summary carried
   before the board (`summaryBoardView` in `board.ts`); "since the last compaction" is the first replaced message's time.
4. A note that older entries stay in storage and can be searched with a
   `history` tool, which searches this conversation's earlier entries
   (`history` also reads a range of entries by ID).

Compaction thresholds come from each model's context window (a fraction of
it: background at 35%, blocking at 50%), so they keep working when the user switches the coordinator's model. They are
installed as pi-durable's per-model `modelOverrides`, which is the only lever the package has: a worker that runs on the
coordinator's own model shares those fractions, while every other model keeps pi-durable's fixed-token defaults. The
same policy is what `ConversationContext.usage` reports, so the app shows the thresholds that are actually in effect.

`conversation.compact` compacts the coordinator's conversation now (coordinator only, with optional instructions for
the summary). It answers once the compaction is admitted; the summary lands as a `pi.compaction` entry through the
watch, and `usage.compacting` stays true until it ends. The app draws each summary as a divider marker in the
transcript — "Earlier messages summarized" with when, opening onto the rendered summary — and a running compaction as
one quiet line; a failed one keeps the existing notice. The Info tab's usage block shows the numbers and the action.

### Workers

- Worker transcripts never enter the coordinator's context. A worker ends
  with a report: outcome, files changed, workspace, open issues, things
  worth remembering. See [Workers](#workers) for how the backend implements it.
- Workers use pi durable's default compaction. Their work is short-lived.

## Models

- Model catalogs come from the pinned `@earendil-works/pi-ai` provider factories in server
  `models.ts`. `model-catalog-extensions.ts` holds a small temporary extra-model table for
  releases pi-ai has not shipped yet. Its provider wrapper extends both chat/all-model lists,
  so runtime lookup, `models.list`, web/Android pickers, usage costs and cache stats agree.
  A native entry with the same ID always wins; the temporary table is empty with pi-ai 1.5.1.

  Native Fable 5.2 supplies $8/$40 input/output, $0.20 cache reads, $10 short writes ($16 long writes),
  1M context and 128K output. Managed effort suppresses temperature without a local compat override.
  Thinking stays adaptive (no Off); per-message effort defaults to high, but the fixed top-level effort
  is now low to respect organization caps. The provider policy clears Anthropic's native fallback lists:
  pi-ai otherwise enables Fable 5.2 → Opus 5 server-side fallback automatically. No silent model switches.
  Anthropic message threads are enabled by pi-ai on its native endpoint; cache maintenance strips `thread`
  and sets `disableContinuation`, keeping the full cached prefix without replacing a real reply's thread.
  pi-durable migrates old live documents and task checkpoints; the SQLite schema remains version 2.
  The thinking-binding beta still uses `drop_block` for prefix edits; dropped thinking can raise
  costs. See [release facts and compatibility](research/fable-5-2.md)
  for the prefix-binding migration, 30-day retention and subscription quota caveats.
- Providers: opencode-go, anthropic, openai (all exist in pi-ai).
- Also openai-codex (the Codex CLI's ChatGPT login, legacy in pi-ai): a
  ChatGPT workspace account is refused by Sign in with ChatGPT ("Your
  organization hasn't enabled access for this app"). Its device-code
  login suits a headless backend.
- Auth: subscriptions for Anthropic and OpenAI. pi-ai has OAuth login for
  both (Claude Pro/Max; Sign in with ChatGPT) and a pluggable
  `CredentialStore`. The login runs from the web app; its callback goes to
  the host's localhost, so the web app takes the pasted code or redirect
  URL instead (pi-ai's `manual_code` prompt).
- Claude through pi-ai's Anthropic OAuth (subscription) from the start,
  user's decision. It presents itself as Claude Code (`claude-cli` user
  agent, Claude Code system prompt and tool names); if Anthropic blocks
  it, the fallbacks are an API key or the Claude Agent SDK.
- No built-in model defaults: each project's coordinator model and default
  worker models are chosen by the user, and the coordinator model can
  change during the project's life.
- The user can choose worker models with each reply; otherwise the
  project's default workers are used.
- Subscription usage (`subscriptions.usage`, server
  `subscription-usage.ts`): every OAuth login's rate-limit windows, plus
  the OpenCode Go API key (a plan with limits), from
  the endpoint the provider's own CLI shows (Claude Code's `/usage`:
  `GET api.anthropic.com/api/oauth/usage`; Codex CLI's `/status`:
  `GET chatgpt.com/backend-api/wham/usage`; OpenCode Go's console meter:
  `GET opencode.ai/inference/go/v1/usage` with `Authorization: Bearer <key>`,
  undocumented but what the console and tools such as cc-switch use;
  answers `{ usage: { rolling, weekly, monthly: { status, percent,
  resetsAt } } }`, percent of the plan's dollar limits, no plan or
  account name; its model replies carry no rate-limit headers, so it is
  read only, on the same schedule), kept current between reads
  by the rate-limit headers of the harness's own requests. Read every
  5 minutes while a client is connected and once a provider's requests
  go quiet; samples per window for its current period persist in
  `subscription-usage.json`. Only `opencode-go` counts among API keys
  (`API_KEY_PLAN_PROVIDERS`); other keys (the `opencode` Zen provider,
  anthropic, openai) are pay-as-you-go with no plan limits and are left out.

## Scope

- Essential from the start: codemode, subagents, tool search, hooks,
  images. No plan mode. Nothing needs approval for now.
- Most of these exist in pi durable already, so the harness should be thin
  glue over the package. The custom work is the coordinator, memory and
  compaction, and the web client.

## Web app look

- `bind:this` gotcha: Svelte 5 sets the variable to `null`, not `undefined`, when the element or component is destroyed
  (inside `{#if}`, `{#each}`, `{#key}`, or on unmount). Type it `| null` and test with `== null` / `!= null`, `?.` or `!x`, never
  `=== undefined`; a native listener on a removed element can still fire. `apps/web/test/bind-this.test.ts` enforces it.
- The chat follows Jarvis' chat interface (read-only reference:
  a separate reference design): a header with the
  project's name, one orb per turn, thinking blocks, tool cards with diffs and
  highlighted code, a glass composer with the model and thinking-level
  pickers, and a scroll-to-bottom button. A resizable right sidebar holds the
  conversation's context (Info), the project's workers (Workers) and its
  read-only memory (Memory), is a full-screen sheet on a phone, and can
  expand over the chat area; worker
  reports, failures and check-ins are cards in the transcript, not user
  bubbles. Web and Android also recognise boundary-delimited `[reports]` user inputs as quiet,
  collapsed “Reports out of date” task lines, in every shared transcript including loaded history.
  Like board/check-in notices, these inputs currently have no structured wire marker: parse the
  prefix on read, never rewrite stored messages. Each `T… Results/Next stale: reason` batch yields
  one labelled button per task/section and a short reason; task buttons open the existing task sheet.
  Unknown bodies remain a notice with the complete original text behind the same disclosure.
  Image-bearing messages remain ordinary user inputs. Android task/disclosure targets are at least
  48dp, with TalkBack task/section labels and expanded/collapsed state. Jarvis-only features (voice, tags, artifacts, subagents panel,
  offline queue, i18n) are left out.
- Consecutive thinking parts fold into one thinking block (one header such as
  "Thought for a while · 3 steps", the steps divided when open). A run of coding
  calls (bash, read, write, edit) folds into one card, with the thinking between
  them as slim lines of their own: one line per call with its status, kind, the
  command or project-relative path and its duration, opening into what its single
  card shows; a thinking line opens into its full text. The header counts each
  kind present ("Ran 2 commands, read 3 files, edited 1 file · 2 thoughts"). Text
  and non-coding tools break the run, and a failed tool stays collapsed with its
  icon and border carrying the error.
- Memory tool calls are cards of their own: a memory icon, a Global/Project/Both
  pill and a one-line summary in words (a search's query and match count, a read's
  sections, a write's target and heading, an archive's reason). Expanded, search
  hits open their topic (the query's words marked in the snippet), a read's sections
  render as Markdown, a write shows the written section and close matches, and an
  archive its reason; errors stay collapsed and red. Memory tools are not coding
  tools, so they break a coding group.
- **Older chat history (T38).** Main, background threads and worker transcripts all prefetch older pages (50 entries)
  instead of requiring a Load earlier click. The view window itself is pi-durable's
  (`conversation.watch(context, { from, min, max })`): the newest `min` entries, then appends, one drop to `min` past
  `max`, and a `before` naming the entry just outside it. The server forwards that window as the protocol's
  `ConversationView` instead of re-slicing it in `window.ts`: slicing an already windowed view cannot see the history
  outside it, so it computed an empty prefix and reported the transcript as complete (T163). Web starts within 1.5 viewport heights of the loaded boundary, rechecking
  after scroll, resize and each page so short content fills automatically. A local synchronous guard supplements the
  watch's single-flight guard. Paging failures latch a small inline “Couldn't load earlier messages · Retry”; live-watch
  errors are separate, and neither a scroll nor a live update retries a failed page. A small spinner replaces the
  paging control while loading; exhausted history has no row. Web disables native `overflow-anchor` on this scroller
  and snapshots a surviving visible row immediately before a prepend, correcting its offset after DOM flush, not
  after the network wait or a later animation frame. Removing the exhausted-history spinner row is anchored too.
  This preserves scrolling during the request and avoids double compensation by the browser. Tail-only growth keeps
  the existing bottom-follow path, scroll-to-bottom control, waiting messages and composers/drafts.
  Android's shared `ChatScreen` uses `snapshotFlow` at six items from the loaded boundary; its predicate permits
  short-viewport refill but not prefetch while following a scrollable tail or resolving a highlighted entry. Collect
  each page without `collectLatest` cancellation and include the oldest entry ID in the observed value so another
  page can start even when the near-boundary boolean stays true. Stable LazyColumn keys retain the visible item and
  offset across prepend/fling. Keep the `earlier` slot while loading (capability is temporarily false), include it in
  highlight/tail index offsets, and remove it only at exhaustion. Android also separates `earlierError` from the live
  watch; Retry clears it. Highlight loads run outside their loading-keyed effect so starting a page cannot cancel itself.
- The chat's top bar sits in the chat column, and the top bar, the transcript and
  the composer share one width (`CHAT_COLUMN_CLASS`, `max-w-4xl`), so opening
  the right sidebar shrinks them together and keeps them centred. The right
  sidebar (Tasks/Background/Info/Memory) runs the full height from the top edge and,
  expanded, covers the whole area including the top bar; below 72rem it stays a
  full-screen sheet.
- Every project is one click away: a persistent left sidebar lists every backend's projects, grouped by backend, with
  the current one highlighted, each row's coordinator status (working, failed, workers running, when it last answered)
  and an unread mark for a reply this browser has not seen. It collapses to an icon rail on a wide screen (remembered per
  browser) and becomes a drawer opened from a page header below 64rem. The home route is the backends page: add or
  remove servers, add a project, pick a theme.
- Backends are configured per browser (name + HTTPS origin, in `localStorage`), and the user rarely remembers their
  addresses. Three things spare them typing:
  - **Published list.** `deploy/backends.json` is built into the app as `/backends.json` and fetched at startup. A
    browser with no backends shows them as one-tap adds plus "Add all"; the Backends section of General settings shows the ones not added yet.
    Adding one connects at once. A host that publishes no list (or an unreadable one) suggests nothing.
  - **Connect another device.** General settings → Backends turns the chosen backends into
    `<app origin>/connect#<encoded list>`, drawn as a QR code too. The list rides in the fragment, so no server sees it;
    the `/connect` page shows what it carries, the user confirms, each backend is added (a URL already present is
    skipped) and the browser lands on its projects. Decoding is strict: HTTPS origins only, sane lengths, a damaged or
    version-mismatched link adds nothing. The build emits `connect.html` beside the fallback page, so a direct visit
    works with or without the SPA fallback.
  - **Short addresses.** In the add form a bare name (`harness-pc`) becomes that published backend, or
    `https://<name>.<domain the published backends live under>` (the parent of their hosts, else the app's own host's
    parent — nothing hardcoded). The name field fills itself from the address host's first label while it is untouched.
  - Loopback HTTP backends stay in the browser they were typed in: a connect link carries only HTTPS origins, and says
    so.
- Markdown is rendered with `marked`, sanitized with DOMPurify, and code is
  highlighted with shiki (a light and a dark theme at once; CSS picks one).
- **Board Markdown (T60).** Questions, warnings, answered questions and decisions (including their why) reuse the
  chat renderer on web and Android, in a compact card style with tighter paragraph/list spacing, nested indentation
  and theme-aware labels. Raw HTML is never interpreted. Suggested answers remain buttons with clean plain labels;
  submitting preserves the original option. One-line pins and notifications strip Markdown before truncation.
  Long card text folds the rendered content behind an accessible Show more / Show less toggle, never a source slice.
- **User Markdown (T33).** Main and thread user bubbles (including web waiting/failed sends) use the assistant renderer:
  `Markdown` on web, `RichMarkdown` on Android. Web task feedback shows the same formatted message; short sidebar and
  timeline snippets stay plain. User soft newlines remain line breaks, headings are chat-sized, HTML is literal text,
  and web output still goes through DOMPurify. Task prefixes/chips, leading selection quotes, attachments and ref links
  keep their existing paths; task/ref mentions inside Markdown code are not linked. Copy message copies the original
  Markdown including its task/feedback prefix. Fenced blocks share the same Wrap preference and scrolling controls as
  assistant code. User links use readable foreground colours against the bubble in either theme.
- **Code in the chat: wrap or scroll (D21).** A bash command in a tool card wraps by default (a command is read, not
  column-aligned); a fenced block scrolls sideways. Every code block has a "Wrap" toggle (the bash card's Command row
  has one too), always shown, `aria-pressed`. One device-wide choice, `wrap code` (web `localStorage`
  `aiki.code-wrap.v1`, Android DataStore): until the reader chooses, a bash command wraps and a fenced block
  scrolls; after that every block follows the choice. Wrapped code marks each soft wrap with a small muted `↳` in the
  hanging indent of the continuation row, so it differs from a real newline; the mark is drawn (CSS mask / canvas), never
  text, so copy and selection give the original. A scrolling block fades the edge that has more behind it (right at
  the start, left at the end, both between) and keeps its scrollbar visible while the pointer is over it (web).
  Markdown tables, tool output and write/read bodies keep their own behaviour.
- Every backend shows its release where it is listed and in the chat's header
  line: the short commit, the commit's description and when it was deployed
  ("Checkout" when the server runs from a checkout). A deploy that failed,
  rolled back or published a commit other than the running release gets a
  dismissible banner on the home page and above the chat composer, saying what
  the attempt was for, what went wrong, and that the previous release still
  runs. Everything comes from `server.status` and is hidden on a backend that
  does not advertise `server-status`. A backend that is catching up to a commit it
  missed (a laptop that was away) adds "Catching up to a1b2c3d: …" to its release
  line from the optional `pending` note of its deploy status.

### Task sheet — Dashboard cards, single column (D27 / D28 / T43)

Selected by the user on 2026-11-09, after three screenshot proposals. This is the only web task sheet look; there is no
`look` query parameter, preview bar or stored look preference. Board/list cards are not part of this redesign. Android
follows the same visual hierarchy in D28, using its existing Jarvis theme and shared reply composer (details below).

- **Frame.** A right-hand sheet, up to 74rem wide with a small outside gutter; full screen on a phone. The header keeps
  the task ID, status menu, title, refs, update time and holder. D29 replaces Done/Drop/Reopen with the status menu and inline waiting form. Header and reply stay available while
  the body scrolls. Safe-area padding is retained.
- **Compact task context (T62).** No summary strip or its divider below the header. Status stays in the header menu;
  Questions (including warnings) and Feedback keep their open counts in section navigation. Feedback uses stored open
  plus handling totals even before the timeline read completes. Waiting note, since time and optional return date move
  into the wrapping header metadata; subtask done/total also lives there, including zero done and archived/absent links.
  Workers' section/nav count includes both total and currently running workers when nonzero. Blocked reasons and
  dependency links remain in the existing blocked callout. No information depends on expanding History or Timeline.
- **Compact refs and keyboard space (T113).** Refs start collapsed per opened task. A small disclosure shows kind
  counts (including unknown state) and prioritizes failing/running PR checks; otherwise it shows open/closed/unknown
  totals. Historical checks on merged/closed PRs do not demand attention. No extra status/needs-you strip or chip wall.
  Expanded refs have their own scroll viewport, capped at 15rem/240dp and a quarter of the available height. Every ref
  remains reachable. The header itself is bounded and scrollable for long titles and short screens; reply and body
  retain space independently of refs. Web follows the visual viewport above mobile keyboards, caps the task draft
  field to 20% of that height, and keeps the existing per-task draft state. Android budgets from the inset/IME-reduced
  constraints (header at most 35%, reserving 220dp outside it on short windows; draft field at most 20%/160dp); this fixes the non-weighted header consuming all
  height before the reply could be measured. The inset policy and shared chat composer are unchanged. Multiline
  input scrolls internally without discarding text; expanding refs or changing keyboard size never recreates it.
  Below 400dp available Android height, section chips temporarily yield their space to the scrollable body and its
  padding is reduced; normal-height windows retain the existing section navigation.
- **One column at every width (T43).** Questions comes immediately after the header/navigation, then Report, Timeline, Feedback and Files.
  Related, Workers, Decisions, History and Brief follow. Existing visibility rules remain; empty reference
  sections do not leave blank cards. History, Timeline and Brief retain their existing folding behaviour.
- **Section navigation (T43).** At 54rem of sheet width (a container query, not window width), a slim sticky rail sits
  left of the single card column. Below that width it becomes a horizontally scrolling chip row, sticky below the
  header from the start of the body. It lists the rendered sections only, with shared icons, labels and count
  chips. Links are keyboard accessible in a `nav` landmark with `aria-current="location"`. Clicking selects and pins
  that section immediately, scrolls its card below the header/chips (accounting for the chips' negative sticky top),
  and clamps to the available scroll limit. The pin survives `scrollend` (debounced timeout fallback) until the user
  scrolls the body by wheel, touch, a scroll key or scrollbar drag; moving just the nav does not release it. During
  hand scrolling, IntersectionObserver and scroll position select the section at the activation line; at the end,
  the last visible section wins so short folded cards are reachable. Navigation scrolls smoothly, or instantly under
  reduced motion; the active horizontal chip scrolls into view without moving the body. The rail can scroll
  independently on short viewports. Editing hides the navigation.
- **Files is always full card-column width.** Its carousel keeps the wider 84cqw slides with neighbouring slides
  peeking; caption, tag filters, thumbnail strip, video controls and full-screen viewer are unchanged.
- **Sections.** `TaskSection` and `TaskSectionHeader` give every section a bordered theme surface, a tinted header band,
  a meaningful icon, a real h3 heading (1rem, bold, foreground colour) and a small count/context chip when useful.
  Disclosure buttons remain inside their headings, with `aria-expanded` and a stable controlled content element. The
  palette is exclusively `--chat-*` / `--accent-*`, including light/dark and the neutral theme. Avoid the existing global
  `section-label` chat utility here; it has a different tiny uppercase treatment.
- **Report.** Next, Now and Results appear in that order, with stronger labels. Next keeps its quiet accent inset; report metadata remains
  secondary. A report not yet written gets a plain explanation, not empty Now/Results/Next blocks or a misleading update
  chip. Finished and archived reports remain readable; Reopen, archive lookup and thread-holder identification keep
  their existing behaviour. Long titles and refs wrap on a phone or narrow desktop.
- **Timeline reading (T118).** Timeline and its navigation chip sit between Report and Feedback, still folded by
  default. Entries are sorted newest first; a separate 44px/48dp icon button in the section header reverses the
  direction, with a named current direction and tooltip. Web stores the global choice in `aiki.timeline-order.v1`;
  Android stores `timelineNewestFirst` in device preferences (old settings default to true). Opening, reversing or
  filtering starts at the newest end: top in newest-first, bottom in oldest-first. Live entries do not force a jump.
  The web event viewport is at most 400px / 48dvh, keyboard focusable, with contained overscroll; Android uses a bounded
  LazyColumn at most 400dp / 36% of screen height and a horizontally scrolling filter row. The sheet keeps its own
  scrolling and T113 header/composer/IME budgets. Rows use quiet kind/outcome-tinted icons, actor and relative time,
  exact time on hover (web) or long-press (Android), single-line labels, expandable secondary detail, and from → to
  status chips. Local calendar-day separators say Today, Yesterday or a date, independent of reading direction.
  The existing wire timeline remains chronological; no history data, endpoint, kind filter or status action changes.
- **Reply.** `TaskReply` renders the actual coordinator `Composer`, without model/worker/task pickers. No copied shell:
  it has the same glass card, 16px type, internal attach and arrow-up send controls, paste/drop handling, image strip,
  autosizing and Enter/Shift+Enter rules (touch Enter is a newline). The coordinator composer itself is unchanged.
  The hint under the card is one ellipsized line, `To the coordinator · T3`; errors remain readable, not truncated.
  Drafts are independent per backend/project/task (`task-reply:<taskId>`, using the existing draft protocol and image
  store), not shared with the coordinator's draft. Sending goes to main with `taskId` and `keepDraft: true`; main still
  forwards to a holding thread. Composer clears/restores the task draft on success/failure and announces a successful
  send politely. A close/reopen or reload retains text and images on a drafts-capable backend.

Code: `TaskSheet.svelte`, `TaskSection.svelte`, `TaskSectionHeader.svelte`, `TaskReply.svelte`,
`TaskSectionNav.svelte`, `lib/task-sheet.css`, `lib/task-sections.ts`, `lib/task-section-icons.ts`, `lib/task-sheet-meta.ts`,
and the existing feedback/relations/timeline/media components. Compact context rules are tested in `task-sheet-meta.test.ts`;
report order and scroll-spy selection in `task-sections.test.ts`.

**Android Dashboard (D28, 2026-11-09).** `features/tasks/TaskSection.kt` provides the corresponding bordered theme surface,
accent-tinted header band, 18dp section icon, 16sp bold heading and small count chip. It explicitly supplies the theme's
foreground as the surface content colour, so nested Markdown retains its previous light/dark contrast. The heading is
never weighted: a free-form metadata slot is constrained to the remaining width, with the report's existing two-line
ellipsis treatment (T31). Foldable sections retain heading/button semantics and an announced open/folded state.

- **T62 removes `TaskSummary.kt`.** `TaskSheetMeta.kt` keeps the same compact context as web: waiting and subtask
  progress in wrapping header metadata, open question/feedback and running-worker counts on section chips. It adds no reads.
- **T43 removes the 840dp two-column layout.** Every window uses the same Questions, Report, Timeline, Feedback, Files,
  Related, Workers, Decisions, History, Brief order. The side sheet still starts at 600dp, has a maximum
  1184dp width and a 48dp outside gutter.
- A horizontal sticky chip row stays above the scrolling body, below the unchanged header. A keyed LazyColumn
  holds one item per present section, starting at index zero (T62). Tapping a chip pins its key immediately and calls
  `animateScrollToItem` (or `scrollToItem` with the existing Android reduced-motion preference); item offset zero
  already clears the header/chips outside the viewport, and the list clamps short end sections to its scroll limit.
  The pin survives animation completion; only a body `DragInteraction.Start` releases it for the ensuing drag/fling.
  Otherwise the spy uses `firstVisibleItemIndex`, or the last visible item when the list cannot scroll forward. Repeated
  taps cancel the previous navigation job. The chip row scrolls the current chip fully into view without releasing
  the body pin. FilterChip supplies focus, activation and selected semantics.
- Files fills the single column. Its media pager keeps its 84% peeking slides, 288dp minimum stage height and 60%
  window-height ceiling. Pager state, thumbnail/filter/caption/viewer/video behaviour are unchanged.
- T29's link navigation, Show with linked, feedback state actions, retry, timeline filters and empty Feedback/Timeline
  placeholders are retained. Report/question/decision/worker actions and their state owners are unchanged. Report
  uses Next, Now, Results; Next retains its accent inset. Folded History and Brief remain independently foldable.
- **The T32 reply box keeps its text/image state, paste intake and sending rules.** T113 adds task-local layout
  constraints above the keyboard, without changing the shared `features/chat/MessageComposer.kt` or adding web-style
  task draft sync. See Compact refs and keyboard space above.

Android code: `TaskSheet.kt`, `TaskSection.kt`, `TaskSheetMeta.kt`, `TaskRelationsSection.kt`, `TaskFeedback.kt`,
`TaskTimeline.kt`, `TaskSectionNav.kt` and `media/MediaCarousel.kt`. JVM tests cover compact context in
`tasks/TaskSheetMetaTest.kt` and section presence/order/counts in `tasks/TaskSectionNavTest.kt`.

### Themes

Two themes ship: `jarvis` (violet surfaces, a cyan → indigo → fuchsia →
orange gradient; the default) and `neutral` (plain shadcn greys). Light and
dark still follow the system setting through the `.dark` class; a theme only
changes the palette.

- One file per theme, `apps/web/src/lib/themes/<name>.css`, sets one small set
  of semantic `--tone-*` variables twice: once for light and once for
  `:root[data-theme='<name>'].dark`. Tones cover surfaces, borders, text,
  primary, the four gradient stops, the user bubble, danger/success/warning,
  the focus ring, the corner radius and the shadow. Nothing else.
- `apps/web/src/lib/themes/base.css` derives everything from those tones:
  shadcn's tokens (`--background`, `--card`, `--primary`, `--border`, …) so
  the settings, home and vendored components follow the theme too, and the
  chat's own `--chat-*` tokens plus the glass/shimmer/icon-chip utilities.
- `apps/web/src/lib/themes/themes.ts` is the typed registry (`THEMES`,
  `DEFAULT_THEME`, the storage key). `theme.svelte.ts` holds the choice in
  runes and writes `data-theme`.
- The choice is stored per browser (`localStorage`, like the backend list).
  `app.html` reads it and sets `data-theme` before the first paint, next to
  the system-driven `.dark` class. General settings → Appearance holds the picker (cards that draw each theme, light and dark).

To add a theme:

1. Copy `neutral.css` to `themes/<name>.css`, set every `--tone-*` for light
   and for dark, and add `<name>` to `ThemeId` and `THEMES` in `themes.ts`.
2. Import the file in `apps/web/src/app.css`.
3. Add the id to the `THEMES` list in `apps/web/src/app.html` (it runs before
   the registry can be imported). `apps/web/test/themes.test.ts` fails if the
   two lists or the CSS file disagree.

## Settings

Decided with the user on 2026-11-08 (D8, D9). Every section is built to the standard below. `lib/settings.ts` holds the
section lists, the URLs and the rules below as pure functions (`test/settings.test.ts`).

### Split and where things go

- **General settings**, opened from the bottom of the left sidebar (one "Settings" entry; Usage stays its own modal and
  footer entry). Sections: **Appearance** (theme and the device-local work-day start for Waiting dates), **Backends**, **Notifications**, **Archived projects**.
  - Backends lists the browser's backends, suggested ones, add, connect another device. Each backend has its own
    subpages: its page (status, release, machine, deploy, name, remove, memory maintenance) and **Accounts and API
    keys** (moved out of Project settings: credentials belong to the backend that holds them), and **MCP servers**
    (capability-gated remote connections, token entry and tool policies).
  - Notifications is the old /notifications page; Archived projects is the unarchive list (the drawer keeps its own).
- **Project settings**, opened from the top bar gear and the ⋯ menu: **General** (name, folder, archive),
  **Coordinator** (model, thinking), **Workers** (worker models, check-ins), **Scheduled tasks**, **Tickets and pull
  requests**, **Prompt cache**, **MCP** (server and agent-role enablement), **Storage**. A section a backend does not offer is left out of the list.
- `/` stays the projects home (it was both): every backend's projects, Add a project (opens `FolderPicker`), the
  first-run backend form. Management moved to Settings → Backends.

### Routes and redirects

Every section has a URL; the last segment is the section name, which Android reuses one to one.

```
/settings                                   list (phone) / first section (wide)
/settings/appearance | notifications | archived
/settings/backends                          list
/settings/backends/<id>                     one backend
/settings/backends/<id>/accounts            Accounts and API keys
/settings/backends/<id>/mcp                 MCP servers
/b/<backend>/projects/<id>/settings         list (phone) / General (wide)
/b/<backend>/projects/<id>/settings/general | coordinator | workers | schedules | tickets | cache | mcp | storage
```

- `/notifications` redirects to `/settings/notifications`. The old `.../settings` URL still works: it is the list on a
  phone and goes on to General on a wide screen (replacing the address, so Back does not bounce).
- A schedule notification links to `.../settings#schedule-<id>` (Android's route parser knows only `.../settings`);
  the project settings index sends that address on to Scheduled tasks with the fragment, and the list scrolls to the
  schedule.
- Links go to the section they mean: the disk banner to `.../settings/storage`, "no coordinator model" to
  `.../settings/coordinator`, the Usage modal's sign-in link to `/settings/backends/<id>/accounts`.

### Layout

`SettingsShell` is the frame of both areas. From 48rem: the section list on the left (icon, name, a chip for a state
worth seeing: "No model", "2 offline", "Off"), the section on the right. Below that: one screen at a time, the list
(a card per section with its one-line hint and a chevron), then the section with a back button naming the screen it
returns to (`settingsParentHref`). The same markup does both; only what is hidden changes. Rows and buttons are at
least 44px tall on a phone.

### Rows, groups and states

- A section starts with `SettingsSection` (icon chip with a wash of the theme gradient, title, one line).
- Settings sit in `SettingsGroup` (a titled surface with a ring and a soft shadow, hairlines between rows).
- `SettingsRow`: label and a one-line hint on the left, the control on the right; stacked and full width on a phone.
  `control="full"` puts the control under the label (a segmented bar); `below` spans the row (a preview, a warning).
- **Hints are one line.** Anything longer goes behind `LearnMore` (a disclosure under the hint, closed by default).
  Never only in a tooltip: tooltips do not work on touch.
- **Per-field save states** (`SaveState`, `SaveStatus`): a field saves when it changes (a pick) or when it is left
  (text), and says *Saving…*, *Saved* (for 2.5 s) or the failure with *Try again*, beside that field. No big form.
- `StatusChip` (ok, warn, err, info, muted) takes its colour from the theme's success, warning and danger tones.
- Depth and character come from tokens only: `--chat-*`, `--accent-*`, `bg-card`, ring and a small shadow. Nothing
  theme-specific, so every theme works in light and dark.

### Combobox

`Combobox` replaces a native select wherever the list can be long (models, providers). The button shows the current
value (name and a second line); it opens a popover with a search box and options grouped under headings
(`lib/combobox.ts`: every typed word must match the label, description, group or keywords). Keyboard: arrows, Home,
End, Enter picks, Escape closes and returns to the button; focus stays in the search box and the list follows with
`aria-activedescendant`. On touch the box is not focused on open. `modelOptions` (`lib/models.ts`) groups the catalog by
provider with the model ID, context size and a "no credential" chip. The search box shows only for a list of more than
8 options. **Thinking level is a dropdown** (`ThinkingSelect`, a Combobox: "Model default" and the model's levels, four
bars filling with the effort) in the Coordinator, each default worker model, memory maintenance and the schedule
editor. `Switch` is an on/off setting, `AutoInput` a text or number field that saves when left, `Segmented` the one
short choice shown whole (Prompt cache).

### What each section holds (also the map for Android)

| Scope | Section (URL segment) | Holds |
|---|---|---|
| General | `appearance` | Theme cards (light and dark preview), light/dark follows the device. Stored in the browser. |
| General | `backends` | Backends list (name, address, connection chip, link to its page), suggested backends, add a backend, connect another device (link + QR). |
| General | `backends/<id>` | Status (release incl. the "catching up" note, machine/disk, deploy banner), name, address, link to Accounts and API keys with "N of M ready", memory maintenance (model, thinking, nightly time, after writes), remove from this browser. |
| General | `backends/<id>/accounts` | Providers ready (signed in, API key, environment) with Manage; "Add a provider" (searchable); sign-in flow (OAuth prompts, code paste) and API key form per provider. |
| General | `notifications` | This device on/off, one switch per event kind (+ reset), quiet hours (from, to, still notify failures), per-backend registration with a test push, muted projects. |
| General | `archived` | Archived projects per backend with Unarchive. |
| Project | `general` | Name, folder (copy), backend, archive/unarchive. |
| Project | `coordinator` | Model (searchable, with a summary: provider, context, reasoning, images), thinking level. |
| Project | `workers` | Default worker models (order, thinking level each, add/remove), check-ins (switch, every N minutes). |
| Project | `schedules` | Schedules (clock or GitHub review-requested event; pause switch, run now, edit, delete, run history) and the editor dialog. |
| Project | `tickets` | Jira site, ticket prefixes, GitHub repositories, "fill in again". |
| Project | `cache` | One-hour prompt cache: coordinators, coordinators and workers, nobody. |
| Project | `storage` | Disk use of worker/thread workspaces, clean up finished, remove one. |

A section the backend does not offer (`projectSectionAvailable`) is left out of the project list.

### Theme preview

`Appearance` draws each theme as two small apps, light and dark. A theme's CSS also matches
`[data-theme-preview='<id>']` (add `.dark`), so the preview shows tones of a theme that is not the chosen one.

### Android

Built to the same split (`apps/android/.../features/settings/`). The section ids above are the Android route names too:
`Destination.Settings(GeneralPage(section, backendKey, accounts))`, `Destination.ProjectSettings(chat, section, scheduleId)`
and `Destination.Home` (the projects home, web `/`). `NotificationRoutes` maps the web URLs (`/settings`,
`/settings/<section>`, `/settings/backends/<id>[/accounts]`, `/notifications`, `.../settings[/<section>]`,
`.../settings#schedule-<id>`) to them; the manifest opens `/settings*` and `/notifications` like `/b/`.

- Frame: `SettingsShell` (phone: list, then one section with an in-page back button naming the screen above; from 600dp:
  list and section side by side). Kit: `SettingsKit.kt` (`SettingsSectionPage`, `SettingsGroup`, `SettingsRow` with
  `RowControl.Wide/Auto/Full/Inline`, `LearnMore`, `SaveStatusLine` + `SaveState`, `StatusChip`, `AutoInput`, `SettingsSwitch`),
  `Combobox.kt` (a bottom sheet with search above 8 options, grouped, with `ThinkingSelect`). Pure logic with JVM tests:
  `SettingsSections.kt`, `ComboboxLogic.kt`, `SaveState.kt`, `WorkerModels.kt`, `SchedulePresentation.kt`
  (`SettingsSplitTest`, `NotificationsTest`).
- Differences from the web: the sheet is a bottom sheet, not a popover, and there is no keyboard walk; Appearance has
  Device/Light/Dark as well, since Android lets the app override the device; the Schedules panel tab is gone (schedules
  live only in project settings, as on the web) and a schedule tool card opens Scheduled tasks; Accounts keeps
  `FLAG_SECURE` (release builds) because it takes keys.

## Layout

`SettingsShell` is the frame of both areas. From 48rem: the section list on the left (icon, name, a chip for a state
worth seeing: "No model", "2 offline", "Off"), the section on the right. Below that: one screen at a time, the list
(a card per section with its one-line hint and a chevron), then the section with a back button naming the screen it
returns to (`settingsParentHref`). The same markup does both; only what is hidden changes. Rows and buttons are at
least 44px tall on a phone.

### Rows, groups and states

- A section starts with `SettingsSection` (icon chip with a wash of the theme gradient, title, one line).
- Settings sit in `SettingsGroup` (a titled surface with a ring and a soft shadow, hairlines between rows).
- `SettingsRow`: label and a one-line hint on the left, the control on the right; stacked and full width on a phone.
  `control="full"` puts the control under the label (a segmented bar); `below` spans the row (a preview, a warning).
- **Hints are one line.** Anything longer goes behind `LearnMore` (a disclosure under the hint, closed by default).
  Never only in a tooltip: tooltips do not work on touch.
- **Per-field save states** (`SaveState`, `SaveStatus`): a field saves when it changes (a pick) or when it is left
  (text), and says *Saving…*, *Saved* (for 2.5 s) or the failure with *Try again*, beside that field. No big form.
- `StatusChip` (ok, warn, err, info, muted) takes its colour from the theme's success, warning and danger tones.
- Depth and character come from tokens only: `--chat-*`, `--accent-*`, `bg-card`, ring and a small shadow. Nothing
  theme-specific, so every theme works in light and dark.

### Combobox

`Combobox` replaces a native select wherever the list can be long (models, providers). The button shows the current
value (name and a second line); it opens a popover with a search box and options grouped under headings
(`lib/combobox.ts`: every typed word must match the label, description, group or keywords). Keyboard: arrows, Home,
End, Enter picks, Escape closes and returns to the button; focus stays in the search box and the list follows with
`aria-activedescendant`. On touch the box is not focused on open. `modelOptions` (`lib/models.ts`) groups the catalog by
provider with the model ID, context size and a "no credential" chip. The search box shows only for a list of more than
8 options. **Thinking level is a dropdown** (`ThinkingSelect`, a Combobox: "Model default" and the model's levels, four
bars filling with the effort) in the Coordinator, each default worker model, memory maintenance and the schedule
editor. `Switch` is an on/off setting, `AutoInput` a text or number field that saves when left, `Segmented` the one
short choice shown whole (Prompt cache).

### What each section holds (also the map for Android)

| Scope | Section (URL segment) | Holds |
|---|---|---|
| General | `appearance` | Theme cards (light and dark preview), light/dark follows the device. Stored in the browser. |
| General | `backends` | Backends list (name, address, connection chip, link to its page), suggested backends, add a backend, connect another device (link + QR). |
| General | `backends/<id>` | Status (release incl. the "catching up" note, machine/disk, deploy banner), name, address, link to Accounts and API keys with "N of M ready", memory maintenance (model, thinking, nightly time, after writes), remove from this browser. |
| General | `backends/<id>/accounts` | Providers ready (signed in, API key, environment) with Manage; "Add a provider" (searchable); sign-in flow (OAuth prompts, code paste) and API key form per provider. |
| General | `notifications` | This device on/off, one switch per event kind (+ reset), quiet hours (from, to, still notify failures), per-backend registration with a test push, muted projects. |
| General | `archived` | Archived projects per backend with Unarchive. |
| Project | `general` | Name, folder (copy), backend, archive/unarchive. |
| Project | `coordinator` | Model (searchable, with a summary: provider, context, reasoning, images), thinking level. |
| Project | `workers` | Default worker models (order, thinking level each, add/remove), check-ins (switch, every N minutes). |
| Project | `schedules` | Schedules (clock or GitHub review-requested event; pause switch, run now, edit, delete, run history) and the editor dialog. |
| Project | `tickets` | Jira site, ticket prefixes, GitHub repositories, "fill in again". |
| Project | `cache` | One-hour prompt cache: coordinators, coordinators and workers, nobody. |
| Project | `storage` | Disk use of worker/thread workspaces, clean up finished, remove one. |

A section the backend does not offer (`projectSectionAvailable`) is left out of the project list.

### Theme preview

`Appearance` draws each theme as two small apps, light and dark. A theme's CSS also matches
`[data-theme-preview='<id>']` (add `.dark`), so the preview shows tones of a theme that is not the chosen one.

### Android

Not part of this work. Section names and URLs above are the contract; the app should map its screens to them.

## Layout

Bun workspaces. Native apps may come later, so every client talks to the
server only through the protocol.

```
packages/protocol/  wire format: messages and schemas (TypeBox, so JSON
                    Schema for Swift/Kotlin codegen), versioned
packages/client/    framework-free TS client: connect, reconnect, apply
                    Chord ops, keep view state
packages/server/    Bun: Harness, coordinator, memory, notifications;
                    API only (one backend)
apps/web/           SvelteKit SPA; imports client and protocol, never server
apps/<native>/      later; technology not chosen
```

## Notifications

### Android relay account screens (T97)

D51 keeps the relay account optional. Only the explicit switch in Settings → Notifications may construct Firebase
Auth or start a relay request. First run, pairing, projects and direct notifications do not ask for an account.
When no relay endpoint is configured, notification settings render exactly the existing direct-notification page,
with no relay row or unavailable notice. Configured builds put the default-off relay row below This device; it
explains the account requirement and has a Learn more disclosure. Opt-in explains email/profile
storage, encrypted content, visible metadata, limits/operator control and deletion before Google or email sign-in.
Email links use the configured Hosting host and exact `/__/auth/links` path; paste recovery rejects other hosts,
credentials, fragments and non-HTTPS links. The email is remembered locally, never placed in a continuation URL.

Private build values supply the Web OAuth client ID, Hosting link domain and privacy contact. Empty values disable
relay sign-in with a plain reason, without affecting the rest of the app. Debug-only source sets own Auth emulator
configuration, synthetic Google credentials and fake FCM tokens. Release builds have no emulator settings or fake
providers. Demo configurations are synthetic and stay outside the checkout; FCM auto-init remains disabled.

D54 starts with email-link sign-in only. If the Web client ID is empty, there is no Google button (not a disabled
button or an error), and consent omits the Google name/photo point. A configured Web client ID offers both methods;
the debug-only fake Google switch counts as configured. Missing Google configuration never disables email sign-in.
The flow is consent → the available sign-in method → phone check → on. Cancelling any unfinished step keeps relay off.
Only the explicit in-memory phone check accepts challenges before the persisted switch becomes on; closing or leaving
settings stops that receive authority. A server-issued challenge deadline is compared to its stored receipt exactly,
not rejected merely because the phone clock lags the relay by a fraction of a second. Foreground maintenance checks
account status, handles terminal disable/deletion and sets `relayRecoveryRequired` without showing prompts elsewhere.
Quota labels are fixed local words. Today's use shows only Your account today: N left and a local reset time;
network, whole-service and shorter-window budgets are behind More limits. Consent uses short everyday sentences;
retention/cleanup caveats live behind the settings row's Learn more instead of the turn-on screen. The API does not return configured maxima, so the app does not invent a total.

Private properties are `harness.relayGoogleClientId`, `harness.relayEmailLinkDomain` and
`harness.relayPrivacyContact`; their `HARNESS_RELAY_*` environment forms are documented in the Android README.
Debug-only properties are `harness.relayAuthEmulator`, `harness.relayFakeGoogle` and `harness.relayFakeFcm`.
The Auth emulator and both fake controls require the demo project. Release source sets have no emulator settings or
synthetic providers; APK DEX and merged-manifest checks assert that the hooks and debug build fields are absent.

Account sign-out removes this phone's receive keys and queues remote deletion before Firebase sign-out and Credential
Manager clearing. Turn off keeps the account. Account deletion requires recent authentication, explicit confirmation
and truthful pending/completed status; backend sign-in and project data are independent.

### Android relay plumbing (T96)

The emulator-first gate and remaining provider checks are tracked in [push relay acceptance](push-relay-acceptance.md).

D51: relay accounts and relay notifications are optional. The persisted Android relay switch defaults off,
including upgraded installs. Off keeps direct FCM registration and plaintext reception unchanged, without opening
relay storage, making relay requests or asking for an account. This task adds no UI or Firebase Auth dependency.
The APK pins `harness.pushRelayUrl` / `HARNESS_PUSH_RELAY_URL`; empty means unavailable. Only HTTPS is accepted,
except debug loopback/emulator-host HTTP. Messages and backends cannot choose a relay endpoint.

Relay state uses its own backup/transfer-excluded Keystore AES-256-GCM DataStore. Enrollment operations, staged
route secrets and ECDH keys, key confirmation, deletion retries, monotonic backend clock anchors, replay windows,
event dedupe and diagnostic counters survive process death. Key loss discards relay authority and requires explicit
opt-in again, never plaintext fallback. `relayRecoveryRequired` blocks reception and direct registration after key
loss until a deliberate transport choice; ordinary off/default installs do not have that marker. Retiring keys and
their replay windows expire together within thirteen hours, including monotonic retirement across wall-clock changes;
a reboot makes retiring keys and old clock anchors unusable.

`RelayBackendAdapter` reuses the existing backend socket only when both `fcm-relay-v1` and `device-auth-v1` are present
and the hello contains an actual signed-in session. The durable order is relay create, `registerRelay`, identity/HMAC
verification and key storage, relay activate, then `confirmRelay`. Registration retries keep their original preferences,
capabilities and operation ID. Wrong identity/HMAC or `unknown_request` aborts and queues deletion, never direct fallback.
Every agreement uses fresh `syncRelay.serverTime`, not a potentially old registration receipt. Midpoint anchors retain
round-trip uncertainty; over-twenty-second round trips are untrusted, and admission conservatively includes uncertainty
inside the five-minute skew boundary. Lease/preference changes and repaired token generations use `syncRelay`; backend
removal/session sign-out and push off queue unregister without waiting for network. Explicit off/on reuses the same
enrolled installation instead of consuming extra phone slots. Direct-mode backends keep today's FCM registration.

The pure receive router authenticates and admits durably before the existing parser/presenter; local route mapping
supplies the backend routing key. Relay-selected sessions reject plaintext downgrade, including after local route
removal. Off/sign-out removes receive authority immediately and queues remote cleanup. Debug-only shell delivery uses
the same router; `checkReleaseRelaySeam` verifies that its component/action is absent from the merged release manifest.
`RelayAccount` supplies only a current ID token or not-signed-in; Android composition deliberately supplies the latter
until the next task adds Firebase Auth. No authentication dependency, account prompt or notification screen is added.

D53 credential hashes use the frozen library digest (lowercase hex), not raw-bearer SHA-256. Account/quota DTOs preserve
safe scopes, budget names, reset times, switch flags and pending deletion state. All fixed rate/disabled/recent-auth
errors are typed; unknown text is discarded. `RelayAccounts.delete` persists one operation and erases local receive
keys/routes/replay state before HTTP. A 202 retains Retry-After; 200 deleted or subsequent 410 account_deleted completes
local deletion per D53. Ordinary account_deleted failures also erase receive authority. Account-disabled stops new
relay mutations and reception while retaining sign-in and a typed state for the later UI. Nothing silently selects FCM.


### Backend encrypted relay transport (T95)

Exact RPC/storage shapes and Android ordering: [backend relay v1 contract](push-relay-backend-v1.md).

`AIKI_PUSH_RELAY_ENDPOINT` in the existing private server settings is the operator-approved relay v1 base URL
(ending in `/v1/`). HTTPS is required; HTTP is allowed only on loopback for isolated tests. No admin/account
credential is accepted. Requests use octet-stream JSON, no-store, a deadline and redirect rejection. Without this
setting no relay store is opened, files written or feature advertised; direct FCM and Web Push remain unchanged.
D51: relay accounts and relay push are optional. Nothing outside Android notification settings requests them.

`fcm-relay-v1` requires device sign-in support. Only authenticated sessions may register/confirm/sync relay routes,
including in optional mode. Identity is the backend's stable ID and authenticated session, never caller labels.
`notifications.registerRelay` persists an operation receipt and pending derived keys before replying with the backend
public key, transcript confirmation, backend/session IDs and server time. `notifications.confirmRelay` validates the
phone confirmation before activating. `notifications.syncRelay` updates preferences/lease or unregisters. Existing
unregister/test/device requests also work with the server-returned device ID. Configuration and device reads expose
only safe status. Sync replies provide a fresh server-time anchor after an old registration receipt. Terminal route
errors pause new sends until the phone repairs the relay and explicitly syncs `resume:true`; counter inconsistency
requires new keys instead. Neither path drains an old outbox. The phone activates its relay route before confirming the backend; a successor replaces, never
adds to, a session's active transport. An active relay selection suppresses old direct rows durably even across a
crash between files. Replacement removes old queued messages rather than replaying historical events.

Backend-owned mode-0600 `notifications/push-relay.json` contains pending/active routes, operation receipts, public
transcript material, purpose-separated derived keys, capabilities, counters, exact encrypted send outboxes and
delete-only outboxes. `push-relay-counters.json` is an independent high-water witness; counter disagreement fails
closed to new encryption and requires fresh keys. A coherent rollback of both files cannot be detected by local
storage alone; backup restoration must use fresh routes/keys. Neither file belongs in exports/support bundles.
Writes are serialized atomic private-file replacements following the existing stores; sequence allocation is durable
before encryption and exact envelope bytes are durable before sending. Retries never re-encrypt. Event IDs are
random and stable for a held event and its retries. Existing Notifier policy runs first; retries re-check session,
preferences, quiet hours and archive state. No relay failure falls back to direct FCM or plaintext.

Send retries start at five seconds, use exponential jitter capped at fifteen minutes, respect Retry-After and stop
at message/route expiry (at most twelve hours). A route holds at most 100 messages; the newest event is dropped at
capacity. Accepted events are removed durably. Terminal responses stop the message and retain safe delivery status;
acceptance is never described as delivery. Revoke/expiry/unregister cancels local sends immediately and atomically
replaces route secrets/keys with delete-only work before dropping direct notification rows. Delete retries survive
restart, do not require a live session, and erase the delete capability after 204 or absolute expiry plus 24 hours
(the relay's purge horizon). Wrong-secret 404 keeps retrying until that horizon. Receipts and revoked status expire
at absolute expiry plus 24 hours, or ten-minute pending expiry plus 24 hours for never-activated operations. A bounded
24-hour `cleanup_expired` diagnosis distinguishes expiry completion from confirmed deletion after secrets are erased.
Safe status distinguishes local revoke with cleanup pending from completed cleanup. Already handed-off pushes cannot
be recalled.

### Encrypted relay v1 library (T92)

Relay accounts and relay push are optional (D51): Kemiri works fully without either, and
nothing here is used unless the user turns relay notifications on. This is library code
only; neither the running server nor the Android app calls it yet.
`packages/protocol/src/push-relay.ts` and Android notifications' `relay` package freeze the
P-256/HKDF-SHA-256/AES-256-GCM format from the relay design. The single shared fixture is
`packages/protocol/test-vectors/push-relay-v1.json`; regenerate/check with
`bun scripts/generate-push-relay-vectors.ts [--check]`. Encoding details and integration API
requirements are in [the frozen v1 reference](push-relay-v1.md).

Envelope and plaintext wrapper JSON are compact, with the documented field order; binary
strings are canonical unpadded base64url. The authenticated payload is an opaque JSON object:
receivers preserve unknown fields/kinds and allow arbitrary JSON number/escape formatting.
The existing app payload parser, not the crypto wrapper, decides what can be displayed.
Plaintext is UTF-8 JSON followed by ASCII spaces to the next 256-byte boundary
(no extra bucket at an exact boundary), at most 2,048 bytes including padding. JSON ends
with `}`, so padding is unambiguous. Times are nonnegative safe-integer Unix milliseconds;
sequences are canonical unsigned 64-bit decimal strings. IDs are 16 bytes; salts/secrets
32 bytes. Credential hashes are SHA-256 of compact JSON `["aiki-push-v1","credential",bearer]`.
Identity strings are at most 128 UTF-8 bytes, routing fields/tag 128, title 256 and `at` 64.
Oversized previews lose complete Unicode code points until they fit; oversized other payload
fields produce an encrypted “Open the app” payload. Invalid/overlong optional routing is
removed, never truncated into a different ID; overlong backend-local routing becomes empty.
Backend/session identity itself cannot be truncated and raises a typed oversize error.

Encrypt once and durably store the returned envelope for retry; the production encrypt API
has no nonce argument. Test-only nonce injection lives outside the package entry point.
Receive code must supply trusted backend time (offset anchored to monotonic time), validate
local route/session identity, and durably persist admission state before display. Uncertain
clock state fails closed. Admission state is per backend/session, with a window per key and
cross-key event dedupe; storage, concurrency, key retirement and monotonic-time acquisition
belong to the later integration task, not this library. Keys must rotate before a restored
counter can repeat a sequence. A persistence failure must not display a notification.

### Firebase relay package (T93–T94, T101)

Before any real-project use, follow the [operator checklist](push-relay-operator-checklist.md):
private facts, operator-only setup, live acceptance and three-backend rollout/rollback. Nothing there authorizes deployment.
[relay/DEPLOY.md](../relay/DEPLOY.md) supplies the operator-only procedure, least-privilege IAM starting plan, private
Functions parameters, sole/shared database rules/indexes, alerts/provider shutdown, retention and rollback. Every real
permission, quota, ingress, provider and release-device result remains a live acceptance gate; the agent never logs in or deploys.

`relay/` is an isolated TypeScript/Bun package outside the root workspaces, with its own dependencies/lockfile,
Node 22 v2 HTTPS function, TTL/index configuration and strict local validators. All twelve collection IDs are `relay`-prefixed
(including accounts/installations/challenges/routes/attempts/counters/cleanup/revocations); no unprefixed application data
is touched. A deploy-time database ID defaults to `(default)` and can select a dedicated named database. Sole-use rules
are deny-all; shared databases retain their existing policy and merge exact guarded collection blocks. False denies
cannot override a broad allow. The local deploy-config generator preserves unrelated shared indexes and omits shared rules.
It implements verified-account phone enrollment/FCM possession challenges, generation-safe token replacement,
installation inventory/removal, pending/active routes with bounded capacity and leases, independent send/delete
capabilities and digest-reserved encrypted sends/status. The pure core injects Auth, Firestore, sender, clock,
randomness and App Check monitoring. Production wiring uses ADC; emulator flags cannot enable a production bypass.
A relay account and relay push are optional (D51): Kemiri works fully without either.

`relay/README.md` has the exact scrubbed `demo-` emulator recipe and API/storage contracts. Tests call the core
against Auth/Firestore emulators and smoke-test the actual Functions emulator over HTTP with loopback fake FCM.
A successful user/network-namespace run proves cached execution works without outbound networking. Relay tests
have explicit `.cases.ts` names so root tests/typecheck need neither relay dependencies nor Java.
The checks deploy nothing. A standalone `demo:stack` builds and runs loopback Auth/Firestore/Functions/fake FCM without
a test process, emits endpoint/PID JSON and private capture JSONL/polling, and stops on signals or a bounded deadline.
Per-port config/function/HOME isolation supports concurrent stacks; the default range stays 19371–19377.
T94 adds transactional route/account/IP/global budgets, kill/enrollment
switches, durable leased account disable/deletion, recent-auth account deletion and hourly Auth/expiry reconciliation.
All numeric ceilings are tunable in `relayControl/settings`; defaults match the pilot table. Missing settings or
boolean fields mean **disabled/closed**. Fresh deployment stays paused; tests/demo explicitly opt in, and the operator
seeds paused control before deploying a reachable function. Minute/hour windows are fixed
UTC-aligned counters: N per aligned window, at most 2N in an arbitrary rolling window (documented approximation).
A bounded coarse IP reservation precedes costly proof lookups and is refunded for new external sends; deletion remains
available with budgets exhausted. Source-IP buckets use a daily rotating HMAC key and expire logically at UTC midnight.
Global/IP daily use survives account deletion. Application logs contain no identities, bodies or IP addresses.

Operator actions are plain tested core functions behind one CLI: explicit `--emulator` re-execs scrubbed/demo/loopback;
operator-only `--project <id> --confirm-real-project` uses their ADC and refuses every emulator variable. Every command,
including status reads, needs `--yes`; a dry run initializes no SDK/ADC/network. Status exposes only switches, limits,
reserved capacity and today's global aggregates. Account/phone targets and provider errors are never echoed. Lost/disabled
account `delete` uses the same durable cascade including Auth deletion; `admin.ts` is an alias, not an alternate unsafe path.
There is no operator HTTP endpoint. Both exports share region/runtime-SA/database parameters; HTTP maximum instances
is parameterized (default two), while hourly repair remains bounded at one. Real IAM is not proven by the emulator.
Account markers block immediately, before Auth/cascade work; phase checkpoints and leases make outages retryable.
Deletion completion is returned only after relay/Auth erasure. D53 also treats 410 `account_deleted` after a delete
request as complete for the phone: routes, tokens, challenges, attempts and UID counters are erased before Auth is
deleted; reconciliation finishes any final account/cleanup/capacity markers. Reconciliation also scrubs expired rows,
orphan ownership and stale capacity maps.

D52 uses JSON bytes with `application/octet-stream`, leaving body caps/parsing
and fixed no-store responses inside our handler. Malformed non-protocol `application/json` still hits the upstream
framework's parser/logs; real clients never use that media type. Absent-route delete is indefinitely idempotent 204
with a well-formed delete bearer; no delete credential tombstones remain. Secret-free revocation markers only prevent
stale create retries from reviving authority. Transient sends retain retry times/Retry-After and the same digest;
accepted/token-invalid alone are terminal. A new challenge operation atomically replaces the old pending challenge.
Typed Firestore converters and concern-separated source/tests document each transaction guarantee. The emulator
meters 20 reads/10 writes for one accepted send, 31 reads/21 writes/1 delete for first enrollment, and 33 reads/13 writes/
9 deletes for deletion of a one-phone/one-route/one-attempt account; these supersede the design's 6+6 send estimate.
The trusted-IP adapter uses only the direct Google front end's appended X-Forwarded-For address; verify the actual
project's ingress suffix before enabling IP limits. README maps the in-scope design acceptance items to tests.
D53 aligns credential digests with frozen T92: SHA-256 of UTF-8 compact JSON
`["aiki-push-v1","credential",bearer]`, lowercase hex at route creation. The send envelope is the canonical serialized
JSON string, with 256-byte padded ciphertext plus its 16-byte tag (272–2,064 bytes). Relay checks read the shared
vectors only as test data: all 22 positive envelopes, both bearer/hash vectors and 21 applicable negatives agree.
They explicitly classify 39 key-dependent or non-relay cases; production imports no package code or fixtures.
The incoming T99 server change resolves D53's flat-error parser and overstrong physical-purge wording findings.
Integration cases use real Functions HTTP and isolated createSetup backends; explicit enabled control seeding, prefixed
storage and missing-control pause/deletion remain covered after T101. The [acceptance record](push-relay-acceptance.md)
now counts 76 locally proven / 27 needs-real-project / zero not-covered items. Auth sign-up/MAU/email-volume alerts and
provider shutdown are operator configuration/drills in DEPLOY.md/checklist, never relabeled as local provider proof.

### Existing notification transports

Web Push, behind one server-side `Notifier` that every event source calls: the activity watch (a reply, a failed
compaction), the worker reporter, the schedule runner, the deploy status, the login prompts and memory maintenance.
APNs/FCM would replace the transport, not the interface.
Web notification enablement explains a push-service `AbortError` with Brave’s “Use Google services for push messaging”
setting, restart and retry steps; the raw error remains a small secondary detail. Other errors are unchanged.

- **Android goes through FCM.** The Android app has no Web Push, so it registers its Firebase Cloud Messaging token
  with `notifications.registerFcm` (feature `fcm-push`) and the backend sends the same payload as FCM data through the
  HTTP v1 API (`packages/server/src/fcm.ts`). Kinds, quiet hours, mutes, the hold, dedupe and `lastDelivery` are the
  Web Push ones; only the last hop differs. The backend signs in with a service-account key of the app's Firebase
  project, `<data>/notifications/fcm-service-account.json` or `AIKI_FCM_KEY_FILE`, mode 0600, never committed;
  without it FCM is off (said once at start), FCM devices stay registered, and `notifications.config` answers
  `fcm: null` so the app can say why nothing arrives. Messages are data-only and high priority: the app draws the
  notification itself (channel per kind, tap opens the payload's route).

- **Independent VAPID keys and subscriptions per backend.** Web push needs no relay account. Per D51, a relay
  account is optional and only used for Android relay notifications. Each backend generates and persists its own pair at
  `<data>/notifications/vapid.json` (0600); malformed existing files fail rather than rotate. `AIKI_VAPID_KEY_FILE`
  and `AIKI_VAPID_SUBJECT` remain operator overrides. Only the public key reaches the authenticated app. A browser
  holds one subscription per service-worker registration: independent backends use push-only workers at
  `/push/<opaque-id>/`, served by `/push-worker.js`, separate from the root app-shell worker. They do not fetch,
  cache app resources or claim pages. Permission remains origin-wide and is requested from a user gesture.
  **Legacy exception:** backends matching an existing root subscription keep using it without re-subscribing or
  moving scopes. The operator's shared-key deploy is unchanged. Root is unsubscribed only after its last user is
  removed or explicitly disabled; no upgrade rotates keys. A changed backend key requires an explicit per-backend
  re-subscribe, never touching another backend's subscription. Backend removal removes its scoped registration;
  stale registrations are pruned and new scoped registrations are capped at 24. Browser-specific limits may be lower.
  On an explicit fresh enable, a same-key group may share a new root subscription too; distinct keys use their own scopes.
  Removing an unreachable legacy backend cannot remove its remote row while another backend still uses root: remove
  it while reachable, or revoke its device session there, to stop that backend’s remaining pushes.
  Both workers mark subscription changes as sync-needed, without opening anonymous sockets or storing auth tokens.
  A signed-in page repairs only the affected scope and backend rows; settings explain that reopening may be needed.
- **The backend decides, the device only stores.** Each backend keeps the devices registered with it (subscription,
  label, what the device calls that backend, preferences) and pushes its own events; nothing is synced between
  backends. A payload carries the device's name for that backend, so a deep link lands on the right one.
- **No duplicate notifications.** Events carry a dedupe key (`reply:<project>:<entry>`, `deploy:<commit>:<attempt>`,
  `schedule:<project>:<schedule>:<due time>:<outcome>`, `compaction:<project>:<task>`, …) and the keys are persisted,
  so a restart that replays a watch, re-reads a deploy status or resumes a reporter notifies nothing twice. The
  activity file is the other half: the last reply it recorded is not a new reply.
- **Held while the app is open; dropped when it is used.** (Decision D20; replaces the old "a visible connection on a
  project silences that project" rule, which let an idle open tab silence pushes for good.) See "Holding while the app
  is open" below. Quiet hours, mutes, kinds and dedupe are unchanged and still apply.
- **Archived projects are silent.** An event of an archived project is dropped (see "Archiving projects").
- **Never in the caller's path.** A push is fire and forget: a failure is recorded as the device's `lastDelivery` and
  logged, a 404/410 subscription is dropped, and nothing a push service does reaches the code that produced the event.

### Holding while the app is open

The user's rule: with the app open, a system notification is only worth sending if 15 s pass after the event with no
interaction; an interaction in that time means they are using the app and a notification would repeat what is on screen.

- **"Open"** is a visible connection: a web tab with `visibilityState === "visible"`, or the Android app in the foreground,
  on any device, showing any project. Each connection reports it with `notifications.presence { visible }` (the project
  field is still sent and no longer used). The server keeps one entry per socket and forgets it when the socket closes. A
  connection that never reported (an older app) is not known to be open.
- **Hold.** When an event happens and at least one connection is visible, the `Notifier` does not push: it keeps the event
  for `NOTIFICATION_HOLD_MS` (15 s, `packages/protocol/src/notifications.ts`; tests override it with the server option
  `notifications.holdMs` and a fake timer `notifications.schedule`) and pushes it when the time is up. No visible
  connection means no hold: the push goes out at once, as before. Each event times from its own moment; the payload's `at`
  is the event's time, not the push's.
- **Drop.** An interaction on **any** device drops **every** event the backend is holding, for every device. Dropped events
  have claimed their dedupe key (the claim is the first thing `deliver` does), so they never fire later, not even after a
  restart or when the watch replays them. Only events held at that moment are dropped; an event that happens afterwards
  is held anew.
- **Hold ends, then filter.** Kinds, mutes, archived projects and quiet hours are read when the push is sent (a mute set
  during the hold applies), and an event no device would receive is not held at all (nothing is written down for it).
  Archived projects are dropped before the hold, as before. Test pushes (`notifications.test`) are never held.
- **The page going hidden, or the socket closing, during the hold changes nothing**: the event is still pushed at 15 s
  unless someone interacted. (Someone who closes the tab and walks away is exactly who needs the push.)
- **Where it lives: in the `Notifier`, per backend.** Every event source already calls one `Notifier`, so a hold in front
  of it would have to be in every caller; inside it the key claim, the filters and the held list sit next to each other.
  Backends do not talk to each other (each pushes its own events and keeps its own devices), so **interaction has to
  reach every backend**: the clients report it to every backend they are connected to, not only the one on screen. The web
  app connects to every backend it knows, and so does the Android app (`HarnessRepository` opens a client per backend,
  `NotificationCenter.watch` runs on each). A backend that is unreachable at that moment cannot hear it; it holds and
  pushes at 15 s, which is the safe side.
- **Protocol** (feature `notification-hold`): `notifications.interaction { deviceId }` -> `{ dropped }`. Clients send it
  only to a backend whose hello lists the feature, and only after interaction. Throttled by the client
  (`INTERACTION_REPORT_INTERVAL_MS`, 5 s): the first interaction goes out at once, interaction inside the next 5 s becomes
  one trailing message at its end, so continuous use costs one small message per backend every 5 s and idleness costs
  nothing. The reporting delay (at most 5 s) is well inside the 15 s hold. The server counts the time it receives the
  message; it needs no timestamp from the client. A `lastInteractionAt` on the presence message was not chosen: presence
  is deduplicated and sent on changes, so it would need a second, throttled path anyway.
- **What counts as interaction** (web `apps/web/src/lib/interaction.ts`, Android `MainActivity` + the composer): a pointer
  press, a key, a touch start or move, the wheel, and typing in the composer (`input`; on Android the field's
  `onValueChange`, because soft-keyboard text never reaches `dispatchKeyEvent`). A mouse move alone does not count: a
  mouse nudged on a desk, or resting while someone reads, says nothing about the user. A `scroll` event does not count
  either: the transcript scrolls itself while a reply streams, which would drop the very notification of that reply;
  user scrolling shows up as wheel, touch move or key presses. Synthetic events (`isTrusted` false) are ignored.
- **Old clients and old backends.** A client that reports presence but never interaction (an app from before this) is an
  open app nobody touches: its backend holds and pushes at 15 s. A backend without the feature gets no interaction
  messages and applies its own old rule (a visible connection on a project silences it); the apps no longer drop a push
  on the device because the project is on screen, so a hold that ran out is always drawn. The web now reports presence
  from a browser that has no push subscription too: a tab you are using counts as open even though it is not a
  notification device.
- **Restarts: held events are persisted and carried on.** Each held event is written to `state.json` (`held`: the event,
  its time and when the hold ends) and removed when pushed or dropped. At start `Notifier.restore()` re-arms them: an
  event whose time ran out while the server was down is pushed at once; the others wait the rest of their time. This
  beats pushing everything at restart, because a deploy restarts the backend while someone is probably watching the app:
  the clients reconnect within seconds and can still drop the events with an interaction. Interaction during the downtime
  is lost (the clients cannot reach the backend), so an event can still be pushed that the user saw; that is the cost of
  not losing events. A graceful stop cancels the timers and leaves the entries in the file.
- **Tests:** `packages/server/test/notification-hold.test.ts` (fake clock: no connection pushes at once; visible, no
  interaction pushes at 15 s; interaction at 5 s drops it and keeps the key; interaction from another device drops every
  device's; hidden or closed during the hold still pushes; quiet hours, mutes and kinds; restart cases),
  `notifications.test.ts` (over the wire with a short hold), `apps/web/test/interaction.test.ts`, the Android
  `InteractionReporterTest`.

## Stack

- Web: SvelteKit in SPA mode (`adapter-static`, `ssr = false`), built
  with Vite and served by Caddy, separately from every backend. Bun
  (`Bun.serve`) on a backend serves the WebSocket and runs the Harness;
  it serves no web app. The browser applies the server's Chord ops with
  `@earendil-works/chord/delta`.

- TypeScript on Bun. No Nix flake for now.
- `@earendil-works/pi-durable` is experimental; pin its exact version.
- Bun 1.4.2 on the host provides `node:sqlite`, so the Node SQLite
  storage may work as is. Not verified yet.

## Goal

- Replace pi eventually.
