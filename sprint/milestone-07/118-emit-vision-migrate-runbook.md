# Sprint 118 — emit-vision migrate.sh runbook documentation

> _Promoted from sprint-60 backlog item, 2026-06-29._

**Difficulty:** 1

## Goal

Add a "Running migrations" section to `docs/emit-vision/SETUP.md` documenting the required env vars for `infra/scripts/migrate.sh`, particularly for the `docker run` fallback path.

## Context

`emit-vision/infra/scripts/migrate.sh` requires three env vars:
- `SERVER_IP` — Hetzner floating IP (already in secrets)
- `GHCR_ORG` — GitHub org that owns the container registry (e.g. `develemit`)
- `IMAGE_TAG` — image tag to pull for the fallback `docker run` path (defaults to `"latest"` if unset)

The script tries `docker exec` into a running container first; if that fails, it falls back to `docker run ghcr.io/$GHCR_ORG/emit-api:$IMAGE_TAG ...`. The `docker run` fallback is the path most likely to be used by an operator during an incident (when the app container isn't running). However, `docs/emit-vision/SETUP.md` has no migration section at all — `GHCR_ORG` and `IMAGE_TAG` appear nowhere in it.

`SERVER_IP` is already listed in the Secrets inventory. The missing piece is documenting when and how to run the script and what `GHCR_ORG` + `IMAGE_TAG` mean.

## Tasks

1. Read `docs/emit-vision/SETUP.md` in full (it is ~150 lines).
2. Read `emit-vision/infra/scripts/migrate.sh` (absolute path: `/Users/emitdutcher/projects/emit-vision/infra/scripts/migrate.sh`) to understand the full script.
3. Append a `## Running migrations` section to `docs/emit-vision/SETUP.md` that covers:
   - When to run the script (schema changes; CI runs it automatically on deploy, but can be run manually)
   - Required env vars: `SERVER_IP` (already in secrets), `GHCR_ORG` (your GitHub org, e.g. `develemit`), `IMAGE_TAG` (optional, defaults to `latest`)
   - Example invocation
   - Note about the `docker run` fallback: used when no running container is present; requires `GHCR_ORG` + `IMAGE_TAG` to be set

## Files involved

- `docs/emit-vision/SETUP.md` — add `## Running migrations` section

## Acceptance criteria

- [x] `docs/emit-vision/SETUP.md` has a `## Running migrations` section
- [x] Section documents `GHCR_ORG` and `IMAGE_TAG` env vars
- [x] Section includes an example invocation for the manual case
- [x] Section explains the `docker run` fallback and when it's used

## Completed

**Date:** 2026-06-29

### Summary
Added a `## Running migrations` section (39 lines) to `docs/emit-vision/SETUP.md`. It covers when to run `infra/scripts/migrate.sh` manually, documents all three env vars (`SERVER_IP`, `GHCR_ORG`, `IMAGE_TAG`), provides an example invocation, and explains the `docker compose exec` → `docker run` fallback used during incidents when the app container is down.

### Files changed
- `docs/emit-vision/SETUP.md` — added `## Running migrations` section at end

### Verification
- Section present at line 152 with all required content
- `GHCR_ORG` and `IMAGE_TAG` documented with explanations
- Example invocation included
- Fallback path explained

### Follow-ups
- none
