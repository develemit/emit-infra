# emit-infra

Shared infrastructure platform for the emit project stack. Provides reusable Terraform modules, Ansible roles, GitHub Actions workflows, and a CLI for provisioning and deploying projects that use Hetzner, Cloudflare, Postgres, and Upstash Redis.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.6
- [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/) >= 2.15
- [pnpm](https://pnpm.io/installation) >= 10
- [Node.js](https://nodejs.org/) >= 24
- [gh CLI](https://cli.github.com/) (for `secrets sync`)

## Local setup

```bash
pnpm install
pnpm build
```

## CLI

```bash
# Install globally from this repo
pnpm add -g @emit-infra/cli

# Or run directly
node dist/apps/cli/index.js --help
```

### Commands

| Command | Description |
|---|---|
| `emit-infra setup` | One-time machine setup: checks Terraform, Ansible, pnpm, Node, gh CLI |
| `emit-infra init <name>` | Scaffold `.emit-infra.json` and a Terraform root for a new project |
| `emit-infra provision` | Run `terraform apply` — creates VPS, DNS, firewall, R2 buckets, Redis |
| `emit-infra configure` | Run the full Ansible playbook on the server (Docker, nginx, SSL, swap) |
| `emit-infra deploy` | SSH → pull latest Docker images → `docker compose up -d` |
| `emit-infra status` | SSH health check: uptime, disk %, memory %, running containers |
| `emit-infra audit` | Inspect Dockerfiles + remote image sizes for production-readiness issues |
| `emit-infra secrets sync` | Push local `.env` values to GitHub repo secrets via `gh` CLI |
| `emit-infra destroy` | Destroy all Terraform-managed infrastructure (irreversible) |

All commands except `setup` and `init` read `.emit-infra.json` from the current directory (or a parent) to locate the project config.

#### `emit-infra audit` — what it checks

Run from any project root that has Dockerfiles. Exits with code 1 if any critical issues are found (CI-safe).

**Local (Dockerfile analysis):**
- `CRIT` — CMD/ENTRYPOINT runs a `dev` script in production (e.g. `pnpm dev`, `next dev`)
- `CRIT` — No multi-stage build: all source files and devDependencies land in the final image
- `WARN` — `pnpm install` without `--frozen-lockfile`
- `WARN` — `.dockerignore` missing recommended exclusions (`.git`, `**/*.test.*`, `.env*`, `*.md`)
- `INFO` — `COPY . .` detected: verify `.dockerignore` is comprehensive

**Remote (SSH into the server):**
- `WARN` — Container image > 500 MB
- `CRIT` — Container image > 1 GB (target for a Next.js app: 200–400 MB)

```bash
emit-infra audit                          # local checks + SSH to config domain
emit-infra audit --host 1.2.3.4          # override SSH target
emit-infra audit --key ~/.ssh/my-key     # override SSH key (default: ~/.ssh/id_ed25519)
emit-infra audit --local                 # skip SSH, local Dockerfile analysis only
```

#### Flags available on most commands

```bash
--config <path>    Path to .emit-infra.json (auto-discovered if omitted)
--key <path>       SSH private key path
--host <ip>        Override the server IP/hostname
--inventory <path> Ansible inventory path (configure, deploy)
```

## Docker conventions

Projects in this stack run via Docker Compose. Each app should have a production-ready Dockerfile following these rules — `emit-infra audit` checks them automatically.

### Required: multi-stage build

```dockerfile
# ── Stage 1: build ───────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:web          # runs "next build"

# ── Stage 2: runtime ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy only the built output — no source, no devDeps
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Key rules:
- **Never run a dev server in production** (`pnpm dev`, `next dev`). Dev servers run webpack in watch mode and accumulate memory indefinitely.
- **Copy only the build output** to the runner stage — no `node_modules` (except pruned prod deps), no `.ts` source, no test files.
- **Enable Next.js standalone output** in `next.config.ts`: `output: 'standalone'`. This bundles only the required Node modules, reducing image size from ~2 GB to ~300 MB.
- **Use `--frozen-lockfile`** on every `pnpm install` in a Dockerfile.

### `.dockerignore` template

```
node_modules
.next
dist
.nx
.git
coverage
playwright-report
test-results
**/*.test.*
**/*.spec.*
*.md
.env*
```

## Project config

Add `.emit-infra.json` to the root of any project:

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
    "buckets": ["uploads"]
  }
}
```

Then run:

```bash
emit-infra init my-project
emit-infra provision my-project
emit-infra configure my-project
emit-infra deploy my-project
```

## Reusable GitHub Actions workflows

Call from any project's workflow:

```yaml
# .github/workflows/ci.yml
jobs:
  ci:
    uses: develemit/emit-infra/.github/workflows/ci.yml@main
    with:
      node-version: "24"
      pnpm-version: "10.30.2"
    secrets:
      NX_CLOUD_ACCESS_TOKEN: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}

# .github/workflows/deploy.yml
jobs:
  deploy:
    uses: develemit/emit-infra/.github/workflows/deploy.yml@main
    with:
      environment: production
      app-dir: /opt/my-project
    secrets:
      SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
      SERVER_IP: ${{ secrets.SERVER_IP }}
```

## Terraform modules

Reference directly from any project's Terraform config:

```hcl
module "server" {
  source       = "github.com/develemit/emit-infra//terraform/modules/hetzner-server?ref=main"
  name         = "my-project"
  server_type  = "cx22"
  location     = "nbg1"
  ssh_key_name = "emit-deploy"
}

module "dns" {
  source    = "github.com/develemit/emit-infra//terraform/modules/cloudflare-dns?ref=main"
  zone_id   = var.cloudflare_zone_id
  domain    = "myproject.com"
  server_ip = module.server.ipv4_address
}
```

Available modules:

- `terraform/modules/hetzner-server` — VPS with firewall
- `terraform/modules/cloudflare-dns` — A records for root and www
- `terraform/modules/r2-bucket` — Cloudflare R2 storage bucket
- `terraform/modules/upstash-redis` — Upstash Redis database

## Ansible roles

Roles are used by the playbooks and can also be referenced via `ansible-galaxy`:

- `common` — base packages, swap, UFW, fail2ban, SSH hardening
- `docker` — Docker Engine + Compose plugin
- `nginx` — nginx reverse proxy + Certbot SSL
- `app-deploy` — Docker Compose pull and restart

## Repository structure

```
emit-infra/
├── apps/cli/               TypeScript CLI
├── packages/core/          Shared config schema and runner utilities
├── terraform/modules/      Reusable Terraform modules
├── ansible/
│   ├── roles/              Ansible roles
│   └── playbooks/          provision.yml, deploy.yml
└── .github/workflows/      Reusable CI and deploy workflows
```
