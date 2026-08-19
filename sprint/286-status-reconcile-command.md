# Add a reconcile command that clears orphaned deploy status records
**Difficulty:** 3

## Goal
`emit-infra status --reconcile` (or an equivalent subcommand) detects an
orphaned in-flight record, writes a correct terminal record for it, and appends
an honest history line — so recovery never means hand-editing a gitignored JSON
file.

## Reason
As of the 2026-08-19 incident the only way to clear a stuck `deploying` record
is to open `.deploy-status.json` in an editor and change it by hand. That is
error-prone (the terminal shape differs from the in-flight shape, and there's a
matching `.deploy-history.jsonl` line that a manual edit will simply omit), it's
undiscoverable, and it means the incident's own artifact — emit-social's status
file still reading `deploying / 66%` — stays wrong until someone remembers to
fix it.

Note what this is **not**. The smart-build path is unaffected by a stuck
record: `resolve_last_deployed_sha` in `scripts/lib/deploy-plan.sh` already
falls back to the newest `deployed` entry in `.deploy-history.jsonl` when
`.deploy-status.json` is not `deployed`. That was fixed deliberately — see the
`fix 1: an interrupted deploy must not disable smart build` comment at
`deploy-plan.sh:35`, its regression cases in `scripts/lib/deploy-plan.test.sh`
("status deploying -> newest deployed from history"), and the write-up under
"Smart build" in `docs/PRE-PUSH-HOOK.md`.

So this sprint is justified on operator ergonomics and record accuracy alone —
a stuck record costs trust and manual repair, not build efficiency. Do not
re-introduce a performance argument for it.

## Context
- The CLI lives in `apps/cli/`, commands in `apps/cli/src/commands/`, each
  exporting a `register<Name>(program)` that wires a `commander` subcommand.
  Follow that wiring shape from `apps/cli/src/commands/status.ts` and
  `db-doctor.ts`.
- **There is no existing detect-and-repair command in this CLI to copy.**
  `db-doctor.ts` is 50 lines and entirely read-only: it scans, prints a report,
  and `process.exit(1)`s if it found issues. It has no dry-run flag, no
  confirmation prompt, and no mutation path. Read it for the detect-and-report
  half and for the report-module split (`apps/cli/src/lib/db-doctor-report.ts`),
  but the repair half is new ground — this sprint establishes the pattern
  rather than following one.
- The classifier from sprint 284 (`packages/core/src/deploy-status.ts`) decides
  what counts as orphaned. Use it — do not implement a second rule.
- The terminal record shape is defined by `deployRecordDone` in
  `packages/core/src/deploy-records.ts` and by `deploy_done` in
  `scripts/lib/ci-utils.sh`. Reconciling should produce the same shape those
  produce, including the `.deploy-history.jsonl` append, so downstream readers
  can't tell a reconciled record from a normally-written one by shape alone —
  only by its status value.
- Introduce a distinct terminal status for this (e.g. `orphaned`) rather than
  reusing `failed`. A deploy that was killed at 66% may have pushed some images;
  claiming it "failed" implies a clean unsuccessful outcome, and claiming it
  "deployed" is worse. Whatever is chosen, add it to sprint 284's classifier and
  to the docs in 287.
- Both `.deploy-status.json` and `.ci-status.json` can be orphaned; handle both.
- This command mutates state, and since there is no in-repo precedent, decide
  the semantics here and write down the reasoning. Recommended: dry-run by
  default (print the intended terminal record and history line, change
  nothing), with an explicit `--write` to apply. That keeps the safe path the
  default and matches how `db-doctor` already behaves when it is only ever
  asked to look. Whatever is chosen becomes the precedent for future repair
  commands, so state it in the command's `--help` text.

## Tasks
1. Read `apps/cli/src/commands/db-doctor.ts` for the detect-and-report shape
   and its commander wiring — but note it has no repair path, so the mutation
   half has no precedent to copy and must be designed here (see Context).
2. Implement the reconcile path: classify the local records, and for anything
   orphaned, write a terminal record and append the matching history line with
   the real `startedAt`, a `completedAt`, and a duration.
3. Decide dry-run vs. confirm semantics and implement it — reporting what it
   *would* change must be possible without changing anything.
4. Handle both the deploy and CI status files, and handle the case where the
   files are absent or unparseable without crashing.
5. Make it operable on another project directory (the wired projects are
   `~/projects/<name>`), not only the cwd — this is a fleet tool.
6. Wire the command into the CLI entrypoint and `emit-infra --help`.
7. Tests: orphaned record is reconciled to a terminal record plus exactly one
   history line; a genuinely live record is left untouched; dry-run mutates
   nothing; missing/malformed files are handled cleanly.
8. Run it against emit-social's real stuck record
   (`~/projects/emit-social/.deploy-status.json`, frozen at `deploying` / 66%
   for sha `6423d5d`) and confirm it clears correctly. This is the incident's
   own artifact and makes a good end-to-end check.

## Files involved
- new file: `apps/cli/src/commands/reconcile.ts` — or extend
  `apps/cli/src/commands/status.ts` with a `--reconcile` flag, whichever fits
  the existing CLI conventions better
- new file: `apps/cli/src/commands/reconcile.test.ts` — command coverage
- `apps/cli/src/index.ts` — register the command
- `packages/core/src/deploy-status.ts` — add the new terminal status to the
  classifier if one is introduced
- `packages/core/src/deploy-records.ts` — reuse or extend the terminal-record
  writer rather than duplicating its shape

## Acceptance criteria
- [ ] Running the command against an orphaned record writes a terminal record
      and appends exactly one `.deploy-history.jsonl` line
- [ ] A live, heartbeating record is never touched
- [ ] Dry-run reports the intended change and mutates nothing
- [ ] Reconciled records satisfy `resolve_last_deployed_sha` — the smart-build
      path works normally afterward
- [ ] Works against an arbitrary project directory, not just the cwd
- [ ] Missing or malformed status files produce a clear message, not a stack
      trace
- [ ] Test coverage in `apps/cli/src/commands/reconcile.test.ts` for all of the
      above
- [ ] Verified against emit-social's real stuck record
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` green

## Out of scope
- Automatically reconciling on some schedule or on hook startup. Detection is
  automatic (sprints 284–285); repair stays a deliberate operator action for
  now. Auto-repair can be proposed as a follow-up once this has been used a few
  times.
- Rolling back or cleaning up partially-pushed GHCR images from an interrupted
  build. That's a separate concern and deserves its own sprint if it turns out
  to matter.
- A dashboard button for reconcile.
