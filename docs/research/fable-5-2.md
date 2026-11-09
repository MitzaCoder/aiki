# Claude Fable 5.2 integration (T50, 2026-11-09)

## Official facts

Sources read on release day:
- [Overview and pricing](https://platform.claude.com/docs/en/models/fable-5-2/overview)
- [What's new](https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2)
- [Migration guide](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide)
- [Mid-conversation system messages and tool changes](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
- [Subscription launch offers](https://support.claude.com/en/articles/17506494-claude-fable-5-2-launch-offers)

`claude-fable-5-2` accepts text/images and produces text. Context is **1,000,000** tokens;
maximum output **128,000** tokens (including thinking). USD per million tokens:

| Input | Output | Cache read | 5-minute write | 1-hour write |
| --- | --- | --- | --- | --- |
| $8 | $40 | $0.20 | $10 | $16 |

These are 20% below Fable 5.1, not subscription quota conversion rates. Adaptive thinking
is always on: neither `disabled` nor manual `enabled`/`budget_tokens` is accepted. Effort
supports `low`, `medium`, `high` (API default), `xhigh`, `max`. pi-ai also offers the harness's
`minimal` level, mapped to `low`; `off` is excluded. High is a sensible first coordinator
choice; the docs recommend measuring gains before xhigh/max. Higher effort may delegate more
work; short output caps can leave only thinking and no text.

Claude Mythos 5.2 requires verified-organization access and is intentionally not added.

## Why a local catalog entry

The npm registry reported `latest: 1.5.0`, `legacy-node20: 0.74.2`, **no `next` dist-tag**.
Both installed 1.4.0 and the downloaded 1.5.0 catalog lack this ID. Upstream
[pi main at c9dd2c530160a2c698959771955a682b2b0c5161](https://github.com/earendil-works/pi/blob/c9dd2c530160a2c698959771955a682b2b0c5161/packages/ai/catalog/families/anthropic.ts)
also lacks it. Keep the existing 1.4.0 pins; no dependency API changes.

`packages/server/src/model-catalog-extensions.ts` is a small extra-model table. It derives
Fable 5.2 from the native Anthropic Fable 5.1 entry, overrides identity/prices/limits and
explicitly disables sampling temperature. The provider's chat and all-model accessors are
extended, not just the wire listing: lookup, availability, web/Android pickers, request usage
costs and cache statistics use the same entry. pi-ai calculates 1h writes as twice input
price, giving $16 without another rate field. Cache retention remains 300/3600 seconds.
If upstream supplies the same chat ID, its entire entry wins and no duplicate is added;
a test simulates the native entry appearing after wrapping the provider. A missing base is
skipped rather than breaking a provider's synchronous catalog. No protocol or client change.

## Request compatibility and remaining limitations

- **Prefix binding now enforced for all accounts.** Editing top-level system/tools or earlier
  messages invalidates preserved thinking, even on accounts that accepted those edits on 5.1.
  Retain `supportsMidConvoSystemMessages`, `supportsMidConvoToolChanges` and
  `supportsMidConvoEffort`: pi-ai sends appended system messages, inline tool additions/removals
  (`inline-tools-2026-09-15`), and per-message effort (`mid-conversation-output-config-2026-07-01`).
  The initial tools and system remain at the request prefix. System messages themselves need
  no beta. Existing pi-ai 1.4.0 also sends `thinking-binding-controls-2026-08-01` with
  `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` on these models, so unavoidable
  prefix edits (compaction, model/prompt changes, transcript transformations) can continue.
  This is the documented stopgap, **not a guarantee of full reasoning preservation**: dropped
  thinking can increase output cost. We do not silently disable native system messages or
  claim the harness is strictly append-only in all paths. No live prefix-binding eval was run.
- **Thinking and effort.** Inherit `forceAdaptiveThinking` and `thinkingLevelMap.off: null`.
  Even pi-ai's default/no-reasoning path builds adaptive thinking, never disabled thinking.
  Effort changes use native system markers, with a stable top-level `high` output config.
- **Sampling, prefill and forced tools.** Explicit `supportsTemperature: false`; pi-ai's
  managed-effort path already omits temperature. The harness does not send top_p/top_k,
  assistant prefills, or force tool_choice any/tool; normal automatic tool use is unchanged.
- **Model/account switches.** Fable 5.2 reads 5.1 and other listed Claude thinking blocks, but
  only Fable/Mythos 5.2 read its blocks. Other models drop them, retaining text/tool calls;
  blocks also belong to their originating account (or linked accounts). pi-ai's existing
  transcript transformation may discard cross-model thinking itself. Do not promise retained
  reasoning when switching models or logins. A new coordinator conversation avoids old-prefix
  migration risk; the user's first message after deployment is the live test.
- **Classifier refusals and `fallbacks`.** Current docs specify beta `fallbacks: "default"`
  with `server-side-fallback-2026-07-01`; targets are Opus 4.8/Opus 5, not 5.1. Reasoning
  extraction refusals are not retried. pi-ai 1.4.0's optional `allowedFallbackModels` emits an
  explicit array, not this documented default form. The 5.1 base has none; neither does this
  extension. No automatic classifier fallback is enabled, avoiding silent model/cost changes.
  Existing pi-ai maps refusals to an error including stop_details; this change does not invent
  retry handling. A refusal may consume quota even without output.
- **Computer/advisor tools.** `computer_20251124` is rejected outside Bedrock; use the newer
  toolset. A 5.2 executor's advisor must be Fable/Mythos 5.2. Neither Anthropic hosted tool is
  used here: ordinary harness read/bash/browser tools and worker orchestration are unaffected.
- **Data retention.** Fable 5.2 requires **30-day retention**, like 5.1; API organizations or
  workspaces without it get 400 unless expressly authorized for ZDR. No account settings are
  changed. Subscription policies/access still apply. No Priority Tier or fast-mode option added.

## Subscription usage

`subscription-usage.ts` is version-agnostic: existing tests already cover both
`seven_day_fable` → “Weekly · Fable” and `limits` entries with Fable display names. Nothing
needs 5.2-specific handling. The model's own API rate limit is separate from 5/5.1; that
is not a reason to fabricate a new OAuth window or quota weight.

The official launch offer warns that Fable consumes subscription limits faster than other
Claude models, but does not give a numeric multiplier. Do **not** infer 20% less subscription
usage from the API price cut. Eligible Pro/standard Team plans get Fable included up to 50%
of weekly usage until **2026-11-16 23:59 PT**, then usage credits; other eligible paid plans
get one to three resets. Check the account's plan and Usage page before running a long-lived
coordinator. The harness reports the provider's returned limits, not a guessed conversion.

## Verification

Seven new tests cover catalog metadata/availability, both cache prices, compat flags, upstream
deduplication, base immutability, real throwaway WebSocket `models.list`, and locally captured
request payloads. The payload test aborts in `onPayload` and installs a rejecting fetch stub:
**zero network calls**, with adaptive thinking, native system/tool/effort changes, beta headers,
1h TTL, and no fallback/forced tool/sampling parameters. No Anthropic model request or real
credential was used. UI proof uses createSetup, allowedOrigins, a fake API-key availability
marker, seeded browser backend storage and a provider that rejects all model requests.
