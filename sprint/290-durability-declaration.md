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
- [ ] `EMIT_DEPLOY_DETACHED=1` (or the chosen name) allows a deploy from a shell
      carrying an unattended marker
- [ ] `EMIT_ALLOW_UNATTENDED_DEPLOY=1` still works and prints a deprecation
      notice — no wired project breaks on its next push
- [ ] With neither set, an agent-marked push is still refused and still writes no
      status record
- [ ] `EMIT_FORCE_DEPLOY=1` alone still does not bypass the gate
- [ ] The refusal message names `scripts/deploy-detached.sh` as the supported
      path, not just the env var
- [ ] In-flight records from both the bash and TS writers carry the launch mode
      with identical field names and JSON types
- [ ] `classifyRunState` is unchanged in behavior for records with and without
      the new field
- [ ] Test coverage in `scripts/lib/deploy-unattended-gate.test.sh`,
      `packages/core/src/deploy-records.test.ts`, and
      `packages/core/src/deploy-status.test.ts`
- [ ] `pnpm test:hooks` green under bash 3.2; `pnpm test`, `pnpm lint`,
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
