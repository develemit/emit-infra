# Stop a CLI deploy before it flips onto images that don't exist
**Difficulty:** 4

## Goal
`emit-infra deploy` checks that every service's image exists for the target sha
**before** Ansible pulls and switches slots, so a deploy that would ship stale
`:latest` images is refused rather than detected afterwards.

## Reason
Sprint 336 made deploy records honest: a CLI-direct deploy now verifies what
actually shipped and refuses to record a false baseline. But that check runs
*after* `runAnsible` returns — by which point Ansible has already pulled images
and flipped the blue-green slot. The bad deploy still happened; we just stopped
lying about it in the record. Sprint 336's own follow-up says so:

> verification is post-hoc … it can *detect and refuse to record* a bad
> CLI-direct deploy but can't *prevent* the slot-flip onto stale images the way
> a pre-flight registry check would.

That is the difference between "production briefly ran the wrong build and we
noticed" and "production never ran the wrong build". The original emit-billing
incident (2026-08-27) slot-flipped stale `:latest` images; a pre-flight check
would have refused before anything moved.

## Context

### Why this needs a new helper
There is **no TypeScript helper that resolves a per-service image name**
(verified 2026-09-18 — `apps/cli/src/commands/init.ts:83` and
`versions.ts:18` build unrelated shapes). Bash owns the canonical rule, in
`scripts/lib/docker-build.sh`'s `image_name()`:

```bash
if   [[ -n "$IMAGE_PREFIX" ]]; then echo "ghcr.io/$GHCR_ORG/${IMAGE_PREFIX}${svc}"
elif [[ -n "$GHCR_REPO"    ]]; then echo "ghcr.io/$GHCR_ORG/$GHCR_REPO/$svc"
else                                echo "ghcr.io/$GHCR_ORG/$svc"
fi
```

Mirror that exactly in TS and unit-test it against all three branches. Real
fleet examples to use as fixtures: tastease → `develemit/easyliving/api` (no
prefix, `ghcrRepo: easyliving`); develemail → `develemit/develemail-api`
(prefix set); martialops → `develemit/martialops-api`. A drifted copy of this
rule is how the hardcoded prune list rotted (sprint 331) — if sharing the rule
across bash and TS is impractical, say so and note the duplication explicitly.

### Where the check belongs
`apps/cli/src/commands/deploy.ts` — the deploy action resolves config, builds
`extraVars`, calls `runAnsible`, then (sprint 336) calls
`readDeployedBuildNumber` (line ~295) and `deployRecordDone` with
`isBuildBaseline` (lines ~373-394). The pre-flight check goes **before**
`runAnsible`, gated to blue-green projects (service names come from
`config.blueGreen.services`; a project without them declares no per-service
images).

`docker manifest inspect <ref>` is the probe — it needs a local `docker login`
to ghcr.io, which the CLI does not otherwise require. Decide and state how that
is handled: skip with a clear warning when unauthenticated, or fail. **Prefer
skipping loudly over failing** — an auth quirk on a developer machine must not
block a deploy that would otherwise be fine, and sprint 336's post-hoc check
still backstops it.

### The build.number label assumption
Sprint 336's other follow-up: `readDeployedBuildNumber` reads
`LABEL build.number` off the running container, and a project whose Dockerfile
omits it returns an empty string, which is treated as inconclusive — so that
project can never earn a verified baseline. Decide between: (a) detect the
absent label explicitly and say so once, rather than silently degrading, or
(b) require the label and report which fleet images lack it. Check the fleet
before choosing; do not assume every image has it.

### Conventions
Vitest beside source (`apps/cli/src/commands/deploy.test.ts` exists and covers
sprint 336's paths — extend it). Externals are mocked at the `sshExec`/`execa`
boundary; follow what that test file already does. No `check:affected` here;
the suite is `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:hooks`.

## Tasks
1. Add a TS image-name resolver mirroring `image_name()`'s three branches, with
   unit tests covering each using real fleet config shapes.
2. Add a pre-flight check in the CLI deploy path, before `runAnsible`: for each
   blue-green service, confirm the image exists for the target sha. Refuse the
   deploy with a message naming the missing image(s) when it doesn't.
3. Handle the unauthenticated case deliberately (skip loudly, per Context), and
   make that path tested rather than incidental.
4. Resolve the `build.number` label question — pick (a) or (b), check the fleet,
   and record which and why.
5. Keep sprint 336's post-hoc verification in place; this adds a gate, it does
   not replace the record honesty work.

## Files involved
- new file: `apps/cli/src/lib/image-name.ts` (or similar) — the resolver
- new file: its `.test.ts` — three-branch coverage
- `apps/cli/src/commands/deploy.ts` — pre-flight gate before `runAnsible`
- `apps/cli/src/commands/deploy.test.ts` — gate, refusal, and skip-when-unauthenticated

## Acceptance criteria
- [ ] The resolver reproduces `image_name()` for all three branches — prefix,
      ghcrRepo, and bare — proven against tastease, develemail and martialops shapes
- [ ] A deploy whose target sha has no image for some service is refused
      **before** `runAnsible` is called, naming the missing images
- [ ] A deploy whose images all exist proceeds unchanged
- [ ] The unauthenticated-docker case skips the check with a visible warning and
      does not block the deploy — covered by a test
- [ ] The `build.number` label decision is implemented and recorded, with the
      fleet checked rather than assumed
- [ ] Sprint 336's post-hoc verification still runs and still records
      `isBuildBaseline` correctly — its existing tests still pass unmodified
- [ ] Coverage in `apps/cli/src/commands/deploy.test.ts` and the resolver's test
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm test:hooks` pass

## Out of scope
- Deploying anything to verify it — sprint 345 does the real deploy.
- Changing the blue-green slot-flip or Ansible roles.
- Non-blue-green projects (only `test-smoke` uses the standard path).
