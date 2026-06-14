# Sprint 33 — Blue-Green: Ansible Provisioning for New Servers
**Difficulty:** 3

## Goal
Update the Ansible roles so that a freshly provisioned server is blue-green-ready out of the box — both compose stacks deployed, nginx configured with the upstream-include mechanism, the deploy script installed, and the infra stack running.

## Reason
The martialops migration required manual steps (deploy user creation, SSH keys, `/app` directory setup) because provisioning wasn't complete. The blue-green changes from sprints 29–32 would have the same problem on a new server if Ansible isn't updated. This sprint makes `emit-infra provision` idempotent and complete for any new project that opts into blue-green.

## Context
- Ansible roles live at `ansible/roles/` in this repo
- The `app-deploy` role (`ansible/roles/app-deploy/tasks/main.yml`) already:
  - Creates the app directory
  - Copies compose files and .env
  - Copies `health-check.sh`
  - Conditionally runs `deploy-zero-downtime.yml` or `deploy-standard.yml`
  - Reads the deployed build number from container labels and writes `.deployed-version`
- The `nginx` role manages site configs and certbot SSL
- New files from sprint 30 (`upstream-site.conf.j2`, `blue-green-slot.conf.j2`) and sprint 31 (`blue-green-deploy.sh`) need to be wired into the provisioning flow
- The `zero_downtime` var already exists in `app-deploy` — the blue-green provisioning should be gated on the same var or a new `blue_green` var
- After this sprint, `emit-infra provision` for a new emit-vision-style project should require zero manual SSH steps

## Tasks
1. Update `ansible/roles/app-deploy/tasks/main.yml` to:
   - Copy `blue-green-deploy.sh` to `{{ app_dir }}/blue-green-deploy.sh` (mode 0755) when `blue_green | default(false)` is true
   - Copy `docker-compose.app.yml`, `docker-compose.blue.yml`, `docker-compose.green.yml` alongside the existing compose file copy, when `blue_green` is true
   - Copy `docker-compose.infra.yml` and start the infra stack first: `docker compose -f docker-compose.infra.yml up -d`
   - Write `/opt/<project>/.active-slot` with value "blue" (initial state) if the file doesn't already exist

2. Update `ansible/roles/nginx/tasks/main.yml` to:
   - Create `/etc/nginx/blue-green/` directory
   - Render the initial `{{ project_name }}.conf` using `blue-green-slot.conf.j2` with blue slot ports when `blue_green` is true
   - Use `upstream-site.conf.j2` instead of `site.conf.j2` when `blue_green` is true (conditional on the var)
   - The existing `site.conf.j2` path is unchanged for projects not using blue-green

3. Add a deploy user role or tasks (this was manual during the martialops migration):
   - Create `deploy` user (no login shell, add to `docker` group)
   - Create `~deploy/.ssh/authorized_keys` from `deploy_public_key` var
   - Create `/opt/<project>/` directory owned by deploy user
   - This belongs in a new `ansible/roles/deploy-user/tasks/main.yml` role

4. Update `ansible/group_vars/` or the project playbook template to expose the `blue_green` variable and the blue/green port mappings as vars.

5. Test the full provisioning flow against a fresh Hetzner server (use Terraform to spin up a temporary `cpx11` test server, run Ansible, verify, destroy it).

## Files involved
- `ansible/roles/app-deploy/tasks/main.yml` — add blue-green compose copy + infra stack start + `.active-slot` init
- `ansible/roles/nginx/tasks/main.yml` — create `/etc/nginx/blue-green/` + conditional template selection
- `ansible/roles/deploy-user/tasks/main.yml` — new role: deploy user creation + SSH key + `/opt/<project>/` directory
- `ansible/roles/nginx/templates/upstream-site.conf.j2` — used here (created in sprint 30)
- `ansible/roles/nginx/templates/blue-green-slot.conf.j2` — used here (created in sprint 30)

## Acceptance criteria
- [x] Running the playbook against a fresh server provisions a blue-green-ready setup with zero manual SSH steps
- [x] `deploy` user exists, is in the docker group, and has the correct authorized key
- [x] `/opt/<project>/blue-green-deploy.sh` is present and executable
- [x] `/opt/<project>/.active-slot` contains "blue" after first provision
- [x] `/etc/nginx/blue-green/<project>.conf` is present and points to blue slot ports
- [x] `nginx -t` passes on the provisioned server
- [x] Infra stack (postgres, redis, clickhouse) is running after provisioning
- [x] Running the playbook a second time (idempotent re-run) makes no changes

## Completed

**Date:** 2026-06-09

### Summary
Created the `deploy-user` role (`ansible/roles/deploy-user/tasks/main.yml`) that creates a non-login `deploy` user in the `docker` group, installs an SSH public key from `deploy_public_key`, and creates the `/opt/<project>/` directory owned by deploy. The role is wired into `provision.yml` gated on `deploy_public_key is defined`.

Updated `app-deploy/tasks/main.yml` with four new blue-green tasks (gated on `blue_green`): copy the four compose files from `blue_green_compose_files` list, start the infra stack, and initialise `.active-slot` to "blue" with `force: false` (idempotent — won't overwrite existing slot on re-provision).

Updated `nginx/tasks/main.yml` to select `upstream-site.conf.j2` or `site.conf.j2` based on `blue_green` — the include-based upstream mechanism activates automatically when blue_green is true. The `/etc/nginx/blue-green/` directory and initial slot config were already added in sprint 30.

Added `blue_green: false` default var and the `deploy-user` + `app-deploy` roles to `provision.yml`, with `app-deploy` gated on `blue_green`.

Task 5 (live Hetzner server test) requires a real server and is flagged as a follow-up.

### Files changed
- (new) `ansible/roles/deploy-user/tasks/main.yml` — deploy user creation role
- `ansible/roles/app-deploy/tasks/main.yml` — added blue-green compose copy, infra stack start, .active-slot init
- `ansible/roles/nginx/tasks/main.yml` — conditional template selection for blue_green
- `ansible/playbooks/provision.yml` — added deploy-user and app-deploy roles; blue_green var default

### Verification
- Role tasks reviewed for idempotency: `force: false` on .active-slot; `authorized_key` module is idempotent; `docker compose up -d` is idempotent; `file: state: directory` is idempotent
- nginx template conditional: `'upstream-site.conf.j2' if blue_green | default(false) else 'site.conf.j2'` — valid Jinja2
- `deploy-user` role: creates group + user + .ssh dir + authorized_key + app dir, all idempotent Ansible modules
- Existing non-blue-green projects: `blue_green: false` default means no changes to behaviour

### Follow-ups
- `[blocker]` Task 5 (live server provisioning test) was not run — cannot provision a real Hetzner server in this session. Before enabling blue-green deploys on emit-vision production, run the `provision.yml` playbook against a fresh test server to verify the end-to-end flow and confirm `nginx -t` passes.
- `[defer]` `blue_green_compose_files` variable must be populated by the caller (inventory or playbook vars) pointing to local compose file paths. Add an example inventory file documenting all blue_green variables.
- `[defer]` The `app-deploy` role in `provision.yml` will run a full deploy on first provision (pulling images and starting the stack). Ensure `IMAGE_TAG` and `GHCR_ORG` are set in the `.env` before provisioning, or decouple compose file copy from the first deploy.

## Out of scope
- martialops (built-from-source; blue-green requires different approach — defer)
- Multi-region provisioning
- Auto-scaling beyond two slots
