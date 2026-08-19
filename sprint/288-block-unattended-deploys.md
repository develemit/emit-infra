# Refuse to start a production deploy from a teardown-prone shell
**Difficulty:** 4

## Goal
The deploy phase of the pre-push hook refuses to start when it detects it is
running inside an ephemeral agent or CI shell, prints why and how to override,
and exits non-zero **without** writing an in-flight `.deploy-status.json`
record. The CI phase is unaffected. A documented opt-out exists for legitimate
headless use.

## Reason
On 2026-08-19 an emit-social deploy was launched from an agent session's
background shell. The shell was torn down mid-build during
`==> Building web...`, `deploy_done` never ran, and `.deploy-status.json` froze
at `deploying` / 66% for sha `6423d5d` while `origin/main` stayed at `42faf27`
— prod was never touched, but nothing on the machine could say so.

Sprints 282–287 all respond to that incident, and every one of them is
*detection and recovery*: trap signals so an interrupted run marks itself (282),
write liveness metadata (283), classify staleness (284), render it honestly
(285), reconcile it (286), document it (287). None of them stop the deploy from
being launched in a shell that can be killed. This sprint is the prevention
layer — the cheapest possible fix, because a deploy that never starts in a
doomed shell needs no traps, no heartbeat, no reconcile, and no runbook.

## Context

### Where the gate goes — this placement is load-bearing
`scripts/hooks/pre-push` runs two phases. The deploy phase has a strict ordering
constraint:

- `run_ci` (~line 66–90) — must keep running regardless of this gate.
- Deploy gates that all `exit 0` (skip deploy, allow the push): pushing-to-main
  check (~99), missing `GHCR_ORG` (~113), dry-run guard (~122), optional
  `EMIT_DEPLOY_CONFIRM` prompt (~129), ignored-paths filter (~145).
- **Line 159**: `_fail_deploy()` is defined and installed as the `ERR` trap at
  line 164. It calls `deploy_done failed`.
- **Line 215**: `deploy_init "$STEPS"` — the first write of an in-flight record.

The new gate must land **after the ignored-paths filter (~line 149) and before
`_fail_deploy` is defined at line 159.** Placing it later means a non-zero exit
fires the `ERR` trap, which calls `deploy_done failed` with
`_EMIT_STARTED_EPOCH` unset (`deploy_init` never ran) — that both writes a
status record the sprint promised not to write and throws a bash arithmetic
error. Placing it earlier would gate pushes that were going to skip the deploy
anyway.

### Detection — do not reuse the existing tty check
The hook already has a tty-looking check at line 129
(`[[ "${EMIT_DEPLOY_CONFIRM:-0}" == "1" && -e /dev/tty ]]`). **It is not a valid
detector for this and must not be copied.** Verified empirically inside the
exact kind of agent shell that caused the incident:

- `-e /dev/tty` → **true**. The device node exists even with no controlling
  terminal. A gate built on this is a silent no-op.
- `[ -t 0 ]` → false, but **meaningless here**: git feeds the ref list to every
  pre-push hook on stdin (see the `while read -r _local_ref ...` loop at line
  99), so stdin is never a tty, interactive or not.
- `( : < /dev/tty ) 2>/dev/null` → **fails**. Actually *opening* the controlling
  terminal is the correct POSIX check.
- `[ -t 2 ]` → false. Works, but a legitimate interactive user running
  `git push 2>log` would also trip it, so prefer the `/dev/tty` open test.
- `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID` → set.

### The two-signal design (decided — do not re-litigate)
1. **Blocking signal: environment markers.** Block when any of `CLAUDECODE`,
   `CLAUDE_CODE_ENTRYPOINT`, or `CI` is non-empty. Precise, catches the actual
   incident, and produces zero false positives for GUI git clients.
