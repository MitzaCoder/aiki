# Continue

## T134: deterministic worker-workspace storage checks

The storage timeout was a failed spawn, not slow cleanup: parallel `worker_spawn`
calls ran `jj workspace add` against the same Git-backed repository. Under CPU
contention, jj failed exporting refs (`Could not delete empty packed refs`),
leaving only one worker; the test then waited 20 seconds for two idle workers.
The unchanged test reproduced this in 1 of 25 runs with three CPU hogs and the
runner pinned to one CPU. A diagnostic rerun captured the failed tool result.

Managed jj workspace creation/reuse/removal now queues by repository, including
the list/check/mutate sequence. Different repositories retain separate queues;
a failed operation releases later work. No timeout was raised. The new direct
jj regression covers simultaneous distinct/repeated creation, failure recovery
and repeated concurrent removal. The original storage integration stays intact.

After the fix, both tests passed 25 reruns each under the same three-hog,
one-CPU contention (50 passes, 500 assertions, 119 seconds). Hogs were stopped
by their recorded PIDs. Sequential gates: root `bun test` (2,402 passes,
91,270 assertions), `bun run typecheck`, and the operator public-source/Gitleaks
check pass. Before, diagnostic and after logs are attached to T134. No main move,
push, deployment or UI change.

## T133: compact report-staleness notices

Web and Android shared transcripts recognise boundary-delimited `[reports]` inputs on read,
including existing history. They reuse quiet TaskLine styling, start collapsed, show one labelled
button per task/Results-or-Next plus short reasons, and disclose the exact original text.
Task buttons open the existing sheet (web worker transcripts route back to the project sheet).
Android buttons/disclosure use 48dp targets and TalkBack labels/state. Image-bearing inputs remain
user messages; unknown future bodies retain a generic notice with raw disclosure. The server uses
plain text, as for board/check-in/worker notices; no wire metadata or storage migration was added.
Parser/history regression tests cover batching, slash sections, semicolons in reasons, boundaries,
unknown bodies, duplicates and image-bearing messages. Sequential gates pass: root 2,404 tests /
91,280 assertions; typecheck; web check (zero diagnostics), 1,038 tests / 79,629 assertions and build;
Android 888 JVM tests (two opt-in skips, zero failures/errors), assembly and lint (zero errors,
47 warnings); private public-source/Gitleaks guard. Gradle daemon stopped. T133 has synthetic
createSetup before/after web desktop/390px and emulator light/dark screenshots, raw disclosure,
and web/Android recordings expanding the widget and opening a task. Corrected light baseline and
playable web recording supersede two initial mis-tagged/empty artifacts. No phone, live data,
push, deployment or main movement.

## T132: shorter README for the published pilot

README is 339 words (was 775, `wc -w`). It keeps both themed graph/board pictures,
three why bullets, the versioned/review-first installer, Android 12+/HTTPS note,
coding-agent prompt, one-line pilot limits and the documentation/issues links.
README and both install guides now describe the pilot as published; the agent's
source fallback and checksum-failure stop remain intact. GitHub confirms the
prerelease is public with installer and signed APK assets.

Proof on T132: GitHub GFM API renders with GitHub Markdown light CSS, resolved
images, full-page 1280px/390px before/after screenshots and a desktop scroll video.
Scratch files stay outside the repository. Relative link/image targets were checked.
Public-source denylist/generic and Gitleaks checks pass using existing private
operator configuration. Docs-only: full suites skipped. No push or main movement.

## T123: remaining T120 stages integrated and checked

The remaining stages are linear above the unchanged ship tip `tvpnwyzq`:
report audit/settings (6), automatic Now (2), deployment feeds/settings (5),
then hourly timeline groups (3). Empty idle workspace children are not stages.
No main move, push or deployment was performed.

Resolved documentation conflicts oldest first, keeping every continuation line
from the original Android/web Delivery and server/web/Android timeline changes;
a multiset comparison against each original document found no lost nonempty lines.
DESIGN retains both client contracts. The client test conflict retains both Delivery
configuration and grouped-timeline tests. No generated Kotlin conflict occurred;
all four protocol generation checks exited zero. Existing feature lists and both
clients' Delivery/report-check groups merged without conflicts.

The timeline server change now displays the first 12 hash characters for landed,
removed and reverted changes and deploy attempted/serving details and summary labels.
Structured hashes, source identity and refs remain full-length. Regression coverage
checks all three change outcomes and deployment details. The first stack gate found
old full-hash/seven-character expectations; those were corrected in the same server
change. A subsequent run caught an accidentally shortened negative assertion; it was
corrected there too. The final full root run passes; no flaky-file retries or runtime
fixes outside the hash display change were needed.

Sequential boundary gates (root tests / assertions; web tests / assertions):
- Stage 6: 2,305 / 90,744; 1,016 / 79,499.
- Stage 2: 2,343 / 90,908; 1,022 / 79,544.
- Stage 5: 2,365 / 91,139; 1,028 / 79,585.
- Stack tip: 2,401 / 91,263; 1,035 / 79,612.
Each boundary also passed install, root typecheck, web check (zero diagnostics),
web production build, protocol check, private public-source/Gitleaks guard, Android
unit tests, debug assembly and lint. Both explicit deployment suites passed 84 tests
and 622 assertions. Final Android XML: 885 tests across 118 suites, two opt-in skips,
zero failures/errors. Gradle daemons were stopped after every boundary.

T123 proof uses the earlier synthetic createSetup recipe with production landing and
deployment helpers: desktop before `mwcmzxm8-896d88b9dc`, final expanded Delivery after
`mwcn2cey-46bb919450`, and interaction recording `mwcn2kiy-ed09bcc5b3` (frames held for
readability). The final screenshot supersedes a smaller detached-emulation capture.
Visible DOM assertions verify 12-character landed/attempted/serving hashes and no
40-character hashes. Scratch data/scripts stay outside the repository; owned backend,
Vite and Chromium processes were stopped by their recorded PIDs. No live data used.

## T123 Android: hourly timeline groups (stage 3 of T120)

Android now explicitly opts into `task-timeline-groups` only with that capability. Groups replace flat entries;
absent groups retains T118 and empty groups stays empty. Work, Decisions and feedback, and Delivery begin collapsed,
show local range/count/server summary, and retain expansion by opaque ID across revision refreshes. Expanded rows
show start → outcome with existing actor/detail styling. Failures/open questions retain attention tones/icons.
TalkBack buttons announce range, kind, count and expanded state; targets are at least 48dp. Existing newest-first
preference/toggle, day headings and bounded scrolling remain. Filters go to the server to recompute grouped labels,
ranges and counts, with available chips retained. The existing task `timelineRevision` effect refreshes the open sheet.

Proof on T123: isolated emulator, real createSetup server, synthetic busy release (three workers, answered question,
addressed feedback, three landed changes and one deployment attempt). Light/dark flat-before and expanded-after
screenshots plus expansion/collapse/order recording are attached. The seed used printed temporary data/config paths,
not live data. No physical device, push, main move or deployment. Track chosen only after checking available devices.

Checks: 879 JVM tests / 117 suites, two opt-in skips, zero failures/errors; debug assembly and lint (zero errors,
47 warnings); generated protocol --check (348 DTOs / 92 overloads); public-source/Gitleaks guard. Seven new JVM tests
cover grouping/formatting and explicit capability/filter request gating. Gradle daemons and owned emulator/server
are stopped before handoff. Web display remains the parallel worker's responsibility.

## T123 web: hourly folded Timeline

The sheet requests grouped history only with explicit task-timeline-groups support. Groups replace flat
rows (absent groups falls back; empty groups stays empty), with local range/kind/fact count and emphasized
failure/open-Q labels. Buttons start collapsed; opaque-ID expansion survives source revisions, filters and
order changes. Expanded facts reuse T118 rich rows/details and show start → outcome times; entries are
Tab-reachable. Existing kind filters recalculate groups locally, including labels/counts/ranges; the
filtered label helper mirrors the server's failure/question/outcome priority, while original labels stay
server-authored. Day headings, newest-first toggle/preference, 400px/48dvh bound and scrolling remain.
Groups sort by starting hour/start, not evolving end; cross-hour source updates never rebucket them.

A stable read key uses task.timelineRevision only for grouped history while the sheet is open, with
reconnect/task changes; legacy reads preserve their existing broader dependencies. Actual CDP counts:
report-only rewrite caused zero timeline reads, source outcome caused exactly one; expansion remained
open. A real Tab key focused the expanded fact, and hiding Workers recomputed the remaining Work group
to ready for review. The client wrapper forwards grouped and preserves optional groups/revision,
including empty arrays. Seven pure tests cover formatting/gating/filtering/order/priority; the targeted
client wire/legacy/empty test passes (one test / five assertions).

Requested checks pass: web check zero diagnostics; 1,029 tests / 79,571 assertions; production build;
root typecheck; public guard/Gitleaks. No root suite was requested. T123 has desktop/390px light/dark
flat-before, collapsed-after and expanded-after screenshots plus an interaction/live-update recording.
Seed uses actual server timeline/run/Q/F/deploy helpers against a throwaway createSetup backend; no
manual wire groups, real providers, live data, push, main move or deployment. Demo processes stopped.

## T123 server: stable hourly task timelines (stage 3 of T120)

Resolved the two documentation-only stack conflicts oldest-first, squashing into the original changes:
`nuttzssv` is `69937e13`, `ksutrsvt` is `9f67cff5`. Both continuation insertions were checked line-by-line
for retained destination and added source lines; newer sections come first. DESIGN retains both clients'
automatic-Now contracts and the deployment feed contract. `tlspuuvr::` has no conflicts. Nothing moved main.

The server now advertises `task-timeline-groups`. Client handoff:
- Send `board.task.timeline` with optional `grouped: true`, only with that explicit capability. The existing
  `kinds` filter applies inside groups. Without opt-in/capability the old flat response is unchanged.
- Responses add optional `groups` and `timelineRevision`; `entries` and `feedback` retain their old shape/content.
  Render groups **instead of**, not alongside, flat entries. Fall back to entries when groups is absent; an
  empty groups array is a successful empty/filter result. Feedback still feeds its separate existing section.
- A group has `{ id, kind, hour, range: { start, end }, revision, factCount, label, entries }`. `kind` is
  `work`, `decisions` or `delivery` (display Work, Decisions and feedback, Delivery). `hour` is a UTC clock-hour
  anchor; localise displayed times, but do not rebucket by end time. At most three nonempty groups per starting
  hour. Wire groups and expanded entries are chronological; clients retain T118 newest-first/order preference,
  bounded scrolling, day separators and expansion controls. Cache expansion by opaque ID, not index or label.
- Expanded entries retain the seven existing `kind` values and add required `{ id, endAt, revision, group,
  outcome, factCount }`, with optional `source` and `actor`. `at` is the immutable start, `endAt` the latest
  meaningful update. Run identity includes thread/conversation/episode, not reusable worker name alone.
  `source` identifies worker/thread/check/change/deploy/ownership where known; legacy rows need not have an actor.
  Per-entry revision changes with content; group revision sums its entries' revisions. Refresh from the task's
  monotonic `timelineRevision`, which now also covers question/decision changes. Filters recalculate range/count/label.

One source entry evolves for a worker/thread episode, Q, F or deploy attempt; initial thread claim folds into its
run. Lifecycle transitions count as facts, while target/detail updates revise the same entry without inventing a
phase fact. Q/F details retain the answer/handling evidence; deploy details retain intended/serving commits and
per-target states. Branch advances use their durable fact IDs. Local change/check outcomes can use the same keyed
source reducer; this stage does not infer them from tools, chat or free-form report prose.

Failures dominate labels, then open Qs; routine labels combine reported-worker count/review, latest Q/F outcome,
or landed count/latest attempt. Examples: `2 workers reported; ready for review`, `Q1 answered; F1 addressed`,
`3 changes landed; live on 3/3 targets`, `Worker fern failed`, `Q1 awaiting answer`. Cross-hour runs remain in their
starting group and position. Report/metadata rewrites, stale marks, phases, check-ins, messages, artifacts and tool
noise add no grouped rows. Legacy snapshots/events fold purely on read; no migration/backfill writes or snapshot
rewrites. New source projections are bounded independently of legacy flat history, which gains no duplicate rows.

Verification: new timeline suite 28 tests / 80 assertions; related server suites 65 / 478. Sequential gates pass:
root 2,386 tests / 91,178 assertions; typecheck; web check zero diagnostics, 1,022 tests / 79,544 assertions and build;
Kotlin generation and --check; public-source guard/Gitleaks; Android JVM 872 tests (two opt-in skips), 116 suites,
zero failures/errors, and debug assembly. Gradle daemons stopped. No known flaky gate needed a rerun; initial new-test
type errors were fixed before the successful typecheck. Web/Android display work and UI proof are for later briefs;
only generated Kotlin DTOs changed here. No live data, phone install, push, main move or deployment.

## T125: Android Delivery settings

Project settings now offers Delivery when task-changes or task-deploys is advertised. Integration branch
supports Automatic, Custom ref (plain names normalize to full local refs), and Off. Deploy status feed
supports Off or a local file path; server validation errors stay inline. Each setting is gated separately,
uses projects.configure with explicit null only for Off, and follows existing pick/blur/Done saves.
The protocol summary has no deploy-feed health field; the UI does not invent one. JVM tests cover modes,
normalization, feature availability, values and isolated null patches. Verification uses only a temporary
createSetup backend/project and the assigned emulator, never live data or the owner's phone.
Light/dark before/after screenshots, a short custom-ref/feed-path recording and inline rejection of a
relative feed path are attached to T125. Verified persisted values through the real server. Gates pass:
878 JVM tests (117 suites, 2 opt-in skips), assemble, lint (46 warnings, 4 hints, no errors), protocol
check (345 DTOs / 92 overloads), and public-source guard. Emulator and scratch backend stopped;
Gradle daemons stopped. No push, deployment, or main movement.

## T125 web: Delivery settings in Project General

Added a Delivery group under Project settings → General. Integration branch (task-changes) offers
Automatic/main-or-master, Custom ref and Off; local full refs and plain branch names are validated,
with plain names normalized to refs/heads/. Deploy status feed (task-deploys) offers Off or an absolute
backend-local file path. Each row requires its own explicit hello feature. Modes save immediately;
custom fields use existing blur/Enter autosave and inline saved/error feedback, including server
validation errors. The configure client now forwards both fields and preserves omitted/null semantics.
ProjectSummary has no feed-health/last-attempt field, so no status line is fabricated. Observation
remains read-only; no ref move, deployment, command adapter or server behavior changed.

Checks pass: web check zero diagnostics; 1,028 tests / 79,585 assertions; production build; root
typecheck; public guard/Gitleaks. A targeted client settings/omission/disable test passes with six
assertions. No root suite was requested. T125 proof includes before/after settings at desktop/390px,
light/dark, and a recording setting trunk (normalized to refs/heads/trunk) and a synthetic feed path.
The isolated createSetup project is a temp Git repo with main/trunk and a synthetic JSON journal;
before truly omits both features. System color-scheme emulation and settled transitions were used.
No live data/credentials, push, stack rewrite, main move or deployment. Demo processes stopped.

## T125: project deployment file feeds and origin journal

Added opt-in `deployFeed` (absolute local JSON file or null; feature `task-deploys`). No command
adapter: settings-configured commands would expose code execution through the settings API.
The harness only observes. Version 1 envelopes carry canonical repository scope, optional projectId,
and complete attempt snapshots with a global sequence, intended commit, expected targets and
queued/running/ok/failed/rolled_back/pending target details. Private cursor/outbox persistence and
board sequence guards make missed-attempt replay idempotent. Each attempt freezes the ledger/trailer
union across all target success→intended ranges. No baseline means no whole-history attribution.

One transaction updates every shipped task, including done/dropped/archived, without reopening or
per-task pushes. One existing milestone per attempt evolves in place with attempted/serving commits.
Now uses failure/active/delivery slots; retries retain unresolved failures until verified recovery.
Pending is not success. Invalid/unreadable feeds become unknown; disable/re-enable retains cursors.
Harness deploy outcomes stale Results/Next; closed tasks never nudge. Existing global deploy-problem
notifications are unchanged; no success pushes or new UI/settings field were added.

`deploy/journal.sh` adds disposable background observers to deploy.sh. They close the deploy-lock
FD before any observer work, use a separate bounded journal lock, and atomically write
`<deploy state directory>/deploy-journal.json` through deploy-journal.ts. Start/outcome/catch-up and
unchanged details survive restart; catch-up resumes the matching attempt. A local initial host
baseline comes from its existing verified status/serving release. Unknown initial target baselines
never guess. Journal failures cannot affect deploy exit status, rollback, health checks or the
per-backend status contract. There are no backend.sh/watch.sh behavior changes. Configure this
project's actual feed path privately through projects.configure; DESIGN records the full schema.
The journal trims itself atomically to the newest 200 attempts or 1 MiB (whichever fits fewer),
with at most 4096 snapshots; a single noisy attempt compacts to its latest full snapshot. Frozen
baselines, verified target checkpoints, stable attempt IDs/order and sequence high-water marks survive
retention. An old harness cursor resumes only unseen retained attempts, once, using their supplied
baselines rather than stale pre-gap successes. No manual archival or feed path changes are needed.
Non-Git jj deployment attribution remains deferred. No live deployment was run.

Protocol/Kotlin models are regenerated. Before retention review, full sequential gates passed:
root 2,349 tests / 91,021
assertions and typecheck; web zero check errors/warnings, 1,016 tests / 79,499 assertions and build;
generator --check; private public-source guard; deploy harnesses 82 tests / 603 assertions; Android
unit-test/debug assembly. Gradle daemons were stopped. No flaky gate reruns were needed.
No push, main move, stack rewrite, phone install or UI proof was needed.

The retention review adds count/byte-bound and noisy-attempt writer tests plus old-cursor gap/restart
dedupe coverage. Its requested gates pass: deploy 84 tests / 622 assertions; task-deploys 9 tests /
133 assertions; typecheck and public guard. This follow-up is squashed into the same stage-5 change,
not the stack.

## T122 Android: automatic Now display

Android gates automatic Now on both `task-activity` and `task.activity`. The Report Now row,
list rows, board cards and Graph report detail show canonical plain text, a quiet kind-coloured
dot and age. One shared minute flow ticks only the activity views; it never polls or writes to
the backend. TalkBack gets text plus age; search uses text without ages. Legacy report rendering
and historical snapshots stay unchanged. Existing family expansion controls remain available.
List rows and board cards keep text and muted age inline in one naturally wrapping Text, avoiding
an extra line per row. Refreshed light/dark after list shots replace the earlier taller list proof.

Six new JVM tests cover feature/field gating, elapsed ages, bad/future timestamps, embedded
“since”, all kind tones, canonical gists and populated legacy sections without writtenAt. The
existing freshness formatter already omits a missing age while retaining events and stale reasons.
Debug JVM checks pass (870 passed, two existing opt-in skips), assembly and lint pass (zero
errors, 46 warnings, four hints); protocol generation and the public-source guard also pass.
T122 has refreshed synthetic emulator before/after task-list and task-sheet screenshots in both
themes plus a recording of legacy prose changing to automatic Now. Demo Results/Next are seeded
through the board write_report path, with populated dates. The list covers working, question,
review, failed and idle states; supplementary proof covers board cards and Graph report detail.
The backend uses createSetup temporary data/config/project directories only; no real phone,
production data, main movement, push or deployment is involved. The isolated emulator and demo
backend were stopped by PID; Gradle daemons were stopped.

## T122 proof follow-up: populated sections with missing dates

The demo assigned `report.next/results` directly on BoardDoc after saveTask had initialized freshness
with null dates, bypassing writeReport/coverReportSection. Setting only shared updatedAt/revision did
not repair already-present section metadata. This caused the screenshot's Next/“Not written yet”
mismatch; automatic activity only clones the report and overrides Now, and does not reset dates.
The formatter was also too categorical: null date now omits age instead of claiming no prose exists,
while preserving uncovered-event counts and stale marks. It does not invent an approximate date.
Added a populated/null-date regression; targeted freshness tests, web check and the server's canonical
mirror metadata regression pass. Replacement phone-dark proof retains the inconsistent fixture to
verify the defensive display. Production server behavior is unchanged.

## T122 web: automatic Now and activity gists

Report Now, task-list summaries and board cards use canonical `task.activity` only with the explicit
`task-activity` capability and optional field. A shared activity-line component adds kind-toned dots
and a locally ticking age; one minute timer serves mounted lines without invalidating whole lists or
writing server state. Failure/attention/work/review/muted kinds stay compact, and active pulses respect
reduced motion. Already-timed state/delivery text avoids duplicate ages; unknown/not-started omit ages.
Missing flag/field preserves legacy prose, gists and waiting summaries. Search uses canonical text,
never local ages. The current bubble graph has no separate report gist; selecting a task opens the
same automatic Now sheet. History remains untouched; no editable prose Now was added.

Five pure tests cover gating/fallback, age formatting, kinds, row/card gists and search. Requested
checks pass: web check zero diagnostics, 1,021 tests / 79,541 assertions, production build; root
typecheck; public guard/Gitleaks. No root suite was requested. T122 proof includes before/after sheets
and lists at desktop/390px in light/dark, two board shots, and a recording of live synthetic durable
worker-source finish/start transitions (working → review → working). The before backend genuinely
omits task-activity and retains old prose. All demo processes were stopped; no live data/providers,
main move, push or deployment. Demo scripts and evidence remain in the task artifacts/scratch handoff.

## T121: freshness stack on the current bubble-graph main

The fifteen T120 changes are one linear stack above main `1d24f8d7`, with
`tvpnwyzq` the stage 1+4 ship boundary and `tlspuuvr` the full stack boundary.
Only CONTINUE and DESIGN required conflict resolution: retain all continuation
sections newest-first, keep the one-tap request contract alongside the audit,
and keep both web and Android report-check settings descriptions. Continuation
insertions were checked by a script for retained parent lines and added lines;
the one-tap change intentionally updates the earlier dialog description.
No task-sheet or settings code needed manual merging; existing worker UI proof
still applies. Main's graph and README changes remain intact. All fifteen commit
descriptions end with Aiki-Task trailers; the trailer prompt grammar and its
assertions are corrected in the trailer-attribution change. Empty workspace
changes remain outside the stack. No main move, push or deployment is authorized.
Exact-tip sequential gate results are recorded in the T121 integration report.

## T122 review: infer focus; read-only worker request fast path

