# Taking the task graph from prototype to product (T103)

> Build note: the owner chose option C (D56). The prototypes and `/graph-lab` were not merged (D57);
> they live only in changes umlnmuqr/lvwtoskk. Production work follows stages T106–T111.
> The study below is preserved as research, not the current implementation contract.

## Recommendation

**Q116 follow-up:** the owner prefers A's visual clarity but wants to retain the graph. Option C below prototypes
that combination for comparison with A. This supersedes the original B-first recommendation, not D45/D46 or a
production implementation decision.

Original recommendation: keep **B: Bubble club**, with the shared summary, search and inspector demonstrated in both studies.
Make the family the unit of the overview and the task the unit of a focused view. Preserve spatial memory.
Use **A: Mission control** as a possible later status lens, not a replacement for the chosen D46 identity.
Do not add a third production view yet. This is an audit and direction study, not a finished graph replacement.
D45/D46 remain in force until the owner chooses otherwise.

The main problem is not frame rate at 100 nodes. It is that the graph is much better at showing that work exists
than telling the user what to do next. A professional version should answer these questions in five seconds:

1. What needs my decision, and why?
2. Which families are moving, quiet, or held up?
3. Who is working on what, and what changed since I last looked?
4. What would unblock the most work?
5. Can I get to the exact task without losing my place?

## What was actually audited

The original `TaskGraph.svelte`, `task-graph.ts`, `task-graph-layout.ts` and `task-graph-camera.ts` were inspected
and rendered unchanged in behavior. The sole change to its prop type accepts the existing board's three structural
properties, so a synthetic board can be passed without constructing a live client. All normal callers still fit.

The development-only `/graph-lab` route has no backend. Its root-layout bypass prevents backend loading/discovery
on a fresh entry. Browser proof used a dedicated profile, never an installed app profile or real session.
A static Vite server served the real Svelte application; this was not a screenshot mockup or image generator.

Fixture: an invented product release, 90 tasks in ten families of nine, a four-level parent chain in each family,
38 blocked-by links, found-while/related links, 20 blocked tasks, ten waiting dates, five open questions, nine workers
(six running, two idle, one failed), and one background thread. Ten tasks are done. The original default therefore
shows 80 task nodes plus ten worker/thread nodes; Show closed gives exactly 100 nodes and 158 edges.
The small fixture has ten tasks (nine active), two workers and a thread. Empty and not-yet-loaded are separate cases.
All shapes are checked against the actual protocol schemas, not partial type assertions.

Every scenario was captured at 1440×1000 and 390×844, DPR 1, Jarvis light/dark. The phone evidence is a narrow
Chromium viewport, **not** an Android hardware, touch, TalkBack or battery test. Neutral theme, high contrast mode,
browser zoom at 200%, localization and very long unbroken titles remain follow-up coverage.

### Honest findings

