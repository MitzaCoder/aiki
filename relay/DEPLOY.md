# Relay deployment and operations — operator only

**Not permission to deploy.** The agent only builds/tests with loopback `demo-` emulators. Everything here that
contacts Google is for the operator, after the [checklist](../docs/push-relay-operator-checklist.md), private facts,
shared-workload review and an explicit staging agreement. Neither emulator success nor these instructions prove
real IAM, quotas, ingress, mail, billing or delivery. Every IAM row below is **verify on the real project**.
Never adapt `tools/emulators.ts` or `demo:stack` for production. Never export a service-account key.

Replace **every** `<placeholder>` privately before copying a command. Do not send project identifiers, service-account
emails, config, credentials, signing data, user IDs, links or payloads to the agent or commit them. Keep operator notes
under ignored `deploy/local/`; keep client config outside the checkout. Do not run application deploy scripts or
move the Aiki `main` bookmark as part of a relay deployment.

## 1. Review before provisioning

- Confirm Blaze/billing, incident owner, current Firebase Android app, Native-mode Firestore edition/location and a
  nearby Functions region. Database location is hard to undo; creation, builds, storage, TTL and scheduling can cost money.
  No second free allowance is assumed for a named database. Do not replace an existing database or upgrade Identity Platform.
- Choose `(default)` or a **dedicated named database**. The database ID must be identical in Functions parameters,
  the generated deploy config and **every operator command**. A shared database is not a collection-level IAM boundary:
  server SDKs bypass rules, and Firestore data permissions can cover unrelated documents in that database. If that
  exposure is unacceptable, choose a dedicated database and verify database-scoped IAM/conditions before proceeding.
- Reserve these collection IDs, at any depth (indexes/TTL apply to collection groups): `relayAccounts`,
  `relayInstallations`, `relayChallenges`, `relayChallengeOperations`, `relayTokenOwners`, `relayRoutes`,
  `relaySendAttempts`, `relayRateLimits`, `relayControl`, `relayRuntime`, `relayAccountCleanup`, `relayRouteRevocations`.
  Stop if another workload already owns any of them. There has been no real deployment/migration of unprefixed relay data.
- Check that function IDs `relay` and `reconcile` are unused, or are the reviewed relay exports. A codebase label is not
  a namespace for function IDs. The config's `aiki-push-relay` codebase and narrow deploy selectors avoid pruning other apps.
- Auth is **project-wide**, not database-scoped. Profile minimization updates the Auth user's top-level display name/photo;
  disabling/revoking/deleting a relay user also affects that identity in other apps in the project. Agree to that impact.

## 2. Prerequisites and identities

Operator prerequisites: Bun, supported Node 22 runtime, the pinned local Firebase CLI (`bun install --frozen-lockfile`
from `relay/`), and the Google Cloud CLI. Tests additionally need Java and `ss`; production deployment does not run emulators.
Authenticate the Firebase CLI and Application Default Credentials **yourself**, outside agent tools. CLI login and ADC
are separate: a Firebase CLI login alone does not authorize `operator.ts`. ADC may be your user ADC or approved
keyless workload identity. Do not download a JSON admin key or put credentials in an env file.

All subsequent Firebase commands use the local CLI and an explicit `--project`. Do not rely on a global active project,
`.firebaserc`, an inherited emulator variable or a pasted client config. Before real operator commands, unset every
`*EMULATOR*` variable, `RELAY_*_PORT`, `RELAY_TEST_FCM_PORT`, `RELAY_APP_CHECK_BYPASS` and internal demo/operator markers.
The tool refuses contaminated real mode, even if a variable is empty. `--no-env-file` also prevents Bun loading an old
emulator `.env.local`; it does not disable ADC.

### Required services — verify on the real project

A bootstrap operator with approved service-enablement rights can review/run:

```sh
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com fcm.googleapis.com identitytoolkit.googleapis.com \
  firebaseappcheck.googleapis.com cloudscheduler.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  storage.googleapis.com firebase.googleapis.com iam.googleapis.com serviceusage.googleapis.com \
  cloudresourcemanager.googleapis.com logging.googleapis.com --project '<project-id>'
```

