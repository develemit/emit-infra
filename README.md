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
| `emit-infra init <name>` | Scaffold `.emit-infra.json` and a Terraform root for a project |
| `emit-infra provision <name>` | Run `terraform apply` to create all infrastructure |
| `emit-infra configure <name>` | Run the full Ansible provision playbook on the server |
| `emit-infra deploy <name>` | Pull latest Docker images and restart the app |
| `emit-infra status <name>` | SSH health check: uptime, disk, memory, containers |
| `emit-infra secrets sync <name>` | Push `.env` to GitHub repo secrets |
| `emit-infra destroy <name>` | Destroy all Terraform-managed infrastructure |

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
