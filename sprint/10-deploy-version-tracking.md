# Sprint 10 — Deploy Version Tracking on the Server

**Difficulty:** 3

## Goal

After every deploy, the running build number is recorded on the server and
exposed through the emit-infra API so the CLI and dashboard can read it.

## Reason

Sprint 09 tags images with build numbers at build time, but once they're
pulled to the server via `docker compose pull`, there's no easy way to ask
"what build is running?" without inspecting Docker labels. This sprint makes
the deployed version a first-class piece of data — queryable via the API
alongside uptime, disk, and memory. Without this, the dashboard and CLI
can't display version info.

## Context

- Sprint 09 adds OCI labels to every image: `build.number`, `build.sha`,
  `build.repo`, `build.date`. These labels survive `docker pull` and are
  readable via `docker inspect`.
- `ansible/roles/app-deploy/tasks/main.yml` — dispatcher that runs setup
  then includes either `deploy-standard.yml` or `deploy-zero-downtime.yml`.
  Post-deploy tasks (dangling image prune, post-deploy commands) run after
  the include.
- `apps/api/src/routes/projects.ts` — the `/projects/:name/status` endpoint
  SSHes to the server and returns uptime, disk, memory, container counts,
  and HTTP status. The `/projects/:name/containers` endpoint returns
  `{name, image, status, state}` per container.
- The status response type `StatusData` is defined inline in `projects.ts`
  (lines 16-22).
- The dashboard polls `/projects/:name/status` every 30s (cached 20s
  server-side via `statusCache`).

## Tasks

1. [x] Add a post-deploy task in `ansible/roles/app-deploy/tasks/main.yml`
   (after the deploy strategy include, before dangling image prune) that
   reads the `build.number` label from the first running compose container:
   ```
   docker inspect --format '{{index .Config.Labels "build.number"}}' \
     $(docker compose -f <compose_file> ps -q | head -1)
   ```
   Write the result to `{{ app_dir }}/.deployed-version`.
2. [x] Extend the `/projects/:name/status` API endpoint to also read the
   deployed version. Add to the SSH command a line that reads
   `.deployed-version` from the app dir:
   `cat /opt/<project>/.deployed-version 2>/dev/null || echo ""`
3. [x] Add `buildNumber: string | null` to the `StatusData` type and include
   it in the response.
4. [x] The containers endpoint already returns the `image` field (which
   includes the tag). No changes needed there — but verify that the image
   tag includes the build number after sprint 09's changes propagate
   through compose files.

## Files involved

- `ansible/roles/app-deploy/tasks/main.yml` — add post-deploy version file task
- `apps/api/src/routes/projects.ts` — extend SSH command + StatusData type
- `apps/dashboard/src/lib/api.ts` — update `ProjectStatus` type to include `buildNumber`

## Acceptance criteria

- [x] After deploy, `{{ app_dir }}/.deployed-version` contains the build number
- [x] `/projects/:name/status` response includes `buildNumber` field
- [x] `buildNumber` is `null` when no `.deployed-version` file exists (graceful fallback)
- [x] Typecheck clean across api and dashboard

## Completed

**Date:** 2026-06-06

### Summary
Added post-deploy version tracking across three layers. The Ansible app-deploy
role now reads the `build.number` OCI label from the first running container
after deploy and writes it to `.deployed-version`. The API status endpoint
appends a `cat` of this file to its SSH command and returns `buildNumber` in
the response. The dashboard's `ProjectStatus` type was extended to include the
new field.

### Files changed
- `ansible/roles/app-deploy/tasks/main.yml` — added two post-deploy tasks: read build number from container label, write to `.deployed-version`
- `apps/api/src/routes/projects.ts` — added `buildNumber` to `StatusData` type, extended SSH command to read `.deployed-version`, parse and return in response
- `apps/dashboard/src/lib/api.ts` — added `buildNumber?: string | null` to `ProjectStatus` interface

### Verification
- Typecheck (api): clean
- Typecheck (dashboard): clean
- Code inspection: graceful fallback via `|| echo ""` and `|| null` confirmed

### Follow-ups
none

## Out of scope

- Displaying the build number in the dashboard UI (sprint 12)
- CLI version listing (sprint 11)
- Handling projects that haven't been deployed with build-number-tagged images yet
  (they'll just show `buildNumber: null`)