Removed the focus instruction and board action. Coordinator focus now follows durable
task-scoped submissions (including feedback), the running thread's own task, and successful
task moves, report writes, worker spawn/send, questions and decisions. Actions add focus in
their existing transaction, with no extra tool call. Own/touched tasks stay focused through
the turn; merely claimed tasks do not. Thread defaults also reconcile on project reopen.
The real-thread regression caught a newly assigned raw map not tracking its nested update;
initial task focus now reads back the document-owned map before setting its entry.

The old worker hook entered a transaction on every request. The harness discards genuinely
empty transactions before storage/publication, so those do not bump document revisions or
broadcast. The new fast path is read-only regardless: compare the stored run marker first,
then commit only a changed marker with a transaction recheck. A spy regression verifies
zero commit calls for repeated same-run requests and one for a new run. No protocol change.

Requested root run executed once: 2,311 passed, one existing background-thread question
routing test exposed a new deadlock (resolving a conversation through Harness from inside
its own commit). Resolution now happens before the transaction. After that fix, all 63
activity/report/prompt/thread tests pass, including the failed regression; typecheck passes.
The root suite was not repeated, respecting the requested single run. No protocol fields
changed, so no generator rerun was needed. No earlier stack changes, main movement, push,
deployment or UI work.

## T122 server: automatic task activity (client handoff)

Stage 2 adds `task-activity` (excluded from legacy support) and optional `task.activity`:
`{ kind, text, since, refs, actor?, count? }`. Actor: `{ id, kind, name, threadId,
conversationId, runId }`. Text has no age. Render `since` locally; use elapsed time for work
and optionally local “since” time/date for waiting/review/done/dropped. Search text, not ages.
Missing feature/field keeps old-backend rendering. The legacy `report.now` wire mirror is
canonical text only and does not refresh report/Results/Next timestamps or coverage. No
settings/display edits here. Kotlin DTOs are generated from the new optional fields.

Precedence: unresolved failure; blocking Q; reserved active-deploy slot; live focused run;
open feedback; blocked/waiting/review; landing within 24 h; closure/not-started/idle (unknown
when a source cannot be reached). No configured deploys yet: “3 changes landed on main”,
not “not deployed yet”. `since` is a state/phase start, not token liveness. Phases do not
produce timeline rows. Closed tasks ignore lingering work but keep failures/delivery.

Workers' optional `task_progress.now` is a short changed phase, expiring with the actual run;
`addResult`/milestones remain. Legacy coordinator `write_report.now` becomes a phase and
focus for that task, expiring at turn end or release/stop. Focus is inferred from task-scoped
submissions, the thread's own initial task, and task moves, report writes, worker spawn/send,
and linked questions/decisions. Touched tasks remain focused for the rest of that turn.
Claim/ownership alone never activates all held tasks; no prompted/manual focus call remains. All project prompts ask only
for Results/Next and explain automatic Now. Existing old Now is not interpreted as a phase.

Sequential final gates pass: root 2,307 tests / 81,849 assertions; typecheck; web check
zero diagnostics, 1,003 tests / 70,570 assertions, production build; protocol --check
(345 DTOs / 92 request overloads); private public-source guard; Android 860 JVM tests
across 114 suites, two skipped, zero failures/errors, debug assembly. Gradle daemons
stopped. The new suite has 27 tests, including prompt assertions; tests are this backend
change's proof. The initial full run caught the old scheduled Now expectation; a later
stale-button timeout was a reproducible detached transaction-result bug, fixed by copying
the projected task before returning it. Focused regressions and the final full sequence
pass; no known flaky test needed a rerun. No main move, push or deployment.

## Android Report check settings (T126)

Completed the interrupted Report check group in Project settings → Coordinator. Automatic/Off/custom
model selection and daily budget save through projects.configure; the group requires report-audit.
The automatic explanation matches web wording. Muted status has model/provider plus token use, then
last run (or No checks run yet) plus state/reason. JVM presentation/gating coverage: 865 tests in 115
suites, zero failures/errors, two existing opt-in skips; assemble/lint, protocol generation and public
source checks passed. T126 emulator artifacts retain before/after light/dark and mode/budget interaction.
Only synthetic createSetup data was used; no deployment or physical device operation.

## T126 web polish: compact status

Mode now explains the automatic small-model fallback order. Status is two muted lines: model plus
usage, then last run plus state/reason. Updated pure formatter expectations. Web check has zero
diagnostics; all 1,008 web tests / 70,597 assertions pass. Replaced the model-state desktop-light and
390px-dark screenshots on T126 with settled synthetic faux-provider captures. No other gates rerun.

## T126: web Report check settings

Added Project settings → Coordinator → Report check, gated on the explicit `report-audit` hello
feature (no inferred support). Automatic/Off/model choice and the 65,000 default daily-token budget
use existing combobox/autosave controls. Choosing a model saves that mode only once a model is picked;
status shows the server-selected model/provider, daily usage, locally ticking last run and state/reason.
The client configure wrapper now forwards reportAudit, including null resets; a regression test verifies
both. No coordinator defaults, audit scheduling, server logic or Android UI changed.

Checks: web check zero diagnostics; 1,008 tests / 70,597 assertions; production build; root typecheck;
public guard/Gitleaks. Targeted client request/reset test: one pass / two assertions. No root suite
rerun was requested. T126 proof contains desktop/390px light/dark before/after screenshots, plus a
faux-model state and a recording changing mode/budget/model against a synthetic createSetup backend.
Dark follows system colour-scheme emulation with reduced motion and settled transitions. No real
provider credentials, live data, push, main move or deployment. Demo processes stopped after proof.

## T121: freshness stack integration

The eight T120 freshness changes are linear on the Android graph/timeline main: design,
server freshness, noise fix, web, Android (stage 1), attribution, landing freshness, audit.
Additive CONTINUE conflicts retain both sides with newer sections first; audit/integration
project fields and legacy feature exclusions are combined. Kotlin DTOs were regenerated,
not hand-merged. DESIGN and both task sheets merged automatically, retaining T118 Timeline
placement, controls and behavior plus Report freshness. Existing worker UI proof still applies;
no new UI behavior or screenshots were introduced by integration.

Sequential gates passed at both stage 1 and audit tips, without test reruns or code fixes.
Stage 1: root 2,244 tests / 81,510 assertions; web 1,003 / 70,570; Android 860 tests across
114 suites, two skipped, zero failures/errors. Audit tip: root 2,280 / 81,753; web and Android
counts unchanged. Both also pass root typecheck, web check (zero diagnostics) and production
build, protocol generation --check, public-source guard, Android assembly and lint. Gradle
daemons stopped after each gate. No main move, push, deployment or device interaction.
Unrelated release-work siblings on main were left alone; the freshness ancestry has no empty
changes between its eight entries. All original descriptions and task trailers are retained.

## T126 review: one admitted audit per hour, including idle

Every audit trigger now observes persisted `lastAttempt` spacing: at least one hour between
admitted runs, even with fresh evidence after every coordinator turn or after a restart. Idle is
only the preferred moment; the hourly timer is the fallback for a coordinator that stays busy.
The durable admission transaction rechecks the interval before reserving tokens. Summary model
resolution now caches effective-model/auth checks for 60 seconds by mode/model ref across projects,
coalescing pending lookups; changing mode/ref does not reuse an unrelated cached choice.

Review verification: 17 faux-provider audit tests / 136 assertions; root `bun test` run once,
2245 tests / 81536 assertions / zero failures; typecheck passes. New coverage checks 50 idle turns
with new evidence, the hour boundary, persisted restart with new facts, and summary cache expiry
and mode changes. Existing nudge/budget/retry tests still exercise their own gates past the new
hourly guard. No protocol/UI changes, live providers, push, main move or deployment in this review.

## T126: stage 6 small-model report audit

Implemented the on-by-default server/protocol audit (D60/D61); no web or Android settings UI.
`report-audit` advertises `projects.configure.reportAudit` and optional ProjectSummary
`reportAudit`/`reportAuditStatus`. Settings: `{ mode: "auto" | "off" | "model", model?: ModelRef,
dailyTokens: number }`, default auto/65000; null restores defaults. Model mode requires a known
model. Status gives effectiveModel, UTC day, tokensUsed, lastRunAt, state and reason. DESIGN's
Report audit section is the as-built contract for the settings UI worker. Old clients are unaffected;
343 Kotlin DTOs / 92 request overloads generate and Android compiles without manual client changes.

Auto selects credentialed anthropic Haiku 5.5, then opencode-go Haiku 5.5, then openai gpt-5-nano,
then the cheapest small openai-codex catalog entry (currently gpt-6-luna; input <=0.25 and output
<=1.5 per million). Otherwise unavailable with a no-signed-in-small-model reason. This is the sole
server-chosen model default; coordinator/worker/memory choices remain explicit. Thinking off on Anthropic (to preserve its output cap), minimal on other
reasoning models, no tools, 30-second abort/race. Each hourly/main-idle invocation audits at
most four uncertain active tasks with new evidence and no pending/delivered unchanged nudge.
Quiet hours cost zero requests. Task JSON is bounded to 600 estimated tokens, total input <=2600,
output <=100. Strict JSON-line verdicts only; malformed/truncated/tool output never mutates reports.
Stale verdicts use the same markReportStale/batched-nudge path as the user button. Fine never clears
fixed-rule stale state. Durable event/evidence coverage and pre-call reservation prevent duplicate
paid calls on concurrent triggers/restart/errors; unknown usage retains the reservation. UTC daily
budget settles to provider input/cache/output tokens. Request log purpose `report_audit` appears as
Report audit in usage analysis, attributed to project/model. Closed summaries read a display mirror;
the board document remains authoritative for admission/budget. No prompt contents enter usage logs.

Checks passed in the requested order: root 2243 tests / 81521 assertions; typecheck; web check with
zero diagnostics, 994 tests / 70525 assertions, production build; protocol --check exit zero;
public guard and Gitleaks; Android 819 JVM tests / 109 suites / two skips / zero failures or errors,
debug assembly. Gradle daemon stopped. Fifteen faux-provider audit tests cover budget/reset,
empty hours, bounds, injection fixtures, parsing, model priority/auth, settings, stop/restart and
usage attribution, plus thinking/output-cap handling. A final root/typecheck rerun after the
thinking-cap regression fix also passed; no flaky rerun needed. Tests are the backend-only proof. No main move, push,
deploy, real provider call or live-data access. UI worker still owns both clients' Report check row,
mode/model/budget controls and usage/status display, plus visual proof.

## Android one-tap report update request (T121, F24)

Replaced the section/reason dialog with one header tap. Only projectId and taskId go to board.report.stale;
status stays unchanged. Success replaces header metadata with Asked the agent to update and a check for
four seconds, using a polite live region; request errors appear inline. T121 has light/dark control and
confirmation screenshots and a tap recording from a synthetic backend. JVM: 861 tests / 114 suites,
zero failures/errors, two existing opt-in skips; assembly, lint, protocol generation and public guard pass.
Immediate server delivery is a separate change, not implemented or certified here.

## T121 F24: one-tap report update request

Replaced the web dialog with one header action: no section picker or reason input. A successful tap
shows a check and “Asked the agent to update” for four seconds, with a polite live announcement;
failures use a dismissible error toast. Header confirmation wraps safely at phone width. Now, Timeline
and task status are unchanged. Protocol optional fields remain valid for older clients.

Explicit owner requests default to “you asked for an update”, skip automatic debounce, and rearm
already-delivered section versions. Pending/frozen/in-flight repeats are no-ops; completed receipts
allow a new deliberate request. Done/dropped tasks accept owner requests without reopening; automatic
facts still do not nudge closed tasks. Requests survive normalization until prose is rewritten.
New reducer/wire tests cover immediate admission, coalescing, re-request, batching, closed tasks and
missing finished Results. Root suite run once: 2,272 tests / 81,653 assertions, zero failures; typecheck;
web check zero diagnostics, 1,004 tests / 70,571 assertions, build; generator --check (341 DTOs / 92
overloads); public guard/Gitleaks all pass. Before dialog proof was reused; T121 has eight new settled
control/confirmation screenshots (desktop/390px, light/dark) and a five-second one-tap recording.
Synthetic createSetup/faux data only; no live providers, push, main move or deployment.

## T124: namespaced commit trailers

Task attribution now reads only case-insensitive `Aiki-Task:` trailers, including repeated lines and
comma-separated IDs. Coordinator, worker and thread instructions use the same key to avoid clashes
with other projects' conventions. No legacy-key migration is needed; this stage has not shipped.

Sequential checks passed: root 2,264 tests / 81,622 assertions and typecheck; web 1,003 tests /
70,570 assertions, zero check diagnostics and production build; protocol generation; private source
and Gitleaks guards; Android 860 JVM tests / 114 suites / two skips / zero failures or errors,
debug assembly and lint. No flaky retries needed. Gradle daemons stopped. No UI change, push,
main move or deployment; existing stack left unchanged with one new commit above it.

## T124: stage 4 stacked on stage 1; landed changes invalidate reports

Rebased `zmwxuvvx` onto `tqmtvotm`, preserving both stages. Only CONTINUE and the legacy
feature exclusion list conflicted: retained every continuation section (stage 4 first), and excluded
both task-changes and task-freshness from legacy support. DESIGN and both prompt edits merged
cleanly, including the [reports] paragraph and Aiki-Task trailer instructions. Regenerated Android DTOs.

`recordChangesLanded` now admits one commit fact per attributed task inside its timeline transaction.
Landed, removed and reverted changes stale Results/Next with count/ref reasons. The existing fact-ID
guard prevents replayed event counts and nudges; unattributed changes do nothing. Three synthetic
integration cases prove both sections, one nudge batch, unchanged replay before/after admission, and
one timeline row. No UI changes, push, main move or deployment.

Final gates pass in order: root 2,247 tests / 81,507 assertions, typecheck; web check zero diagnostics,
994 tests / 70,525 assertions, production build; protocol --check exits zero (341 DTOs, 92 overloads);
private public guard/Gitleaks; Android 819 tests / 109 suites / two skips / zero failures or errors
and debug assembly. Gradle daemons stopped. Initial typecheck caught a synthetic writer fixture using
the wrong fields; corrected it and repeated root tests then typecheck before the remaining gates.
No known flaky test needed a rerun.

## T124: task/change ledger and read-only integration observation

Stage 4 backend implementation is in `task-changes.ts`; runtime attaches one observer per open project.
Projects stay lazy across server restarts; persisted tips catch up when the project next opens, not by
opening coordinators/resuming runs for observation at startup. The review fix removes startup
reattachment and tests both closed/unchanged-ledger state after restart and catch-up on explicit reopen.
Atomic private `task-changes.json` stores
repository-scoped attribution, workspace bases, integration tips and structured durable/outbox facts.
`integrationRef`: auto (main/master), full Git ref, or null (off). Repeated `Aiki-Task: T1` and comma-separated
`Aiki-Task: T1, T2` trailers validate against the project's board. Stable jj IDs replace hashes on rewrite.
Forget/storage cleanup records isolated single-task base→tip provenance before deleting workspaces;
shared/reused/multi-task work requires explicit trailers. Git-only object/ref reads plus optional
`jj --ignore-working-copy` metadata reads do not snapshot working copies.

Integration seam: optional `onChangesLanded(fact: ChangesLanded): Promise<void> | void`, default no-op,
at-least-once with durable `fact.id`. It includes landed/unreachable/reverted commit details and task IDs.
Runtime currently calls `board.recordChangesLanded`: one legacy milestone/task/advance, idempotently.
The coordinator must wire stage 1's fact/staleness entry point here after merging; stage 3 can consume
structured ledger facts for Delivery. No report rules/stale reducer edits. No push/deploy claim or
notification, no UI edits. Feature `task-changes` covers the optional integration-ref setting; Android
DTOs regenerated. Publication/tag/deploy feeds and a non-Git-backed jj adapter are deferred. Internal
verified declarations/manual corrections exist, but no new agent tool was added.

Checks pass: root 2,229 tests and typecheck; web check (zero errors/warnings), 994 tests and production
build; protocol generation/check (337 DTOs, 91 overloads); Android 819 JVM tests across 109 suites
(two skipped, no failures/errors) and debug assembly; private public-source guard. Gradle daemons stopped.
Sixteen new focused backend tests cover Git/jj trailers, rebase identity/hash replacement, squash/merge,
force moves, revert, restart/outbox catch-up, no snapshot/unchanged jj operation, defaults/off/missing refs,
legacy row dedupe and actual workspace cleanup. Initial root run exposed the expected new-process-site
audit inventory; after explicitly auditing the scrubbed child environment and adding the site, the full
rerun passed. That first attempt also exceeded its short command timeout. No known-flake failure remained.
Review-fix checks: the task-changes suites plus server suite pass (41 tests, 246 assertions), and root
typecheck passes. Only these requested checks were rerun after removing eager startup attachment.
No push, main move or deployment.

## T121 Android: match web's quieter Report

Moved “This looks out of date” into a speech-bubble alert icon at the Report header's right
edge, beside the shared timestamp, with tooltip, TalkBack label and a 48 dp target. Removed
the bottom text action. Each section now has one muted wrapping metadata line; only “needs
update” is emphasized in on-surface semibold, with reasons separated by semicolons. Updated
the formatting regression. Replacement light/dark Report/dialog screenshots and the header
interaction recording are on T121. The same scratch recipe/launcher still applies; tap the
header icon instead of the former bottom button. Track r and throwaway servers are stopped;
Gradle daemons stopped. JVM/assembly/lint gates passed again. No Timeline or section order edit.

## T121: Android stage 1 Report freshness

Report-only display is split into TaskReport, ReportFreshness and ReportStaleAction. Backend
`task-freshness` gates the action; both feature and optional metadata gate section ages/counts,
stale reasons and empty Results at review/done. Now, section order and Timeline are untouched.
Ages tick on the existing local sheet clock. F24 replaces the dialog with one header tap using only
projectId and taskId in the generated stale request; success/error are inline. Success shows a check
and Asked the agent to update for four seconds with a polite TalkBack announcement.
Five new JVM tests cover gating, ticking/approximate ages, missing dates/counts, reasons and empty
finished Results. Android gates: 824 tests / 110 suites / two skipped / zero failures or errors;
assembly and lint pass (44 warnings, one hint, no errors). Protocol --check and public guard pass.
A shared Gradle daemon received an external stop during a later run; --no-daemon rerun passed.
Synthetic real-server emulator proof includes old-feature fallback and light/dark stale reports.
F24 replacement proof shows the one-tap control and confirmation without a status move; T121 holds
screenshots and interaction recording. Earlier dialog evidence is historical, not current behavior.
The isolated demo seeds a review task, old Next and unchanged Now, then asks/answers its question
through board reducers. Scratch demo/recipe are evidence artifacts, not committed infrastructure.
No main move, push, deploy or physical-device interaction.

## T121 web review: header action and settled proof

Moved the stale-report action into the Report header as a labelled ghost icon button with a tooltip.
Empty finished Results keeps its explanation once; metadata adds only event counts, stale state and
nonduplicated reasons. Added four assertions for that formatting. Web check has zero diagnostics;
998 tests / 70,544 assertions and the production build pass. Only the requested web checks were rerun.
Replacement after/dialog screenshots and recording on T121 use emulated system `prefers-color-scheme`
(the app follows the device), reduced motion and settled transitions. Dark proof now has the actual
dark sheet background and fully opaque report text; the old grey/dim captures were proof artefacts,
not a Report style change. The normal nested-dialog backdrop still dims/blurs the sheet behind it.

## T121: stage 1 web report freshness

Report-only web changes add locally ticking Results/Next ages, approximate dates, uncovered event
counts, quiet stale reasons and the empty finished Results explanation. Both `task-freshness` and
metadata are required; otherwise the existing UI is retained. After F24, the report action is one tap:
it calls `board.report.stale` without sections/reason, shows “Asked the agent to update” with a check
for four seconds, and reports failures in a dismissible toast. No dialog or further input is needed.
Owner requests are immediately due and can ask again after a delivered nudge; pending/in-flight taps
coalesce. Done/dropped requests are allowed without reopening; automatic closure rules are unchanged.
Now, Timeline and section order are unchanged. Three pure formatting/gating tests add 15 assertions.

Checks: web check zero diagnostics, 997 tests / 70,540 assertions, build; root 2,231 tests / 81,415
assertions, typecheck; public guard and Gitleaks pass. The first root run hit the tool's 120-second
limit; a complete 300-second-budget rerun passed in 212 seconds, with no test failure rerun.
Synthetic createSetup backend proof on T121 includes before/after and dialog screenshots at 1280/390
width in light/dark, and a nine-second recording of opening a task and marking the report stale.
Before captures use the unchanged legacy branch. No live data, deployment, push or main move.

## T121 review: ordinary rewrites clear stale coverage

Changed-prose writes now cover the current task event sequence when `coveredEventSeq` is omitted.
Explicit coverage still preserves the earlier-read race boundary; no-op prose still covers nothing.
The report-message explanation follows the main report paragraph, in plain words, and tool descriptions
say coverage is optional. Added omitted-coverage/no-op/rearming and coordinator-paragraph-order tests.
Review checks pass: 32 targeted freshness/prompt/worker/cache tests / 186 assertions; root run once,
2,228 tests / 81,400 assertions / zero failures; typecheck. Protocol generation --check exits zero.
The sibling attribution change was not edited. Earlier full web/Android/public gates below describe
the initial stage-1 implementation; this review changed no wire fields or UI.

## T121: stage 1 report freshness server/protocol

Noise fix is a new child of `tqmtvotm`; the stage-1/stage-4/landing-wiring revisions were not rewritten.
Facts now carry an internal actor; coordinator actions (including milestones) count but do not
invalidate, except review with empty Results. Substantive outgoing chat without a same-turn report
write is a harness-detected gap: it still stales both sections and queues one nudge, once per task/turn. Starts/resumes never invalidate. Worker outcomes, thread
finish/failure, owner answers/edits and verified harness facts still invalidate. Done/dropped tasks clear
stale causes and pending/undelivered nudges while keeping honest counts; reopening does not retro-mark.
Mixed batches cancel and rebatch the still-open tasks. The age backstop excludes self-caused activity.
T71 replay still passes. Noise-fix checks: 100 affected tests / 773 assertions; root once, 2,234 tests /
81,440 assertions / zero failures; typecheck; private public guard/Gitleaks. No protocol/UI changes,
push, main move or deployment. Chat-fallback correction checks pass: 20 freshness tests / 150 assertions
and root typecheck. The original implementation and review gate counts below are historical.

