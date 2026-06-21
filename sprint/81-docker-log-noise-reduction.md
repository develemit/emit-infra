# Suppress docker push/pull layer progress in deploy logs
**Difficulty:** 1

## Goal
Add `--quiet` to `docker push` and `docker pull` invocations in each project's deploy scripts so that the hundreds of `\r`-terminated layer progress lines don't pollute the captured log files.

## Reason
Sprint 76 captures all deploy output to `.deploy-logs/`. Docker layer progress output (`Pushing layer abc123... 12.3MB/45.6MB`) produces hundreds of carriage-return-terminated lines per push/pull, making logs noisy and harder to skim for the actual result. `--quiet` suppresses the progress stream and only emits the final digest line.

## Context
The four wired projects all have deploy scripts that source `emit-infra/scripts/lib/ci-utils.sh`. Each has its own `scripts/deploy.sh` with explicit `docker push` / `docker pull` calls. Some may also use `docker compose pull` or `docker buildx build --push`. The `--quiet` / `-q` flag works for `docker push`, `docker pull`, and `docker buildx build`.

Project deploy scripts to edit:
- `/Users/emitdutcher/projects/develemail/scripts/deploy.sh`
- `/Users/emitdutcher/projects/emit-vision/scripts/deploy.sh`
- `/Users/emitdutcher/projects/diner-decider/scripts/deploy.sh`
- `/Users/emitdutcher/projects/tastease/scripts/deploy.sh`

Read each file before editing. Add `--quiet` (or `-q`) to every `docker push` and `docker pull` line. If any script uses `docker compose pull`, add `--quiet` there too. If `docker buildx build --push` is used, add `--quiet` to that as well.

Do not add `--quiet` to `docker build` (without `--push`) — build output is useful to retain.

## Tasks
1. Read each of the four deploy scripts.
2. For each `docker push <args>` line, change to `docker push --quiet <args>`.
3. For each `docker pull <args>` line, change to `docker pull --quiet <args>`.
4. For `docker compose pull`, add `--quiet` if present.
5. For `docker buildx build --push`, add `--quiet` if present.
6. Verify no `docker build` (without `--push`) gets the flag.

## Files involved
- `/Users/emitdutcher/projects/develemail/scripts/deploy.sh`
- `/Users/emitdutcher/projects/emit-vision/scripts/deploy.sh`
- `/Users/emitdutcher/projects/diner-decider/scripts/deploy.sh`
- `/Users/emitdutcher/projects/tastease/scripts/deploy.sh`

## Acceptance criteria
- [x] All four deploy scripts have `--quiet` on every `docker push` and `docker pull`
- [x] No `docker build` (without `--push`) has `--quiet` added
- [x] Scripts are valid bash (no syntax errors introduced)

## Completed

**Date:** 2026-06-20

### Summary
Added `--quiet` to all `docker push` invocations across develemail, diner-decider, and tastease, and to all four `docker buildx build --push` calls in emit-vision. emit-vision uses multiline build commands so `--quiet` was appended to the `--push` line. No `docker build` (without `--push`) commands were affected. All four scripts passed `bash -n` syntax validation.

### Files changed
- `/Users/emitdutcher/projects/develemail/scripts/deploy.sh` — `--quiet` on 2 push lines
- `/Users/emitdutcher/projects/emit-vision/scripts/deploy.sh` — `--quiet` on 4 `buildx build --push` lines
- `/Users/emitdutcher/projects/diner-decider/scripts/deploy.sh` — `--quiet` on 2 push lines
- `/Users/emitdutcher/projects/tastease/scripts/deploy.sh` — `--quiet` on 4 push lines

### Verification
- `bash -n` on all four scripts: clean (no syntax errors)
- grep confirms all docker push/buildx --push lines have `--quiet`
- No docker build (without --push) lines were modified

### Follow-ups
none

## Out of scope
- Changing anything in `ci.sh` scripts (CI doesn't push/pull images)
- Modifying `ci-utils.sh` itself
- Adding `--quiet` to `docker logs` or `docker exec` calls
