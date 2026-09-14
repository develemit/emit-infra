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
- [ ] A fixture renewal config with `authenticator = standalone` is converted to
      webroot via `certbot reconfigure`, never via forced renewal
- [ ] `webroot`, `nginx` and `dns-cloudflare` configs are left byte-for-byte unchanged
- [ ] certbot older than 2.3 makes the script refuse with manual instructions
- [ ] A failing `certbot renew --dry-run` makes the script, and so the play, fail
- [ ] `ansible-playbook --syntax-check` passes
- [ ] A `--check` run against a live server reports no changes — quote the output
- [ ] Coverage in `scripts/lib/ensure-cert-renewal.test.sh`, registered in and
      passing under `pnpm test:hooks`

## Out of scope
- Converting `nginx`-authenticator servers (develemail, emit-vision) to webroot.
- Running the play against the fleet beyond the single read-only `--check`.
- Monitoring and notifications — sprints 332–334.
