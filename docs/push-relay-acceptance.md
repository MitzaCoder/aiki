# Push relay acceptance

This is the section 12 gate, not permission to deploy or open a pilot. D51 keeps relay accounts and relay push
optional. No real Firebase/Google Cloud project, phone, Android emulator or credentials were used for T99.

Summary: **76 locally proven**, **24 need the real project**, **3 open** (103 single items).
“Proven” means the bounded assertion described below, not provider acceptance. Android JVM and web evidence is
linked existing coverage, not an Android/browser run performed by this worker.

## Evidence key

- **E**: `relay/checks/e2e/integration.cases.ts`, real Functions HTTP + real isolated Aiki backends + TypeScript phone.
- **R.name**: `relay/checks/name.cases.ts`, existing relay emulator checks. Many inject the core clock/failure seam;
  only R.http and E exercise the Functions HTTP adapter. Do not describe every R test as a real function crash test.
- **S registration/transport/lifecycle/retention**: `packages/server/test/push-relay-<name>.test.ts`.
- **P**: `packages/protocol/src/push-relay.test.ts`, frozen shared crypto/admission vectors and randomized crypto.
- **A.Class.method**: existing `apps/android/app/src/test/kotlin/io/github/mitzacoder/aiki/notifications/Relay*Test.kt`.

## Section 12 checklist

