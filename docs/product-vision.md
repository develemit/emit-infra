# Product Vision: Internal Developer Platform

## Working Name

Emit Infra

## One-Sentence Vision

A shared infrastructure platform that provisions, configures, and deploys any project in the emit stack — Hetzner compute, Cloudflare DNS and R2, Postgres, Redis — through reusable Terraform modules, Ansible roles, GitHub Actions workflows, and a TypeScript CLI.

## Product Thesis

Every project in the emit ecosystem shares the same stack: a Hetzner VPS, Cloudflare for DNS and object storage, Postgres with Drizzle ORM, Upstash Redis, a Fastify API, and a Next.js frontend. The operational knowledge required to stand up that stack — provisioning the server, configuring nginx and SSL, wiring Docker Compose, syncing secrets to GitHub, setting up DNS — is identical across projects.

Without a shared platform, that knowledge is copy-pasted, diverges, and rots. A security patch to nginx config has to be applied to every project manually. A better deploy script has to be ported by hand. A new project means re-deriving the same setup from scratch.

Emit Infra centralizes that knowledge. Improvements propagate to every project that references the platform. A new project goes from zero to deployed in a single command sequence rather than a weekend of setup.

## Strategic Wedge

Start with the two highest-pain operations: **provisioning a new server** and **deploying an update**.

The first version does not need a dashboard, cost analysis, or multi-cloud support. The wedge is: a developer can run `emit-infra provision <project>` and get a Hetzner server with DNS, firewall, Docker, nginx, and SSL — then run `emit-infra deploy <project>` and get the latest build running.

Everything else — health monitoring, cost analysis, a web dashboard — is additive after the core mechanics work.

## Target Users

### Primary: Solo Developer (You)

One developer maintaining multiple projects on the same stack. The platform should eliminate the cognitive overhead of remembering how each project is deployed and make cross-project maintenance feel like maintaining one system.

### Secondary: Small Teams on the Emit Stack

As projects grow and collaborators join, the platform should make it easy to hand off operational knowledge without a long onboarding document.

## Core Principles

1. **Convention over configuration**
   Every project that follows the emit stack convention should work with zero custom configuration. Escape hatches exist for projects that diverge.

2. **Reusable modules, not scripts**
   Terraform modules and Ansible roles are versioned, composable, and independently testable. Shell scripts that grow past 50 lines get replaced by a module.

3. **Transparent operations**
   The CLI shows what it is doing and why. Every Terraform plan, every Ansible task, every Docker operation is visible. No magic black boxes.

4. **Idempotent by default**
   Running `provision` or `deploy` twice has the same outcome as running it once. Drift is corrected, not ignored.

5. **Additive growth**
   A dashboard, cost analysis, and health monitoring are planned but deferred. The core must be useful before the UI is built.

## Architecture

### Repository Layout

```
emit-infra/
├── apps/
│   └── cli/                    # TypeScript CLI — the primary interface
├── packages/
│   └── core/                   # Shared types, config schema, runner utilities
├── terraform/
│   └── modules/
│       ├── hetzner-server/     # VPS provisioning
│       ├── cloudflare-dns/     # DNS records and zone config
│       ├── r2-bucket/          # Cloudflare R2 object storage
│       └── upstash-redis/      # Upstash Redis instance
├── ansible/
│   ├── roles/
│   │   ├── common/             # Base packages, swap, ufw, fail2ban
│   │   ├── docker/             # Docker Engine + Compose plugin
│   │   ├── nginx/              # nginx + Certbot SSL
│   │   └── app-deploy/         # Docker Compose app lifecycle
│   └── playbooks/
│       ├── provision.yml       # Full server setup (all roles)
│       └── deploy.yml          # App-only deploy (app-deploy role)
└── .github/
    └── workflows/
        ├── ci.yml              # Reusable CI: lint, typecheck, test, build
        └── deploy.yml          # Reusable deploy: SSH → pull → restart
```

### Terraform Modules

Each module is a self-contained unit with `main.tf`, `variables.tf`, and `outputs.tf`. Projects call modules by GitHub source reference so they always use the latest versioned release:

