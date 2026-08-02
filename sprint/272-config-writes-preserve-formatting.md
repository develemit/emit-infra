# Sprint 272 — CLI config writes stop reformatting other projects' .emit-infra.json

> _Promoted from sprint-246 follow-up, 2026-08-02._

## Goal
emit-infra CLI commands that write a project's `.emit-infra.json` no longer
produce whitespace-only diffs, so real config changes are never camouflaged
by (or hidden among) formatting noise in consuming repos.

## Context
Config-writing commands rewrite via `JSON.stringify(…, null, 2)`, which
reformats the whole file (observed: a 73-line pure-whitespace diff in
diner-decider; emit-social's real sprint-243 write hid uncommitted for 8 days
inside that noise). Find every write site: grep `writeFileSync.*emit-infra.json`
/ `JSON.stringify` across `apps/cli/src` and `packages/core/src`. Options, in
preference order: (a) format-preserving edits (e.g. parse with a
comment/format-preserving lib if the fleet's configs are plain JSON —
`jsonc-parser`'s modify/applyEdits works well and is dependency-light);
(b) normalize once: keep stringify but match the file's existing indent and
key order (cheap heuristic; still reformats arrays); (c) at minimum, have
each write print a "wrote <path> — commit this" warning. Choose (a) unless a
real blocker appears; record the decision. Verify against real fleet configs:
run a no-op write (read→write with no changes) against a copy of each
project's config and assert zero diff.

## Tasks
1. Inventory all write sites and their calling commands.
2. Implement format-preserving writes behind one shared helper; unit tests
   with fixture configs from at least 3 real projects (copied, secrets-free)
   asserting no-op writes are byte-identical and targeted edits touch only
   the intended lines.
3. Migrate all write sites to the helper; rebuild CLI dist.
4. Prove on a real project: run a config-touching command in a scratch clone
   and confirm the diff is semantically minimal.

## Acceptance criteria
- [ ] No-op write is byte-identical for all fixture configs (tests)
- [ ] Targeted edit produces a minimal diff (test with expected-diff fixture)
- [ ] All write sites migrated (grep proves none bypass the helper)
- [ ] CLI suite + typecheck/lint green; dist rebuilt
