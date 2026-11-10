# Push relay: operator checklist

Nothing below authorizes access to the real project. First send the facts in section 3 privately.
Then agree to a specific staging plan before changing anything. Stop at any item marked **not built yet**.

This is a public file. Keep identifiers and answers privately, never in this file, commits or public reports.
Use private operator notes under ignored `deploy/local/`. Keep client config outside the checkout and build values
in private Android properties. Never send credentials, config files, signing material or sign-in links to the agent.

## 1. Where things stand

Built: encrypted notification libraries, relay enrollment/challenges, routes, limits, switches, account cleanup and
hourly reconciliation. Relay tests use Auth/Firestore/Functions emulators and fake FCM. Backend transport/retry/delete
outboxes and optional Android storage/receive/registration plumbing have fake-service tests. Relay is off by default.

Not proven: real Google/email sign-in, email delivery, App Links, FCM/background delivery, runtime IAM, billing,
App Check or production ingress. Android sign-in/account screens and their build settings are **not built yet**
on this baseline. Production deploy/admin tooling is **not built yet**. The relay README also records an unresolved
credential-digest mismatch; the agent must reconcile it with the frozen format before integration. Do not deploy yet.

References: [design](research/push-relay-design.md), [relay package](../relay/README.md),
[encrypted format](push-relay-v1.md), [backend contract](push-relay-backend-v1.md),
[Android setup](../apps/android/README.md).

## 2. Already decided

These are settled. They are not questions to answer again.

- [x] One 2nd-gen HTTPS Cloud Function and Firestore in the existing Firebase project. Use runtime credentials;
  export no admin key. The built hourly reconciliation export also needs a reviewed scheduled deployment.
- [x] Thin Firebase Auth accounts. Google sign-in or email link. Only the phone signs in. Open to anyone within limits.
- [x] Accounts and relay notifications are optional. Ask for an account only when enabling relay notifications.
  Ordinary app use and backend sign-in need no relay account. Web push needs no relay.
- [x] Three phones/account, eight routes/phone, 24 routes/account; 2,000 notifications/account/day,
  5,000 total/day, 20 new relay accounts/day, 100 active relay accounts. Keep the built IP/challenge/route limits.
  Minute/hour limits use fixed UTC clock windows, not rolling windows.
- [x] Email links use Firebase's default Hosting domain and sender. No custom mail service or Dynamic Links.
- [x] Do not upgrade to Identity Platform for this relay. Establish whether it is already enabled.
- [x] App Check monitored first. Any later enforcement needs a separate release-APK check for sideloaded phones.
- [x] Store only the Auth identity, not an application profile. Required relay tokens/routes/counters still exist.
  In-app account deletion, hourly repair, target account cleanup within 24 hours, seven-day configurable app logs.
  Google provider records may retain name/photo inside Auth until unlink/deletion. No relay backups/PITR by default.
- [x] Billing alerts at $5 and $10, and a $10 Functions spend cap. Alerts are not a stop button.
- [x] Migrate the operator's three backends separately. Observe the first for one week before the next.
  Keep direct FCM only as a private, explicit rollback bridge during the agreed offline grace period.

## 3. Facts to send back

Reply once, numbered. Status answers need no secrets. For identifying values, say “kept privately” and put the value
in private operator notes under ignored `deploy/local/`, or the private build properties named below. Do not attach
config files, keys, fingerprints, account emails or console screenshots containing them.

1. [ ] Which existing Firebase project and Android app does the signed release use? Do any older app variants still
   use it? Why: avoid deploying to the wrong project or breaking another APK. Typical answer: “Existing release
   project/app confirmed; one older variant also uses it; identifiers kept privately in operator notes.”
2. [ ] Is Blaze active with an attached billing account? Who can approve billing changes, and what else runs in the
   project? Why: deployment needs billing; free allowances and the Functions cap are shared. Typical answer:
   “Blaze active; I can approve billing; another function and database workload share it.” Keep billing identities privately.
