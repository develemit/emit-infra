# Cap Docker container log size via daemon config
**Difficulty:** 1

## Goal
Add `/etc/docker/daemon.json` with `max-size` and `max-file` log limits to the
Docker Ansible role so container stdout/stderr can't silently fill disk.

## Reason
Docker's default `json-file` log driver writes to
`/var/lib/docker/containers/<id>/<id>-json.log` with no size cap. On a
long-running production server with several containers, these logs accumulate
indefinitely. A single chatty service can fill the disk and take down everything
else. Capping at 10 MB × 5 files = 50 MB max per container is a safe, standard
default that won't affect normal debugging while preventing disk-fill outages.

## Context
- `ansible/roles/docker/tasks/main.yml` — installs Docker CE, starts the
  service, adds the deploy user to the docker group. Has no daemon config task.
  Add the daemon.json task **before** the `Start and enable Docker` task so
  the config is in place when Docker first starts. If Docker is already running
  (re-provision), the task restarts it via a handler.
- Docker reads `/etc/docker/daemon.json` at startup. A handler pattern
  (`notify: restart docker`) applies the change without forcing an immediate
  restart on the same play run — Ansible flushes handlers at the end.
- The `copy` module with `content:` is the cleanest way to write a small JSON
  blob. No template needed.

## Tasks

1. In `ansible/roles/docker/tasks/main.yml`, add a task **before** the
   `Start and enable Docker` task:
   ```yaml
   - name: Configure Docker log rotation
     copy:
       content: |
         {
           "log-driver": "json-file",
           "log-opts": {
             "max-size": "10m",
             "max-file": "5"
           }
         }
       dest: /etc/docker/daemon.json
       mode: "0644"
     notify: restart docker
   ```

2. Create `ansible/roles/docker/handlers/main.yml` (the file may not exist yet —
   check first):
   ```yaml
   ---
   - name: restart docker
     service:
       name: docker
       state: restarted
   ```

3. Verify no existing `handlers/` directory or `main.yml` exists in the docker
   role before creating it — if it does exist, append to it rather than
   overwriting.

## Files involved

- `ansible/roles/docker/tasks/main.yml` — add daemon.json copy task
- `ansible/roles/docker/handlers/main.yml` — new file (or append if exists)

## Acceptance criteria

- [x] `/etc/docker/daemon.json` task is present in the docker role
- [x] A `restart docker` handler is defined for the docker role
- [x] The task notifies the handler so Docker restarts only when the config changes
- [x] No syntax errors in the YAML (validate by reading the file after editing)

## Out of scope

- Per-project log limits (global daemon setting is sufficient)
- Logrotate for the Docker log directory (daemon config handles this natively)
- Changing the log driver from `json-file` to anything else

## Completed

**Date:** 2026-06-06

### Summary
Added Docker log rotation to the Ansible docker role by writing a `/etc/docker/daemon.json` config that caps container logs at 10 MB × 5 files (50 MB max per container). The new `copy` task is placed before "Start and enable Docker" so the config is in place on first boot. A `restart docker` handler was added so re-provisions pick up config changes without forcing an immediate restart.

### Files changed
- `ansible/roles/docker/tasks/main.yml` — added "Configure Docker log rotation" task before "Start and enable Docker"
- (new) `ansible/roles/docker/handlers/main.yml` — defines `restart docker` handler

### Verification
- YAML validated by reading both files — no syntax errors
- Task placement confirmed: log rotation task at line 23, before "Start and enable Docker" at line 37
- Handler correctly referenced via `notify: restart docker`

### Follow-ups
- none