`reconcile` is a v2 **HTTP/OIDC Cloud Scheduler** function, not a v1 Pub/Sub schedule. Nevertheless pinned Firebase CLI
14.22.0 ensures Eventarc, Pub/Sub and Storage APIs and Eventarc/Pub/Sub service identities for every v2 deployment
(`deploy/functions/prepare.js`); do not omit them just because this schedule uses HTTP. Scheduler is separately required.
App Check verification fetches public JWKS; enabling its API is not enforcement. Play Integrity/provider setup remains
operator/release-device work. Verify enabled services and effective quotas; do not enable unrelated products or increase
Auth quotas. Service-enablement/bootstrap permission is not an ongoing runtime permission.

### Runtime permissions — verify on the real project

Create a dedicated service account with no key. Both exports take the same `RELAY_RUNTIME_SERVICE_ACCOUNT` parameter.
Prefer reviewed custom roles with these permissions rather than Owner/Editor or Firebase Auth Admin:

| Code path | Permissions / scope to review |
| --- | --- |
| Firestore point reads, queries, transactions, creates/updates/deletes | `datastore.databases.get` (transactions), `datastore.entities.get`, `datastore.entities.list`, `datastore.entities.create`, `datastore.entities.update`, `datastore.entities.delete`; scope to the selected database using supported IAM bindings/conditions, and prove the restriction. No index/rules/database-administration rights. |
| FCM HTTP v1 `getMessaging().send()` | `cloudmessaging.messages.create` in the selected project. A custom sender role is narrower than `roles/firebasecloudmessaging.admin`; no legacy server key. |
| `getUser`, revocation-checked `verifyIdToken` | `firebaseauth.users.get`, project scope. No Auth list-users/config-management permission is used. |
| `updateUser` (disable/enable/profile minimization), `revokeRefreshTokens` | `firebaseauth.users.update`, project scope. Revocation uses the user update API, not a token-creator role. |
| `deleteUser` at the durable cascade's end | `firebaseauth.users.delete`, project scope. No user-create permission. |
| ID-token signature and monitored App Check `verifyToken()` | Public signing keys/JWKS and appropriate HTTPS egress; no extra IAM role for signature verification. Revocation checking still needs the Auth get permission above. No App Check consume/admin/config or service-account-token-creator role is called by this code. |
| Scheduled invocation | The pinned CLI uses the endpoint's runtime SA as Scheduler's OIDC identity. Verify the job actually uses it; give that identity `roles/run.invoker` **only on the reconcile service**, not public invocation. The Cloud Scheduler service agent needs its standard Google-managed `roles/cloudscheduler.serviceAgent` to mint the job's identity. Do not grant that service-agent role to a human/runtime account. |

A reviewed custom runtime role may combine the six Firestore, one messaging and three Auth permissions. Keep the
resource scoping distinct when a database condition cannot also authorize project-level Auth/FCM. Database-level IAM
support and exact transaction permission requirements must be tested on the actual database/edition; the emulator
cannot validate them. There is no collection-level protection from client rules for this server identity.
`roles/datastore.user` is a broader predefined data-access alternative, **not** a justification for project Editor.
Console stdout/stderr is captured by the platform; the code does not call the Logging API or require a new log-admin role.

A bootstrap operator can prepare these **three separate custom roles**, after verifying the permission names and
scope support. Role IDs below are placeholders to choose privately, not a committed project configuration:

```sh
gcloud iam service-accounts create '<runtime-service-account-name>' --display-name 'Push relay runtime' --project '<project-id>'
gcloud iam roles create '<relay-data-role-id>' --project '<project-id>' --stage GA \
  --title 'Relay database data' \
  --permissions datastore.databases.get,datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.update,datastore.entities.delete
gcloud iam roles create '<relay-auth-role-id>' --project '<project-id>' --stage GA \
  --title 'Relay Auth user operations' \
  --permissions firebaseauth.users.get,firebaseauth.users.update,firebaseauth.users.delete
gcloud iam roles create '<relay-fcm-role-id>' --project '<project-id>' --stage GA \
  --title 'Relay message sender' --permissions cloudmessaging.messages.create
```