```hcl
module "server" {
  source = "github.com/develemit/emit-infra//terraform/modules/hetzner-server?ref=v1.0.0"
  name   = "my-project"
  type   = "cx22"
  region = "nbg1"
}
```

**hetzner-server** — Creates a VPS, attaches a firewall (SSH, HTTP, HTTPS), optionally attaches a floating IP.

**cloudflare-dns** — Creates A records pointing the project domain and `www` subdomain to the server IP.

**r2-bucket** — Creates an R2 bucket with optional CORS config.

**upstash-redis** — Creates an Upstash Redis database via the Upstash Terraform provider.

### Ansible Roles

Roles are run against servers provisioned by Terraform. The inventory is generated from Terraform outputs.

**common** — Installs base packages (curl, git, unzip, htop), configures swap, hardens SSH (disable root login, disable password auth), sets up UFW (allow SSH/HTTP/HTTPS), installs fail2ban.

**docker** — Installs Docker Engine and the Compose plugin. Adds the deploy user to the docker group.

**nginx** — Installs nginx, writes a reverse-proxy config template for the project's domain, and obtains an SSL certificate via Certbot with Let's Encrypt.

**app-deploy** — Copies the Docker Compose file to the server, pulls the latest images, and restarts the app stack. Used standalone for deploys without re-running the full provision.

### CLI (apps/cli)

The CLI wraps Terraform and Ansible into project-aware commands. It reads a per-project config file (`.emit-infra.json` in the project root or passed via `--config`) that declares project name, domain, server region, and resource sizes.

**Commands:**

| Command | What it does |
|---|---|
| `emit-infra init <name>` | Scaffold a project config and Terraform root from templates |
| `emit-infra provision <name>` | Run Terraform apply for all infrastructure modules |
| `emit-infra configure <name>` | Run full Ansible provision playbook against the server |
| `emit-infra deploy <name>` | Run Ansible deploy playbook (app restart only) |
| `emit-infra status <name>` | SSH health check: uptime, disk, memory, container status |
| `emit-infra secrets sync <name>` | Push local .env to GitHub repo secrets via gh CLI |
| `emit-infra destroy <name>` | Destroy all Terraform-managed infrastructure (with prompt) |

### Reusable GitHub Actions Workflows

Stored in `.github/workflows/` and called cross-repo via `workflow_call`.

**ci.yml** — Runs on pull requests and pushes to main. Steps: checkout with full history, pnpm install, Nx build (affected), lint, typecheck, test. Accepts `node-version` and `pnpm-version` as inputs so callers can pin their runtime.

**deploy.yml** — Runs on push to main (or manual trigger). Connects to the Hetzner server via SSH, pulls the latest Docker images, and restarts the app stack via Docker Compose. Requires `SSH_PRIVATE_KEY`, `SERVER_IP`, and `APP_DIR` as secrets/inputs.

Projects reference them like:

```yaml
jobs:
  ci:
    uses: develemit/emit-infra/.github/workflows/ci.yml@main
    with:
      node-version: "24"
      pnpm-version: "10.30.2"
```

### core Package (packages/core)

Shared utilities used by the CLI:

- `ProjectConfig` type and Zod schema
- Config file loader (finds `.emit-infra.json` by walking up from cwd)
- `runTerraform(cmd, args, cwd)` — Execa wrapper with streaming output
- `runAnsible(playbook, inventory, cwd)` — Execa wrapper with streaming output
- `sshExec(host, command, keyPath)` — SSH command runner for status checks

## Project Config Schema

Each project that uses emit-infra creates an `.emit-infra.json` in its root:

```json
{
  "name": "my-project",
  "domain": "myproject.com",
  "region": "nbg1",
  "serverType": "cx22",
  "sshKeyName": "emit-deploy",
  "github": {
    "repo": "develemit/my-project"
  },
  "r2": {
    "buckets": ["uploads", "backups"]
  }
}
```

## MVP Outcome

A developer can:

1. Add `.emit-infra.json` to an existing project.
2. Run `emit-infra provision <name>` to get a live Hetzner server with DNS, firewall, Docker, nginx, and SSL.
3. Run `emit-infra configure <name>` to apply all Ansible roles to the server.
4. Run `emit-infra deploy <name>` after a code change to pull and restart the app.
5. Run `emit-infra status <name>` to see the server's health at a glance.
6. Call the reusable CI and deploy workflows from any project's `ci.yml` with three lines.

