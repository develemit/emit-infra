# Audit check: Dockerfile must capture BUILD_NUMBER build-arg
**Difficulty:** 2

## Goal
Add a `warn`-severity check to `emit-infra audit` that fires when a Dockerfile
is missing `ARG BUILD_NUMBER` (or `ARG BUILD_NUMBER=`) — meaning the `BUILD_NUMBER`
build-arg passed by the CI workflow is silently dropped and never available at
runtime.

## Reason
`buildWorkflow()` in `init.ts` already passes `BUILD_NUMBER=${{ github.run_number }}`
as a Docker build-arg, and the blue-green deploy script reads `.deployed-version`
from the server. But if a project's Dockerfile never declares `ARG BUILD_NUMBER`,
the value is dropped at build time and no amount of healthz wiring will surface it.
This check closes the silent-drop gap so projects get actionable feedback at audit
time rather than discovering it in production.

## Context
- `apps/cli/src/commands/audit.ts` — `auditDockerfile(filepath, content)` returns
  `Issue[]`. The existing checks (dev CMD, multi-stage, pnpm frozen-lockfile, etc.)
  are the pattern to follow. Append a new check at the end of the function body.
- Severity scale: `critical` = breaks prod, `warn` = likely bug / missing practice,
  `info` = style. Missing `ARG BUILD_NUMBER` is a `warn`.
- Two cases to catch:
  1. `ARG BUILD_NUMBER` not present at all → warn.
  2. `ARG BUILD_NUMBER` is present but `ENV BUILD_NUMBER` (or `ENV NEXT_PUBLIC_BUILD_NUMBER`)
     is absent → separate `info`-level note that the arg is declared but not promoted
     to a runtime env var (common oversight for Next.js projects).
- Do NOT fire this check if the Dockerfile has no `COPY` or `RUN` instructions —
  it's probably a stub/placeholder with nothing to build. Use the existing
  `isMultiStage` detection as a proxy: only fire if `isMultiStage` is true, since
  single-stage Dockerfiles already get the `critical` multi-stage warning.

## Tasks
1. In `auditDockerfile`, after the existing checks, add:
   ```ts
   // BUILD_NUMBER build-arg capture
   const hasBuildNumberArg = lines.some(l => /^ARG\s+BUILD_NUMBER/i.test(l))
   const hasBuildNumberEnv = lines.some(l => /^ENV\s+.*BUILD_NUMBER/i.test(l))
   if (isMultiStage && !hasBuildNumberArg) {
     issues.push({
       severity: 'warn',
       file: rel,
       message: 'BUILD_NUMBER build-arg not declared — the value passed by CI is silently dropped.',
       fix: 'Add "ARG BUILD_NUMBER" before the final stage CMD, then "ENV BUILD_NUMBER=$BUILD_NUMBER" to expose it at runtime.',
     })
   } else if (isMultiStage && hasBuildNumberArg && !hasBuildNumberEnv) {
     issues.push({
       severity: 'info',
       file: rel,
       message: 'ARG BUILD_NUMBER declared but not promoted to ENV — not available as a runtime env var.',
       fix: 'Add "ENV BUILD_NUMBER=$BUILD_NUMBER" (or "ENV NEXT_PUBLIC_BUILD_NUMBER=$BUILD_NUMBER" for Next.js) after the ARG line.',
     })
   }
   ```
2. Run `pnpm nx run cli:typecheck` — confirm clean.
3. Manual spot-check: run `emit-infra audit --local` from a project that lacks
   `ARG BUILD_NUMBER` in its Dockerfile and confirm the warn fires.

## Files involved
- `apps/cli/src/commands/audit.ts` — add two checks inside `auditDockerfile`

## Acceptance criteria
- [ ] `emit-infra audit --local` on a multi-stage Dockerfile without `ARG BUILD_NUMBER`
  reports a `warn` with the correct fix message
- [ ] `emit-infra audit --local` on a Dockerfile with `ARG BUILD_NUMBER` but no `ENV`
  reports an `info` about promotion
- [ ] `emit-infra audit --local` on a correct Dockerfile (`ARG` + `ENV`) reports no
  BUILD_NUMBER issues
- [ ] Single-stage Dockerfiles do not trigger these checks (they already have the
  multi-stage `critical` to address first)
- [ ] `pnpm nx run cli:typecheck` clean

## Out of scope
- Adding `ARG BUILD_NUMBER` to any project's actual Dockerfile (that's each project's work)
- Checking `NEXT_PUBLIC_*` prefix — the `info` message mentions it as guidance
