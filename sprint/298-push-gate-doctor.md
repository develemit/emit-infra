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
- [x] The static layer flags a `FOO=1 pnpm nx ...` prefix in a project's
      `ci.sh` — asserted by a test using a fixture reproducing tastease's
      removed `SKIP_ENV_VALIDATION=1 pnpm nx affected -t build` line
- [x] The dynamic layer runs the hook's exact invocation
      (`pnpm nx affected -t <target> --base=origin/main`, `format` special-cased
      to `pnpm format`) in a scrubbed environment
- [x] A project whose target fails only because a container isn't running is
      reported as failing — this is the emit-billing/diner-decider case and the
      static layer cannot catch it
- [x] Per-target results are reported, not a single per-project verdict
- [x] The command exits non-zero when any declared target fails
- [x] A target that reads stdin cannot hang the run — bounded by a timeout
- [x] Test coverage in `apps/cli/src/commands/gate-doctor.test.ts` for the
      static parser, the scrubbing, and the report shape
- [x] `docs/PRE-PUSH-HOOK.md` documents the self-sufficiency convention and
      `ci.buildArgs`
- [x] `pnpm test`, `pnpm lint`, `pnpm typecheck` green; `apps/cli/dist` rebuilt

## Completed

**Date:** 2026-08-23

### Summary
Added `emit-infra gate-doctor`, following `db-doctor.ts`'s scan → report →
exit-1 shape. It has two independent layers, matching the sprint's own
diagnosis that tastease's bug and the diner-decider/emit-billing bug are two
different failure classes that need two different checks:

**Static layer** (`gate-doctor-static.ts`) parses each project's
`scripts/ci.sh` for a literal env var prefixed directly onto a command (e.g.
`SKIP_ENV_VALIDATION=1 pnpm nx affected -t build`). The regex deliberately
restricts the assigned value to a simple literal — no quotes, `$`, or
parens — which is what actually separates tastease's bug from ordinary shell
plumbing. A first draft used a looser regex and, run live against the real
fleet, produced false positives on every project's `ROOT="$(cd ...)"` /
`SHA=$(git rev-parse HEAD)` lines and on diner-decider's legitimate
`DATABASE_URL="$CI_DB_URL" pnpm nx run-many -t test` (self-computed from a
container ci.sh itself starts — explicitly called out as legitimate in this
sprint's Out of scope). Running the doctor against the real fleet during
implementation is what caught this; it's now a regression test.

**Dynamic layer** (`gate-doctor-run.ts`, opt-in via `--dynamic`) runs each
declared target through `execa` with `extendEnv: false` and an **allowlisted**
environment (`gate-doctor-env.ts`) — PATH/HOME/USER/SHELL/LANG/TERM/TMPDIR and
nothing else — rather than unsetting a hand-picked list of known-bad names.
The sprint's own history is the argument for allowlisting over denylisting:
sprint 295's dashboard build fix first unset only `NODE_ENV`, missed
`TURBOPACK`, and its own acceptance criterion ran under `env -u TURBOPACK`,
hiding the very leak it needed to prove immune to. An allowlist drops an
unknown future leak by construction. `stdin: 'ignore'` plus a `timeout` option
(default 600s, `--timeout` to override) bound a hung target.

Both `diner-decider` and `emit-billing` — the two repos this sprint's
investigation found failing their `test` target under hook conditions — now
pass under `gate-doctor --dynamic`. Both were fixed independently the same
day this sprint ran (diner-decider `6568408`, "provision an isolated test
database so the push gate can run tests"; emit-billing `a6df8f0`, cited
directly in the sprint's Reason section). The doctor can no longer reproduce
the historical case live, so the dynamic layer's failure-detection path was
instead verified with a synthetic fixture repo with no `package.json` —
`gate-doctor --dynamic` against it reports `✖ test — ERR_PNPM_NO_IMPORTER_...`
and exits 1, proving the mechanism (real subprocess, scrubbed env, exit-code
capture, first-error-line extraction) end-to-end.

`docs/PRE-PUSH-HOOK.md` gained a "CI targets must be self-sufficient" section
documenting the convention, citing both reference fixes, describing
`ci.buildArgs`, and pointing at `gate-doctor`.

### Files changed
- (new) `apps/cli/src/lib/gate-doctor-scan.ts` — fleet walk reading each
  repo's `.emit-infra.json` for `ci.prePush` (leniently — not the strict
  `ProjectConfigSchema`, since the doctor must still scan repos whose config
  is otherwise incomplete)
- (new) `apps/cli/src/lib/gate-doctor-static.ts` — the static env-prefix parser
- (new) `apps/cli/src/lib/gate-doctor-env.ts` — the allowlisted scrubbed env
- (new) `apps/cli/src/lib/gate-doctor-run.ts` — the dynamic per-target runner
- (new) `apps/cli/src/lib/gate-doctor-report.ts` — report shape + printing,
  mirroring `db-doctor-report.ts`'s split
- (new) `apps/cli/src/commands/gate-doctor.ts` — command wiring + per-project
  orchestration
- (new) `apps/cli/src/commands/gate-doctor.test.ts` — 21 tests: static parser
  (including the false-positive regression cases), env scrubbing, dynamic
  runner (mocked `execa`), report shape
- `apps/cli/src/index.ts` — registers `gate-doctor`
- `docs/PRE-PUSH-HOOK.md` — new self-sufficiency section + `gate-doctor` row
  in the Files table

### Verification
- `pnpm nx run cli:test`: 181/181 pass (18 new test files unaffected, 21 new
  gate-doctor tests)
- `pnpm test` (repo-wide): 356/356 pass
- `pnpm lint`, `pnpm typecheck` (repo-wide): clean
- `apps/cli/dist` rebuilt via `node apps/cli/esbuild.mjs`
- Live fleet run (`gate-doctor` against `~/projects`, static only): 0 findings
  after the regex fix (previously false-positived on 5 of 8 fleet repos)
- Live fixture run: reintroducing tastease's exact removed line into a
  scratch repo's `ci.sh` — flagged, exit 1
- Live fixture run: `--dynamic` against a package.json-less scratch repo —
  target reported failing with the real pnpm error line, exit 1
- Live run: `--dynamic` against `diner-decider` and `emit-billing` — both
  pass (fixed independently same-day; see Summary)

### Follow-ups
- `[defer]` The static layer only inspects `scripts/ci.sh`; a project could
  equally leak an env-var prefix from a `Makefile` or a root `package.json`
  script. Not observed in the current fleet — extend if one turns up.
- `[defer]` `--dynamic`'s default 600s per-target timeout is a guess; revisit
  once real build/test durations across the fleet are on hand (some Docker
  builds under emulation are documented elsewhere as multi-minute).
- `[defer]` `gate-doctor` reads `.emit-infra.json`'s raw `ci.prePush` array
  and falls back to the hook's Python-side default list if absent/malformed;
  it does not warn when the file exists but fails that shape check the way
  `loadConfig`'s zod validation would for other commands. Not a correctness
  issue for this sprint's scope, just a silent leniency worth noting.

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
