# Sprint 13 — Registry Cleanup Workflow

**Difficulty:** 3

## Goal

A scheduled GitHub Actions workflow that prunes old build-number tags from
ghcr.io, keeping only the last N versions per image.

## Reason

Every build pushes a new numbered tag that persists in the registry. Over
months, a project with daily deploys accumulates hundreds of tags and their
associated image layers. ghcr.io storage is free for public repos but metered
for private ones — and even for public repos, a cluttered tag list makes
`emit versions` noisy. This workflow keeps the registry tidy automatically.

## Context

- Sprint 09 pushes tags in the format `<registry>/<owner>/<image>:<N>` to
  ghcr.io. It also pushes `:latest` and `:sha` tags.
- The ghcr.io API for listing and deleting package versions uses the GitHub
  REST API (`/user/packages/container/<name>/versions`), NOT the OCI
  distribution API. Deleting a version requires `packages:delete` scope or
  the `delete:packages` permission.
- `.github/workflows/build-images.yml` — the reusable build workflow. The
  cleanup workflow is a separate file, not part of this one.
- The cleanup workflow should be reusable (`workflow_call`) so project repos
  can call it on a schedule, AND have a `workflow_dispatch` trigger for
  manual runs. It should also support being called with a cron schedule
  directly in project repos.
- The workflow needs to know which images to clean. This can be passed as an
  input (same `images` JSON array format as `build-images.yml`) or
  discovered from the repo.

## Tasks

1. [x] Create `.github/workflows/cleanup-images.yml` as a reusable workflow:
   - Triggers: `workflow_call` (for project repos) and `workflow_dispatch`
     (for manual runs)
   - Inputs:
     - `images` (JSON array, same format as build-images): which images to clean
     - `keep` (number, default 10): how many recent build-number tags to keep
     - `registry` (string, default `ghcr.io`)
     - `dry-run` (boolean, default false): log what would be deleted without deleting
   - Permissions: `packages: write` for deletion
2. [x] For each image in the matrix:
   - List all package versions via GitHub API
   - Filter to versions whose tags are purely numeric (build numbers)
   - Sort by tag number descending
   - Delete versions beyond the `keep` threshold
   - Always preserve `:latest`, `:rollback`, and `:sha` tagged versions
3. [x] Add clear logging: which tags are kept, which are deleted, total space
   reclaimed (if the API provides it).
4. [x] Handle the case where an image has fewer than `keep` versions (no-op).
5. [x] Handle the case where a version has multiple tags (e.g., `:42` and
   `:latest` point to the same manifest) — only delete if ALL tags on that
   version are eligible for cleanup.

## Files involved

- new file: `.github/workflows/cleanup-images.yml` — the cleanup workflow

## Acceptance criteria

- [x] Workflow deletes numeric-tagged versions older than the last N
- [x] `:latest`, `:rollback`, and SHA tags are never deleted
- [x] Multi-tagged versions are preserved if any tag is protected
- [x] `dry-run: true` logs actions without deleting
- [x] `keep` input controls retention count (default 10)
- [x] Workflow is callable via `workflow_call` and `workflow_dispatch`
- [x] No images deleted when fewer than `keep` versions exist

## Completed

**Date:** 2026-06-06

### Summary
Created a reusable `cleanup-images.yml` workflow that prunes old build-number
tags from ghcr.io. Uses `actions/github-script@v7` to call the GitHub Packages
API — lists all container versions, classifies tags as protected (`:latest`,
`:rollback`, 40-char SHA) or numeric build numbers, sorts by build number,
and deletes versions beyond the retention count. Multi-tagged versions are
preserved if any tag is protected. Supports both user-owned and org-owned
packages via try/catch fallback between API endpoints. Dry-run mode logs
what would be deleted without acting.

### Files changed
- (new) `.github/workflows/cleanup-images.yml` — reusable registry cleanup workflow

### Verification
- Code inspection: all 7 acceptance criteria verified against the workflow YAML/JS
- No typecheck applicable (GH Actions YAML with inline JS)

### Follow-ups
none

## Out of scope

- Automatic scheduling — project repos add their own cron trigger when
  calling this workflow (just like they call `build-images.yml`)
- Cleaning up git tags (`build/<image>/<N>`) — those are tiny and harmless
- Server-side image cleanup (already handled by `docker image prune` in
  the Ansible post-deploy tasks)