3. [ ] Does Firestore exist? What are its edition, mode and region, and is its free allowance already used? Which
   function region do you want? Why: database location is hard to change and affects price, latency and cross-region
   metadata transfer. Typical answer: “Standard, Native mode; region and desired nearby function region kept privately;
   free allowance partly used; cross-region transfer not wanted.” Record region/currency/rate details in private notes.
4. [ ] Who will deploy, with which human login or workload-identity CI principal? Can that person grant IAM roles?
   Who maintains OAuth settings, handles incidents and supports lost phones/account erasure/link failures?
   Why: deployment, runtime and shutdown access are different permissions. Typical answer: “I deploy and support it;
   login kept privately; another administrator must grant roles; I hold the kill switch.” No login credentials needed.
5. [ ] Is Google sign-in enabled? Is the OAuth consent screen external and published for production, with support and
   privacy details? Why: test-user-only consent cannot serve open sign-up. Typical answer: “Google enabled; external
   publication pending; support/privacy contacts kept privately in operator notes.”
6. [ ] Do both the Android OAuth client and Web OAuth client ID exist? Why: Android needs the package/release SHA-1
   binding; Credential Manager needs the Web client ID as audience, not the Android ID. Typical answer: “Both exist;
   package binding checked; IDs kept privately for the release build.” Do not send a client secret.
7. [ ] Are the actual release signing certificate's SHA-1 and SHA-256 registered in the Firebase Android app? Is a
   signing rotation planned? Why: Google sign-in, App Links and App Check depend on the signed APK identity.
   Typical answer: “Both registered; no rotation planned; fingerprints kept privately in release build records.”
8. [ ] Is Email/Password enabled with Email link enabled? Are the default Hosting link domain, authorized continuation
   URL, default sender name/address and templates ready? Why: a sent email must return to the installed APK.
   Typical answer: “Email link enabled; default domain/sender selected; continuation and sender details kept privately;
   deliverability not tested.” Keep the domain/URL in private build notes; no one-time link needed.
9. [ ] Is Identity Platform enabled today? What are the effective Auth signup, email-link send and MAU/DAU quotas,
   existing usage, enumeration-protection status and available provider/signup shutdown controls?
   Why: relay limits do not bound direct Auth traffic or its charges. Typical answer: “Not upgraded; quotas checked;
   enumeration protection on; provider shutdown owner confirmed.” Keep project-specific quota records privately.
10. [ ] Is App Check used or enforced anywhere today? Is there a Play Console/API link? Which kinds of sideloaded
    phones must work? Why: monitored-first must not break existing apps; later integrity checks need outside-Play
    settings. Typical answer: “Not used; link not set up; ordinary supported Play-services phones required.”
11. [ ] What privacy contact should the app show? Why: users need help with identity, lost phones and deletion.
    Typical answer: “Contact chosen; kept privately in operator notes for the future app configuration.”
12. [ ] Which of the three backends goes first, and how long should we wait for offline phones before removing old
    registrations and revoking the exported FCM key? Does that key have other users?
    Why: the first backend has a one-week observation period, but offline phones may need longer.
    Typical answer: “First backend chosen privately; wait at least a week and until known offline phones return;
    other key uses still being checked.” Keep backend/session inventory and the exact grace period in private notes.

## 4. Steps only the operator can do

Do these in order after agreeing to staging. Each item states the result to check. No production commands are supplied
where tooling is missing. Do not adapt the emulator launcher to reach the real project.

- [ ] **Agree to the scope first.** Confirm project/app, incident owner, region, offline grace and shared-workload
  impact from section 3. Result: a private staging plan and explicit permission, not permission inferred from answers.
  Verify the agent's remaining blockers are resolved before deployment: Android account flow, digest interoperability,
  reviewed production deploy/admin tooling, runtime identity/region and scheduled repair configuration.
- [ ] **Costs money: enable Blaze if needed.** Attach the agreed billing account yourself. Check effective regional
  pricing/currency and other workloads. Result: billing-enabled deployment and email-link quota, not unlimited usage.
  Verify the project billing status and effective email-link send allowance; do not request higher Auth quotas.
