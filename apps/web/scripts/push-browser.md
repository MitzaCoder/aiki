# Isolated Web Push browser tests

These tests use six `createSetup` backends, all in required device-sign-in mode with explicit temporary VAPID files,
FCM disabled, and an allowed loopback app origin. Alpha/Gamma share one key; Beta has a different key. The second
three backends exercise the operator's all-shared legacy case. Synthetic retained sessions are seeded only into the
normal origin-pinned IndexedDB credential store. No live configuration, real push service or relay account is needed.

Build the app first (`cd apps/web && bun run build`, then return to the repository root). Start dedicated processes:

```sh
mkdir -p .preview
setsid -f bun apps/web/scripts/push-browser-fixture.ts > .preview/push-fixture.log 2>&1 < /dev/null
setsid -f chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --remote-debugging-port=9298 --user-data-dir=/tmp/aiki-push-chromium \
  about:blank > .preview/push-chromium.log 2>&1 < /dev/null
```

Use a fresh browser profile. The fixture log prints its PID and temporary root. Inspect the browser listener's PID
with `fuser -n tcp 9298`; stop only those two processes with `kill -TERM <fixture-pid> <chromium-pid>` when finished.
The fixture's signal handler stops every backend and removes its temporary directories. Never reuse a personal browser
or start an Aiki backend outside `createSetup`. Every browser/CDP call has a timeout. Run each step separately:

```sh
bun apps/web/scripts/test-push-browser.ts init mixed legacy
bun apps/web/scripts/test-push-browser.ts assert-mixed legacy
bun apps/web/scripts/test-push-browser.ts test-delivery
bun apps/web/scripts/test-push-browser.ts disable-beta
bun apps/web/scripts/test-push-browser.ts enable-beta
bun apps/web/scripts/test-push-browser.ts key-change
bun apps/web/scripts/test-push-browser.ts repair-beta
bun apps/web/scripts/test-push-browser.ts sync-beta
bun apps/web/scripts/test-push-browser.ts remove-beta
bun apps/web/scripts/test-push-browser.ts init operator legacy
bun apps/web/scripts/test-push-browser.ts assert-operator
bun apps/web/scripts/test-push-browser.ts init independent
bun apps/web/scripts/test-push-browser.ts enable
bun apps/web/scripts/test-push-browser.ts assert-independent
```

The mixed legacy case seeds an existing root subscription before app code runs. Its endpoint is unchanged and
there are no unsubscribes. The operator case asserts zero subscribe calls and only the existing root registration.
The independent case asserts two different push-only scopes plus the root shell, and disabling one leaves the other.
Loopback test sends verify each endpoint and the backend's public signing key. Unit server tests separately verify
actual Web Push encryption/signatures. Key-change seeding represents the persisted *previous* key; it does not rotate
a running fixture's key. Sync repair seeds the same durable marker written by the worker; worker event behavior and
signed-out repair deferral have separate unit tests. Real push-service acceptance still needs consented live testing.

Set `PUSH_TEST_LEGACY_PREFIX` to exercise a private build's old backend-list storage namespace too. The driver always
also seeds the current public namespace; private storage migration itself is covered by its existing unit tests.
`PUSH_TEST_CDP` may select a different dedicated browser endpoint. Fixture ports are loopback-only.

## Visual proof

```sh
bun apps/web/scripts/test-push-browser.ts init mixed
bun apps/web/scripts/test-push-browser.ts record
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 \
  -i .preview/push-recording/frames.txt -vf 'fps=15,format=yuv420p' -c:v libx264 .preview/push-after.mp4
bun apps/web/scripts/test-push-browser.ts assert-mixed
bun apps/web/scripts/test-push-browser.ts snap after-settings-desktop-dark 1440 dark
bun apps/web/scripts/test-push-browser.ts snap after-settings-desktop-light 1440 light
bun apps/web/scripts/test-push-browser.ts snap after-settings-phone-dark 390 dark
bun apps/web/scripts/test-push-browser.ts snap after-settings-phone-light 390 light
```

Screenshots scroll to the affected backend rows. `record` captures the actual browser interaction from enabling push
through the per-backend states. It must start with push off. For baseline proof, build the prior revision in a separate
temporary workspace and pass its built directory as the fixture script’s optional first argument. Never check out baseline code over uncommitted work.
Only the permission/push-service APIs are stubbed; registrations, scopes, settings and authenticated sockets are real.
