# Unattended security upgrades on every server, with reboot-required alerts
**Difficulty:** 3

## Goal
Every fleet server installs Ubuntu security updates automatically. Reboots
are **not** automatic. When a server needs a reboot (kernel or libc update),
the status monitor reports it and alerts through `notify()`, so the user
reboots at a moment of their choosing.

## Reason
None of the 7 internet-facing servers patch themselves. Ansible's `common`
role installs base packages once and never again. Unpatched OpenSSH, nginx
and OpenSSL are the most common way small fleets get owned. Automatic
reboots are deliberately left off: each project is a single server, so a
surprise 3 AM reboot is a surprise outage. Docker containers come back via
`restart:` policies, but the blue-green slot state and nginx upstream need
checking afterwards.

## Context
- **Role:** `ansible/roles/common/tasks/main.yml` handles apt base packages,
  swap, SSH hardening, UFW and fail2ban. Add an `import_tasks:
  unattended-upgrades.yml` there so new servers get it on provision.
- **Prod rollout without full provision:**
  - Sprint 360 added `emit-infra configure --only <playbook>` with a
    playbook allowlist, plus the `runAnsible` playbook union in
    `packages/core/src/ansible.ts`.
  - Add a `hardening.yml` playbook that runs **only** the hardening task
    files (unattended-upgrades here; sprint 366 adds SSH).
  - Use `include_role` with `tasks_from`, or factor the hardening tasks into
    a `hardening` role that `common` depends on. Pick whichever keeps
    `provision.yml` behaviour identical, and say which.
  - Don't run full provision against prod: servers have drifted
    (`docs/nginx-vhost-audit.md`).
- **unattended-upgrades config:**
  - packages `unattended-upgrades` and `apt-listchanges`;
  - `/etc/apt/apt.conf.d/20auto-upgrades` with periodic update and
    unattended-upgrade both `1`;
  - `50unattended-upgrades` with origins limited to
    `${distro_id}:${distro_codename}-security` (and ESM if present);
  - `Automatic-Reboot "false"`;
  - `Remove-Unused-Kernel-Packages "true"`.
- **Docker:** don't auto-upgrade `docker-ce` or `containerd` from Docker's
  repo. An upgrade there restarts the daemon, which stops every container.
  The security-only origin already excludes them; assert this in the
  config.
- **Reboot-required signal:**
  - Ubuntu writes `/var/run/reboot-required` and
    `/var/run/reboot-required.pkgs`.
  - The status probe (built in `apps/api/src/lib/status-command.ts` and
    parsed in `status-monitor.ts`) gains a section that reports both.
  - Add a built-in metric `rebootRequired` (1 when present) to the default
    rules in `apps/api/src/lib/alert-rules.ts` (`DEFAULT_RULES` after sprint
    357), with a 72h cooldown. Include the package list in the alert
    detail.
  - Show a "reboot required" badge on the dashboard's project status if
    the existing status UI has an obvious slot. Skip it if not, and say so.
- **First run may install a backlog of updates** on servers that have never
  been patched. Do it one server at a time, lowest stakes first (tastease),
  and check each app's health URL after each.

## Tasks
1. Add the `unattended-upgrades.yml` tasks (or the `hardening` role) and the
   `hardening.yml` playbook. Allowlist it in `configure --only`.
2. Add the `rebootRequired` probe section, metric, default rule and alert
   detail.
3. Roll out with `emit-infra configure --only hardening` on each server, one
   at a time:
   - check health after each;
   - run `unattended-upgrade --dry-run -d | tail` to confirm the config
     parses.
4. Report which servers need a reboot now. **Don't reboot without the
   user's go-ahead.** List them with the pending packages.
5. Document the policy (security-only, no auto-reboot, reboot via alert) in
   `docs/MONITORING.md` and `ansible/README.md`.

## Files involved
- new: `ansible/roles/common/tasks/unattended-upgrades.yml` (or a
  `hardening` role) + templates
- new: `ansible/playbooks/hardening.yml`
- `apps/cli/src/commands/configure.ts` (+ test): allowlist entry
- `packages/core/src/ansible.ts` (+ test): playbook union
- `apps/api/src/lib/status-command.ts`, `status-monitor.ts`, `alert-rules.ts`
  (+ tests)
- `docs/MONITORING.md`, `ansible/README.md`

## Acceptance criteria
- [ ] `alert-rules.test.ts` covers that `rebootRequired` fires with the
      package detail and respects its cooldown.
- [ ] A status-probe parsing test covers both flag present and flag absent.
- [ ] `configure.test.ts` covers that `--only hardening` is accepted.
- [ ] `ansible-playbook --syntax-check` passes for `provision.yml` and
      `hardening.yml`.
- [ ] On every server, `systemctl is-enabled unattended-upgrades` returns
      `enabled` and the dry run shows security origins only (output
      recorded in the sprint's commit or a docs note).
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.

## Out of scope
- SSH exposure (sprint 366).
- Automated reboot orchestration.
- Docker engine upgrade policy.

### Approved by the user (2026-10-06, "approve all")
The production actions this sprint describes are approved. Proceed without asking again, with these exceptions where you must still stop for the user:
- confirming a real email arrived;
- any step that needs the user's password manager;
- any server **reboot**.

Guardrails:
- deploy sibling repos only through `~/projects/emit-infra/scripts/deploy-detached.sh --dir <repo>`;
- skip a repo whose tree is dirty or that has an active sprint loop (record it as deferred);
- before deploying a sibling repo, run `git log origin/main..HEAD --oneline`. If it carries **other people's unpushed commits that include DB migrations**, skip it and report. Otherwise proceed, and list the extra commits in Completed;
- Terraform: apply only plans that are in-place updates;
- SSH changes: one server at a time, with a second session held open.

### Orchestrator note (from sprint 360, 2026-10-06)
emit-vision's apt sources are broken (a `docker.asc` `Signed-By` conflict between two Docker repo entries), and `apt install` fails there. unattended-upgrades can't work on that server until it's fixed. As the first step on emit-vision, dedupe the Docker apt source entries so `apt-get update` is clean, and make the Ansible docker role idempotent about it so the conflict doesn't come back. This is covered by the approval above.
