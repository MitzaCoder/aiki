# Coordinator cache warming

## Conclusions

Long idle coordinator gaps can outlast provider prompt caches. A refresh can help only while a reusable prefix is
still cached; it consumes read capacity and may unexpectedly incur a write. Never equate an API-price estimate with
subscription quota savings. Workload-specific measurements belong in private local records, not public source.

Use an out-of-band refresh, not a synthetic coordinator message. It must not advance conversation history, execute
tools, deliver worker reports, or change last activity. The previous successful request's exact cache prefix matters:
reconstructing a newer prompt can buy a different cache entry.

## Implementation policy

- Support only provider/API combinations with a documented zero-output request shape. Preserve the real request's
  system/tools/messages, thinking/effort, headers and breakpoint positions; change only the required output/stream
  fields. Unsupported combinations stay off rather than silently changing cache identity.
- Use observed cache lifetime to schedule before expiry. Apply a bounded idle cap, avoid active turns, and disarm on
  errors, misses, unexpected writes, account/model/configuration changes, compaction, archive or close.
- Keep snapshots private and bounded. Never persist resolved credentials or replay stale snapshots blindly after a
  restart. A matching conversation/configuration/account and unexpired observed lifetime are required.
- Observe actual returned usage; even a zero-output request is not guaranteed to be read-only or free.
- Do not infer a hard Codex cache TTL from neighboring requests or substitute public API guarantees for a different
  subscription endpoint. A transport that omits output caps is not a safe warming primitive.

## Validation

Use faux providers and isolated databases to verify exact request preservation, generation guards, lifecycle
cancellation, cost accounting and no conversation advancement. Keep private-session analysis and raw transcripts out
of the repository. Current architecture and supported defaults are described in `../DESIGN.md`.
