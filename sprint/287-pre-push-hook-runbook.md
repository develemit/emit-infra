# Document the interrupted-deploy failure mode and the new status vocabulary
**Difficulty:** 2

## Goal
`docs/PRE-PUSH-HOOK.md` explains what a push to `main` actually does, what every
status value means, how to recognize an orphaned deploy, and how to recover from
one — so the next person who sees a frozen percentage doesn't have to
reverse-engineer the hook to understand it.

## Reason
The 2026-08-19 incident cost more time in diagnosis than in repair. Two things
had to be rediscovered from scratch under pressure:

1. **That push-to-main deploys at all.** emit-social has no `.github/workflows/`
   — its `.github/` holds only skills and prompts — and `ls .git/hooks` shows
   only `.sample` files because `core.hooksPath` points at `.githooks`, whose
   `pre-push` is a symlink *out of the repo* into emit-infra. Every local signal
   says "no CD here." The deploy mechanism is invisible from inside the project
   that uses it.
2. **Whether a `deploying` status meant anything.** There was no documented way
   to tell a live deploy from an abandoned one.

Sprints 282–286 fix the machinery. This sprint makes the machinery legible, and
records the incident so the reasoning behind those sprints survives them.

## Context
- `docs/PRE-PUSH-HOOK.md` is the existing home for this. It already covers the
  file layout, how projects get the hook (`emit-infra hooks install` symlinks
  it), the currently-wired project list, and the deploy gates. It does not
  currently cover status semantics or failure recovery.
- `docs/DEPLOYMENT-PITFALLS.md` exists and may be the better home for the
  incident write-up specifically — read both and put each part where it fits
  rather than duplicating.
- Facts to document, all verified during the incident:
  - Push to `main` = CI, then Docker build per changed service, then GHCR push,
    then `emit-infra deploy`. It is a real production deploy.
  - It is slow: emulated `linux/amd64` builds, sequential by default
    (`EMIT_BUILD_PARALLEL` raises the cap).
  - Escape hatches that already exist: `EMIT_FORCE_DEPLOY=1` overrides the
    ignored-paths skip, `EMIT_DEPLOY_CONFIRM=1` adds an interactive prompt, and
    `git push --dry-run` runs CI only (the hook detects dry runs via
    `detect_dry_run_push`).
  - The observed failure: process killed mid-build, `deploy_done` never ran,
    `.deploy-status.json` frozen at `deploying` / 66% while `origin/main` never
    moved and prod was untouched.
- Status vocabulary to document once sprints 282–286 land: `deploying`,
  `deployed`, `failed`, `interrupted` (282), plus whatever terminal status 286
  introduces for reconciled records, plus the classifier's
  running/orphaned/unknown states from 284.
- This sprint should run **last** in the initiative, so it documents what was
  actually built rather than what was planned. If 282–286 changed shape during
  execution, follow the code, not this file.

## Tasks
1. Add a status-semantics section to `docs/PRE-PUSH-HOOK.md`: every value that
   can appear in `.deploy-status.json` / `.ci-status.json`, what writes it, and
   what it implies about whether work is in flight.
2. Document the liveness fields added in sprint 283 (`writer.pid`,
   `writer.host`, `writer.heartbeatAt`) and the staleness rule from 284,
   including the chosen thresholds and why.
3. Add an operator-guidance section: pushing to `main` is a production deploy;
   it must not be run from an environment that can tear the process down —
   agent background shells, CI sandboxes, anything with a short tool timeout.
   Expand the short warning added in sprint 282 into the full rationale.
4. Add a recovery runbook: how to recognize an orphaned deploy (dashboard
   treatment from 285, `emit-infra status` from 284), how to clear it (the
   command from 286), and how to confirm what actually shipped —
   `git ls-remote origin refs/heads/main` versus local `HEAD`, and checking
   whether images reached GHCR.
5. Write the incident up in `docs/DEPLOYMENT-PITFALLS.md` (or a dated section
   of it): what happened, why the two local signals were misleading, and what
   each of sprints 282–286 changed in response.
6. Note the discoverability trap explicitly, since it generalizes to every wired
   project: absence of `.github/workflows/` does not mean absence of CD, and
   `ls .git/hooks` is misleading whenever `core.hooksPath` is set. Include the
   one-liner that actually answers it:
   `git config --get core.hooksPath && ls -l "$(git rev-parse --show-toplevel)/$(git config --get core.hooksPath)"`.
7. Cross-check every documented command and environment variable against the
   real code before committing — this doc is the thing people will trust under
   pressure, so a stale flag name here is worse than no doc.

## Files involved
- `docs/PRE-PUSH-HOOK.md` — status semantics, liveness fields, operator
  guidance, recovery runbook
- `docs/DEPLOYMENT-PITFALLS.md` — the 2026-08-19 incident write-up
- `README.md` — only if it should point at the new runbook section