| Area | What works today | What still looks like a proof of concept |
| --- | --- | --- |
| Labels | Screen-sized labels and collision rejection are much better than unrestricted overlap. Full names exist on focus. | Busy fit shows only 34 labels with closed tasks on desktop, ten on phone. Most ordinary tasks have no title. Similar prefixes become indistinguishable: “Agree on t…” and “Resolve sl…”. IDs inside scaled circles become tiny. Even the small phone fixture suppresses most titles. |
| Overlap / edges | Nodes settle before first publication; explicit blockers have arrows; several relationship kinds have a legend. | Captions compete with large parent circles. Cross-family blockers cut across other families; long diagonal lines look equally important. Small arrows are hard to follow. Family blobs have a fixed decorative footprint, not actual descendant bounds. Nested subtrees can sit outside their apparent family. Showing closed adds more clutter. |
| Status / urgency | Color, spoken status, attention halos and parent rings exist. Worker creatures are a strong identity. | No visible status legend. The same halo means review, question, warning or failed worker. You cannot count or distinguish these at a glance. A blocked node can be visually loud but require no user action. A ring has no visible numerator/denominator. |
| People / threads | Busy/idle creatures, real report sparks, worker reassignment and thread links exist. | At fit, creatures are recognisable but their names, task attachment and thread ownership are not. Many ownership lines are extremely faint. A failed worker and an idle one need explicit reasons, not just color. |
| Project summary | Active task and running-worker totals exist. | No needs-you queue, blocked count, question count, quiet-work signal, completion scope, next waiting date or change summary. You must inspect nodes one by one. |
| Stability | This is already a strength, not an endless force simulation. Tasks are pinned by ID and camera never refits on watch updates. | Caption slots can change as occupancy/status/zoom changes. New tasks must fit around pinned neighbors; crowded insertions cannot make existing space. A changed parent is not necessarily re-clustered because retained task coordinates stay pinned. No “new work off screen” cue or explicit regroup command. |
| Interaction | Pan, node drag, zoom, pinch, Fit, task links and saved camera exist. Focus reveals the family/blockers. | No search, filters beyond closed, persistent selection, focus breadcrumb, back-to-selection, relationship toggles or overview navigation. Hover vanishes on departure; touch has no durable hover equivalent. Wheel zoom is center-based rather than pointer-anchored. Dragged task positions do not constitute a saved manual layout. |
| Accessibility | Task links have full accessible names and status; Tab/Enter are supported. Creature and attention CSS animation becomes `none` under reduced motion. | Eighty task links plus ten focusable worker/thread images make a long, unstructured Tab sequence. No arrow navigation, graph-specific update announcements or task-list equivalent within the graph. Images are focus stops without actions. Focusing an off-screen SVG link does not provide a deliberate camera-reveal contract. Full titles in a tooltip do not solve target size. |
| Contrast | Caption foreground is strong: approximately 16.61:1 light, 16.80:1 dark against the graph background. | The 10px footer text is about 3.24:1 light / 3.90:1 dark, below 4.5:1 for small text. A blocked edge composited at its .45 opacity is about 2.09:1 / 2.28:1 against the stage, below a 3:1 graphical distinction target. Tiny, thin lines make the problem worse. |
| Empty / loading | Loaded empty has a useful sentence: “No active tasks. Show closed or use List.” | Empty still presents a full unexplained graph toolset; no first-task path or differentiation from all-complete/filter-empty. Not loaded renders “0 tasks · 0 workers busy” and a blank canvas with no loading message. Errors, reconnecting and stale cached state are not represented here. |
| Live use | Running animations reflect actual workers; report sparks are event-driven, not fake periodic traffic. | There is no durable recent-change queue, acknowledgment state, connection freshness or off-screen update count. A spark can be missed. A review glow does not say how long a question has waited. A disappearing completed task has no persistent explanation. |

