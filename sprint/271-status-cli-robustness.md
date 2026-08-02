# Sprint 271 — `emit-infra status` robustness + checkBackupEnv coverage

> _Promoted from sprint-258 and sprint-259 follow-ups, 2026-08-02._

## Goal
`emit-infra status <name>` works even when terraform prints warnings, and
`checkBackupEnv`'s exit path finally has direct unit coverage.

## Context
(1) `status` concatenates raw `terraform output` text into the SSH hostname;
a "No outputs found" warning becomes part of the hostname → "hostname
contains invalid characters" (observed on diner-decider, sprint 258). Fix:
`terraform output -json` and parse, treating empty/no-outputs as absent —
find the call site in `apps/cli/src/commands/status.ts` (or wherever the
terraform read lives; grep `terraform output`). (2) `checkBackupEnv` in
`apps/cli/src/commands/deploy.ts` is module-private with a
`process.exit(1)` path verified only by inspection (open since sprint 244).
Export it (or extract to a testable helper per house style) and test both
branches — mock `process.exit` per existing CLI test conventions
(see `deploy.test.ts`).

## Tasks
1. Fix the terraform parse with a unit test covering: normal outputs,
   no-outputs warning, malformed JSON.
2. Test `checkBackupEnv` both branches.
3. Verify `emit-infra status diner-decider` (the known repro) now works.

## Acceptance criteria
- [ ] `status` on a project with no terraform outputs returns a sane result
      (no hostname corruption); test covers the warning case
- [ ] `checkBackupEnv` has direct tests incl. the exit path
- [ ] CLI suite + typecheck/lint green; dist rebuilt if hooks consume it
