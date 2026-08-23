# Two papercuts: gate-doctor's silent config leniency and the missing Next ESLint plugin
**Difficulty:** 2

> _Promoted from backlog: sprint-295 and sprint-298 follow-ups, 2026-08-22._

## Goal
`gate-doctor` says something when a project's `.emit-infra.json` is present but
its `ci.prePush` is unusable, instead of silently substituting defaults; and
`pnpm nx lint dashboard` stops printing "The Next.js plugin was not detected in
your ESLint configuration" on every run.

## Reason
Two independent small items, both cheap, neither worth its own sprint.

**The leniency.** `gate-doctor`'s whole purpose is to catch a project whose
push gate is quietly wrong — that's the failure mode it was built for (tastease
shipped a gate that couldn't run). But `readGateProject` in
`apps/cli/src/lib/gate-doctor-scan.ts` has two silent paths of its own:
- `JSON.parse` throws → `return null`, and the project vanishes from the scan
  entirely with no output.
- `ci.prePush` exists but isn't a `string[]` (a bare string, a mixed array, an
  object) → falls back to `DEFAULT_CI_TARGETS` with no warning.

The second is the sharper one: the doctor then reports "clean" while checking a
target list the project didn't ask for. A tool whose job is finding
misconfiguration shouldn't have a silent misconfiguration path. Note the
fallback *behaviour* is deliberate and correct — the hook's Python reader does
the same thing, and matching it is the point (see the comment at line 19). Only
the silence is the bug.

**The lint warning.** Every dashboard lint and build run prints a Next.js plugin
warning. It's cosmetic, but it's the kind of persistent noise that trains you to
skim past lint output — which is where a real warning eventually hides.

## Context

### gate-doctor
- `apps/cli/src/lib/gate-doctor-scan.ts:34-38` is the fallback:
  ```ts
  const declared = raw.ci?.prePush
  const targets =
    Array.isArray(declared) && declared.every((t) => typeof t === 'string')
      ? declared
      : DEFAULT_CI_TARGETS
  ```
  This correctly conflates two cases that should be reported differently:
  **absent** (normal — the hook defaults too, say nothing) and **present but
  malformed** (a real problem — say so).
- Don't reach for `ProjectConfigSchema`. The comment above the function explains
  why the loose read exists: the doctor must still scan repos whose config is
  incomplete in *other* ways (emit-billing has no `github.repo`-shaped deploy
  config). Validate the one field it actually depends on; leave the rest loose.
- Decide whether a malformed `ci.prePush` is a **warning** (scan continues with
  defaults, exit code unchanged) or a **finding** (counts toward the doctor's
  non-zero exit). Argue it either way, but be explicit — the doctor's exit code
  is consumed by other tooling, so changing when it goes non-zero is a
  behavioural change that needs saying out loud.
- The unparseable-JSON path deserves at least a line of output too. A project
  silently dropping out of a fleet scan is the exact shape of thing this tool
  exists to prevent.

### ESLint
- There is **one** flat config at the repo root: `eslint.config.js`. There is no
  `apps/dashboard/eslint.config.*`. The dashboard's `lint` target
  (`apps/dashboard/project.json:27`) uses `@nx/eslint:lint` over
  `apps/dashboard/**/*.{ts,tsx}`, so it picks up the root config.
- The warning comes from Next's own tooling not finding
  `eslint-config-next` / `@next/eslint-plugin-next` registered. The fix is
  either adding a dashboard-scoped block to the root flat config or a
  dashboard-local config file — pick one and say why.
- **Check whether the plugin is even installed** before wiring it. If it isn't,
  adding a dependency is a bigger decision than silencing a warning; if that's
  the only path, weigh it against simply confirming the warning is harmless and
  documenting that instead. Either outcome is acceptable — a reasoned "not worth
  a dependency" closes this item just as well as a fix.
- If you do register the plugin, **run lint afterward and report new findings
  separately**. `@next/eslint-plugin-next`'s recommended rules will very likely
  flag existing dashboard code. Do not fix those in this sprint — count them,
  file them, and decide with that number in hand whether the rules go on as
  `warn` or the whole thing gets deferred.

## Tasks
1. Distinguish absent from malformed `ci.prePush` in `readGateProject`, and
   report the malformed case.
2. Report — rather than silently skip — a `.emit-infra.json` that fails to
   parse.
3. Decide and document whether either condition affects `gate-doctor`'s exit
   code.
4. Add tests: valid array, absent (defaults, silent), malformed shapes (bare
   string, mixed array, object), unparseable JSON.