Contrast measurements sampled computed Jarvis colors through a browser canvas into sRGB and composited edge opacity
against the stage background. They are local measurements, not a complete WCAG audit of all combinations. The AX tree
exposes T2 as a link with its full title, review state and “needs attention”; no actual screen reader was run.
There are no live regions inside the graph (the app's unrelated route announcer does not count).

### Measured behavior, rather than a claim of “smooth”

Headless Chromium on Linux, GPU disabled, no CPU throttling; default motion; five-second requestAnimationFrame sample.
Both runs used **100 nodes / 158 edges**, Show closed, ten synthetic whole-board/worker replacements (every 500ms).
The first replacement changes T3 to review and starts idle worker lark; later replacements keep the same shape.
This measures update handling and frame callback cadence, not ten independent task transitions or worker token streams.

| Measurement | Desktop | Phone viewport |
| --- | ---: | ---: |
| rAF cadence | 59.91 fps | 60.07 fps |
| Median / p95 interval | 16.7 / 16.7ms | 16.7 / 16.7ms |
| Maximum interval | 33.4ms | 16.8ms |
| Gaps over 25ms | 1 | 0 |
| Observed long tasks (50ms+) | 0 | 0 |
| Retained task positions changed | 0 | 0 |
| Visible captions | 34 | 10 |
| Smallest node link's bounding dimension | 20.28px | 10.29px |

These are rAF cadence proxies, **not** compositor-presented-frame traces, physical-phone performance, a cold-load
benchmark or a 60fps service guarantee. No performance crisis was observed at this size. Do not replace SVG solely
on the assumption it is slow. The O(n²), up-to-70-step settling solve and repeated graph scans deserve profiling at
larger sizes, but this test does not justify a rendering-library migration.

A second real-browser audit inserted T91 under T1, reassigned fern from T3 to T20, then completed T3. Across all
three, retained task transforms changed zero times and the camera viewBox stayed identical. The worker did travel
to a new position. The active task count changed 80 → 81 → 81 → 80 as expected. There is no evidence of task jitter
on these updates; the product issue is explaining the changes and avoiding crowded arrivals, not fixing invented jitter.

Repeat the cadence probe from the repository root after starting the isolated Vite server and a dedicated CDP browser:

```sh
bun apps/web/scripts/task-graph-measure.ts desktop
bun apps/web/scripts/task-graph-measure.ts phone
```

The script is bounded to five seconds plus setup and writes `.preview/audit-metrics-*.json`. CDP defaults to loopback
port 9393; a third argument overrides that endpoint. The fixture app is at loopback port 5193. No Aiki server is needed.

## What “information at a glance” should mean

A useful graph is a prioritization surface, not a second transcript. Use few concurrent visual channels. Status owns
color and symbol. Human action owns a single distinctive star/badge. Size denotes family/task/worker type, never
unexplained importance. Motion denotes an event or active work. Do not encode urgency in both pulse speed and size.

| Signal and source | Task | Family | Project / drill-down |
| --- | --- | --- | --- |
| Status: `BoardTask.status` | Color **and** shape/symbol; visible word at detail | Small segmented status bar, counts on focus | Count chips filter the map; always explain whether closed is included |
| Needs you: review, open questions/warnings, worker failure | One star with a reason: Review / Question / Warning / Worker failed. Multiple reasons are one task, not multiple counts | Number of unique tasks needing action; maximum one star, not a badge pile | Ranked queue: warnings/failures, unanswered questions, reviews; preserve owner choice, no opaque urgency score |
| Age / quiet work: `createdAt`, `updatedAt`, worker/report timestamps | Detail shows both task age and last task/report activity. Clock badge after a disclosed threshold, initially 48h | Number of quiet active tasks | Filter quiet work. Say “quiet”, not “stuck”; a waiting task is not a failed worker. Board updates are not worker heartbeats |
| Progress: task tree and statuses | Ring only for containers; text numerator/denominator on focus | Recommended: completed non-dropped descendant leaves / all non-dropped descendant leaves, explicitly labeled. Avoid counting container and child twice | Completed task count with scope. No percentage for a leaf unless real measurable progress exists. No fake progress from tokens spent |
| Blockers: `blockedBy`, `blocks`, `blockedReason` | Lock/bracket + count. On selection show reason and direct prerequisites | Aggregate cross-family dependency count; show an edge only for the focused family or dependency mode | “Unblocks N tasks” queue, direct and transitive distinguished; use blocker direction matching existing D45 arrows: blocked task → prerequisite |
| Dependency chain / critical path | Selection can follow prerequisites and dependents one hop at a time | Bundle between family boundaries, label multiplicity | Longest remaining dependency chain is **not** a schedule critical path. No duration/estimate/deadline model exists here. Do not invent ETA or claim criticality; add scheduling semantics separately if wanted |
| Workers / threads: summaries and task/ownership links | Small character attached to its actual task; one visible + count for extras; explicit busy/idle/failed name in inspector | Larger thread character when it owns this family, worker count and on-demand orbit | Crew drawer with working-on text and links to worker/thread. Ownership and active work are separate relationships |
| Recent activity: board state diffs, worker report revisions | One bounded highlight on a real transition; report spark once | “2 changed” badge until seen, not perpetual animation | Durable in-session “Since you looked” queue; event text plus timestamp; reconnect establishes a baseline, does not manufacture changes |
| Questions: board questions including unassigned ones | Question count and oldest asked time; full wording in inspector | Waiting question count, not just task attention | All open questions, including those with no task. Task graph must not silently hide an unassigned question |
| Waiting until: `waiting.note/since/until` | Calendar/clock, date and note on selection; distinct from internal blocker | Nearest waiting date, expandable | Upcoming/overdue list with user-local time and explicit timezone; no until means “waiting, no date”, never “overdue” |
| Cost / tokens | Optional inspector only after a trustworthy attribution exists | Optional usage view, not a second status ring | Usage exists elsewhere, but BoardTask/WorkerSummary carry no task-total cost/token ledger. Do not infer one from current context size or add overlapping worker totals. Unknown is “Unavailable”, not zero |

### Detail levels and focus + context

Use **screen-space** thresholds, not arbitrary global zoom numbers. The prototype's fixed .7 switch only illustrates
the idea; production needs hysteresis and measured text bounds.

- Overview: family title (at least 14px), status distribution, done/total, needs-you count, blocker/quiet count. Minimal
  dependency bundles only in the dependency lens. Task dots are context, not the only way to find action.
- Family view: titles for the selected family, visible status words, one prioritized badge per task, worker names when
  selected. Keep surrounding families as quieter silhouettes. Breadcrumb and Back restore the exact previous camera.
- Task view: full title, status/reasons, blockers, last task/report update, worker activity, pending question/date. Longer
  prose belongs in the existing task sheet. Always offer a real list beside the map, not tooltip-only information.
- Selection persists after hover leaves; hover is a preview. Touch tap selects and reveals a bottom sheet; a separate
  Open action opens the task sheet. Escape dismisses preview then selection/sheet in predictable order.
- Provide search by ID/title/family/worker, then show result count and jump/next/previous. Search must not compact or
  reshuffle unrelated nodes. Filters dim context; an explicit “Hide others” may remove it. Show a result-empty reason.
- Legend explains status symbols, urgency star, ring denominator and arrow direction. Separate optional relationship
  toggles: blockers, parents, discovered-while, related, ownership. Do not show six equally loud edge categories at once.
- Keep status/search/filter state when opening a task. Camera remains local per project; version the schema only if its
  meaning changes. Existing keys are `tasks.view.v2:` and `task-graph.camera.v1:`; application theme is `aiki.theme.v1`.
  Do not assume all historical preference keys have an `aiki.` prefix.

### Time and change history

Start with a readable, bounded **what changed** queue: actual status transitions, questions, reports, assignment changes,
arrivals and completions. Include last-known connection state and “Updated … ago”. Batch bursts and announce a summary,
never stream every worker token. Keep selected work stable while showing an off-screen activity count.

Defer time scrubbing/replay. Current whole-board watches are not a complete, project-wide temporal graph log. Task
snapshots/timelines can support later investigation, but reconstructing historical topology, deleted work, ownership and
question state needs an explicit event/retention contract. A replay mode would need a prominent “Past / Live” boundary,
a return-to-live action, no write actions, and limits on storage and personal content. It is not worth blocking v1.

## Layout, stability and scale

Preserve the existing deterministic, pre-settled approach and ID-keyed position retention. Replace arbitrary decorative
family backgrounds with measured compound bounds. Prototype B's fixed family tiles test information grouping, not the
final floating silhouette or collision solver.

1. Compute root family membership once per board revision with an ID index, cycle defense and memoized ancestry. Keep
   visible roots for hidden completed parents; do not scatter active descendants when their parent is filtered out.
2. Give families stable, bounded anchors and reserve space for label/worker badges. Use a relaxed packing of **families**,
   not a perpetual global particle system. Within a family use stable slots around the root; deep branches expand locally.
3. Existing task coordinates stay fixed for ordinary status/report updates. Insert into a reserved free slot; if none,
   grow that family's boundary and offer **Regroup**, not a silent full re-layout. Persist drag overrides only if manual
   arrangement is deliberately made a product feature. A resize keeps selected family/camera, not a global reflow.
4. Bundle family-to-family blockers in overview. On selection reveal direct paths with arrowheads and an inspectable
   textual list. Parent edges stay quiet inside a clearly bounded family. The data, not line length, defines dependency.
5. Do not mutate layout during pointer interaction. Reconcile board/worker changes together per animation frame or short
   batch; update counts immediately, settle new geometry outside the drag. Keep focus by ID across replacements.
6. Cull off-screen captions/edges; collapse families before rendering hundreds of interactive task elements. Keep a
   parallel accessible result list. At 500/1,000 nodes profile solver, label placement, DOM and paint separately; use a
   spatial index / layout worker only after the trace identifies a bottleneck. Consider Canvas/WebGL for rendering only
   if SVG exceeds the budget; retain DOM semantics and the same model either way.

Targets to prove before release: at 100 tasks and 2 board replacements/s, p95 update-to-paint below 100ms, p95 interaction
frame interval under 20ms on a representative desktop; a measured 30fps minimum during pan on a mid-range Android phone;
no retained-node motion for status-only updates; no automatic camera jumps; captions at least 12px in task view;
44px web / 48dp Android actionable targets; small text 4.5:1, meaningful graphics/focus 3:1 in both themes.
These are proposed acceptance budgets, **not** results from this study.

## Interaction, motion and accessibility

Remain read-only for the first product release, as D45 says. Selection, following a dependency, opening task/worker/thread,
search, filters and camera controls are safe actions. Do not add drag-to-change-status, answer/approve buttons or worker
stop/start controls to an exploratory map. If quick actions are later wanted, reuse the existing task-sheet authorization,
revision/conflict and confirmation paths; never make the canvas a second write client.

Use one graph Tab stop plus a discoverable, fully navigable result list; arrow keys move spatially among visible tasks,
Enter opens, Space selects, Home returns to family, Escape exits focus. Provide explicit instructions, visible focus and
an accessible name with title, status, attention reason and blocker count. Auto-reveal keyboard selection without losing
zoom; respect reduced motion. Do not trap focus or require a hover. Group controls, search and list remain ordinary DOM.

A polite region announces batched meaningful transitions (“Two tasks need review; one worker failed”), not creature
movement. Include connectivity separately. The reduced-motion version has static activity symbols and the same event
queue; it loses no information. Test NVDA/VoiceOver/TalkBack with real users, not only an accessibility-tree snapshot.

Motion should explain change:

- 150–250ms arrival/focus interpolation; small bounded worker busy/idle motion; no constant layout drift under labels.
- One spark on a new nonempty report, paired with durable text. Reassignment travels along an actual relationship.
- One calm emphasis when a task begins needing the user; a persistent badge remains. No indefinite urgent flashing.
- Closed work fades only after a readable completion event. It does not steal selection; a selected closed task remains
  visible until dismissed. Reduced motion makes each change immediate and keeps the same static labels.
- Pause decorative animations when hidden; do not burn battery for unseen creatures. Device thermal/energy testing belongs
  in the Android/performance stage, not the proof-of-concept cadence numbers.

## Android plan

Do not embed the web canvas in a WebView as a shortcut. Share the **contract and fixture vectors**, not Svelte pixels:
family identity, status/attention reasons, progress denominator, direct/transitive blockers, change batching and selection.
Build the native view in the existing Android UI stack after web semantics settle.

Phone default: a readable family overview and a task/result list, not 100 microscopic targets. Tap a family to focus; tap
a task for a persistent bottom sheet with Open task. Pinch/pan have explicit Fit/zoom alternatives, 48dp targets and
TalkBack traversal through a semantic list. Avoid gesture conflict with sheet scrolling/system back. On back, close the
sheet, restore family overview, then leave the screen. Tablet can use the inspector beside the graph. Keep system font
scaling, light/dark and reduced/disabled animation parity. Native glyphs should share character identity without requiring
web font fallbacks. Test offline/reconnect and out-of-order board/worker pushes; no private real boards in UI tests.

Before claiming native readiness, run the busy fixture on a physical mid-range device, profile render/UI frames during
updates and pan, verify thermal/battery behavior over minutes, and capture TalkBack + large-text interaction. This study
has not changed Android code or performed those tests.

## Two working direction studies

Both live behind the Vite development flag at `/graph-lab?option=option-a` or `option-b`; `option=before` renders the
existing graph. `scenario=small|busy|empty|loading` selects the audit fixture. Production renders only “Not found” at
this otherwise unlinked route; the fixture components are dynamically imported only in development.
Normal List/Board/Graph remain unchanged. No final version, migration, deployment or new production preference was added.

Run Vite with `env -i`, an explicit PATH and fresh temporary HOME/XDG_DATA_HOME/XDG_CONFIG_HOME, using
`bun run --cwd apps/web dev --host 127.0.0.1 --port 5193`. Print the effective directories first and retain that log.
Launch the bounded process with `setsid -f … < /dev/null`; stop it by its recorded PID. Open the lab in a dedicated
browser profile. No backend setup or local backend configuration is required. Use Live change to move T3 to
review and start lark. Desktop's Event control additionally exercises arrival, worker reassignment and task completion.
Search, Needs you, Closed, group focus, task selection, zoom/pan, keyboard focus and a synthetic task-sheet dialog work.
The dialog is deliberately not a second real task editor.

Both use the same protocol-valid fixture and `buildTaskGraph`/`graphLabel`. The original layout/simulation remains available
in Current for direct comparison; the studies deliberately use alternative deterministic group layouts. Their data model
and status mapping are shared. TypeBox is a test-only direct dependency, at the already-used protocol version.

### A — Mission control (`option-a`)

**Idea:** six calm status regions, a dense working queue, project counters and a persistent inspector. Characters remain
in the crew area; task rows use status symbols and one compact attention/quiet/blocker signal. Focus a region to browse
its complete list. Only four task previews per region are shown at overview, with an explicit remainder count.

**Best at:** finding review/blocked work and reading task names without tracing lines. Familiar to dashboard users. A
reasonable later “status lens” over the same graph, especially for an operator handling many simultaneous projects.

**Worst at:** family structure and the playful spatial identity. Status changes necessarily move work between regions;
row order must not churn while reading. The prototype uses input order rather than a finished prioritization policy.
The lens is closer to an information map than a freeform graph and overlaps with the existing board view.

### B — Bubble club (`option-b`)

**Idea:** stable soft family regions, overview counts and completion bars, small status orbs, actual attached workers and
a larger thread character. Zoom/focus reveals task cards and family browsing. The same summary and inspector keep the
playfulness useful. On phone it starts focused on one readable family, with neighboring groups reachable by chips/pan.

**Best at:** preserving D46, family recognition and calm live updates. Each family has a readable name and signals at fit;
task details are progressively revealed instead of pushing eighty truncated titles onto the overview.

**Worst at:** comparing all blocked tasks across families without a filter/queue. Overview orbs are intentionally not
individually readable titles or large touch targets. Deep nesting is flattened inside each prototype region; a production
implementation still needs compound bounds and local branch expansion, not simply these fixed tiles.

### Option C — Graph with Mission control's strengths (`option-c`)

**Encoding:** soft bounded families contain readable two-line task cards, a status symbol/strong coloured border,
explicit review/blocked/waiting/question badges, attached named worker creatures (plus worker count), thread characters
on their actual task, and direct-child done/total. The title keeps its family suffix in the inspector, rather than
wasting every card's second line on the repeated family name. The six status counters and four overlapping reason
counters highlight matching tasks without repacking. Counts include all 90 tasks, including ten done; Closed controls
their cards. Reason counts are not additive or a claim that every external wait requires a human action.

Solid subtask, dotted found-while, dashed arrowed blocked-by (blocked task → prerequisite), and dash-dot related paths
remain real graph edges. Parent paths stay visible; other links are scoped to the selected family to limit crossing
noise. The persistent inspector lists exact endpoints and lets the user follow them. Search by ID/title/family/worker
highlights and focuses the first match. Selection is by task ID, not hover or object reference: T3 remains selected
with identical card coordinates and camera through the review/worker-start fixture replacement. Desktop uses a side
inspector; phone uses a scrollable bottom sheet. Cards and background drag; wheel/buttons zoom; family buttons and
Back to selection restore readable framing. There are no task writes or production preferences.

**Status zones versus families:** C deliberately uses the permitted strong-card-status alternative. Every busy-fixture
family spans working, review, planned, blocked, waiting and done; all ten roots are working. Placing by root status
would put everything in Working and falsely imply that no review/blockers exist. Placing by highest attention would
put everything in Needs you. Splitting children between columns would destroy the graph's family advantage; moving
whole families on status changes would destroy spatial memory. C therefore keeps stable family anchors and uses
colour **plus symbols/words**, global status counters and an explicit “mixed status” family caption. This is worse than
A for a spatial status scan, but honest about mixed work. No invisible zone-placement rule is implied.

**Detail:** default desktop framing reads one family and neighboring context, not all eighty active titles squeezed
into one screen. At the proved 1440×1000 size, titles are 14px, metadata 12px and cards approximately 194×82px. Zooming
out gives single-line pills with at least 44px targets; below .5, decorative task dots replace task targets and the
44px-minimum family headings become the way in. Overview fits all ten families. Phone starts at a readable selected
card, not fit-all. Full-opacity edge colours replace the audit's faint blockers. Measured light/dark text contrast is
15.43:1; footer 16.61/16.80:1; blockers against the family surface 5.87/8.99:1; parent paths 4.91/7.88:1. Ordinary C
controls have 44px minimum height. Reduced motion disables creature sway and the one-shot real review highlight.
These are Chromium samples, not a complete accessibility certification.

**Best/worst:** compared with A, C preserves actual family/dependency structure and task-attached crew, but needs more
pan/focus to read a cross-project queue. Compared with B, C makes ordinary task names and reasons useful immediately,
but consumes more space and is less airy. A remains the strongest pure triage dashboard; B remains the most compact
family overview. C's fixed slots flatten deep branches visually (edges retain the real ancestry); the phone sheet
leaves a small map window. Pinch, spatial keyboard navigation, a parallel result list, measured zoom hysteresis,
collision-aware drag bounds, persistent camera/selection across reload and physical-phone testing remain build work.

**Plan change:** stage 0 now compares A and C, not “choose B”. Keep stage 1's trustworthy summary/search/inspector and
read-only scope. Expand stage 2 to **7–10 days** for measured cards, reserved compound family bounds, three semantic
levels and the family/status trade-off; hardening becomes **4–6 days** for card targets, phone sheet/gesture balance
and font scaling. Stage 3 remains **3–5 days**, including a real change queue rather than C's fixture notice. Revised
web v1 allowance: **18–28 engineering days after the decision stage** (previously 15–25); native parity **6–9 days**,
not included. Do not ship this prototype wholesale or add a third production view.

C evidence on T103: four desktop/phone light/dark screenshots, an A/C desktop-dark comparison pair at 1440×1000
(the C dark shot serves both purposes), and one 14-second real Chromium recording of all three detail levels,
review-counter highlighting, selected T3 moving to review without camera movement, lark starting, and search.
Pointer drag/pan and reduced motion were additionally checked in Chromium. Web check has zero errors/warnings;
930 tests / 14,145 assertions, build and public-source guard pass. No live backend, Android test, main move or push.

### Prototype limits (do not mistake polish for completion)

Both illustrate the busy-project direction, not all product requirements above. Neither includes a real connectivity
state, persisted selection, full spatial keyboard navigation, touch pinch implementation, real screen-reader testing,
a complete status/attention legend, event retention, comprehensive worker/error detail or stable filter-slot reservation.
A's overview caps previews; group browsing exposes the rest. B uses a fixed zoom threshold rather than text measurement.
The prototype family percentage counts all family tasks, including the parent, not the proposed descendant-leaf measure.
The visible empty state is illustrative; loading/error state design remains a build-stage item. Small metadata still
needs larger minimum sizes. Do not transplant either component wholesale as the final implementation.

## Evidence saved on T103

All source proof files are inside the workspace's ignored `.preview/`; copies are retained as task artifacts. Tags are
`web`, `desktop|phone`, `light|dark`, `before` or `option-a|option-b` (studies also have `after`). The saved set is:

- **16 current-state screenshots:** small, busy, empty and loading × desktop/phone × light/dark.
- **Eight direction screenshots:** A/B × desktop/phone × light/dark, plus B at desktop task-detail zoom.
- **Five 12-second recordings:** Current desktop/light; A and B each desktop/light and phone/dark. They show zoom,
  focus/selection, a live worker start and task review transition, then return to overview.
- **Four measurements:** `audit-metrics-desktop.json`, `audit-metrics-phone.json`, `audit-accessibility.json`, `audit-live.json`.

Useful starting artifacts (IDs in the task artifact store):

| Compare | Artifact |
| --- | --- |
| Current desktop light / phone dark | `mwb7uoq0-c70eaddc5c` / `mwb7uoq1-6e2d8f8690` |
| A desktop light / phone dark | `mwb7uoq3-e79e59f8a0` / `mwb7uoq4-78a00c021a` |
| B desktop light / phone dark | `mwb7uoq4-750f1fc253` / `mwb7uoq5-0be646225f` |
| B focused family desktop | `mwb7uoq5-eec1e04601` |
| Current / A / B desktop recordings | `mwb7uoq6-3291e4ba1c` / `mwb7uoq6-f38a2072f1` / `mwb7uoq6-0873c75c1d` |
| A / B phone recordings | `mwb7uoq6-0a224a5d46` / `mwb7uoq6-8409e88cef` |

The recordings were captured from real Chromium screencast frames and encoded to H.264, not assembled from design slides.
The current behavior is baseline evidence; the after-tagged directions are alternatives, **not** a claimed production bug fix.

Verification: web `bun run check` has zero errors/warnings; `bun test` passes 926 tests / 13,777 assertions; `bun run build`
passes; root `bun scripts/check-public.ts` passes. Production JS contains none of the study fixture markers. No root/server
or Android test suite was needed for this web-only direction study. No main movement, push or deployment was performed.

## References worth borrowing from

These are design references, not proposed dependencies. Official documentation was checked during this study.

- [Grafana node graph](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/node-graph/): a bounded
  hierarchy of title, primary/secondary stats, arcs and inspectable details. Borrow the distinction between overview stats
  and detail fields, not its infrastructure aesthetic or an additional ring for every metric.
- [Cytoscape layout guidance](https://blog.js.cytoscape.org/2020/05/11/layouts/) and
  [performance guidance](https://js.cytoscape.org/#performance-optimisations): layout should operate on the relevant
  subgraph; labels and rendered dimensions matter. Borrow selective expansion and profiling, not a reflexive library swap.
- [Neo4j Bloom](https://neo4j.com/docs/bloom-user-guide/current/): perspectives and investigation-oriented graph exploration.
  Borrow a small number of meaningful lenses and focus on relevant relationships, not a permanent hairball of every edge.
- [Linear Insights](https://linear.app/docs/insights) and [Project graph](https://linear.app/docs/project-graph): chart/table
  cross-highlighting, explicit slices and historical progress semantics. Borrow the paired readable list and clear scope;
  do not copy schedule forecasts without equivalent historical data and estimates.

## Staged build plan

Sizes are engineering days for one experienced engineer, including tests and browser proof, not calendar commitments.
Android and new history/usage backends are separate. Re-estimate after owner decisions and an interaction spike.

| Stage | Size | Scope / exit evidence |
| --- | --- | --- |
| 0. Choose semantics | S · 1–2d | Decide B, attention reasons, progress denominator, read-only and phone behavior. Prototype review with owner on busy and small boards. Freeze signal vocabulary and shared synthetic vectors. |
| 1. Make today's graph trustworthy | M · 3–5d | Loading/empty/error/reconnecting states; contrast and hit targets; clear status/attention legends; search/result list; persistent selection + inspector; retain existing click-to-task-sheet path. Test keyboard/reduced motion, small/busy/empty, both themes. No new global layout. |
| 2. Family overview and local detail | L · 5–8d | Stable measured compound families, reserved slots, semantic zoom with hysteresis, bounds-aware labels, filtered-context behavior, dependency bundling/focus and camera restore. Prove ordinary updates never move retained tasks; arrivals/deep families stay legible. |
| 3. Living information, not noise | M · 3–5d | Actual crew ownership/activity, explicit needs-you reasons/queue, quiet/waiting dates, direct/transitive unblocking counts and batched change feed. Out-of-order/reconnect baselines, off-screen updates and selected completed work tests. No task writes. |
| 4. Product hardening | M · 3–5d | 100/500/1,000 task traces, long labels, localization/font zoom, browser/touch matrix, screen-reader sessions, low-end phone and battery tests. Optimize measured bottlenecks; no renderer migration without evidence. Ship only against stated budgets. |
| 5. Native Android parity | L · 5–8d | Native family map + semantic task list/bottom sheet, system back, 48dp targets, TalkBack, large text, offline/live event parity and physical-device recordings. Reuse agreed data semantics, not the web renderer. |
| Later, separately approved | M–L each | Optional A status lens, trustworthy task usage attribution, historical replay/event contract, or explicit quick actions. None is necessary for the first professional graph. |

Web v1 is roughly **15–25 engineering days** after the decision stage; native Android adds **5–8 days** plus any platform
unknowns. Some hardening can overlap feature work. These ranges exclude a new cost ledger or project-wide history service.

## Decisions for the owner (recommendation first)

1. **Choose B, with the shared summary/inspector; defer A as an optional status lens.** Alternative: lead with A if triage
   matters more than family identity, accepting overlap with Board. No need for a third organizing view now.
2. **Keep v1 read-only and make selection persistent; use Open task for the existing sheet.** Alternative: approve a later
   explicit quick-action stage. Do not introduce canvas status dragging or write paths as part of this upgrade.
3. **Use one “needs you” count with explicit reasons, and call 48h inactivity “quiet”, not “stuck”.** Confirm whether 48h
   is a useful first threshold; waiting-until tasks should not be treated as overdue before their date.
4. **Use non-dropped descendant-leaf completion for family progress, with a visible denominator.** Alternative: retain
   immediate-child completion, but label it as such. Do not mix either with percent effort or predicted finish dates.
5. **On phone, default to a readable family focus plus a task list/sheet, not fit-all dots.** Confirm native Android parity
   after web semantics settle. Historical replay, cost badges and schedule critical path should remain separate decisions.
