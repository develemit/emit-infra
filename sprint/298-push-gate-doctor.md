# Add a push-gate doctor that proves a project's gate is runnable
**Difficulty:** 4

## Goal
`emit-infra` can answer "will this project's push gate actually pass?" without
pushing — by running each declared `ci.prePush` target in a scrubbed
environment and reporting which fail, plus a cheap static check for env-var
prefixes a project's `ci.sh` sets that the hook will not.

## Reason
On 2026-08-22 tastease's first `git push origin main` after **102 commits over
9 days** was rejected by the shared pre-push hook: `web:build` failed with
`ZodError: DATABASE_URL: expected string, received undefined`. The gate had
been un-runnable the whole time and nothing surfaced it.

The originating report blamed target-list drift — local `ci.sh` files checking
fewer targets than `ci.prePush` declares. **That diagnosis was wrong**, and the
sprint must not implement the fixes it proposed. Verified across the fleet
2026-08-22:

| project | `ci.sh` actually runs | `ci.prePush` declares |
|---|---|---|
| develemail | format, lint, typecheck, test, build | same — no drift |
| diner-decider | format, lint, typecheck, build, test (+ real DB) | a superset |
| tastease | typecheck, build, test | **exact match** |
| emit-vision | lint, typecheck, test, build | + check-tokens, i18n-audit |
| emit-social, emit-billing | *(no `ci.sh`)* | full lists declared |

tastease's target list **already matched** and still gave a false green: its
`ci.sh` prefixed `SKIP_ENV_VALIDATION=1` as a shell variable while the hook
sets no environment (removed in tastease commit `66f0c25`). The divergence was
environmental, not target-list — so a canonical generated runner, or a check
comparing target lists, would both have passed tastease.

The deeper finding, also verified 2026-08-22: **5 of 6 projects' test suites
resolve a live dev postgres**, so the gate's outcome depends on whether that
container happens to be running. Running each project's `test` target under
hook conditions:

- pass: emit-social, emit-vision, tastease — **all three only because their
  containers were up at the time**
- pass: develemail
- **fail: diner-decider (98 unpushed, 3 weeks) and emit-billing (15 unpushed)**

emit-billing has since been fixed (commit `a6df8f0` in that repo) by making its
`test` target self-sufficient. diner-decider is still broken.

A static scan would have found none of this — both failures are ambient
container state, not anything written in a script. Only actually running the
targets finds it.

## Context

### How the gate runs targets — do not change this
`scripts/hooks/pre-push`'s `run_ci()` loops `for target in $CI_TARGETS`,
special-cases `format` to `pnpm format` (because `nx affected -t format` finds
no projects and silently no-ops), and otherwise runs:

```bash
pnpm nx affected -t "$target" --base=origin/main
```

with **no environment injection**. `ENV_FILE` is sourced at
`scripts/hooks/pre-push:183`, *after* CI, with the inline comment "source env
file for deploy phase (after CI so tests use local env)". This is deliberate
and correct. The doctor must **replicate** this invocation, not change it.

### Where build-time values are supposed to come from
`ci.buildArgs` in `.emit-infra.json`, applied during the Docker build in the
deploy phase after `ENV_FILE` is sourced. Six of seven projects use it
(emit-social/web, emit-vision/web+marketing, develemail/web, diner-decider/web,
tastease/web+marketing). An nx `build` target in CI must be self-sufficient —
that is the convention this sprint documents.

### Precedents to follow
- `apps/cli/src/commands/db-doctor.ts` — read-only fleet scan → print report →
  `process.exit(1)` on findings. Closest shape; ~50 lines. It has a `--roots`
  option defaulting to `~/projects`.
- `apps/cli/src/lib/db-doctor-report.ts` — the report/printing split.
- `packages/core/src/db-scan-fleet.ts`'s `scanFleet(rootsDir)` is the
  fleet-walk **pattern**, but returns `RepoDbInfo` and is database-specific —
  this sprint needs its own walk that reads each repo's `.emit-infra.json`
  `ci.prePush`. Don't force-fit `scanFleet`.
- CLI commands live in `apps/cli/src/commands/` exporting
  `register<Name>(program)` wiring a commander subcommand, registered in
  `apps/cli/src/index.ts`.
- `apps/cli/dist` is a build artifact the pre-push hook executes — rebuild
  after changing CLI source.

