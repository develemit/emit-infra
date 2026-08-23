# Extract one shared terraform-output helper and delete the buggy copies
**Difficulty:** 3

> _Promoted from backlog: sprint-124 and sprint-271 follow-ups, 2026-08-21._

## Goal
One `getTerraformOutput` implementation in `@emit-infra/core`, using `-json`,
consumed by every call site. The two `-raw`-based copies are gone.

## Reason
`getTerraformOutput` exists in **three** places today, and two of them carry a
bug the third already fixed:

- `apps/cli/src/commands/status.ts:85` — uses `terraform output -json`. Its own
  comment explains why: `-raw` on a project with no outputs corrupted the SSH
  hostname by mixing terraform's warning text into the value.
- `apps/cli/src/commands/logs.ts:72` — a copy-pasted **pre-fix** version still
  on `-raw`. Same corruption is reachable here.
- `packages/core/src/terraform.ts:26` — the exported version, also `-raw`, used
  by `setup.ts`.

So the fix landed in one copy and never reached the other two. Sprint 124 said
to extract a shared helper "when a third consumer appears" — there are three
now, and two are actively wrong. This is the trigger it was waiting for.

## Context
- `packages/core` is the shared library (`@emit-infra/core`) consumed by
  `apps/api` and `apps/cli`. The exported helper belongs here.
- `status.ts:85-92` is the reference implementation — read it first, including
  the comment explaining the `-json` choice. Preserve that reasoning in the
  shared version rather than restating it.
- Signatures differ: `packages/core/src/terraform.ts`'s takes `(key, cwd)`;
  the CLI copies take `(key)` and rely on `-chdir=terraform`. The shared helper
  needs to serve both — decide on one signature and adapt call sites.
- Return types differ too: core's returns `Promise<string>`, the CLI copies
  return `Promise<string | null>` (null when terraform has no such output).
  Pick the one that doesn't force callers to guess, and document it.
- Consumers to update: `apps/cli/src/commands/status.ts`,
  `apps/cli/src/commands/logs.ts`, and whatever imports
  `packages/core/src/terraform.ts` (`setup.ts` at minimum — grep for it).
- `apps/cli/dist` is a build artifact the pre-push hook executes. Rebuild after
  changing CLI source or deploys run stale code.

## Tasks
1. Read `status.ts:85-92` and treat its `-json` implementation as the reference.
2. Put a single `getTerraformOutput` in `packages/core/src/terraform.ts` using
   `-json`, with one agreed signature and return type. Keep the comment
   explaining why `-raw` is wrong so nobody reintroduces it.
3. Export it from `packages/core`'s index if it isn't already.
4. Delete the local copies in `status.ts` and `logs.ts`; import the shared one.
5. Grep for any other `terraform output` invocation and fold it in too.
6. Unit-test the shared helper: a key that exists; a key that doesn't; a project
   with **no outputs at all** (the case that produced the original corruption);
   terraform exiting non-zero.
7. Rebuild `apps/cli/dist` and confirm `emit-infra status` and `emit-infra logs`
   still resolve a server IP against a real project.

## Files involved
- `packages/core/src/terraform.ts` — the single implementation
- new file: `packages/core/src/terraform.test.ts` — coverage for task 6
- `packages/core/src/index.ts` — export it
- `apps/cli/src/commands/status.ts` — delete local copy, import shared
- `apps/cli/src/commands/logs.ts` — delete buggy `-raw` copy, import shared

## Acceptance criteria
- [ ] Exactly one `getTerraformOutput` implementation exists in the repo
- [ ] No `terraform output -raw` invocation remains
- [ ] A project with no terraform outputs returns a clean empty/null result with
      no warning text mixed into the value — asserted by a test
- [ ] `emit-infra status` and `emit-infra logs` both still resolve a server IP
- [ ] Test coverage in `packages/core/src/terraform.test.ts` for all four cases
      in task 6
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` green; `apps/cli/dist` rebuilt

## Out of scope
- Changing what `status`/`logs` do with the resolved host.
- Terraform provisioning, state management, or the `terraform-init` command.