| Acceptance item | Status | Evidence or remaining reason |
| --- | --- | --- |
| Loopback-only demo project and outbound denial | Proven | R.startup, R.router; E all, including network-namespace run |
| Production refuses emulator Auth/App Check bypasses | Proven | R.startup: production refuses every emulator/bypass flag |
| Real function, Auth and Firestore wiring with captured fake FCM | Proven | E all; R.http: real Admin Auth/Firestore wiring |
| Missing, anonymous, unverified and wrong-project Auth cannot enroll | Proven | R.admission: missing, anonymous, custom, unverified, wrong-project and revoked credentials |
| Verified Google enrollment without approval within limits | Proven | E three backends; R.admission: verified email-link and Google |
| Verified email-link enrollment without approval within limits | Proven | E happy path; R.admission: verified email-link and Google |
| Cross-account reads and management denied | Proven | R.installations: cross-account management denied |
| Two phones under one UID remain separate | Proven | R.installations; R.lifecycle: one-phone disable and sign-out |
| Concurrent last enrollment slot has one winner | Proven | R.enrollment: concurrent last phone slot |
| Wrong UID, installation or challenge cannot activate | Proven | R.enrollment: wrong UID, installation and challenge |
| A token thief cannot answer the possession challenge | Proven | R.enrollment: knowing token cannot answer |
| Challenge replay cannot switch tokens | Proven | R.enrollment: token replacement is atomic, old confirm cannot revert it |
| Expired enrollment reservations release slots | Proven | R.enrollment: concurrent last phone slot; R.budgets: global account and phone capacity |
| Linked providers preserve UID and quota | Proven | R.lifecycle: linked Google/email providers share one UID |
| Account disable blocks sends before cascade | Proven | E account disabled; R.lifecycle: cleanup resumes after a crash at phase |
| Account deletion blocks sends before cascade | Proven | E account deleted; R.lifecycle: cleanup resumes after a crash at phase |
| Every cleanup phase resumes after crashes and outages | Proven | R.lifecycle: ten cleanup phases, disable and delete |
| Cleanup erases dependent records and Auth without revival | Proven | R.lifecycle: cleanup phases; E account disabled/deleted |
| Out-of-band Auth disable/delete stops the next send | Proven | R.admission: Auth disable/delete outside relay; R.lifecycle: out-of-band Auth disable/delete |
| Hourly reconciliation scrubs out-of-band Auth changes | Proven | R.lifecycle: out-of-band Auth disable/delete and reconciliation resumes unfinished deletion (injected clock) |
| Sign-out preserves other phones | Proven | R.lifecycle: one-phone disable and sign-out; A.RelayRoutesTest.localDeleteAndSignOutAreImmediateAndRevocationQueueSurvivesOffline |
| Push off preserves other phones | Proven | R.lifecycle: one-phone disable and sign-out; A.RelayRoutesTest.explicitOffOnReusesInstallationWithoutConsumingAnotherPhoneSlot |
| Current-phone removal preserves other phones | Proven | R.installations; R.lifecycle: one-phone disable and sign-out |
| Full account deletion removes all phones | Proven | R.lifecycle: cleanup phases with two phones; A.RelayAccountsTest.pendingDeletionErasesKeysBeforeHttpAndReusesOperationAcrossRestart |
| Recent authentication required for deletion | Proven | R.lifecycle: account deletion requires recent revoked-checked authentication; A.RelayAccountsTest.recentAuthRequiredRetainsDeletionOperationForLaterReauthentication |
| Revoked ID tokens fail closed | Proven | R.admission: missing, anonymous, custom, unverified, wrong-project and revoked credentials |
| Cancelled provider sign-in | Needs the real project | No provider sign-in UI in this TypeScript phone; test the release APK cancellation flow |
| Provider conflict handling | Needs the real project | Auth emulator linking is not Credential Manager/provider conflict recovery in the release APK |
| Reinstallation recovery | Needs the real project | JVM key-loss tests do not prove reinstall, OS storage erasure or account slot recovery |
| Capability A cannot send to or manage B | Proven | E three backends; R.routes: capability A cannot send B or manage routes |
| Capability cannot choose token/project/topic/priority | Proven | R.routes: capability A cannot choose token/project/topic/priority |
| Backend cannot renew or recreate deleted authority | Proven | E three backends; R.routes: renew only under seven days; R.delete |
| Send and delete schemes are disjoint | Proven | R.routes: disjoint schemes; R.delete: delete scheme is rejected before any Firestore lookup |
| Direct Firestore client reads and writes denied | Proven | R.installations: direct client Firestore reads and writes denied |
| Corrupt/reserved/version envelopes rejected before FCM | Proven | R.send: corrupt, reserved keys, wrong version/route and noncanonical base64 |
| Oversize envelopes rejected before FCM | Proven | R.send: serialized data cap and HTTP body cap |
| Errors/logs contain no notification content or identity | Proven | R.send: full flow logs; R.http: octet-stream JSON-looking client bytes; R.lifecycle: operator settings and lifecycle logs |
| ECDH invalid points rejected | Proven | P shared negatives; A.RelayCryptoTest rejectsWithExpectedCode |
| Key substitution and transcript mismatch rejected | Proven | P shared negatives; S registration: wrong confirmation and substituted transcript; A.RelayBackendAdapterTest.wrongHmacIdentityAndOldServerAbortWithoutActivationOrPlaintextFallback |
| AAD modification rejected | Proven | P shared negatives; A.RelayCryptoTest rejectsWithExpectedCode |
| Tamper and truncation rejected | Proven | E phone drops replay/tamper; P shared negatives |
| Wrong-route envelope rejected | Proven | E phone drops replay/tamper; A.RelayMessageRouterTest.tamperWrongRouteWrongSessionVersionAndUnknownRouteNeverDisplay |
| Fresh random nonces and message IDs | Proven | P random key agreements and production encryptions use fresh nonces and message IDs |
| Durable counter persistence across restart | Proven | S transport: pending exact envelope survives restart; S registration: counter rollback against independent witness |
| Restored/invalid key state requires rekey | Proven | S registration: counter rollback; A.RelayStoreTest.missingKeyDiscardsAuthorityAndRequiresExplicitEnable |
| Replay and out-of-order window | Proven | E phone drops replay/tamper; P shared replay vectors; A.RelayMessageRouterTest.replayAndCrossKeyDuplicateNeverDisplayButReorderingInsideWindowDoes |
| Expiry, skew and clock trust | Proven | E phone drops expired; P shared expiry vectors; A.RelayStoreTest.clockRejectsRebootBackwardsAndExcessiveUncertainty |
| Duplicate send result reuse | Proven | E lost reply; R.send: duplicate sends and lost HTTP reply reuse result |
| Lost replies display at most once on the simulated phone | Proven | E lost reply retries identical bytes; A.RelayMessageRouterTest.replayAndCrossKeyDuplicateNeverDisplayButReorderingInsideWindowDoes |
| Function crash around FCM acceptance | Proven | R.send: crash after FCM acceptance and timeout lease retry same envelope (core crash seam, not an OS kill) |
| Concurrent token rotation versus invalid-token result | Proven | R.send: UNREGISTERED purges only sent token generation |
| Create/confirm/revoke races | Proven | R.enrollment: delete racing confirm or creation; R.delete; S lifecycle: unregister blocks sends before a slow local write |
| Atomic active-transport replacement | Proven | E successor route; S registration: direct-to-relay switch and successor rotation; S lifecycle: concurrent explicit direct selection and relay confirmation |
| No exactly-once transport/display promise | Proven | E duplicate admission; R.send: crash around acceptance; documented in protocol/backend contracts |
| Local revoke stops held and queued sends immediately | Proven | E revoke/unregister; S transport: queued sends obey new mutes, quiet hours, disabled kinds and revoke |
| Local expiry stops held and queued sends | Proven | S lifecycle: lease expiry cancels queued retries; S transport: 100-message cap and twelve-hour lifetime |
| Delete outbox survives outage and backend restart | Proven | E revoke during outage; S transport: revoke during outage; S retention |
| Remote delete blocks later authorization | Proven | E three backends; R.delete |
| Already-in-flight revoke exception documented | Proven | Backend contract and design section 4; E known-removed route drops accepted message; R.delete race tests |
| A/B/C routes and keys remain independent | Proven | E three backends keep independent routes and capabilities |
| Per-route/account/IP/global budgets survive concurrency and restart | Proven | R.budgets: transactional send ceilings; E route/account send limit |
| Budgets survive route/phone churn | Proven | R.budgets: account sends persist across route rotation and phone removal; IP/NAT and global daily scopes |
| UID churn cannot bypass global/new-account caps | Proven | R.budgets: new-account caps do not refund after deletion; global daily sends and new-account budgets |
| Direct Auth signup bypasses the relay signup limiter | Proven | R.budgets: direct Auth signup bypasses relay signup caps |
| Mocked provider shutdown | Not covered | No provider shutdown integration exists here; relay kill-switch tests are not a provider shutdown drill |
| Mocked mail-quota alarms | Not covered | No mail-quota alarm adapter exists; emulator email links bypass real mail limits |
| Mocked MAU alarms | Not covered | No MAU/billing alarm adapter exists; relay account caps cannot bound direct Auth use |
| Reserved rotation slots | Proven | R.routes: one bounded successor atomically replaces predecessor; R.budgets account sends persist across rotation |
| Deletion succeeds with quotas exhausted | Proven | R.budgets: management request budgets are IP-scoped, while deletion is exempt |
| Daily budget reset | Proven | R.budgets: IP/NAT and global daily scopes; management/NAT minute and daily windows |
| NAT starvation is bounded and visible | Proven | R.budgets: IP/NAT scopes and management/NAT windows; does not promise fairness |
| Invalid-proof floods and storage growth bounded | Proven | R.budgets: invalid-proof floods share one bounded IP bucket |
| Contention and actual SDK operation metering | Proven | R.budgets: transactional ceilings; R.metering: actual SDK reads and committed writes/deletes |
| Signed-in registration belongs to its session | Proven | S registration: wrong confirmation and substituted transcript; E anonymous optional mode |
| Anonymous optional-mode relay refusal | Proven | E anonymous optional mode; S registration: registration requires sign-in even in optional mode |
| Old server/client negotiation | Proven | S registration: no relay setting; A.RelayBackendAdapterTest.featureMissingAnonymousAndOffNeverSendBackendRelayRpc |
| No silent direct-FCM or plaintext fallback | Proven | E anonymous optional mode (relay outage retains encrypted queue); S registration: direct-to-relay switch; A.RelayMessageRouterTest.plaintextDowngradeIsBlockedOnlyForLocallySelectedBackend |
| Fresh install/upgrade stays relay-off without account/file access | Proven | A.RelayMessageRouterTest.offAndUpgradedSettingsNeverOpenRelayFileAccountClientOrBackend |
| Backup/transfer exclusion works on Android | Needs the real project | Backup XML and JVM storage tests are not OS backup/restore proof; use consented release-device run |
| Offline token rotation | Proven | A.RelayEnrollmentTest.enrollmentAndTokenReplacementUseOneInstallationAcrossDuplicateCallbacks; confirmNonceIsDurableAndResumesWithoutSecondChallenge; E UNREGISTERED repair |
| Key invalidation never downgrades | Proven | A.RelayStoreTest.missingKeyDiscardsAuthorityAndRequiresExplicitEnable; A.RelayMessageRouterTest.invalidatedStoreDoesNotDowngradeCurrentMessage |
| OS notification permission off | Needs the real project | No phone/Android emulator used; JVM protocol checks cannot prove OS permission behavior |
| Web key pairs persist | Proven | S web-push tests: key persistence; no relay enrollment is required |
| Independent web worker scopes preserve legacy pushes | Proven | Existing web notification/worker tests and T98 browser recipe in docs/CONTINUE.md; not rerun by T99 |
| Release-signed sideload Google OAuth without Play installation | Needs the real project | Fake Google Auth is not OAuth consent, SHA fingerprints, audience or Credential Manager acceptance |
| Email-link cold/warm mail return | Needs the real project | Emulator OOB-code capture is not Android mail/browser launch routing |
| Email-link cross-device return | Needs the real project | Requires actual mail and release APK on consented devices |
| App Links verification and paste recovery | Needs the real project | Requires hosted association, release certificate and app UI |
| Redacted production/provider logs | Needs the real project | Only relay-authored/core/framework emulator logs checked; provider retention differs |
| Auth name/photo minimization limits | Needs the real project | R.admission covers no Firestore profile copying, not production linked-provider retained profile |
| Several real phones/reinstall at capacity | Needs the real project | Synthetic installations cover quotas, not Google tokens/OS reinstall |
| Recent-auth account deletion including an offline real phone | Needs the real project | Relay/JVM cascade proven locally; release UI/provider/remote offline storage remain |
| Production disable/no revival and direct Auth deletion reconciliation | Needs the real project | Emulator state machines pass; scheduled job IAM/deployment are not exercised |
| Real FCM possession challenge and encrypted test push | Needs the real project | Firebase has no FCM emulator; fake acceptance cannot prove Google delivery |
| Real FCM token rotation | Needs the real project | Synthetic token replacement is not SDK/provider token churn |
| Background delivery and notification tap | Needs the real project | No phone, OS service, Doze, channels or deep-link UI exercised |
| Real outage/retry and three-backend independence | Needs the real project | E proves the local composition only, not TLS/Google transport/background behavior |
| Production IAM, rules and retention | Needs the real project | Deny-all emulator rules pass; IAM, TTL lag and deployed reconciler must be verified separately |
| Effective Auth/mail quotas | Needs the real project | Provider quotas are outside relay enforcement |
| Production limits, kill-switch and spend cap | Needs the real project | Local switch/budgets pass; billing alerts cannot stop spend by themselves |
| Provider shutdown drill | Needs the real project | Requires authorized operator action; no live project action is permitted in this task |
| App Check/Play Integrity for the sideloaded release | Needs the real project | Injected verification only; emulator cannot attest a device |
| Production TLS, billing and scaling | Needs the real project | Functions emulator cannot establish provider operational acceptance |

