# Push notifications through a Firebase-only relay

T63, design only. Nothing here is implemented or deployed. D38 fixes the architecture: an HTTPS Cloud Function and
Firestore in the operator's existing Firebase project, a narrowly scoped route per paired phone/backend session,
backend-to-phone encryption, and independent backend VAPID keys for Web Push. No other relay host or message broker.
Friends keep their own backends and use device sign-in over Tailscale HTTPS. Signed GitHub Releases APKs start with
push off; enabling push is a separate, informed action. This does not change device sign-in or create shared backends.

## Decided

- **D38:** Firebase-only HTTPS function + Firestore + FCM, per-phone/backend-session routes, end-to-end encrypted
  payloads, and independent backend VAPID for web. No other relay host or broker.
- **D47:** Thin accounts in the operator's Firebase Auth project replace operator-issued grants. The phone signs in
  with Google or an email link; Aiki stores no passwords. No profile, social features or backend account federation.
- **D49:** Open sign-up, no per-account approval. Bound phones, routes and daily sends per account, source-IP traffic
  and total daily use; the operator can disable accounts and stop the relay. Only phones sign in to relay accounts;
  backends retain route capabilities, never account credentials. Exact initial limits below are recommendations.

## 1. What exists and what changes

Read against current source, not the older implementation-status statements in
[sharing research](sharing-the-app.md) or [device-auth proposal](device-auth-design.md). The implemented sign-in
contract is in [DESIGN](../DESIGN.md#device-sign-in). It already binds notification rows to sessions and deletes them
on revoke; it does **not** delete anything in Firebase today.

| Current code | Keep / change |
| --- | --- |
| `packages/server/src/notifications.ts`: one Notifier, event dedupe, 15-second hold, interaction cancellation, quiet hours, kinds, mutes, 12-hour TTL, 200-character body preview and `lastDelivery` | Keep policy before transport selection. Add `fcm-relay` alongside `fcm` and `web-push`, durable send retries and remote-delete outbox. Do not put relay failures in agent/job request paths. |
| `packages/server/src/fcm.ts`: HTTP v1, OAuth service-account JWT exchange, data-only `{payload: JSON}`, high priority, token-invalid cleanup | Keep as an explicit legacy operator-only transport during migration. Friends never receive a service-account file. In production the function uses a dedicated runtime service account and Application Default Credentials, not a downloaded JSON admin key. |
| `packages/protocol/src/notifications.ts`, client notification methods and server RPC dispatch: config, register/registerFcm, device/test/unregister/presence/interaction | Add explicit feature `fcm-relay-v1`, typed config/registration/status and generated Android DTOs. Existing features/fields keep their meaning for old clients. Never advertise relay by pretending a direct FCM account is configured. |
| Android `features/notifications/FirebasePush.kt`, `HarnessMessagingService.kt`, `NotificationCenter.kt`, `PushNotifications.kt`, `NotificationSettings.kt` and `NotificationsScreen.kt` | Today both FCM token callbacks feed settings, sync runs on reconnect/preferences/token changes, the service parses plaintext `payload` and draws local channels/deep links. Add relay admission, route lifecycle, secure keys, authenticated decrypt/replay checks and transport-specific status. Keep channels, preferences and routing. |
| `apps/web/src/lib/notifications.svelte.ts`, `notifications.ts`, `service-worker/index.ts` and Notifications settings component | Today one root worker subscription is copied to every backend and differing VAPID keys are an error. Server `loadOrCreateVapidKeys` already generates a pair on first start. Stop copying a private pair for friends; support one push-worker registration/subscription per backend. |

Current private settings are `AIKI_FCM_KEY_FILE`, `AIKI_VAPID_KEY_FILE` and `AIKI_VAPID_SUBJECT`, resolved through server
settings into backend-owned paths. Retain these compatibility settings. Proposed relay configuration holds only the
operator-approved HTTPS endpoint and public protocol version, never an admin credential. Put new settings through the
existing private settings loader, not ambient environment reads. Do not export route secrets in backend address lists,
QR imports, normal config responses, support bundles or protocol logs.

## 2. Trust and admission

A route holder can submit bounded encrypted data to **one registered app installation**. It cannot choose a token,
topic, condition, FCM project, priority, arbitrary FCM options or callback URL. A different route for each backend
session makes revocation independent even when several routes point at the same phone token. The relay learns the
association, but never receives backend URLs, device labels, project IDs, task IDs or notification preferences.

### Account identity is not token ownership

Use **Firebase Auth Google sign-in or passwordless email-link sign-in**, then an FCM possession challenge. The Firebase
UID identifies an account, not an installation. An installation has a separate random 128-bit ID and its own token,
keys and routes; several phones may belong to one UID. Atomically create the minimal account row on first enrollment
within the global/IP limits; no operator approval. Accept only Google/email providers and verified email claims,
not anonymous or custom-token sign-in. Email-link sign-in uses Firebase's Email/Password provider setting
with Email link enabled, but Aiki exposes no password flow and rejects email-provider ID tokens whose email is
unverified. Firebase's provider claim alone cannot distinguish password from email-link sign-in; this design's
security boundary is a verified account, not proof that a particular client UI was used. Disable unnecessary providers.

**Only the phone signs in.** Firebase SDK ID/refresh credentials stay in app-private, backup-excluded phone storage;
never send them, email, name, Google credentials or the FCM token to a backend. Backends are not Firebase Auth clients:
only their own device session and each route's send/delete capabilities are needed. Relay accounts confer no permission
to sign in to an Aiki backend. Account takeover threatens all its phones/routes; offer phone inventory/removal in-app.
Firebase API keys and APK certificate fingerprints are public identifiers, not registration secrets.

### Signing in from a GitHub Releases APK

Neither supported sign-in method requires Play Store publication. Both require configuration in the operator's
project and testing the **actual release-signed sideloaded APK**, not just a debug build.

- **Google:** use Android Credential Manager's Sign in with Google integration and exchange the Google ID token with
  Firebase Auth [17][18]. Enable Google in Firebase Auth, configure the OAuth consent screen (external audience and
  production publication for open use; test-user-only mode cannot serve everyone), support/privacy information, and
  Android OAuth client for package + release **SHA-1**. Register the release certificate's **SHA-1 and SHA-256** with
  the Firebase Android app (SHA-256 also supports App Links/App Check). Use the **Web OAuth client ID** as Credential
  Manager's server client ID/audience, not the Android client ID; update private release client configuration after
  enabling the provider. Do not ship an OAuth client secret. Register replacement signing certificates before a key
  rotation. GitHub distribution works on supported Google Play services/Credential Manager devices with a Google
  account; Play installation/licensing is not a sign-in requirement. No Google account? Offer email link instead.
- **Email link:** enable email-link Auth, configure an authorized HTTPS continuation URL, sender name/address and
  templates/deliverability, and a **Firebase Hosting link domain** [19][20]. Recommend the project's default Hosting
  domain first; a custom Hosting domain requires ownership/DNS/TLS. Use current Firebase Auth Android SDK (23.2.0+
  or current BoM), `handleCodeInApp=true`, Android package and Hosting `linkDomain`; do not use retired Firebase Dynamic
  Links (shut down August 25, 2025), `dynamicLinkDomain`, or a Play Store install fallback for this sideload-only flow.
  Configure verified Android App Links: manifest HTTPS intent filter for the chosen host and documented `/__/auth/links`
  path, `autoVerify`, and hosted Digital Asset Links binding package to release SHA-256; Firebase setup also needs
  SHA-1/SHA-256. Hosting is the domain/association mechanism; App Links is how Android returns the email URL to the app.
  On launch/new intent, validate `isSignInWithEmailLink`, then `signInWithEmailLink(email, link)`. Keep the initiating
  email locally until completion; if opened on another phone, require email re-entry. Never put email in the redirect
  URL, log the one-time code, or trust arbitrary continuation URLs. Browser-only/unverified links should explain
  “Open in Aiki”/supported-link settings; provide a paste-link recovery inside the app with strict host validation.
  No Play listing or Google account is needed; FCM push still needs supported Google services. Test installed-app link
  return from mail/browser clients, cold start, cross-device, expired/used links and the paste path.

Recommend provider linking only after explicit recent authentication to the existing UID; never merge accounts or quota
by matching email in application code. Handle Firebase's account-exists/provider-conflict errors with a request to use
the original method, then link deliberately. Switching accounts first removes this installation's old relay routes.

### Enrollment and FCM possession

- Phone signs in after informed opt-in, generates an installation ID and operation ID, and submits its FCM token.
  Transactionally reserve a phone slot and one pending challenge under the account/IP/global quotas for five minutes.
  Idempotent retries reuse the operation; no raw FCM token is returned. Expired reservations release slots.
- Function sends a **normal-priority**, data-only challenge to that exact token: random challenge ID and 256-bit nonce,
  five-minute deadline. Foreground phone validates its pending ID and echoes the nonce with the same account ID token
  and installation/operation. Store nonce hash, token hash, UID, installation ID, deadline and attempts. Successful
  atomic comparison activates the installation; five replies maximum. Failed challenges never authorize routes.
- Bind token-replacement challenges to the same account/installation/operation too. A stolen token string alone cannot
  answer. A token hash can belong to only one active installation/account: never move it solely on a submitted string;
  a completed possession challenge is required to replace its ownership and revoke the previous mapping. Cap sends
  before FCM. This proves reachability, not one human, a genuine app or an uncompromised OS. Account quotas, global caps
  and operator disable remain necessary; a relayed challenge or compromised phone can defeat possession checks.

### App Check with a sideloaded APK

Official [Play Integrity App Check guidance][1] explicitly supports distribution exclusively outside Google Play:
**do not require `PLAY_RECOGNIZED` or `LICENSED`; require device integrity**. Default `PLAY_RECOGNIZED` excludes apps
not published on Play. Strong integrity is not a suitable blanket requirement for Android 13+ sideloaded installs.
A Play Console/API linkage and the release signing certificate registration still need operator setup; sideloading is
not the same as working without Google Play services. Test the actual release APK and supported phones first.

Recommend **verified accounts + quotas + FCM challenge as the pilot's required boundary; App Check monitored first**,
then enforce the documented sideload settings on phone management endpoints after a real-device check. Do not require
App Check on backend send/delete: a friend's Bun backend cannot provide an Android attestation. On plain HTTPS
functions explicitly verify Firebase ID tokens and, when enabled, `X-Firebase-AppCheck` with expected app ID [2].
Neither App Check nor account sign-in proves possession of a particular FCM token; keep the challenge in either case.
Never ship debug-provider tokens. A custom attestation provider adds verification infrastructure and is not needed for
this pilot. App Check raises the cost of scripted abuse but does not enforce one person per account. No fallback that
silently bypasses enforced attestation.

## 3. Route capability and relay storage

Use opaque random capabilities rather than self-contained signed JWTs: deletion must take effect immediately at the
next authorized send, so Firestore must be consulted anyway. Phone generates and securely stages both secrets before
creation; retries cannot lose the only copy after a response loss.

- `routeId`: 128 random bits, unpadded base64url. It is an identifier, not authority.
- `sendSecret`: 256 random bits. Bearer `aiki_push1.<routeId>.<secret>` permits send and minimal send-status lookup for
  that route only. Store SHA-256 of the full domain-separated credential; compare in constant time. Never put it in URLs.
- `deleteSecret`: separate 256 random bits, bearer `aiki_push_delete1.<routeId>.<secret>`. Permits **only irreversible
  deletion**, including after expiry, never send, token replacement, renewal or route creation. Phone and backend keep
  it so either can delete independently. Send authority cannot mint deletion or management authority.
- Phone's Firebase UID manages only installations/routes owned by its account; each installation ID is separately
  scoped. Signed-in phones may list/remove the account's other phones, never read back their token or route secrets.
  Only phones can renew leases and update tokens after challenge. Backends never receive account credentials or raw
  FCM tokens. Each send checks account state as well as route state, without authenticating the backend as a user.
- Lease: 30 days, renew on launch/foreground maintenance when under seven days remain, never past a 90-day absolute
  route lifetime. Each renewal uses fresh phone ID-token verification; there is no promise of background renewal on a
  force-stopped phone. At 90 days or suspicion of leakage, create new route/secrets/ECDH keys, install on backend, then
  delete old route. Backend cannot extend authority without the phone. Check expiry in code; TTL garbage collection is
  not authorization. Endpoint/protocol is pinned in the APK and backend configuration; no untrusted URL redirects.

### API outline

All `/v1/...` endpoints live in one HTTPS function, return bounded JSON and `Cache-Control: no-store`, accept POST
only, no cookies/redirects. Authenticate before expensive operations; validate strict schema and byte limits.

| Endpoint | Authority / behavior |
| --- | --- |
| `accounts/status`, `installations/list`, `installations/delete` | Phone ID token, owning UID; minimal quota/status and opaque phone IDs/times, no secrets/tokens/profile. Remove one phone and all its routes. |
| `accounts/delete` | Recent sign-in (auth_time <=5 minutes), verified/revocation-checked phone ID token; idempotently block account first, then durably cascade relay and Auth deletion. |
| `installations/begin`, `installations/confirm` | Verified account ID token + quotas + possession challenge above; random installation/operation IDs. Pending state is not an active phone. |
| `installations/token/begin`, `installations/token/confirm` | Same owning UID/installation, challenge new token, atomic token replacement; existing route IDs/secrets unaffected. |
| `routes/create`, `routes/renew`, `routes/delete` | Phone ID token, owning UID/installation, account/quota checks; create includes staged credential hashes and operation ID. New routes reserve quota; successors start pending/no-send. Deletion never depends on unused send/enrollment budget. |
| `routes/activate` | Phone ID token, same account/installation; after key confirmation, atomically activate a pending route and disable its stated predecessor. Transaction preserves active-slot caps; idempotent operation permits crash recovery. |
| `send` | Send bearer; `{routeId, messageId, envelope}` only. Token and FCM configuration come exclusively from stored route/installation. |
| `send/status` | Send bearer + message ID; bounded `pending/accepted/failed/unknown`, no token or other route data. |
| `delete` | Delete-only bearer; body `{routeId}`; idempotent 204 for an already absent route. Never reveal existence to invalid send credentials. |

Management bearer uses Firebase `Authorization`; verify project/audience, allowed provider, verified email, expiry
and revocation/disabled state [23]. Send/delete use their own `Authorization` schemes and disjoint validators.
Before each send or challenge, read account control and use Admin Auth `getUser(uid)` without a positive-state cache:
missing/disabled Auth user fails closed too. This covers out-of-band console deletion/disable; never infer continued
account permission from a valid send capability or an hour-old phone token. Include this Auth lookup in latency/quota
metering (one per external send); at scale verify the project's Admin Auth API allowance. A change after this final
check can race an already authorized send, like any in-flight revoke. Routes cannot be enumerated by a capability. Unknown route and wrong send secret both return generic 404;
valid expired credentials may return 410 `route_expired`. Retain a bounded disabled marker for invalid FCM address to
return 410 `token_invalid` to a valid sender. Errors contain fixed codes only, not raw Google error messages.

### Firestore (server SDK only; deny all direct client reads/writes)

| Collection/document | Stored fields and retention |
| --- | --- |
| Firebase Auth user (not Firestore) | UID, verified email, provider identifiers and provider-held profile. Google can supply display name/photo URL; do not copy to Firestore or use them. Clear mutable top-level name/photo where supported; linked-provider profile may remain in Auth until unlink/account deletion. No Aiki passwords. Retain until user deletion; disabled users retain minimum Auth identity to prevent immediate reactivation. |
| `accounts` | UID, active/disabled/deleting state, phone/route allowances, reserved/active counts, daily/minute counters, created/last-management time. No duplicated email/name/photo. Disabled UID marker remains until deletion; deleting marker blocks sends until cascade and Auth removal finish. |
| `installations` | Random installation ID, owning account UID, FCM token (needed to send), token hash/generation, enabled state, created/last-management time. Purge token immediately on disable/invalidity; remove installation after last route deletion or 30 days without any route. No FID/device model needed. |
| `challenges` | Hashes and pending fields above, optional staged new token, deadline, counters. Delete on completion; TTL cleanup within 24 hours, never treat a late TTL deletion as a live challenge. |
| `routes` | ID, account UID, installation ID, send/delete hashes, creation, lease/absolute expiry, generation, quota windows, pending/active/disabled state and optional predecessor ID. No encryption key or backend/session identity. Delete on revoke; expired/invalid rows scrub token references and purge within 24 hours. |
| `sendAttempts` | Route ID + message ID, envelope digest, reservation time, FCM attempt state, safe result code, lease deadline for retry. No ciphertext, plaintext, token or Google response body. Purge after 24 hours. |
| `rateLimits`, `relayControl` | Short-window counters, rotating keyed hash of source IP, global/account totals and new-account count, enable/enrollment switches. IP buckets <=24 hours; daily key rotation. Only aggregate daily counters survive account deletion until their window closes: deleting/recreating an account never refunds global/IP budget. Disable unnecessary indexing. |
| `accountCleanup` | UID, operation ID, disabled/deletion cleanup phase and bounded retry state, no token/profile/content. Resume cascades across crashes, remove dependent challenges/attempts/index entries; erase deletion work/UID after completion (target <=24 hours). Account disable keeps only Auth identity, disabled marker and abuse counters. |

Firestore/Firebase administrators can read token/association metadata; encryption at rest is not E2EE. Give the runtime
service account only the necessary Firestore access and FCM send permissions, deployment to a separate human/CI
principal. Runtime identity replaces the broad exported key; no backend receives either one. IAM administrators can
still subvert service operation. Log no request bodies, Authorization, tokens, challenges or ciphertext; see privacy
for unavoidable platform request logs. Do not use Firestore listeners in the phone or retain notification bodies there.

## 4. End-to-end flow and lifecycle

1. **Enable on the phone:** explain privacy, request Android notification permission, then fetch its FCM token using
   `FirebasePush`. Account sign-in/enrollment/challenge run only after opt-in. Leave push off if permission, sign-in or
   enrollment fails. FCM is optional; backend pairing and normal app use continue without a relay account.
2. **One signed-in backend connection:** require `device-auth-v1`, `fcm-relay-v1` and an authenticated session even if the
   backend otherwise permits optional mode. Backend reports its stable backend ID and actual caller session ID. Phone
   allocates a route for this installation/session, stages secrets and ECDH key pair in Keystore-protected, backup-excluded
   storage and creates the relay route. Do not give an anonymous/legacy socket a capability.
3. **Key agreement/registration:** phone sends proposed `notifications.registerRelay` with route ID, version, send/delete
   secrets, expiry, phone public key, derivation salt/key ID, label, backend-local routing key and preferences over that
   authenticated WSS connection. Server derives identity from its session, not those labels or caller device ID. Backend
   generates its own per-route ECDH pair and returns its public key. Both confirm possession with direction-specific HMACs
   of the transcript. Persist a pending registration before replying; retry the same operation after crash. Activate only
   after the phone's key confirmation and durable local storage; phone calls relay `routes/activate` before allowing
   backend sends. New routes also start pending, but reserve an active slot; rotation uses its bounded successor slot.
   Config/read-device responses expose status, never secrets.
4. **Send:** existing Notifier claims event dedupe key, holds/filters exactly as today, builds the usual payload and encrypts
   per route. Durably allocate sequence + retry entry before sending. Backend POSTs to relay with send bearer. Function
   checks account Auth state and route/account/lease/quotas in Firestore, reserves message ID, sends data-only FCM HTTP v1 to the stored token,
   records acceptance/failure and replies. Relay never fetches backend URLs or decrypts payloads. It caps FCM TTL at
   12 hours from the first relay reservation and at remaining route lease, uses high priority only for visible
   notifications, and accepts no FCM override. The phone independently enforces encrypted message expiry, which can
   be earlier than that relay-visible deadline.
5. **Receive:** `HarnessMessagingService` distinguishes challenges, versioned encrypted relay messages and explicitly
   allowed legacy messages. Look up route/key locally, authenticate/decrypt, reject replays/expired/wrong-session content,
   then call existing payload parser and `showPushNotification`. Backend identity/label comes from local route mapping,
   not untrusted outer fields. No notification display before AEAD verification. Tap opens local routing IDs and still
   requires backend sign-in; no credentials in the tap intent.
6. **Send retries:** `200 accepted` means FCM accepted, not displayed/read. Before FCM, transactionally reserve message ID
   and digest; identical retries return result, conflicting body gives 409. A function crash after FCM send but before
   recording result leaves an ambiguous reservation. After a 60-second lease, allow retry of the **same** envelope; do not
   assert exactly-once delivery. Phone replay protection prevents double display. Backend owns ciphertext retries (max
   12 hours/100 pending messages per route); relay has no durable payload queue. Backend restart resumes them, but never
   replays historical events merely because a route was repaired.

### Rotation, reinstall and several backends

- Existing `onNewToken`/`onRegistered` callbacks trigger installation token update and challenge once, not independent
  ownership claims by every backend. Keep old token until new-token confirmation; atomically switch installation token
  generation. Clear token-invalid state only for still-unexpired routes; never revive revoked/expired routes. Active
  routes then reach the new address without handing new authority to backends. Retry after app launch
  if callback/network was missed. If a send marks a token invalid, only invalidate the generation actually sent: a stale
  error must not erase a concurrently confirmed replacement. Route/key mappings do not depend on token text.
- Normal signed APK upgrade preserves backend sessions, account UID and keys; **do not uninstall to migrate**.
  Reinstall/data clear or a new phone signs in again to the **same account UID**, then enrolls a fresh installation ID,
  token and keys, pairs each backend and creates fresh routes. Sign-in does not restore lost E2EE keys or backend
  sessions. Three active phones/account; if full, show the account phone inventory to remove a lost/stale phone before
  enrolling, without operator approval. Old routes cannot target the new token; remove them explicitly or by lease
  expiry/invalid-token cleanup. Never recover secrets by email or transfer them through Firebase. Exclude credentials
  from Android backup/transfer. Each phone's routes/keys remain independent even under the same account.
- Three backends on one phone get three distinct routes and key agreements, even with one FCM token. Backend A never
  gets B's route, keys or management identity. Revoking A must not delete the installation token or B/C's routes. An
  installation-level disable in the app/operator console deliberately disables all its routes and purges its token.
- Renewal changes only lease timestamps; the phone syncs the returned expiry over signed-in WSS so backend status and
  local expiry checks remain current. Secret/key rotation creates a successor route: stage on phone and backend,
  confirm keys, activate successor/disable predecessor atomically at relay, then switch backend's active row and
  acknowledge before deleting predecessor. Persist phases for crash retry; a brief pause is possible, not dual sends.
  Cascade/activation/deletion transactionally updates phone/route reservations and counts; expiry releases them.
  Retain old decrypt-only keys
  at most 13 hours for already accepted messages; duplicate delivery uses an encrypted event ID shared across the switch.
  Pending unused routes expire; cap pending successors to one per session. If backend is unreachable, do not switch yet.

### Revocation, sign-out, push off and removal

Extend existing durable revoke: disable session and local push immediately, cancel held/pending sends, atomically
write a **delete-only outbox entry** before removing the notification row, then try remote deletion. Retain no send
secret or E2EE key in that tombstone. Retry delete with jitter/backoff across restarts until 204; then erase delete
secret. Apply this to session expiry, unregister, backend removal and sign-out, not just the Devices revoke button.
Phone can delete its own route directly by UID, erase keys and cancel posted notifications scoped to that backend.
Push off durably queues deletion of every route before deleting the FCM token; local off is immediate even if remote
requests fail. Do not block local disable/token deletion indefinitely waiting for Firebase.

A backend cannot grant itself renewal, but a compromised backend with a retained send capability can push until the
phone/operator deletes it or the lease expires. The relay does not observe backend auth sessions. No distributed
system can guarantee immediate Firestore deletion while Firebase is unreachable: UI must distinguish **device revoked
locally; push-route deletion pending** from completed deletion. Keep durable retries (up to absolute expiry plus cleanup),
and support phone/operator deletion. A send already handed to FCM may arrive after revoke, and an offline phone may not
learn a remote revoke until reconnect. It drops messages for locally signed-out/revoked routes once known; previously
sent bytes cannot be recalled. Do not weaken or delay local device revocation to wait for the relay.

### Relay account sign-out, disable and deletion

Keep **backend sign-out**, **relay account sign-out**, **push off** and **Delete relay account** separate in Settings.
Backend sign-out removes only that backend's route/session. Relay sign-out removes this phone's installation/routes,
cancels its notifications and erases its relay keys, then signs Firebase out and clears Credential Manager state [17].
It leaves other phones and backend device sessions alone. Queue only delete credentials before erasing account tokens;
offline sign-out is locally immediate, remote cleanup pending. A signed-out phone drops old messages even if FCM
already accepted them. Next sign-in re-enrolls this installation with new routes/keys. Push off has the same local push
cleanup but may keep the account signed in; explicitly say it does not delete the account.

**Operator disable:** atomically mark the account disabled first; block all its new sends, challenges, routes and
renewals. Disable the Firebase Auth user and revoke refresh tokens. Durable cleanup removes its FCM addresses,
route records and credential hashes, challenges, send attempts and ownership indexes. Keep only minimal Auth identity,
disabled UID marker and short-window abuse counters. Cleanup target <=24 hours; the marker blocks immediately, not
after physical cascade. Do not delete the Auth user on disable: otherwise signing up again with that identity could
bypass the block. Re-enabling requires deliberate operator action and fresh phone enrollment; deleted routes never
revive. An individual phone disable/removal affects only its installation. Delete-only capabilities remain usable
while disabled or during an outage recovery; don't require live account Auth to remove a route.

**User deletion is required in-app**, not just “email the operator”: Notifications → Relay account → Delete account,
with a warning covering every phone, fresh Google/email-link authentication within five minutes, explicit confirmation
and resumable progress [22][23]. Mark deleting/deny sends first, queue a durable cascade, erase all installations,
tokens, routes/secrets/hashes, challenges, attempts and account-specific indexes/counters, then delete the Firebase Auth
user and final UID marker/work item. Auth deletion revokes sign-in; all phones must drop account routes on their next
management response. Online phone erases local account tokens/keys/replay state immediately; other offline phones may
still show already accepted messages until they learn deletion. Backend sign-in and durable project data are untouched.
Aggregate global/IP anti-abuse counters survive only their short retention without a UID; deletion does not refund
today's send/signup allowance. Report completion only once relay and Auth deletion are confirmed; retry outages
durably and show pending status. Never gate deletion on a remaining send quota or successful FCM challenge.

Account deletion through the Firebase console/SDK outside this path also needs cleanup: scheduled reconciliation of
Auth existence against live account rows uses the same durable cascade. Per-send uncached Auth state checks already
stop those routes without waiting for reconciliation. Missing Auth is terminal, not permission to recreate the account
row from an old token. Disabled users who cannot reauthenticate can request deletion through the operator's privacy
contact from the same in-app screen; verify identity privately, never re-enable sending to process erasure. Lost phone/
uninstall alone is not account deletion; another signed-in phone can remove it, and the operator can help with erasure.
Provider/security logs have their separate retention below; never promise that account deletion recalls sent bytes.

## 5. Encryption and byte budget

Use interoperable platform cryptography: ephemeral-per-route **P-256 ECDH**, HKDF-SHA-256 and **AES-256-GCM**, not a new
cipher. Backend Bun WebCrypto and Android JCA/Keystore can implement it. Encode public points as validated 65-byte
uncompressed P-256 points (reject invalid/off-curve points); no private key goes to Firebase. Derive independent
notification and confirmation keys with HKDF using the phone's random 32-byte salt. HKDF info and confirmation
transcript are exact UTF-8 compact JSON arrays, frozen with TypeScript/Kotlin test vectors:

```text
info = ["aiki-push-v1", purpose, backendId, sessionId, routeId, keyId]
transcript = ["aiki-push-v1", backendId, sessionId, routeId, keyId, salt, phonePublicKey, backendPublicKey]
purpose = "notification" | "phone-confirm" | "backend-confirm"
```

Send HMAC-SHA-256 confirmations using the corresponding derived key. Signed-in TLS authenticates the participants;
ECDH confirmation checks interoperability and transcript binding, not an independent public-key identity service.
Neither relay nor Google can replace these keys without compromising that connection/endpoint. Private route material
and derived keys live in backend-owned 0600 storage and Android Keystore-encrypted storage; exclude backups/exports.
Re-agree keys after storage/key invalidation. This is not forward secrecy against compromise of a retained route key.

The FCM `data` map has exactly one string key, `aiki`, containing compact JSON below (all base64url unpadded):

```json
{"v":1,"r":"<route-id>","k":"<key-id>","m":"<random-message-id>","n":"<12-byte-nonce>","c":"<ciphertext-and-16-byte-tag>"}
```

- `keyId` and message ID: independently random 128-bit values. AES-GCM nonce: fresh CSPRNG 96 bits for each **new**
  encryption; retransmit the exact envelope, never re-encrypt under a reused nonce. AAD is UTF-8 compact JSON array
  `["aiki-push-v1",r,k,m]`. Check all lengths/version before allocating/decrypting.
- Plaintext is compact UTF-8 JSON `{backendId,sessionId,sequence,createdAt,expiresAt,eventId,payload}`. `payload` is the
  existing NotificationPayload including content/kind/local routing/tag. `sequence` is an unsigned 64-bit decimal string,
  allocated atomically and persisted per key before send, never reset under that key. `eventId` is a random event ID,
  reused across retries/transport migration, not a visible project/task identifier. No sensitive outer collapse key.
- Keep a persistent highest sequence + 4,096-bit sliding replay window per key on phone, accepting out-of-order arrivals
  once; update replay state atomically **before** posting. Also dedupe event IDs across predecessor/successor keys for
  13 hours. A crash between marking and posting can lose one alert; never promise exactly once. Key/session replacement
  erases replay state only with a fresh key ID/key. A restored backend counter must cause rekey, not silent reset.
- **FCM HTTP v1 maximum is 4,096 bytes**, counting data keys and values [3][4], not 4,096 bytes of plaintext. Application
  cap: plaintext <=2,048 UTF-8 bytes, serialized `data` JSON <=3,584 bytes, send HTTP body <=4,096 bytes (auth in header),
  all checked at backend and relay. GCM tag/base64 expansion and outer JSON fit with headroom. Bound all routing/ID/title
  fields and truncate preview on a UTF-8 boundary; body is already shortened today. If still too large, send a minimal
  encrypted “Open the app” payload with bounded local routing, never silently remove encryption. Reject excess with 413.
  Registration/management bodies have separate 8 KiB cap, FCM token <=4 KiB.
- Keep 12-hour notification life, not FCM's default four weeks; official supported TTL is 0–28 days [5]. Replay rejection
  uses sequences, not clocks. Expiry uses backend time plus a five-minute skew allowance. Phone records a backend-time
  offset during signed-in key setup, anchored to monotonic time; after reboot refresh it when possible. If skew exceeds
  five minutes, show a clock warning and do not drain a stale backlog: expire uncertain previews conservatively and fetch
  current state when connected. Relay lease/challenge/quota time is its own server time, never caller time.

Google/relay see FCM address, route/key/message IDs, sender/receiver network metadata, timing, sizes and outcome codes.
They cannot read title/body/kind/backend labels/routing IDs. Padding plaintext to 256-byte buckets (within the cap) is
recommended to reduce fine-grained length leakage, not to hide activity timing. HTTPS alone is **not** E2EE: current
plaintext direct FCM is readable by the sending service. A compromised backend/phone or a malicious app update defeats
content secrecy. A relay can delay/drop/replay or inject garbage, but cannot forge an authenticated notification.

## 6. Abuse, limits and cost

Sign-up is open, **not unlimited**. There is no embedded APK secret and no claim of one human per account. A verified
email proves inbox access, not reputation: disposable domains, aliases, scripted inboxes, stolen mailboxes and cheap
bulk accounts can multiply per-account quotas. Google sign-in adds Google's account creation/risk controls and avoids
our email-sending quota, but existing/farmed/compromised Google accounts still make a Sybil attack possible. Neither
provider guarantees uniqueness or trustworthy notification content. Linking providers keeps one UID/quota; don't
block disposable domains as a primary defense (lists are porous and can exclude legitimate users). Encrypted bytes
may be non-Aiki content: the relay cannot inspect them. Bound account creation/enrollment independently of sends.

Initial tunable limits (daily means UTC relay-server day, minutes are rolling windows):

| Boundary | Pilot recommendation / behavior at limit |
| --- | --- |
| Account phones/routes | 3 active phones, 8 active routes/phone, 24/account. Pending enrollment reserves a phone slot for 5 minutes; at most 1 pending challenge/phone and 3/account. Initial pending routes reserve an active slot for 10 minutes. Allow 1 successor/active route for rotation only (max 24 additional pending/account, expires in 10 minutes); it cannot send until predecessor is atomically disabled. 409 phone_limit/route_limit with remove/replace UI, not automatic eviction. |
| Route sends | 30/minute, 500/day; count external attempts including ambiguous retries, not only successful FCM sends. |
| Account sends (all phones/routes) | 60/minute, 2,000/day. Rotation, phone replacement and route deletion do not reset this UID budget. |
| Source IP | 120 external sends/minute, 5,000/day; 10 management requests/minute, 200/day. Invalid proofs/status/duplicate lookups: separate 30 requests/minute/IP coarse budget, no attacker-selected route writes. |
| Challenges/enrollment | 3 challenges/hour/account, 10/day/account, 10/hour/IP and 20/day/IP; 20 enrollment attempts/day/account. Failed/expired challenges spend allowance too. |
| New relay accounts | 5/day/IP, 20/day total, 100 active accounts pilot-wide, 300 active phones. Reserve/check transactionally before the first challenge; capacity exhausted returns 429 or 503 enrollment_capacity with next reset/status, never a queue needing approval. Auth-only sign-up is not a relay account reservation. |
| Whole relay | 5,000 external sends/day and 100 challenges/day (separate budgets); after metering, explicitly raise to 100,000 sends/day, 2,000 challenges/day, 100 new accounts/day and 1,000 active accounts/3,000 phones. No automatic growth. |
| Request/runtime | 8 KiB management/4 KiB send caps as above; no compression, 10-second FCM deadline, 30-second function timeout, min instances 0, max instances 2 pilot-wide. |

A send must reserve route/account/IP/global allowance **before each external FCM attempt** in one durable transaction.
A challenge reserves its own account/IP/global allowance, including slot reservation, before FCM. Failed external
attempts consume budgets; identical completed-result/status lookups do not consume sends but do consume request budget.
All applicable limits compose; the lowest remaining budget wins. 429 has fixed scope + Retry-After to window reset;
backend retains the same bounded envelope/ID until reset or 12-hour expiry, never busy retries. Phone/route caps do
not disable existing routes; daily send caps pause sends only, never phone/account deletion. Under the 5,000 global
cap, three abusive accounts can exhaust service for everyone: show “Relay daily capacity reached”, not an auth error.
The 100/day challenge cap can likewise starve enrollment/rotation; normal app use stays available.

All counters/control are transactional across instances, not memory-only. Derive IP from platform-trusted connection
metadata, not arbitrary forwarded headers. Shared NATs can hit limits; show scope and retry time. Allow deliberate
operator adjustment, not bypass. Initial global transaction counters are acceptable at this volume; measure contention
before sharding, which must preserve a bounded total ceiling. Invalid proofs use a coarse limiter before costly
lookups, but unauthenticated floods can still incur platform costs. No new counters keyed by unlimited caller IDs.

`relayControl.enabled=false` stops new sends/challenges/renewals on the next check; deletion remains available.
Separate `enrollmentEnabled` stops only new relay accounts/phones, not Firebase Auth signup itself. Fail closed if
control/quota/Auth state cannot be read. Check again just before FCM; an in-flight send cannot be recalled. Operator
can disable an account/phone/route, disable the function or remove IAM send permission. The kill switch does not stop
Auth emails or Auth MAU charges; provider shutdown/quotas are a separate emergency action.

### Auth quotas and open-signup costs

Firebase's client API/config is public: a modified client can call Auth directly without passing our function. Therefore
the table's signup/IP caps bound **relay state and FCM use only**, not Auth users, emails, MAUs or rejected invocations.
Firebase documents 100 new accounts/hour/IP, plus project/provider request and email quotas and adaptive abuse controls
[11][21]; distributed signups evade the single-IP limit. Don't request higher Auth quotas for the pilot. Use email
enumeration protection [25], generic send-link success text, local resend cooldown (60 seconds) and intended app-domain
checks, but don't pretend client-side throttles constrain an attacker. Alert on Auth signups/MAUs/email sends as well
as relay activity. On a mail/sign-up attack disable the affected provider or project signup via operator controls;
relay enrollment closure alone is insufficient. Recheck available project controls before launch.

Official current email limits [11][21] distinguish **sending mail** from generating links:

- Spark/free tier: **5 email-link sign-in emails/day**. That is too small for an open service, including repeat logins.
  The relay already needs Blaze for Functions; attach billing before offering email links. Do not quote the 1,000/day
  verification-email allowance as email-link sign-in capacity.
- Blaze/billing-enabled: published email-link send allowance **25,000/day**; Identity Platform documents the same
  5-without-billing / 25,000-with-billing split, not unlimited email by enabling the upgrade. Check effective project
  quota and sender restrictions before release. Link-generation quotas (20,000/day Spark, 250,000/day Blaze) do not
  increase Firebase's email-delivery allowance. A custom SMTP service adds separate costs/abuse work; not v1.
- At exhaustion, show “Sign-in email temporarily unavailable; try later or use Google if linked to this account”.
  No silent new UID/provider switch. Existing authenticated phones/routes continue within relay budgets. Do not resend
  automatically or imply an email was delivered; generic UI must not disclose whether an address has an account.

Standard Firebase Auth's non-phone methods (Google/email link) are no-cost [7]. With **Identity Platform**, Tier 1
(email/social) is MAU-billed: first **50,000 MAU/month free**, then **$0.0055/MAU** for 50,000–99,999, falling at higher
tiers [24]. No phone/SMS or SAML/OIDC Tier 2 here. Identity Platform Spark also has a **3,000 Tier-1 DAU** limit [11];
billing-enabled limits and API quotas still apply. 20 or 1,000 ordinary users incur $0 Auth MAU fees when free allowance
is unused, but free allowances are project-wide. One abusive UID can spend at most 2,000 FCM attempts/day across its
routes plus 10 challenge attempts/day (3/hour); at 6 Firestore reads + 6 writes/send below, regional database cost is
about **$0.0144/day** without free tiers, plus a few challenge/management operations and roughly **$0.013/day** CPU at
0.25 s/request and reference CPU rate. This is a workload estimate, not a guarantee; rejected requests remain billable.

Mass signup cannot multiply past 5,000 relay sends + 100 challenges/day (~$0.036/day database and ~$0.033/day CPU for
sends at those assumptions, before allowances). It **can** exceed every relay budget in Auth and HTTP load. For example,
100,000 distinct monthly active Tier-1 users under Identity Platform cost about **$275/month** after 50k free, before
other project users/charges; creating dormant users is not itself MAU billing, their authentication activity matters.
The 25k/day mail allowance bounds Firebase-sent email volume, not a monetary project cap or prevention of harassment.
Google sign-in avoids mail volume but not MAU abuse. Recommend **do not enable Identity Platform solely for this relay**;
if already enabled/needed, explicitly accept MAU exposure, monitor it and assess blocking-function/provider controls.
There is no defensible fixed cost ceiling for unlimited hostile signups from these application quotas alone.

Configure billing alerts, conservative scaling, log exclusions and artifact cleanup. **Alerts do not pause services**
[6]. Current Firebase offers **service-scoped Functions spend caps** [16]; set one only after reviewing impact on the
operator's other functions. Enforcement can lag minutes/overshoot and excludes Auth, Firestore and build/storage.
Max instances bounds concurrent burn, not monthly spend; use ingress protection or disable services during attack.

### Explicit planning estimate (USD/month, not a quote)

Official pricing checked for this design: Firebase's Functions table lists 2 million invocations, 400,000 GB-seconds,
200,000 CPU-seconds and 5 GB outbound/month no-cost, then $0.40/million invocations and location-dependent resources [7].
For the recommended **2nd-gen** function, use the Cloud Run request-based rate card: 2 million requests, 180,000 vCPU-s
and 360,000 GiB-s free/month, based on the reference region [8]; do not mix the generations' compute allowances.
Firestore Standard has **one** free database/project: 1 GiB, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day and
10 GiB outbound/month. TTL deletes, backups/PITR are **not** free-tier operations [9]. FCM itself has no sending fee [7].

Assume one phone/user, up to three routes, **20 total notification sends/user/day**, 30 days, steady daily load, plus
10% requests for retry/management. Each send additionally looks up the Auth user; the Firestore transaction reads
control, route, installation, account, IP bucket and send-attempt row (6 reads), writes control/route/account/IP counters
and attempt reservation (5 writes), then writes
one result (1 more write). Assume 0.25 s billed request time at 1 vCPU/256 MiB, no warm instances; FCM latency/transaction
retries can increase it. A 3.5 KiB envelope is a conservative bandwidth bound. Counters do not store a row per timestamp.

| Usage | 20 friends | 1,000 users |
| --- | ---: | ---: |
| Sends / month | 12,000 | 600,000 |
| Function requests incl. 10% | 13,200 | 660,000 |
| Estimated vCPU-s / GiB-s | 3,300 / 825 | 165,000 / 41,250 |
| Firestore reads/day, before 10% | 2,400 | 120,000 |
| Firestore writes/day, before 10% | 2,400 | 120,000 |
| FCM envelope outbound/month, before 10% | ~0.04 GiB | ~2 GiB |
| Baseline variable cost, unused free tiers | approximately $0; small TTL/deploy storage charges | approximately $4–8 including headroom; reserve $10–20 |

For scale arithmetic, at illustrative regional Standard prices of $0.03/100k reads and $0.09/100k writes [10], including
10% database overhead: reads `(132k-50k)*30/100k*$0.03 = $0.74`; writes `(132k-20k)*30/100k*$0.09 = $3.02`. About 660k
TTL deletions at $0.01/100k add $0.07. Higher-priced regions/multi-region roughly increase database cost; quotas may
already be consumed by the operator's app. At 0.5 s/request, scale compute is 330k vCPU-s, exceeding the 2nd-gen free CPU
allowance by 150k (about $3.60 at the reference $0.000024/vCPU-s rate), plus cold starts. Without any free allowances,
base database operations alone are about $4.75/month at these regional rates. Price actual region/currency before deploy.

No per-send payload storage, short-lived attempt rows (~tens of MB/day at scale), no analytics and no database listeners.
Account separately for function container/build storage, deployment frequency, logs, cross-region egress, transaction
retries, uncached Admin Auth lookups, Auth/App Check quotas and abuse. Google/email-link MAU cost is $0 at these ordinary
user counts if applicable free allowance is unused; mass-signup exposure is separate above. Auth-only users are not
included in the relay's 100/1,000 active-account cap. Set alerts at $5/$10 for pilot and review before scale, not a cost
guarantee. If volume is instead 20 notifications **per backend**, triple sends and recalculate; do not quote the
user-count estimate without its workload. The 1,000-user column requires the explicit higher relay caps above.

## 7. Privacy and consent

**The operator's Firebase project now holds a verified email address per account**, linked to a stable Firebase UID.
Google sign-in also supplies a provider identity, normally name/photo URL; recommend no profile features, no Analytics,
no contacts/additional scopes, no profile copied to Firestore, and clearing mutable Auth name/photo where supported.
Firebase's linked-provider record can still retain that profile until unlink/deletion; do not claim it was never
received or completely discarded. The operator and Auth administrators can associate opaque phone/routes with a
person's email/Google identity. This is identified account metadata, **not anonymous push**.

The project also sees phone FCM addresses, opaque routes sharing an installation/account, lease/create/delete times,
message/key IDs/digests, acceptance/error counts, source IP/user-agent platform logs, geography and timing/sizes. It can
correlate several backends by account/phone/IP, without their URLs. Google runs Auth/FCM/Play services/App Check and sees
their account, device/integrity and network/delivery metadata; Google sign-in additionally exposes that provider login.

**The relay does not receive:** notification plaintext, backend URLs/labels/session identities, repository/project/task
or conversation content/IDs, backend credentials or E2EE private keys. Backends do not receive the account UID/email,
Google profile or Firebase credentials. Outer routes remain opaque; payload content and routing stay encrypted.
Network IP metadata can still reveal a computer/network, so “backends unknown” means no application-level backend
identity/address registration, not traffic anonymity. There is no read receipt; FCM acceptance is not delivery.

Retention: active Auth account until deletion; minimal disabled Auth identity/UID marker until deletion so it cannot
reactivate itself. Tokens purge on disable/invalidity; routes expire/revoke as above. Challenges <=24 hours after
completion/expiry, send-attempt metadata <=24 hours, rotating IP buckets <=24 hours. Account deletion blocks use
immediately and targets relay/Auth erasure within 24 hours; retry outages and show pending status, never promise TTL
is an immediate guarantee. Retain global counters only to their window end without the deleted UID. No relay PITR/
backups by default; if enabled later disclose separate deletion lag. Provider logs and mail already sent are not erased
by route/account deletion. Push off/sign-out remove this phone's routes, **not** the account or other phones.

Set application log retention to seven days where configurable; log no email/UID/profile, request bodies, tokens,
one-time URLs/codes, Authorization, challenges or ciphertext. Platform Auth/HTTP/security logs may contain raw IPs,
user agents and account identifiers; configure exclusions/short-retention buckets and publish actual settings. Required
audit logs and Google's service/security metadata have separate provider retention; don't promise seven-day erasure.
In-app account deletion and the operator's privacy contact cover stored identity and all phones' relay records,
not backend project data. Explain these boundaries before sign-in, not only after an account is created.

Suggested app text **before choosing Google or email sign-in** (longer policy in release/setup docs):

> Optional push needs a relay account in the operator's Firebase project. Sign in with Google or an email link;
> Aiki does not store a password. Firebase stores your email and account identity; Google sign-in may also provide
> your name and photo. We do not use a profile or copy it into the relay database. The operator can link your phones
> and push activity to this account. Your backend encrypts notification content for each phone: the relay and Google
> cannot read it, and your backend never receives these sign-in credentials. Google and the relay still see network
> addresses, timing and sizes. Service has limits and the operator can disable an account or stop the relay.
> Turning push off or signing out removes this phone's push routes, not your account. Delete relay account in Settings
> removes its identity and all phones/routes; offline cleanup can be pending and provider logs/sent messages cannot
> be recalled. Normal app use and backend sign-in work without a relay account. Read retention and privacy details.

Notifications settings show account method/email locally (from Auth, never a backend), signed-in/enrollment status,
phone inventory, send/reset quota scope, transport, permission, route expiry and per-backend last attempt. Include
separate Sign out, Push off and Delete relay account actions. Never ask a friend to install an admin JSON key.
Decrypted lock-screen content remains visible according to Android channel controls; offer generic previews separately
from transport encryption.

## 8. Failures and what the user sees

| Failure | Backend behavior | Phone/settings behavior |
| --- | --- | --- |
| Relay down, timeout, Firestore unavailable, FCM 5xx | Persist bounded retries, exponential jitter (start 5 s, cap 15 min), stop at 12h/expiry; `lastDelivery: relay_unavailable/retrying`. Do not fall back to plaintext/direct FCM for friends. | “Push delayed; app still works.” Test says failure or unknown acceptance, never “delivered.” |
| FCM 429 / relay quota | Honor Retry-After, retain same message ID/envelope, avoid tight loops; show quota scope. | “Push rate limited; retry after …”. No re-pair suggestion. |
| FCM `UNREGISTERED` | Disable only sent token generation and return safe `token_invalid`; stop sending until phone updates it. Do not treat every 400 as token invalid; schema/size errors are a sender bug [4]. | Refresh token/challenge on next launch or callback; “Phone registration needs refresh.” Preserve sign-in. |
| Deleted, unknown or expired route / bad capability | Stop retry on 404/410; preserve non-secret status for diagnosis. Never automatically create authority. | If session still signed in and push enabled, explicitly sync fresh route/keys; revoked session cannot re-register. “Push registration expired” or “Device revoked.” |
| Phone offline for days | FCM acceptance is only acceptance; 12-hour messages expire at FCM. Route remains until its separate 30-day lease. | On reconnect sync state normally, refresh token/lease/keys; no burst replay of old events. FCM can signal deleted messages; refresh backend state when reachable. |
| Clock skew | Quotas/route expiry use relay clock; no timestamp-authenticated send scheme. Safe retry codes; clock warnings in test status. | Sequences prevent replay without wall clock. Apply offset/skew rules above; never extend route authority by changing phone clock. |
| Reinstall, missing Keystore key, corrupt ciphertext, unknown version | No secret recovery through relay. Counters/format errors recorded without payload. | Drop unknown/bad messages; show local diagnostic count, re-pair/re-register if key lost. Never render attacker text as an error notification. |
| Notification permission/channel disabled, Doze, force-stop | Acceptance is not delivery; no ack claim. High priority only for user-visible messages [12]. | Show OS permission/channel action. FCM may delay/deprioritize; a force-stopped app may need reopening. Never promise urgent/alarm reliability. |
| Revoke during outage/send race | Local revoke wins, delete-only outbox retries, recheck session/registration immediately before send. | “Revoked; relay cleanup pending” where relevant. Known revoked routes cannot decrypt/display; already accepted unknown-to-phone revokes have the limitation above. |
| Relay kill switch / account disabled or deleted | 503 `relay_disabled`, 403 `account_disabled` or terminal 410 `account_deleted` for a valid route; no automatic new account/enrollment. Delete-only cleanup remains permitted. | “Push paused by relay operator” or “Relay account deleted”; clear local relay keys on confirmed deletion. Backend sign-in/web unaffected. |
| Sign-in cancelled, OAuth/signature misconfigured, no Google services | No backend account flow or password fallback. Existing backend sessions continue. | Stay push-off; explain cancellation vs operator setup error; offer email link when appropriate, not a promise FCM works without Google services. |
| Email delayed, expired/used link, wrong domain/device, email quota hit | Existing routes keep working until their normal limits/expiry. No backend credentials involved. | Allow deliberate resend after cooldown, email re-entry or validated paste-link recovery; never log link/code. At mail quota show retry/linked Google option. |
| Phone/route/account capacity or daily/global cap | Return scoped 409/429/503 and retry/reset; do not erase existing routes or reset counters. | Offer remove old phone/route at slot cap; at send cap show wait time; global enrollment capacity does not need operator approval. |
| ID token expired/revoked or Auth unavailable | Fail closed for management/external send Auth checks; bounded retries only for transient failures. | Refresh via SDK; ask to sign in again only for confirmed revocation. Preserve backend sessions; show account deletion/disable distinctly. |
| Account deletion/disable during outage | Durable account marker denies sends before cascade; out-of-band Auth change fails next uncached Auth check. | “Account deletion pending”; retry without pretending erasure completed. Other phones learn on reconnect; previously accepted messages cannot be recalled. |

Retries must re-run session-active and preference checks: a newly muted/disabled device must not drain an old outbox.
Dropping a notification does not erase the underlying project/task state. Test tools show registration, relay acceptance
and local decrypt result as different steps; optional phone diagnostics may report a test message ID over signed-in WSS,
not add read receipts/content to Firebase.

## 9. Web Push: independent keys, independent subscriptions

No relay or Firebase admin credential for web. Reuse server `loadOrCreateVapidKeys` on first start at
`<data>/notifications/vapid.json` (0600); installer need not implement a second generator. Persist through updates,
back up privately, fail on malformed existing keys rather than overwrite. `AIKI_VAPID_KEY_FILE` is an operator override,
`AIKI_VAPID_SUBJECT` should be that backend's public HTTPS app/contact URL or mailto contact, not the operator's identity.
Expose only public key in authenticated `notifications.config`. Use existing RFC 8291 content encryption for Web Push.

**Generation alone is insufficient.** PushManager has one subscription **per service-worker registration**, not per
browser profile globally [13]. Existing root subscription can only be authorized with its original applicationServerKey;
sharing it among unrelated backend keys cannot work. Design a push-only worker per backend with scope
`/push/<opaque-backend-id>/`, served by the same app origin (a script at `/push-worker.js` allows these narrower scopes).
Keep the root app-shell worker separate; push-only workers have no fetch/cache/clients.claim behavior. Store a map of
backend ID → registration/scope/public key/subscription. Permission is still origin-wide and requested from a user gesture.

Each worker caches only its own subscription metadata; received notifications use existing click routing to the root
app. Rework `pushsubscriptionchange` so it never picks the first backend key or registers a subscription with every
backend. Current worker reconnect is anonymous: it fails against required sign-in. Either integrate the existing
session-refresh/rotation lock and origin-pinned IndexedDB auth for that worker, or mark sync-needed and wait for a
signed-in page. Recommend the latter for v1, visibly stating that a changed subscription may need reopening the app;
never stash retained bearer tokens in Cache Storage or silently bypass auth.

On key change offer explicit re-subscribe for that backend only; don't unsubscribe unrelated scopes. Bound dormant
worker registrations and remove on backend deletion. Installer's backend-local HTTPS origin naturally isolates most
friends; these scopes also support several independent backends in a shared hosted UI. Test target browsers' registration
limits and push support; HTTP loopback UI does not make the browser push service or Tailscale backend universally
supported. Web Push is optional and should say why unavailable.

Migration keeps existing root shared-key subscription alive for the operator's legacy group until each backend is
switched. Atomic replacement of a backend's notification row avoids double sends; unsubscribe root only when no legacy
backend uses it. Never rotate all keys as an incidental upgrade. Known Brave failure: **“Registration failed - push
service error”** can mean **Use Google services for push messaging** is off in Brave Settings → Privacy and security [14].
Explain the setting and browser restart/retry; do not suggest changing server credentials first.

## 10. Operator's three-backend rollout (no planned notification gap)

Mirror device sign-in's additive deployment → inventory → explicit cutover, not a flag day. Device sign-in remains
required throughout; do not revert it to optional for push. Friends' releases remain push-off until relay pilot acceptance.

1. Ship additive server protocol/storage and Android code with relay selection **off**; retain direct FCM/old rows and
   VAPID files. Inventory per-backend phone session IDs and transport privately, without copying them into source.
   Operator may keep direct FCM indefinitely if explicitly chosen, but that retains broad credentials and lacks this
   relay's E2EE unless direct sends are upgraded too. Recommendation: use direct only as a rollback bridge.
2. Deploy relay separately with new enrollment globally paused during authorized staging. Configure Google OAuth,
   release fingerprints and Hosting App Links/email sender; test both sign-in methods on the signed sideloaded APK,
   account deletion, token challenge, encrypted delivery and invalid-token behavior using synthetic test accounts.
   Open enrollment to anyone under pilot caps only after acceptance; no per-user approval or special grants. No
   backend switches merely because a function exists. Stage key/route state without replacing active direct rows.
3. For one operator backend, register successor relay route/key, send a **test-only** relay message and verify local
   decryption/notification. Then transactionally change that session's active transport to relay. Each normal event has
   one active transport, not dual delivery. Pause/drain or migrate any existing direct retry entry at cutover; uncertain
   retries reuse event ID, and upgraded phone dedupes it. Hold/event dedupe state remains in place across restarts.
4. Observe one backend, then switch the other two independently with the same phone (three routes, three keys). Wait
   for offline phones to reconnect before retiring their legacy registrations/keys. Keep legacy parser only for explicit
   known direct-mode mappings; a relay-selected session cannot downgrade silently to plaintext.
5. During a bounded observation period keep direct credential files privately available for an **explicit** per-session
   rollback. Rollback preserves auth and pending events and changes only selected transport; no unattended retry fallthrough.
   New friends never get direct mode as a repair instruction. After all known phones/routes pass acceptance and a grace
   period covering their offline use, remove backend service-account copies and revoke the exported key in Firebase.
   Function runtime identity is independent of that key. Confirm other uses before key revocation.
6. Migrate web subscriptions separately; initially retain operator's working shared VAPID group. Test new independent
   scopes before changing rows, never overwrite an existing VAPID file. No phone reinstall, global credential wipe,
   simultaneous key revocation or replay of historical events.

This avoids a planned outage, not a guarantee of lossless push. FCM and crash windows are best effort; encrypted outbox
retries reduce losses after transport cutover. Direct legacy notifications still in flight may duplicate once or arrive
late without an event ID; disclose that bounded overlap, do not claim exactly-once migration.

## 11. Facts/actions needed from the operator before real Firebase use

Ask these privately. **No credentials, project identifiers, key files or local Firebase configuration were inspected
for this design.** Never paste answers containing identifiers/secrets into this document or public issue reports.

- Confirm which **existing project/app** serves the signed Android release and that its intended application ID/signing
  identity matches the APK. Have the operator supply non-secret client config to the private release build, not a
  service-account JSON. Are any legacy app variants still using the existing project?
- Is the project on **Blaze**, with an attached billing account, authorized billing owner and agreed alerts? If not,
  authorize the upgrade before function deployment. What other workloads consume free allowances? Approve a Functions
  service-scoped spend cap and its effect on other functions in the project; it is not a Firestore/project-wide cap.
- Does Firestore already exist; Standard edition/Native mode, database region and free-tier eligibility? Database
  location constrains choices. Confirm function region near Firestore and the friends, supported 2nd-gen runtime,
  applicable currency/rates and whether cross-region metadata transfer is acceptable. Do not create a second database
  just to assume another free allowance.
- Who deploys, with **which human Firebase/Google Cloud login or workload-identity CI principal**? Operator performs
  login privately. Agree least-privilege deployment/runtime IAM, required APIs (Functions/Cloud Run/Build/Artifact
  Registry, Firestore, FCM, Auth and optionally Play Integrity/App Check), and who can use the kill switch. Prefer ADC
  runtime credentials; no downloadable admin key for the function or any friend.
- Is Google Auth enabled, and is the **OAuth consent screen** configured for external production users with support/
  privacy details? Confirm Android OAuth client (package + release SHA-1) and Web OAuth client ID/audience; privately
  register release **SHA-1/SHA-256** and any planned signing rotation. Who owns ongoing consent/client maintenance?
- Which **email-link Hosting domain** and authorized continuation URL should the APK use? Recommend default Hosting
  domain, verified App Links/Digital Asset Links, current Auth SDK and no Dynamic Links. Confirm sender address/name,
  templates, quotas/deliverability and supported mail/browser return behavior; custom domain ownership if chosen.
- Is **Identity Platform** already enabled/needed? Confirm effective MAU/DAU, signup and mail-send quotas, other project
  MAUs, billing treatment, enumeration protection and provider shutdown controls. Recommend not upgrading just for
  this relay. Auth credentials never go to backends; operator confirms no password UI or password handling in Aiki.
- Is App Check enabled/enforced anywhere today? Does a Play Console/API linkage exist even though distribution is
  GitHub APKs? Operator registers the release signing certificate, chooses the documented outside-Play verdict policy
  and confirms acceptable phones. Approve monitored-first versus enforcement after the release-APK smoke test.
- Approve the initial 3-phone/24-route/2,000-send account budgets, 5,000/day global sends, 20 new relay accounts/day,
  100 active accounts, IP/challenge caps, lease defaults, cost alerts and attack shutdown owner. Accept residual Auth
  cost exposure from distributed signups. Agree privacy contact, Auth profile minimization, in-app deletion/retention,
  reconciliation schedule (recommend hourly), and who supports lost phones, disabled-account erasure and link failures.
- Which three backend sessions should migrate first, what is the tolerated observation period/offline grace, and when
  may the operator remove/revoke the old exported FCM key? Privately establish other uses before revocation.

## 12. Build order, scope and acceptance

Sizes are engineering days for someone familiar with this repo, not elapsed promises; include focused tests/docs,
exclude external OAuth publication/domain verification waits, independent security audit and release-signing work
already tracked elsewhere. Account sign-in/link return, deletion and open-signup abuse review increase the earlier
18–28-day estimate; route encryption and backend/web scope have not expanded.
No server or emulator was started for this writing task.

| Order / subtask | Size | Can be built/tested without the real project? |
| --- | ---: | --- |
| 1. Freeze protocol, threat model and cross-language crypto vectors | S: 1–2 days | Yes: synthetic route/session fixtures, exact encoding/size limits, AEAD/HKDF/confirmation vectors, replay/skew/restart tests. |
| 2. Relay function, Firestore account/installation storage/rules, quotas, account disable/delete cascade and reconciliation, status/kill switch | L: 5–7 days | Yes: Functions/Firestore/Auth emulators, injected FCM/Auth state/App Check fakes and clocks. Test cross-account ownership, slot reservations, cascades, Auth failures and transaction races. Firebase-supported runtime, Bun tooling; no other relay host. |
| 3. Protocol/client/server relay transport, encrypted retry/delete outboxes, session lifecycle | M: 3–4 days | Yes: fake relay HTTP and emulator function, temporary backend state; registration/revoke races, retries across restarts, legacy compatibility and no credentials in logs. |
| 4. Android Google Credential Manager/email-link Auth and App Links/paste recovery, phone inventory/sign-out/in-app deletion, secure crypto/route sync/decrypt/status | L: 6–9 days | Mostly: JVM tests, Auth emulator/fake intents and PushTokens/receiver. Provider OAuth, email delivery/link association, release certificate, Play services/attestation, FCM and Doze require authorized live tests; emulator success is not provider acceptance. |
| 5. Web independent VAPID/scoped workers, first-run persistence and legacy migration | M: 2–4 days | Yes: fake Web Push endpoint, browser tests for separate registrations, key mismatch/re-subscribe, required-auth reconnect and Brave guidance. Real browser push-service acceptance needs a consented smoke test. Can proceed after step 1 in parallel with relay work. |
| 6. Security/open-signup abuse/failure review and emulator harness | M: 3–4 days | Yes: integrate steps 2–5, including account churn, Auth-only signup exposure, limits/cascades and link redaction; then separately validate production IAM/logging/provider quotas. Start security cases with step 1. |
| 7. Authorized Firebase staging, operator's three-backend migration and open pilot docs | M: 2–3 days + observation | No: finish emulator gates; operator supplies facts/login/authorization. Staging starts with enrollment paused; verify both sign-in methods/deletion on real APK, then open within caps and cut over one backend at a time. |

Rough total **22–33 engineering days**, with web work independent and external configuration/waiting/observation
additional. This is design scope only, not a commitment to implement it in this task.
Do not represent the table as seven implementation tasks already completed.

### Emulator-first gate

Use a synthetic `demo-...` project and only local emulator endpoints, outbound network denied in the test process;
production startup must refuse emulator Auth/App Check bypass flags. Firebase's Emulator Suite covers Functions,
Firestore and Auth, **not end-to-end FCM or Play Integrity** [15]. Inject a fake sender that captures token/data and
returns FCM failures; inject attestation verification only in the test harness. Simulate delivery of the captured
challenge/envelope into the Android receiver. Firebase emulator success cannot prove real IAM, TLS, billing, scaling,
token possession through Google, attestation or background delivery.

Before any real-project action, automate:

- Missing/anonymous/unverified/wrong-project Auth cannot enroll; verified Google/email-link accounts enroll without
  approval within limits. Cross-account reads/management denied; two phones under one UID stay separately scoped.
  Concurrent last-slot enrollment has one winner; wrong UID/installation/challenge cannot activate, token thief cannot
  answer, replay cannot switch tokens, and expired reservations release slots. Linked providers keep one UID/quota.
- Account disable/deletion blocks sends before durable cascade; crashes/outages at every cleanup phase resume, erase
  dependent records/Auth, and never revive routes. Out-of-band Auth disable/delete blocks the next send and hourly
  reconciliation scrubs records. Sign-out/push off/current-phone removal preserve other phones; full account deletion
  removes all. Recent-auth, cancelled sign-in, revoked token, provider conflict and reinstallation recovery tested.
- Capability for A cannot send/manage B, choose a new token/project/topic/priority or renew itself. Send/delete schemes
  are not interchangeable. Direct Firestore client access denied; cross-account management denied. Corrupt
  envelope/oversize/reserved keys/version rejected before FCM; no content-bearing error or log output.
- ECDH invalid-point rejection, key substitution/transcript mismatch, AAD modification, tamper/truncation/wrong route,
  random nonce reuse prevention, counter persistence/restored-state rekey, replay/out-of-order windows and expiry/skew.
- Duplicate sends, lost replies, function crash around FCM acceptance, concurrent token rotation versus invalid-token
  response, create/confirm/revoke races and atomic active-transport replacement. No exactly-once assertion.
- Local revoke/expiry stops held and queued sends immediately; remote-delete outbox survives backend restart/outage;
  delete blocks later authorization; already-in-flight exception documented. A/B/C routes stay independent.
- Per-route/account/IP/global budgets survive concurrency/restart and route/phone churn; UID churn cannot bypass
  global or new-relay-account caps. Explicitly test that direct Auth signup bypasses our signup limiter, then exercise
  mocked provider shutdown/mail quota/MAU alarms, not a false global Auth cost guarantee. Test reserved rotation slots,
  deletion without quota, daily reset, NAT starvation, invalid-proof/storage growth and contention; meter actual ops.
- Signed-in registration ownership, anonymous optional-mode refusal for relay, old server/client negotiation, no silent
  plaintext fallback; new install/upgrade/reinstall/backup exclusion, offline token rotation, key invalidation and OS
  permission-off. Web key pairs persist; independent worker scopes don't unregister one another or lose legacy pushes.

Live acceptance after authorization is deliberately small: **release-signed sideloaded APK** with Google OAuth and
email-link cold/warm/cross-device mail return, App Links verification and paste recovery; no dependency on Play Store
installation. Verify redacted logs, name/photo minimization limits, several phones/reinstall at capacity, recent-auth
account deletion including another offline phone, disable/no revival and direct Auth deletion reconciliation. Then
FCM challenge, encrypted test, token rotation, background tap, outage/retry and three-backend independence. Verify
production IAM/rules/retention, effective Auth/mail quotas, limits and kill-switch/spend-cap/provider shutdown. No
open pilot until these checks pass; paused staging enrollment is an operational gate, not per-account approval.

## 13. Open decisions (recommended answer first)

D38/D47/D49 above are settled: no decision remains on accounts versus grants, either sign-in method, open access,
phone-only credentials, per-phone routes, E2EE, leases, gradual rollout or independent web VAPID. Remaining choices:

1. **Use the default Firebase Hosting link domain/sender initially; publish external Google OAuth consent for open use.**
   Operator supplies domain/continuation URL, sender/support/privacy details, OAuth clients and release fingerprints.
   Choose a custom branded domain/sender only if ownership/deliverability maintenance is accepted; prove return to the
   GitHub APK from target mail clients. No Dynamic Links or Play-only fallback.
2. **Do not enable Identity Platform just for this relay.** If already enabled or its abuse controls are needed, accept
   Tier-1 MAU exposure and project quotas explicitly; decide who monitors Auth-only growth and may disable signup/
   providers during an attack. No claim that relay signup limits or a Functions spend cap bound Auth billing.
3. **Start with 3 phones, 8 routes/phone (24/account), 2,000 account sends/day; 5,000 total sends/day, 100 challenges/day,
   20 new relay accounts/day and 100 active accounts.** Approve the IP/pending-rotation limits in section 6 and visible
   reset behavior. Raise to the explicit 1,000-account caps only after metering, not on demand from account creation.
4. **App Check monitored first, then outside-Play device-integrity enforcement after release-APK proof.** Confirm
   Play API linkage and acceptable devices/custom-ROM policy; unsupported push stays off without bypass.
5. **Store no profile outside Auth; target <=24-hour account cascade, hourly orphan reconciliation, seven-day
   configurable application logs.** Confirm provider-profile clearing limitations, actual platform log retention and
   privacy contact/disabled-account erasure support. No relay backups/PITR by default.
6. **2nd-gen function beside existing Firestore, ADC runtime; $5/$10 alerts and a $10 Functions spend cap initially.**
   Operator confirms region/database/billing fit and cap impact on other functions; Auth/Firestore are excluded and
   enforcement may overshoot. Pick an incident owner with provider and relay shutdown access.
7. **Observe the first of the operator's three backends before switching the others; keep direct FCM only as a bounded
   explicit rollback bridge.** Choose first backend and offline grace (recommend at least seven days plus known offline
   phones) before revoking the legacy key. Web subscription-change v1 waits for a signed-in page; preserve legacy scopes
   until migrated. These are rollout parameters, not reconsideration of the approved architecture.

## Official sources

Current official pages consulted for this design; pricing/quotas must be rechecked for the selected region at deployment.

[1]: https://firebase.google.com/docs/app-check/android/play-integrity-provider
[2]: https://firebase.google.com/docs/app-check/custom-resource-backend
[3]: https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type
[4]: https://firebase.google.com/docs/cloud-messaging/error-codes
[5]: https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan
[6]: https://firebase.google.com/docs/projects/billing/avoid-surprise-bills
[7]: https://firebase.google.com/pricing
[8]: https://cloud.google.com/run/pricing
[9]: https://firebase.google.com/docs/firestore/pricing
[10]: https://cloud.google.com/firestore/pricing
[11]: https://firebase.google.com/docs/auth/limits
[12]: https://firebase.google.com/docs/cloud-messaging/android-message-priority
[13]: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/pushManager
[14]: https://support.brave.app/hc/en-us/articles/360017989132-How-do-I-change-my-Privacy-Settings
[15]: https://firebase.google.com/docs/emulator-suite
[16]: https://firebase.google.com/docs/projects/billing/spend-caps
[17]: https://firebase.google.com/docs/auth/android/google-signin
[18]: https://developer.android.com/identity/sign-in/credential-manager-siwg
[19]: https://firebase.google.com/docs/auth/android/email-link-auth
[20]: https://firebase.google.com/docs/auth/android/email-link-migration
[21]: https://cloud.google.com/identity-platform/quotas
[22]: https://firebase.google.com/docs/auth/android/manage-users
[23]: https://firebase.google.com/docs/auth/admin/manage-sessions
[24]: https://cloud.google.com/identity-platform/pricing
[25]: https://cloud.google.com/identity-platform/docs/admin/email-enumeration-protection
