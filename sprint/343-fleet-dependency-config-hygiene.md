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
- [ ] Each repo's own check command is run, with an empty affected result
      reported honestly rather than as a pass
- [x] Neither project is deployed, and the report says so

## Out of scope
- Auditing every fleet project's `onlyBuiltDependencies` — these two were found
  with evidence; a general audit is its own sprint.
- Adding a raster `next/image` usage to emit-vision, or any app change.
- Deploying either project.

## In Progress
**Started:** 2026-09-18 (resumed by /start-sprint-auto)

### Done so far
- emit-vision: added `pnpm.onlyBuiltDependencies: ["sharp"]` only (sharp is the sole one the sprint's evidence covers), committed as `ee222bb5`. Before: `Ignored build scripts` listed `@swc/core, esbuild, unrs-resolver, msgpackr-extract, sharp, protobufjs, @parcel/watcher, nx`. After: same list minus `sharp`. Lockfile unchanged; `pnpm check:affected` passed (23 projects; a root package.json edit affects all).
- martialops: the `sharp` override is NOT dead config. `pnpm why sharp` shows it is next's optional peer (via next and next-intl), and the override pins it to `>=0.35.0` (resolves 0.35.3; next's default would be 0.34.x). Kept the override. Removed only the `onlyBuiltDependencies` `sharp` entry: a clean `pnpm install --frozen-lockfile` prints no ignored-build warning and leaves the lockfile unchanged (sharp 0.35 has no install script).
- No deploys.

### Blocked on
- martialops commit: the pre-commit hook fails on `api:lint` (import/order warning in `apps/api/prisma/seed-north-river.ts`) from another sprint's uncommitted work (sprint 355) in the same tree. Not mine, and I did not bypass the hook with `--no-verify`. The one-line `package.json` edit is left uncommitted and unstaged.
- `pnpm check:affected` in martialops fails for the same reason (`api:lint`), so the check criterion there is not a clean pass.

### Pickup notes
Once sprint 355 lands or its lint warning is fixed, commit martialops `package.json` alone: `chore: drop sharp from onlyBuiltDependencies`. Then rerun `pnpm check:affected` there. Follow-up for backlog: emit-vision still ignores build scripts for esbuild, @swc/core, nx, @parcel/watcher, unrs-resolver, msgpackr-extract, protobufjs (general audit was out of scope).

### Auto-loop diagnosis (attempt 1)
**Auto-retry:** 1
- Blocked by: martialops' pre-commit hook failing `api:lint` on sprint 355's
  uncommitted files. **That blocker is now cleared** — martialops' tree is clean
  and sprint 355 has landed (`a267b00`).
- Evidence: `martialops$ git status --porcelain` is empty; `git log -1` is
  `a267b00 chore: plan sprint 356 — portal shows cancelled events`.
- Also note: the previous child's uncommitted martialops `package.json` edit did
  NOT survive. Verified 2026-09-18 — `pnpm.onlyBuiltDependencies` still contains
  `sharp`. **Redo that one-line removal**; do not assume it is already applied.
- Keep the previous child's finding: the `overrides` `sharp: ">=0.35.0"` entry is
  real (it pins next's optional peer to 0.35.3) — leave it in place and say so.
- Do: redo the martialops `onlyBuiltDependencies` removal, commit it there,
  re-run `pnpm check:affected` in martialops now that it can pass, then complete
  this sprint's remaining criteria as written.