## Verification recorded for T99

| Check | Result | Time |
| --- | --- | --- |
| Root Bun tests | 2,136 tests, 24,467 assertions, no failures; no relay cases discovered | 197.38s test / 197.77s command |
| Root typecheck | Pass | 1.21s |
| Relay typecheck + build + format | Pass online; pass in network namespace | 5.05s online; 5.23s offline standalone run |
| Existing relay emulator suite | 84 tests, 1,275 assertions online and offline | 48.13s / 48.92s tests; 61.67s / 72.12s commands |
| End-to-end emulator suite | 19 tests, 256 assertions online and offline | 16.61s / 17.09s tests; 30.15s online command |
| Offline static checks + end-to-end combined | All pass in one network namespace | 45.87s command |
| Web check + tests + build | Zero errors/warnings; 918 tests, 13,722 assertions; build passes | 2.60s tests; 32.20s combined command |
| Generated Android protocol check | 337 DTOs, 91 request overloads match | 0.10s |
| Public-source check | Pass | Recorded in task results |

No protocol/client source changed, so Android build/JVM suites were not rerun. Existing JVM coverage above is explicitly
referenced, not newly executed. Initial existing-suite online attempts exposed the nested port/default issue and
metadata-detection delay; the final online and offline suites pass after those fixes. No root flaky test needed a retry.
No processes or listeners belonging to this task remain. No main move, push, deploy or live project action.

