# Android session-expiry investigation

## Fix after investigation

Android now preserves retained credentials on access rejection, including socket 4401 and equivalent HTTP failures.
Each reconnect waits for backoff, discovers the backend and refreshes the retained credential once before opening a
new socket. Repeated short-lived successful hellos do not reset backoff, so a server repeatedly rejecting access cannot
create a tight refresh loop. Transient refresh/storage failures stay in the normal reconnecting state.

Only structured `auth_invalid`/`auth_expired` HTTP 401 or `auth_revoked` HTTP 403 **from the retained refresh/rotation
exchange** permanently clears the credential. A bare 401, discovery rejection or Host 403 cannot establish retained
credential invalidity. Explicit session-revocation events and user sign-out still clear it. Server codes already provide
the distinction when interpreted with the exchange context; no server/protocol change was necessary.

Unreadable ciphertext now throws a sanitized storage error instead of synthesizing a signed-out record. Ordinary writes
first check that any existing record is readable. Automatic Keystore lookup never deletes/replaces an invalidated or
unavailable key, and decryption never creates a missing key. Original records remain for retry.

An explicit **Pair and add backend** action can recover a key reported permanently invalidated/unrecoverable. Automatic
prepare/reconnect/pending-proof recovery cannot. Before replacing the shared alias, the store durably prefixes affected
ciphertexts with a permanent-key-loss marker, preserving their bytes and auth pins. It replaces only the explicitly
paired origin with a fresh auth record, then stages the new pairing proof normally. Other backends retain their marked
records and can be paired separately even after the replacement key is healthy. An interrupted reset remains explicitly
retryable; ordinary new-origin writes cannot implicitly create a key in that state. Temporary key/storage failure or
ordinary ciphertext corruption does not authorize a reset, even during pairing. This closes the permanent-key trap
found in review; a regression reproduced the failed explicit enrollment before this amendment.

Tests first: five of the initial six recovery tests failed on the old implementation; all pass after the fix. Eight new
permanent tests cover successful recovery, transient retry, three definitive rejection codes, bare/Host HTTP errors,
discovery-context rejection, repeated-close backoff, storage-read failure and retry, and unreadable ciphertext. The full
Android run initially had 640 tests, two existing skips, zero failures/errors; assembly and lint passed. Review added
four permanent-key recovery tests covering both invalidation exception types, multiple origins, interrupted recovery,
and refusal to reset for temporary errors/corruption. The amended full Android run passes 644 tests with two existing
skips, zero failures/errors, assembly and lint (36 warnings, zero errors). Track-w emulator before/after
screenshots and short recordings show the old build losing its session after a 16-minute synthetic server-clock advance,
then the fixed build reconnecting automatically after the same access expiry. The demo used fresh temporary data/config
through `createSetup` and was stopped afterward. No real device or live backend was changed.

Web recovery is a follow-up: the shared TypeScript transport marks 4401 fatal, while the browser renewal controller
also stops on auth HTTP 401/403. Fixing this requires coordinated transport/prepare-error and renewal-controller tests,
not just changing one close handler. Its retained IndexedDB credential still survives for reload; no web code changed.

## Why this surfaced now remains unknown

Android normally renews one minute before the 15-minute access expiry. Suspension or a failed/delayed renewal can miss
that opportunity and the server's additional 60-second grace. This pre-existing bug then made an otherwise recoverable
access expiry permanent. The code alone does not establish whether that happened in the incident.

Access tokens exist only in memory: a clean app launch after an APK replacement reads the retained token and performs
a new refresh, not reuse of an old persisted access token. An ordinary backend restart also reconnects through refresh;
deploy drain holds tool calls, not auth refresh. Therefore neither replacement nor the repeated deploys by themselves
prove the trigger. The phone's request/close evidence remains unavailable; do not claim today's timing is explained.

## Original investigation: confirmed mechanism, unconfirmed incident trigger

The original Android transport treated access-token rejection as permanent device sign-out and could discard a valid
retained session. The initial investigation reproduced that path without changing runtime behavior. The subsequent fix
above addresses the bug independently of the still-unconfirmed incident trigger. Live observations belong in the task's
private evidence, not this public document. The sections below describe the original behavior.

### Storage and updates

`apps/android/app/src/main/kotlin/io/github/mitzacoder/aiki/data/DeviceAuthStore.kt` stores one encrypted JSON record
per canonical backend origin in the `aiki-device-auth` preferences DataStore. AES-256-GCM uses the origin as authenticated
additional data and the Android Keystore alias `aiki-device-auth-aes-v1`. Access tokens are memory-only. The retained
session, rotation successor and pending claim proof are encrypted together. This is not EncryptedSharedPreferences.

