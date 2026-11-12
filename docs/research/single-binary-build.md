# Single-binary builds (T72, part 1)

2026-11-12. Bun **1.4.4**, source parent `50bef7f5`. This implements the packaging fixes from
[the T56 spike](single-binary-spike.md); it does **not** switch the installer or update channel.

## Build and runtime contract

`bun scripts/build-binary.ts --version v0.0.0-test.72 --out .preview/releases` uses Bun's
`Bun.build({ compile: ... })` API (the same compiler as `bun build --compile`). It first reuses
`build-release.ts` to make a tracked-source, neutral-web archive in a clean staging tree, then
installs its frozen dependencies and compiles there. `--archive` can reuse that **trusted local**
source/web archive; the requested version must match. Never feed it an unverified download.

The builder replaces only Aiki's `packaged-resources.ts` boundary, not dependency source:

- Every built web file has an exact URL-to-embedded-file mapping. JavaScript is imported as a
  **file**, not evaluated as server code. Personal backend suggestions are excluded at build time.
  Existing static serving still provides fixed loopback host/origin checks, GET/HEAD, MIME types,
  SPA fallback, no-store shell/service workers and immutable hashed assets.
- QuickJS WASM and a separately bundled upstream codemode worker are file assets. The sandbox
  receives explicit `wasm` and `workerUrl` options. Cancellation stays in upstream's interruptible
  worker implementation; no in-process QuickJS fallback is used.
- Photon WASM and its separately bundled worker are file assets too. Images decode/resize off
  the coordinator thread, one at a time per processor, in disposable workers. No host-thread
  fallback or runtime package resolution is needed. Each request releases its WASM heap.
- OAuth flows register through `registerBunOAuthFlows`; Bedrock uses the current pi-ai
  `registerLazyBedrockProvider` literal-import hook. Other provider SDK imports remain bundled
  lazily. Release identity is embedded; generic binaries do not discover a personal deploy root.
- Nothing is extracted to a user-writable executable cache. The binary has no checkout,
  node_modules or Bun-on-PATH requirement. Bun's automatic dotenv/bunfig/tsconfig/package.json
  loading is disabled; Aiki's explicit private `server.env` loader remains unchanged.

The standalone entry supports `start` (also the default), `status`, `health-check`, `version`,
`--print-config`, `pair` and `auth`. Status/health use the existing owner socket to validate both
`hello` and `server.status`, including in required-auth mode. Default binding remains loopback;
new data still requires device sign-in. Pairing uses the existing owner-only grant path.

## Acceptance and CI

The production executable is copied outside the checkout and launched with `env -i`, explicit
fresh HOME/data/config/agent/Claude paths and USER. PATH contains only explicit git/sh links,
**not Bun**. `scripts/smoke-binary.py` prints those paths, waits on output events (no readiness
polling), bounds waits, and kills only its recorded process PID. Linux starts with `setsid -f`;
macOS uses Python's equivalent new-session spawn because it has no setsid utility.

The production check proves HTML/deep links, service workers, JS MIME/cache headers, HEAD,
neutral discovery, missing/hidden path rejection, foreign Host rejection, required auth,
ignored implicit dotenv, `aiki status`, owner health and version. A **separate, never-uploaded**
faux executable exercises a real coordinator codemode/read call, a shared worker and its report,
a runaway QuickJS timeout followed by successful execution/sandbox recreation, and Photon
BMP decode/4×4→2×2 resize/PNG encode. No credentials, real model requests or production test
switch are involved. Root tests also retain the existing durable codemode restart coverage.

The release workflow adds native builds/smokes on standard `ubuntu-24.04` (x64 baseline),
`ubuntu-24.04-arm` and `macos-15` (arm64) runners. Runner architecture and Linux ELF interpreter
are checked. Each build emits an executable plus SHA-256 sidecar. Only those production files
are uploaded; separate smoke logs are retained seven days. Actions pin immutable SHAs, builds
have read-only permissions, and only the existing push-tag release job has contents-write.
It downloads and rechecks all three checksums before adding binaries beside the existing source,
installer and checksum assets. Releases remain **drafts only**; branch/manual checks never release.

Locally: root **2,426 tests / 91,413 assertions**, typecheck, web production build, private-term /
generic / Gitleaks checks and binary acceptance pass. All three production targets compile;
only Linux x64 was executable on this host. ARM64/macOS native execution awaits the first CI
run. No workflow was triggered, tag created, push made or main bookmark moved.

## Measurements

Uncompressed bytes; MiB = 1,048,576 bytes. Production builds contain 448 neutral web files.

| Target | Bytes | MiB | Local execution |
| --- | ---: | ---: | --- |
| Linux x64 baseline | 128,764,080 | 122.80 | Full acceptance passes |
| Linux arm64 | 128,830,456 | 122.86 | Cross-compiled only |
| macOS arm64 | 108,941,282 | 103.89 | Cross-compiled only |

The x64 ELF interpreter is `/lib64/ld-linux-x86-64.so.2`; arm64 uses
`/lib/ld-linux-aarch64.so.1`. Unlike the spike's host-runtime x64 output, neither uses a Nix
interpreter. Linux is glibc-only here; musl, Windows and macOS x64 are not binary targets.

For the same neutral source/web archive, `bun install --frozen-lockfile` produced a
**323,152,548-byte** release tree (308.18 MiB apparent size, including directory entries), of
which node_modules was 304,684,022 bytes and built web 13,501,657 bytes. The local pinned Bun
runtime was **107,313,032 bytes**. Combined: **430,465,580 bytes / 410.52 MiB**, versus the
122.80 MiB x64 executable. These exclude mutable data/config, git/jj/zellij and other host tools.
This is a local filesystem measurement, not compressed download or resident memory size.

Five warm launches to the actual `Aiki listening` log, fresh temp state each time:

| Entry | Samples (ms) | Median |
| --- | --- | ---: |
| Standalone executable | 406.3, 333.0, 333.3, 353.1, 358.3 | **353.1 ms** |
| Installed Bun CLI (`scripts/aiki.ts start`) | 415.0, 401.3, 404.8, 405.1, 393.3 | **404.8 ms** |

Both include the same Python/new-session/env launcher overhead, use the same explicit git/sh
PATH, and run sequentially on one Linux x64 host. The Bun comparison uses the extracted neutral
release, frozen dependencies, generated installer metadata/current link and private temp config;
no installer or service runs. These are warm observations, not cold-disk or model-latency claims.
Reproduce with `--runs 5 --bun /path/to/bun --bun-install /path/to/extracted/aiki` on the smoke script.

## Limits and installer follow-up (part 2)

The installer still downloads the source/web archive and private pinned Bun. Its update logic
is untouched. Switching it needs platform/libc asset selection, checksum verification before
activation, chmod/execution validation, immutable release/current/previous handling, and a
source/Bun fallback for unsupported targets. The installed launcher's lifecycle/update/rollback/
service commands must remain available without a global Bun: today's standalone binary does
not yet include that installer lifecycle. Preserve T137's update-channel decisions, explicit
installation data/config targeting and stop-before-upgrade/migration warnings. Do not simply
replace the existing launcher's Bun path while leaving dynamic source imports behind.

External git/jj, optional zellij/ffprobe and project toolchains remain external. Shared worker
execution is tested; isolated jj workspaces and real terminals/provider/OAuth round trips are
not part of this packaging smoke. Native ARM64 CI, macOS signing/notarization/Gatekeeper behavior,
older libc compatibility and the final bundled-dependency licence review remain distribution
qualification work; draft CI assets are not a claim that those have been completed.