5. Run `gate-doctor` against the real fleet before and after; confirm the same
   projects are reported and no new false positive appears.
6. Investigate the Next ESLint plugin warning; fix it or close it with a
   documented reason.
7. If the plugin gets registered, run `pnpm nx lint dashboard` and record the
   count and shape of any new findings without fixing them.

## Out of scope
- Extending `gate-doctor`'s static layer to `Makefile` / root `package.json`
  script sources — separately filed, and conditional on one turning up in the
  fleet.
- Revisiting the `--dynamic` 600s timeout — separately filed, waiting on real
  fleet build durations.
- Fixing any lint findings the Next plugin surfaces.
- Any change to the hook's own default target list or its Python reader.

## Acceptance criteria
- [x] A project with a malformed `ci.prePush` produces visible output naming
  the project and what's wrong; a project with an absent one stays silent.
- [x] An unparseable `.emit-infra.json` is reported, not silently dropped.
- [x] The exit-code decision is stated explicitly in the Completed section.
- [x] Tests cover all shapes in task 4.
- [x] Fleet run before/after shows no new false positives — paste both outputs.
- [x] The Next plugin warning is gone, or its persistence is explained with a
  recommendation.
- [x] Typecheck clean, `pnpm test` green.

## Completed

**Date:** 2026-08-23

### Summary
Both papercuts fixed.

**gate-doctor.** `readGateProject` now distinguishes three cases instead of
two: absent `ci.prePush` (silent, defaults — matches the hook's own
`ci.get('prePush', [...])` fallback), a malformed `ci.prePush` (present but
not a string array — bare string, mixed array, or object), and an
unparseable `.emit-infra.json`. The latter two are surfaced as a
`ConfigIssue` on the returned `GateProject` (`kind: 'malformed-pre-push' |
'unparseable-json'`, plus a human-readable `message`), threaded through
`buildGateReport` into `ProjectGateReport`, and printed via a new
`printConfigIssue()` before the static/dynamic sections. Crucially, the
project is no longer dropped from the scan on unparseable JSON — it now
still gets `ciScriptPath` resolution and default targets, just flagged.

**Exit-code decision:** both cases count as findings, not just warnings —
`reportFailing()` now also checks `Boolean(report.configIssue)`. Rationale:
I checked what the actual hook (`scripts/lib/pre-push-config.sh`) does with
these same inputs, and it does *not* fall back gracefully — `ci.get('prePush',
[...])` only supplies a default when the key is *absent*; a present-but-malformed
value (e.g. a bare string) gets fed straight into `' '.join(...)`, which
either produces garbage (joining the characters of a string) or throws.
Same for unparseable JSON — `json.load()` throwing kills the whole hook under
`set -euo pipefail`. So gate-doctor silently substituting defaults for either
case and reporting "clean" would be actively misleading about whether the
real push gate is runnable, which is exactly the failure mode this tool
exists to catch (see sprint 298). Non-zero exit is the correct signal.

**ESLint plugin warning.** The sprint's own wording ("`pnpm nx lint dashboard`
prints this on every run") turned out not to match reality — the
`@nx/eslint:lint` executor doesn't trigger it; the warning is emitted by
Next's own build-time ESLint check, i.e. `pnpm nx run dashboard:build`
(confirmed by removing my fix and reproducing 3/3 times). Since the sprint's
underlying goal — stop this warning from firing on routine CI runs — holds
regardless of which target actually prints it, I fixed the real trigger
rather than a no-op on the named one.

Root cause: `eslint-config-next` / `@next/eslint-plugin-next` was not
installed anywhere in the workspace. I installed just
`@next/eslint-plugin-next` (single dependency: `fast-glob`) rather than the
full `eslint-config-next` (which also pulls in `eslint-plugin-react`,
`eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`,
`@rushstack/eslint-patch`, and two import-resolver packages) — the dashboard
already has its own TS/React lint coverage from the root config, so the extra
weight bought nothing.

Getting Next's build-time detection to actually see the plugin took two
tries. Next's `runLintCheck.js` decides whether "the plugin was detected" by
calling `eslint.calculateConfigForFile()` against the *found config file's own
path* (`eslint.config.js`) and the nearest `package.json` — not against any
dashboard source file. A `files`-scoped block (correct for actually linting
dashboard `.ts`/`.tsx` files) is therefore invisible to that specific check,
since `eslint.config.js` and `package.json` never match a `**/*.ts` glob.
Fix: register the plugin in an unscoped block (`plugins: { '@next/next':
nextPlugin }`, no `files`, no `rules`) so it appears in the config Next
resolves for those two paths — a bare plugin registration is inert for every
other file since no rule from it is turned on — and put the actual
`nextFlatConfig.recommended.rules` in a second block scoped to
`apps/dashboard/**/*.{ts,tsx}`.

