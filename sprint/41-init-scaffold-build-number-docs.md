# Update `emit-infra init` scaffold with BUILD_NUMBER guidance
**Difficulty:** 2

## Goal
Update the `buildWorkflow()` function in `init.ts` so the scaffolded
`.github/workflows/deploy.yml` includes a comment block explaining the required
Dockerfile changes, and update `emit-infra init`'s "Next steps" output to
mention verifying `/healthz` after first deploy.

## Reason
Right now a developer running `emit-infra init` gets a workflow that passes
`BUILD_NUMBER` to Docker, but nothing tells them they need to add `ARG BUILD_NUMBER`
+ `ENV BUILD_NUMBER=$BUILD_NUMBER` to their Dockerfile for it to flow through.
The audit check in sprint 39 catches the miss, but it's better to prevent it at
scaffold time. Similarly, "Push to GitHub to trigger the deploy workflow" is the
last guidance given — adding a one-liner about `/healthz` sets the expectation
that build validation is part of the deploy loop.

## Context
- `apps/cli/src/commands/init.ts` — `buildWorkflow(config)` returns a YAML
  string. The `Build and push` step currently has:
  ```yaml
        build-args: |
          BUILD_NUMBER=${{ github.run_number }}
        labels: |
          build.number=${{ github.run_number }}
  ```
  Add a `# NOTE:` comment block immediately above `build-args:`.
- The "Next steps" `console.log` block is at the bottom of `registerInit`'s
  action handler, after the hook result block. Add one line there.
- Keep changes minimal — no new logic, only comments and one console.log line.
  `buildWorkflow` already returns the correct YAML; this is documentation only.

## Tasks
1. In `buildWorkflow()`, add a comment block above `build-args:` in the
   `Build and push` step:
   ```yaml
           # BUILD_NUMBER is passed as a Docker build-arg.
           # Your Dockerfile must declare: ARG BUILD_NUMBER
           # To expose at runtime:        ENV BUILD_NUMBER=$BUILD_NUMBER
           # For Next.js public access:   ENV NEXT_PUBLIC_BUILD_NUMBER=$BUILD_NUMBER
   ```
   Indent to match the surrounding YAML (10 spaces, since the `build-args:` key
   is at 10-space indent in the template string).

2. In the "Next steps" `console.log` block inside `registerInit`, add after the
   "Push to GitHub" line:
   ```ts
   console.log(`  curl https://${config.domain}/healthz  # verify build number after first deploy`)
   ```

3. Run `pnpm nx run cli:typecheck` — confirm clean.

4. Manually check that `emit-infra init test-project --domain test.com --repo develemit/test`
   (dry-run by reading the written file) produces valid YAML with the comment block
   in the right place.

## Files involved
- `apps/cli/src/commands/init.ts` — add comment block in `buildWorkflow()`;
  add one `console.log` line in "Next steps"

## Acceptance criteria
- [ ] Scaffolded `deploy.yml` contains the `ARG BUILD_NUMBER` / `ENV` comment block
  immediately above `build-args:`
- [ ] `emit-infra init` "Next steps" output includes the healthz curl line
- [ ] `pnpm nx run cli:typecheck` clean
- [ ] The comment block is valid YAML (comments don't break yaml parsing)

## Out of scope
- Changing the actual workflow logic — comments only
- Adding `ARG BUILD_NUMBER` to a generated Dockerfile template (emit-infra doesn't
  scaffold Dockerfiles)
- Any changes to existing projects' scaffolded workflows