Bind Auth/FCM roles to the runtime SA in this project; use the data role only for the selected database. A candidate
Firestore database condition is below; **verify supported resource context and effective allow/deny on the real project
before relying on it**, rather than silently replacing it with an unconditional data grant:

```sh
gcloud projects add-iam-policy-binding '<project-id>' --member 'serviceAccount:<runtime-service-account-email>' \
  --role 'projects/<project-id>/roles/<relay-data-role-id>' \
  --condition 'expression=resource.name=="projects/<project-id>/databases/<database-id>",title=RelayDatabaseOnly'
gcloud projects add-iam-policy-binding '<project-id>' --member 'serviceAccount:<runtime-service-account-email>' \
  --role 'projects/<project-id>/roles/<relay-auth-role-id>' --condition=None
gcloud projects add-iam-policy-binding '<project-id>' --member 'serviceAccount:<runtime-service-account-email>' \
  --role 'projects/<project-id>/roles/<relay-fcm-role-id>' --condition=None
```

Review existing bindings rather than overwriting them. The incident operator can receive the data/Auth roles without
the FCM role; a read-only incident viewer needs a separate read-only data role. Verify inherited roles do not defeat the
restriction. Configure/verify the reconcile-only Run invoker binding after its service exists; the Firebase deployer
normally sets it while creating the schedule. Never grant project-wide token-creator or public reconcile access.

### Deployer / incident operator permissions — verify on the real project

Separate bootstrap, deploy, runtime and support principals. Review effective permissions, inherited grants and organization
policies before adding roles. No recipe here warrants granting all of them permanently to one person.

| Principal / action | Narrow starting role or permission set; verify on the real project |
| --- | --- |
| Functions deployer | `roles/cloudfunctions.developer` for the approved functions/project plus `roles/iam.serviceAccountUser` on the dedicated runtime SA (`actAs`, also needed for the Scheduler OIDC identity). Creating functions may require project-level scope; review conditions and the two IDs. |
| Public HTTPS / private scheduler IAM setup | Additional `run.services.get`, `run.services.getIamPolicy`, `run.services.setIamPolicy` only for the two generated Cloud Run services. The first deploy may need a bootstrap grant before those resources exist. Do not solve this by making all Cloud Run services public or granting project Run Admin. |
| Scheduler job creation/update/rollback | `roles/cloudscheduler.admin`, restricted to the agreed job where supported, or a custom job get/create/update/delete permission set. Manual smoke execution also needs `cloudscheduler.jobs.run`; pausing uses `cloudscheduler.jobs.pause`. Review job listing/read requirements for the pinned CLI. |
| Rules owner (only when deploying rules) | `roles/firebaserules.admin`, or reviewed ruleset create/get/test and release get/create/update permissions for the selected Firestore release. Shared rules stay with their existing owner/pipeline. |
| Index/TTL owner | `roles/datastore.indexAdmin` (including field configuration), scoped to the selected database where supported. Verify TTL `datastore.fields.update` and actual index APIs. No database deletion right. |
| API/bootstrap owner | Service Usage enable/get/list and service-identity provisioning rights (normally a temporary `roles/serviceusage.serviceUsageAdmin` grant), plus approved IAM/service-account creation rights. The v2 CLI provisions service identities even when the schedule is HTTP; pre-enablement alone may not eliminate its permission checks. |
| Build/platform service agents | Preserve/review the standard Cloud Functions, Cloud Run, Cloud Build, Eventarc, Pub/Sub and Scheduler service-agent grants. Verify which build SA the project actually uses (defaults changed over time) and its build/source/artifact access. Do not grant those broad service-agent roles to the runtime SA. |
| Incident/support `operator.ts` principal | The Firestore data/transaction and three Auth user permissions above, **without FCM send**, suffice for its code paths. A status-only principal can use read/transaction permissions. It does not need deploy/rules/index/IAM administration. Auth erasure affects other apps sharing the identity. |
| Logging/artifact policy owner | Separate scoped logging configuration/bucket/sink rights and artifact cleanup-policy rights, only when configuring those resources. They are not runtime permissions. |

