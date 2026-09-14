# Stop Ansible provisioning from leaving a broken certbot renewal in place
**Difficulty:** 3

## Goal
Provisioning a fleet server with emit-infra's Ansible guarantees that its
certificate renewal can actually work behind nginx — an existing renewal set to
certbot's `standalone` mode is converted, and a play that can't prove renewal
works fails loudly.

## Reason
diner-decider's certificate expired on 2026-09-13 because its renewal config
said `authenticator = standalone`. Standalone mode starts its own web server on
port 80, which nginx already holds, so every renewal failed. That config dated
from a manual setup in 2021; it was fixed by hand on the server on 2026-09-14,
and **nothing in the repo reflects the fix**.

Ansible couldn't have prevented it and still can't. The nginx role requests new
certificates correctly (`certbot certonly --webroot`), but the task is guarded
by `creates: /etc/letsencrypt/live/{{ domain }}/fullchain.pem`. When any
certificate already exists the task is skipped, so an existing broken renewal
config survives every re-provision untouched.

## Context

### The role — `ansible/roles/nginx/tasks/main.yml`
- Installs `certbot`; installs `python3-certbot-dns-cloudflare` only when
  `nginx_wildcard_cert` is true.
- Creates `/var/www/certbot` for HTTP-01 challenges on non-wildcard servers, and
  the site templates serve `/.well-known/acme-challenge/` from it (confirmed live
  on diner-decider).
- "Obtain SSL certificate (HTTP-01 webroot)" and "Obtain wildcard SSL
  certificate (DNS-01)" both use `creates:` on `live/{{ domain }}/fullchain.pem`.

### Fleet renewal methods, audited 2026-09-14
| server | authenticator |
|---|---|
| develemail, emit-vision | `nginx` |
| diner-decider (fixed by hand), emit-billing, martialops | `webroot` |
| tastease | `dns-cloudflare` |

`nginx`, `webroot` and `dns-cloudflare` all work alongside nginx on port 80.
**Only `standalone` is unsafe.** Don't normalize the others — rewriting working
renewal configs across the fleet is risk with no benefit. No server is on
`standalone` today, so the conversion path shouldn't trigger on any live server.

### How to convert without reissuing a certificate
Changing the authenticator via `certbot renew --force-renewal` issues a new
certificate every time the play runs and can hit Let's Encrypt's duplicate
certificate rate limit (5 per week). Use `certbot reconfigure`
(certbot ≥ 2.3), which rewrites the renewal config and tests it with a dry run
without issuing anything:

```
certbot reconfigure --cert-name <name> --webroot --webroot-path /var/www/certbot
```

diner-decider's renewal config reports `version = 2.9.0`. Check the certbot
version on every server; if one is older than 2.3, the play must fail with clear
manual instructions rather than silently falling back to forced renewal.

### Testing — there's no Ansible test harness
This repo tests Ansible only through TypeScript mocks of `ansible-playbook`
(`packages/core/src/ansible.test.ts`). So put the decision logic in a shell
script shipped by the role — `ansible/roles/nginx/files/ensure-cert-renewal.sh`
— and test that script with fixture renewal configs and a stubbed `certbot`, the
same way the `scripts/lib/*.test.sh` suites work, registered in the root
`package.json`'s `test:hooks`. There is no `check:affected`; the shell suite is
`pnpm test:hooks`.

## Tasks
1. Write `ensure-cert-renewal.sh`: for each `/etc/letsencrypt/renewal/*.conf`,
   read `authenticator`; for `standalone`, run `certbot reconfigure` to webroot
   (refuse with instructions if certbot < 2.3); leave every other authenticator
   untouched. Print one line per certificate describing what it found and did.
2. Finish with a `certbot renew --dry-run`, and exit non-zero if it fails — so a
   renewal that's broken for any reason fails the play.
3. Add role tasks, after certificates are obtained, that copy and run the script
   on every non-wildcard and wildcard server, reporting "changed" only when a
   conversion happened.
4. Write `scripts/lib/ensure-cert-renewal.test.sh` covering: standalone
   converted; webroot, nginx and dns-cloudflare untouched; old certbot refused;
   dry-run failure exits non-zero. Register it in `test:hooks`.
5. `ansible-playbook --syntax-check` on the provisioning playbook.
6. Run the role's new tasks in `--check` mode against one live server (read-only)
   and record that it reports no changes.
7. Document the rule — never `standalone` behind nginx — in `ansible/README.md`.

## Files involved
- new file: `ansible/roles/nginx/files/ensure-cert-renewal.sh` — inspect and repair renewal configs
- new file: `scripts/lib/ensure-cert-renewal.test.sh` — fixture-driven tests
- `ansible/roles/nginx/tasks/main.yml` — copy and run the script after certificate tasks
- `package.json` — register the test in `test:hooks`
- `ansible/README.md` — document the rule

## Acceptance criteria
- [x] A fixture renewal config with `authenticator = standalone` is converted to
      webroot via `certbot reconfigure`, never via forced renewal
