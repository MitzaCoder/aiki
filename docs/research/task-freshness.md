# T120: automatic, uncluttered task updates
Design only. D59: predictable stale rules → one batched nudge → agent-written Results/Next.
The automatic line **replaces Now**. Applies to every harness project; deploy hooks are opt-in.

## 1. Diagnosis from the code
- `packages/server/src/board.ts:writeReport` replaces only named sections, without conflicts.
  All three share `updatedAt/updatedBy/revision`: fresh worker Now disguises ancient Next.
  Concurrent writers can overwrite prose; `addResult` deduplicates only an identical last bullet.
- Now is LLM-written (`board.write_report`, workers' `task_progress`). Ordinary reports,
  stops and forgets do not clear it; failure changes status, not prose. Exception:
  `recordScheduledReport` replaces Results/clears Now for a collecting schedule task.
- Results requires coordinator synthesis or worker `addResult`; a final worker answer
  becomes a timeline gist and coordinator input, not merged Results. Tests, integration,
  commits and evidence in chat do nothing to prose unless an agent records them.
- Next has no dependencies/expiry. Question answering records the answer but never
  invalidates Next. T71 still asking for the Q121 signing/licence decision after its
  answer, prep, merge and tag is a direct consequence, not just an old timestamp.
- `board.ts:buildTimeline` combines snapshots, questions/answers, decisions, feedback
  state changes and worker/link events. Plain report rewrites are absent unless an LLM
  supplies a milestone; worker start/report/failure are separate, ungrouped rows.
- `changeOwner/noticeHandoff/releaseThread` change ownership/send chat, not handoff events.
  `threads.ts:finish/#reportFailure` update threads, post to main and notify, not task prose.
- `workers.ts:REPORT_RULES`, worker instructions, `threads.ts:threadInstructions` and the
  board tool ask agents to keep reports current; events do not enforce this. Task-scoped
  user chat becomes feedback. An answer only in ordinary chat needs `resolve_question`.
- `jj.ts` manages workspaces, not integration/commits/pushes. Those are shell actions,
  with no task-aware VCS event stream. A chat hash is not verified commit evidence.
- `deploy/watch.sh` polls Git's configured ref (default `refs/heads/main`) every 10 s,
  including colocated jj bookmark moves; deliberately avoids background jj snapshots.
  It remembers moves and catches up intermittent targets. `deploy/backend.sh/deploy.sh`
  use `deploy-status.ts`: atomic **last-attempt** files, `ok/failed/rolled_back`, optional
  `backendUnchanged`/pending. Pending without a prior record writes nothing; no journal.
- `server-status.ts` discovers the file from release layout or `AIKI_DEPLOY_STATUS_FILE`,
  watches the directory plus a 10 s fallback poll. `server.ts` broadcasts `server.status`
  and calls `Notifier.deployProblem` on startup/change: global failures/rollbacks, not
  success, no task mapping or all-target aggregation. Client status is not task history.
  Unlike DESIGN's older Board text, current code/newer Tasks text leave review to the coordinator.

## 2. Event catalogue and clutter budget
Y = curated timeline or automatic Now; N = no. Timeline Y means evidence **inside a
folded group**, not a new top-level row. Conditions marked * are explained in the row.

| Candidate event | Timeline | Now | Fold/merge rule |
| --- | --- | --- | --- |
| Create/reopen/status/wait/dependency change | Y | Y | Work group; review/closure in outcome |
| Title/description/order/scope/ref metadata refresh | N | N | Task fields only, no heartbeat |
| Task link/unlink | Y | N | Net links summary in Work |
| Worker start/resume + report/end | Y | Y | One run entry evolves: start → outcome |
| Worker progress/phase | N | Y | Replace latest phase, no history per update |
| Worker fail/stop | Y | Y | Same run, failure dominates group label |
| Forget/workspace cleanup | N | Y | End active source, no cleanup row |
| Duplicate/passive report / `Nothing new.` | N | N | Existing admission/dedupe remains |
| Thread start/finish/fail/stop | Y | Y | One episode, on tasks actually worked/held |
| Claim/release/handoff | Y | Y | Ownership entry; initial claim folds into start |
| Thread messages/replies/check-ins | N | N | Chat only; mention fallback below |
| Explicit task handoff/request accepted | Y | Y | Ownership event, not its transport message |
| Coordinator task-focused work start/end | N | Y | Activity only, not all-project chat |
| Q/warning asked/answered/acknowledged/withdrawn | Y | Y | One Q entry evolves in Decisions/feedback |
| Feedback received/handling/addressed/dismissed | Y | Y* | One F entry; *pending receipt affects Now |
| Answer/decision only in chat | N | N | Stale fallback; agent must resolve Q/decide |
| Explicit board decision | Y | N | Decisions/feedback; link Q if applicable |
| Results/Next rewrite | N | N | Section metadata, no timeline echo |
| Meaningful explicit milestone | Y | N | Attach Work/Delivery, dedupe linked cause |
| Artifact saved | N | N | Files/evidence; milestone only if meaningful |
| Individual tools/logs/tokens/reads/writes/heartbeats | N | N | Never task history |
| Test/check/build outcome | Y* | Y* | *Structured declared check run, one run/outcome |
| Local commit/change or rewrite | Y | N | One change entry in Work, replace hashes |
| Integration ref advances | Y | Y | Delivery: landed ≠ deployed |
| Push/tag observed | Y* | N | *Configured publication refs, fold Delivery |
| Deploy queued/start/progress/target outcome | Y | Y | One attempt, target details update in place |
| Rollback/failure/catch-up/supersession/retry | Y | Y | Same delivery, nested attempts, retain errors |
| Unattributed/unrelated commit/deploy | N | N | Project diagnostics, never guess a task |
| Schedule outcome/skip | Y* | Y* | *Existing schedule-task policy, fold repeated runs |
| Compaction/login/memory/reconnect/restart | N | N | Existing global notices, not task activity |

Default: **at most three groups per task per clock hour**: Work, Decisions/feedback,
Delivery. Omit empty groups; each shows range/count/latest meaningful outcome and expands
into structured entries. Failures/open questions dominate labels and remain actionable in
existing attention sections: never delay an urgent signal for a quota. A cross-hour run
stays one entry in its starting group; update end time, sort by start, no moving rows on
progress. Intermediate phases replace, not accumulate; outcomes/answers/status history stay
inspectable. Filters work inside groups. No new pushes for updates/staleness/success; keep actionable pushes.

## 3. Automatic Now: exact rules
A project-local reducer uses durable task-linked facts; no model/chat scraping. Use worker
title or optional short structured phase. `fern is building the Android card view · 4 min
ago` requires that phase; otherwise `fern is working on Android card view`. Age is since
phase/state change, not last token; not a liveness assertion. First matching rule wins:
1. Unresolved deploy/worker/thread failure: `Deploy failed on 1 of 3 targets · 2 min ago`.
   Clear on retry, verified recovery or linked warning acknowledgement (never proof of live).
2. Blocking open Q: `Waiting for your answer to Q131` (+`and 1 more`); append `· 2 workers
   still running` if applicable. Questions default blocking, optional `blocksWork: false`;
   warnings block only explicitly. Answer/withdrawal removes the wait immediately.
3. Attributed deploy active: `Deploying 5ed27fe… · 2 of 3 targets ready`; queued is `Deploy
   queued for 5ed27fe…`. Main movement alone is not deployment start.
4. Live worker/check/coordinator task-focused activity: latest phase-changing actor,
   stable actor ID tie-break; `fern is testing the card view · +1 worker`. Thread/main must
   have taskId focus (submission or explicit focus), not every task owned by that thread.
5. Unhandled feedback: `Feedback F8 is waiting for the coordinator`.
6. Blocked/waiting/review state: `Blocked by T42`, `Waiting for external review · since
   14:00`, `Ready for your review · since 14:10`; use existing notes and dependencies.
7. Latest delivery for 24 h, unless new work supersedes it: `Live on all backends since
   14:17` only for a verified all-backend target set; otherwise `Live on 2 of 3 targets ·
   1 pending`, or `5ed27fe landed · not deployed yet` only when deploys are configured.
8. `Done since 14:17` / `Dropped since 14:17`, `Not started`, or `Idle since 2 h` (since
   last linked run ended, creation if none). Delivery fallback expires to this rule.
Closed tasks ignore lingering worker/focus activity until reopened but retain shipping
outcomes/failures. End/stop/forget/release clears its source, not a shared string. Reconcile
transcript activity after restart. Unreachable source → `Status unknown`, never proof of
working/failure/live; no timeout of legitimate long tools. Push transitions immediately
(target <2 s, external poll ≤10 s when reachable); clients tick ages without server writes.

## 4. Generic commit/deploy attribution
- Persist project/repository-scoped task ↔ change ledger with attribution source,
  thread/conversation/run, optional stable jj change ID and concrete commit hashes.
  Portable default: `Task: T120` trailers, multiple allowed, in Git messages/jj descriptions.
  Validate against that project's board. Worker structured `changes` verifies repo objects.
- Isolated single-task workspace base/tip is fallback provenance, never “all commits while
  worker ran”. Shared/multi-task work requires explicit IDs. Task commit/change refs count;
  PR refs need verified commit membership. Conflicting attribution needs correction, not
  automatic union. Squash/merge preserves trailers or supplies `sources`; rebases retain
  change ID/replace hashes. Record before cleanup. Expose provenance and allow corrections.
- Observe configured integration refs read-only (Git objects/refs for Git/colocated jj;
  no-working-copy adapter for jj-only). Baseline on attach, no whole-history backfill.
  Reopen/poll catches external moves. Diff reachable commits against previous tip; force
  moves/reverts record removals, never pretend everything shipped. Ref ≠ push/checks/deploy.
- Projects configure **no deploys**, or trusted local atomic status-feed file/bounded argv
  command returning versioned JSON. Harness observes, never deploys. Envelope: project/repo,
  attempt ID/sequence, intended commit, previous per-target commit, expected targets,
  per-target queued/running/ok/failed/rolled_back/pending, observedAt, optional task/change IDs.
  Validate scope/objects, bound payload/time, reject regressing sequence, persist dedupe.
- Freeze task membership from each target's last verified success → intended commit,
  including all newly shipped changes, not just tip. Fan outcomes to **every shipped task**,
  including closed/archived, without reopening or one push per task. Track attempted versus
  serving commit after rollback; late attempts cannot overwrite newer ones. Offline ≠ ok.
- This watcher is one adapter instance: orchestrator publishes aggregate journal/current
  snapshot with starts, web/backend outcomes, catch-up and backend-unchanged verification.
  Today's per-backend last-status files cannot prove all-target success/recover missed
  attempts. Origin-side spool survives harness restart; consume missed sequences on startup.
  Backends need not contact each other. Never assign unrelated harness deploys to projects.

## 5. D59: stale rules, fallbacks and cheap nudges
Per section: writtenAt/by, version, coveredEventSeq, optional `next.waitsOn` IDs (Q/task/
change/deploy). Cover only facts read, not concurrent arrivals. Preserve prose; never invent its replacement.

**Next stale immediately:** waited-on Q answered/withdrawn, blocker resolved, worker
start/resume/report/fail/stop, thread handoff/finish, commit recorded/landed, publication/
deploy stage change, task stage change or new feedback. Without waitsOn, **any task Q
answer** invalidates nonempty Next: legacy T71 needs no text parser.
**Results stale:** worker/thread/check outcome, commit/integration/publication/deploy
outcome, decision or feedback addressed with new evidence. Review/done with empty Results
requires rewrite. Starts alone do not discredit historical Results. Milestones invalidate
only sections not rewritten with them. Count uncovered meaningful facts, not progress,
polls/tokens or folded group count. Label: `written 2 h ago · 6 events since · needs update`;
expand reason `Q121 answered; work advanced`. Empty: `No results yet · work finished`.

**Layered fallbacks (recommend 1, 2, 4 on; 3 optional, bounded):**
1. Outgoing coordinator reply/thread message mentions `T71`/`task T12` with substantive
   content and no report write that turn → mark unwritten sections stale, reason “discussed
   in chat”. Parse valid project IDs outside quoted/code blocks; exclude generated transport
   prefixes, bare IDs/links and known “filed under T…” templates. Deterministic conservative
   heuristic: ≥40 other text characters, or explicit structured taskId plus non-template
   text. Keep up to two bounded snippets/source refs, no timeline echo. No semantic truth
   claim; some false positives are acceptable coverage warnings. Costs zero model tokens.
2. Age backstop: in_progress/review/waiting, section older than latest meaningful activity
   **and** ≥2 h old → stale; include substantive chat mentions as activity. Unknown legacy
   coverage with new activity qualifies. Quiet old reports alone produce no nags.
3. Optional small-model audit hourly/on idle, only uncertain active tasks with new evidence
   since last audit and no pending/delivered nudge for unchanged sections. Batch ≤4 tasks:
   ~200 instructions + ≤600 input/task (report, recent timeline, mentioning chat), ≤100 output
   total: ≤2,600 input + 100 output/run/project; four busy hours ~10,400 + 400 tokens,
   continuous daily cap ~62,400 + 2,400. No-change hours cost zero. Return task/section and
   only `stale: reason` or `fine`, never prose/tools; treat source text as untrusted evidence.
   Truncation/“fine” cannot clear deterministic stale state. Cache audit coverage; errors
   leave uncertain, no retry loop. Configure model/budget; disabled by default: useful
   safety net, not required core cost. Assess missed cases before enabling broadly.
4. Report's `This looks out of date` action marks Results/Next stale and nudges once;
   optional short reason, no automatic status move. Zero audit tokens, one normal rewrite.

Mark stale synchronously. Debounce **30 s trailing, 2 min maximum** from first trigger;
one nudge/task/burst, merge sections/causes. Batch tasks by owning live coordinator (else
main) in one short system line at next turn boundary; piggyback answer/report/board
follow-up where possible, otherwise durable follow-up, never interrupt:
`[reports] T71 Next stale: Q121 answered, work advanced; T42 Results empty at review. Read tasks; rewrite stale sections with evidence.`
Cap ~100 tokens/line; overflow stays queued. Persist outbox/admission key (task + section
versions + burst). After delivery suppress further nudges for unchanged versions until
rewrite; badge/count keeps updating. Covered rewrite rearms; no-op rewrite does not.
Long-stale-only sweeps ≤hourly/project, no nag loop. Small-model flag/button share this
path. Costs: deterministic detection zero model tokens; one ~40–100-token line/batch,
plus task reads/prose generation only when needed; no event-by-event coordinator turns.

**T71 acceptance:** Q121 answer clears automatic wait, marks Next stale and queues once.
Prep/merge/tag in that burst merge causes; subsequent events update badge without repeated
wakes until rewrite. Old Next is visibly not a current owner request. Only the agent can
replace it, e.g. `Coordinator: verify draft assets; owner: approve publication`.

## 6. Protocol, prompts, clients, migration
Gated `task-freshness`: typed activity/actor/source/since/refs, section coverage/staleness,
stable timeline IDs/group/range/revision, structured changes/checks, stale-button request.
Transactional lifecycle reducers use thread + conversation/run identity (worker names
are reusable/per-thread). Persist external cursors/event sequence separately from short
snapshot-key retention; bump timelineRevision on folded updates. Agent writes include
coveredEventSeq; prevent unseen events being cleared and use section versions for races.
Stop asking agents to write Now/narrate tools. Worker title is initial phase; optional
phase only on real change. `task_progress` retains evidenced addResult, changes/checks,
rare milestones. Coordinator still synthesizes Results/Next, resolves chat answers,
records decisions, handles feedback, owns review, and preserves commit attribution.
Update REPORT_RULES, board/progress schemas, thread/worker prompts and schedule record
path together. Legacy Now calls become actor phases expiring with the run, not prose.
Web/Android replace Now in existing Report and list/card/graph gist, not a banner; add
section ages/folded timeline/button with keyboard/TalkBack support. Keep bounded header,
reply space and existing attention sections. Tick ages locally/quietly; search canonical
activity text, not ages. Update TS protocol/client, regenerate Kotlin, share fixtures.
Mirror canonical text to legacy report.now, without refreshing prose age. Old backend keeps current UI.
Preserve legacy Now in folded history/snapshots, not live state; infer no phase. Initialize legacy section dates as **approximate** from
shared timestamp, coverage unknown, stale on next qualifying event; no migration nudge
storm/deploy backfill. Snapshots remain immutable. No UI changes are implemented here.

## 7. Small mock-ups (synthetic)
```text
T24 Android card view [Working ▾]        Report
Now      fern is testing the card view · 4 min ago · +1 worker
Next     Coordinator: inspect proof. · written 18 min ago · 2 events since · needs update
Results  Card layout implemented; proof attached. · written 8 min ago
```
```text
T25 Pilot release [Review ▾]             Report
Now      Live on all backends since 14:17
Next     You: decide on the signing key. [needs update: Q131 answered]
         written 2 h ago · 6 events since                 [This looks out of date]
```
```text
Timeline (busy hour; each group expands, no tool/progress spam)
14:00–14:36 ▸ Work: 2 workers reported; ready for review (9 facts)
              fern 14:00→14:28 implemented → checks passed; moss reviewed → proof attached
14:08–14:22 ▸ Decisions/feedback: Q131 answered; F8 addressed (4 facts)
14:38–14:47 ▸ Delivery: 3 changes landed; live on 3/3 targets (5 facts)
              d7 queued → deploying → ok; expand for target outcomes
```

## 8. Separately shippable effort
1. Staleness/cheap fallbacks/nudges, 3–4 days: T71 replay, bursts/races/restart/no nag tests.
2. Automatic Now/prompts/compatibility/clients, 3–4 days: multi-worker/focus/clock tests.
3. Folded timelines on both clients, 2–3 days: busy-hour/urgent/accessibility/history tests.
4. VCS ledger/ref observation, 3–4 days: Git/jj/rebase/squash/force-move/no snapshot tests.
5. Generic deploy adapter + watcher, 3–5 days: rollback/offline/catch-up/unchanged/fan-out tests.
6. Optional audit, 1–2 days: budget/empty-hours/injection/false-positive evaluation fixtures.
Total 15–22 engineering days including optional audit; not an elapsed-time promise.
Open owner choices: approve defaults (2 h age, 30 s/2 min burst, 24 h delivery, three
hourly groups); enable paid audit later? D59/Now replacement/all-shipped-task outcomes settled.
