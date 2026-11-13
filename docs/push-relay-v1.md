# Frozen encrypted push relay v1

T92 implements section 5 of [the approved design](research/push-relay-design.md), as an unused
library. No RPC, relay endpoint, server sender, Android service, UI or storage is wired here.
The shared synthetic vectors are normative for bytes and errors:
`packages/protocol/test-vectors/push-relay-v1.json`. They use public P-256 scalars 1 and 2,
not usable production keys. `bun scripts/generate-push-relay-vectors.ts --check` detects drift.
Both Bun and JVM tests read this file directly. Gradle declares it as a test-task input so
fixture changes invalidate the test cache. JVM tests independently encrypt with JCA and compare
to its exact strings; Bun tests independently encrypt with WebCrypto and compare too.

## Encoding choices

These settle details left open in the design; the cipher/flow is unchanged.

- Binary values use canonical unpadded base64url (including unused trailing bits). IDs are
  16 bytes; bearer secrets and salt 32; public keys 65; GCM nonce 12; GCM tag 16.
- Envelope and plaintext **wrapper** JSON is compact with fixed insertion order. Decoders
  reject duplicate/unknown/missing wrapper keys, alternate wrapper formatting, unpaired
  surrogates in wrapper strings and noncanonical binary encodings. Unicode is not normalized.
  Use a fatal UTF-8 decoder; a BOM is not discarded.
- Plaintext wrapper order: `backendId,sessionId,sequence,createdAt,expiresAt,eventId,payload`.
  Its prefix through `"payload":` and final closing `}` are canonical. The payload value
  begins with `{` and ends with `}`; no whitespace outside those delimiters is allowed.
  **The payload is not canonical**: its internal whitespace, key order, number spelling and
  string escapes are arbitrary valid JSON. Receivers validate only that it is an object in
  the capped plaintext, and return it as parsed: a TypeScript `Record<string, unknown>` or
  Kotlin `JsonObject`. They neither enumerate fields/kinds nor reserialize-and-compare it.
  Normal platform JSON number semantics apply; no cross-language numeric normalization or
  byte-preserving payload reserialization is promised. Duplicate payload keys follow the
  native parsers' last-key-wins behavior; duplicate wrapper keys remain forbidden.
- Senders still take the existing typed `NotificationPayload`. Known payload field order is
  `kind,title,body,backendKey,projectId,workerId,scheduleId`, then optional
  `threadId,artifactId,taskId` when present, then `tag,at`, followed by unknown extension fields
  in their insertion order. Unknown fields pass through when they fit; fallback drops them.
  No crypto-layer kind list is maintained. Optional absence differs from null.
- Times are nonnegative integer Unix milliseconds, at most 2^53−1. Lifetime is between zero
  and 43,200,000 ms inclusive. Sequence is a canonical decimal string in [0, 2^64−1]. No
  numeric sequence, signs, whitespace, exponent or leading zeroes (other than `"0"`).
- `backendId` and `sessionId`: nonempty, at most 128 UTF-8 bytes each. Sender-side known
  routing fields, `tag` and `backendKey`: at most 128 bytes. Title: 256 bytes. Payload `at`:
  64 bytes. Sender nullable routes cannot be empty strings; display strings can be empty.
  These payload field checks are sender policy, not receive admission rules. `eventId` is
  a random 16-byte opaque event ID, stable across a successor-key switch.
- Pad the complete UTF-8 JSON with byte 0x20 (ASCII space) to the next multiple of
  256 bytes; an exact multiple receives no extra padding. The last JSON byte is `}`; strip
  only trailing 0x20 bytes and require exactly the minimal bucket. The 2,048-byte cap
  includes padding. Ciphertext length is padded length + 16-byte tag.
- Before encrypting, retain the longest complete-Unicode-code-point body prefix that fits.
  If bounded non-preview fields overflow, or an empty body still does not fit, use
  `kind` unchanged, title `Open the app`, body empty, bounded original `backendKey` or empty,
  bounded original `projectId` or null, `workerId`/`scheduleId` null, optional routes absent,
  tag `aiki-push`, and original bounded `at` or empty. If necessary also remove `projectId`.
  Never truncate a routing ID into another ID. Oversized backend/session identity raises
  `PushRelayError("oversize")` / `RelayException("oversize")`, not a plaintext send.
- Credential digest is SHA-256 over UTF-8 compact JSON
  `["aiki-push-v1","credential",fullBearer]`. The full bearer includes the disjoint send or
  delete prefix. Hash and compare raw 32-byte digest bytes. The JavaScript equality helper
  does constant work for equal public lengths; a JIT cannot guarantee machine-level
  constant-time execution. Kotlin uses `MessageDigest.isEqual`.

HKDF info, transcript, direction-specific HMAC and AEAD AAD are exactly the arrays in the
approved design. Transcript salt and public keys are their canonical base64url strings.
The standalone module imports no runtime libraries (even `NotificationPayload` is type-only).
Kotlin uses the app's existing kotlinx JSON dependency and platform JCA, no Android imports.

## Wire bounds