This is a least-privilege starting plan, not a live IAM attestation. Firebase CLI discovery/upload/build and organization
policies can expose additional missing read/provisioning permissions. Inspect denied **permission names privately**, add
only what the reviewed operation calls, and update the plan; never fall back to Owner/Editor. Verify both runtime exports,
the Scheduler OIDC/Run invoker binding and synthetic get/update/revoke/delete behavior before opening enrollment.

## 3. Build and private deployment settings

From `relay/`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
cp .env.example '.env.<project-id>'
```

Fill this ignored file privately, replacing **all** placeholders. It contains only deploy settings, never credentials:

| Firebase Functions parameter | Meaning |
| --- | --- |
| `RELAY_REGION` | Reviewed Functions region; mandatory, no silent production region default. |
| `RELAY_RUNTIME_SERVICE_ACCOUNT` | Dedicated same-project SA email; mandatory, shared by HTTPS/reconciliation. |
| `RELAY_DATABASE_ID` | Database ID; default `(default)`. Must match deploy config/operator `--database`. |
| `RELAY_MAX_INSTANCES` | Positive HTTPS ceiling; default 2. Keep 2 for the pilot unless separately reviewed. |

The SDK exports parameter expressions during discovery; Firestore database resolution is deferred to invocation.
HTTPS remains Node 22, zero minimum instances, 30 seconds, 256 MiB, ten-second FCM deadline. Reconciliation is hourly,
540 seconds, one maximum instance, same region/identity/database. No emulator/test/bypass variable may be deployed.
The source packaging excludes env files, generated configs, emulators, checks and tools. Firebase CLI supplies resolved
parameters as runtime environment values. Confirm these values and Node 22 availability privately before deploying.

## 4. Firestore rules/indexes without damaging another app

Confirm/create the approved Native-mode database only after location review. A possible creation command, **only if
creation was agreed and it does not already exist**, is:

```sh
gcloud firestore databases create --project '<project-id>' --database '<database-id>' \
  --location '<database-location>' --type firestore-native
```

Use `(default)` as the literal database ID when that is the choice. Leave backups/PITR off unless separately approved.
The local config generator performs no login, project lookup, SDK initialization, deployment or network call.

### Database solely owned by relay

```sh
bun --no-env-file tools/deploy-config.ts --rules sole --database '<database-id>'
./node_modules/.bin/firebase deploy --project '<project-id>' --config .deploy.firebase.json \
  --only firestore:rules,firestore:indexes
```

Review the generated ignored `.deploy.firebase.json` first. `firestore.rules` denies **all** direct client access;
never deploy it onto a database used by another app. Admin SDK access bypasses these rules.

### Shared database

**Do not deploy `firestore.rules`.** Obtain the existing reviewed rules **source**, not a guessed replacement. Paste the
exact [shared fragment](firestore.shared.rules.example) inside its `match /databases/{database}/documents` block.
It contains a recursive deny block for each of the twelve collections and `isRelayCollection(collectionId)`.

Firestore allows are **ORed**: `allow ...: if false` does not override a broader allow. Every overlapping allow must
exclude relay collections. For example, preserve an existing broad condition with this additional guard:

```text
match /{collectionId}/{document=**} {
  allow read, write: if !isRelayCollection(collectionId) && (EXISTING_REVIEWED_CONDITION);
}
```

`EXISTING_REVIEWED_CONDITION` is a placeholder, not valid deployable rules. Review nested/recursive rules and collection-group
queries too. The existing rules owner tests/deploys the merged source through the **existing app's reviewed configuration**;
never replace their config/policy with the relay's deny-all file. Test both relay denial and unchanged legitimate app access.
The emulator gate compiles the exact fragment, denies reads/writes to all twelve relay collections and preserves unrelated
collection access under a guarded broad allow. It does not attest to the operator's unknown existing rules.

Preserve existing indexes too: a relay-only indexes file can otherwise offer deletion of unrelated composite indexes.
Export the selected database's current index configuration privately with the pinned CLI, review it, then merge locally:

```sh
./node_modules/.bin/firebase firestore:indexes --project '<project-id>' --database '<database-id>' \
  > .deploy.existing-indexes.json