## Running the end-to-end gate

Install at the repository root first. Then in `relay/`: `bun install --frozen-lockfile`, `bun run emulator:setup`,
`bun run build`, `bun run test:e2e`. The last script fixes the isolated T99 ports to 19471–19477 and delegates to the
scrubbed emulator launcher. For outbound-denied proof use
`unshare -Urn sh -c 'ip link set lo up && bun run test:e2e'` from `relay/`.
Only the launcher starts Firebase. Its isolated environment propagates all port overrides to nested operator checks
and disables cloud metadata probing. The explicit enabled control document supports both old and paused-by-default
relay controls. Every backend is created by `createSetup` through the existing device-auth test helper.

The phone signs in via emulator email links/fake Google, answers captured FCM challenges, creates a pending route,
verifies the backend confirmation, activates at the relay, then confirms at the backend. A loopback fault gate records
and forwards real HTTP; it never substitutes a successful send. Replay/event admission uses the shared protocol.
No Android UI/receiver/notification display is claimed: “display once” means one successful TypeScript admission.
Real routing consumption is asserted on the decrypted payload; Android local routing override has its JVM tests.

Tests advance the backend scheduler explicitly. The FCM 429/5xx scenario advances the persisted emulator retry deadline
to avoid a wall-clock minute per failure; it does not replace function sending or alter original reservation/TTL.
Rotation tests share the phone admission state and assert cross-key event dedupe directly on that state.
Operator-disable uses the durable cleanup marker before cascade, then the real cleanup/enable functions on emulator
ports. Completed account deletion erases routes: a backend then sees generic 404 `not_found`, not `account_deleted`.
This is deliberate non-enumeration, not proof that the backend can distinguish deletion from an unknown route.

