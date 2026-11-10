# Backend relay v1 contract

T95 wires the frozen [crypto format](push-relay-v1.md) to notifications. This does not add an Android account flow,
FCM receiver, UI, relay deployment or real-provider test. All backend integration tests use a loopback HTTP fake and
a simulated phone using the shared crypto/admission library. D51 remains: push and relay accounts are optional;
ordinary backend use never requires either, and account prompts belong only in Android notification settings.

## Setting and negotiation

The operator sets `AIKI_PUSH_RELAY_ENDPOINT` through the existing private settings loader. It is the complete v1 base
URL, for example `https://relay.example.com/v1/`. Only HTTPS is accepted, except HTTP on literal loopback/localhost.
Credentials, query strings and fragments in the URL are rejected. No admin, account or Firebase credential is used.
Requests use octet-stream JSON, no-store, a ten-second deadline and `redirect: "error"` (no bearer forwarding).

The server advertises `fcm-relay-v1` only with this endpoint and `device-auth-v1` support. With no setting, no relay
store is opened, relay files are not written, relay fields are absent and direct FCM/Web Push remain the default.
Old clients can keep registering direct transports on a configured backend; there is no automatic enrollment.
Clients must gate the new calls on the hello feature; an older/unconfigured server returns `unknown_request`.

## RPC shapes

All requests also contain the usual string `id`; replies echo it. All three require an authenticated session, even
in optional mode. Anonymous callers receive `auth_required`. There is no caller-supplied backend/session/device ID
in registration. IDs below are canonical unpadded base64url of 16 bytes. Times are integer Unix milliseconds.
`preferences` is the unchanged `NotificationPreferences`; `device` is the unchanged public device plus optional
safe `relay` status and transport `fcm-relay`. Never put these requests in protocol/body logs.

```text
notifications.registerRelay {
  operationId, routeId, keyId, sendBearer, deleteBearer,
  leaseExpiresAt, absoluteExpiresAt, phonePublicKey, salt,
  label, backendKey, preferences, predecessorRouteId?
}
-> notifications.registerRelay {
  backendPublicKey, confirmation, backendId, sessionId, deviceId, serverTime
}

notifications.confirmRelay { operationId, confirmation }
-> notifications.confirmRelay { device }

notifications.syncRelay { routeId, leaseExpiresAt?, preferences?, unregister?, resume? }
-> notifications.syncRelay { relay, serverTime }
```

`phonePublicKey` is the frozen 65-byte P-256 point encoding; salt is 32 random bytes. Bearers use the frozen,
disjoint send/delete schemes and must name the proposed route. The backend generates its own pair and derives the
three purpose-separated keys. Registration's `confirmation` is the backend-confirm HMAC. Confirmation's input is the
phone-confirm HMAC of the same exact transcript. Wrong confirmation, malformed public point/encoding, capability
mismatch and transcript/key substitution fail with `bad_request`; crypto messages are fixed `push_relay_<code>`.
A changed registration under an existing operation ID also fails. Another session cannot use its receipt/route.
Pending operations do not send, expire after ten minutes and queue deletion. One pending successor/session is allowed.

A repeated operation returns its original persisted answer, including **original** `serverTime`. After a delayed
retry, get a fresh backend clock anchor from `syncRelay.serverTime`; never anchor to an old receipt as though it were
fresh. The phone should also account for request round-trip uncertainty when establishing its monotonic offset.

Safe relay status is exactly:

```text
{ available: boolean,
  state: "unregistered" | "pending" | "active" | "needs_new_keys" | "paused" | "revoked",
  leaseExpiresAt: number | null, absoluteExpiresAt: number | null,
  cleanup: "pending" | "done", lastDelivery: string | null }
```

`notifications.config` adds optional `relay`. `notifications.device` adds it both on a registered device and at
response top level, allowing a still-signed-in phone to poll cleanup after unregister returns `device: null`.
`notifications.unregister` adds optional safe relay status for relay device IDs. No relay fields are added to legacy
responses when off. These reads never contain route bearers, salt, public transcript material or derived keys.
Revoked auth sessions cannot read RPCs; local cleanup continues without their participation.

