# Sprint 124 — Add `logs` command to emit-infra CLI

**Difficulty:** 2

## Goal

Add `emit-infra logs [container]` that SSHes into the server and returns Docker container logs, with options for line count, time window, and an error-only filter. Useful for autonomous triage by Claude code sessions.

## Reason

Currently there is no way for a Claude code session (or a developer at the terminal) to pull prod logs without knowing the server IP, SSH key path, and container names. The `status` command tells you containers are running but not what they're saying. A `logs` command closes that gap: one command, no setup, actionable output. The `--errors` flag in particular makes it viable in an AI context — instead of dumping 1000 lines, it returns a compact error-signal slice that fits comfortably in a context window.

## Context

- `apps/cli/src/commands/status.ts` — the exact pattern to replicate: `loadConfig` → resolve host → `sshExec` → print. Copy this structure.
- `packages/core/src/ssh.ts` — `sshExec(host, command, keyPath): Promise<string>`. Already handles multiplexing.
- `apps/cli/src/index.ts` — add `import { registerLogs } from './commands/logs.js'` and `registerLogs(program)` alongside the other commands.
- Default SSH key for this CLI is `~/.ssh/emit-deploy` (see `status.ts` line 23).
- `getTerraformOutput('server_ip')` helper is defined in `status.ts` — copy it into `logs.ts` (or accept minor duplication; do not extract yet).

### Docker log fetching strategy

To log all containers, first resolve names with `docker ps --format '{{.Names}}'`, then loop and call `docker logs` on each. Build this as a single shell string passed to `sshExec`:

```bash
# all containers
docker ps --format '{{.Names}}' | while read name; do
  echo "=== $name ===";
  docker logs --tail 100 $name 2>&1;
done

# single container
docker logs --tail 100 <name> 2>&1

# with --since
docker logs --tail 100 --since 1h <name> 2>&1

# with --errors (append grep after docker logs)
docker logs --tail 500 <name> 2>&1 | grep -iE 'error|warn|fatal|exception|panic|traceback'
```

When `--errors` is set, use `--tail 500` as the base (more input to filter) regardless of `--lines`.

## Tasks

1. Read `apps/cli/src/commands/status.ts` in full to confirm the exact pattern (imports, option wiring, `getTerraformOutput` helper).
2. Create `apps/cli/src/commands/logs.ts`:
   - Positional arg: `[container]` (optional — omit for all containers)
   - Options: `--config <path>`, `--key <path>` (default `~/.ssh/emit-deploy`), `--host <ip>`, `--lines <n>` (default `'100'`), `--since <duration>` (e.g. `1h`, `30m`), `--errors` (boolean flag)
   - Build the shell script string from the options above
   - Print output with a `chalk.cyan` header showing project name and host, same style as `status`
3. Register in `apps/cli/src/index.ts`: import `registerLogs` and call it.
4. Run `pnpm nx typecheck cli --skip-nx-cache`. Fix any type errors.

## Files involved

- new file: `apps/cli/src/commands/logs.ts` — the new command
- `apps/cli/src/index.ts` — add import + `registerLogs(program)` call

## Acceptance criteria

- [x] `apps/cli/src/commands/logs.ts` exists and exports `registerLogs`
- [x] `emit-infra logs` (no args) fetches last 100 lines from all running containers
- [x] `emit-infra logs <name>` scopes to a single named container
- [x] `--lines N` overrides the default line count
- [x] `--since <duration>` passes `--since` through to `docker logs`
- [x] `--errors` filters output to lines matching `error|warn|fatal|exception|panic|traceback` (case-insensitive)
- [x] Command is registered in `index.ts` and appears in `emit-infra --help`
- [x] `pnpm nx typecheck cli --skip-nx-cache` passes clean

## Completed

**Date:** 2026-06-30

### Summary
Added `emit-infra logs [container]` command following the same pattern as `status.ts`: `loadConfig` → resolve host via terraform or `--host` → `sshExec` → print. Supports `--lines`, `--since`, and `--errors` flags. The `--errors` flag bumps the tail to 500 lines and pipes through a case-insensitive grep for error/warn/fatal/exception/panic/traceback patterns. When no container is specified, loops all running containers via `docker ps --format '{{.Names}}'`.

### Files changed
- (new) `apps/cli/src/commands/logs.ts` — new `logs` command with container, lines, since, errors options
- `apps/cli/src/index.ts` — added import and `registerLogs(program)` call

### Verification
- `pnpm nx typecheck cli --skip-nx-cache`: clean

### Follow-ups
- `[defer]` `getTerraformOutput` is now duplicated in `status.ts` and `logs.ts` — extract to a shared helper when a third consumer appears

## Out of scope

- `--follow` / streaming mode (ssh streaming is complex and less useful in non-interactive sessions)
- Deduplicating the `getTerraformOutput` helper into a shared util (minor tech debt, separate sprint if ever)
- Log forwarding to a file or external sink
