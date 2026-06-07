# Fix audit false positive on pnpm projects

**Difficulty:** 1

## Goal

Fix a false-positive warning in `emit-infra audit` that fires on every pnpm
project, reporting a spurious "npm install without --production" warning even
when the Dockerfile correctly uses `pnpm install --frozen-lockfile`.

## Reason

The `npm install` check in `auditDockerfile` uses `/npm install/i` with no word
boundary. The string `pnpm install` contains `npm install` as a substring, so
the regex matches every pnpm Dockerfile line. Since all emit-infra projects
use pnpm, this warning fires on every project and erodes trust in the audit
output.

Discovered when running `emit-infra audit --local` on `diner-decider` after
sprint 26 fixed Dockerfile discovery (2026-06-07).

## Task

In `apps/cli/src/commands/audit.ts`, change the npm install regex on the
`npmLines` filter from:

```ts
const npmLines = lines.filter(l => /npm install(?!.*--production)(?!.*--omit=dev)/i.test(l))
```

to:

```ts
const npmLines = lines.filter(l => /\bnpm install(?!.*--production)(?!.*--omit=dev)/i.test(l))
```

The `\b` word boundary does not match between `p` and `n` in `pnpm` (both
word characters), so `pnpm install` lines are correctly excluded. Bare
`npm install` lines (at line start or after a space) still match.

## Files involved

- `apps/cli/src/commands/audit.ts` — `auditDockerfile`, `npmLines` filter

## Acceptance criteria

- [x] `emit-infra audit --local` run from a pnpm project with
  `pnpm install --frozen-lockfile` in the Dockerfile produces no
  "npm install without --production" warning
- [x] `emit-infra audit --local` run from a project with bare
  `npm install` (no flags) in the Dockerfile still produces the warning

## Completed

**Date:** 2026-06-07

### Summary
Single-character fix: added `\b` word boundary before `npm install` in the `npmLines` regex. `pnpm` contains `npm` as a substring but `\b` does not match between two word characters (`p` and `n`), so `pnpm install` lines are correctly excluded while bare `npm install` lines still trigger the warning.

### Files changed
- `apps/cli/src/commands/audit.ts` — `npmLines` regex: `/npm install/` → `/\bnpm install/`

### Verification
- Regex unit test (node -e): 5/5 cases pass (pnpm with and without --frozen-lockfile, npm install bare, npm install --production, npm install --omit=dev)
- `pnpm nx run cli:typecheck`: clean

### Follow-ups
- none

## Out of scope

- Changing the pnpm `--frozen-lockfile` check — that check already uses
  a dedicated pnpm-aware regex and is correct