## Boundary fixes

- The backend previously ignored string `error` fields, losing `account_disabled` pause and named 410 reasons. It now
  accepts the real `{error:"code"}` failure and `{state,code}` success shapes. The fake matches those exact shapes.
- Known 429 scopes and 503 operator/FCM codes survive into `lastDelivery`; unknown codes stay sanitized. All README
  statuses/codes are audited by parameterized server tests, including Retry-After seconds/date, pause and deletion.
- Cleanup's absolute-expiry +24h deadline erases local delete authority; it is not a guarantee that eventual Firestore
  TTL/reconciliation has physically removed every record.
- Nested operator tests previously lost port overrides, and online Admin SDK startup could probe cloud metadata.
  The scrubbed launcher now propagates all overrides; both scrubbed launchers disable metadata detection. The operator
  subprocess check has a bound longer than its own child timeout instead of Bun's five-second default.
- Cross-package integration checks need DOM/Bun types and the root TypeScript compiler (the server uses TypeScript 7
  inference); relay build still uses its pinned TypeScript 5.9 compiler and unchanged runtime dependency tree.

The three open items are mocked provider shutdown/mail-quota/MAU alarm adapters. They are not implemented provider
integrations and cannot honestly be replaced by tests of our relay kill switch. The operator must choose and authorize
that operational work before the complete pre-project gate can be called closed. No frozen format or HTTP contract changed.