- [ ] **Set $5/$10 billing alerts and the $10 Functions spend cap.** Verify alert recipients and that thresholds are
  dollar amounts. Check the cap's service/project scope and its effect on every other function before enabling it.
  Result: warnings plus a Functions stop mechanism. Enforcement may lag and overshoot; Auth, Firestore, builds,
  artifact storage and other services are outside it. Use a supported configuration/test notification to verify;
  do not spend $10 to test. If the cap would harm another workload, stop and report that conflict before staging.
- [ ] **Enable required APIs.** Confirm Cloud Functions, Cloud Run, Cloud Build, Artifact Registry, Firestore,
  Firebase Cloud Messaging and Firebase Authentication/Identity Toolkit service access. The built hourly export also
  needs Cloud Scheduler and its supported Pub/Sub/Eventarc delivery dependencies as required by the reviewed deploy.
  App Check/Play Integrity APIs and linkage apply to monitoring setup. Verify enabled-service status and deployer
  permissions; do not enable unrelated services. Deployment/build/artifact/scheduler use can cost money.
- [ ] **Create a dedicated runtime service account; no key file.** Grant Firestore data access and FCM send, not
  project Owner/Editor. Give the deployer only needed deploy and service-account attachment rights.
  **IAM gap to resolve:** the built code also calls Auth get/update/revoke/delete. Firestore plus FCM permissions alone
  cannot run account checks/deletion. A reviewed least-privilege Auth permission set is **not built yet** as a deploy
  recipe; do not hide this by granting broad admin. Verify effective runtime permissions with synthetic live acceptance,
  and verify both exports use the agreed runtime identity. Never download a service-account key.
- [ ] **Hard to undo; costs money: confirm/create Firestore only after region review.** Use the compatible Native-mode
  database. If an existing edition/mode is incompatible, stop rather than replacing it. Database location cannot simply
  be edited later. Result: the approved database, with no assumption of a second free allowance.
  Apply `relay/firestore.rules` and `relay/firestore.indexes.json` through the future reviewed deploy procedure
  (**not built yet**). TTL deletes are billed. Verify deny-all direct client access, TTL fields, index readiness and
  expiry queries. If the database serves other apps, review rule/index merging first; never overwrite their access rules
  with a project-wide deny-all file. Leave relay backups/PITR off unless separately agreed and disclosed.
- [ ] **Configure Auth providers and abuse controls.** Enable Google and Email/Password with Email link enabled;
  disable unused providers. Aiki must expose no password flow. Enable email enumeration protection and review effective
  signup/mail quotas, generic send-link responses and provider shutdown controls. Add only needed authorized domains
  and the agreed HTTPS continuation URL. Result: verified Google/email accounts can authenticate; anonymous/unverified
  accounts cannot enroll. Verify using synthetic test accounts, including provider conflicts; never merge by email.
  Do not upgrade Identity Platform. If already enabled, confirm MAU exposure and existing usage privately.
- [ ] **Publish OAuth consent and check both clients.** Set external production audience and support/privacy details.
  Verify Android client package/release SHA-1 binding and Web client ID audience. Result: a non-test user can use the
  release APK. No OAuth client secret belongs in the APK, backend or repo. Keep client IDs in private release notes
  until the Android build property is available; that property is **not built yet**.
- [ ] **Register release SHA-1 and SHA-256.** Use the certificate that signs the distributed APK, not only debug.
  Verify both in the intended Firebase Android app and Android OAuth binding. Register any replacement before signing
  rotation. Keep fingerprints privately in release records; never send signing keys or passwords.
- [ ] **Configure default Hosting email links and verified App Links.** Use the default sender/domain already chosen.
  Verify sender name/templates, quota and real mail delivery. Host `/.well-known/assetlinks.json` binding the private
  package value to release SHA-256. The APK needs the chosen HTTPS host, `autoVerify` and `/__/auth/links`, current
  Auth SDK, `handleCodeInApp=true` and Hosting `linkDomain`; no Dynamic Links or Play-install fallback.
  Email-link manifest/build configuration and recovery UI are **not built yet**. Result after that work: Android
  verifies the association and mail/browser links return to the installed release APK. Test cold/warm/cross-device
  return, email re-entry, expired/used links and strict-host paste recovery. Keep all link values privately; never log codes.