### Execution hazards
- Running arbitrary nx targets across fleet repos is slow. Support
  `--project <name>` to check one repo, and make full-fleet opt-in.
- Scrub the environment the way the hook leaves it — do **not** merely unset a
  hand-picked list. Getting this wrong makes the doctor either miss failures or
  invent them. Note that the doctor itself runs inside a shell that may carry
  `CLAUDECODE`, `TURBOPACK`, `DATABASE_URL`, etc.
- A target could wait on stdin. Never inherit an interactive stdin, and bound
  each target with a timeout so the doctor can't hang the fleet sweep.
- Report per-target results; a single "failed" verdict for a 6-target project
  is not actionable.

## Tasks
1. Add a `gate-doctor` command (or an equivalent rule inside `audit`) following
   `db-doctor.ts`'s scan → report → exit-1 shape, with `--roots` and
   `--project` options.
2. Implement the **static** layer: parse each project's `scripts/ci.sh` for
   env-var assignments prefixed onto a command (`FOO=1 pnpm nx ...`) and flag
   them, since the hook sets none. This is the check that catches tastease's
   original bug by inspection.
3. Implement the **dynamic** layer: for each declared `ci.prePush` target, run
   the hook's exact invocation in a scrubbed environment and record pass/fail
   plus the first meaningful error line. Bound with a timeout; never inherit
   interactive stdin.
4. Report per project and per target. Exit non-zero when any declared target
   fails, so this is usable as a check.
5. Make the dynamic layer opt-in or clearly flagged as slow — it runs real
   builds and test suites.
6. Document the convention in `docs/PRE-PUSH-HOOK.md`: CI targets must be
   self-sufficient (no reliance on caller-supplied env or on a container the
   caller happened to start), and build-time values go through `ci.buildArgs`.
   Cite emit-billing `a6df8f0` and tastease `66f0c25` as the reference fixes.
7. Run the doctor across the fleet and report findings. diner-decider is
   expected to fail its `test` target — confirm the doctor detects it.

## Files involved
- new file: `apps/cli/src/commands/gate-doctor.ts` — the command
- new file: `apps/cli/src/lib/gate-doctor-report.ts` — report/printing split,
  mirroring `db-doctor-report.ts`
- new file: `apps/cli/src/commands/gate-doctor.test.ts` — coverage
- `apps/cli/src/index.ts` — register the command
- `docs/PRE-PUSH-HOOK.md` — the self-sufficiency convention (task 6)

## Acceptance criteria
- [ ] The static layer flags a `FOO=1 pnpm nx ...` prefix in a project's
      `ci.sh` — asserted by a test using a fixture reproducing tastease's
      removed `SKIP_ENV_VALIDATION=1 pnpm nx affected -t build` line
- [ ] The dynamic layer runs the hook's exact invocation
      (`pnpm nx affected -t <target> --base=origin/main`, `format` special-cased
      to `pnpm format`) in a scrubbed environment
- [ ] A project whose target fails only because a container isn't running is
      reported as failing — this is the emit-billing/diner-decider case and the
      static layer cannot catch it
- [ ] Per-target results are reported, not a single per-project verdict
- [ ] The command exits non-zero when any declared target fails
- [ ] A target that reads stdin cannot hang the run — bounded by a timeout
- [ ] Test coverage in `apps/cli/src/commands/gate-doctor.test.ts` for the
      static parser, the scrubbing, and the report shape
- [ ] `docs/PRE-PUSH-HOOK.md` documents the self-sufficiency convention and
      `ci.buildArgs`
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` green; `apps/cli/dist` rebuilt

## Out of scope
- **Owning a canonical local-CI runner.** diner-decider's `ci.sh` legitimately
  starts a postgres container, migrates and seeds before testing; a generated
  runner would fight that. All four existing `ci.sh` files already source
  `scripts/lib/ci-utils.sh`, so emit-infra already owns the reporting contract
  — that is the right amount of ownership.
- **Comparing `ci.sh`'s target list against `ci.prePush`.** It would have
  passed tastease. Don't build it as the primary check.
- **Changing the hook's no-env CI phase or the `ENV_FILE` ordering.**
- Fixing the projects the doctor finds. Report them; each repo's fix is its
  own change (emit-billing's was `a6df8f0`).
- The gate-staleness signal — that's sprint 299.
