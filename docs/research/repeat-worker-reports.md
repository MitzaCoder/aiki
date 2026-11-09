# Repeat worker reports

## Conclusions

Queued amendments can create redundant later answers even when delivery works correctly. Multiple submissions in
one run can share an answer, so request-ID deduplication alone cannot prevent identical coordinator reports. A late
report from a forgotten worker must not revive it or mutate a replacement that reused its ID.

Not every second report is redundant: a genuinely new attempt, result, warning or question must still be delivered.
Do not use fuzzy text matching to suppress materially different results.

## Implementation

- Send additions to a running task as an interrupt/steer. Queue only a genuinely separate next task.
- Forgetting a worker records its terminal state and withdraws queued inputs transactionally. Passive writes and
  already-running tools/answers are left alone; workspace cleanup follows the transaction.
- Check done/missing/pruned state and conversation identity at admission and immediately before delivery. Never hold
  the admission lock while waiting for an answer.
- Classify an identical previous report or the exact worker answer `Nothing new.` as a passive write, not a new
  coordinator turn or push. Persist the classification so durable replay does not reinterpret the first report.
- Keep both transcripts complete without unnecessary user-facing acknowledgements. Empty text alone should not
  create a blank turn; real tool/thinking content must remain visible.

## Validation

Use synthetic durable submissions to cover shared answers, restart replay, withdrawal, late reports, pruned/replaced
workers, passive writes and push suppression. No real conversation IDs or transcript excerpts are needed in source.