Implemented D59/D60's deterministic Results/Next freshness, without removing Now or changing the timeline.
`task-freshness` gates detection and the `board.report.stale` request. Optional `task.eventSeq` and
`report.freshness.results/next` carry section dates/writers/versions/coverage, approximate legacy dates,
stale flags, event counts and short causes; Next has optional `waitsOn` IDs. DESIGN's Report freshness
section is the as-built wire/coverage/outbox contract for the web and Android workers. Kotlin DTOs are
regenerated (341 typed DTOs, 92 request overloads); existing Android sources still compile unchanged.

Agents read `show_task`'s eventSeq and pass `coveredEventSeq` with substantive rewrites. Workers can
read their task with an empty `task_progress` call. A changed-prose rewrite without coverage covers the
current task sequence at write time; an explicit earlier sequence keeps concurrent newer facts stale.
No-op prose never advances coverage, clears stale state or rearms nudges. Lifecycle reducers, the
hourly-at-most two-hour age backstop, and the user/audit stale-mark path share durable admission.
Conservative turn-end coordinator chat mentions invalidate as harness facts only when the task report
was not written that turn; same-turn writes prevent this fallback.
The nudge outbox freezes task + both section versions + burst, batches by owning live coordinator
(otherwise main), and submits a durable follow-up, never a steer. Overflow waits for the previous
input's receipt. Replays reuse admission IDs; quiet restarts/migration create no fact or nudge.
Future verified commit/deploy adapters call `noteTaskFact`; the small-model audit is not implemented.

Checks pass in the requested order: root 2,226 tests / 81,384 assertions (including 13 new freshness
replays/integration tests), typecheck; web check (zero diagnostics), 994 tests / 70,525 assertions,
production build; public tree guard and Gitleaks; Android 819 JVM tests / 109 suites / two skips /
zero failures or errors, debug assembly. Protocol generation and --check both exit zero. No flaky
rerun was needed. Gradle daemons stopped. Backend-only evidence is tests; no UI work, push, main move,
deployment, or live-data access. UI workers must detect both the feature and optional metadata, keep
Now for stage 1, and use the documented request rather than changing status to flag an old report.

## T120: task freshness design (no implementation)

`docs/research/task-freshness.md` proposes automatic Now, three folded timeline groups
per busy task-hour, generic commit/deploy attribution and D59 stale-section nudges.
Results/Next stay agent-written; section-specific coverage avoids fresh Now disguising
old prose. The answered-question/work-advanced rule explicitly covers T71/Q121. Cheap
chat-mention and age fallbacks plus a user stale-report action are recommended; a bounded
small-model audit is optional and token-budgeted. No runtime/UI/deploy changes, push or
main move. Defaults and optional audit enablement remain owner choices.

## T130: restore the web Bubble club graph

Restored the T79 web graph from `19cc5744`, backing out the Connected work renderer introduced by
`slosktxv`, `slmquslx`, `suvvsstq`, `zoqvvoxx`, `pqzwpwot`, `yozyskos`, `rvkwvkuo` and `uzqvpyxz`.
This is the owner's F22 on T103 decision. TaskGraph, bubble layout/camera/model/tests and the default synthetic
seed are restored; unused card components, viewport/session code, large fixture and UI-specific tests are removed.
Graph-only refreshing/readyVersion/receivedAt flags and TasksView/ProjectChat props have no remaining users and
are removed. Task search and its TasksPanel/TasksView integration, T118 timeline, T113 header, question reader,
release/CI work and all Android files are unchanged.

Android vector scripts still import the pure model, family layout/view/edge and change modules plus the busy
fixture, so those modules and their tests remain. The explicit TypeBox dev dependency remains for their protocol
validation test. Both Android vector `--check` commands pass; no native build or device operation was needed.
The reference research doc remains. DESIGN describes bubbles again and preserves the separate Android contract.
Q137 superseded the original README exclusion: its hero pair now shows the synthetic bubble demo (about 59 KiB
each); alt text/search wording and the capture guide match it. The existing board images are unchanged.

Proof on T130 includes desktop/phone before/after light/dark screenshots, both README WebPs and a 6.2-second
pan → bubble click → existing task-sheet recording. The seed uses createSetup only and prints temporary
data/config/project paths; browser, seed, recording and gate logs remain workspace-local and ignored.
Checks pass: root 2,228 tests / 90,245 assertions and typecheck; web 1,006 tests / 79,452 assertions, zero check
errors/warnings and production build; both Android vector checks and the private public-source/Gitleaks guard.
No push, main move or deployment.

## T71: archive-fixture race and integration on 544e4f02

The pinned-browser manual check `43063818191` passed on GitHub. Parallel branch-
push check `43063818005` correctly skipped the release job, but found a pre-existing
race in project-archive.test.ts: saving an enabled event schedule starts its automatic
baseline immediately. The test added request 1 after saving, so a fast empty baseline
made it legitimate new work before archiving, contradicting the later empty-runs
assertion. An explicit poll barrier reproduced that exact failure without sleeps.
Seed request 1 before enabling the schedule, then assert it is seen and no work ran
before starting the archive checks. All archive/no-poll/fresh-baseline assertions
remain; production scheduler behavior and workflow trigger semantics are unchanged.
The workflow regression also explicitly preserves tag-push triggering.

Rebased the browser/check-workflow change onto approved main `544e4f02`, retaining
all incoming timeline, Android graph and continuation content; DESIGN merged cleanly.
Full exact-tip local gates and one fresh manual GitHub check are recorded on T71.
Only the owned temporary ci/release-check branch may be updated (with an exact lease
because this is a rebase) and deleted after a green run. No main or tag movement is
part of this repair.

## T71: pinned browser and a non-publishing release check

Retagged Release run `43057627821` failed in the Markdown browser beforeAll, not
in the five repaired tests. With CHROMIUM_BIN unset, the old test launched PATH
`chromium`: the runner image installs a rolling full Chromium snapshot via a
system symlink, not a pinned test browser. Its 25-second timeout expired amid
D-Bus startup diagnostics. Neither a specific D-Bus bug nor a sanitizer failure
is established by that log.

Checks now install/hash-check/cache Chrome for Testing headless shell 157.0.8103.50
and export its exact path. The shared browser test support uses concurrent output
draining, a 90-second bound inside the 120-second hook, private profile, explicit
non-desktop bus address, headless/resource/background-service flags and owned
process-group cleanup. Sandbox disabling is explicit for downloaded binaries on
Ubuntu CI (AppArmor namespace restrictions), or automatic only for root; normal
local launches retain their sandbox. No real DOM coverage is skipped or mocked.
The repository search found only user-markdown.test.ts using that old launcher.

Release workflow now has a read-only shared checks job for manual dispatch and
the temporary ci/release-check branch. Only a successful push-tag event can enter
the separate write-permission draft job. Manual checks, including dispatches on
a tag, cannot build/upload/publish release assets. Regression tests enforce that
separation and the browser pin. Exact local gates and the GitHub check URL/status
are recorded on T71. Main/tag changes remain owner-only; the throwaway branch is
removed after its checks conclude, not before a queued checkout can read it.


## Android graph integration on the timeline (Q134)

Rebased the three-commit Android graph stack onto the deployed timeline tip `ca47e56e`. The only conflict was
DeviceSettings: both global `timelineNewestFirst` and backend/project-scoped `projectTasksView` are retained.
TaskSheet, the new timeline section/order controls and TasksPanel merge without conflicts. CONTINUE keeps every
section from both sides; DESIGN keeps graph and timeline contracts. A JVM regression round-trips both preferences
and checks that changing either leaves the other alone.

Q134 authorizes the exact integrated tip for push and watcher-only main deployment after sequential Android,
protocol-generation, root, web and public-source gates. Exact-tip counts and the target hash are attached to the
integration report; earlier graph/timeline counts below remain historical. Existing T115/T116 graph and T118 timeline
UI proof remains applicable: no new UI behavior was introduced by the conflict resolution. No phone APK, phone
install, physical-device operation or manual deployment is part of this integration; the required debug assembly is
only a verification gate. The separately requested phone build waits for the owner's next message.

## T118 integration on the pilot release fix (Q133)

Rebased T118 onto the checked pilot fix `de189883`. Runtime files merge cleanly; CONTINUE retains every section
from both sides and DESIGN keeps the pilot contract plus the timeline reading design. Q133 authorizes pushing
this exact combined tip and moving main after full sequential root, web, Android and public-source gates.
Earlier T118 counts below describe its isolated tree; final combined checks and the target hash are attached to
T118. No phone install, physical-device operation or manual deployment is part of this integration. The separate
Android graph stack is left untouched for the owner's next request.

## Task timeline reading (T118)

Web and Android place Timeline between Report and Feedback, including navigation. It stays folded initially. The
header has a separate named order icon/tooltip; newest-first is the default. Web persists the global choice at
`aiki.timeline-order.v1`; Android uses `DeviceSettings.timelineNewestFirst` and the existing repository/DataStore.
Opening, reversing or filtering starts at the newest end (top for newest-first, bottom for oldest-first). Live data
updates do not force a scroll jump. Existing endpoint ordering/history, filters and feature gates are unchanged.

The chosen design is a calm row rather than nested event cards: kind/outcome-tinted icons, actor and relative time,
exact time on hover/long-press, one-line labels, expandable secondary text, status transition chips and local-day
separators. Web events scroll within 400px / 48dvh with contained overscroll. Android uses a bounded LazyColumn at
400dp / 36% of screen height and horizontally scrolling filters. T113 header/refs/composer/IME budgets are untouched;
TaskSheet changes only section placement, web order-control wiring and the Android timeline call.

`packages/server/scripts/task-timeline-demo.ts` provides 49 synthetic events across four days and all seven wire
kinds, plus Report/Feedback context, on a createSetup-only backend. It prints fresh data/config/project paths.
T118 artifacts have desktop/phone web and emulator before/after light/dark screenshots, oldest-first states, an
11-second Chromium screencast and a 14-second native scrolling/toggling/details/time recording. Browser assertions
verify bounds, sorted endpoints, reload persistence, newest-end positioning and inner scroll leaving the sheet
alone. Android persistence was checked across force-stop/relaunch. No physical device or real task/provider data.

Checks pass: root 2,217 tests / 81,296 assertions and typecheck; web 999 tests / 70,551 assertions, zero check diagnostics
and production build; Android 823 JVM tests / 110 suites / two skips / zero failures or errors, debug assembly and
lint (44 warnings, one hint, no errors). Heavy gates ran sequentially after a transient host EAGAIN burst; Gradle
daemon stopped after builds. Isolated runner setup errors (overlong Unix-socket TMPDIR and missing USER) were fixed
in the runner environment. Public-source guard/Gitleaks pass. Proof and runner output stay workspace-local and ignored.
Owned proof backend, Vite, Chromium and emulator were stopped by recorded PIDs. No push, main move or deployment.


## T71: release-runner prerequisites and deterministic deploy assertions

Release run `43047820705` at `b7cf8f27` failed before any draft/assets were produced.
Four workspace tests (schedule, two worker-isolation cases, storage) threw ENOENT
for `jj`. Release CI now installs hash-pinned jj 0.47.1 before tests and reports
Bun/jj/git/date versions. A clean runner-like environment with no jj reproduces all
four; adding that exact binary makes them pass even with no Git/jj user identity.
No workspace test is skipped. Existing optional fish/zellij skips remain explicit
when those tools are absent; they did not cause these failures.

The deploy fixture compared shell `date +%s%3N` with JavaScript Date.now() to infer
ordering. Its failed assertion did not preserve either timestamp, so the exact
runner clock/format discrepancy is not recoverable. Ubuntu 26.04 container testing
alone did not reproduce it; a deliberately incompatible date width deterministically
reproduced the identical false empty-after-restart result. The fixture now uses a
shared append-only request/restart trace, with before/after/drain assertions and an
extra bad-date regression. Production deploy/health logic is unchanged. See
`docs/research/pilot-release-ci.md` for evidence boundaries and all five causes.

The fixed tip is based on the tagged commit, not a moved tag. Exact-tip full gate
results are attached to T71; no push, tag rewrite, main move or publication is part
of this repair. The owner decides how to advance main and the unshipped pilot tag.

T127 `oxwtksrp` is included beneath this repair so the release README and agent
installation guide match the tagged release. Both continuation sections are retained.


## T127 coding-agent installation guide

README now includes a copyable agent prompt linking to `docs/AGENT-INSTALL.md`.
The guide follows installer/CLI flags and errors, pins the pilot prerelease
explicitly, verifies the installer checksum, and offers an exact-public-commit
`--ref` fallback. Human STOP points cover device/provider sign-in, project access,
optional user service and HTTPS phone setup. No installer, CLI, tests or workflow
changes are included.

Rehearsed the source fallback from main `b7cf8f27a8e7648e6866fbde0e6aed4870643eb6`
in `env -i` with a temporary HOME/USER, explicit temporary data/config and loopback
port 27317. Private Bun 1.4.4 installed 255 frozen dependencies and built the web;
version/doctor, status and `/aiki-local.json` passed. Headless Chromium rendered
Welcome; T127 retains a desktop screenshot without pairing grants. Wait for rendered
Welcome rather than taking a fixed-virtual-time screenshot of the blank shell.
Stopped backend/browser by recorded PID, verified backend stopped, purged the test
installation and removed its temporary tree. No real backend or home state touched.
Release download/checksum execution remains untested because pilot assets were not
yet published; no provider login, project access, service or phone setup was done.
Root typecheck and the private public-tree guard (including Gitleaks) pass after
frozen workspace dependency installation. No push, main move or deployment.

## T71 pilot integration and tag authorization (Q130, part 1)

The owner approved integrating and tagging `v0.1.0-pilot.1` as a prerelease, retaining
the existing signing identity. The five release changes were rebased onto the approved
README/graph/search main `puntwxmt` / `b07b7b94`. CONTINUE retains every section from
both sides; DESIGN combines the pilot contract and graph/search design, and the
README keeps the selected graph-led homepage. README/INSTALL now use the exact pilot
installer and explicit `--version`, with signed APK/release links and honest platform,
HTTPS and no-phone-push limits. Downloads appear only once the draft is published.

Part 1 freezes and checks the integrated tip, pushes that exact commit and annotated
tag using the approved account, then moves main through the watcher-only deployment
path. Exact-tip gate results and the final hash are recorded on T71; earlier counts
below are historical. Part 2 will wait for the workflow draft, rebuild/sign/attach the
exact tagged APK/checksums/notices, and present the verified draft before publication.
No signing key replacement, physical-phone action or manual deployment is authorized.

## T71: first pilot release preparation (not authorized to publish)

Imported the earlier `yoopyppp` audit onto the then-current main as the first local
commit; its historical findings remain in `docs/research/pilot-release-audit.md`.
Target is `v0.1.0-pilot.1`. No tag, push, publication, main move, deployment or
physical-phone operation was performed. The owner's Q121 decision is local signing,
external owner-held key plus backup, manual APK attachment and Sora LGPL notices.

`check-public.ts --public-ci` skips only private terms and always requires Gitleaks;
local/default mode still fails without a nonempty private denylist. Six guard tests
pass; actual clean-config CI-mode success and default-mode missing-denylist failure
were checked. The workflow installs SHA-256-pinned Gitleaks 8.30.1, stages a draft
release, and supplies an installer checksum. The owner must still run the private
scan on exact public refs before the separately authorized tag push.

Android version input is `aiki.version`, `AIKI_RELEASE_VERSION`, or the CI tag;
dev defaults to `0.0.0-dev` / 1. Pilot.1 is `0.1.0-pilot.1` / 1000001, pilot.2
is 1000002. The bounded major/minor/patch/stage formula and regressions are in the
build/README. Offline Settings → About and licences includes Sora notice/full LGPL,
source/replacement instructions and font/Termux texts. Google's OSS plugin 0.13.0
produces the release dependency catalogue (287 metadata rows in this build), shown
by its bundled v2 viewer; some generated entries are licence URLs rather than full
text. Debug deliberately gets the plugin's placeholder catalogue, not release proof.
The notices/source bundler hash-checks complete pinned Sora source and two module
source JARs, and includes the exact selected Aiki source snapshot for relinking.

The local key was created outside the repository with protected directory/files;
paths and the public certificate fingerprint are in the private T71 handoff. **The
owner must securely back up key and password before distribution.** Signing builds
use env isolation, explicit empty private properties and neutral production values,
check actual BuildConfig/notice assets plus release manifest/DEX seams, align, sign,
verify and record the APK hash/version/certificate/source commit in a manifest.
Public package is `io.github.mitzacoder.aiki`; no backend/Firebase/relay values ship.