Neither the DataStore name nor key alias depends on version code, build certificate or private preference-prefix
settings. The key has no user-authentication/biometric requirement. Invalidated/unrecoverable keys are recreated;
decryption failures retain the auth-support pin but return **Pair this backend**, not **Session expired**. An OS/key
failure still needs device evidence to exclude it conclusively.

`apps/android/scripts/build.sh` defaults `ANDROID_USER_HOME` to a shared cache outside the checkout. Gradle uses its
default debug signing configuration; private Android properties configure identity, preferences, app origin and Firebase,
not a signing key. Fresh workspaces therefore need not create new signing identities. Successful `adb install -r` without
uninstall/data removal already establishes that Android accepted the update's signing identity.

### Server semantics

`packages/server/src/device-auth.ts` persists backend identity, retained token hashes, access token hashes and sessions
in `auth.sqlite` under the resolved backend data directory. Hashes are plain SHA-256 over the full token, not derived
from an environment secret. `auth.delivery-key` protects temporary claim delivery, not retained-token authentication.
The same refresh, expiry and revocation code applies to web and Android; `platform` is metadata. Push registration binds
the notification row to a session; it does not shorten or rotate that session.

Retained sessions expire after 180 idle days or 365 absolute days. Access tokens expire after 15 minutes. Socket renewal
has a 60-second grace, after which `server.ts`'s auth timer or `ClientConnection.#authorized` closes with 4401/
`auth_expired`, even when the retained session remains valid. The existing integration test **the access renewal grace
ends at sixty seconds and refresh cannot revive the old socket** proves that the retained bearer still refreshes and
opens a new authenticated socket after this close. The server timer also touches a live socket's last-used time;
a recent device-list last-seen value is not proof of a fresh request or successful client renewal.

The installer entry-point refactor between the required-mode rollout and the compact-task-row builds preserves
`loadServerEnv` before importing server state and uses the same `resolveDataDir`. It does not change token hashing,
Android storage, signing, origin normalization or push binding. Its optional static-web Host restriction is conditional
on `AIKI_WEB_DIR`; it is not a new Android-only auth rule.

### Destructive client classification

In `HarnessClient.kt`:

- Any socket close **4401**, regardless of reason, becomes `ClientException("auth_expired", "Session expired")`.
- `auth_required`, `auth_invalid`, `auth_expired`, `auth_revoked`, and **any auth HTTP 401 or 403** call
  `DeviceAuth.signedOut`. Downgrade, changed identity and unsupported auth version instead block while preserving storage.
- `signedOut` replaces the encrypted record with only the backend ID and notice. It drops the retained token, rotation
  successor and pending proof, and stops reconnecting. There is no retained-token refresh attempt after a 4401 close.
- An HTTP 403 `forbidden_host` is wrongly treated as revocation too, although its notice is **This device was signed out**,
  not **Session expired**. Invalid bearer 401 and actual retained-session expiry share the expiry notice.

Isolated MockWebServer diagnostics verified both paths: after an otherwise successful discovery, refresh and hello,
4401/`auth_expired` leaves no retained credential and makes no further refresh request; discovery 403/`forbidden_host`
also destroys a pre-existing credential. These diagnostics assert the current bug, not a desired regression contract,
and are retained as task artifacts rather than added to the permanent suite.

Network failures, restart disconnects, 429, 5xx and timeouts alone take the reconnect path and do not clear storage.
Deploy drain holds tool calls, not authentication refresh. An expired artifact URL alone is not a device sign-out;
an RPC made to remint it can still encounter an already-expired socket. A delayed Android renewal after suspension
could reach the destructive close path, but suspension, clock changes or renewal timing cannot be established from
source or server inventory alone.

Web transport also stops on 4401, but does not delete its IndexedDB retained credential in that close handler. A reload
can therefore recover where Android may already have made its loss permanent. Other Android devices running this code
are exposed to the same path, independently of APK replacement or deployment.

## Evidence needed and recovery

The fix does not recover credentials already deleted by the old build; those devices still need pairing.
A conclusive incident diagnosis needs the app process's auth logcat around the transition, especially whether discovery,
refresh, renewal or socket closure failed and the exact response/close code. Android currently has no explicit
credential-deletion audit; ordinary logcat may not contain enough detail. An unavailable phone prevents distinguishing
access expiry from invalid-token rejection or a storage failure. Do not infer a specific trigger solely from the notice.

Recovery: on each affected backend, use a signed-in browser's **Settings → backend → Devices** to create a pairing link,
open it on Android, and approve the matching comparison code. If no browser works, the backend OS owner can issue
`auth pair --backend <approved-origin> --web-app <trusted-app-origin>` against that backend's explicit configuration.
The owner CLI is local control, not an anonymous network bypass. Pairing creates a new device session; it does not remove
projects, threads, tasks, artifacts or local drafts. The old server session may remain listed and can be revoked by the
owner after verifying the replacement works. Never clear app data or delete backend auth state to recover.
