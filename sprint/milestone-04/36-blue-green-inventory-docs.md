# Sprint 36 — Blue-Green: Ansible Inventory Example + Variable Documentation

> _Promoted from sprint-33 follow-up [defer], 2026-06-09._

**Difficulty:** 1

## Goal
Create an example Ansible inventory file for a blue-green project and document all `blue_green`-related variables so operators can onboard a new project to blue-green deploys without reading through five sprints of code.

## Reason
The blue-green Ansible provisioning (sprint 33) introduced `blue_green`, `blue_green_compose_files`, `deploy_public_key`, and related port vars — but none of these are documented anywhere visible. A new project operator provisioning a server has no reference for what to set. This sprint creates that reference.

## Context
- Blue-green variables are spread across: `provision.yml` defaults, `nginx/tasks/main.yml` defaults, and `app-deploy/tasks/main.yml` task conditions
- Variables introduced in sprints 29-33:
  - `blue_green` (bool, default false) — enables blue-green mode throughout provisioning
  - `blue_green_compose_files` (list of local paths) — compose files to copy to server
  - `deploy_public_key` (string) — SSH public key for the `deploy` user
  - `blue_web_port` / `blue_api_port` / `blue_worker_port` / `blue_marketing_port` (default 4300-4303)
  - `green_web_port` / `green_api_port` etc. (defaults 4400-4403, used in deploy script but not in Ansible — document the convention)
  - `project_name` (string) — used as Docker project prefix and path component
  - `nginx_ssl` (bool) — enables HTTPS blocks (sprint 34)
- Inventory lives in `ansible/` — currently only the `playbooks/` and `roles/` subdirs exist; no inventory or host_vars

## Tasks
1. Create `ansible/inventory/emit-vision.example.yml` — a fully commented YAML inventory example showing:
   - Host definition with `ansible_host`, `ansible_user`
   - All blue-green vars with comments explaining each one
   - Blue slot port defaults (and green slot comment noting they live in the deploy script)
   - certbot/domain vars required by the nginx role
   - Example `blue_green_compose_files` list pointing to the actual emit-vision paths

2. Create `ansible/README.md` (or update if it exists) with:
   - One-paragraph overview of the role/playbook structure
   - Table: variable name → description → default → required
   - "First provision" command example:
     ```bash
     ansible-playbook -i ansible/inventory/emit-vision.yml ansible/playbooks/provision.yml
     ```
   - "Re-deploy" command (using deploy.yml playbook)
   - Link to sprint-34's live server checklist for the pre-production verification steps

3. Verify all blue-green variables named in the example inventory actually match what the roles expect (grep the roles to confirm variable names are consistent).

## Files involved
- `ansible/inventory/emit-vision.example.yml` — new: fully commented example inventory
- `ansible/README.md` — new or updated: variable reference table + command examples

## Acceptance criteria
- [x] `emit-vision.example.yml` exists with all blue-green variables defined and commented
- [x] `ansible/README.md` has a variable reference table covering all provisioning vars
- [x] Every variable in the example inventory can be verified against the role source code (grep passes)
- [x] "First provision" and "re-deploy" commands are correct and documented

## Out of scope
- A real `emit-vision.yml` inventory file with secrets (that belongs in a private secrets manager)
- Ansible Vault setup

## Completed

**Date:** 2026-06-10

### Summary
Created a fully commented Ansible inventory example (`emit-vision.example.yml`) and a comprehensive `ansible/README.md` documenting all blue-green provisioning variables. The example inventory covers connection, domain/TLS, blue-green deployment, health check, environment, postgres backup, and optional zero-downtime variables — all verified against the actual role source code. The README includes a quick start guide, a 20+ row variable reference table, pre-production verification checklist, and common troubleshooting tips.

### Files changed
- (new) `ansible/inventory/emit-vision.example.yml` — fully commented inventory example with all blue-green variables
- (new) `ansible/README.md` — variable reference table, quick start commands, verification checklist

### Verification
- All variable names in the example inventory verified via grep against `ansible/roles/` and `ansible/playbooks/` source — all match
- "First provision" command uses correct inventory and playbook paths
- "Re-deploy" command documents both `deploy.yml` and the on-server `blue-green-deploy.sh`

### Follow-ups
- none
