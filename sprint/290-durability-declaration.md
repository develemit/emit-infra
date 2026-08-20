# Reframe the deploy gate as a durability declaration and record launch mode
**Difficulty:** 4

## Goal
The only way past the unattended-shell gate stops looking like a safety bypass
and starts meaning something specific and true: "this deploy is detached and
will outlive the process that started it." Every status record also states how
the deploy was launched, so a future post-mortem can tell a detached deploy from
a careless one.

## Reason
Sprint 289 restores agent-driven deploys by detaching the push and setting
`EMIT_ALLOW_UNATTENDED_DEPLOY=1`. That variable name is a problem. It reads as
"allow the unattended thing the gate is there to stop", so the obvious next move
for anyone who hits the gate — human or agent — is to paste it onto a plain
`git push` and carry on. That reintroduces exactly the 2026-08-19 failure the
gate was built to prevent, while looking like the sanctioned fix.

A name that asserts a *property the caller is responsible for* ("I have detached
this; it will survive me") is much harder to cargo-cult onto a bare push,
because the assertion is obviously false there.

The second half matters for the next incident. Right now, if a deploy dies, the
record says `interrupted` or classifies as `orphaned` but nothing says whether
it was launched durably. Stamping the launch mode into the record makes the
post-mortem question — "was this the detached path or someone pasting the
override?" — answerable from the artifact instead of from memory.

## Context

### Do not attempt auto-detection — this was measured, not assumed
On macOS with bash 3.2.57:
- Bash does **not** expose an inherited ignored `SIGHUP`. With an explicit
  `trap '' HUP` in the parent, the child's `trap -p HUP` still returns empty.
- `setsid` is **absent** on macOS.
- `nohup cmd &` leaves `pgid` unchanged.

There is no reliable in-band signal that a process is detached, so the gate
cannot verify the caller's claim. Record this finding in the code comment and in
the docs so a later sprint doesn't burn time rediscovering it. The declaration is
a contract with the caller, not a proof — say so plainly rather than implying the
gate validates it.

### Current gate shape
`scripts/hooks/pre-push` around line 161:
```bash
if [[ "${EMIT_ALLOW_UNATTENDED_DEPLOY:-0}" != "1" ]]; then
  if MARKER=$(detect_unattended_shell); then
    ... echo the refusal, name the override ... ; exit 1
  elif ! has_controlling_terminal; then
    ... warn and proceed ...
  fi
fi
```
- `EMIT_UNATTENDED_SHELL_MARKERS=(CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI)` at
  `scripts/lib/deploy-plan.sh:212`; `detect_unattended_shell` at 214;
  `has_controlling_terminal` at 227 (uses `( : < /dev/tty )` — **never**
  `-e /dev/tty`, which is true even in agent shells, and `[ -t 0 ]` is
  meaningless because git feeds the ref list on stdin).
- `EMIT_FORCE_DEPLOY` deliberately does **not** bypass this gate. Keep it that
  way.

### Placement is load-bearing — do not move the gate
Current anchors in `scripts/hooks/pre-push`: ignored-paths filter ends ~148,
gate at 161, `_fail_deploy()` at 178, `trap _fail_deploy ERR` at 183,
`deploy_init` at 234. The gate must stay **after** the ignored-paths filter and
**before** `_fail_deploy` is defined. Later, and a non-zero exit fires the ERR
trap, which calls `deploy_done failed` with `_EMIT_STARTED_EPOCH` unset — that
both writes a record the gate promised not to write and throws a bash
arithmetic error.

### Fleet blast radius and the transition
`scripts/hooks/pre-push` is symlinked into every wired project via
`core.hooksPath=.githooks` with no version pinning — a change here hits every
project on its next push. Sprint 289's `scripts/deploy-detached.sh` and the
`/deploy` skill will already be setting the old name, and the operator may have
the old name in muscle memory or in shell history. **Keep the old variable
working as a deprecated alias** rather than a hard cutover, and update 289's
script in the same commit so the two never disagree.

### Writers that must stay in sync
`.deploy-status.json` / `.ci-status.json` have two writers that mirror each
other deliberately: `scripts/lib/ci-utils.sh` (bash: `deploy_init`,
`deploy_step`, `ci_init`, `ci_step`) and `packages/core/src/deploy-records.ts`
(TS: `deployRecordInit`). Sprint 283 added `writer{pid,host,heartbeatAt}` to
both. Any field added here goes in both, same name, same JSON type.
`packages/core/src/deploy-status.ts`'s `classifyRunState` reads these records —
adding a field must not change any existing classification.

## Tasks
1. Choose the new variable name and write down the reasoning in a comment.
   Suggested: `EMIT_DEPLOY_DETACHED=1`, read as "the caller asserts this deploy
   is detached and will outlive the process that started it."
2. Accept the new name in the gate. Keep `EMIT_ALLOW_UNATTENDED_DEPLOY=1`
   working as a deprecated alias that prints a one-line deprecation notice to
   stderr and proceeds — do not break the fleet mid-transition.
3. Rewrite the refusal message to name the new variable and, more usefully, to
   point at `scripts/deploy-detached.sh` / the `/deploy` skill as the supported
   path. The message should make the detached script the obvious next step, not
   the raw env var.
4. Add the launch mode to the in-flight record in **both** writers — e.g.
   `"launch":{"mode":"detached|interactive|unattended-override","marker":"CLAUDECODE"}`.
   Decide whether it survives onto terminal records (recommended: yes, unlike
   `writer`, since the post-mortem value is entirely after the fact) and
   document the choice in both writers.
5. Update `scripts/deploy-detached.sh` (sprint 289) to set the new variable, in
   the same commit, so the script and the gate never disagree.
6. Confirm `classifyRunState` in `packages/core/src/deploy-status.ts` still
   classifies correctly with the new field present and with pre-290 records that
   lack it. Add cases to `packages/core/src/deploy-status.test.ts`.
7. Extend `scripts/lib/deploy-unattended-gate.test.sh`: the new variable allows
   the deploy; the deprecated alias still allows it and warns; neither name set
   still blocks; `EMIT_FORCE_DEPLOY` still does not bypass; and a blocked push
   still writes no status record.
8. Add a bash-side assertion that an in-flight record carries the launch mode,
   and a TS assertion in `packages/core/src/deploy-records.test.ts`.
9. `bash -n` on every touched script, then `pnpm test:hooks` under `/bin/bash`
   (3.2), then `pnpm test`, `pnpm lint`, `pnpm typecheck`.

## Files involved
- `scripts/hooks/pre-push` — accept the new variable, alias the old one, rewrite
  the refusal message
- `scripts/lib/deploy-plan.sh` — the declaration helper and the
  no-auto-detection comment
- `scripts/lib/ci-utils.sh` — stamp launch mode into the bash-written records
- `packages/core/src/deploy-records.ts` — mirror the field
- `packages/core/src/deploy-records.test.ts` — TS writer coverage
- `packages/core/src/deploy-status.test.ts` — classifier unaffected by the new
  field, and pre-290 records still handled
- `scripts/deploy-detached.sh` — switch to the new variable
- `scripts/lib/deploy-unattended-gate.test.sh` — the five gate cases in task 7

## Acceptance criteria
- [x] `EMIT_DEPLOY_DETACHED=1` (or the chosen name) allows a deploy from a shell
      carrying an unattended marker
- [x] `EMIT_ALLOW_UNATTENDED_DEPLOY=1` still works and prints a deprecation
      notice — no wired project breaks on its next push
- [x] With neither set, an agent-marked push is still refused and still writes no
      status record
- [x] `EMIT_FORCE_DEPLOY=1` alone still does not bypass the gate
- [x] The refusal message names `scripts/deploy-detached.sh` as the supported
      path, not just the env var
- [x] In-flight records from both the bash and TS writers carry the launch mode
      with identical field names and JSON types
- [x] `classifyRunState` is unchanged in behavior for records with and without
      the new field
- [x] Test coverage in `scripts/lib/deploy-unattended-gate.test.sh`,
      `packages/core/src/deploy-records.test.ts`, and
      `packages/core/src/deploy-status.test.ts`
- [x] `pnpm test:hooks` green under bash 3.2; `pnpm test`, `pnpm lint`,
      `pnpm typecheck` green; `bash -n` clean on all touched scripts

## Out of scope
- **Auto-detecting durability.** Measured impossible on this platform — see
  Context. Do not spend time on `SIGHUP`, `setsid`, or `pgid` heuristics.
- Removing the deprecated alias. That's a later cleanup once the fleet has run
  on the new name for a while; file it as a follow-up.
- Widening or narrowing `EMIT_UNATTENDED_SHELL_MARKERS`. Sprint 288 deliberately
  kept it small; changing it is driven by a real observed miss.
- Docs. Sprint 291 documents the finished vocabulary — follow the code, not a
  plan written before it.

## Completed

**Date:** 2026-08-20

### Summary
`EMIT_DEPLOY_DETACHED=1` is now the gate's honest declaration name; the old
`EMIT_ALLOW_UNATTENDED_DEPLOY=1` keeps working as a deprecated alias (warns to
stderr, still bypasses). Both live in `scripts/hooks/pre-push`'s gate, which
also now names `scripts/deploy-detached.sh` / the `/deploy` skill in its
refusal message instead of just the raw override. `scripts/deploy-detached.sh`
(sprint 289) was switched to set the new variable in the same commit so the
script and the gate never disagree.

Two new pure-ish helpers landed in `scripts/lib/deploy-plan.sh`:
`deploy_launch_mode` (echoes `"<mode> <marker>"`, called once per push right
after the gate decision) and `deploy_warn_deprecated_override` (the
deprecation-notice side effect, split out specifically so it's unit-testable
without spawning the real hook). Both are explicit that this is a
*declaration*, not a proof — the Context section's finding that macOS bash 3.2
has no reliable way to verify detachment (no inherited ignored `SIGHUP`, no
`setsid`, `nohup` doesn't change `pgid`) is restated in the code comment so a
later sprint doesn't rediscover it.

Both status-record writers (`scripts/lib/ci-utils.sh`'s `deploy_init`/
`deploy_step`/`deploy_done` and `packages/core/src/deploy-records.ts`'s
`deployRecordInit`/`deployRecordDone`) now stamp a `"launch":{"mode","marker"}`
block, deliberately present on both in-flight *and* terminal records (unlike
`"writer"`, which is in-flight-only) — it's a fact about how the deploy
started, not a liveness signal, so it stays useful after the deploy finishes.
The bash writer receives launch mode/marker as arguments threaded from the
hook's own gate decision; the TS writer has no gate to thread through (the CLI
`deploy` command isn't reached by `scripts/hooks/pre-push`'s gate — it runs
either as that hook's own final subprocess, after the gate already decided, or
as a direct standalone operator action), so `deployRecordInit` self-detects
launch mode from `process.env` via the new exported `deployLaunchMode()`,
mirroring the bash gate's exact three-value/marker-list logic by hand. Kept
deliberately in sync rather than sharing code, since one side is bash and the
other TypeScript. `classifyRunState` was extended with an optional `launch`
field on `DeployStatusRecord` but never reads it — confirmed unchanged
classification behavior with and without the field via new test cases.

One real (pre-existing, unrelated) bug surfaced while writing the new
past-the-gate end-to-end test cases: on bash 3.2.57, `pre-push`'s
`for svc in "${ALL_SVCS[@]}"` throws "unbound variable" under `set -u` when
`BG_SERVICES` is empty and `ALL_SVCS` is a zero-element array — a known bash
<4.4 empty-array/`set -u` interaction. Sprint 289's own end-to-end test never
hit this because its fixture used an empty `ci.ghcrOrg` to skip the deploy
phase entirely before reaching that line. This sprint's new "the gate accepts
the declaration" tests need to actually reach the deploy phase, so they hit it
directly. Fixed by giving the test fixture a one-service `blueGreen.services`
entry (not by touching `pre-push` itself, which is out of this sprint's
scope) — logged as a follow-up below since it's a real crash waiting for any
project whose `.emit-infra.json` has `blueGreen.services` unset or empty and
gets far enough to reach that line.

### Files changed
- `scripts/hooks/pre-push` — gate accepts `EMIT_DEPLOY_DETACHED=1`, keeps the
  deprecated alias working with a warning, rewrites the refusal message to
  point at `scripts/deploy-detached.sh`, stamps `LAUNCH_MODE`/`LAUNCH_MARKER`
  into `deploy_init`
- `scripts/lib/deploy-plan.sh` — added `deploy_launch_mode` and
  `deploy_warn_deprecated_override`, plus the no-auto-detection comment
- `scripts/lib/ci-utils.sh` — `deploy_init`/`deploy_step`/`deploy_done` accept
  and stamp launch mode/marker on in-flight and terminal deploy records
- `scripts/deploy-detached.sh` — launches with `EMIT_DEPLOY_DETACHED=1`
  instead of the deprecated alias
- `packages/core/src/deploy-records.ts` — added `deployLaunchMode()` and
  `DeployLaunch`, `DeployContext.launch`; both writers stamp it
- `packages/core/src/deploy-status.ts` — added optional `DeployLaunchInfo`/
  `launch` to `DeployStatusRecord` (read but not acted on)
- `packages/core/src/index.ts` — exported the new symbols
- `scripts/lib/deploy-unattended-gate.test.sh` — extended with
  `deploy_launch_mode`/`deploy_warn_deprecated_override` unit cases, renamed
  var references in existing mirror/end-to-end cases, and two new real
  end-to-end cases proving the gate accepts and stamps both the new var and
  the deprecated alias (via a `gh` shim so no real GHCR/docker network call
  happens)
- `scripts/lib/deploy-liveness.test.sh` — bash-side assertion that
  `deploy_init`/`deploy_done` carry `launch.mode`/`launch.marker`, and that it
  defaults to `interactive` with no args
- `packages/core/src/deploy-records.test.ts` — TS assertions for
  `deployLaunchMode()` and the stamped field on both writers
- `packages/core/src/deploy-status.test.ts` — `classifyRunState` unchanged
  with/without the `launch` field

### Verification
- `bash scripts/lib/deploy-unattended-gate.test.sh` under `/bin/bash` (3.2.57):
  34/34 pass, run 3x back-to-back with no flakes
- `bash scripts/lib/deploy-liveness.test.sh`: 17/17 pass
- `pnpm test:hooks` (all seven suites, `/bin/bash` 3.2.57): 152/152 pass, 0
  failed
- `bash -n` clean on `scripts/hooks/pre-push`, `scripts/lib/deploy-plan.sh`,
  `scripts/lib/ci-utils.sh`, `scripts/deploy-detached.sh`,
  `scripts/lib/deploy-unattended-gate.test.sh`,
  `scripts/lib/deploy-liveness.test.sh`
- `pnpm test`: 17 test files, 165 tests pass (includes the CLI's own
  `deploy.test.ts`, unaffected by the new `launch` field on the TS writer)
- `pnpm lint`: clean across all 5 projects
- `pnpm typecheck`: clean across all 5 projects
- Manually verified no strict/exact-key schema in `apps/api` or `apps/cli`
  parses `.deploy-status.json`/`.deploy-history.jsonl` in a way that would
  reject the new `launch` key (grepped for `.strict()`/`additionalProperties`
  usage against the status-record readers; none found)

### Follow-ups
- `[address-next]` `scripts/hooks/pre-push`'s `for svc in "${ALL_SVCS[@]}"`
  (~line 221) throws "unbound variable" under bash 3.2's `set -u` when
  `BG_SERVICES` is empty — i.e. any project whose `.emit-infra.json` omits
  `blueGreen.services` or sets it to `[]` and reaches that line (gate passed,
  `ci.ghcrOrg` set) will crash instead of cleanly skipping the build/retag
  loop. Pre-existing, not introduced by this sprint; worth a one-line
  `${ALL_SVCS[@]+"${ALL_SVCS[@]}"}` fix (same idiom already used for
  `TO_BUILD`/`TO_RETAG` a few lines below it) at the start of whichever sprint
  next touches this file.
- `[defer]` `scripts/hooks/pre-push` is now 302 lines and
  `scripts/lib/ci-utils.sh` is now 368 — both over the project's 300-line
  guideline (`ci-utils.sh` was already at 354 before this sprint). Neither
  splits cleanly without real restructuring: `pre-push` is a single git hook
  entry point with load-bearing line-ordering constraints documented inline,
  and `ci-utils.sh`'s ci/deploy functions are tightly coupled to shared
  writer-liveness/signal-handling state. Worth a dedicated sprint if either
  keeps growing.
- `[defer]` `deployLaunchMode()` (TS) and `deploy_launch_mode()` (bash)
  duplicate the same three-value/marker-list logic by hand across two
  languages, same as `EMIT_UNATTENDED_SHELL_MARKERS` already does for
  `detect_unattended_shell`. No shared source of truth exists for either;
  acceptable today since the marker list rarely changes, but a third
  implementation (e.g. a future dashboard-side check) would be a good trigger
  to extract one.
- `[defer]` `~/.claude/commands/deploy.md` (sprint 289, untracked) didn't need
  changes since it never references the env var directly — it wraps
  `scripts/deploy-detached.sh`, which already picked up the new name in this
  commit. Confirmed by grep; no drift introduced.
