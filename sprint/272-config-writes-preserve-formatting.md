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
- [x] No-op write is byte-identical for all fixture configs (tests)
- [x] Targeted edit produces a minimal diff (test with expected-diff fixture)
- [x] All write sites migrated (grep proves none bypass the helper)
- [x] CLI suite + typecheck/lint green; dist rebuilt

## Completed

**Date:** 2026-08-02

### Summary
Chose option (a) from the sprint's preference order: format-preserving edits via
`jsonc-parser`'s `modify`/`applyEdits`, wrapped in a new shared helper at
`packages/core/src/config-writer.ts` (`createConfigFile` for brand-new files,
`setConfigField` for editing an existing one). All three real write sites for
`.emit-infra.json` — `init.ts` (create), `secrets-scaffold.ts` and
`init-deploy.ts` (edit-in-place) — now go through it exclusively; a grep for
`JSON.stringify`/`writeFileSync` against `configPath` outside `config-writer.ts`
returns nothing.

Found and fixed a real correctness gap along the way: `jsonc-parser`'s `modify()`
reformats the *previous sibling* property when inserting a brand-new top-level
key, because it reprints "`<prev prop>,\n<new prop>`" as a single edit. That
silently reformatted compact fields (e.g. `"github": { "repo": "x" }` →
3 lines) — exactly the kind of hidden-noise bug this sprint exists to prevent,
just introduced by the new tool instead of the old one. Fixed by hand-rolling
the new-key-insertion path in `setConfigField`: it only ever appends text after
the offset where the previous last property ends, leaving everything before it
byte-untouched. Caught by a regression test using a synthetic fixture with a
compact last property (`compact-last-property.json`).

Also hit a bundling issue: `jsonc-parser`'s `package.json` has no `exports`
field, so esbuild resolved its `main` (UMD build, which does an internal
dynamic `require('./impl/format')` that breaks once bundled) instead of its
`module` (clean ESM) field. Fixed by adding `mainFields: ['module', 'main']`
to `apps/cli/esbuild.mjs`. Verified by actually running the built
`apps/cli/dist/index.js` (not just `tsx` on source) against a scratch clone —
running `tsx` directly on source would not have caught the bundler issue.

### Files changed
- (new) `packages/core/src/config-writer.ts` — `createConfigFile` (fresh
  writes) and `setConfigField` (format-preserving field edit/insert) helpers
- (new) `packages/core/src/config-writer.test.ts` — 8 tests: no-op
  byte-identical across 4 fixtures, targeted-edit minimal diff, compact-array
  preservation, new-key insertion, new-key insertion regression, fresh-create
- (new) `packages/core/src/config-writer.fixtures/*.json` — secrets-free
  copies of 3 real fleet configs (emit-vision, diner-decider, emit-social) plus
  one synthetic fixture for the sibling-reformat regression
- `packages/core/src/index.ts` — export the two new helpers
- `packages/core/package.json` — add `jsonc-parser` dependency
- `apps/cli/src/commands/init.ts` — use `createConfigFile` instead of raw
  `writeFileSync(JSON.stringify(...))`
- `apps/cli/src/commands/secrets-scaffold.ts` — use `setConfigField` for the
  `requiredEnvKeys` write
- `apps/cli/src/commands/secrets-scaffold.test.ts` — mock/assert against
  `setConfigField` instead of raw `writeFileSync`
- `apps/cli/src/commands/init-deploy.ts` — use `setConfigField` for the
  `blueGreen` write
- `apps/cli/esbuild.mjs` — `mainFields: ['module', 'main']` so bundled deps
  with a UMD `main` and clean `module` build (like jsonc-parser) resolve to
  the ESM build

### Verification
- `nx run core:test`: 8/8 new tests pass (46/46 in the package)
- `nx run cli:test`: 144/144 pass (includes the pre-existing real-subprocess
  `init-deploy` E2E test, which exercises the built code path end-to-end)
- `nx run core:typecheck` / `nx run cli:typecheck`: clean
- `nx run core:lint` / `nx run cli:lint`: clean
- `nx run cli:build`: dist rebuilt with the esbuild fix
- Manual scratch-clone proof: ran the built `apps/cli/dist/index.js
  init-deploy` against a temp project whose `.emit-infra.json` had a compact
  `"github": { "repo": "user/test" }` line — the resulting diff was purely
  additive (the new `blueGreen` block), with every pre-existing line,
  including the compact one, unchanged

### Follow-ups
- `[defer]` `setConfigField`'s manual insertion path only handles top-level
  single-segment paths (matching today's two call sites); a nested-path insert
  falls back to plain `jsonc-parser` `modify()`, which could reintroduce the
  sibling-reformat bug if a future call site needs to insert a new *nested*
  key. Worth a comment or guard if a new call site appears.
- `[defer]` `FORMATTING_OPTIONS` hardcodes 2-space indent rather than
  detecting the file's actual indent width. Fine today since every real fleet
  config already uses 2-space, but worth revisiting if a config with a
  different style shows up.