bun --no-env-file tools/deploy-config.ts --rules shared --database '<database-id>' \
  --existing-indexes .deploy.existing-indexes.json
./node_modules/.bin/firebase deploy --project '<project-id>' --config .deploy.firebase.json --only firestore:indexes
```

The generated shared config has **no rules property**. It preserves every existing composite index and every non-relay
field override, adding/replacing only the twelve reserved relay groups' field settings. Review exact changes and every
CLI deletion prompt; abort if anything unrelated would change. Refresh the export if another owner changed indexes.
Do not use broad `firebase deploy` or `--force`. Generated `.deploy*` files stay ignored/private.

Verify the selected database's TTL policies and single-field indexes become ready. TTL deletes are billed/eventual;
authorization expiry is enforced in code. Never enable TTL on `relayAccountCleanup`: unfinished work must remain durable.
The emulator proves named-database Admin/HTTP isolation but cannot establish real database IAM, TTL scheduling or the
pinned CLI's named-database client-rules association. Verify those on the real database before use.

## 5. Seed paused **before** deploying a reachable function

There is no bootstrap-open window: missing settings **and missing boolean switch fields mean disabled**. Nonetheless
seed the selected database explicitly before deploying. The operator tool defaults to a dry run, including `status`:

```sh
bun --no-env-file tools/operator.ts --project '<project-id>' --confirm-real-project \
  --database '<database-id>' seed-control
# Review the printed project/database/change, then:
bun --no-env-file tools/operator.ts --project '<project-id>' --confirm-real-project \
  --database '<database-id>' seed-control --yes
bun --no-env-file tools/operator.ts --project '<project-id>' --confirm-real-project \
  --database '<database-id>' status --yes
```

Expect `enabled=false`, `enrollmentEnabled=false`, pilot limits and zero fresh-day counters. `seed-control` creates
`relayControl/settings` paused only if absent; it **fails rather than overwriting** existing switches/limits. For an
existing installation, inspect `status`, then `pause` and `enrollment close`. Numeric limits have defaults; booleans do not.
Do not resume as a deployment smoke test. Deletion remains available while paused or budgets are exhausted.

## 6. Deploy only the two exports, still paused

```sh
./node_modules/.bin/firebase deploy --project '<project-id>' --config .deploy.firebase.json \
  --only functions:aiki-push-relay:relay,functions:aiki-push-relay:reconcile
```

Never deploy all functions in a shared project. Verify the preview contains **only** these exports and no unrelated deletion.
Check both generated services use the approved runtime SA, region and database parameter, the HTTPS instance ceiling,
and the private hourly Scheduler job/OIDC identity. The HTTPS endpoint is public but admission is paused; reconciliation
must not have an `allUsers` invoker. Confirm the actual endpoints privately, including the HTTPS base ending in `/v1/`.
Verify job existence/schedule and a bounded synthetic repair run using the operator's Scheduler access; running repair
can read/write/delete relay records and Auth users queued for erasure. Do not run it over unreviewed data.

Paused synthetic smoke checks (replace `<relay-v1-base-url>` with the full base including `/v1/`):

```sh
curl -i -X POST '<relay-v1-base-url>send' -H 'Content-Type: application/octet-stream' --data '{}'
# Expect 503, {"error":"relay_disabled"}, Cache-Control: no-store.
curl -i -X POST '<relay-v1-base-url>delete' -H 'Content-Type: application/octet-stream' \
  -H 'Authorization: Bearer aiki_push_delete1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
  --data '{"routeId":"AAAAAAAAAAAAAAAAAAAAAA"}'