- [ ] **Set App Check to monitoring, not new enforcement.** Review existing enforcement before any change.
  Register the release app/certificate and Play Console/API link where needed. For outside-Play distribution do not
  require `PLAY_RECOGNIZED` or `LICENSED`; later enforcement would require the agreed device-integrity policy and
  a new release-device test. Result: monitor outcomes without blocking pilot phones. Verify invalid/missing tokens
  are counted without recording tokens. Backend send/status/delete must never require Android attestation.
  Production Android token-provider/monitoring setup still needs implementation/review; never ship debug tokens.
- [ ] **Set seven-day app-log retention and exclusions.** Review platform HTTP/Auth/security logs separately.
  Exclude unnecessary request/content/identity logging; keep no bodies, Authorization, tokens, email/UID/profile,
  one-time links, challenges or ciphertext in application logs. Verify retention settings and inspect synthetic live
  traffic for redaction. Record actual provider/audit-log exceptions in the privacy text: seven days is not a promise
  to erase Google's required logs. Review artifact cleanup so old deploy images do not accumulate charges.
- [ ] **Prepare switches before deployment.** In the Firestore document `relayControl/settings`, set boolean
  `enabled=false` and `enrollmentEnabled=false`. Missing settings default to enabled; absence is not safe staging.
  Verify the document privately and retain agreed default limits from the README. Give the incident owner tested
  permission to update this document. `enabled=false` stops sends/challenges/create/activate/renew; deletion stays
  available. `enrollmentEnabled=false` stops new relay accounts/phones only, not Auth signup or existing token repair.
- [ ] **Deploy paused, only after the missing production procedure is built and approved.** There is no live deploy
  script yet. It must set region/runtime identity, deploy reviewed rules/indexes and configure hourly reconciliation.
  Verify Node 22 support, zero minimum/two maximum HTTPS instances, 30-second request timeout, separate bounded
  scheduler runtime and no emulator flags. Confirm the real Google front-end forwarding suffix before IP budgets
  rely on it. Result: paused function plus working repair schedule, not public enrollment. Verify 503 `relay_disabled`
  for a synthetic send and that deletion still works. Keep the complete HTTPS v1 base URL privately in operator notes.
- [ ] **Supply private Android build values yourself.** Point `harness.googleServicesJson` /
  `HARNESS_GOOGLE_SERVICES_JSON` at client config outside the checkout. Set `harness.pushRelayUrl` /
  `HARNESS_PUSH_RELAY_URL` to the approved HTTPS v1 base URL. Use ignored `apps/android/local.properties`, or private
  `android.properties` selected by `HARNESS_ANDROID_PROPERTIES`. Do not copy config into the repo.
  Web OAuth client ID, email-link domain and privacy-contact build properties are **not built yet**; do not invent
  their names or reuse the unrelated existing app-link origin. Result: the release-signed APK uses the intended
  app/project/endpoint and relay remains off until explicit opt-in. Verify privately, without printing build config.
- [ ] **Set `AIKI_PUSH_RELAY_ENDPOINT` on one backend only.** Put the complete HTTPS v1 base URL, including `/v1/`,
  in its ignored `deploy/local/server-<target>.env` through the private settings loader. Never put Auth/admin credentials
  there for relay. Use the normal approved application deploy process, not ad-hoc service restarts.
  Verify only that backend advertises `fcm-relay-v1` with device sign-in, and no phone changes transport merely because
  the setting exists. Leave the other two backends, direct FCM rows and VAPID files untouched.
- [ ] **Rehearse shutdown and account support before opening sign-up.** The incident owner sets
  `relayControl/settings.enabled=false` for the kill switch, and `enrollmentEnabled=false` to close new enrollment.
  Verify subsequent authorizations stop; in-flight FCM cannot be recalled. Keep provider shutdown access too: neither
  switch stops direct Auth signups/emails. Removing runtime send permission or disabling the function is a last resort
  and may interrupt cleanup; retain an approved way to finish deletion.