Envelope order is `v,r,k,m,n,c`; `v` is integer 1. FCM data has exactly one string key `aiki`
containing that serialized envelope, not an object. The relay send body serialized by
`relaySendBody` / `sendBody` is `{routeId,messageId,envelope}`, with envelope also a string.
The outer route/message IDs must match the contained envelope when a future endpoint parses
that body. Authorization is in the HTTP header, never in JSON or a URL.

Check UTF-8 bytes, not string length: plaintext ≤2,048, serialized FCM `data` JSON ≤3,584,
relay send HTTP body ≤4,096, management body ≤8,192, FCM token ≤4,096. The exported limits
and byte-size helper are for future endpoints as well as senders. Encrypted envelope parsing
checks schema, canonical encoding and cipher/nonce lengths before invoking AES. Authentication
failures use `authentication`, not a content-bearing error. Route/key mismatch uses `route`;
backend/session mismatch after decryption uses `identity`. No raw content goes into errors.

## Sender API

TypeScript exports `generateRelayKeyPair`, `exportRelayPublicKey`, `relaySharedSecret`,
`deriveRelayKeys`, `relayTranscript`, `relayConfirmation`, `verifyRelayConfirmation`,
`encryptRelay`, `decryptRelay`, capability functions and admission classes from `@kemiri/protocol`.
The direct module is usable in Bun, Node 22 and WebCrypto environments without Bun/Node imports.
Kotlin's corresponding entry point is `RelayCrypto`, with `RelayContext` and `RelayPlaintext`;
its receiver payload is an opaque `JsonObject`, convertible to the existing generated DTO later.
TypeScript uses `RelaySendPlaintext` (`RelayPlaintext<NotificationPayload>`) for preparation/
encryption and `RelayPlaintext<Record<string, unknown>>` for receive/admission.

Generate phone salt from 32 CSPRNG bytes; never derive it from IDs or tokens. The private TS
ECDH key is nonextractable; derive and durably retain derived route keys and public transcript
material before replying. Kotlin returns ordinary JCA keys for the future storage wrapper.
Notification and confirmation keys are independent 32-byte values. Neither is sent to the relay.

Production encryption accepts no nonce/message-ID override: both come from the CSPRNG. The
nonce-injected function exists only in `test-support`, not the package entry point or shipped
Kotlin source. A new encryption consumes a durably allocated sequence; persist the exact
returned envelope in the retry outbox before submission. Retries resend those bytes, not a
new encryption of the same message. A restored counter requires a fresh key/ID. Counter
allocation, the outbox and the registration handshake's pending/active transaction are later
work; this library deliberately does not pretend to provide their crash safety.

## Receiver and persistence API

The original strict payload schema was a version-skew flaw: adding a payload field could
make an older phone reject otherwise supported notifications. Relay crypto now passes all
authenticated fields and kinds through to the app's existing payload parser. Android's
`parseNotificationPayload` uses `wireJson` with `ignoreUnknownKeys=true`, so extra fields are
ignored when decoding the DTO. It then explicitly rejects kinds outside `NOTIFICATION_KINDS`
except `test` by returning null. An older app therefore may skip a new kind, as direct FCM
does today, but new fields do not block its supported kinds. No parser/service wiring changes
in T92; JVM tests verify this existing behavior after relay decryption.

1. Resolve a locally known route/key to expected `RelayContext`. Decrypt with that context;
   do not trust decrypted backend labels as local authority. No display before verification.
2. Use one `RelayAdmission` per backend/session across predecessor/successor keys. Supply
   backend time from the authenticated monotonic-anchored offset, not phone wall time. The
   future storage/service layer must handle reboot/offset refresh. Set `clockTrusted=false`
   while time is uncertain; that fails closed with `clock`. A message created over five
   minutes ahead also fails with `clock`; it is `expired` once backend time exceeds expiry
   by more than five minutes (the exact boundary is accepted).
3. Serialize admission calls. `admit` validates and stages the next state, then invokes a
   synchronous `persist(serializedState)` callback. That callback must atomically and durably
   commit, or throw. The library commits its in-memory state only after callback success.
   Only a successful return allows display. Do not launch an asynchronous write and return
   from the callback; bridge asynchronous storage outside this API with equivalent locking
   and commit-before-display semantics.
4. State JSON is `{windows,events}`. Each key's window is `{highest,bits}`: highest is null or
   u64 decimal; bits is lowercase minimal hex (0 for empty), at most 1,024 digits. Bit zero
   marks highest. Accept out-of-order sequences once while highest−sequence <4,096; a jump
   of ≥4,096 discards the old bitmap without iterating over the jump. Each event maps to its
   admission backend timestamp. Events expire at exactly 13 hours, including across keys.
   Duplicate events do not consume the new sequence; failed persistence consumes neither.
5. Restore with the constructor's serialized string. Reject corrupt state; never silently
   reset it under an existing key. State is local, not a network input. Retire decrypt-only
   keys and their windows after at most 13 hours in the future storage layer; never prune a
   window while its key remains usable. Keep event dedupe across that key transition.

A crash after durable admission but before display may lose one notification. This is the
specified at-most-once display admission, not an exactly-once delivery guarantee. Keystore,
backup exclusion, storage encryption, locking, route lookup and key-retirement scheduling
remain outside T92. There are no new runtime dependencies and no changes to existing senders.
