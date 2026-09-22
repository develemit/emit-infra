# Retry a docker build once when it fails on a transient network error
**Difficulty:** 3

> _Promoted from `backlog.md` by /start-sprint-auto's queue refill, 2026-09-22._
> _The other four items at the top of the backlog were checked first and found
> already shipped (lockfile-keyed deps — sprint 338; per-image progress — 339;
> detached push surviving teardown — `setsid` in `deploy-detached.sh`) or
> deliberately dropped (install dedupe — measured not worth it in 338)._

## Goal
A deploy whose image build dies on a transient registry/network error
(`FetchError`, `socket hang up`, `ECONNRESET`, `ETIMEDOUT`, a 5xx from the npm
registry) retries that one build once, before failing the deploy. Real build
errors (a type error, a missing file, an OOM) fail immediately as today.

## Reason
From the backlog, verbatim:

> (tastease deploy post-mortem, 2026-08-27) **Retry the docker build once on
> transient registry failure before failing the deploy.** Two consecutive
> deploys died at `pnpm install` on FetchError/socket-hang-up (different package
> each time; host-to-registry was 10/10 healthy). A single retry of the failed
> service build would have saved both. Cheap, no correctness risk.

A failed deploy costs a full CI + build cycle (tens of minutes) plus a human
re-push. One bounded retry of only the failing service is cheap by comparison.

## Context

### Where builds run
`scripts/lib/docker-build.sh` (154 lines):
- `_buildx_logged svc …args` (≈line 80) runs `docker buildx build --progress=plain`,
  streaming output to a per-service log `${_EMIT_DEPLOY_LOG_FILE%.log}-${svc}.log`
  and, on failure, printing `✗ $svc build failed (exit N) — full log: …` plus
  the last 25 lines. With no deploy log file set, it runs unlogged.
- `build_image svc` (≈line 97) builds the main image, then each variant from
  `get_build_variants` inside a `| while read` loop (a pipeline subshell, so
  check how a failure inside it propagates before changing anything).
- Called in parallel by `run_build_fanout` in `scripts/lib/deploy-plan.sh`
  (≈line 64), which `wait`s each pid and calls `$on_fail` on non-zero.

### Design to implement
- Retry at the `_buildx_logged` level (one `docker buildx build` invocation),
  so a variant that fails doesn't redo the main image, and vice versa.
- Retry **only** when the failed attempt's log output matches a transient
  pattern. Put the classifier in its own small function (e.g.
  `_build_failure_is_transient <logfile>`) with the pattern list in one place:
  `ERR_PNPM_FETCH|FetchError|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|
  ERR_SOCKET_TIMEOUT|5[0-9][0-9] (Bad Gateway|Service Unavailable|Gateway Timeout)|
  TLS handshake timeout|i/o timeout`. Check only the output of the attempt that
  just failed, not the whole appended log file, or an earlier retry's text
  would match forever.
- At most **one** retry, after a short pause (e.g. 10 s). Print a clear line:
  `↻ <svc> build hit a transient network error — retrying once`.
- Unlogged mode (no `_EMIT_DEPLOY_LOG_FILE`) has no output to classify: no retry
  there, and say so in a comment.
- BuildKit layer cache means a retry usually resumes quickly; no cache changes needed.

### Conventions
- Shell libs have sibling `*.test.sh` suites registered in root `package.json`
  `test:hooks`; `scripts/lib/docker-build.test.sh` exists. Stub
  `docker` as a shell function that fails with a canned message on the first
  call and succeeds on the second (read how existing suites stub externals first).
- Suite: `pnpm test:hooks`, plus `bash -n scripts/hooks/pre-push`. The change is
  shell-only; `pnpm test`/`typecheck`/`lint` should be unaffected but run them.
- **Do not deploy anything** to verify this. The tests are the verification.
- Never put real tokens in fixtures.

## Tasks
1. Add the transient-failure classifier with its pattern list.
2. Wrap the build invocation in `_buildx_logged` with a single classified retry.
3. Confirm how a failure inside the variants `while` loop propagates, and keep
   the retry working for variants too.