- [ ] **Know the admin script's limits.** From `relay/`, `bun run tools/admin.ts disable synthetic-uid` demonstrates
  blocking an emulator account and durable cleanup. `enable`, `phone-disable`, `resume` and `reconcile` are also built.
  This CLI is deliberately demo/loopback-only: live admin tooling is **not built yet**. There is **no `delete` command**.
  Do not point it at production. Live account deletion needs the future in-app recent-auth action, or a separately
  approved operator erasure procedure for lost/disabled accounts. Verify disable blocks immediately, completed cleanup
  erases routes/tokens, explicit re-enable restores none, and deletion erases both Auth and relay state. Auth deletion
  alone is not immediate relay erasure; hourly repair must finish. Keep account IDs only in private support notes.

## 5. What the agent will do after agreement

- [ ] Turn your plain facts into a scoped staging plan and copyable commands for you to review and run yourself.
  Identify costs, exact targets and rollback before each change. Missing deploy/IAM/live-admin procedures and Android
  sign-in/build settings must be built and checked separately; this checklist does not implement them.
- [ ] Resolve the relay credential-digest integration mismatch against the frozen vectors. Finish the account/UI seams
  and emulator/fake-service gates before proposing live acceptance. Update stale implementation warnings when proven.
- [ ] Help interpret sanitized status facts and record acceptance results without identities or payloads.
  You run login, billing, IAM, provider configuration, deployment and live checks; results come back as plain facts.

The agent will never log in as you, discover/read your Firebase or Google credentials/config on this machine, request
keys or sign-in links, or put credentials/config/identifiers in the repo. Agreement is not permission for unsupervised
real-project access. No exported admin key goes to a friend or backend for relay use.

## 6. Live acceptance before opening sign-up

Use synthetic accounts and the actual **release-signed sideloaded APK**, not debug proof. There is no safe promise
that new-phone enrollment works while `enrollmentEnabled=false`: it deliberately does not. For first enrollment,
agree to a brief attended staging window with `enabled=true` and `enrollmentEnabled=true`, enroll test phones, then
close enrollment again. The current code has no staging allowlist/per-user bypass; public client Auth remains reachable.
Existing enrolled test phones can continue checks with `enabled=true`, `enrollmentEnabled=false`. Do not announce open
sign-up until all checks pass. Record outcomes privately; never keep real links or tokens as evidence.

- [ ] Google sign-in works for an external non-test user on the release APK without Play Store installation.
  Email links work cold/warm, across devices with email re-entry, from target mail/browser apps, with verified App Links
  and paste recovery; used/expired/wrong-host links fail safely.
- [ ] Consent/privacy contact is shown before sign-in; normal app/backend use works without an account.
  Logs are redacted. No profile is copied to Firestore; top-level Auth name/photo minimization and remaining provider
  profile limits match the disclosure.
- [ ] Several phones and reinstall work within the three-phone cap. At capacity, replacement/removal is explicit.
  Push off/sign-out/current-phone removal preserve other phones. No silent plaintext fallback after relay selection.
- [ ] Recent-auth account deletion blocks all phones, including an offline one, and finishes relay/Auth erasure.
  Observe durable cleanup/hourly repair after interruption. A 410 `account_deleted` after Auth removal is not proof
  that every relay cleanup item is already gone. Confirm final erasure privately through operator checks.
- [ ] Operator disable blocks sends immediately and cannot revive old routes on re-enable. Direct Auth disable/delete
  blocks the next send; hourly reconciliation removes orphan state. Verify the actual scheduler triggers and permissions.
- [ ] A real FCM possession challenge reaches the exact phone. Encrypted test decrypts/displays once; rotation repairs
  its token. Background delivery and notification tap work; outage/retry does not replay old events or expose plaintext.
  “Accepted” means FCM accepted it, not proof of delivery or reading. Test independent routes for all three backends
  without cutting over all three at once.