The existing `notifications.test {deviceId}` returns `{ok,status,message}` as before; relay success is `ok:true`,
`status:200`, `message:"accepted"`. It never claims display, delivery or reading. Other safe delivery messages include
`retrying`, `rate_limited`, `relay_unavailable`, `route_expired`, `token_invalid`, `account_disabled`, `account_deleted`,
`not_found`, `route_inactive`, `message_conflict`, `message_expired`, `rejected`, `queue_full` and `needs_new_keys`.
Unknown upstream text is discarded. Terminal route failures retain diagnosis and pause new sends. After repairing a still-valid route at the relay,
the phone explicitly sends `syncRelay {routeId,resume:true}`; this never replays its discarded outbox. Counter/key
inconsistency instead requires an explicit fresh route/key agreement and cannot be resumed; unknown 4xx are terminal for that message. No failure changes the selected transport to direct FCM.

## Android call order

1. Require both hello features and an actual signed-in session. Fetch relay/account capabilities only after opt-in.
2. Create the relay route and stage its secrets/key pair locally. Send `registerRelay` with one durable operation ID.
3. Verify backend identity/session and its direction-specific HMAC; durably save the agreed keys/transcript.
4. Activate the route at the relay (including predecessor disable), then call `confirmRelay`. Retrying confirmation
   is safe while that same route is active. Activation selects just one transport/session; direct rows are suppressed
   immediately by the durable selection, then removed. A rotation queues predecessor deletion and cancels its outbox.
5. Anchor time freshly (use `syncRelay` after an old receipt), decrypt/admit with the shared protocol library, and
   retain cross-key event admission state. Do not reset it at a route switch. Already accepted messages may arrive late.
6. Report relay lease renewals and preference changes using `syncRelay`. Renewal cannot exceed absolute expiry.
   After a token update/challenge at the relay, explicitly `resume:true` to resume a paused, still-valid route.
7. On push off/backend removal/sign-out call `syncRelay {routeId,unregister:true}` or existing unregister with the
   returned device ID before erasing credentials when reachable. Session revoke takes the same local cleanup path.
   Local phone cleanup must not wait for network; queue its own delete-only cleanup when the backend is unreachable.
8. Poll safe status if still signed in; cleanup completes after relay 204 or absolute expiry plus 24 hours, not local
   unregister acknowledgement. Expiry completion reports `cleanup_expired` for 24 hours; it is not a relay acknowledgement.

Shared-client methods: `readNotificationTransports`, `registerRelayNotifications`, `confirmRelayNotifications`,
`syncRelayNotifications`; existing device/test/unregister methods remain compatible. Generated Kotlin requests cover
all new calls. Android behavior is unchanged in this task.

## Storage and outbox rules

Both files are backend-owned, mode 0600, atomic private temporary-file replacement, serialized writes. They are
source-ignored and the public guard rejects their filenames. No configuration/QR/address/support export reads them.

- `notifications/push-relay.json`: `version:1`, `routes`, `receipts`, `selected`, `revoked`, `cleanupExpired`, `sends`, `deletes`.
- Each route: authoritative `context` (backend/session/route/key IDs), `operationId`, original `registration`, stable
  `answer`, exact `transcript`, three base64url `keys`, `state`, decimal `nextSequence`, and public `device`.
- Each receipt: owning `sessionId`, registration `fingerprint`, `routeId`, `keyId`, stable `answer`, `purgeAt`.
  Receipts retain no capability/derived key and prevent operation/route/key reuse until the relay purge horizon:
  absolute expiry plus 24 hours after activation; original ten-minute pending expiry plus 24 hours if never activated.
  Confirmation extends the pending receipt to the absolute-expiry horizon. Expired receipts are pruned by the pump,
  including after restart; after pruning, the operation ID is no longer a registration retry receipt.
- `selected` maps session IDs to one active route or null for locally revoked. Even a null selection suppresses stale
  direct rows left by a crash between files; only explicit direct registration clears it. `revoked` retains safe
  lease/absolute expiry and last-delivery diagnosis after secret erasure, plus `purgeAt` using that route receipt’s
  horizon. Revoked status is pruned at that horizon. Minimal null selections remain to suppress stale direct rows;
  pruning status/receipts never enables a direct fallback.
- `cleanupExpired` maps session IDs to diagnosis expiry times. When a delete capability reaches its absolute expiry
  plus 24 hours, its secret is erased and status becomes cleanup `done`; `lastDelivery:"cleanup_expired"` distinguishes
  that completion from an HTTP acknowledgement. This secret-free diagnosis lasts only 24 hours after local erasure,
  survives restart and is then pruned. It is not another indefinitely retained revoked-status record.
