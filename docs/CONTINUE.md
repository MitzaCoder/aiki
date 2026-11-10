# Continue

## Pi 1.5.1 upgrade (T73)

All six direct pi dependency pins moved from 1.4.0 to npm's latest 1.5.x, 1.5.1; telemetry and schema
transitives match. Fable 5.2 now uses the native catalog; the empty extension mechanism retains synthetic
coverage. Native pricing, limits and thinking match the old row. Temperature stays omitted through managed
effort, without a local flag. Native Fable now enables Opus 5 fallback by default; the Anthropic provider
policy clears fallback lists to preserve the no-silent-switch decision. Top-level effort is now low,
with the chosen effort still sent per message. New native Anthropic threads are isolated from cache warming
by stripping `thread` and setting `disableContinuation`; fake HTTP verifies headers, betas, zero-output
stream override and continuation of the real reply afterward.

Compatibility edits use Chord's context/json subpaths and tagged watch calls/ends, the single-argument
report callback, tagged Session ends and SQLite `runCounted`. Compaction notices read the current
`compactionFailure.trigger`. SQLite migrations are unchanged (schema 2); a synthetic database actually
written by 1.4.0 reopened with 1.5.1 and preserved its transcript while migrating pi.live v1 to v3.
Upstream also migrates generation v1 to v2 and tool v1/v2 to v3; downgrading active upgraded tasks is not safe.
Codemode adds local-reference search/declaration fixes and preserves non-finite console numbers; TypeBox
tools remain accepted after the pi-schema transition. Root: 1,686 tests pass; web: 801 tests, zero check
errors/warnings and build pass. Protocol check: exit 0, 299 DTOs / 78 overloads, unchanged; Android build
tests were not needed. Public guard and Gitleaks pass. No real provider requests, deployment or push.

## Compact task header (T62)

Web and Android remove the task summary and its divider. Waiting note/since/return date and subtask done/total now wrap
in header metadata; section navigation keeps question/warning counts, stored open+handling feedback totals and
total/running worker counts. Older backends without feedback totals fall back to timeline counts. Existing blocked
callouts remain. No new backend reads. Android lazy sections start at zero: both nav taps and scroll-spy use that index.
DESIGN records the shared contract. Root: 1,686 tests and typecheck pass; web: 801 tests, zero check errors/warnings,
build passes. Android: 584 tests (two existing skips), assembly and lint pass (35 warnings, zero errors). Generation:
299 DTOs / 78 overloads, unchanged; public guard passes. T62 has synthetic before/after light/dark screenshots for
web desktop/phone and native phone, including review, waiting with subtasks/feedback, and blocked tasks, plus section-nav
recordings on both platforms. Nothing was deployed or pushed.

## Board Markdown (T60)

Web board prose uses `CardMarkdown`, a compact variant of the safe chat renderer, including warnings, decisions,
answered questions and expanded board-tool cards. `markdownText` in protocol parses plain option labels, pins,
Needs-you rows and notification bodies before truncation; options still submit their original source.
Long cards fold rendered content, never a Markdown substring. DESIGN describes the shared web/native contract.
Android uses `BoardMarkdown` over compact `RichMarkdown`, and a CommonMark-based `markdownText` for the same plain
surfaces. Chat defaults and code controls are unchanged. Web: 801 tests, zero check warnings/errors, build and root
typecheck pass; root: 1,685 tests pass. Android: 584 tests (two existing skips), assembly and lint pass (no errors);
protocol generation is unchanged (299 DTOs / 78 overloads). Synthetic UI proof is on T60. Throwaway server demos should keep a `ViewClient` watch open while seeding and capturing.

## Current state

Aiki is an early personal cross-device agent harness built on pi durable. The code still uses `aiki` and
`io.github.mitzacoder.aiki` identifiers; a public-name migration is separate. Bun only for TypeScript; see `DESIGN.md` and
the root README for architecture and setup. Original project code is MIT; bundled third-party licences still apply.

## Publication preparation

The owner chose a fresh public starting snapshot, with detailed history retained privately. The publication audit
found no confirmed credential leak. Do not push old private ancestors to a public remote. Do not create or push a
public repository, squash main, or move main without the coordinator's explicit follow-up instruction.

Machine-specific deploy targets, backend suggestions, backend unit, Android properties and guard terms live in ignored
`deploy/local/` in the stable deploying checkout. The deploy exports its stable backend-list path into the archived
web build; target loading retains the old in-tree transition fallback. No example configuration is auto-deployed.
Local state/service overrides preserve existing deployment behavior. No installed watcher unit was changed.

Never commit personal infrastructure, employer/work information, credentials or live session measurements/excerpts.
Use reserved example domains and synthetic fixtures. Run `bun scripts/check-public.ts` before public pushes and review
which refs would be sent. The guard reads private literal terms from local configuration; do not copy them here.

## Checks

Required: root `bun test`, `bun run typecheck`; web `bun run check`, `bun run build`, `bun test`; protocol generator
`--check`; Android wrapper unit tests and debug assembly. Current cleanup passes: root 1,676 tests; web 793 tests,
check (zero errors/warnings) and build; root typecheck; generator (299 DTOs / 78 request overloads); Android 577 tests,
zero failures/errors and two existing skips, plus debug assembly. Local config simulation preserves the existing
remote targets, web suggestions and native build origins. Public snapshot guard and Gitleaks pass. Detailed evidence
is on the task. Do not run deploy scripts or restart the live backend from its tools.

## Architecture notes

Backends own durable project data and tools. Clients connect to multiple backends; feature negotiation supports
version drift. Needs-you summaries are built before sockets open. Cache warming is a guarded provider operation,
not a conversation turn. Passive duplicate worker reports must not wake the coordinator. Device authentication and
portable packaging remain separate work; source publication does not make a backend safe for public exposure.
