# Sprint 09 — Monotonic Build Number Tagging in Reusable Workflow

**Difficulty:** 4

## Goal

Every Docker image built by the reusable `build-images.yml` workflow gets a
monotonic integer build number tag (e.g., `:42`) alongside `:latest`. The
build number is tracked per-image via git tags in the calling repo.

## Reason

Currently images are tagged with `:latest` and `:sha`. The SHA is unique but
opaque — you can't tell at a glance which build is newer or how many deploys
apart two versions are. A monotonic build number gives clear ordering
(`43 > 42`) and makes rollback targets human-readable. Every subsequent sprint
in this initiative (version tracking, targeted rollback, dashboard display,
cleanup) depends on images having a build number.

## Context

- `.github/workflows/build-images.yml` — reusable `workflow_call` workflow.
  Already tags with `:latest` and `:${{ github.sha }}`. Uses a matrix over a
  JSON array of `{name, dockerfile}` objects. Uses `docker/build-push-action@v6`
  with buildx and GHA caching.
- The workflow is called from other project repos (e.g., martialops). When
  called via `workflow_call`, `actions/checkout` checks out the **calling**
  repo — so git tags live in the calling repo, not emit-infra.
- Registry is `ghcr.io` (default input), auth via `GITHUB_TOKEN`.
- Each image in the matrix gets its own independent counter. Git tag format:
  `build/<image-name>/<N>` (e.g., `build/martialops-web/42`).

## Tasks

1. [x] Update `actions/checkout@v4` step to use `fetch-depth: 0` so all git tags
   are available for reading the last build number.
2. [x] Add a step before the build that computes the next build number for the
   current matrix image:
   - List git tags matching `build/<image-name>/*`
   - Extract the highest number (default to 0 if none exist)
   - Set `next_build_number` to highest + 1
   - Use `$GITHUB_OUTPUT` to pass the value to subsequent steps
3. [x] Add the build number tag to the `tags:` list in `docker/build-push-action`:
   - `<registry>/<owner>/<image>:<build_number>`
   - Keep existing `:latest` and `:sha` tags
4. [x] Add OCI labels via the `labels:` field:
   - `build.number=<N>`
   - `build.sha=${{ github.sha }}`
   - `build.repo=${{ github.repository }}`
   - `build.date=<ISO 8601 timestamp>`
5. [x] Add a step after the build that pushes the git tag
   `build/<image-name>/<N>` back to the calling repo. This needs
   `contents: write` permission (already partially declared — verify and
   update if needed).
6. [x] Handle the race condition: if the tag push fails (concurrent build claimed
   the same number), the workflow should fail clearly with an error message
   rather than silently overwriting. The next retry will pick up the new tag.

## Files involved

- `.github/workflows/build-images.yml` — all changes are here

## Acceptance criteria

- [x] Images are tagged with `:<build_number>` alongside `:latest` and `:sha`
- [x] Build number is monotonically increasing per image name
- [x] Git tag `build/<image-name>/<N>` is pushed to the calling repo after build
- [x] OCI labels include `build.number`, `build.sha`, `build.repo`, `build.date`
- [x] `fetch-depth: 0` ensures tags are available in the checkout
- [x] Concurrent builds fail cleanly rather than overwriting each other's tags
- [x] Existing callers of this workflow continue to work without changes

## Completed

**Date:** 2026-06-06

### Summary
Updated the reusable `build-images.yml` workflow to compute a monotonic build
number per image from git tags (`build/<image-name>/<N>`), tag each image with
`:<N>` alongside `:latest` and `:sha`, embed OCI labels (`build.number`,
`build.sha`, `build.repo`, `build.date`), and push the git tag back to the
calling repo. Concurrent builds are handled by failing on duplicate tag push
rather than silently overwriting. Permission upgraded from `contents: read` to
`contents: write` for tag pushing.

### Files changed
- `.github/workflows/build-images.yml` — added build number computation, image tag, OCI labels, git tag push step; updated checkout to fetch-depth 0 and permissions to contents write

### Verification
- Code inspection: all 6 tasks verified against the workflow YAML
- No typecheck/test applicable (pure GH Actions YAML)
- Backward compatibility: inputs/outputs unchanged, only additive behavior

### Follow-ups
- [defer] Calling repos that explicitly restrict `permissions: contents: read` at the workflow level will need to add `contents: write` for the git tag push to work — document this in a README or migration note

## Out of scope

- Displaying the build number in the dashboard (sprint 12)
- Reading the build number on the server after deploy (sprint 10)
- Registry cleanup of old tags (sprint 13)
- Semantic versioning — this is strictly monotonic integers
