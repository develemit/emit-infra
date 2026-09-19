# Fix two dependency-config drifts found during the deps-stage rollout
**Difficulty:** 2

## Goal
emit-vision can actually build a native package's install script when it needs
to, and martialops stops carrying configuration for a dependency it doesn't
have.

## Reason
Sprint 337's investigation of every project's native-dependency surface turned
up two pieces of drift that are harmless today and won't stay that way:

- **emit-vision has no `pnpm.onlyBuiltDependencies` at all** (verified
  2026-09-18). Under pnpm 10, build scripts are blocked unless the package is
  listed, so `sharp`'s install script is silently skipped on every build —
  `Ignored build scripts: … sharp@0.34.5`. It doesn't bite right now because
  the only `next/image` usage in `marketing` is a static SVG, which Next serves
  unoptimised. The day anyone adds a raster image, optimisation breaks in
  production with a warning buried in build output nobody reads.
- **martialops lists `sharp` in both `onlyBuiltDependencies` and
  `overrides`** while not depending on `sharp` at all (verified — it's in
  neither `dependencies` nor `devDependencies`). Leftover config from a removed
  feature. It's noise that makes the next dependency audit slower and implies a
  native dep that isn't there.

Neither is urgent. Both are small, both were found with evidence, and both are
the kind of thing that costs an afternoon later if left.

## Context

### emit-vision
Root `package.json`, `pnpm` field. The other fleet projects that ship `sharp`
list it under `onlyBuiltDependencies` — martialops's list is the fullest
example: `['@parcel/watcher', '@prisma/client', '@prisma/engines', '@swc/core',
'argon2', 'esbuild', 'nx', 'prisma', 'sharp']`. Add what emit-vision actually
needs, not that list wholesale: check which of its dependencies have install
scripts before choosing. Adding a package here lets its install script run, so
this is a real (if small) supply-chain decision — don't add anything you
haven't confirmed it depends on.

Verify the effect rather than assuming: an install before and after should show
the `Ignored build scripts` warning disappearing for whatever you add.

### martialops
Root `package.json`. Remove `sharp` from `onlyBuiltDependencies` and from
`overrides`. Confirm first that nothing depends on it transitively — an
`overrides` entry can exist to pin a transitive dependency, which would make
removal a real change rather than cleanup. If it turns out to be pinning
something real, leave it and say so; that is a perfectly good outcome for this
sprint.

### Deploy posture
Neither change needs a deploy. Both repos have large unpushed ranges, so commit
only and leave deployment to an ordinary future deploy. Note that a
`package.json` edit does **not** bust the dependency layer any more — that's the
whole point of sprint 338's lockfile-keyed deps stage — so this is cheap to ship
whenever either project next deploys.

### Conventions
Each repo runs the fleet-shared runner: `pnpm check:affected`. A root
`package.json` edit sits outside the Nx project graph, so that may report no
tasks — report it honestly rather than as a pass, and rely on
`pnpm install --frozen-lockfile` leaving the lockfile unchanged as the real
signal.

## Tasks
1. emit-vision: determine which of its dependencies actually have install
   scripts, add the appropriate `pnpm.onlyBuiltDependencies` entries, and show
   the `Ignored build scripts` warning changing as a result.
2. martialops: confirm whether the `sharp` `overrides` entry pins anything real.
   If not, remove `sharp` from both `overrides` and `onlyBuiltDependencies`.
3. Run `pnpm install --frozen-lockfile` in each touched repo and confirm the
   lockfile is unchanged.
4. Commit per repo. Do not deploy.

## Files involved
- `~/projects/emit-vision/package.json` — add `pnpm.onlyBuiltDependencies`
- `~/projects/martialops/package.json` — drop the dead `sharp` entries

## Acceptance criteria
- [x] emit-vision lists only packages it genuinely depends on that have install
      scripts, with the before/after `Ignored build scripts` output quoted
- [x] martialops's `sharp` entries are removed, or kept with a stated reason if
      the override pins something real
- [x] `pnpm install --frozen-lockfile` passes in both repos with no lockfile change
- [x] Each repo's own check command is run, with an empty affected result
      reported honestly rather than as a pass
- [x] Neither project is deployed, and the report says so

## Out of scope
- Auditing every fleet project's `onlyBuiltDependencies` — these two were found
  with evidence; a general audit is its own sprint.
- Adding a raster `next/image` usage to emit-vision, or any app change.
- Deploying either project.

## Completed

**Date:** 2026-09-18

### Summary
emit-vision now has `pnpm.onlyBuiltDependencies: ["sharp"]` (commit `ee222bb5`), so sharp's install script runs. Before, `Ignored build scripts` listed `@swc/core, esbuild, unrs-resolver, msgpackr-extract, sharp, protobufjs, @parcel/watcher, nx`; after, the same list minus `sharp`. Only sharp was added, per the sprint's evidence; the rest is a general audit, out of scope.

martialops: the `sharp` `overrides` entry (`>=0.35.0`) is real. It pins next's optional peer (via next and next-intl) to 0.35.3, so it was kept. Only the dead `onlyBuiltDependencies` entry was removed, since sharp 0.35 has no install script; a clean frozen install prints no ignored-build warning. Neither project was deployed.

### Files changed
- `~/projects/emit-vision/package.json` — added `pnpm.onlyBuiltDependencies: ["sharp"]`
- `~/projects/martialops/package.json` — removed `sharp` from `onlyBuiltDependencies`
- `sprint/343-fleet-dependency-config-hygiene.md` — completion record

### Verification
- `pnpm install --frozen-lockfile` in both repos: passes, lockfile unchanged
- emit-vision `pnpm check:affected`: passed (23 projects, since a root edit affects all)
- martialops `pnpm check:affected`: passed (7 projects, 1150/1150 api tests)
- No deploys performed

### Follow-ups
- `[defer]` emit-vision still ignores build scripts for esbuild, @swc/core, nx, @parcel/watcher, unrs-resolver, msgpackr-extract, protobufjs; a fleet-wide `onlyBuiltDependencies` audit is its own sprint.