T71 artifacts show settings before/after, the signed About screen, Sora/source notice,
generated dependency list and an interaction recording. An owned emulator completed
fresh signed installation, same-key code 1000001 → 1000002 `install -r`, saved
synthetic backend survival after upgrade and a cold process start, and refusal of
an unsigned same-code upgrade (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`). Screenshots
and a second recording capture that lifecycle. Only a reserved invalid-domain
backend was saved; no server, real account/provider or physical phone was used.
The owned emulator was stopped by its verified PID. Retained-auth renewal and an
invited tester's actual HTTPS/matching-code pairing remain separate acceptance work.

Checks pass: fresh frozen Bun install; root 2,148 tests / 24,519 assertions and
typecheck; web 929 tests / 13,765 assertions, zero check diagnostics and production
build; Android 813 JVM tests / 108 suites / two skips / zero failures or errors,
debug assembly and lint (42 warnings, one hint, zero errors); version regressions,
neutral signed release builds and release seams; protocol generation; private and
public-CI source guards with Gitleaks (including the workflow's exact pinned binary).
No runtime changes followed those gates. `docs/RELEASE.md` has the exact assets and
owner procedure; `docs/releases/v0.1.0-pilot.1.md` has friend-facing notes. After merge,
freeze the approved commit and rebuild source/manifest/notice snapshot for that exact
commit before authorized tagging. The publisher still reviews LGPL/relinking and
Google/dependency terms; this work is not a legal certification.


## Android canvas polish (T116 follow-up)

Canvas cards now reserve a fixed 104dp body instead of 180dp: ID/status, two title lines and one compact meta row.
The crew band stays 32dp; the inter-card gap drops from 28dp to 12dp. Initial font-scaled geometry still freezes
until Regroup, so status, report, worker and title replacements never resize or reposition slots. Shared web-model
vectors were regenerated with these native dimensions, not with a changed web engine.

Changes is a badged history icon beside Search; its tint/dot and spoken name convey connection status, with the
full status/age in overflow. Counters get their own full-width scroller. Family/Fit/zoom/Regroup use floating 48dp
icon controls, and the redundant detail-level label is gone. Dots have 132–168dp screen-space label budgets, explicit
word-boundary wrapping to two lines, end ellipsis, visible-task counts, unique needs-you badges and status-mix rings.
Their anchors remain in world space; readable minimum spacing takes precedence over fitting every family into
one phone frame, so browsing may require panning. No detached-label/grid redesign was introduced.

One Android build/test/lint invocation passed: 850 tests in 112 suites, two opt-in skips, no failures/errors;
assembly and lint passed (43 warnings, four hints, zero errors). Five new tests cover label wrapping/ellipsis,
unique needs-you counts, compact fixed budgets/meta and screen-space dot spacing. Root tests passed once (2,212 /
81,270 assertions / 183 files), as did typecheck, both vector checks and public-source/Gitleaks checks. The root
package has no `check` script; no web UI source changed and web-only checks were not required.

T116 has two new dark phone screenshots (cards/chrome and dots) and a 9.2-second native family → canvas → dots →
different-family recording, using only a scrubbed busy backend and the assigned owned emulator. Existing T116
screenshots are the before reference. Light/large-font captures were not repeated in this shortened pass. Direct
on-device screencap/pull was needed for the dot image: exec-out captures sometimes contained incomplete buffers.
The fresh frame was checked against native bounds before saving. No production hook, real data, physical phone,
push, deployment or main movement. Scratch backend and owned emulator stopped after proof.

## Native graph canvas and live changes (T116)

Rebased T115 onto the combined-search/web stack first; Android rebase gates passed (831 JVM tests, two skips).
Graph now has a stable whole-project canvas beside the family reading view. The Kotlin layout mirrors the web engine:
indented tree slots, two arrival reservations, retained hidden IDs/families, sticky reparent/overflow Regroup and
collision-only displacement. Native geometry is larger for real system text; status, crew and reports are not inputs.
Pan, pointer-anchored pinch, double-tap and 48dp Fit/+/- controls preserve world coordinates. Cards yield to readable
one-line pills, then world-anchored family dots; asymmetric hysteresis and a touch-spacing minimum prevent tiny text
and overlapping targets. Near-viewport nodes/crew alone compose. Solid/dotted/dashed-arrow/dash-dot routes preserve
subtask/found-while/blocked-by/related meanings; nonparent routes are scoped to the selected family/task.

The top is compact: counters under the view choice, icon search, network Graph icon, Show closed/overview/legend in
overflow, shorter family header and a small connection state by Changes. Keyed creatures stand above cards, type/sway,
breathe/rest with z, mark failure, travel on reassignment and fade on arrival/finish. A report produces one drawn spark.
A changed card glows for 1.5s; closed work keeps a faded fill for 4.5s before hiding without releasing its named slot.
Reduced motion/background lifecycle/obscuring phone dialogs stop decoration; Updated/report/status information stays.
Changes keeps 50 session-only fixed-window batches, latest report lines, unseen count and task-focus links; off-screen
changes reveal only by explicit tap. Back closes sheet, selection, canvas, then leaves family view. The board and
panel stores now expose the socket generation of their completed reads, so reconnect baselines wait for board, workers
and threads rather than a timer. Weak board-scoped bounded history survives responsive remounts; remounts reset baseline.

`bun apps/android/scripts/graph-canvas-vectors.ts --check` compares shared synthetic layout and change vectors against
the actual web engine. Fourteen new JVM tests cover exact geometry, named/reserved slots, no overlap, cycles/reparenting,
frozen options, detail hysteresis, pointer/world anchoring, dot target spacing, change diff/batching/history bounds,
reconnect baseline and Back stages. No protocol, backend or web source changed. The two internal read-generation tags
are not wire fields and reuse shared reads. Board refresh includes the socket generation in its key, including fast
reconnects that conflate the intervening non-ready state; generation tags are captured before each request, not at acceptance. No new dependency or production debug/injection hook was added.

Checks pass: install; root 2,212 tests / 81,270 assertions, typecheck; both web-model vector checks; Android 845 tests
in 111 suites, two opt-in skips, zero failures/errors; debug assembly and lint (43 warnings, four hints, zero errors).
Builds use an explicit empty private-properties source. Public-source denylist/generic checks and Gitleaks pass.
Web checks were not rerun for this Android/docs-only work. No flaky root retry. Native proof on T116 has light/dark
cards/pills/dots, family-before/compact-after, Changes, a tablet canvas/side panel, 2.0 system text, reduced motion and
stale data after backend closure. The final 24-second emulator recording uses real injected two-pointer MotionEvents:
family to pills/dots, Fit, another family, report spark, reassignment, review glow, completion fading, arrival and Changes.
The shell-only scratch gesture driver is outside the app/repository. No terminal/backend display is recorded.

Proof used one scrubbed createSetup busy backend, an owned emulator only, native Settings to add its separate scratch
address, and no physical phone or real task/provider data. Removing an adb reverse does not close its existing streams;
that attempted reconnect probe stayed Live and is not claimed as a reconnect rehearsal. Baseline reset is unit-tested;
actual backend closure separately proves stale data/connection state. No physical-device frame/battery measurement or
full TalkBack session is claimed. Both backend and emulator are stopped, font scale restored, no push/deploy/main move.

## Android family graph, first part (T115)

Based on web graph `qxxtnuzp`. Native Tasks now offers Graph beside List/Board, with backend/project-scoped view
preferences and the old global preference as fallback. The phone shows one family in cycle-safe tree order, a
mixed-status/progress header, overlapping summary highlights, next matching family, picker and weighted search.
Status words/marks accompany colour; quiet is separate from failure. Cards have static state-specific Compose
creatures (typing hands, resting eyes, failure cross), avoiding decorative motion even with reduced motion off.
Selection is an ID: the scrollable bottom sheet updates through board/worker replacements and survives disappearance;
wide windows use a side panel. Parent/subtask/dependency links select endpoints; Open task uses the existing TaskSheet.
Back closes the sheet, then selection/highlight, then returns to List. Loading/empty/all-closed/no-match/offline states
keep their distinct messages. Controls use 48dp targets, strong foreground text and large-font wrapping.

`features/tasks/graph/` separates pure semantics, cards, details and orchestration for T116's later canvas. The shared
synthetic JSON vectors are generated from the actual web model by `bun apps/android/scripts/graph-vectors.ts`;
`--check` detects drift. Twelve new JVM tests cover web parity, hidden ancestors, cycles, numeric ranking, overlapping
counts, dependency diamonds, quiet boundaries, family order, closed selection, scoped preferences and Back transitions.
No protocol, server or web source changed. Whole-project zoom/pan, cross-family drawn edges, travel/sparks and the
change list remain T116; physical-device profiling and an actual TalkBack session were not performed.

Checks pass: Bun install; root 2,190 tests / 81,226 assertions, typecheck; web-model vector parity; Android 825 JVM tests
in 109 suites, two opt-in skips, zero failures/errors; debug assembly and lint (41 warnings, one hint, zero errors).
Builds use an explicit empty private-properties source. Public-source guard/Gitleaks pass. Web checks were not rerun
for this Android/docs-only change. One new cycle-order test initially omitted two valid descendants; its assertion
was corrected, not the model. No flaky root retries.

T115 proof has phone light/dark list-before and graph-after, counter/search, same-sheet live status/report updates,
existing TaskSheet, missing/empty/closed/no-match/offline, 1.3/2.0 system fonts, tablet side panel and a 14.3-second
native interaction recording. The verified tablet and 2.0 control shots supersede two captures of prior frames during
navigation/resize; use the final-tagged filenames in the task's proof index. Screens were driven only on the owned
emulator against scrubbed createSetup busy-demo backends; no physical phone, real task/provider data or credentials.
A second temporary backend used a separate app address because the existing device-auth identity pin correctly
rejected replacing the first origin's backend. Native add-backend UI was used; no pin/auth bypass. Both synthetic
backends and the owned emulator are stopped. No push, deployment or main-bookmark movement.

## T114 integration on T113 (Q126)

Rebased T114 onto T113 `pnyuzyvu` / `5ed27fea`, above T112 F20. Runtime files merge cleanly; the only conflict
was the continuation introductions, all retained below. Q126 approves public push and main-bookmark deployment
of the exact combined tree after full root/web/Android/public gates. No phone install, physical-device operation,
manual deployment script or service restart is part of this integration. Prior T114 counts below describe its
original isolated tree; combined gate results and the target hash are attached to T114.

## README homepage selected (T117 / Q127)

The owner chose product-page option A with the new task graph as its hero. The change is rebased onto main
`uzqvpyxz` / `b38689b5`; the only conflict was these continuation introductions, both retained. README.md now
opens with the existing icon, a short coordinator/worker pitch, light/dark graph imagery and three benefits.
Source-ref installation stays explicit until a pilot release is tagged; Linux/macOS/WSL, Android APK, provider
policy and phone-push limitations remain honest. A secondary board image shows the same project in columns.

The former root README's operator/development sections live in `docs/OPERATIONS.md`, linked from the homepage;
stale no-auth/API-only descriptions were corrected. The unselected drafts, their renderer/demo script and unused
images are removed. Only four lossless screenshots remain under `docs/assets/readme/`, all below 110 KiB, with
provenance linked in the hero caption. The icon is referenced directly from the existing web assets.

New captures use the current `packages/server/scripts/task-graph-demo.ts` busy scenario on a createSetup-only
server. It printed its temporary data/config paths before use. The hero crops the real graph viewport to three
family groups, status/needs-you counters, search and worker/thread creatures. No real model, installed data,
provider credential, physical device or native Android screenshot is involved. The preview renderer and browser
profiles/logs stay in ignored temporary output. T117 holds eight final screenshots (first two screens at desktop
and phone widths, light/dark) tagged after, plus a short real desktop scrolling recording. Image loads, matching
colour variants, jump anchors and no horizontal page overflow pass. Bun install, root typecheck and the public
source guard/Gitleaks pass. No fresh installer/provider/device test, push, main move or deployment was performed.

## T113 integration on F20 (Q122)

Rebased T113 onto F20 `vkxymkty` / `44f8dfaa`, preserving expanded-question answering and compact refs/keyboard-safe
replies. Runtime files merge cleanly; the only conflict was these continuation sections, both retained below.
Q122 approves the exact checked integration tree for public push and main-bookmark deployment. No phone install,
physical-device operation or manual deployment script is part of this integration. Earlier test counts below are
pre-integration evidence; the final combined gate log and outcome are attached to T113.

## Combined task search (T114)

Web and Android extend the existing task List/Board filters; no second list, graph changes or TaskSheet/header edits.
List search is one ranked list with safe title-letter highlighting, body snippets, dimmed ancestor context, empty
state, Escape/Clear and project/backend-scoped persisted queries. Existing top-level/linked/archive filters still
apply. Search Show closed shares the recently-closed section choice. Board shares the query/matches/highlighting,
but deliberately keeps its status columns and normal per-column order. Clearing search restores ordinary families.

Own fuzzy + BM25 implementations were chosen over JS-only uFuzzy/MiniSearch so Kotlin has the same ranking,
constants and shared fixture expectations without a second library's behavior. The scorer chooses the best
subsequence, rewards starts/runs/early letters, and weights title above refs. Incremental BM25 indexes description,
report now/results/next and feedback; last-word prefixes use AND semantics. Feedback is read asynchronously from
existing timelines only for tasks with feedback, cached by timeline revision, not fetched per keystroke. Existing
ref metadata supplies ref titles. DESIGN documents the exact disjoint score bands: exact 4, fuzzy 2–3, body 1–2.
Shared JSON tests exercise scores, ranges, merge order, IDs/refs and family context in both languages; extra unit
cases cover incremental updates/deletions, prefix boundaries, eligibility and cyclic parents.

Synthetic 5,000-task warm Chromium engine benchmark (30 samples/query, ten queries) measured median 0.5–5.3 ms,
worst query p95 6.3 ms and maximum 6.7 ms; initial indexing 114.3 ms. Most searches meet 5 ms, but the broad `tel`/
`tele` prefixes do not consistently meet the requested sub-5 ms target. Android host-JVM unit benchmark measured
median 2.50 ms, p95 5.65 ms, maximum 6.59 ms across 200 calls. These include scoring/merging/snippets/ranges, exclude
UI rendering, and are not device CPU measurements. The synthetic board has repeated short titles, sparse PR refs,
unique document words and no parent links; small shared fixtures separately verify family behavior.

T114 artifacts hold desktop and phone-width web before/after in light/dark, Android emulator before/after, body
snippet proof, actual web/emulator typing videos and web timing samples. Additional Board captures verify that
switching views keeps the query; Android query also survived an APK update/relaunch. Proof uses only a createSetup
throwaway backend with effective data/config/project paths printed, a headless Chromium session and an isolated
emulator on a checked-free letter track. No physical phone, installed server data, push, main move or deployment.

Checks pass: fresh Bun install; root 2,164 tests / 24,544 assertions and typecheck; web 946 tests / 13,799 assertions,
zero check diagnostics and production build; Android 815 JVM tests / 108 suites / two opt-in skips / zero failures
or errors, debug assembly and lint (42 warnings, zero errors). An initial lint error for a Unit-returning remember
was fixed by making the non-snapshot index an explicit memoization cache; final Android gates pass. Public-source
denylist/generic guard and Gitleaks pass. Benchmark/proof material is ignored workspace-local data, not source.
Owned demo backend, web process and emulator were stopped by their recorded PIDs.

## Answer from expanded task questions (T112 / F20, awaiting review)

F20 supersedes the original read-only question-dialog behavior below. Editable open questions now have a fixed
answer footer in the expanded view on web and Android. Long rich text scrolls independently above it. Prepared
answers have their own bounded scrolling area, including many/long choices, so the composer and send action stay
available. Both presentations edit the same card-owned draft and invoke the same guarded send action/busy/error
state. Successful answers clear the draft and dismiss the dialog; failures retain both draft and visible error.
Warnings keep their existing inline note/acknowledgement only; resolved/read-only cards get no new answer controls.

Web reuses a local form snippet for both presentations and fits only the question dialog to visualViewport height
and offset, including overlay-keyboard panning. Resize/scroll listeners are removed with the dialog. The modal
textarea uses 16px type. Android reuses `QuestionAnswerForm` with card-owned state; its edge-to-edge Dialog consumes
safe drawing/IME insets, and bounds the choice area against the space above the real keyboard. Neither TaskSheet
nor task-header/graph files changed, keeping this separate from T113.

F20-tagged evidence on T112 has synthetic before/after screenshots, independently scrolled text/footer captures,
mobile layouts and keyboard-footer views, plus browser and emulator recordings. The browser recording joins two
actual captures: shared draft/choice/duplicate-send checks, then error retention/manual answering and keyboard
viewport checks. Mobile-web keyboard geometry is emulated in real Chromium (layout-resize and visualViewport-only
models); a desktop headless browser has no OS IME. Android proof uses the actual emulator keyboard, checks unchanged
footer bounds while reading, reopens a shared draft and submits both prepared and manual answers to createSetup.
All demo data/config paths were temporary and printed. No physical phone or real data was used.

Checks pass: fresh frozen Bun install; root 2,142 tests / 24,500 assertions and typecheck; web 924 tests / 13,755
assertions, zero check diagnostics and production build; Android 809 JVM tests / 107 suites / two opt-in skips /
zero failures or errors, debug assembly and lint (41 warnings, zero errors); protocol check (337 DTOs / 91 requests).
UI sources were unchanged after these gates. Owned demo processes/emulator are stopped. No push, deployment or main
move. F20 remains handling until the result is reviewed.

## Compact task refs and keyboard-safe replies (T113)

Based on T112 `xmswpkqr` / `ed2314a8` (now main), through an empty integration parent. No graph or question-card
files changed. Web `TaskRefs` and Android `TaskRefs` start folded per opened task: kind counts, an explicit unknown
count, and failing/running PR checks first; otherwise open/closed/unknown totals. Closed/merged PR checks are historical.
The disclosure replaces the full ref wall without another status strip. Expanded refs have internal scrolling, capped
at 15rem/240dp and a quarter of available height; every ref remains reachable, with existing links/cards preserved.

The Android IME bug was independently reproduced with a real emulator keyboard: safeDrawing/imePadding already
removed keyboard space, but Column measured the non-weighted, unbounded header before the reply. The header consumed
all reduced height, so a focused text field and its send control had no visible space. Collapsing refs alone would
leave the same failure for expanded refs or long titles. The fix budgets from actual inset-reduced constraints:
scrollable header at most 35%/360dp (also reserving 220dp outside it on short screens), task-local input at most
20%/160dp, and the body gets the remainder. Below 400dp available height section chips temporarily yield to the body
and its padding becomes 8dp. The actual sections remain scrollable; no draft state is recreated. Shared chat composer,
IME policy, image intake and sending semantics are unchanged. This does not add Android task-draft backend sync.

Web similarly bounds the header at 35%, follows visualViewport height/offset above mobile keyboards, caps only the
task reply textarea at 20% of that height, and cleans up listeners on close. Existing task draft sync is unchanged.
Pure web/JVM regressions cover summaries, historical checks and unknown state; web also tests viewport updates/cleanup.
`apps/web/scripts/task-sheet-fixture.ts` is a synthetic long title and twelve mixed PR/issue refs, including failing,
running, draft, merged, closed and missing state. Proof used isolated createSetup storage/config/agent paths, a fake
host gh in a temporary PATH, retained ViewClient watch, dedicated headless Chromium and emulator-only Android.

T113 artifacts contain before/after desktop/phone web screenshots and interaction recordings; Android full-header and
real-IME hidden-composer baselines, compact/expanded/last-ref after states, multiline retention and actual send above
IME, plus recordings. Browser assertions cover 1280x900, 390x740, 320x568 and short 420px visual viewports, all 12 refs,
keyboard disclosure, bounded scroll, no horizontal overflow, long drafts, visible send and per-task disclosure reset.
A separate 343dp-wide Android proof scrolls the body above the real IME, preserves all six draft lines across keyboard
hide/show, sends successfully, then repeats typing/body scrolling/send on a no-ref task. Short windows trade section
chips for actual content. Proof moved from the initially free emulator to another owned emulator when T112 reused it;
T112's device was left alone. The owned final emulator, Chromium and synthetic backend were stopped after capture.
No real task/provider data, physical device, push, bookmark move, deployment or protocol/server behavior change.

Checks: fresh Bun install; root 2,137 tests / 24,478 assertions and typecheck; web 924 tests / 13,743 assertions,
zero check diagnostics and production build; Android 811 JVM tests / 107 suites / two opt-in skips / zero failures,
debug assembly and lint (40 warnings, one hint, zero errors). Android builds use an explicit empty private-properties
file. Public denylist/generic guard and Gitleaks pass. Main stayed untouched.

## Graph hardening (T110 / stage 4)

The isolated demo accepts `GRAPH_DEMO_SCENARIO=large GRAPH_DEMO_TASKS=500` (100–5,000 tasks). Its deterministic fixture
covers varied families, a 12-level chain, a 42-task family, long unbroken titles/URLs, 36 questions and crowded crew.
`/status` toggles T3; `/batch` toggles T3/T4 together. All remain throwaway test-setup writes, not graph actions.

Viewport culling mounts only cards/pills and crew within 180 screen pixels; dots mount no cards. Association indexes
replace per-task ownedTasks scans; one lazy dependency index per model replaces repeated graphHoldsUp walks. Layout
and route signatures retain geometry through status/clock-only replacements. Roving arrows use logical boxes, not
only DOM; keyboard reveal is immediate before focusing a newly mounted card. These were measured fixes, not a renderer
rewrite. Standard 100/500/1,000-task Chromium mount times: 52/155/381ms; 2Hz batch-update p95: 35/63/113ms; interaction
p95: ~16.8ms at all sizes. The 100-task budget passes. Heap/DOM/raw timings and method are in T110's artifacts.

Known limit: a broad 500-task search exposing many cross-family routes still has 117ms pan / 83ms zoom p95, despite
~65–70ms update p95. Software-rendering traces mostly show browser/program work. Viewport-sized SVG and removing
card grayscale trials did not improve it and were reverted. Dense-route paint needs another focused pass; do not claim
60fps for every filter. The 1,000-task updates also exceed the smaller-board 100ms target. No physical-phone frame
budget or real assistive-technology user certification was attempted.

Graph-only contrast tones cover Jarvis/Neutral light/dark, including muted text; stronger subtask strokes match the
legend. Summary counters wrap on desktop and reserve Changes space; phone keeps horizontal scrolling. Controls wrap
under 200%-equivalent layout/20px root fonts. Touch view/legend controls are ≥44px. Long titles wrap before clamping;
reason marks/progress no longer shrink into each other. The static Updated mark now appears only under reduced motion
(the old selector accidentally overrode display:none). Changes focuses its named dialog and returns focus on Escape;
reports say worker ID + task ID + latest line, even in a batch; status entries include short titles.

Real Chromium proof: before/after desktop/phone light/dark, Neutral contrast pairs, long-panel and 200% shots, an 11.8s
desktop tour and 10.4s touch tour. Touch pan/pinch, family switching, tap selection and sheet scrolling passed; scrolling
never moved the camera. Keyboard crossed culled regions, opened the existing task sheet and returned from Changes.
AX controls were named; computed contrast audits had no sampled failures; reduced-motion styles retained information.
All five states passed with cards. Actual prefers-color-scheme dark did not reproduce a light washed-out selected
project row; the existing faint sidebar subtitle was not changed. No prototype route or old bubble renderer remains.

Checks: root 2,180 tests / 81,194 assertions; web 962 / 70,449. Web check zero errors/warnings; web build, root typecheck,
and public-source/Gitleaks pass. No flaky retries, protocol/Android changes, live data, push, deployment or main move.
Ignored `.preview/s4-*.ts` drivers and `.preview/s4/` measurements/proof reuse Vite 5199, CDP 9399, the isolated demo,
and the same stage-3 localStorage recipe. The task's handoff artifact has exact commands and the remaining limits.

## Live graph changes and crew activity (T109 / stage 3)

The graph has a bounded session-only Changes popover/phone sheet with unseen-entry counts, fixed one-second burst
batching and task focus links. Pure `task-graph-changes.ts` copies watched fields before diffing board/worker/thread
snapshots; it also owns explicit baseline reset, announcement throttling, waiting/quiet dates and dependency counts.
`task-graph-session.svelte.ts` keeps selection, history/read state and short-lived emphasis by backend/project scope.
Responsive sidebar remounts preserve selection and the list; reload deliberately starts a new session. Board, workers
and threads expose `refreshing` fences so reconnect waits for all authoritative lists, not a hydration timeout.

A keyed `GraphCrewLayer` preserves identity across cards for 400ms reassignment travel and arrival/departure fades.
Existing busy/resting/failed art remains; actual changed nonempty reports alone spark and still appear in the panel.
Changed cards glow once for 1.5s; reduced motion uses a static Updated mark without travel/sparks/glow. Completed or
dropped cards stay faded about 4.5s, or until deselected, before leaving their reserved slots. Off-screen changes have
an explicit reveal chip; watches never pan the camera. Waiting cards have local dates; quiet age is spoken in days;
the panel counts direct/indirect unfinished dependents, with holds up N on cards for two or more direct dependents.
Freshness sits beside the summary. A single polite change region is throttled to five seconds. Hidden tabs pause
art and display-clock work; off-screen crew also pause. No graph task writes, durable replay or protocol changes.

Real Chromium proof: desktop 1440×1000 and phone 390×844 light/dark before/after with the change list open, a 15-second
recording, and a reduced-motion shot with computed-style checks. Browser assertions retained all 80 card transforms
and the camera through report/status watches, kept existing slots through arrival, observed completion departure,
preserved selection/list across both responsive breakpoints, and kept exactly eight entries across a reconnect even
with real offline changes. No browser errors. CDP offline does not close existing sockets: close only the synthetic
backend socket by port (not Vite's socket, which reloads the page). Global reduced-motion CSS uses a tiny nonzero
transition duration; test transition-property:none rather than equality to 0s. Ignored scripts/recipe in `.preview/s3*`
use busy demo controls, Vite 5198 and CDP 9398. Demo adds complete/fail/question/answer/offscreen/batch-review/arrival
controls, all through the isolated test setup. No live data, hardware screen-reader certification, push or deployment.

Checks: root 2,175 tests / 80,717 assertions; web 957 tests / 69,972 assertions. Web check zero errors/warnings;
web production build, root typecheck and public-source/Gitleaks pass. An initial full run caught the old Quiet-only
label expectation; it now checks the deterministic fixture's quiet 3 d age. The corrected full run passed without
flaky retries. See the task artifacts for proof and the exact local browser recipe. Existing notes below are history.

## Crew readability polish (T108)

Crew bodies now measure about 25px at default cards zoom, using a tighter SVG frame and shorter antenna. Their
36px art stands wholly above the top-right edge, in the existing 12px crew reservation plus 24px fixed gap. Card,
family and pill geometry is unchanged; up to three creatures then +N, with busy/resting/failed faces retained.
Real Chromium measured 25.1–25.7px bodies and at least 6px clearance from ID/status on desktop dark and phone light.
Only those two requested after screenshots were refreshed. Web check: zero errors/warnings; web tests: 945 pass /
69,928 assertions; public-source/Gitleaks pass. No root/build rerun for this timeboxed art/CSS fix, no protocol or
server changes, main movement, push or deployment. Owned demo/Vite/Chromium processes stopped by PID.

## Compact cards and world-anchored overview (T108 follow-up)

Resolved the earlier overview review point: dots now sit at each region's world-space centre. Every detail level
uses the same translation/zoom camera. Only dot label font/dimensions stay screen-sized; nearest-neighbor spacing
truncates title width and drops subtitles before overlap. `task-graph-family-dots.ts` owns anchors, collision-safe
minimum zoom and Fit of all anchors with label padding. No screen-space shelf remains. Click/Enter still enters
that family; actual background pan and wheel zoom move the dots. Phone layout detection uses the viewport media
query, not a temporarily narrow desktop sidebar during its expansion animation.

Bodies are 230×88px, with a fixed 12px crew reservation above (100px occupied total). The engine's new optional
`creaturesAbove` geometry keeps body/occupied/creature boxes accurate. Creatures overlap the top-right border only
when present, up to three then +N; no empty row or placeholder remains. ID/status, two title lines and one compact
meta row fit the body. Progress is N/M visually, full wording accessibly. Geometry is still independent of crew count.
Fresh desktop Chromium at 1440×1000 measured 16px titles at 1×, with 15 fully visible cards across three families.

Five new tests cover world anchors/pan/pointer zoom, no overlapping fitted labels on desktop/phone, subtitle density,
compact occupied boxes and stability across crew/status replacement. Refreshed only the four card after screenshots
and dots shot; the before set is unchanged. A new 7.3-second recording crosses cards→pills→dots continuously, pans
all ten anchors exactly 80×40px, re-enters a family, and verifies all 80 compact card transforms after live updates.
Ignored script `.preview/compact-proof.ts` uses the same isolated busy-demo recipe, Vite 5197 and CDP 9397.

Checks: root 2,163 tests / 80,673 assertions; web 945 tests / 69,928 assertions; web check zero errors/warnings;
web build, root typecheck and public-source/Gitleaks pass. No retries, protocol/server/Android changes, push,
deployment or main movement. Owned demo/Vite/Chromium processes stopped by PID. Earlier T108 notes below are history.

## Readable family cards (T108 / graph stage 2)

`TaskGraph.svelte` now keeps the stage-1 chrome/model and delegates rendering to small `graph/Graph*` components.
`GraphFamilyCanvas` retains `layoutTaskFamilies` across updates; `graph-family-camera.svelte.ts` owns only the viewport.
Cards have 16px titles, 14px small text, distinct reason/quiet marks, descendant progress and a fixed three-creature/+N
band. Strong status bands/tints replace bubbles; closed cards keep readable text with neutral/dashed styling. Parent
routes stay visible; other relationship patterns are scoped to selection/matches through `routeTaskFamilyEdges`.
Dead simulation, bubble model, camera/label placement and their tests were removed. Pure presentation, scoping,
spatial navigation, matching-fit and v2 persistence helpers live in `task-graph-cards.ts` (nine tests / 236 assertions).

LOD uses the smallest card font (14px), pill font 22px and height 64px; touch requires 44px targets. Family overview
uses screen-sized targets in shelf order to avoid overlapping titles for tall families. Cards/pills use engine world
coordinates; first desktop framing shows readable columns, while Fit shows all families. Phone renders one family,
selected first or most-needs-you, with previous/next and readable 1× vertical pan. Camera key is v2; v1 is ignored.
One roving Tab stop supports spatial arrows, Space, Enter, Home and Escape. Search/panel links reveal readable cards.
Regroup is explicit. Reduced motion suppresses LOD fades, creature motion and report sparks.

Real Chromium busy-demo proof on T108 includes desktop 1440×1000 and phone 390×844 light/dark before/after, pills,
overview, keyboard focus, and an 11.3-second recording. The recording asserts all 80 card transforms and the camera
stay unchanged after real report/Working→Review watch updates, then exercises phone family switching. Computed Jarvis
card text contrast was at least 13.74:1 light / 13.80:1 dark; blocker contrast 4.52:1 / 7.38:1. This is narrow Chromium
coverage, not a hardware touch or screen-reader certification. Ignored proof scripts use Vite 5197, CDP 9397 and the
isolated busy demo; the task's recipe artifact records setup and localStorage. No live data, prototype route or flag.

Checks: root 2,158 tests / 79,538 assertions; web 940 tests / 68,793 assertions; web check zero errors/warnings,
web production build, root typecheck and public-source/Gitleaks all pass. No protocol/server/Android changes, push,
deployment or main movement. All synthetic demo/browser/Vite processes are stopped by their owned PIDs.

## Family card layout engine (T107 / graph stage 2a)

Unused pure TypeScript engine in `apps/web/src/lib/task-graph-families*.ts`, with synthetic tests in
`apps/web/test/task-graph-families.test.ts`. Stage 2 should call `layoutTaskFamilies` with its previous return value;
provide full-board `familyId` for visible tasks with hidden ancestors. Named hidden slots/empty families survive until
`regroupTaskFamilies`. Fixed creature bands aggregate excess crew into counts, so worker/report/status replacements
never move anything. Reserved arrival rows accept new IDs; overflow expands locally, explicitly returning
`needsRegroup` and any unavoidable `movedFamilyIds`. Existing slot coordinates stay family-local and unchanged.
Reparented tasks stay pinned to their old families until regroup. Options are frozen between regroups.

Cards have world-space body, occupied (including crew), creature and independently compressed pill boxes. The engine
also exports border edge routing (blocked → prerequisite), legibility-safe cards/pills/dots hysteresis, screen-sized
family-dot title targets, fit-all/family and pan-only reveal. Camera translation is screen = world × zoom + {x,y},
not the older graph's world-centre convention. Pass actual font/pill metrics to `chooseFamilyDetail`; defaults are
16px card titles, 20px pill labels and 64px pill height. Dot titles belong in a screen-space overlay. Cross-family
routing builds a static corridor grid; scope routes to the selected relationships, not every pair on every frame.
Verification: 23 engine tests; full web suite 941 pass / 79,137 assertions / 71 files; web check zero errors/warnings,
root typecheck and public-source/Gitleaks pass. Median 1,000-task layout: 1.90ms fresh / 1.96ms incremental in Bun
(150ms regression guard). No graph/model/component/demo edits, visible change, browser proof, server, root tests,
build, push or deployment.


## Task graph stage 1 polish (T106)

One compact strip now shows each count once, including Quiet; zero Dropped is hidden. Scope/overlap text is accessible
and in the tooltip rather than another row. The large heading is gone, search shares the toolbar (expandable icon on
phone), results are a keyboard-navigated popover, zoom/Fit float on the canvas and phone's legend is a popover. Phone
details peek at 40% of the graph stage and have an explicit Expand/Peek control. Matching tasks get full-opacity
reason-coloured rings; nonmatches are 23% opaque, with a separate selection ring. Fit matches is explicit and counters
never move the camera. Search/panel-link focus animates to at least .9 zoom and preserves closer zoom; reduced motion
is immediate. Selected labels have a fallback slot. GraphLegend is split out; tests cover unique summary counts, Quiet,
zero Dropped and readable desktop/phone focus.

Measured in real Chromium: the 390×844 view has a 642px graph stage, with 385px left above its 257px peek. Clearing the
saved camera before first open at 1440×1000 gave a 1175×831 stage; graph bounds filled 89.7% of width and 70.4% of height.
Fit reproduces that framing. The earlier one-third-stage framing was not reproduced with a fresh camera. Review rings
measure full opacity, nonmatches .23. The refreshed T106 after set is `polish-counter-*` / `polish-panel-*`; before is
unchanged. A 9.35-second recording proves highlight, keyboard search popover, readable zoom, live panel/camera stability
and phone peek→expand. Only offline was recaptured among the state screens, per the review request. Earlier after proof
is historical. Keep capture/interaction in one CDP session as noted below.

All rerun gates pass: root 2,146 tests / 24,523 assertions (no retry), web 928 / 13,778, web check zero errors/warnings,
web build, root typecheck and public-source/Gitleaks. No protocol/Android/layout-engine changes, deployment or main move.

## Task graph stage 1 (T106)

The bubble canvas now has marked status/overlapping reason counters, ranked task/family/worker/thread search and an
ID-selected live detail panel (bottom sheet at ≤640px). Counter/search dimming never changes graph membership or
retained coordinates. Enter/double-click/Open task uses the existing sheet route; Escape clears graph state without
closing the enclosing phone dialog. Loading, empty, all closed, no matches and stale/offline boards are distinct.
The graph model resolves cycle-safe memoized families through hidden ancestors, counts done/all non-dropped subtasks
at any depth excluding the root, and marks nonclosed tasks quiet after exactly 48 hours. Worker failure is a separate
needs-you reason, not folded into questions. Counts include closed but exclude archived tasks. DESIGN has the contract.

`GRAPH_DEMO_SCENARIO=busy` extends the isolated task-graph demo with the protocol-validated 90-task/ten-family fixture,
six running/two resting/one failed workers and a real held background thread. It shifts fixture dates relative to launch:
otherwise real waiting/archive timers immediately consume the fixed research dates. Controls add review, empty,
restore and close-all. Use `GRAPH_WEB_ORIGIN` and `GRAPH_DEMO_OUTPUT`; the first log prints temporary data/config paths.
No production server/configuration, feature flag, task writes from the graph, prototypes or graph-lab route were added.
The historical research doc is restored with D56/D57 and T106–T111 at its top. The stage-2 family layout file is untouched.

T106 proof has desktop/phone light/dark before and after, active Review, search/panel, all five state captures and a
10.3-second interaction recording. The recording asserts 90 unchanged transforms after counter highlighting and an
unchanged camera while selected T3 receives a worker report and moves to review. Authoritative after screenshots are
named `proof-counter-*` / `proof-panel-*`; earlier after captures are superseded. CDP emulation resets on session detach,
so viewport changes and interactions/screenshots must share one CDP session. The existing responsive sidebar remounts
at its desktop breakpoint: selection is retained through live updates, not through that parent remount. Loading proof
was captured by reopening the real app after stopping the owned demo backend; offline proof keeps its prior board.

Checks: root 2,144 tests / 24,512 assertions; web 926 tests / 13,767 assertions, including eight model tests / 45
assertions. Web check has zero errors/warnings; production build, root typecheck and public-source/Gitleaks pass.
No protocol or Android changes, bookmark movement, push or deployment. Bubble canvas semantic zoom, larger node targets,
family cards and native parity remain later stages.

## Readable expanded task questions (T112)

Shared web `BoardQuestionCard` and Android `QuestionCard` now have a small expand icon, including warnings and
pinned cards wherever those shared components appear. It opens a read-only dialog over the task/card. Inline
Show more/less, suggested answers, free-text drafts, submission and conflict handling are unchanged. The dialog
uses the existing safe rich-text renderer on the complete question source, not the compact folding component:
18px/18sp body text, bounded responsive width/height, and a separate scrolling body. Web reuses Bits Dialog for
focus trapping, keyboard activation, Escape and focus return; the scrolling region is keyboard-focusable. Android
reuses Compose Dialog with a pane title, labelled Close, normal Back dismissal and a clipped scrolling viewport.

T112 holds synthetic cramped-before/expanded-after screenshots for web desktop and Android phone, a narrow-web
capture, full rich-text ending captures (including table/code), inline-control/draft evidence and actual browser
and emulator interaction recordings. Browser assertions cover nested focus trapping in both directions, Escape
returning focus to the trigger, bounded desktop/phone layouts, full source rendering and unsent-draft retention.
Native assertions cover reaching the final sentence, Back/Close dismissal and unsent-draft retention. The proof
used one temporary `createSetup` backend with effective data/config/agent paths printed and a retained `ViewClient`
watch, a dedicated headless Chromium profile and an owned headless emulator. No physical phone or real data.

Checks pass: fresh Bun install; root 2,136 tests / 24,467 assertions and typecheck; web 919 tests / 13,733 assertions,
check with zero diagnostics and production build; Android 807 JVM tests / 106 suites / two opt-in skips / zero
failures or errors, debug assembly and lint (41 warnings, zero errors); DTO generation check (337 DTOs / 91 requests);
public-source guard and Gitleaks. Android builds used an explicit empty private-properties file. All owned demo
processes and the emulator were stopped. No graph files, protocol, server behavior, push, main move or deployment.

## T97 review: final relay integration and quieter settings

Rebased the full Android stack onto `wzpknwxq` (final relay deployment/admin stack). All continuation sections were
retained, with Android sections above the incoming relay section. The demo seed keeps both the selected-database
handling and its explicit successful exit after SDK cleanup. Root/relay dependencies were installed again.
Android verification fixtures no longer write Firestore documents: control changes call the scrubbed emulator-only
`operator.ts` with explicit assigned ports and --yes; phone fixtures still use the public Auth/relay HTTP APIs.

No relay endpoint now means no relay settings at all. Before/after screenshots of the existing page match its
layout in light/dark; configured builds show the off row below This device. Consent uses the reviewed plain wording,
with the optional Google point still conditional. Longer deletion/retention details are behind Learn more, in plain
words. Today's use initially shows only Your account today: N left and a local reset time (tomorrow where needed);
all shared and shorter-window budgets are behind More limits. Reviewed authored relay text has no route/enrollment/
capability/provider-log/identity wording. The operator checklist now names the actual private Android properties,
documents email-only pilot configuration and replaces obsolete Android not-built notes, without adding identifiers.

On the final relay, the owned emulator completed email sign-in, actual Android notification permission, phone check,
On with the signed-in scratch backend Working, and a real backend test through relay → fake FCM → app decryption →
notification shade. T97 has refreshed light/dark before, no-relay after, configured-off after and email-only consent
screens, the quiet usage/Working screenshot, shade screenshot and one joined main-path recording. The recording joins
two actual UI captures in order (setup, then test delivery); no terminal capture or simulated display. These supersede
old placement/consent/usage screenshots. Earlier other-flow evidence remains historical, not a re-run on this base.

The coordinator timeboxed further capture after the working main path: operator-pause/problem states, Google sign-in,
other-phone actions and deletion were not re-proven on the final relay. No new main-path incompatibility was found.
All owned emulator/backend/relay/bridge processes were stopped by PID; no real Firebase config/project, phone, push,
deploy or bookmark move was used. Final review gates pass: 807 JVM tests / 106 suites / 2 opt-in skips / 0 failures
or errors; assemble, lint (41 warnings / 0 errors), release manifest/auth APK checks and the no-private-values build.
Root install/typecheck, protocol generation check (337 DTOs / 91 requests), verification Bun (7 tests / 49 assertions),
relay install/typecheck/build and public-source checks pass. No additional capture was made after the timebox.


## Email-only pilot sign-in (D54 / T97)

An empty Google Web client ID now leaves relay email sign-in available, hides Continue with Google entirely and
removes only the Google name/photo privacy point. Configured Google builds keep both methods and all six points.
The debug-only fake Google credential switch also counts as configured; release source sets always report no fake.
Pure unit tests cover email-only, configured Google and fake Google with an empty client ID. Consent still explains
Google's Auth/FCM delivery metadata when using email; that privacy boundary did not disappear with the Google button.
The additional emulator proof is a dark email-only turn-on screen and interaction recording, saved alongside the
both-method consent proof on T97. No Firebase stack or backend is needed just to prove this consent screen.
D54 gates pass: 802 JVM tests / 105 suites / 2 opt-in skips / 0 failures, debug assemble, lint (41 warnings / 0 errors),
release seam/auth packaging checks, and a separate no-private-values assemble/test run. The owned emulator was stopped
again after capturing the email-only proof; backend, relay and bridge processes remain stopped. Public checks pass.


## Optional Android relay account screens (T97)

Settings → Notifications now has the default-off optional relay row and Learn more. Only that switch opens privacy
consent and Google/email sign-in (D51). Firebase Auth is lazy; first run, backend connection/device approval, projects
and direct notifications do not prompt for a relay account. Credential Manager uses the Web client ID; email uses
Hosting App Links, exact-host paste validation, locally remembered address, a same-boot persistent 60-second resend
cooldown, masked link input and cold/warm intent handling without saving links in activity state.

The phone check keeps the persisted switch off until confirmation, then existing plumbing selects encrypted relay
notifications for eligible signed-in backends. Unsupported backends retain direct registration. Settings show identity,
this phone, backend status/details, daily remaining allowances/reset times, more limits and the other-phone inventory.
Turn off, this-phone sign-out and all-phone deletion are separate. Sign-out erases receive authority before Firebase
and Credential Manager clearing. Deletion asks for fresh sign-in and explicit confirmation, preserves durable pending
work and reports completion only from the relay contract. Foreground checks observe account deletion/disable and set
recovery without showing prompts elsewhere. Revoked tokens stop local relay receive without falsely claiming account
deletion. Backend device sessions and project data remain independent.

Dependencies: Firebase Auth 25.0.0, Credential Manager/Play bridge 1.6.0, Google ID 1.2.1. The Android README lists the
three private sign-in properties/environment names and three debug-only controls. Release source sets omit emulator
hosts, fake credentials and fake tokens; `checkReleaseRelayAuth` inspects APK DEX and also runs the merged-manifest
seam check. Synthetic config lived outside the repository; no real Firebase/Google project, credentials, FCM service
or operator phone was used. No bookmark move, push or deployment.

T97 artifacts prove default-off before/after, consent, email through On with a working signed-in scratch backend,
real backend encrypted test → relay Functions → fake FCM capture → app decryption → Android shade, Google fake sign-in,
another-phone removal, turn-off/sign-out, fresh Google re-authentication and completed deletion, three problem states
(phone limit/operator pause/rate limit), light/dark screens, fresh use without account prompts and direct receive with
the relay off. Recordings accompany screenshots. The final email recording masks the link. The shared scripted demo
stack and a cursor/broadcast driver were used; no replacement launcher remains. All owned emulator/backend/relay/
bridge processes were stopped. Verification scripts and the precise emulator recipe are in the verification README.

Two emulator findings were fixed: a sub-second phone clock lag rejected the exact stored challenge receipt; the
one-shot demo seed retained a Bun gRPC handle after SDK cleanup and never reached readiness. The deadline now trusts
its matching receipt (still enforcing identity, nonce and expiry); the seed explicitly exits after successful cleanup.
The proven SDK connection uses adb reverse, not the host alias. Quota responses lack configured totals, so settings
show remaining/reset, not invented used/total gauges. Real Google sign-in, email delivery, verified App Links, FCM,
Play services behavior and the release-signed APK remain outside emulator proof. Offline deletion/recovery and the full
OS recreation/permission matrix were not exhaustively emulator-tested; durable deletion has JVM coverage.

Checks: 799 JVM tests in 104 suites, 2 opt-in skips, 0 failures/errors; debug assemble and lint (0 errors), plain build
with no private values and both release packaging checks pass. Verification Bun: 7 tests / 49 assertions. Protocol
check: 337 DTOs / 91 request overloads. Root typecheck, relay tools typecheck/build and public-source guard pass.
Root tests were not repeated for this Android/relay/docs-only change. The optional verification strict TypeScript
command finds an existing server `models.ts` type error; root typecheck and the required verification tests pass.

## T101 relay deploy/admin preparation (emulator verified only)

Fresh/missing relayControl settings/booleans now mean paused/closed; numeric defaults cannot grant authority. Tests and
the standalone demo explicitly seed enabled flags. All twelve collection IDs use the relay prefix; unprefixed app data
is left alone. Runtime database ID is a Functions parameter (default `(default)`), also selected explicitly by operator
CLI/deploy config. Both exports share parameterized region/SA/database, HTTP max instances defaults to two, hourly stays
one. Parameter database resolution is deferred to invocation; the scheduler wrapper redacts provider errors.

`relay/tools/operator.ts` is one implementation: explicit emulator (scrubbed env/home, demo project, loopback) or
operator-only real project + confirmation using their ADC. Every operation/read needs --yes; dry run has no SDK/ADC/
network. Built commands: status, seed-control paused once, pause/resume, enrollment open/close, limits set, account
disable/enable/delete, phone disable, reconcile. IDs/provider errors are not echoed. Lost/disabled account deletion
shares the durable relay-before-Auth cascade. admin.ts is an alias; old settings-JSON syntax is removed.

`relay/DEPLOY.md`, placeholder-only `.env.example`, local deploy-config generator and exact shared-rules fragment
cover the operator procedure/IAM, named/sole/shared database cases, paused seed-before-deploy, narrow function selectors,
synthetic smoke, ingress gate, logs/rollback and real-project Auth sign-up/MAU/email alerts + provider shutdown drill.
Shared config preserves unrelated composite indexes/field overrides and deliberately omits rules; the existing app
owner merges rules, including exclusions from every overlapping allow. False denies alone never override an allow.
Neither named-database IAM/rule association, provider quotas/alerts, runtime/build IAM nor real ingress is proven here.
No real project/login/credential access/deploy/main move/push; these remain operator-only live acceptance gates.

Demo change qknmqnmu / ed2e605a is committed separately. T101 ksquzwql / 5401beb2 is rebased onto coordinator tip
zxzsloqx / db08d018, retaining test:e2e, root test compiler/helpers, propagated ports and metadata detection suppression.
The incoming server fix wmqnkmvw resolves both D53 audit findings below (flat error parsing and physical-purge wording);
no packages/ changes were made by this work. E2E already seeds both switches explicitly; added namespace/default-pause
assertions and updated the direct Firestore client probe to relayAccounts/selected database.

Final offline relay: 99 pass / 1,657 assertions / 89.94s tests, 113s command; includes every CLI command, shared rules,
named Admin/HTTP isolation, namespace sentinels and standalone SIGTERM/stale-readiness-PID smoke. E2E: 19 pass / 270 assertions online
16.95s (30s command), offline 18.22s (42s command). Root install --frozen-lockfile --offline changed nothing. Root tests:
2,136 pass / 24,456 assertions / 176 files / 199.93s (200s command), no relay discovery. Root checks also ran with scrubbed
HOME/env and loopback-only namespace. An initial root invocation omitted USER and failed three watch fixtures; supplying
a synthetic USER/LOGNAME fixed the invocation, without changing root/deploy source. No flaky-source retry or live deploy.
Relay typecheck 2.574s, build 1.646s, root typecheck 1.303s; format/public/Gitleaks pass. All owned processes/listeners stop.

Acceptance summary: 76 locally proven, 27 need the real project, 0 not covered (103 items). The three former mock alarm/
shutdown gaps are operator configuration/drills, not code. Actual metrics/quotas, supported spend-stop mechanism, ADC
quota project, database IAM/rules/TTL, build/runtime/Scheduler IAM, ingress and release-device/provider acceptance still
require the operator's real project. Nothing has been deployed or opened for sign-up.


## Standalone relay demo stack

`relay/ bun run demo:stack [--minutes 1..120]` builds and starts scrubbed demo-only loopback Auth/Firestore/Functions
plus standalone fake FCM, explicitly enables demo control/enrollment and prints one readiness JSON line (including
PID and `/v1/` base URL). SIGTERM that PID or let the 30-minute default limit stop all owned processes. Captures are
private ignored JSONL; `/captured?after=0` returns messages/next, and `/mode` selects accepted/unregistered/rate_limited/
unavailable/timeout. README documents polling, detached start/stop and Android 10.0.2.2/adb reverse.

Generated function copies/config/HOME are isolated per Functions port; only the cached emulator jar is shared. Default
ports remain 19371–19377; the standalone HTTP enrollment smoke check uses 19671–19677 (other workers own 19471 and
19571 ranges). No package/root dependency changes and no production configuration or credentials. Operator/deploy
work follows in a separate commit; this demo never grants real-project access. Offline standalone gate: 2 pass / 51
assertions / 26.51s, including clean SIGTERM/port shutdown. Relay typecheck/build and public/Gitleaks pass.

## Push relay end-to-end emulator gate (T99)

The real Functions HTTP adapter, Auth/Firestore emulators, isolated `createSetup` backends and TypeScript simulated
phone now run together in `relay/checks/e2e/`. From `relay/`, `bun run test:e2e` fixes ports 19471–19477, seeds an
explicit enabled control and uses the scrubbed launcher. Offline:
`unshare -Urn sh -c 'ip link set lo up && bun run test:e2e'`. Install root dependencies first: integration typechecking
uses the root TypeScript compiler for the server imports; relay's production build still uses pinned TypeScript 5.9.
No frozen protocol, shared vectors, relay HTTP contract, Android UI or production data changed.

The backend now reads real `{error:"code"}` responses, preserving named 410 reasons and pausing on account-disabled
403. Its fake uses the real shape. Known quota scopes/operator 503 codes remain visible; all README status/code
classes have parameterized server assertions. Local cleanup expiry is not a physical Firestore purge guarantee.
Nested operator checks needed all overridden ports propagated through the scrubbed environment. Both launchers now
disable cloud metadata detection; the operator subprocess check no longer has an outer five-second test timeout.
These small launcher/config changes are required alongside the harness and may overlap the operator-tool worker.

Commits so far: `wmqnkmvw` / `e280e33f` parser and retry scopes; `xtpqvxyp` / `417d612c` harness and launcher fixes.
Acceptance inventory: [push-relay-acceptance.md](push-relay-acceptance.md), 103 single items: 76 locally proven,
24 need authorized real-project/release-device acceptance, 3 remain open (mock provider shutdown/mail-quota/MAU
alarm integrations are not implemented). Emulator success is not permission for an open pilot. Completed account
deletion erases routes, so a backend observes generic `not_found`, not necessarily `account_deleted`.

Final tests: root 2,136 / 24,467 assertions / 197.38s, typecheck 1.21s; relay existing suite 84 / 1,275 online
48.13s and offline 48.92s; end-to-end 19 / 256 online 16.61s and offline 17.09s. Relay typecheck/build/format pass
online and offline. Web check has zero errors/warnings, 918 / 13,722 tests/assertions in 2.60s, production build
passes. Generated Android DTO check passes (337 DTOs, 91 requests). No Android build needed or performed; no
protocol/client changes. Public-source checks pass. No root flaky-test retries. All task-owned processes stopped;
no phone, Android emulator, main move, push, deploy or real Firebase/Google Cloud action.


## D53 relay format parity and backend audit

Based on rebased T94 `ynzrrnts` / `819b4841`. This supersedes T94's credential-framing and deletion-polling warnings.
Relay credentials now hash UTF-8 compact JSON ["aiki-push-v1","credential",fullBearer], lowercase hex at routes/create.
No production package import: checks read the frozen shared JSON only as data. The audit also fixed relay bugs hidden
by synthetic fixtures: envelope must be a canonical JSON string (not an object), with exact outer key order/text;
ciphertext must be 272–2,064 bytes and (bytes - 16) divisible by 256. Duplicate keys and noncanonical encodings reject.
Old emulator rows with raw bearer hashes need reset/phone-owned removal; there is no live migration or legacy fallback.

All 22 positive envelopes and both bearer/hash vectors pass byte-for-byte through the core to fake FCM; 21 applicable
negatives reject before FCM. The other 39 are explicitly classified: 25 require decryption or phone key/session
context; 14 are phone-only point/confirmation/sequence/plaintext-construction inputs. The fixture contains both
credential vectors, so none were invented or missing. No frozen fixture/library/backend contract files were edited.
D53 accepts the existing UTC-window approximation and treats 410 account_deleted after a delete request as complete
for the phone: authority/content records are erased before Auth, while reconciliation finishes final markers.

Two backend audit findings remain for the coordinator: transport.ts reads top-level code or error.code, not the
relay's string error. 403 account_disabled therefore becomes rejected without pausing; named 410 reasons collapse to
route_expired. D52/D53 relay errors were not redesigned. The backend document also overstates physical purge at
absolute expiry +24h; authorization expires in code, but TTL/repair are eventual. Retry-After, transient 429/5xx,
200 accepted/pending/failed and delete retry/204 handling otherwise match. README has the full audit and skip list.

Checks: relay 84 pass / 1,275 assertions / 56.52s (79.58s full offline namespace command); root 2,110 pass / 24,295
assertions / 176 files / 203.56s, zero failures or root retry. No relay auto-discovery. Typecheck/build/format and
public/Gitleaks pass. Existing 20/10, 31/21/1 and 33/13/9 SDK-operation assertions still pass. Emulators/helper processes
and test listeners stopped; no credentials, real Firebase project/login, main move, push, deployment or standalone
Aiki server. Recipe remains relay/ bun run build, then unshare -Urn sh -c 'ip link set lo up && bun run test:emulator'.

## Real-project push relay operator checklist (T100)

[Operator checklist](push-relay-operator-checklist.md) collects settled choices, twelve private fact questions,
operator-only setup, release-APK acceptance and the three-backend rollout/rollback. Linked from DESIGN's relay section.
Docs only: no real Firebase/Google access or configuration/credential inspection, emulator, server, tests or deployment.
The CLI is demo-only and has no delete action; production deploy/admin procedures and Android account/build seams
remain unbuilt. Auth runtime permissions, safe attended staging enrollment and shared Firestore rules need explicit
review; missing switches default enabled. The documented credential-digest mismatch must be resolved before integration.
Public-source denylist and Gitleaks checks pass. No main movement or push.

## Android relay plumbing, optional and off by default (T96)

Built without UI, Firebase Auth, credentials, devices, emulators, servers or deployment. Rebased the Android stack onto
`ynzrrnts` (server relay plus limits/account deletion) and reran Bun install. D51 remains strict: upgraded and fresh
settings default `relayEnabled=false`; receive and token/foreground hooks do not evaluate relay storage/client/account
factories while off. The pure registration sync still sends today's exact registerFcm request. Unsupported backends
stay direct; eligible signed-in backends select relay exclusively. Relay-selected sessions reject plaintext even after
local route deletion. No operator-phone behavior changes and no notification screen edits.

Private build property: `harness.pushRelayUrl` / `HARNESS_PUSH_RELAY_URL` → `BuildConfig.PUSH_RELAY_URL`, empty by default.
HTTPS only outside debug; debug accepts literal loopback/localhost and emulator-host HTTP. The encrypted store is
`datastore/aiki-push-relay.preferences_pb`, separately excluded from cloud backup/device transfer, AES-256-GCM with a
separate Keystore alias and injectable cipher. It contains installation/enrollment/token operation state, route
capabilities and staged PKCS8 keys, derived notification keys, backend/session/local routing identities, leases,
predecessors, monotonic backend clocks/uncertainty, admission windows/event dedupe, delete-only/backend unregister
queues, account/quota/deletion state and fixed diagnostic counters. Records and generated relay requests redact their
string representations. Admission commits before presentation. Retiring keys/windows prune together at thirteen hours;
reboot/uncertain clocks fail closed. Key loss discards relay state and sets `relayRecoveryRequired`, blocking receive
and direct registration until an explicit transport choice; the next UI must not clear that marker prematurely.

`RelayAccount` is the token/not-signed-in port; Android composition intentionally returns not-signed-in until the next
account/UI task replaces it. `RelayBackendRpc`/`HarnessRelayBackendRpc` and `RelayBackendAdapter` now use the actual
generated registerRelay/confirmRelay/syncRelay protocol on existing sockets. Order: staged create → register → verify
identity/HMAC and persist keys → relay activate → backend confirm. Retries keep one operation and original registration
preferences. Wrong identity/HMAC/unknown_request queues deletion with no downgrade. Fresh sync clocks avoid old receipt
timestamps; midpoint RTT uncertainty is included conservatively inside the five-minute skew. Renewals, preferences and
confirmed token-generation repairs sync back to the backend. Local removal/session sign-out/off is durable before
best-effort remote unregister; explicit off/on reuses the enrolled installation rather than consuming phone slots.
`RelayNotifications` is the lazy integration boundary for service, token callbacks and foreground maintenance.

D53: create hashes already use lowercase hex from RelayCrypto.credentialHash (the frozen JSON-framed digest); no raw
bearer hash workaround was added. `RelayAccounts` exposes typed status/quota snapshots and durable account deletion.
Deletion clears receive authority before HTTP, retains operation/Retry-After across 202 and reauthentication, and treats
200 deleted or subsequent account_deleted as complete. Any account_deleted management failure erases keys/routes/replay;
account_disabled retains sign-in but blocks relay mutation/reception. Real sign-in, privacy/consent, explicit account
switch/reset handling and account controls remain the next task, not an implicit pairing/first-run requirement.

Debug-only `DebugRelayReceiver` requires shell DUMP permission and invokes the same router. Delivery recipe (only on an
authorized test emulator): `adb shell am broadcast -a io.github.mitzacoder.aiki.DEBUG_RELAY -p io.github.mitzacoder.aiki
--es aiki '<captured JSON>'` on one line. It never enables/enrolls relay. `:app:checkReleaseRelaySeam` generates the merged
release manifest and rejects the component/action. See apps/android/README.md for the same recipe.

Final gates after the limits rebase: **784 JVM tests / 102 suites, 2 skipped, 0 failures/errors**, including 43 new T96
tests; debug assemble and lint pass (**0 errors, 36 warnings, 1 hint**); merged release-seam check passes. Protocol
check: 337 DTOs / 91 request overloads. Root typecheck and public/Gitleaks guards pass. No verification TypeScript was
changed; full root tests were not required (only Android/docs changes). D51 regression uses factories that fail if any
relay storage/account/client/backend is touched, asserts no relay file exists, and compares the old plaintext parser's
output; actual notification registration tests assert the unchanged direct token/device/preferences request and
exclusive relay choice. MockWebServer covers every management endpoint, typed fixed/unknown errors, Retry-After,
redirect refusal and response caps. No rendered proof is needed: this task exposes no new UI.


## Relay budgets and durable account cleanup (T94)

Updated the stale workspace and based this task on squashed T93 `xlqlowlw` / `56c592f5`, which includes T92.
Implementation is `xrntxzzk` / `6a271382`; the following docs commit records its handoff. Emulator-only, no backend
uses it. No real Firebase configuration/credentials/login, main movement, push, deploy, Aiki server or system install.

Built transactional route/account/IP/global send budgets, challenge/enrollment/signup/capacity budgets, bounded
pre-proof admission, kill/enrollment switches, recent-auth accounts/delete, minimal disabled markers, deliberate
re-enable/fresh enrollment, phone-only disable, leased resumable cascades and hourly v2 reconciliation. All pilot
ceilings are tunable in relayControl/settings, missing settings mean defaults, failed reads never do. Each external
attempt is charged with its durable send reservation; duplicate/status results are not charged as sends. Deletion
works with every budget exhausted and switches off. Global/IP daily counts survive UID deletion. Source IP appears
only as a daily HMAC bucket; key rotation and logical bucket expiry use UTC days.

Windows are **fixed UTC minute/hour/day counters**, not exact rolling limits: N per aligned window, at most 2N in any
rolling interval of the same width; a boundary test proves the bound. Coarse admission reserves up to 30 in-flight or
non-delivery requests/IP; validated new sends refund slots, so more than 30 simultaneous proof checks on a NAT may
temporarily get request_rate despite available send budget. Active account capacity counts active relay rows until
disable/delete; its next-day retryAt is a recheck time, not a guaranteed slot-reset. TTL and provider outages cannot
guarantee physical IP-bucket deletion exactly at 24h; midnight logical expiry plus indexed hourly repair is implemented.

Account work commits a blocking marker first, then uses owner leases, batches of 50 and durable phases; incomplete
work has no TTL. Completed disable retains only uid/state/cleanupComplete plus Auth identity and short-window counters.
Reconciliation checks Auth drift, resumes work, expires rows, prunes maps, removes orphan ownership and removes phones
after their last route or thirty route-less days. Scheduled export is discovered but automatic triggering is ignored
without Pub/Sub in this emulator suite; its plain core is called directly. Admin wrapper always re-execs env -i into
demo/loopback-only Auth/Firestore, has no operator HTTP endpoint and is smoke-tested.

README has exact commands/limits/API/storage/operator examples and acceptance mappings. accounts/status adds
quotas[{scope,budget,remaining,resetAt}], effective caps, active-account switches and pending deletion. Quota/capacity
errors carry fixed scope + retryAt and Retry-After; FCM transients retain D52. accounts/delete accepts {operationId},
requires auth_time within five minutes and returns 200 deleted only after relay/Auth erasure, else 202 deleting +
Retry-After. If Auth is removed before a finalization crash, revocation-checked polling cannot succeed: 410
account_deleted is not proof all relay work is erased. Reconciliation finishes it. No revocation bypass or new erasure
credential was silently added. Guaranteed authenticated final erasure receipts would need a separate protocol choice.

**Integration blocker found:** frozen T92 relayCredentialHash hashes compact JSON
["aiki-push-v1","credential",bearer], whereas approved T93 hashes the raw full bearer. A synthetic cross-check returned
credential_hashes_match=false. T94 intentionally changed neither contract. Reconcile framing/hex encoding before
server/Android transport uses them. The relay still validates strict outer keys only and never decrypts payloads.
Real-project GFE forwarding suffix also remains unverified by design; test it before IP budgets rely on it.

Verification: 80 emulator checks / 1,079 assertions, 52.42s tests / 75.58s full offline command, under unshare -Urn with
only loopback. Includes every cleanup-phase crash, quota contention/restart/churn/reset, direct Auth signup bypass,
disabled/deleted Auth drift, linked UID, no sensitive logs and metering. A late re-run exposed fixture clock bugs:
the hourly-expiry case crossed a calendar-hour reset and a newly REST-issued auth_time could be ahead of the frozen
relay clock; fixtures now anchor that hour and synchronize issuance time. Final full suite passes, no skipped checks.

Measured real SDK document operations (reads/writes/deletes): accepted send 20/10/0; first begin+confirm enrollment
31/21/1; deleting one phone/one route/one accepted-attempt account 33/13/9. Counts include proof/management budget
transactions and minimum empty-query reads, committed writes only, no transaction retry in the specimens. They
supersede the design's 6+6 send assumption, exclude Auth/FCM/TTL/platform costs, and are asserted by a regression test.

Root: 2,035 tests / 23,778 assertions / 169 files, 190.80s (includes T92; no relay test auto-discovery), zero failures,
no rerun. Root install 0.568s, typecheck 1.17s and public/Gitleaks pass (timed 2.33s). Relay frozen install 0.01s,
source/tests/tools typecheck 3.47s and build 1.63s, formatter passes. No new dependencies. All emulator/helper processes
and in-process Auth/fake FCM listeners stopped; post-run ports/process inspection is clean. Reproduce from relay/:
bun install --frozen-lockfile; bun run typecheck; bun run build; online once bun run emulator:setup; then
unshare -Urn sh -c 'ip link set lo up && bun run test:emulator'. Isolated state/cache and ports remain unchanged.

## Bound relay metadata and delete authority (T95 follow-up)

Rebased workspace onto the accepted merged tip `pxxrzxsu` before changing code. Relay receipts now have a scheduled
`purgeAt`: ten-minute pending expiry plus 24 hours until activation, then absolute expiry plus 24 hours. Revoked
status uses the same route horizon. Both are pruned after restart even when no sends or remote cleanup remain.
Delete-only entries now retain their absolute expiry and stop at absolute expiry plus 24 hours, independently of a
long Retry-After. Wrong-secret 404 keeps capped-backoff retries until then. Expiry atomically erases the capability
and marks cleanup done; a secret-free `cleanup_expired` diagnosis survives restart for only 24 hours, then is pruned.
Minimal transport-selection tombstones remain, so pruning history cannot revive stale direct notification rows.
Pre-retention v1 files are upgraded conservatively using known route expiry or the relay's maximum 90-day lifetime.

Three fake-clock tests cover activated/pending receipt and revoked-status boundaries, restart, wrong-secret capped
backoff, expiry erasure without further HTTP, bounded diagnosis and stopped timers. All 50 relay tests pass.
Exact fields and retention rules are in `docs/push-relay-backend-v1.md`; no protocol, crypto, Android or UI changes.
Full checks on the merged base pass: root 2,110 tests / 24,295 assertions / 176 files (193.96s); root typecheck
1.33s. Web: 918 tests / 13,722 assertions / 70 files (2.77s), zero check errors/warnings (17.16s), production build
passes (12.25s). Incremental Android test/assemble/lint passes (7.82s): XML has 741 tests / 95 suites, two existing
skips, zero failures/errors; lint has 36 warnings, zero errors. Android used an explicit empty private-properties
source and no Firebase config. Install checked 262 installs without changes (1.26s); DTO check confirms 337 models/
91 requests (0.10s); shared vectors match (0.03s); public/Gitleaks guard passes. No flaky rerun, protocol drift,
services left running, main move, push or deployment.

## Backend encrypted push relay (T95)

Backend relay transport is wired behind private `AIKI_PUSH_RELAY_ENDPOINT` (complete operator-approved HTTPS v1 base
URL; loopback HTTP only for tests). With no setting, no relay store/files/feature/response fields are introduced;
direct FCM and Web Push remain unchanged. D51 remains optional. No Android/web UI or account flow was changed.
The exact RPC shapes, file fields, retry rules, limitations and Android call order are in
[the backend v1 contract](push-relay-backend-v1.md); DESIGN's Notifications subsection was written first.

`fcm-relay-v1` additionally needs device-auth support and every relay call requires an actual authenticated session,
even in optional mode. Register with a durable operation ID; verify the backend-confirm HMAC; persist phone keys;
activate the relay route; then phone-confirm to activate the backend. A stable persisted registration reply survives
restart. Its serverTime is the original receipt time: use syncRelay's fresh serverTime after a delayed retry before
anchoring the phone clock. Identity always comes from the session, never labels/device IDs. Confirm retries cannot
remove a pending successor or resume a paused route. Direct/relay selection is serialized, and durable relay selection
suppresses stale direct rows before their removal so a crash or in-flight switch cannot double-send the event.

Mode-0600 `notifications/push-relay.json` owns routes/receipts/selections/safe revoked status and exact ciphertext
send/delete-only outboxes. Independent `push-relay-counters.json` witnesses the next per-key sequence; allocation is
durable before encryption, exact HTTP body before send. Partial counter restore/malformed keys require new keys.
A coherent rollback of both files is fundamentally undetectable locally: full-backup restoration must agree fresh
routes/keys, or a future independent non-rollbackable witness is needed. Receipt and delete retention is bounded as described above.
Public-source ignore/guard rules reject both private filenames. No exports/logs/config/device read exposes secrets.

Existing dedupe/hold/interaction/filter/TTL/preview policy runs first. Retry checks current session/preferences/archive,
resends identical bytes with 5-second exponential jitter capped at 15 minutes, honors Retry-After, and stops at event
+12h/route expiry. At 100 queued messages/route, drop newest without allocating a sequence. Terminal route results
pause new sends; after token/route repair the phone explicitly syncs resume:true, which never replays old events.
Counter inconsistency cannot resume and requires fresh keys. No direct/plaintext fallback. Test success says accepted,
never delivered. Revoke/unregister/expiry stop local sends immediately and atomically erase send authority/keys into a
delete-only outbox before old rows disappear. Cleanup retries independently across restart; 204 or the relay purge horizon erases its secret.
Safe status distinguishes pending cleanup from done; still-signed-in phones can read it after unregister.

Checks at the final implementation: root 2,082 tests / 24,144 assertions / 172 files, zero failures (194.45s);
47 relay fake-HTTP/simulated-phone cases included. Root typecheck passes. Web 897 tests / 13,636 assertions,
zero check errors/warnings and plain bun run build passes. Android: 741 tests / 95 XML suites, two existing skips,
zero failures/errors; assemble and lint pass (36 warnings, zero errors). Android builds used an empty explicit private
properties source and no Firebase config. Protocol generation check (337 DTOs/91 request overloads), crypto-vector
check, install and public/Gitleaks guard pass. The first root run caught the expected unconditional feature-list
assertion; it was corrected for the now-conditional feature. No flaky-test rerun was needed.

The exact strip-only-compatible PushRelayError constructor fix from the coordinator is included in the protocol
commit. All new protocol/client TypeScript is erasable. No Firebase emulator, real relay/provider calls, private
credentials/config inspection, phone/emulator, UI proof, main movement, push or deployment was needed/performed.

## Plain notification wording (T98 follow-up)

Notifications now say **On (shared subscription)** and **On (own subscription)**, with **Needs re-subscribe**
("This backend's push key changed."), **Needs sync** ("Reopen the app while signed in."), **Off** and
**Unavailable** with its reason. The backend hint is "Each backend pushes on its own. If a subscription changes,
reopen the app while signed in." Implementation terms stay in code/docs, not settings labels, hints or authored
errors. Worker-start and registration-limit errors use ordinary notification/backend wording too. No subscription,
key, worker, backend or deploy behavior changed.

Updated unit/browser copy assertions, including a rendered-page check against implementation jargon.
Web: 918 tests / 13,722 assertions; check has zero errors/warnings; build and root typecheck pass.
No full root test run for this copy-only change; server files are untouched. Public-source checks pass.
Real Chromium mixed-key and operator legacy regression assertions pass, including zero subscribe/unsubscribe
calls for the three shared-key backends. Four refreshed after screenshots (desktop/phone, light/dark) and the
refreshed after interaction recording are saved on T98 with the existing tags. All fixture servers and Chromium
were stopped by PID. No main move, push, deployment, phone or emulator operation.

## Independent web push keys and subscriptions (T98)

Each independent backend now uses an opaque `/push/<sha256>/` registration served by `/push-worker.js`, separate
from the root app shell. Push-only workers have no fetch/resource cache/claim behavior. Same-key legacy backends keep
their existing root subscription and endpoint: no migration, rotation, re-subscribe or operator deploy change on load.
Fresh explicit enablement may also share root for a same-key group; a fresh pair of independent keys gets two scoped
workers. The persisted backend/origin/scope/key map contains no credentials; browser subscription objects come from
their registrations. Removal prunes its scope; root is released only after its last known user, conservatively retaining
it while an undiscovered offline backend might still use it. New scoped registrations are capped at 24 and dormant
unmapped registrations are removed. This is an application cap, not a measured portable browser limit.

Both workers now only mark a changed scope in IndexedDB and notify open pages. A ready signed-in page repairs that
scope's backend rows, not every configured backend. Repair generations prevent clearing a newer concurrent change.
No anonymous worker sockets or bearer material in Cache Storage. A browser that cannot expose its existing root key
keeps that subscription untouched and requires explicit enablement rather than guessing a key or migrating scopes. Settings show own-key/legacy, explicit per-backend
re-subscribe on key change, sync-needed, off and unavailable states; Brave guidance remains. Web push needs no relay
account (D51: an account is optional and only for Android relay notifications). Offline shared-root removal cannot
revoke an unreachable backend’s remote row without also disrupting other users of that root: remove while reachable
or revoke that backend’s device session. No hidden remote cleanup/auth bypass was introduced.

Server tests pin default VAPID path, 0600 creation/narrowing, restart persistence, malformed-file refusal and both
operator overrides. Static-serving tests pin JavaScript MIME/no-store behavior; root script location already permits
narrower scopes, so no `Service-Worker-Allowed` override is needed. `deploy/vapid-key.sh` is unchanged.
No protocol or Android changes.

Final checks: root 1,961 tests / 23,324 assertions, no failures or retries; root typecheck passes.
Web 917 tests / 13,709 assertions; check has zero errors/warnings; production build passes.
Chromium integration phases in `apps/web/scripts/push-browser.md` passed with six required-auth `createSetup` backends:
mixed independent/shared keys, each authenticated row and signed loopback send, an existing untouched legacy root,
separate independent scopes, disable/re-enable/removal, explicit key-change repair, marked-scope repair and the operator's
three-shared-backend regression (zero subscribe/unsubscribe calls, root only, no errors). Key-change proof seeds the
previous saved key; marker proof simulates expiry. Unit tests exercise actual worker events and signed-out deferral.
The separate server-test parent also passed all checks: root 1,941 tests / 23,251 assertions, web 897 / 13,636.
Only PushManager/permission use stubs; real push-service acceptance and non-Chromium browser limits need consented
follow-up. Style pass uses typed page/CDP helpers and one statement per line. No new runtime dependencies.

T98 artifacts include desktop/phone light/dark affected-row before/after screenshots and before/after Chromium
recordings. Initial top-of-page baseline screenshots are also retained, but the later affected-row pairs are the useful
comparison. All isolated servers and Chromium were stopped by PID. No live backend data or credentials were used,
no phone/emulator was touched, and no main move, push or deployment was performed.

## Push relay D52 rework (T93)

Reworked the emulator-only `relay/` package on top of `xlqlowlw`. D52 is implemented: clients send UTF-8 JSON bytes
with `Content-Type: application/octet-stream`; rawBody caps/parsing and fixed no-store errors stay inside the handler.
Other media types reaching it get 415. Malformed non-protocol application/json still hits the framework's own parser;
an HTTP test documents that residual. Another proves valid JSON-looking octet-stream enrollment plus scalar/malformed
handler errors and no client body probes in framework logs. Nothing is deployed or used by a backend. D51 makes relay
accounts and push optional; Aiki works fully without them.

Absent route + well-formed delete bearer now returns 204 indefinitely; existing wrong delete secret returns generic
404; wrong schemes fail before lookup. Route credentials are physically erased. Only a secret-free
`routeRevocations/{routeId}` marker (purgeAt, no UID/hash) remains through original absolute expiry +24h to prevent
stale create/revoke races from reviving authority. This is not a delete receipt or lookup dependency. Phone route
deletion is also idempotent. Challenge replacement with a new operation immediately deletes the previous challenge;
24h `challengeOperations/{installationId}_{operationId}` receipts preserve same-operation idempotence without a raw
token/nonce. Phone removal erases those receipts too; T94 account cleanup must include them.

Accepted/token-invalid are the only terminal sends. FCM 429 returns 429 fcm_rate_limited; timeout/5xx return 503
fcm_unavailable, each with Retry-After and a persisted retryAt. Same digest before that time does not call FCM; after
it reserves another attempt, preserving first-reservation TTL. In-flight/crashed reservations stay pending with their
60s lease/Retry-After. send/status adds retry with code/retryAt; terminal token-invalid remains queryable. Conflicting
digests still 409; elapsed message/route lifetime is 410. README has exact API, storage, error codes and an acceptance
table linking every in-scope design item to tests.

Source is split by admission/enrollment/installations/routes/send/delete/router, with ports and runtime-checked typed
Firestore converters for every collection; no any rows in handlers. Tests mirror those concerns with one support
file/lifecycle. Formatting uses tabs/double quotes/120 columns and Prettier 3.6.2; typecheck now includes tests/tools.
The trusted-client-IP adapter takes only the direct GFE-appended rightmost XFF entry, never earlier client values;
missing/malformed metadata fails closed. Verify the real ingress suffix before IP budgets rely on it.

Recipe remains: from relay/, `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, online once
`bun run emulator:setup`, then `bun run test:emulator`; offline proof:
`unshare -Urn sh -c 'ip link set lo up && bun run test:emulator'`. Launcher uses env -i, isolated HOME/XDG,
demo-aiki-relay, loopback 19371–19377, disabled UI and bounded emulators:exec. Jar cache:
`.emulator/home/.cache/firebase/emulators/`. Runtime declares Node 22; available Node 24 runs the function locally.

Checks: 41 emulator tests / 518 assertions / 27.40s test time (50.54s full offline command); all pass.
Root: unchanged 1,937 tests / 23,224 assertions / 168 files / 212.89s, no flaky rerun. Root install 1.216s,
typecheck 1.22s, public/Gitleaks 1.13s pass. Relay frozen install 0.01s, source+checks typecheck 2.93s, build 1.36s;
format check passes. Relay dependencies now ~306 MiB (Prettier added). No root workspace/dependency changes.
All Auth/Firestore/Functions/hub/logging/helper processes shut down; in-process Auth/fake FCM listeners closed;
port/process inspection finds none remaining. No real Firebase login/config/credentials, main movement, push, deploy
or Aiki server. T94 limits/switches/disable/account deletion/reconciliation remain deliberately untouched.

## Relay payload compatibility and reviewability (T92 follow-up)

Review found a real version-skew flaw: a crypto-layer list of payload keys/kinds would reject
new backend fields on older phones. Both receivers now validate the authenticated payload only
as a JSON object within the plaintext cap, preserving unknown fields and kinds for the caller.
Envelope and plaintext wrapper keys/lengths/order/encodings remain strict; payload JSON is not
canonicalized or reserialized for comparison. Wrapper-prefix/suffix and independent payload-slice
parsing reject duplicate wrapper fields. Padding remains minimal 256-byte ASCII-space buckets.
Sender preparation still takes typed NotificationPayload, bounds known fields, truncates preview,
preserves fitting extensions and drops extensions only in the encrypted fallback. No duplicated
kind list remains. TypeScript distinguishes RelaySendPlaintext from opaque received RelayPlaintext.

Android's existing parseNotificationPayload ignores unknown DTO fields via wireJson, but returns
null for an unknown kind (except test). The new JVM test confirms both outcomes after decryption;
that parser/service is unchanged. Thus a new field no longer blocks supported kinds, while old
apps retain direct-FCM behavior for unfamiliar kinds. DESIGN also records D51: relay accounts and
relay push are optional, and Aiki works fully without them.

Reformatted source/tests to one statement per line, TS tabs and about 120 columns; added public
API guarantees and named helpers. The shared file now has 19 sender encryptions, 3 opaque receive
cases and 60 rejections. All 15 original encryption envelope strings are unchanged; generator
--check passes after formatting alone. Gradle now declares the shared file as a test input, so
fixture-only edits invalidate its test cache rather than silently reusing old results. Kotlin's
JSON tree parser accepts non-JSON primitive tokens; receiver syntax validation rejects those
without imposing any payload schema or numeric normalization.

Follow-up final checks: root 2,035 pass / 23,778 assertions / 169 files, zero failures (191.57s);
98 relay tests / 554 assertions. JVM XML: 741 tests / 95 suites, 2 skipped, zero failures/errors;
97 relay tests. Combined: 2,776 tests, 2 skipped, zero failures. Assemble and lint pass (0 errors,
36 existing warnings); typecheck, Android generation (330 DTOs / 88 overloads), vector --check and
public/Gitleaks checks pass. No root protocol generator exists. No new runtime dependencies,
UI/service wiring, device access, live servers, main movement, push or deploy.

## Encrypted relay v1 library and shared vectors (T92, initial checks)

Unused libraries only: `packages/protocol/src/push-relay.ts` (exported) and Android notifications'
`relay/RelayCrypto.kt` / `RelayAdmission.kt`. No existing sender/service, RPC, UI or feature flag changed.
The frozen reference is `docs/push-relay-v1.md`; DESIGN's Notifications subsection points there.
The one synthetic fixture is `packages/protocol/test-vectors/push-relay-v1.json`, regenerated by
`bun scripts/generate-push-relay-vectors.ts [--check]`; JVM tests read that file directly, not a copy.
It contains fixed P-256 scalars 1/2, agreement/HKDF/HMAC/capability hashes, 15 exact encryptions,
51 typed rejections, persistent replay-window states and expiry/skew boundaries. Both languages
independently encrypt to the same bytes, decrypt them, and round-trip random production keys/nonces.

Choices frozen: compact canonical JSON/field order, integer Unix milliseconds, canonical u64 strings,
ASCII-space padding to minimal 256-byte buckets (including the 2,048-byte cap), bounded identities/
routing/title, Unicode-code-point preview truncation, encrypted minimal fallback without truncating
routing IDs, credential hash over `["aiki-push-v1","credential",fullBearer]`, and string `envelope`
in the send body. Production encryption has no nonce override; injected fixed nonces are test-only.
The review follow-up above fixes the initial payload version-skew flaw. JS digest comparison is
constant-work for public lengths, not a JIT timing guarantee.

Integration must allocate/persist sequences and ciphertext retry outboxes, pin expected local route/
backend/session, acquire trusted monotonic-anchored backend time, and serialize admission per session.
`RelayAdmission.admit` calls synchronous atomic durable persistence before returning permission to display;
a throwing callback commits neither memory nor replay/event state. Reboot uncertainty fails closed.
Persist/restore per-key windows and cross-key event dedupe; later storage must retire old keys/windows
within 13 hours, never reset a live key's counter/window, and wrap/exclude keys and state from backup.
No storage, concurrency wrapper or clock-offset acquisition is implemented here.

Final checks: root 2,019 tests / 23,701 assertions / 169 files, zero failures (182.91s), including
82 new relay tests. JVM XML: 724 tests / 94 suites, 2 skipped, zero failures/errors (80 new relay tests);
assemble succeeds; lint has zero errors, 36 existing warnings. Combined: 2,743 tests, 2 skipped,
zero failures. Typecheck, Android protocol generation (330 DTOs / 88 overloads), relay vector drift
check and public/Gitleaks scans pass. Root `scripts/generate-protocol.ts` does not exist.
No new dependencies, devices/emulators, live servers, Firebase config inspection, main move, push or deploy.

## Web retained-session recovery (T91)

Reproduced on main in real headless Chromium, paired to a fresh required-mode createSetup backend: advancing only
its clock past access expiry/grace produced 4401/auth_expired, persistent Session expired and a stuck transcript.
Reload recovered the retained session. The fixed web app instead discovers/refreshes once per backoff attempt and
reconnects automatically, keeping the project and draft. Proactive renewal failures join that same backoff loop;
short successful hellos do not reset it. Only structured invalid/expired/revoked rejection at the retained exchange
clears credentials/proofs; bare status, discovery/Host rejection and transient failures preserve them. Web Locks read
the latest rotated credential and serialize rejection cleanup. A late refresh cannot reopen a stopped client.
Artifact downloads use signed URLs and uploads use socket RPC, not access-bearer fetches. A raw expired-access HTTP
probe returned 401 (browser fetch saw CORS failure); HTTP refresh/rejection classification is covered separately.

Tests first: 13 initial failures, plus late-renewal and discovery-notice regressions failed before their fixes.
All 20 new recovery tests pass. Rebased onto `sppsrlul` (deploy-test fixes, Zellij startup fix and relay design),
keeping all incoming documentation sections with T91 first. Root: 1,937 tests / 23,224 assertions, zero failures,
180.87 seconds. Web: 897 tests / 13,636 assertions, zero check diagnostics and production build passes. Root typecheck
and public/Gitleaks checks pass. The incoming stack resolves the earlier deploy-fixture failures. A deploy interrupted
the first root run; rerunning also exposed an old copied checkout under an ignored scratch HOME. It was moved outside
the workspace before the clean full run. Keep scratch HOMEs/checkouts outside the repo: Bun discovers ignored tests.
Existing T91 desktop/dark before/after screenshots and the eight-second recovery recording remain valid; no new proof.
Demo services were already stopped by PID; no live data, main move, push or deployment by this worker.

## Firebase-only push relay design (T63)

`docs/research/push-relay-design.md` records D38/D47/D49: Firebase-only relay, thin Google/email-link accounts and open
sign-up within limits, not an implementation. Only phones sign in; backends keep route capabilities, never account
credentials. Separate account UID/installation IDs, FCM possession challenge, per-session ECDH/HKDF/AES-GCM routes,
leases, durable delete-only revoke retries, staged three-backend rollout and per-backend web VAPID remain.
Recommended pilot: 3 phones/account, 8 routes/phone (24/account), 2,000 sends/account/day; global 5,000 sends/day,
100 challenges/day, 20 new relay accounts/day and 100 active accounts, plus IP limits. Direct Auth signup bypasses
relay caps: email-link mail is 5/day without billing, 25,000/day billed; Identity Platform adds MAU exposure above
50,000 free Tier-1 MAU. Do not enable it solely for the relay; neither Functions caps nor relay quotas cap Auth bills.
Both sign-in methods work from a configured sideloaded release APK. Required private facts now include OAuth consent/
clients, release SHA-1/SHA-256, Hosting App Links domain/sender and Identity Platform status/effective quotas. Privacy
text precedes sign-in; no copied profile, required in-app account deletion, durable cascades and disabled-account state
cover all phones. Remaining setup/limit/retention choices are in sections 11/13. Revised emulator-first scope: 22–33
engineering days plus external waits/observation. Public-source guard and Gitleaks pass; no runtime tests (docs only).
No Firebase credentials/config inspected, dependencies installed, services/emulators started, main moved or push/deploy.

## Reliable root tests (T83)

Five separate causes: activity deduplication was asserted on whole-project pushes that also carry attention/links;
now it is checked at the activity publisher, retaining socket working/idle/reply assertions. The nightly test advanced
its fake clock after a fixed sleep, before scope discovery could finish; it now awaits evaluation before advancing.
The cap fixture performs 100 durable transactions/digests; its justified loaded-machine budget is 30 seconds, not five.
Terminal startup has a product race, fixed in the following commit: list-sessions probes can panic Zellij 0.45.1 in
RemoveClient before session_data exists. That fix awaits the first screen-clear render without probing, handles split
escapes/small screens, and orders startup output after terminal.open. Its DESIGN update and render/order regressions
cover the backend change; the test-only commits here do not include it.
Finally, deploy fixtures fetched real Zellij archives into fake homes: a final-check run stalled on GitHub and hit
five test timeouts plus the 280-second command limit. All synthetic hosts now have private terminal stubs; any curl
attempt fails a test assertion. No deployment script behavior changed.

CPU-pinned stress: activity 2/30 failures before, 0/30 after; cap 31/32 heavily starved before, 0/32 after; scoped
terminal 3/12 in the primary heavy batch before, 0/36 after. Nightly did not fail in 42 natural stress runs; forcing
advance-before-discovery reproduced its timeout once. It passes 30 stress runs after synchronization. Passing
artifact revocation deliberately errors its HTTP response stream: Bun logs auth_revoked at artifacts.ts controller.error;
the reader catches it, and this is not an unhandled test rejection (isolated suite 5 pass, zero errors). No suppression.

Previous full-stack root checks (including the following terminal fix), three consecutive runs: each 1,913 pass / 23,162 assertions / 165 files, zero failures, in 210.44s,
194.54s and 190.22s. Typecheck and public guard pass. No retries/skips/assertions removed, UI changes, main movement,
push or deployment. Only the cap's measured bounded workload received a larger test timeout.

## Brave push-service guidance (T89)

Web Settings → Notifications now explains the exact push-service `AbortError`: in Brave, enable “Use Google services
for push messaging” under Settings → Privacy and security, restart, then retry. The raw browser message stays below
in smaller text; other errors are unchanged. The pure mapping in `notifications.ts` has four new unit tests.
Web: 882 tests pass, check has zero errors/warnings, build passes; root typecheck and public guard pass.
Four desktop light/dark before/after screenshots on T89 use headless Chromium, an isolated createSetup backend and
stubbed permission/subscribe calls. No dependencies, main move, push or deployment.

## Preserve Android sessions through access expiry (T90)

Android now backs off and refreshes its retained credential before reconnecting after access rejection, including 4401.
Only structured retained refresh/rotation rejection (401 auth_invalid/auth_expired or 403 auth_revoked), explicit session
revocation or user sign-out clears it. Discovery/Host errors, bare HTTP status and transient failures preserve it.
Short successful hellos no longer reset reconnect backoff. Unreadable storage surfaces a sanitized error and retries;
no synthetic signed-out record, automatic key replacement on invalidation or key creation while decrypting. Existing
ciphertext must be readable before an ordinary write. Review caught the permanent-key pairing trap: explicit new pairing
alone can now replace a confirmed permanently invalidated/unrecoverable key. A durable marker preserves every affected
ciphertext/auth pin before replacing the shared alias; only the explicitly paired origin is overwritten. Other backends
remain separately pairable after the key replacement, and interrupted resets remain explicitly retryable. Temporary
failures and ordinary corruption never permit reset. The new enrollment regression failed before this amendment. DESIGN was updated before implementation; findings now separate the fix from the
unknown incident trigger. Normal renewal is one minute before access expiry; clean app starts/restarts already refresh,
and deploy drain does not hold auth calls, so neither APK replacement nor deployment alone explains the incident.

Tests first: five of six initial recovery tests failed; all eight access-recovery tests pass. Four additional review
regressions cover permanent-key enrollment (both exception types), multiple backends, interrupted recovery, and refusing
reset for temporary/corrupt storage. Full Android: 644 tests, two existing skips, zero failures/errors; assembly and lint
pass (36 warnings, zero errors). First foreground check hit
the tool timeout during lint; the same command completed successfully in the background retry. Track-w synthetic
createSetup demo proves before/after with screenshots and short recordings on T90: old build loses its session after
forced access expiry; fixed build reconnects automatically. All demo paths were under a fresh temporary root and the
server was stopped by PID. No physical phone or live backend changed. Public/Gitleaks checks pass.

No server/protocol/web code change. Existing server codes suffice when interpreted in retained-endpoint context.
Root/web checks were not rerun for this Android-only fix. Automatic web recovery remains a coordinated shared-client
transport/browser-renewal follow-up; web retains its credential for reload. Already-deleted Android credentials cannot
be restored by an update: re-pair each backend from Settings → backend → Devices or explicit-target owner CLI, without
losing projects, conversations or drafts. No main movement, push or deployment.

## Android session-expiry investigation (T90)

Investigation only; no runtime or UI change. See `docs/research/android-session-expiry.md` for storage/signing,
installer-startup review, error mapping and recovery. Android maps every 4401 close to session expiry, then deletes
its retained credential without trying refresh; auth HTTP 401/403 also clear it (including forbidden Host). Short-lived
access expiry can therefore permanently lose a still-valid retained session. Two isolated JVM diagnostics reproduce
4401 and Host-403 deletion; kept as task artifacts, not permanent tests that would encode the bug as intended behavior.
Existing Android auth tests: 25 pass; server auth suites: 48 pass / 2,031 assertions. Typecheck and public/Gitleaks
checks pass. Full suites were not rerun for documentation-only changes. Exact incident trigger remains
unconfirmed without phone auth logs; no speculative fix. Live observations are only in private task evidence.
The auth store, encryption alias, signing setup and origin normalization did not change in the installer/task-row stack;
server platform is metadata, not a different token lifetime. Other Android clients share the destructive close path;
web stops on 4401 too but retains its credential for reload. Re-pair per backend from browser Settings → backend → Devices
(or explicit-target owner CLI); projects, conversations and drafts remain. No live mutations, main move, push or deploy.

## Compact task rows (T87)

Android and web at every width now use subtask progress as the disclosure; parent/plain content keeps identical
columns. Children retain only the 14dp/px guide. Gist, parent link, grouped relation/count menus and progress flow
inline. Minimum touch hit areas grow invisibly; full target tooltips, TalkBack/keyboard access, expansion persistence,
attention visibility and reduced motion remain. Shared waiting summaries avoid case-insensitive duplicate prefixes.
Both commits are rebased onto installer stack `twqrurtr`; every earlier continuation section is retained below.
Task-list source and the task-family DESIGN contract are unchanged from the accepted captures; no new media is needed.
Android: 632 tests, two existing skips, assembly/lint pass (36 warnings, zero errors). Web: 878 tests, zero check
diagnostics and build pass. Root: 1,912 tests / 23,125 assertions and typecheck pass; the rebased run passed first try
in 203 seconds with no flaky-test rerun. Public guard and Gitleaks pass.
T87 has 12 synthetic before/after captures, two playable folding recordings and blocker-menu proof. Android parent
104→82dp, blocker/found-while 116→82dp, normal 62→62dp; same phone/scroll shows 6→7 complete rows. Web phone parent
100→82px, no leading shift even in the narrow desktop sidebar. No protocol/backend changes, main move, push or deploy.

## Local installer and Welcome (T71)

Latest merge verification: the twelve-commit stack now follows the duplicate-report fix and required-mode rollout
docs. All sections are retained. Root: 1,911 tests / 23,121 assertions pass on the first run; typecheck passes.
Web check has zero errors/warnings and build passes; public guard/Gitleaks pass. No installer executable changes,
container rerun, new media, main movement or push. The earlier platform limitations below still apply.

The ten-commit installer stack is rebased on T82/task families/graph, including the later docs-only rollout note.
Private Bun 1.4.4/zellij 0.45.1, versioned releases and required local first-device sign-in remain. The CLI uses
T82’s `childEnvironment`/`loadServerEnv` and passes an explicit owned file/data/config snapshot to the shared
`runServerEntry`; it no longer sets backend values in `process.env`. Source and installed starts share T82’s live-owner
preflight. `aiki pair` addresses its recorded socket; `aiki auth ...` delegates owner commands with an explicit target,
including from child-marked shells without a port setting. Every CLI helper spawn uses the existing scrubber too.
Owned-file port resolution, private-only file settings, scrubbed helpers, child owner commands and live-owner refusal
are regression-tested. Effective data/config are printed before backend state opens.

Clean non-root Debian with env-i/temp paths passes install/rerun, child-marked owner commands, pairing, actual Chromium
Welcome/provider/project setup, update/rollback retaining sign-in, uninstall/reinstall and purge. All three original
server logs are retained. No visible flow change: existing T71 screenshots/recording still apply, no new media captured.
Root: 1,902 tests / 23,064 assertions pass; one initial existing migration-cap timeout passed in isolation and the
full retry, without changing that test. Web: 877 tests / 13,585 assertions; zero check errors/warnings, build passes.
Typecheck, generator --check (330 DTOs / 88 overloads, exit 0), shellcheck and public/Gitleaks pass. Real services,
macOS/WSL execution, remote HTTPS/phone setup and provider inference remain untested. No main move, push, tag or
live-service action. The T82 lifetime-lock caveat remains unchanged; single-binary packaging is still T72.

## One delivery per worker answer (T85)

Spawn and steer reporters can share a final answer. Their old per-call IDs wrote duplicate transcript copies and
board timeline events; the unchanged-text guard suppressed wakes, not those copies. This predates pi 1.5.1 (the
November 9 test expected two copies). Reports now use the worker conversation/final-entry ID, with admission,
board changes and reporter completion in one commit. Distinct unchanged answers remain passive. Old checkpoints
recover the answer and preserve already-decided delivery. Schedule workers share the fix; explicit thread finish
calls already deduplicate and now have review/record restart regressions.

Fake-model tests cover first/second reports, two and three submissions sharing one answer, busy coordinators with
user steers, restart before the coordinator handles a report, schedule review/record and replayed thread summaries.
Rebased onto main `509eb285` (settings isolation plus rollout docs), retaining all continuation sections. The user
confirmed every observed repeat followed interrupting sends and arrived at the next step, not as a fresh wake.
The two-interrupt cases now explicitly count one final answer, one transcript report and one timeline entry.
Root rerun: 1,887 tests / 23,005 assertions, zero failures; typecheck passes. The first root run hit the terminal
scope test's `scoped-ok` timeout and exceeded the command limit; the one full rerun passed. Web check: zero
errors/warnings; build passes. Public guard and Gitleaks pass. No live data/logs were read; no UI, dependencies,
main move, push or deployment.

## Device sign-in rollout status (T57/T69)

The operator's backends now run **required** device sign-in. All known clients (web browsers and the Android app on three
backends) were approved once by exact migration claim ID and connect with their own sessions. Each backend allows its
public origin through `auth hosts allow`; the reverse proxy's source address is in `AIKI_TRUSTED_PROXIES` in the private
server env files. Anonymous sockets get `auth_required` (4401) and unknown Hosts 403; deep deploy health checks pass in
required mode through the owner socket. New devices pair from Settings → backend → Devices. To back out on one backend:
`auth mode optional` (never delete auth state). From agent shells, call the owner CLI with an explicit `AIKI_ENV_FILE`
or `AIKI_DATA_DIR` (T82 isolation). The push relay for friends is T63; this work only binds existing push rows to sessions.