## Sprint Strategy

Each sprint delivers a vertical slice. No sprint should end with only scaffolding — there must be a working command or workflow at the end.

---

## Sprint 0: Repository Foundation

### Goal

Create the Nx monorepo, shared tooling, and project conventions.

### Deliverables

- pnpm workspace + Nx config
- TypeScript, ESLint, Prettier
- `packages/core` shell with config schema
- `apps/cli` shell with Commander.js entry point
- CI for lint, typecheck, test, build
- README with local setup

### Acceptance Criteria

- `pnpm install` works
- `pnpm build` builds core and cli
- `pnpm lint` and `pnpm typecheck` pass
- `emit-infra --help` prints available commands

---

## Sprint 1: Terraform Modules

### Goal

Working, tested Terraform modules for the full standard infrastructure set.

### Deliverables

- `hetzner-server` module
- `cloudflare-dns` module
- `r2-bucket` module
- `upstash-redis` module
- Module documentation in each module's README

### Acceptance Criteria

- Each module has `main.tf`, `variables.tf`, `outputs.tf`
- Module variables are documented with descriptions and defaults
- A `terraform validate` passes for each module
- README explains all required inputs and outputs

---

## Sprint 2: Ansible Roles

### Goal

Idempotent Ansible roles that fully configure a fresh Hetzner server.

### Deliverables

- `common` role
- `docker` role
- `nginx` role with SSL
- `app-deploy` role
- `provision.yml` and `deploy.yml` playbooks

### Acceptance Criteria

- Running `provision.yml` against a fresh server produces a working nginx + Docker setup with SSL
- Running `provision.yml` twice is idempotent
- Running `deploy.yml` alone pulls and restarts the app without affecting nginx or Docker config

---

## Sprint 3: CLI Commands

### Goal

A working CLI that wires Terraform and Ansible into project-aware commands.

### Deliverables

- `emit-infra init`
- `emit-infra provision`
- `emit-infra configure`
- `emit-infra deploy`
- `emit-infra status`
- `emit-infra secrets sync`

### Acceptance Criteria

- `emit-infra --help` documents all commands
- `emit-infra init` produces a valid `.emit-infra.json` and Terraform root
- `emit-infra provision` runs `terraform apply` with output streaming to terminal
- `emit-infra status` returns server health summary
- Config validation errors print clearly before any infra command runs

---

## Sprint 4: Reusable GitHub Actions Workflows

### Goal

Reusable workflows that any emit project can call with minimal config.

### Deliverables

- `ci.yml` reusable workflow
- `deploy.yml` reusable workflow
- Migration of `emit-vision` CI to call the reusable `ci.yml`

### Acceptance Criteria

- `emit-vision` CI passes using the imported workflow
- `deploy.yml` workflow deploys successfully on push to main
- Workflow inputs and secrets are documented in comments

---

## Future Bets

### Health Dashboard

A Next.js app (future `apps/dashboard`) that shows server health, container status, uptime, and resource usage across all managed projects. Reads from SSH or a lightweight agent on each server.

### Cost Analysis

Query the Hetzner, Cloudflare, and Upstash APIs to produce a per-project and aggregate cost breakdown. Surface the output as a CLI command and later in the dashboard.

### Log Tailing

`emit-infra logs <project>` streams Docker Compose logs from the server over SSH.

### Certificate Monitoring

Alert when SSL certificates are within 30 days of expiry.

### Multi-Region Support

Allow projects to declare secondary regions for failover or geographic distribution.

## Decision Log

Use `docs/decisions/` for architecture decisions. Initial decisions to document:

- Why Terraform modules over Pulumi
- Why Ansible over cloud-init or Dockerfile-per-server
- Why Commander.js for the CLI
- Why public repo for reusable workflow access
- Why per-project `.emit-infra.json` rather than a central registry

## Guiding Constraint

The platform should reduce the cost of operating N projects to approximately the cost of operating one. Every feature is evaluated against that measure.
