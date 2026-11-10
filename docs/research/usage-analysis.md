# Usage analysis: first web prototype (T78)

## What exists

`UsageBody.svelte` previously stacked live subscription cards and a long `CacheSection`. `subscriptions.usage`
reports each backend login's provider windows, percentage used, reset timestamps and current-window samples;
`subscriptions.usage.changed` updates connected clients. Samples persist in `subscription-usage.json`, capped at
1,000 per window, discarded when that window resets. There is no 30-day subscription-quota ledger.

`cache.stats` reads `request-log.sqlite`, one row per returned model response, retained 90 days (startup and daily
pruning). It already records project, conversation, main/thread/worker/unknown kind, worker/thread/task/schedule IDs,
provider/model, full-price input, output, cache reads/writes, one-hour writes when available, individual catalog
costs and total, stop reason, duration, wake reason, idle gap, retention, prompt-change hashes/codes and inferred
cache misses. Older transcript responses are backfilled once per project; those lack fingerprints/retention.
Rows are recorded off the request path; failures can drop rows. It is an operational estimate, not billing truth.

New internal-purpose recording covers coordinator compaction summaries, memory extraction and backend memory
maintenance. These use `completeSimple` rather than normal tagged conversation generations. Their results are
observed once, never changing prompts, responses or tool execution. They have project scope where known and no
conversation linkage (ID 0); maintenance is backend-wide. The additive SQLite migration records `internal_since`.
Ordinary caller roles derive from old identities, so history remains usable. Internal history cannot be recovered
from transcripts. Worker/pi fallback compaction, thrown errors with no usage, and requests lost before capture
remain missing. Codemode is tool execution charged to the caller's surrounding requests, not another model.
There is no separate title-generation model call in server source.

## Tabs and decisions

All totals include warm-up and new internal calls. Prices are catalog equivalents in USD, not money actually
charged to subscriptions and not shares of a subscription allowance. No per-request account/billing-mode tag is
recorded; a provider's OAuth usage may also include external clients. Never convert token share to quota share.
Today means local midnight; 7/30 days are rolling windows. The period does not alter live subscription windows.

| Tab | Recorded statistics | Decision it supports |
| --- | --- | --- |
| Overview | Live provider limits/reset times; request count; input/read/write/output tokens; catalog equivalent | Budget and capacity; distinguish live allowance from this harness's work |
| By role | Coordinator, workers, threads, scheduled runs, keep-warm, compaction, memory extraction/maintenance, unknown; tokens, equivalent cost, cost share | Which caller class merits optimization? Scheduled overrides worker/thread, without double counting |
| By model | Model totals and provider/model × role; token categories, cost and cost share | Is an expensive model doing the wrong sort of work? |
| Projects & tasks | Projects; top 30 board task IDs; top 30 ordinary conversations/workers, sorted by total cost, including maximum prompt size | Which task or long context should be investigated first? Task attribution covers worker-owned requests, not coordinator reasoning about that task |
| Waste | Cache reuse, inferred rebilling with reasons and existing detailed report; failed/aborted response cost; warming and unexpected write cost; check-in/retry request pressure; largest prompts among ranked conversations | Investigation leads, not a verdict that the work was worthless |

The modal keeps the existing cache diagnosis as expandable detail rather than removing it. Older backends show
subscription cards and their existing cache report; they are not asked for new capability-only options.
Keyboard arrows, Home and End select tabs; focus and selected state move together. Phone tabs wrap.

### Not measurable yet

- Writes never read: provider cache-entry/prefix identity, lifecycle/expiry and all relevant reads are missing.
- Pings that kept nothing useful warm: need the next useful request's matching prefix and counterfactual cache state.
- Failed/stopped *runs*: stop reasons only establish response outcomes with returned usage, not whole-run waste.
- Compaction-caused resend: current restart code combines compaction and resets; need before/after context linkage.
- No-action check-ins and unused worker reports: need action/report-consumption semantics; absence of tool calls
  or a report delivery is not proof of usefulness or waste.
- Subscription consumption by role: providers do not publish an exact per-request quota accounting conversion.

The T46 public cache study is `cache-keep-warm.md`; the request log/report implementation is specified in DESIGN.
Its durable conclusion is that long coordinator idle gaps can outlast caches, and warming itself consumes capacity.
Workload measurements were intentionally kept private, not in this repo. This phase uses synthetic fixtures only;
no new live session measurements or claims about current account waste are included.

## Manual subscription resets

These differ from automatic window reset timestamps. Public client implementations now expose saved/manual
resets for **Claude and Codex**. OpenCode Go's known usage endpoint exposes only automatic reset times.
Contracts are undocumented and may vary by account, program and OAuth surface; a provider-site offer may be
ineligible here. Unknown is never rendered as zero.

- Codex: `GET /backend-api/wham/rate-limit-reset-credits` returns `available_count`, credits, status and expiry.
  `POST .../consume` takes `credit_id`, UUID `redeem_request_id`, and optional `account_id`. The existing account
  header is preserved. The normal `/wham/usage` may also carry `rate_limit_reset_credits.available_count`.
- Claude: normal usage lists nullable program hints. When present, safe discovery uses
  `/api/oauth/usage?cedar_ember=1&skip_spend=1`, then `?at_wall=1&skip_spend=1` for the session experiment.
  Cedar reports grants, `resets_left`, expiry, covered windows, eligibility, cooldown and `usable_now`.
  Juniper reports eligibility, experiment arm and availability. A profile organization UUID routes the confirmed
  POST to `/api/organizations/{organization}/reset_rate_limits`. Cedar body: program/grant/request UUID;
  Juniper body: program (no upstream idempotency key in that contract).
- Reading never consumes. Consumption requires confirmation, a fresh discovery check, positive usability and
  remaining count. Concurrent provider mutations are refused; duplicate request IDs share their outcome during
  this server lifetime. Request IDs cannot be reused for a different grant. There are no mutation retries or
  automatic expiry redemption. Only an explicit `reset` response is success. A timeout is an unknown outcome:
  check the provider before another attempt. Juniper especially must never be automatically retried.

Public references (contract research, no account data):
- https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/usage/openai-codex-reset.ts
- https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/usage/claude-reset.ts
- https://github.com/can1357/oh-my-pi/issues/12883 (OAuth surface eligibility differs from provider website)

No account was probed and no real reset was spent. Tests use fake HTTP for discovery, confirmation, account headers,
organization routing, duplicate requests, stale grants and transport uncertainty. The prototype's grants are synthetic.

## Next choices

Review the web layout before Android work. Android needs the same five-tab/period behavior, typed optional analysis,
role/model/task groups and a confirmed one-shot reset action with unknown-outcome handling. Models are regenerated
now, but the Android usage UI is intentionally unchanged. Decide separately whether undocumented reset mutations
should ship enabled, and whether to invest next in account attribution, run outcomes or cache-prefix lifecycles.