## Agent command environment isolation (T82)

Rebased onto task families/graph and board messages (`e9c693ff`), retaining T80/T81. The entry point captures settings
privately; env-file values never enter `process.env`.
Every spawn uses `childEnvironment`, removing backend `AIKI_*` settings. The sole marker `AIKI_CHILD_PROCESS=1`
suppresses automatic installation env-file discovery. Marker-only `auth` refuses even a live default data path;
explicit `AIKI_ENV_FILE` or `AIKI_DATA_DIR` permits deliberate owner access. Pair/list/revoke/mode/claim-list/approval
pass from normal/SSH shells and both explicit agent routes, including a real bash-tool regression. Owner CLI never
runs server-start ownership checks. Real isolated entry points prove env-file auth mode, backend/public origins,
trusted proxies and web-app URL reach server/CLI. DESIGN inventories every setting; a native-env guard prevents
new direct-read bypasses. Spawn inventory also flags new sites. PATH/HOME/XDG, provider/tooling, SSH, locale and
worker Android variables remain. Pi forces `inheritEnv: false`; Bun's implicit spawns may reuse native startup env,
so every spawn still needs the explicit helper.

Live-owner preflight retries every 100 ms for 3 seconds; missing/refused sockets proceed immediately. Shutdown holds
the socket through asynchronous writes. Immediate/stale restarts and a 150-ms overlap during shutdown flush pass.
Systemd already serializes replacement; the grace is below deploy's 20-second health budget. This is not a lifetime
lock: simultaneous first starts or an existing server without owner control remain follow-up. Always isolate source
experiments on temp data/config paths. Required deploy health/deep/drain and rollback guards pass unchanged (63 tests).
Latest checks: AIKI-unset root 1,878 tests / 22,948 assertions, first run; typecheck; web check zero errors/warnings
and build; public guard/Gitleaks pass. The earlier T80/T81 base also passed inherited root (1,837 / 12,246).
All servers used synthetic temp fixtures; no live data/config, main, push or deploy was touched.

