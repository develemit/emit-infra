# Show which image is building instead of one 38-minute step
**Difficulty:** 3

## Goal
While a deploy builds images, the dashboard and log show which image is being
built and how many remain — instead of a single step that sits unchanged for
half an hour.

## Reason
A tastease deploy sat at `66% Building + pushing images` for roughly 38 minutes
while four images built one after another. Nothing distinguished "three images
still to go" from "wedged on the first one", which is exactly the judgement an
operator needs during a slow deploy: the earlier `deploy-detached.sh --watch`
incident was made worse because there was no way to tell progress from a stall.
The build phase is the longest part of a deploy and currently the least
observable.

## Context

### Where progress is emitted
- `scripts/hooks/pre-push` computes a step budget: `STEPS` is incremented by 2
  when `TO_BUILD` is non-empty and by 1 when `TO_RETAG` is non-empty
  (`pre-push:185-186`), then `deploy_phase` / `deploy_step` advance it.
- The build phase runs `run_build_fanout "$MAX_PARALLEL" _fail_deploy
  "${TO_BUILD[@]}"` (`pre-push:218`), defined in `scripts/lib/deploy-plan.sh:28`.
  `MAX_PARALLEL` defaults to 1 — two concurrent emulated `linux/amd64` Node
  builds can exhaust the Docker VM's memory — so builds are usually sequential
  and their order is known.
- `build_image()` (`scripts/lib/docker-build.sh`) already prints
  `==> Building <svc>...` and, for each build variant, `==> Building <svc>
  variant '<target>'...`. So the information exists in the log; it just never
  reaches the progress record.
- Build variants matter for the count: tastease's `api` produces both the
  service image and a `-migrate` variant, so "4 images" was really 3 services
  plus a variant.

### The status record
`.deploy-status.json` carries the phase/step state the dashboard renders, and
`.deploy-history.jsonl` records `phases` per deploy. Sprint 253 added coarse
phase timings; this sprint is the per-image granularity that was explicitly
left out. Whatever field you add must stay readable by existing consumers —
older records without it must still render.

### Conventions
Bash libs live in `scripts/lib/` with sibling `*.test.sh` registered in
`test:hooks`. `scripts/lib/deploy-plan.test.sh` already covers the fan-out.
No `check:affected` in this repo; the suite is `pnpm test:hooks` plus
`pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Tasks
1. Count the real unit of work up front: services in `TO_BUILD` **plus** their
   build variants, so the denominator matches what actually gets built.
2. Emit a progress update as each image starts, naming it and its position
   (e.g. `building web (2/4)`), from the fan-out rather than from inside
   `build_image`, so it works for both sequential and parallel runs.
3. Make the dashboard's deploy view show the current image and position; fall
   back cleanly to today's coarse label for records that lack the new field.
4. Keep re-tagged services visible too — a deploy that re-tags rather than
   builds should say so rather than appearing stalled.
5. Cover the counting and progress sequence in `scripts/lib/deploy-plan.test.sh`,
   including a service with a build variant.

## Files involved
- `scripts/hooks/pre-push` — step budget from services + variants
- `scripts/lib/deploy-plan.sh` — per-image progress from the fan-out
- `scripts/lib/deploy-plan.test.sh` — counting and sequence coverage
- `apps/dashboard/src/components/detail/` — render the current image; degrade gracefully

## Acceptance criteria
- [ ] The progress record names the image currently building and its position
      within the total, counting build variants
- [ ] A deploy that only re-tags shows that, rather than an unchanging step
- [ ] Records written before this sprint still render — verify against a real
      entry in an existing `.deploy-history.jsonl`
- [ ] Progress is emitted from the fan-out, so a parallel build
      (`EMIT_BUILD_PARALLEL` > 1) doesn't produce misleading positions
- [ ] Coverage in `scripts/lib/deploy-plan.test.sh` including a variant-producing
      service
- [ ] `pnpm test:hooks`, `pnpm test`, `pnpm typecheck` and `pnpm lint` pass
      (this repo has no `check:affected`)

## Out of scope
- Making builds faster — sprint 338.
- Streaming Docker layer output into the dashboard (the backlog's separate
  "docker layer progress is noisy" item).
- Changing `MAX_PARALLEL`'s default.