# Expect 204 for this deliberately synthetic, absent route, with no-store and no body.
```

Do not reuse a real route/bearer as a smoke fixture. Unexpected status/error/redirect means stop, leave paused and
investigate privately. Also verify authenticated/unauthenticated direct client access to every relay collection is denied,
and (for a shared database) unrelated application operations still work. App Check is monitored, never newly enforced.

**Ingress gate:** `src/client-address.ts` trusts the rightmost address appended by the direct Google front end. Validate
that suffix with controlled requests on the actual approved endpoint, including forged earlier X-Forwarded-For entries,
missing/malformed input and any load balancer/proxy in front of it. Missing metadata must fail closed with
`client_address_unavailable`, not silently share a guessed IP. Do not log raw IPs/headers to prove it. Record only sanitized
pass/fail facts. Extra proxies may require a separately reviewed adapter change; do not guess a hop or bypass IP budgets.
Paused send short-circuits before address use, so a paused smoke alone does **not** prove trusted-IP admission.

## 7. Operator CLI and account support

One implementation serves both modes; no operator HTTP endpoint exists. In the following command list prepend either:

- Emulator: `bun --no-env-file tools/operator.ts --emulator --database '<database-id>'` (default project `demo-aiki-relay`,
  selected loopback ports from `RELAY_*_PORT`; re-executes under scrubbed HOME/XDG/env with no ADC).
- Real, **operator only**: `bun --no-env-file tools/operator.ts --project '<project-id>' --confirm-real-project --database '<database-id>'`
  (uses your ADC, rejects any emulator variable and refuses demo IDs in real mode).

Every command prints its selected project/database and intended effect, and needs `--yes` to perform it — including
status reads. Without `--yes` there is **no SDK initialization, ADC discovery or network call**. Account/phone target
IDs and provider errors are not echoed; review the actual supplied target privately. `admin.ts` is an alias with the same
explicit modes/syntax/confirmation, not the old unrestricted settings-JSON interface.

| Command suffix | Action |
| --- | --- |
| `status` | Effective switches/limits, UTC day, aggregate global send-attempt/challenge/new-account counters, reserved account/phone slots; no email, UID, token, IP/quota key or route data. These are relay counters, not direct Auth signup/mail/MAU metrics. |
| `seed-control` | Create paused/closed settings once, never overwrite an existing document. |
| `pause` / `resume` | Kill switch only; resume does not open enrollment or reset counters. |
| `enrollment open` / `enrollment close` | New relay accounts/phones; does not stop direct Auth signup/email or existing token repair when the relay is enabled. |
| `limits set <name> <nonnegative-safe-integer>` | One named limit from `src/limits.ts`, no counter reset; zero exhausts that budget. |
| `account disable <uid>` | Durable marker first, Auth disable/revoke, cascade phones/routes/tokens; retain minimal disabled marker and abuse counters. |
| `account enable <uid>` | Only after disable cleanup completed; no old phone, route, token or credential is restored. |
| `account delete <uid>` | Lost/disabled-account erasure: same durable relay-before-Auth cascade without a phone/recent-auth requirement. Deletes the project-wide Auth user. Repeating resumes pending work/is harmless after completion. |
| `phone disable <installationId>` | Resolve owner internally, remove that phone/routes/token only; preserve other phones and counters. For a blocked account with cleanup pending use account cleanup/reconcile instead. |
| `reconcile` | Auth/expiry repair plus queued erasure/disable, also while paused. |

Mutation output `complete:false,retryAfterSeconds:60` means work is durable, not erased yet. Wait/repeat the account
command or run `reconcile`; do not delete its marker/work or enable while pending. The hourly job is the fallback.
CLI output is not an audit archive; retain only scoped/sanitized support facts. Do not paste UID-bearing commands,
provider output, ADC/config or captures into public reports. Firebase Auth deletion alone does not erase relay rows.

## 8. Alerts, provider shutdown and logging — needs the real project

Before any public enrollment, configure **three independent Auth-volume alerts**, in addition to the agreed $5/$10
billing alerts and $10 Functions service cap. Relay counters/switches do not bound direct Auth traffic or charges.
For this project's actual Standard Auth/Identity Platform status, identify the supported metric/quota report or aggregate
export, measure the other apps' baseline and configure warning/critical notifications for:

1. **Auth sign-ups** per short interval/day, relative to baseline plus the approved small pilot (20 new relay accounts/day
   is a relay ceiling, not a project Auth cap).
2. **Monthly active users**, against the effective shared free/approved billing allowance and expected pilot population.
3. **Sign-in emails sent**, against the effective project email-link quota/remaining allowance and expected baseline.

Choose/record concrete warning/critical thresholds privately (for quota-backed metrics, 50%/80% of the reviewed available
allowance is a starting proposal, not an assumed quota). Route them to the incident owner and backup; test each notification
without exhausting a quota or deliberately generating a bill spike. Record metric/query, window, threshold, recipient and
test result privately. Do not upgrade Identity Platform to obtain a metric. Native metrics/console locations vary; no
specific metric identifier or universal MAU/mail quota is asserted here. If a reliable aggregate alert is unavailable,
arrange an approved aggregate-only quota/report monitor or stop public enrollment and report that remaining gap. Never
export individual emails/UIDs/sign-in links as an alert dataset.

Rehearse an **attended provider/sign-up shutdown drill next to the relay kill switch**, with the shared-project owners:

1. Verify an approved synthetic account/provider flow works and the three monitors notify the right people.
2. `pause --yes` and `enrollment close --yes`; verify sends stop and deletion works. Direct Auth remains reachable.
3. In the project's actual Authentication/provider controls, turn off the agreed Google and email-link providers, or a
   separately verified supported sign-up control. Standard Auth must not be assumed to have an independent sign-up-only
   switch; do not invent one or upgrade Identity Platform. Provider disable can break other apps' sign-ins: obtain a
   maintenance window/approval first, or stop staging if no safe response is available.
4. Attempt one reviewed synthetic new sign-in/sign-up and email-link request: they must be blocked, not merely blocked
   at relay enrollment. Verify counts stop rising. Existing ID tokens may remain valid until expiry/revocation; the relay
   kill switch remains necessary. Do not mass-revoke unrelated users.
5. Record sanitized pass/fail/timing and the exact private recovery procedure; restore providers only deliberately,
   leaving relay paused until the incident owner approves reopening. No live email code/link/identity is evidence.

These are operator alerts/controls, **not mocked acceptance cases**. See the
[acceptance record](../docs/push-relay-acceptance.md). They cannot be configured or proven without the real project.

Route only reviewed relay **application** logs into a dedicated bucket with seven-day retention; avoid changing a shared
`_Default` bucket's retention or exclusions blindly. Review actual 2nd-gen Cloud Run/function log labels to select only
these exports, and remove unwanted duplicate routing only after the logging owner verifies no other workload is affected.
Inspect synthetic traffic privately: no bodies, Authorization, email/UID/profile, IP, tokens, one-time links, challenges or
ciphertext in application logs. The scheduled wrapper emits only a fixed failure, not a provider's UID-bearing error.
Review platform HTTP/Auth/security/audit logs separately; mandatory provider retention is not a seven-day erasure promise.
Record exceptions in privacy disclosures. Configure reviewed Artifact Registry cleanup so old images do not accumulate
charges; do not delete artifacts used by another app/current rollback. Exact filters/console paths need the actual project.

## 9. Rollback: pause, finish cleanup, then remove only relay

1. `pause --yes`, `enrollment close --yes`; close providers/sign-up separately if the incident concerns direct Auth abuse.
   Alerts are not a stop button, and the Functions cap excludes Auth/Firestore/build/artifact charges and can overshoot.
2. Use the approved app/backend rollback, not an implicit direct-FCM fallback. Preserve device auth and held event IDs;
   do not replay history. Drain queued route/account deletion with the still-reachable delete endpoint, operator tool
   and scheduler. Verify no pending cleanup/required delete outboxes before withdrawing their runtime access.
3. Verify the two IDs/codebase/region, then remove only them (review the CLI prompt; do not use a broad deployment):

```sh
./node_modules/.bin/firebase functions:delete relay reconcile --project '<project-id>' --region '<function-region>'
```

4. Verify the owned Scheduler job/services are gone and unrelated functions/jobs remain. Keep an approved operator ADC
   path for any residual erasure. Only then remove dedicated runtime grants/account and reviewed unused relay artifacts.
   Do not delete a shared Firestore database, existing rules/indexes, Auth users belonging to other apps, provider config
   or client config. TTL is eventual and unfinished cleanup must never be erased as a shortcut.
5. Reopen only after reviewed fixes and synthetic live acceptance, never merely because deployment succeeded.