## Acceptance criteria
- [x] Every status value that can appear in either status file is documented,
      with its writer and its meaning
- [x] The liveness fields and the staleness thresholds are documented with
      rationale
- [x] The "don't deploy from a teardown-prone environment" rule is stated
      explicitly, with the reason
- [x] A recovery runbook exists that takes an operator from "the dashboard looks
      stuck" to a cleared record and a confirmed answer about what shipped
- [x] The incident is written up with the two misleading signals named
- [x] Every command and env var in the new docs is verified against the code as
      it exists after sprints 282–286
- [x] Markdown lints clean if the repo lints markdown

## Out of scope
- Any code change. If writing the docs exposes a behavior that's wrong rather
  than merely undocumented, file it as a follow-up sprint instead of fixing it
  here.
- Documenting the wider emit-infra deploy architecture (terraform, ansible,
  blue-green mechanics) beyond what the runbook needs.

## Completed

**Date:** 2026-08-20

### Summary
Read sprints 282–286's `## Completed` sections plus the actual code
(`packages/core/src/deploy-status.ts`, `deploy-reconcile.ts`,
`deploy-records.ts`, `scripts/lib/ci-utils.sh`, `apps/cli/src/commands/
{status,reconcile}.ts`) to write the docs from what actually shipped rather
than what was planned, per the sprint's explicit instruction.

`docs/PRE-PUSH-HOOK.md` gained: a discoverability note under "How projects
get the hook" with the `core.hooksPath` one-liner; an expanded "Signals and
interrupted runs" subsection stating the teardown-prone-environment rule and
its rationale explicitly, plus the escape hatches; a new "Status files and
liveness" section with a full status-value table (writer + meaning for each
of `running`/`success`/`failure` on the CI file and `deploying`/`deployed`/
`failed`/`interrupted`/`orphaned` on the deploy file) and a "Liveness fields
and staleness" subsection documenting the `writer` block, the 30s heartbeat
cadence, and `classifyRunState`'s five-rule priority order with its two
threshold constants (120s heartbeat staleness, 30min no-evidence age) and the
reasoning already captured as code comments; and a new "Recovery runbook"
section (recognize → confirm what shipped via `git ls-remote` and
`docker manifest inspect` → clear via `emit-infra reconcile --write` → retry).

`docs/DEPLOYMENT-PITFALLS.md` gained entry #25, the incident write-up naming
both misleading signals (the discoverability gap and the meaningless
`deploying` status) and summarizing what each of sprints 282–286 changed in
response, plus a matching line in the debugging checklist.

One judgment call: left `README.md` untouched. It has no existing pointer
into `docs/PRE-PUSH-HOOK.md` or any "docs index" section to extend, and a
pointer there wouldn't have fixed the discoverability trap anyway (that gap
is about a *wired project's own repo* looking CD-less, not emit-infra's
README) — so there was nothing well-scoped to add.

### Files changed
- `docs/PRE-PUSH-HOOK.md` — discoverability note, expanded signals/operator
  guidance, new "Status files and liveness" and "Recovery runbook" sections
- `docs/DEPLOYMENT-PITFALLS.md` — new entry #25 (the incident write-up) and
  a debugging-checklist line pointing at it

### Verification
- Every command and env var referenced in the new doc content
  (`core.hooksPath` one-liner, `EMIT_FORCE_DEPLOY`, `EMIT_DEPLOY_CONFIRM`,
  `git push --dry-run`, `emit-infra status`, `emit-infra reconcile --dir
  --write`, `git ls-remote origin refs/heads/main`, `docker manifest inspect
  ghcr.io/<ci.ghcrOrg>/<service>:<sha>`) checked directly against the current
  source: `scripts/lib/ci-utils.sh`, `packages/core/src/deploy-status.ts`,
  `deploy-reconcile.ts`, `deploy-records.ts`, `apps/cli/src/commands/
  {status,reconcile}.ts`, and the `ci.ghcrOrg` config schema
- Status value table cross-checked against every `_emit_write_atomic`/
  `ci_done`/`deploy_done` call site in `ci-utils.sh` and every
  `deployRecordDone`/`ORPHANED_STATUS` use in the TS core package
- Threshold values (30s / 120s / 1800s) taken directly from
  `HEARTBEAT_INTERVAL_SEC`/`ORPHAN_HEARTBEAT_THRESHOLD_SEC`/
  `UNKNOWN_RECORD_ORPHAN_AGE_SEC` in `deploy-status.ts`, not re-derived
- No markdown lint script exists in this repo (`grep -n lint package.json`
  turns up only `nx run-many -t lint`, no markdown target) — criterion
  trivially satisfied
- Out of scope per the sprint: no code changed, no test suite touched, so no
  `pnpm test`/`typecheck`/`lint` run was needed for this sprint's own diff

### Follow-ups
- none