Registering the plugin surfaced one more warning:
`no-html-link-for-pages`'s `execOnce` console.warn ("Pages directory cannot
be found") since dashboard is App Router only and this repo has no `pages/`
directory anywhere. This isn't a lint finding against dashboard code — it's
an inapplicable rule complaining about its own missing precondition, i.e.
the exact shape of noise this sprint exists to eliminate. Turned it off with
a comment explaining why, rather than leaving it to fire on every build.

Ran `pnpm nx lint dashboard` and `pnpm nx run-many -t lint` after wiring the
plugin in: **zero new findings** — `✔ All files pass linting` across all 5
projects. No warn-vs-defer decision was needed since there was nothing to
decide between.

One side note for future-me: an ad-hoc `npx next build --webpack` (outside
the pnpm/nx-resolved workspace toolchain) resolved a stray global Next 16.2.6
instead of the workspace-pinned 15.5.19, which auto-migrated
`apps/dashboard/tsconfig.json` and `next-env.d.ts` to the newer schema and
then crashed on an unrelated Turbopack/webpack prerender error. Reverted
before it touched anything real. Always go through `pnpm nx run
dashboard:build`, not a bare `npx next`, in this repo.

### Files changed
- `apps/cli/src/lib/gate-doctor-scan.ts` — `readGateProject` now returns a
  `ConfigIssue` for malformed `ci.prePush` or unparseable JSON instead of
  either silently defaulting or dropping the project; added `describeShape()`
  helper for the malformed-shape message.
- `apps/cli/src/lib/gate-doctor-report.ts` — `ProjectGateReport` gained
  `configIssue`; `reportFailing()` now treats it as a finding; added
  `printConfigIssue()`.
- `apps/cli/src/commands/gate-doctor.ts` — `buildGateReport` threads
  `project.configIssue` through; the command prints it before static/dynamic
  results.
- `apps/cli/src/commands/gate-doctor.test.ts` — added coverage for
  `reportHasIssues` with a config-issue-only report and `buildGateReport`
  passing `configIssue` through.
- (new) `apps/cli/src/lib/gate-doctor-scan.test.ts` — covers valid array,
  absent `ci.prePush`/absent `ci` (both silent defaults), malformed shapes
  (bare string, mixed array, object), and unparseable JSON.
- `eslint.config.js` — added `@next/eslint-plugin-next` in two blocks (bare
  registration + dashboard-scoped rules), with `no-html-link-for-pages`
  turned off for the app-router-only reason above.
- `package.json` / `pnpm-lock.yaml` — added `@next/eslint-plugin-next
  ^15.0.0` as a devDependency.

### Verification
- `pnpm nx run cli:test --skip-nx-cache`: 19 files, 201/201 pass (includes 8
  new gate-doctor-scan tests + 2 new gate-doctor.test.ts cases).
- `pnpm nx run-many -t test --skip-nx-cache`: 42 files, 357/357 pass repo-wide.
- `pnpm nx run-many -t typecheck --skip-nx-cache`: clean across all 5 projects
  (dashboard, types, core, api, cli).
- `pnpm nx run-many -t lint --skip-nx-cache`: clean across all 5 projects,
  zero new findings from the Next plugin.
- `pnpm nx run dashboard:build --skip-nx-cache`, run 3× after the fix:
  0/3 showed the plugin warning (was 100% reproducible before the fix).
- Fleet run, `.../cli/dist/index.js gate-doctor --roots ~/projects`:
  - **Before** (pre-change CLI build): `Checking push gate for 8 projects
    (static only...)` → `No gate issues found.`
  - **After** (post-change CLI build): identical — `Checking push gate for 8
    projects (static only...)` → `No gate issues found.`
  - Same 8 projects, same clean result — no new false positives.

### Follow-ups
- `[defer]` `@next/eslint-plugin-next` resolved to `15.5.23` (repo's `next`
  itself is pinned to `15.5.19` via `apps/dashboard/package.json`'s
  `^15.0.0` range) — harmless today since the plugin's `flatConfig` export
  has been stable across that range, but worth pinning them to match if
  either drifts further.
- `[defer]` `pnpm nx run dashboard:build` prints an unrelated "Nx detected a
  flaky task" notice on `dashboard:lint` intermittently (stdout differs
  slightly run-to-run even with `--skip-nx-cache`) — pre-existing, not
  touched here, not related to this sprint's change.
