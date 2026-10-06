# Shrink SSH exposure: sshd hardening, rate-limits, fail2ban jails, allowlist-ready firewall
**Difficulty:** 4

## Goal
SSH on every fleet server is hardened and rate-limited. The Hetzner firewall
module supports an SSH source allowlist (default still open), so moving to
an allowlist or Tailscale later is a one-variable change. All of this ships
without ever locking the user out.

## Reason
Port 22 is open to `0.0.0.0/0` and `::/0` in both the Hetzner firewall
(`terraform/modules/hetzner-server/main.tf`) and UFW, on servers where all
tooling logs in as **root**. Key-only auth (already set) stops password
guessing, but every server still takes the full internet's scan traffic. A
future OpenSSH pre-auth bug (regreSSHion-class) would be exploitable fleet
wide. This sprint reduces attack surface now and sets up the bigger move.

## Context
- **Why not allowlist-only now (decision):**
  - The user's Mac has a residential, dynamic IP (98.177.191.238 on
    2026-10-06).
  - `.github/workflows/deploy.yml` SSHes from GitHub runners, which have no
    fixed IPs.
  - An IP allowlist would break deploys and risk lockout.
  - Tailscale is installed on the Mac (`/usr/local/bin/tailscale`), so
    tailnet-only SSH is the right *next* step. It touches every SSH path
    (`packages/core/src/ssh.ts` uses `root@<serverIp>`, plus Ansible
    inventories and CI), so it's its own initiative. Backlog it with these
    notes.
- **sshd** (via `/etc/ssh/sshd_config.d/10-emit-hardening.conf`, not
  `lineinfile` edits on the main file):
  - `MaxAuthTries 3`
  - `LoginGraceTime 20`
  - `KbdInteractiveAuthentication no`
  - `PermitEmptyPasswords no`
  - `AllowAgentForwarding no`
  - `AllowTcpForwarding no`. Check first that nothing tunnels: grep for
    `ssh -L`, `-N` and DB tunnels in `packages/core`, `apps/cli` and the
    fleet repos (`db-url.ts` may tunnel to Postgres). If something does,
    keep forwarding on and note it.
  - `AllowUsers root deploy` (match whatever `deploy-user` role creates).
  - Validate with `sshd -t` before reloading; the template module's
    `validate: 'sshd -t -f %s'` is the place for it.
  - **Keep `PermitRootLogin prohibit-password`.** Switching all tooling to
    the deploy user is out of scope.
- **UFW:** replace `allow 22` with `ufw limit 22/tcp` (6 connections per 30s
  per IP). Check that the deploy pipeline's SSH bursts don't trip it:
  - Ansible pipelining and ControlMaster reuse connections;
  - `deploy.ts` and `status-monitor` (every 5 minutes, 7 servers) open
    individual connections.
  If they do trip it, add the Mac's tailnet and current IP exceptions, or
  drop to `allow` plus fail2ban only, and record why.
- **fail2ban:** it's installed with defaults. Add `jail.d/emit.local`:
  - `sshd` with `mode = aggressive`, `maxretry 5`, `bantime 1h`;
  - `recidive` (bantime 1w);
  - `ignoreip` for 127.0.0.1/8 and the tailnet range 100.64.0.0/10.
- **Terraform:**
  - Add `variable "ssh_source_ips"` (list(string), default
    `["0.0.0.0/0", "::/0"]`) to `hetzner-server` and use it for the port 22
    rule. With the default, the plan should be a no-op.
  - Consumers pick it up with `?ref=main` plus `terraform init -upgrade`
    (see sprint 363). A no-op plan in one repo is enough verification.
- **Rollout:**
  - Add these tasks to the `hardening.yml` playbook from sprint 365, so
    `emit-infra configure --only hardening` applies them.
  - **Lockout safety, per server:** before applying, open a second SSH
    session and keep it open. After applying, confirm a *new* session still
    works (`ssh root@<ip> true`), then run `emit-infra status` for that
    project.
  - If a new session fails, revert from the open session.
  - Go one server at a time, starting with tastease.

## Tasks
1. Add the hardening tasks (sshd drop-in, UFW limit, fail2ban jails) to the
   hardening role/playbook. Keep `common` applying them on fresh provisions.
2. Add the `ssh_source_ips` variable to the Terraform module.
3. Check whether anything uses SSH forwarding, and set
   `AllowTcpForwarding` accordingly.
4. Roll out one server at a time with the lockout-safety procedure. After
   each, run one real deploy or `emit-infra status`, and one Mac monitor
   poll.
5. Add a backlog entry: "SSH over Tailscale only", with the decision notes
   above.
6. Update `ansible/README.md` and `docs/MONITORING.md` (fail2ban ban
   checks: `fail2ban-client status sshd`).

## Files involved
- `ansible/roles/common/` (or the `hardening` role from 365):
  `templates/10-emit-hardening.conf.j2`, `templates/jail-emit.local.j2`,
  tasks
- `ansible/playbooks/hardening.yml`
- `terraform/modules/hetzner-server/main.tf`, `variables.tf`
- `backlog.md`, `ansible/README.md`, `docs/MONITORING.md`

## Acceptance criteria
- [ ] `ansible-playbook --syntax-check` passes for `provision.yml` and
      `hardening.yml`. The sshd template has `validate: sshd -t -f %s`.
- [ ] `terraform validate` passes. A plan in one consumer repo shows no
      changes with the default `ssh_source_ips`.
- [ ] On every server:
  - `sshd -T | grep -E 'maxauthtries|allowusers|logingracetime'` shows the
    new values;
  - `ufw status` shows `LIMIT` on 22;
  - `fail2ban-client status` lists `sshd` and `recidive`.
- [ ] After rollout, a deploy (or `emit-infra status`) succeeded for each
      project and the Mac monitor shows all servers up. No lockouts.
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass. There are no TS
      changes, but the suite guards the repo.

## Out of scope
- Moving tooling off root.
- Tailscale-only SSH (backlogged).
- Changing the SSH port.
