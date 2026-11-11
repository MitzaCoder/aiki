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