2. **Warning-only signal: no controlling terminal.** If
   `( : < /dev/tty )` fails but no env marker is set, print a warning and
   **continue**. This deliberately does not block, because GUI git clients
   (VSCode's Source Control panel, Tower, GitHub Desktop) also have no
   controlling terminal and blocking them would break a normal workflow.

Ship it blocking from day one — no warn-only shakeout phase. The escape hatch
makes it recoverable in seconds.

### Fleet blast radius
`scripts/hooks/pre-push` is symlinked into every wired project via
`core.hooksPath=.githooks` (verified on emit-social:
`.githooks/pre-push -> ../../emit-infra/scripts/hooks/pre-push`). There is no
version pinning — editing it changes behavior for the whole fleet on the next
push. Run `pnpm test:hooks` before committing.

### Conventions
- **Bash 3.2.57** is the target (macOS system bash). No `declare -A`, no
  `${var^^}`.
- `detect_dry_run_push` in `scripts/lib/deploy-plan.sh` is the naming and
  structural precedent for a "detect how we were invoked" helper — follow it,
  including the function-list comment at the top of that file.
- Existing overrides are `EMIT_FORCE_DEPLOY`, `EMIT_DEPLOY_CONFIRM`,
  `EMIT_BUILD_PARALLEL`. Use `EMIT_ALLOW_UNATTENDED_DEPLOY` for the new opt-out
  — it does not collide with any existing `EMIT_*` name.
- `EMIT_FORCE_DEPLOY` must **not** override this gate. It exists to force a
  deploy past the *path* filters; conflating it with "I accept a killable
  shell" would silently re-open the incident for anyone already exporting it.

## Tasks
1. Add `detect_unattended_shell` to `scripts/lib/deploy-plan.sh`, next to
   `detect_dry_run_push`, and add it to that file's header function list.
   Return 0 when any blocking env marker is set. Keep the marker list in one
   clearly-commented variable so it is easy to extend.
2. Add a separate `has_controlling_terminal` helper (or fold it in as a second
   return code) implementing the `( : < /dev/tty ) 2>/dev/null` test. Do not
   use `-e /dev/tty`.
3. Insert the gate in `scripts/hooks/pre-push` immediately after the
   ignored-paths filter and **before** the `_fail_deploy` definition at line
   159. On block: print the project name, the marker that triggered it, the
   reason (a killed shell leaves a deploy half-finished), and the exact
   `EMIT_ALLOW_UNATTENDED_DEPLOY=1 git push` override line. Then `exit 1`.
4. Implement the warning path: no controlling terminal and no env marker →
   print a one-line warning to stderr and continue to the deploy.
5. Honor `EMIT_ALLOW_UNATTENDED_DEPLOY=1` as a full bypass of both the block and
   the warning. Confirm `EMIT_FORCE_DEPLOY` does *not* bypass it.
6. Verify no status record is written on the blocked path — no
   `.deploy-status.json` mutation, no `.deploy-history.jsonl` line, no stray
   `.deploy-logs` entry.
7. Extend `scripts/lib/deploy-plan.test.sh` (which already has the precedent for
   spawning the hook in a scratch repo and asserting on its decision) with
   cases covering: blocked when `CLAUDECODE=1`; blocked when `CI=1`; allowed
   when `EMIT_ALLOW_UNATTENDED_DEPLOY=1`; allowed with no markers; and
   `.deploy-status.json` untouched after a block.
8. Confirm the existing gates still short-circuit first — a dry-run push and an
   ignored-paths-only push must still `exit 0` under `CLAUDECODE=1` rather than
   hitting the new block. Add a regression case for at least the ignored-paths
   ordering.
9. Document the gate in `docs/PRE-PUSH-HOOK.md`: the env markers, the opt-out,
   why `EMIT_FORCE_DEPLOY` deliberately does not bypass it, and why `-e
   /dev/tty` is not used. Cross-reference sprint 287's operator-guidance
   section rather than duplicating it.
10. `bash -n` on every touched script, then `pnpm test:hooks` under `/bin/bash`
    (3.2), then one real push on a wired project to confirm no regression.

## Files involved
- `scripts/lib/deploy-plan.sh` — add `detect_unattended_shell` and the
  controlling-terminal helper; update the header function list
- `scripts/hooks/pre-push` — install the gate between the ignored-paths filter
  and the `_fail_deploy` definition
- `scripts/lib/deploy-plan.test.sh` — the five gate cases plus the ordering
  regression
- `docs/PRE-PUSH-HOOK.md` — document the gate, the markers, and the opt-out

## Acceptance criteria
- [ ] A push to `main` from a shell with `CLAUDECODE=1` set exits non-zero with
      an explanatory message naming `EMIT_ALLOW_UNATTENDED_DEPLOY`
- [ ] After that blocked push, `.deploy-status.json` is byte-identical to its
      pre-push contents and no `.deploy-history.jsonl` line was appended
- [ ] `EMIT_ALLOW_UNATTENDED_DEPLOY=1` allows the deploy to proceed normally
- [ ] `EMIT_FORCE_DEPLOY=1` alone does **not** bypass the gate
- [ ] The CI phase runs to completion in a blocked push (the gate is deploy-only)
- [ ] A push with no controlling terminal but no env marker warns and proceeds
- [ ] Dry-run and ignored-paths-only pushes still `exit 0` before reaching the
      gate, even with `CLAUDECODE=1` set
- [ ] Test coverage in `scripts/lib/deploy-plan.test.sh` for all five gate cases
      in task 7 plus the ordering regression in task 8
- [ ] `pnpm test:hooks` green under bash 3.2; `bash -n` clean on all touched
      scripts; one real push verified end to end on a wired project

## Out of scope
- **Anything sprints 282–287 own.** Signal traps (282), liveness metadata (283),
  the staleness classifier (284), dashboard rendering (285), the reconcile
  command (286), and the runbook (287) are all still needed — prevention reduces
  how often they fire, it does not replace them. In particular, do not add
  signal handling here.
- Detecting *every* possible ephemeral runner. The marker list is deliberately a
  small, extensible denylist; a runner that sets none of them will fall through
  to the warning path. Widening it is a follow-up driven by real misses.
- Gating anything other than the deploy phase. CI must keep running everywhere.
- Blocking on absence of a controlling terminal. That was considered and
  rejected because it would break GUI git clients — revisit only with evidence
  that no one in the fleet pushes that way.
- Any change to `apps/cli`'s `emit-infra deploy` path. This gate is hook-only;
  a direct CLI deploy is an explicit operator action.