4. Cover it in `scripts/lib/docker-build.test.sh`.

## Files involved
- `scripts/lib/docker-build.sh` — classifier + one retry in `_buildx_logged`
- `scripts/lib/docker-build.test.sh` — new cases

## Acceptance criteria
- [x] A build that fails once with a transient message and then succeeds
      completes successfully, and the retry line is printed — covered in
      `docker-build.test.sh`
- [x] A build that fails with a non-transient error (e.g. `error TS2322`) is not
      retried and fails — covered
- [x] A build that fails transiently twice fails after exactly one retry — covered
- [x] The classifier only reads the failing attempt's output — covered by a test
      where an earlier attempt's transient text is already in the log file
- [x] Unlogged mode is unchanged (no retry) — covered
- [x] `pnpm test:hooks`, `pnpm test`, `pnpm typecheck`, `pnpm lint` pass and
      `bash -n scripts/hooks/pre-push` is clean

## Out of scope
- Retrying `retag_image`, `docker push` or Ansible steps.
- Retrying at the whole-deploy level.
- Changing parallelism in `run_build_fanout`.

## Completed

**Date:** 2026-09-22

### Summary
Added a single classified retry for transient registry/network failures in
`scripts/lib/docker-build.sh`'s `_buildx_logged` — the one function every
build invocation (main image + each variant) already funnels through, so no
caller changes were needed. `_build_failure_is_transient <logfile> [start_line]`
greps a pattern list (`FetchError`, `socket hang up`, `ECONNRESET`,
`ETIMEDOUT`, `EAI_AGAIN`, 5xx registry errors, TLS/i-o timeouts, etc.) against
only the lines appended since `start_line`, so a stale transient message from
an earlier attempt in the same shared per-service log can't trigger a retry
forever. On a transient failure, `_buildx_logged` prints `↻ <svc> build hit a
transient network error — retrying once`, sleeps
`${_EMIT_BUILD_RETRY_DELAY:-10}` seconds (overridable so tests run at 0), and
re-runs the exact same `docker buildx build` invocation once. A non-transient
failure, or a second transient failure, falls through to the existing
`✗ ... build failed` banner unchanged. Unlogged mode (no `_EMIT_DEPLOY_LOG_FILE`)
has no log to classify against, so it still runs once with no retry, as before.

Confirmed (per Task 3) that `build_image`'s pipeline `while read` loop over
variants returns 0 when a service has no variants at all, regardless of
whether the main (non-variant) build succeeded — a pre-existing quirk, not
something this sprint's retry touches or fixes, since the retry lives entirely
inside `_buildx_logged` and its own return code is unaffected by how the
caller's loop later propagates it. Noted as a follow-up below rather than
fixed, since it's outside this sprint's stated scope.

### Files changed
- `scripts/lib/docker-build.sh` — added `_EMIT_TRANSIENT_BUILD_PATTERN`,
  `_build_failure_is_transient`, and a single classified retry inside
  `_buildx_logged`
- `scripts/lib/docker-build.test.sh` — added a `_build_failure_is_transient /
  retry` section: transient-then-success, non-transient-fails-immediately,
  transient-twice-fails-after-one-retry, and classifier-scoped-to-this-attempt

### Verification
- `bash scripts/lib/docker-build.test.sh`: 24/24 pass
- `pnpm test:hooks`: full chain (18 suites) exits 0
- `pnpm test`: 280/280 pass (28 test files)
- `pnpm typecheck`: clean (5 projects)
- `pnpm lint`: clean (5 projects)
- `bash -n scripts/hooks/pre-push`: clean

### Follow-ups
- `[defer]` `build_image` in `scripts/lib/docker-build.sh` doesn't check the
  main (non-variant) build's exit code before proceeding to the variants
  loop, and when a service has no variants, the trailing
  `get_build_variants | while read` pipeline always returns 0 — so a failed
  main build with no variants is silently treated as success by
  `run_build_fanout`. Pre-existing, unrelated to this sprint's retry logic;
  worth its own sprint since it's a real correctness gap in failure detection.
