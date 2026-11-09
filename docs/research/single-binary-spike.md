# Single-binary server spike (T56)

2026-11-09. Parent: `smvvrlko` / `7086d04a`. Bun **1.4.4** (`38afee6c8`), Linux x64/NixOS.
Read [sharing the app, option C](sharing-the-app.md) and [Bun executable docs](https://bun.com/docs/compiler/executables).

## Verdict

**Works with fixes**, not a release-ready binary today. An ordinary `bun build --compile` starts the backend, opens SQLite, speaks the WebSocket protocol and runs a faux worker without a checkout. Embedding the static web build also works. QuickJS, Photon and variable provider imports need explicit packaging; the scratch fixes proved those paths without sending a provider request.

**Recommend pinned Bun + a versioned server/web archive for the first installer.** Keep the binary as the next packaging step, not a reason to delay onboarding. A Node fallback is feasible but **not implemented** and not just a different build target: allow **4–6 engineering days without terminals, 6–10 with terminal parity**. Do not advertise it as an installer fallback until it passes the same acceptance tests.

Only this document and the continuation note ship. The prototype uses build-time source rewrites, hard-coded package-version paths and an in-process image fallback; these are useful experimental evidence, not production code. No bookmark movement, push, deploy, service control or live-data access.

Evidence on T56:

- `mw9tju1a-728ffb8c61`: concise verification log, including same-origin UI load.
- `mw9tju1v-abe347f5f6`: **13 KiB source/log archive**, with build, faux/provider/asset probes, isolated launch script, exact per-call Bun API inventory and measurements. No binaries or credentials.

## Build and isolation

Started with `jj new main`, then `bun install`, as requested. Built `apps/web` with `bun run build`; adapter-static emitted **443 files**, **13,164,057 bytes including directory entries**. The real entry is `packages/server/src/main.ts`, which resolves environment paths and calls `startServer()` in `server.ts`. The library `index.ts` is not the process entry.

Baseline:

```sh
bun build --compile --target=bun-linux-x64 \
  packages/server/src/main.ts --outfile .preview/t56/harness-plain
```

Baseline compiled **1,395 modules** in 97 ms bundling + 434 ms compilation. No minify, bytecode or AOT tuning was attempted. These build timings are observations from one run, not benchmarks.

For the web prototype, a Bun build plugin:

1. Generates one `with { type: "file" }` import for each built web file, retaining an exact URL→embedded-file map. This embeds `.js` as **assets**, not executable server modules. No flattening of hashed Svelte paths.
2. Adds static serving **after** `/ws` and `/artifacts/`, only when `MIHAI_HARNESS_SERVE_WEB=embedded`. Unset retains today's API-only 404. GET/HEAD and SPA `200.html` fallback are enough for this experiment; missing file-like URLs return 404.
3. Returns an empty `/backends.json` instead of the operator's published backends. A release must omit that personal file **at build time**, not merely shadow its route.

Every run used a fresh `/tmp/t56-*` root for **data, config, agent, Claude and HOME**; port chosen on loopback. Browser origins were explicitly set to that same loopback origin. All background processes were launched with `setsid -f … < /dev/null`, bounded by `timeout`, and stopped by saved PID. No real keys, OAuth flow, provider request, push subscription or network-enabled schedule was used. Faux scripts are compiled only into separate test executables, never a hidden production environment switch.

To reproduce from the source/log artifact, extract it at the repo root, build the web app, then:

```sh
bun run .preview/t56/build.ts bun-linux-x64 \
  packages/server/src/main.ts .preview/t56/harness-web
T56_FIXED=1 bun run .preview/t56/build.ts bun-linux-x64 \
  packages/server/src/main.ts .preview/t56/harness-fixed
python3 .preview/t56/launch.py fixed .preview/t56/harness-fixed
# This prints the owned PID, temp root and URL; stop that PID after checking.
```

The script pins installed package paths from this lockfile; regenerate them if dependencies change. `T56_FIXED=1` adds the explicit assets/worker/provider fixes below. This is a scratch build option, not a supported server flag.

## What ran

| Check | Result |
| --- | --- |
| Unmodified compiled entry starts outside checkout CWD | Yes; loopback listener, fresh temp state. HTTP `/` remains 404 by design. There is no dedicated HTTP `/health`; health here is WebSocket `hello` + `server.status`. |
| Same-origin static UI | Fixed production-entry binary: `GET /` **200**, `text/html`, **6,418 bytes**; SPA deep-link fallback **200**; `/backends.json` **200**, empty list; `/ws` without upgrade **426**. No Vite or Caddy process. |
| Browser actually loads it | Headless Chromium on compiled **faux** entry: 69 response/WebSocket events, all loopback, **0 JS runtime exceptions**, connected at the page's own `ws://…/ws`; project and Faux Model visible. LocalStorage backend selection was seeded explicitly; automatic same-origin discovery/onboarding is not implemented. |
| Protocol/project persistence | On plain and web executables: `hello` v1, `server.status`, `projects.add`, `projects.list`, `conversation.watch` pass. Project changes closed→open on watch. |
| SQLite | Request log, global/project memory indexes, per-project session DB created. Read-only `PRAGMA quick_check` returns **ok** for all those files in plain/web/faux temp roots. Request log: 6 tables; memory index: 8; durable session: 9. `node:sqlite` also works inside the compiled Bun runtime. |
| Harness worker | Compiled faux coordinator calls real `worker_spawn`, shared checkout isolation. Worker runs, reports `Outcome: done`, reaches idle with `failure:null`. Harness workers are durable conversations, **not OS worker entrypoint files**. jj workspace isolation was not exercised; it still requires external jj. |
| Codemode before fixes | Real tool fails gracefully: cannot resolve `quickjs-wasi/quickjs.wasm`. |
| Codemode after fixes | Embedded QuickJS + explicit worker entrypoint: direct script returns **42**; real coordinator codemode calls `tools.read` on README and returns `{text:"# Single binary test\n",sum:42}`. |
| Photon before fixes | Default image worker is not bundled; its fallback cannot resolve `@silvia-odwyer/photon/photon_rs_bg.wasm`. |
| Photon after fixes | Embedded WASM and in-process factory decode a valid PNG and resize **4×4→2×2**, returning image/png. This proves image processing, not just successful WASM instantiation. Off-thread image-worker packaging is still outstanding. |
| Lazy providers | `opencode-go`, `anthropic`, `openai`, `openai-codex` each reach their real lazy SDK implementation's `onPayload`, which throws locally before send. Fake API keys / synthetic non-expired OAuth token only. Global fetch rejects all calls; **0 fetches**. This does not prove successful remote inference/auth. |
| OAuth/Bedrock | Variable module imports fail in baseline. Static `registerBunOAuthFlows()` makes Anthropic OAuth **load**, without login. Static Bedrock override makes its SDK load and reach the rejecting payload hook; Bedrock is not a harness default provider. Other OAuth flows are bundled by the helper but not individually exercised. |
| Missing zellij | With `MIHAI_HARNESS_ZELLIJ=/nonexistent`, `terminal.list` returns `available:false`, actionable install guidance, `survivesRestart:false`, no sessions. Backend stays healthy. A real PTY/zellij session was not opened. |

## Sizes, startup and cross-compilation

Sizes are uncompressed file bytes; MiB = 1,048,576 bytes.

| Executable | Bytes | MiB | Run? |
| --- | ---: | ---: | --- |
| Linux x64, unmodified server | 114,170,032 | 108.88 | Yes |
| Linux x64, web embedded | 127,453,360 | 121.55 | Yes |
| Linux x64, web + asset/provider fixes, production entry | 131,471,536 | 125.38 | Yes |
| Linux x64, fixed faux entry | 131,487,920 | 125.40 | Yes |
| `bun-darwin-arm64`, same fixed production build | 111,665,762 | 106.49 | **Compile only**, Mach-O ARM64 |
| `bun-linux-arm64`, same fixed production build | 131,517,432 | 125.42 | **Compile only**, ELF AArch64 |

Five warm fixed-production launches to a TCP listener: **273.9, 276.9, 271.5, 266.1, 271.2 ms**, median **271.5 ms**. Includes the Python/setsid/timeout launcher and 5 ms polling; fresh temp state each time. Plain/web one-off launches were about **210 ms**. Not cold-disk, remote-machine, first model request or memory measurements.

**Important Nix portability trap:** the x64 compiler reused this host's runtime. Its ELF interpreter is `/nix/store/pqyiidz5mi73wv5f91d48s9plcqyj5bz-glibc-2.44-57/lib/ld-linux-x86-64.so.2`, not `/lib64/ld-linux-x86-64.so.2`. Do **not** distribute this artifact to ordinary Linux. `readelf` also lists libc, ld-linux, pthread, dl and m. Build releases with a stock/pinned runtime on generic CI (or explicitly supply that runtime to the compiler); verify the ELF interpreter and libc floor on a clean machine. The downloaded ARM64 target has the ordinary `/lib/ld-linux-aarch64.so.1` interpreter. Neither cross-target result establishes native runtime correctness, signing or supported libc versions. Musl/Windows were not tested.

## Packaging fixes and remaining work

Estimates are engineering days for someone familiar with this repo, not promises; rows overlap. Allow roughly **3–5 days** to turn this scratch build into a tested Linux binary release, **5–9 days** for a qualified Linux/macOS matrix, excluding the sharing/auth work.

| Issue / cause | Scratch fix or next step | Effort remaining |
| --- | --- | ---: |
| Web is deployed separately today | Explicit asset manifest and flag-guarded serving work. Replace source rewrite with tested server/build modules; MIME, deep links, cache headers, service-worker upgrades, missing assets, security/path handling, neutral backend list and first-run origin wiring. | 0.5–1 day |
| QuickJS resolves a package at runtime and derives worker path from `import.meta.url` | Embed `quickjs.wasm`, pass it through the existing sandbox `wasm` option; supply `workerUrl` and add a worker wrapper as an explicit compiler entrypoint. Both proven via scratch rewrites of equivalent upstream defaults. No QuickJS native addon needed. | 0.5 day incl. cancellation/restart tests |
| Photon derives worker path and uses `createRequire().resolve()` for WASM | Embed Photon WASM. Existing `createPhotonImages(bytes)` works. Prototype deliberately runs it on host thread; large images would block the coordinator. Package an explicit image worker and pass embedded bytes/path, likely a small upstream factory option. | 0.5–1 day |
| Variable provider/OAuth imports escape bundler | Harness's literal lazy SDK imports work unchanged. Existing pi-ai `registerBunOAuthFlows()` and Bedrock `setBedrockProviderModule()` hooks solve known variable imports. Register in binary entry, do not rewrite dependencies in release builds. No real OAuth round trip tested. | 0.25–0.5 day |
| `import.meta.dir` release lookup becomes `/$bunfs/root` | Gracefully reports release/deploy **null** today; no startup failure. Embed release metadata explicitly, disable personal deploy-root discovery for generic installs. | 0.25 day |
| Host-runtime/libc and cross-OS behavior | Stock-runtime CI builds; clean-host smoke tests of SQLite, worker/WASM, filesystem, signals, host tools and missing tools. macOS signing/notarization remains separate release work. | 1–3 days plus platform access |
| External tools | git/jj, zellij, ffprobe and project toolchains do not become embedded. Add doctor/readiness checks and limited-mode explanations. Missing zellij already degrades correctly. | 0.5–1 day |

This spike did **not** implement an installer, auto-update/rollback, service lifecycle, authentication, portable first-run defaults or a licence audit. Same-origin hosting is not authentication. Preserve loopback-only defaults; [sharing-the-app.md's security gate](sharing-the-app.md#security-gate-before-sharing-remotely) still applies before remote access.

## Node fallback

### Actual build result and limits

```sh
bun build --target=node packages/server/src/main.ts \
  --outfile .preview/t56/server-node.mjs
```

**Build succeeds:** 1,430 modules, **5.37 MB** JS bundle, about 100 ms. That output still has `import { Database } from "bun:sqlite"` and runtime `Bun.*` calls: transpiling is not porting. Expected first Node load failure is an unsupported `bun:` module scheme, before `main` runs. Removing just that import would then expose `Bun.serve` and other call sites.

**No Node process was run:** this repo's agent instruction requires Bun for running code. A Node 24 executable is present on the host, but using it would violate that constraint. The loader failure above is therefore a static conclusion, **not** a claimed Node execution result. No Node implementation or Node 22 compatibility test is delivered.

Choose **Node >=22.19.0**, not an unspecified early Node 22: pi-ai's current engine floor is 22.19 and `node:sqlite` availability/stability differs across early 22 releases. Shipping prebuilt JS avoids Node's TypeScript-stripping/version/import-extension issues.

### Production API inventory

Counts are **source occurrences**, not runtime frequency. Scope: tracked `packages/server/src/**/*.ts`, excluding comments and type-only declarations from runtime-call totals. Existing client/protocol source has **zero** Bun API occurrences. Full line-by-line inventory and the counting script are in the source/log artifact.

There are **15 Bun global call sites**, **1 Bun SQLite import**, **1 Bun-only path property**, plus **2 type references**:

| API | Count | Where (relative to `packages/server/src/`) | Node replacement |
| --- | ---: | --- | --- |
| `Bun.serve` | 1 | `server.ts:588` | `node:http` + `ws`, retaining the existing ClientConnection transport boundary. Preserve Origin checks, binary frames, 32 MiB limit, close/stop/drain semantics and HTTP/artifact responses. `server.upgrade`, server port/stop and socket send/close calls are covered by this one listener integration. |
| `bun:sqlite` | 1 | `request-log-store.ts:8` | Prefer `node:sqlite` DatabaseSync: already used elsewhere. Adapt `query`→`prepare`, named-parameter conventions and explicit transactions; preserve WAL/busy timeout, return types and schema behavior. |
| `Bun.spawn` | 4 | `artifacts.ts:169`, `memory.ts:412`, `terminals.ts:254,528` | `node:child_process.spawn` for ffprobe/git/probes. The last site uses **Bun's PTY terminal option**, not an ordinary subprocess; see below. |
| `Bun.which` | 5 | `artifacts.ts:166`, `terminals.ts:173,174,309,416` | Small PATH/executable lookup adapter, or a dependency such as `which`; retain explicit HOME/PATH behavior. |
| `Bun.file` | 2 | `artifacts.ts:594`, `sidebar-attention-migration.ts:12` | fs stat/access + streams. Artifacts use exists, size, slice and Response bodies: preserve HEAD, byte ranges, content length and streaming rather than reading 2 GiB into RAM. |
| `Bun.write` | 1 | `terminals.ts:229` | `fs.promises.writeFile`. |
| `Bun.sleep` | 1 | `terminals.ts:410` | `node:timers/promises.setTimeout`. |
| `Bun.hash` | 1 | `prompt-fingerprint.ts:42` | Explicit stable shared hash, e.g. crypto SHA-256. Do not silently mix old/new persisted prompt fingerprints: version or invalidate derived comparison state so cache-keep-warm/cache stats do not invent continuity. |
| `import.meta.dir` | 1 | `server-status.ts:53` | `dirname(fileURLToPath(import.meta.url))`, or Node's `import.meta.dirname`; release root should be explicit in bundles anyway. No production `__dirname`, `__filename` or `import.meta.path` occurrences. |
| `Bun.Subprocess` (types only) | 2 | `terminals.ts:252,501` | Own subprocess/PTY interfaces, not global Bun declarations in shared application code. |

Several heavy-looking components are **already portable**:

- `runtime.ts` opens `@earendil-works/pi-durable/storage/sqlite/node`; chord uses `node:sqlite`. `memory.ts` and `request-backfill.ts` directly use `node:sqlite`. Only the request-log store is Bun SQLite; replacing all storage with better-sqlite3 is unnecessary.
- `host-commands.ts` and `jj.ts` already use `node:child_process.execFile`.
- Photon and codemode use **`node:worker_threads`**, not Bun's global Worker. Their normal installed-package layout works on Node. A flattened Node bundle still needs explicit worker and WASM assets, just as the binary does. Keep these dependencies external with their published layout in a Node release archive, or build separate worker entries and ship a resource manifest.
- The three pi packages' published JS contains no direct `Bun.*` calls or `bun:` imports in this scan. Browser/network SDKs may detect Bun as an optional host; that is not a runtime requirement. Provider payload probes prove compiled loading only, not Node runtime success.

### Tests and developer tooling, separately

These do **not** make a friend's runtime depend on Bun. Keep Bun tests/builds in CI initially, then add a Node runtime smoke suite. `server/`, `client/`, `protocol/` below abbreviate each package's `test/`; `web/` abbreviates `apps/web/test/`.

| API | Count outside production | Where |
| --- | ---: | --- |
| `bun:test` | 130 imports | 53 server, 17 client, 3 protocol, 57 web test files. Includes expect/mock/timers/test hooks; no production import. |
| `Bun.Glob` | 1 | `server/artifacts.test.ts` |
| `Bun.file` | 4 | `server/threads.test.ts`, `server/workers.test.ts` ×2; `packages/server/scripts/terminal-survival.ts` |
| `Bun.serve` | 4 | `server/fcm.test.ts`, `server/notifications.test.ts` ×2, `server/subscription-usage.test.ts` |
| `Bun.sleep` | 18 | `client/earlier-paging.test.ts`, `client/terminal.test.ts`; `server/drain.test.ts` ×4, `sidebar-attention.test.ts`, `subscription-usage.test.ts` ×4, `task-waiting.test.ts` ×3, `terminals.test.ts` ×3; terminal-survival script |
| `Bun.spawn` | 4 | `server/schedules.test.ts`, `storage.test.ts`, `workers.test.ts`; `web/user-markdown.test.ts` |
| `Bun.spawnSync` | 1 | `server/memory.test.ts` |
| `Bun.which` | 5 | `client/terminal.test.ts` ×2, `server/terminals.test.ts` ×2; terminal-survival script |
| `Bun.write` | 5 | `server/fcm.test.ts`, `notification-hold.test.ts`, `sidebar-attention.test.ts`; `web/user-markdown.test.ts` ×2 |
| `Bun.build` | 1 | `web/user-markdown.test.ts` |
| `import.meta.dir` | 4 | `server/server-status.test.ts`; `web/user-markdown.test.ts` ×3 |

### Cleanest implementation and effort

Do **not** add a global `Bun` polyfill. Use a small runtime boundary for HTTP/WebSockets, process/PTY, streaming files and SQLite. Most application logic, protocol, models, durable storage and workers can stay unchanged. Prefer sharing portable implementations on both hosts where practical, with only the listener/PTY-specific pieces selected by the entrypoint.

| Work | Days |
| --- | ---: |
| Move request log to node:sqlite or a narrow sync-SQL interface; transaction/binding/BigInt/result parity tests | 0.5–1 |
| Node HTTP + ws listener adapter; Origin/version/error/binary/drain/reconnect/artifact tests | 1–1.5 |
| Non-PTY process/files/PATH/sleep/path/hash cleanup; cache-fingerprint migration | 0.5–1 |
| Node release archive with compiled JS, worker/WASM assets, engines/readiness checks; faux smoke tests on both runtimes | 1–1.5 |
| Hardening/restart/installer fallback selection margin | 0.5–1 |
| **Initial Node fallback, terminals explicitly disabled** | **4–6 total** |
| Add node-pty packaging and terminal readiness/parity tests | **+2–4** |
| **Node fallback with terminals** | **6–10 total** |

`better-sqlite3` is an alternative only if the required Node floor cannot support the built-in API: it adds a native-addon ABI/prebuild/rebuild matrix. It does not remove the existing node:sqlite usage in memory/backfill/chord, so it is not the cleanest first choice.

**PTY is the non-thin part.** `terminals.ts` uses `Bun.spawn({terminal:{…}})`, `.terminal.write/resize/close`, and **`.terminal.localFlags`** to wait for canonical→raw mode before delivering held keystrokes. `child_process` does not provide a PTY, and node-pty does not expose equivalent localFlags as a drop-in. Use node-pty plus a tested readiness strategy or a small termios/ioctl extension; preserve zellij first-input/restart behavior. Disabling terminals through the existing `terminals:false` option is the honest limited Node MVP, not pretending ordinary pipes are a terminal.

The installer should eventually select a verified OS/arch binary first, a pinned Bun archive second, and a **separately tested Node release archive** third. Never fall back by simply invoking today's source or this unported `--target=node` output with Node. Packaging choice does not remove the shared authentication, provider-policy and first-run work in the sharing study.