## Bubble club graph (T79)

Bubble club is the only graph; alternate looks/flag are removed. Camera and List/Board/Graph choices are local per
backend/project under name-neutral keys. Captions avoid nodes/each other, hide at low zoom and expose full-title
tooltips. Aspect-aware initial layout pre-settles before SVG; updates retain tasks, animate worker travel and fade
completion. TasksPanel is untouched. The synthetic demo script has loopback controls for reports, moves, arrivals,
completion and 80-task load; it never uses installed data or real worker tools.

T79 has six normal/dense after screenshots, a 15-second live recording and browser/performance JSON. Live travel,
completion, stable arrivals, saved framing/view, phone pinch/tap, keyboard and reduced motion pass. 80 tasks/10
workers, three 240-frame Chromium runs: median 16.7ms, p95 16.7–16.8ms, mean 17.38–17.51ms; first graph paint
87–90ms. Occasional 133–150ms mount/closed/Fit intervals remain; no deeper profiling was pursued. Stacked above web
and Android family folding, preserving every continuation section and both DESIGN contracts. Web: 872 tests, zero
check errors/warnings and build pass; root: 1,857 tests and typecheck pass on the first run; public guard passes.
Isolated createSetup (default auth off) production-build smoke folds/unfolds a list family, opens the graph with
22 active tasks and six workers, and retains folding across view switches. No page errors or new media. No dependencies,
main move, push or deployment. Android still needs the native graph, gestures, accessible focus and motion contract.

