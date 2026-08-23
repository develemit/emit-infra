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
- A project with a malformed `ci.prePush` produces visible output naming the
  project and what's wrong; a project with an absent one stays silent.
- An unparseable `.emit-infra.json` is reported, not silently dropped.
- The exit-code decision is stated explicitly in the Completed section.
- Tests cover all shapes in task 4.
- Fleet run before/after shows no new false positives — paste both outputs.
- The Next plugin warning is gone, or its persistence is explained with a
  recommendation.
- Typecheck clean, `pnpm test` green.