- [ ] Runtime IAM, direct-client deny rules, TTL/indexes, real ingress/IP trust, retention and effective Auth/mail quotas
  match the plan. Exercise limits, both relay switches and provider shutdown safely with test traffic. Verify alerts
  and spend-cap configuration, without a deliberate bill spike. No extra unreviewed privileges or debug bypasses.

## 7. Rollout and rollback

- [ ] Inventory the three backends' phone sessions/transports privately. Ship additive support with relay off.
  Keep device sign-in required, working direct registrations/credentials and VAPID files. Friends stay push-off until
  acceptance. Web push migrates separately and needs no account or relay setting.
- [ ] On the first backend, arrange a relay test route/key and verify an encrypted test before selecting relay for
  normal events. Test-only pre-cutover UI/tooling is **not built yet**; do not pretend ordinary registration is a
  test-only cutover, because confirmation selects relay. Preserve held event IDs; drain/cancel old direct retries.
  Confirm one active transport per session, with no automatic direct fallback.
- [ ] Observe the first backend for one week. Check delivery, cleanup, quotas, billing and background behavior.
  Then migrate the second and third separately with independent routes/keys. Wait the agreed offline grace period
  and all known offline phones before retiring their registrations. No reinstall or global key wipe is required.
- [ ] Keep direct credentials privately only for the bounded rollback window. An explicit per-session direct
  registration is the backend's supported way to clear relay selection; a safe operator UI/rollback recipe is
  **not built yet**. Do not rely on just removing the endpoint to restore direct delivery. Rollback must preserve
  device auth and held events, revoke the relay route, and never replay historical notifications. Friends never receive
  an admin key or a direct-mode repair instruction.
- [ ] After acceptance and offline grace, verify no other workload uses the exported FCM key. **Hard to undo:**
  revoke that key yourself and remove its private backend copies. Verify direct rollback is intentionally retired;
  the relay runtime identity still works independently. Never overwrite or revoke web VAPID keys as part of this step.
- [ ] To turn everything off: set `enabled=false` and `enrollmentEnabled=false`, turn relay notifications off in the
  app to stop local receive/queue cleanup, and remove `AIKI_PUSH_RELAY_ENDPOINT` through the private backend settings.
  Verify no relay capability is advertised/new sends authorized; finish queued deletion through the approved cleanup
  process before removing the function/runtime access. The Android off switch UI is **not built yet** on this baseline.
  To stop an Auth attack, separately disable affected providers/signup controls. Re-enable only deliberately after review.

Migration avoids a planned gap, not every loss or duplicate. FCM and crashes are best effort; already in-flight legacy
pushes may arrive late. No exactly-once guarantee, silent downgrade or simultaneous three-backend cutover.

## 8. Costs and exposure

Expect about **$0/month for 20 friends**, assuming about 20 total notifications/person/day and unused project free
allowances. Small TTL, deployment, artifacts and logging charges can remain. This is a workload estimate, not a quote.
One accepted emulator notification measured about **20 Firestore reads and 10 writes**, not the design's six and six.
At that workload, sends alone are about 8,000 reads/4,000 writes a day; retries, management, Auth and hourly repair add
work. Re-price the actual region and shared usage before scaling; the design's larger-user estimate needs recalculation.

Limits bound relay enrollment and attempted FCM sends, including failed external attempts. They do **not** cap account
creation in Firebase Auth itself, email sends/MAUs, hostile HTTP invocations or cleanup lookups. An attacker can call
Auth directly and can exhaust shared relay capacity. Fixed minute/hour windows can allow up to twice a window's limit
across its boundary. The kill switch and enrollment switch do not stop Auth charges or mail.

Standard Google/email Auth and FCM have no ordinary sending/MAU fee at this scale; already-enabled Identity Platform
has separate shared MAU allowances and exposure. $5/$10 alerts do not stop billing. The $10 Functions cap is delayed,
service-scoped and excludes Firestore/Auth/build/storage; it is not a $10 project-wide ceiling. Keep the shutdown owner
reachable and review costs and signup/mail volume during the first week.