## Android task families (T74)

Android now shares the web's same-status family and always-visible attention rules. Quiet families default folded;
explicit choices persist per backend/project/parent in local `DeviceSettings.taskFamilyExpansion`. Native controls
have expanded/collapsed TalkBack descriptions, static progress rings and 14dp guides. Attention sections start open;
cross-status children retain their own groups and parent links. No web, protocol or backend behavior changes.
Both changes are rebased onto main `tqplwulm`. Android: 631 tests (two existing skips), assembly and lint pass
(36 warnings, zero errors); generator check exits 0 (330 DTOs / 88 overloads). Root: 1,837 tests and typecheck pass;
web: 852 tests, zero check diagnostics and build pass. All continuation sections were retained, ours first.
The final plain root run and an `AIKI_*`-cleared run both pass. A prior nightly-maintenance timeout did not reproduce
in the six-test file on either this stack or plain main; no unrelated code was changed. Task-list source/behavior is
unchanged by the rebase, so existing T74 visual proof still applies. No new media, main move or push.

## Collapsible web task families (T74 / D44)

The task list now uses C only, without a dev flag. Quiet same-status children start folded; parent choices persist
per backend/project under `aiki.task-families.v1`. Cross-status or cross-section children stay in their own group
with a parent breadcrumb. Review, blocked, waiting, question and warning rows never fold away; same-status
attention descendants stay nested and visible. Attention sections start open. Counts include folded work. Native
Enter/Space buttons, nested lists and reduced-motion rules preserve keyboard/touch access. Android remains deferred;
it will need these visibility rules and scoped local expansion choices.
Rebased onto the renamed main as well. Web: 825 tests, zero check errors/warnings and build pass; root: 1,720 tests
and typecheck pass. Added-line public-source
scan passes. T74 has nine after screenshots plus a recording of keyboard expansion, reload persistence and live
attention escaping a collapsed family. No main move, push or deployment.

