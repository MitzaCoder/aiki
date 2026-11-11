# First release workflow failure: runner tools and test ordering

Run [43047820705](https://github.com/MitzaCoder/aiki/actions/runs/43047820705)
checked `b7cf8f27a8e7648e6866fbde0e6aed4870643eb6`. Its root test step ended
with 2,202 passes, six optional-tool skips and five failures. Typecheck and later
steps never ran. No draft or assets were produced. This repair does not push,
retarget the tag or publish; the owner chooses the next release action.

## Causes and fixes

| Failure | Evidence / cause | Fix |
| --- | --- | --- |
| Schedule keeps an isolated workspace | Direct `Bun.spawn(["jj", ...])` throws ENOENT before workspace setup | Install the real pinned jj before root tests |
| Worker gets/removes its own workspace | Same ENOENT at the first `jj git init` | Same CI prerequisite; retain the integration test |
| Worker executes/forgets isolated work | Same ENOENT at the first `jj git init` | Same CI prerequisite; retain the integration test |
| Storage lists/cleans worker workspaces | Same ENOENT at the first `jj git init` | Same CI prerequisite; retain the integration test |
| Deploy writes release, drains, then checks health | All earlier health/success/busy assertions passed; wall-clock-filtered post-restart request list was empty | Use a shared append-only event trace rather than compare shell and JS clocks; assert drain/status before restart and list/page after it |

The workflow downloads upstream `jj-vcs/jj` v0.47.1's Linux x86-64 musl archive.
SHA-256: `d4b657f622ee50929c8916466dfa3d6a6c17a0a32b50e7b2c793707ec9ebcad7`.
The digest was obtained from the release asset's GitHub API digest and independently
checked against the downloaded bytes. This is the exact binary used in the clean
environment reproduction. Version reporting makes missing/changed tools visible.

No Git identity override is needed: the four tests pass with empty global/system
Git configuration and no jj user identity once jj is present. They create synthetic
repositories; explicit Git commits in fixtures already supply their own identities.
USER/LOGNAME are set in the reproduction, as on GitHub. No personal HOME/config is
loaded. A missing USER was a separate earlier local harness mistake, not this CI run.

## The deploy assertion's evidence boundary

The runner reported Ubuntu 26.04.1 (`ubuntu-26.04`, image `20261101.186.1`) and Git
2.56.0, with Bun 1.4.4 installed. Its advertised coreutils package is transitional;
the current matching Ubuntu container's date command is uutils coreutils 0.10.0,
whereas the development host uses GNU date. Different date implementations,
precision, or wall-clock adjustments are not a sound way to order processes.

The failed run did **not** log the restart timestamp or request timestamps. It is
therefore not possible to prove which particular formatting/clock discrepancy
triggered that assertion from the available log. Do not describe this as a proven
CPU-speed, permission, NTP or specific uutils-version bug. The original targeted
test passed in a clean native environment and a current Ubuntu 26.04 container.
A synthetic date implementation returning nanosecond-width output for `%3N`
reproduced the exact CI failure: every request sorted before the apparent restart,
so the post-restart list was empty despite successful deep checks.

The fix removes that unsupported inference entirely, for both deploy-order tests.
The fake backend appends each request type before answering; the systemctl stub
appends the restart marker to the same file before returning. The deploy waits for
each phase, and these short synchronous append writes preserve causal order without
clock comparisons or extra sleeps. Assertions still require one restart, at least
two preceding status requests, and subsequent project list/page calls. Drain tests
still require exactly two drains, both before restart. A second test case installs
the incompatible date implementation so the regression remains covered. Production
deploy and health-check code are unchanged.

## Reproduction and verification

All test data, repository/config/agent paths and HOME directories are synthetic and
isolated; exact local paths/logs are in the ignored T71 evidence, not this document.
No real service, installed backend state, physical device or provider is used.

- Clean `env -i`: CI/GitHub flags, USER/LOGNAME, UTC locale, explicit temporary
  HOME/TMP/XDG paths, empty Git config, and a curated PATH without jj/zellij/fish.
  The four targeted workspace cases fail with the same ENOENT as GitHub.
- Add only the verified jj archive: the same four cases pass (51 assertions),
  without adding identity, zellij, fish or changing the tests.
- Original deploy test with incompatible date precision: same `projects.list`
  assertion failure. Fixed deploy cases plus drain and four workspace tests:
  seven passes, 90 assertions in the same clean environment.
- A read-only Ubuntu 26.04 container with no external network uses distro userland,
  matching Bun/Git/jj, a temporary HOME and an empty Git config. The current image
  digest and final full-suite results are attached to T71. It cannot reproduce the
  original remote image's exact clock history; it is not an assertion that a new
  GitHub workflow run has succeeded.
- Full root/typecheck, web check/test/build, Android unit/assembly/lint and neutral
  signed-release checks, plus private/public-CI guards, are run on the committed
  repair tip. Final counts and source hash are recorded on T71, not guessed here.

No new skip or continue-on-error path is added. Fish login and live zellij tests
already explain their skips when those optional tools are genuinely unavailable;
normal host full gates continue to execute that coverage where available.

## Second run: browser setup and check-before-retag

[43057627821](https://github.com/MitzaCoder/aiki/actions/runs/43057627821) no longer
failed those five cases. The Markdown test's beforeAll instead failed after about
26.6 seconds. It selected `process.env.CHROMIUM_BIN ?? 'chromium'`; CI had no override.
The runner image's [browser installation script](https://github.com/actions/runner-images/blob/ubuntu26/20261101.186/images/ubuntu/scripts/build/install-google-chrome.sh)
installs a full rolling Chromium snapshot under `/usr/local/share/chromium/chrome-linux/chrome`
and symlinks `/usr/bin/chromium` to it. The image report listed Chromium 156.0.8078.0.
It was neither the developer's browser nor a pinned headless shell.

The launcher wrapped full Chromium with `timeout 25 setsid -f --wait`, always disabled
the sandbox, omitted the shared-memory workaround and read stdout before stderr.
Its 60-second test hook could not override the inner 25-second startup bound. The
log contains repeated D-Bus address/service errors, but does not prove a particular
D-Bus defect caused the delay. Serial pipe draining and detached descendants were
additional lifecycle risks, not proven causes of this particular run.

The shared support in `apps/web/test/support/chromium.ts` now:

- uses the exact CHROMIUM_BIN supplied by CI, with no fallback if that explicit
  executable fails; local developers can provide a browser or use an installed one;
- starts a private profile in headless mode with disabled shared-memory dependence,
  background networking, first-run UI and component updates;
- replaces inherited desktop-session bus discovery with a non-existent private
  Unix address so no desktop session/service is required; harmless diagnostics are
  still collected rather than silently discarded;
- retains the sandbox for ordinary local users; explicit CHROMIUM_NO_SANDBOX=1 is
  used only for trusted test fixtures where downloaded CFT's Ubuntu AppArmor/user-
  namespace restrictions require it, and root launches necessarily disable it;
- drains both pipes concurrently, reports exit/timeout plus diagnostic tail, allows
  90 seconds inside a 120-second hook and kills only its owned process group.

CI caches only the CFT headless-shell 157.0.8103.50 archive and verifies SHA-256
`7bf0d41e424efd1d6281c4162993ab9dc5de92fac213c211614905a71c057d0f` before fresh extraction.
The official download is pinned in `scripts/setup-test-browser.sh`. Run that script
with cache/output directories on Linux, then set CHROMIUM_BIN to its printed path.
Standard Chromium shared libraries are required (present on the Ubuntu runner).
Nix developers can use their existing Chromium wrapper instead; no global browser,
profile, D-Bus service or system packages are modified by the test helper.
A repository-wide test search found no other direct browser launcher to migrate.
Helper regressions cover sandbox flags, URL escaping, pipe pressure, explicit
failures and timeout cleanup; the original five real DOM/sanitizer assertions remain.

To avoid further tag churn, manual `workflow_dispatch` and pushes to temporary
`ci/release-check` run the same install/root/web/typecheck/protocol/guard job with
read-only contents permission. A separate job needs those checks and is guarded by
both push-event and tag-ref conditions before acquiring release write permission.
Dispatching any ref, even a tag, cannot stage or publish a release. A branch push
also provides a check when GitHub has not yet exposed an unmerged dispatch trigger.
The owner alone advances main/tag after a successful actual GitHub check. Remove
the temporary branch after completion, not while a queued checkout still needs it.