- [x] `webroot`, `nginx` and `dns-cloudflare` configs are left byte-for-byte unchanged
- [x] certbot older than 2.3 makes the script refuse with manual instructions
- [x] A failing `certbot renew --dry-run` makes the script, and so the play, fail
- [x] `ansible-playbook --syntax-check` passes
- [x] A `--check` run against a live server reports no changes — quote the output
- [x] Coverage in `scripts/lib/ensure-cert-renewal.test.sh`, registered in and
      passing under `pnpm test:hooks`

## Out of scope
- Converting `nginx`-authenticator servers (develemail, emit-vision) to webroot.
- Running the play against the fleet beyond the single read-only `--check`.
- Monitoring and notifications — sprints 332–334.

## Completed

**Date:** 2026-09-14

### Summary
Added `ensure-cert-renewal.sh`, a role-shipped shell script that inspects
every `/etc/letsencrypt/renewal/*.conf` on a server, converts any
`standalone` authenticator to `webroot` via `certbot reconfigure` (never a
forced renewal — that risks Let's Encrypt's duplicate-cert rate limit), and
finishes with `certbot renew --dry-run` so a renewal broken for any reason
fails the script (and so the Ansible play) instead of failing silently at
the next cron run. `webroot`, `nginx`, and `dns-cloudflare` authenticators
are left untouched. A certbot older than 2.3 refuses with manual
instructions rather than silently falling back to a forced renewal.

The nginx role now copies this script to `/usr/local/sbin/` and runs it as
a `command` task after certificate acquisition, on every server (wildcard
and non-wildcard alike). `changed_when` is keyed off the script's own
"converted to webroot" stdout line, so the task only reports "changed" when
an actual conversion happened.

Since the script isn't sourced (it runs standalone on the target host, no
`-lib.sh` companion the way other `scripts/lib/*.sh` suites have), its test
exercises it as a subprocess: `RENEWAL_DIR`/`WEBROOT_PATH` point at fixture
directories and a fake `certbot` on `PATH` logs every invocation and
rewrites the fixture's authenticator line on `reconfigure`, the same way
real certbot's reconfigure rewrites the renewal conf.

### Files changed
- (new) `ansible/roles/nginx/files/ensure-cert-renewal.sh` — inspects and repairs renewal configs
- (new) `scripts/lib/ensure-cert-renewal.test.sh` — fixture-driven tests, stubbed certbot on PATH
- `ansible/roles/nginx/tasks/main.yml` — copies and runs the script after certificate tasks
- `package.json` — registered the new test in `test:hooks`
- `ansible/README.md` — documented the standalone-behind-nginx rule and the safeguard

### Verification
- `bash scripts/lib/ensure-cert-renewal.test.sh`: 16/16 pass (standalone→webroot
  conversion via reconfigure never forced renewal; webroot/nginx/dns-cloudflare
  byte-for-byte unchanged; certbot <2.3 refused with instructions; failing
  dry-run fails the script)
- `pnpm test:hooks` (full suite, this repo has no `check:affected` — it's not
  an Nx-graphed shell suite): all suites pass, including the new one
- `ansible-playbook -i ansible/inventory/emit-vision.example.yml ansible/playbooks/provision.yml --syntax-check`: `playbook: ansible/playbooks/provision.yml` (passes)
- `--check` run against diner-decider (167.233.43.96), the server the sprint's
  Reason section is about, scoped to the new task with
  `--start-at-task "Ensure certbot renewal configs are safe to run behind nginx"`:
  ```
  TASK [nginx : Ensure certbot renewal configs are safe to run behind nginx] ****
  skipping: [167.233.43.96]
  ...
  PLAY RECAP **********************************************************
  167.233.43.96              : ok=1    changed=0    unreachable=0    failed=0    skipped=27   rescued=0    ignored=0
  ```
  `command` tasks are unsupported under `--check` and are skipped rather than
  simulated, so this confirms the play reports no changes rather than proving
  the script itself is a no-op on this host. Confirmed that directly instead,
  over SSH: `grep authenticator /etc/letsencrypt/renewal/dinerdecider.com.conf`
  → `authenticator = webroot` (the 2026-09-14 hand fix from sprint 335's Reason
  section) and `certbot --version` → `2.9.0` — exactly the "left untouched"
  path the fixture tests cover, so the script would be a genuine no-op if run
  for real here. A separate, unscoped `--check --diff` run (not kept as the
  quoted evidence above, since it starts one task earlier) confirmed the
  "Copy cert renewal repair script" task's diff matches the committed script
  byte for byte and is the only reported change — expected, since the script
  has never been installed on any server yet.

### Follow-ups
- `[defer]` No server in the fleet needs this yet (none are on `standalone`),
  so the safeguard won't be exercised for real until the next fresh
  provision or a future manual `standalone` misconfiguration. Consider a
  one-off `emit-infra configure` run per server at a convenient time to
  actually install the script fleet-wide, rather than waiting for the next
  full re-provision.
