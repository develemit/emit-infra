# Sprint 228 — Add --yes flag to secrets-sync CLI command

> _Promoted from backlog item (sprint 222), 2026-07-17._

## Goal
`emit-infra secrets sync [name] --yes` skips the interactive confirmation, matching the pattern already used by `emit-infra destroy --yes`.

## Context
- `apps/cli/src/commands/secrets-sync.test.ts` and the implementation in the corresponding source file.
- `apps/cli/src/commands/destroy.ts` already implements the `--yes` flag pattern — reference it for consistency.
- The secrets-sync command currently requires interactive confirmation before pushing secrets to the server. In CI or scripted contexts, a `--yes` flag is needed.

## Tasks
1. Read `destroy.ts` to understand the `--yes` option pattern.
2. Add `.option('-y, --yes', 'Skip confirmation prompt')` to the secrets sync command.
3. When `--yes` is passed, skip the interactive confirmation and proceed directly.
4. Add tests in `secrets-sync.test.ts` covering:
   - `--yes` flag bypasses confirmation
   - Without `--yes`, confirmation is still required (existing behavior)
5. Run `npx nx run cli:test` and `npx nx run cli:typecheck`.

## Acceptance criteria
- [x] `emit-infra secrets sync myapp --yes` runs without prompting.
- [x] Without `--yes`, existing interactive flow unchanged.
- [x] Tests pass, typecheck clean.

## Completed

**Date:** 2026-07-17

### Summary
Added `-y, --yes` flag to `secrets sync` matching the `destroy` command pattern. A readline-based y/N confirmation prompt now fires before any secret is pushed; `--yes` skips it entirely. Existing tests that exercise the sync path were updated to pass `--yes` so they don't hang; three new tests cover the bypass path, the confirm-and-proceed path, and the deny-and-abort path.

### Files changed
- `apps/cli/src/commands/secrets-sync.ts` — added `createInterface` import, `-y, --yes` option, `confirmSync()` helper, and pre-sync confirmation guard
- `apps/cli/src/commands/secrets-sync.test.ts` — mocked `node:readline`, added `--yes` to existing sync tests, added 3 new confirmation-behavior tests

### Verification
- `npx nx run cli:test`: 66/66 pass (9 test files)
- `npx nx run cli:typecheck`: clean

### Follow-ups
- none