## Stable migration inventory (T81)

Migration claims now wait 14 idle days (30-day absolute cap), refreshing last-seen on proof-bound polls and registration.
Idle expiry revives the same ID/code. Approval lasts 14 days; sessions are minted only when collected, with 60-second
retry delivery and revoke-before-remint if unacknowledged. Pairing/bootstrap keep their strict existing rules. Inventory
includes all states/last-seen; `migration list --pending --json` filters pending. No wire fields or authVersion change.
Web/Android preserve proofs through expiry/network errors, retry quietly, and stop only on explicit denial. Android's old
ambiguous stopped message recovers once; the old web proof recovers on reload. Approved offline devices can collect even
following required-mode cutover. New tests cover lifetimes, offline approval/restart, remint, inventory and client recovery.
Checks: root 1,817 tests and typecheck; web 832 tests, zero check errors/warnings and build; generator check exit 0
(330 DTOs / 88 overloads); Android 612 JVM tests, two existing skips, zero failures/errors, debug assembly and lint
(36 warnings, zero errors). Public guard and Gitleaks pass. T81 holds synthetic web reload and emulator-u recovery
screenshots/recordings. No live backend, phone, main or remote changed.

## Required-mode deploy health checks (T80)

Required local health checks now run only hello/status/drain/list/page through the owner socket and normal RPC dispatch;
no deployment credential, device or session is created. Optional/off/older servers retain anonymous WebSocket checks;
remote warning-only checks accept valid required discovery. System checks run as the unit's User, using noninteractive
sudo only when accounts differ; same-account installations need no permission change. DESIGN documents private env/user
overrides and required-cutover prerequisites. Releases record auth support; read-only persisted-mode guards refuse
pre-auth rollback (including failed manual-rollback restoration), even with the backend stopped, and record the refusal.
Deploy a known-good metadata-bearing release while optional before cutover. Never use old tooling to bypass the guard.
Root: 1,808 tests, zero failures, typecheck; web: 829 tests, zero check errors/warnings, build. Generator check exits 0:
330 DTOs / 88 overloads. Public guard/Gitleaks pass. Protocol untouched; no Android rebuild, live data access or deploy.

## Full device sign-in rehearsal (T68)

The renamed merged stack passes root 1,784 tests and typecheck; web 824 tests, check (zero errors/warnings) and build;
Android 608 tests (zero failures/errors, two existing skips), assembly and lint (36 warnings, zero errors).
Generation exits 0: 324 DTOs / 87 overloads. Public guard and Gitleaks pass. The owner CLI also finds its running
backend when only the private server env file supplies the data directory; a subprocess regression locks this in.

Three data-bearing scratch backends defaulted optional; an empty directory defaulted required. Real pre-auth web/APK
updates retained addresses, names, notification IDs/settings and a synced draft. Both clients registered claims quietly;
six comparison codes matched the fixed CLI inventory. Exact batch approval authenticated them without reload and left
strangers unapproved. Fixed web push sync to upsert before reading the legacy row, which is not yet readable by the new
session. Regression fails before and passes after; web/FCM rows then bind on all three. Synthetic push transport/tokens
only, not live delivery. Eight-second artifact URLs reminted on all three web backends; native media remained visible.

Required cutover and disk/client restarts retained sign-in. Android created a link for a fresh browser; matching-code
approval succeeded. Web revocation signed Android out on that backend, removed its push row and detached its live native
terminal while the host job kept writing. T68 holds screenshots and short recordings. No real backend, phone, provider
or deploy was used. Rehearsal processes and emulator are stopped; main was not moved and nothing was pushed.

At rehearsal time optional deep deploy checks passed on all three; required checks failed with auth_required.
T80 above now performs equivalent private checks over owner control. Discovery alone remains insufficient. Old web shows generic reconnects, not auth-specific refusal;
Android's terminal retains generic connection-lost wording after revoke, while Backends/Devices correctly show signed out.

## Web device sign-in (T66)

Web now implements the Device sign-in contract: isolated IndexedDB retained credentials and proofs, exact-origin/auth
pinning, Web Locks staged rotation/crash recovery, live access renewal, `/pair` (v2 and bootstrap), app-wide comparison
approval, backend Devices/QR/rename/revoke, and quiet optional-mode migration notices/polling. Address exports stay
import-only. Push sync rebinds an existing subscription after authentication; artifact leases retain their existing
remint/video-position behavior and retry failed remints. DESIGN records web storage and rollout details. No server or
protocol changes were needed in this web change; it builds on the committed Aiki-prefix server contract.

Checks: root 1,750 tests and typecheck; web 819 tests (18 auth tests), zero check errors/warnings and build pass.
Android generation check exits 0 (324 DTOs / 87 overloads); public guard passes. T66 has synthetic desktop/phone,
light/dark before/after screenshots plus a two-context Chromium pairing/approval/authenticated-connect/revoke recording.
No live data or backends were used; nothing was pushed or deployed. Keep optional mode until known clients are approved
and have rebound push. Browsers without Web Locks refuse unsafe retained-token rotation; local bootstrap still expects
the web UI on the backend loopback origin (the server does not yet bundle it).

## Device sign-in security acceptance (T68)

Independent server tests add 18 HTTP/WS/owner-socket cases to the existing 46 auth cases. Fixed three reproduced bugs:
forwarding metadata containing only `X-Forwarded-Proto`/other forwarding headers could qualify for local bootstrap;
guessed retained IDs or anonymous exchanges could exhaust valid devices' refresh/rotation budgets; expired pairing
approval closed a healthy owner's socket. Invalid retained proofs now have a separate backend budget. No wire change.
The reusable `device-auth-migration.test.ts` rehearses three optional backends, two browsers, Android and a stranger:
fixed CLI inventory, exact/idempotent batch approval, delivery/ack, expiry, required cutover and disk restart.
Live tests cover streamed artifact abort, both push rows, queued-input cancellation and zellij detach with host-job survival.

Root: 1,750 tests and typecheck pass. Web: 801 tests, check (zero errors/warnings), build pass. Android generation check:
324 DTOs / 87 overloads, exit 0; no protocol changes here, so no Android rebuild. Public guard passes. Real web/Android
credential storage and downgrade refusal remain client-worker checks: servers provide stable backend ID, `/auth/status`
and explicit auth feature flags; clients must pin advertised support and reject later missing flags/404, never infer auth
from the legacy baseline list. Tests simulate missing flags, not a malicious replacement server or real proxy/TLS network.
Nothing deployed or pushed.

## Android device sign-in (T67)

Android now discovers/pins auth per origin, stores retained sessions and staged claim/rotation proofs in a separate
Keystore AES-GCM DataStore excluded from backup/transfer, authenticates hello, renews live sockets and stops on sign-out.
Settings has pairing-link paste, Devices, one-time QR/share grants, global matching-code approval and optional-mode
migration notices/polling. Claims survive process death; credentials precede ack. Rotation can recover a committed
successor beyond the old-token retry window. Existing image/video renewal is reused; downloads re-mint once on failure.
FCM registration already runs on every new ready connection, including authenticated reconnects. No relay is added.

Root: 1,732 tests and typecheck pass; web: 801 tests, check zero errors/warnings and build pass. Android XML: 608 tests,
zero failures/errors, two existing skips; debug assembly and lint pass (34 warnings, zero errors). Generator --check exits
0: 324 DTOs / 87 overloads. Verification: 7 tests / 49 assertions and its TypeScript check pass. Public guard passes.
T67 holds emulator-only before/after light/dark settings, Devices/QR, pairing/comparison, approval, waiting and revoked
screens plus pairing/approval recordings. Real scratch bootstrap/pair/approve/revoke and migration registration ran;
the same migration claim survived an in-place APK upgrade. No physical camera, live FCM or hardware-key invalidation
claim. Install the normal configured APK in place, keep backends optional, approve each phone claim through the owner
CLI, verify authenticated Devices and push re-registration before required cutover. Never uninstall to migrate.

## Stage-1 auth compatibility and Aiki wire prefixes (T65 follow-up)

Optional/off keeps the old artifact origin derivation (explicit public URL, otherwise forwarded proto/host or Host),
without requiring newly configured backend origins/proxies. Required mode stays strict; cutover closes authenticated
sockets carrying an unapproved legacy minting origin too. New handshake quotas, pending cap, hello size cap and timeout
apply only in required mode. Legacy WS Origin rejection and signed-artifact CORS match pre-auth behaviour. Legacy
notification RPCs remain usable even after another tab binds that notification ID; re-registration preserves its binding
so revocation still cleans it up. Auth management remains private. Eleven new compatibility tests cover this, including
unchanged deploy health-check hello, saved-open-project inventory and deep status/list/page checks in optional mode.
Required deployment checks still need an authenticated session (or equivalent owner-only private checks), not merely
`/auth/status`. New wire secrets now use `aiki_s1/aiki_a1/aiki_c1/aiki_p1/aiki_b1`; comparison fixture is `VE2X-TWTS`.
Existing `AIKI_` environment names are unchanged. Checks: root 1,732 tests and typecheck; focused auth 46;
web 801 tests, zero check errors/warnings and build; Android 584 tests (two existing skips), assembly and lint
(zero errors, 35 warnings). Generator check (324 DTOs / 87 overloads) and public guard pass. See DESIGN for the
updated contract. No deployment was run.

## Device sign-in server/protocol (T65)

Server device authentication now has durable owner sessions, protected hello/renew, bootstrap/pairing claims, refresh/
rotation, migration batch approval, revocation, session-bound ten-minute artifact URLs and session-bound push rows.
New directories start required; pre-existing data defaults optional; tests explicitly use off unless testing auth.
Owner commands run through `bun packages/server/src/main.ts auth ...` and the owner-only `<data>/auth.sock`, not network
management endpoints. Configure/allow backend origins before required cutover; optional keeps legacy routing.
The full client contract, link encoding and comparison fixture are at the top of DESIGN. Auth support is explicit:
`LEGACY_HARNESS_FEATURES` excludes the three new auth flags, including generated Android defaults. Protocol generation:
324 DTOs / 87 overloads. Added 35 server auth tests. Root suite: 1,721 tests; web: 801 tests, zero check errors/warnings
and build; Android: 584 tests (two existing skips), assembly and lint (zero errors, 35 warnings). Typecheck, generation
and public-source guard pass. No UI, relay, deployment or cross-backend migration bundle was built; do not switch existing
backends to required until updated clients have claimed, been approved, acknowledged and rebound push.


## Usage analysis and subscription resets (T78)

Phase-one web prototype adds role/model/project/task usage over the 90-day log. `usage-breakdown` adds optional
`cache.stats.usage` and local-calendar Today; internal compaction/extraction/maintenance usage begins accumulating
with this release. `subscription-resets` adds explicit confirmed one-shot Claude/Codex reset consumption, fresh
read-only grant discovery, request UUID deduplication and unknown-outcome handling; no real reset was triggered.
See DESIGN and `research/usage-analysis.md` for recording gaps, tab decisions and undocumented provider contracts.
Android DTOs are generated; its usage screen is intentionally unchanged pending web review. Log schema is 2;
legacy logs migrate additively and internal calls cannot be backfilled. Web has five keyboard-accessible tabs and
Today/7/30-day periods, model totals plus role splits, cost-ranked tasks and clearly qualified waste signals.
Checks: root 1,715 tests and typecheck; web 810 tests, zero check errors/warnings and build; generator check exit 0
(305 DTOs / 79 overloads); Android 584 tests (two existing skips), unit tests and debug assembly pass. Focused server
regressions pass (30 tests). T78 holds synthetic before/after captures in desktop light/dark and phone dark for all
tabs, reset confirmation/result, browser checks and an 11.6-second interaction recording. No real reset, push or deployment.


## Anthropic subscription user agent (T76)

Anthropic chat models override pi-ai 1.5.1's old user agent with `claude-cli/2.1.311`.
Catalog tests retain the no-fallback policy; fake API-key and OAuth HTTP tests verify the wire header,
cache-warm fingerprint and continuation. No real provider requests. Root: 1,700 tests and typecheck pass;
web check has zero errors/warnings and build passes. Public guard and Gitleaks pass. No deployment or push.

## Aiki identity and existing installations (T70)

Rebased onto the pi 1.5.1 integration upgrade; all checks below were rerun on that base. Its upstream storage-format
and downgrade caveats still apply (see the upgrade notes below).
Public packages/settings/storage now use Aiki identifiers. The mechanical rename is a separate commit; its replay
script stays in private local configuration. The server loads an optional XDG `aiki/server.env` before registering
durable kinds; `--print-config` is read-only. Per-target private env sources preserve existing data/config paths,
bindings, origins, document/task namespaces and project context identities. Deploy roots/services, user unit source,
watcher state and identity remain locally configurable; no installed unit, live data, bookmark or remote was changed.

Hosted browser builds opt into namespace migration through private `web.env`; localStorage, IndexedDB and push
registration caches retain originals. Native properties retain application ID, preference and notification intent
prefixes; an activity alias retains existing explicit intents. DataStore and notification channels are unchanged.
Three running-target config simulations match; hosted output retains the exact three suggestions. Emulator update
retained preference bytes and old activity intents. T70 has synthetic browser/native screenshots and recordings.

Root: 1,698 tests pass normally and with deployment configuration; typecheck passes. Web: 805 tests, zero check
errors/warnings, build passes. Generator: 299 DTOs / 78 overloads, exit 0. Android local and public builds both pass
unit tests, assembly and lint: 584 tests, two existing skips, no failures/errors; public lint has 37 warnings.
Publication guard and Gitleaks pass; the copyright notice is the only protected-name match. Private configuration,
three baseline snapshots, a read-only simulation and an unapplied host-config patch are prepared in the stable
checkout's ignored local directory. No manual data move, reinstall or host rebuild is needed for this release.


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

Aiki is an early personal cross-device agent harness built on pi durable. Packages use `@aiki/*`; native sources use
`io.github.mitzacoder.aiki`. Bun only for TypeScript; see `DESIGN.md` and the root README for architecture and setup.
Original project code is MIT; bundled third-party licences still apply.

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