- Each send: `routeId`, `messageId`, exact serialized HTTP `body`, policy-only `event` (kind/project), `expiresAt`,
  `attempts`, `dueAt`. Payload content is encrypted; no plaintext preview/body is stored in the outbox.
- Each delete: `routeId`, `sessionId`, `deleteBearer`, `absoluteExpiresAt`, `attempts`, `dueAt`; no send capability,
  transcript or key. The absolute-expiry-plus-24-hour deadline is scheduled even if Retry-After would defer HTTP longer.
- `notifications/push-relay-counters.json`: `version:1`, `counters` mapping key IDs to next decimal sequence.
  This independent high-water witness is committed before route allocation. A mismatch/missing witness or malformed
  counter/key makes the route need new keys. Exact already-encrypted entries can still retry without a new sequence.

A sequence is durable before encryption; an exact envelope is durable before HTTP. Allocation gaps are safe. Each
held event has a random encrypted event ID; retries reuse its stored envelope/event ID byte for byte. Rotation drops
old queued events rather than migrating/replaying historical notifications under repaired keys. Held, not-yet-sent
events retain their event ID through the switch. Accepted entries are removed durably; an ambiguous/lost reply can
repeat the exact bytes, with phone replay/event admission preventing double display.

Notifier policy is unchanged: claim dedupe, archived-project filtering, visibility hold/interaction drop, kinds,
mutes, quiet hours, body preview and twelve-hour lifetime precede relay sends. Retries check current policy/session
again, including after asynchronous archive lookup. New mutes/quiet hours discard queued work, not delay it until
unmute. Requests already handed off cannot be recalled.

Retry starts at five seconds, doubles with 0–20% positive jitter, caps at fifteen minutes, and takes the maximum with
Retry-After (seconds or HTTP date). A route has at most 100 pending entries: drop the **newest** at capacity without
allocating a sequence; record `queue_full`. Deadline is the earlier of original event + twelve hours and route lease/
absolute expiry. The HTTP adapter reads fixed `{error:"code"}` failures and `{state,code}` send results, never nested provider errors.
Known quota scopes (`route_rate`, `account_rate`, etc.) and `relay_disabled` remain visible in `lastDelivery`;
unknown 429 becomes `rate_limited`, unknown 5xx becomes `relay_unavailable`. All unknown 429/503 and other 5xx/timeouts retry; 200 pending retries. Terminal results remove the
message. Known terminal route/account/token results additionally pause further new sends until an explicit phone repair/resume.

Local revoke first blocks further submissions in memory, then atomically replaces route/send secrets and keys with
delete-only work. Old direct rows are removed only after that commit. HTTP is never part of the local revoke wait.
Delete retries independently of auth/session state across restarts, including after wrong-secret 404. A 204 erases
its capability immediately; otherwise cleanup stays pending with capped backoff until absolute expiry plus 24 hours.
At that horizon relay authority has expired in code: local erasure and cleanup `done` no longer require an HTTP
response. This is not evidence of physical relay erasure; Firestore TTL and scheduled reconciliation are eventual.
The expiry pump removes the secret before submitting further HTTP, records the bounded `cleanup_expired` diagnosis,
and prunes expired operation receipts/revoked status in the same atomic local write.

Earlier private v1 files without retention fields are upgraded on read. Known live routes use their exact horizon;
legacy receipts for missing routes conservatively use registration time plus the relay’s maximum 90-day life plus
24 hours. Legacy delete entries use the available absolute expiry or that conservative maximum, never an early
pending deadline that could discard deletion authority for an ambiguously activated route.

## Limits of local durability

A coherent rollback of **both** files cannot be detected from those same restored files. The witness detects a
partial restore/crash disagreement, not rollback of all local storage. A full backup restore must invalidate old
routes and agree fresh keys; a stronger automatic guarantee needs an independent non-rollbackable authority, which
the approved design does not specify. Similarly, atomic rename/fsync follows existing stores and is not a new
cross-file/power-loss transaction system. No exactly-once HTTP/FCM/display guarantee is claimed.

All 50 relay integration tests run through `createSetup`; no real relay/Firebase credentials, endpoints, emulator,
phone or Android UI are needed. Existing direct-FCM/Web-Push suites plus the explicit relay-off regression prove the
default behavior. Backend configuration changes do not enroll existing clients or replay old project events.
