# Setup Guide for emit-infra

## Prerequisites

- **Node.js**: v20.x or later
- **pnpm**: v9.x or later (install with `npm i -g pnpm`)
- **Terraform**: v1.5+ (for infrastructure provisioning)
- **Ansible**: 2.13+ (for deployments)

## Environment Variables

### API Server (`apps/api/.env`)

#### Required
- **`ANTHROPIC_API_KEY`** — Anthropic API key for the Claude ops chat panel. Get it from [console.anthropic.com](https://console.anthropic.com/)
- **`HCLOUD_TOKEN`** — Hetzner Cloud API token for infrastructure queries (required for server status queries)

#### Optional
- **`PORT`** — API server listen port. Defaults to `7001`.
- **`EMIT_SSH_KEY_PATH`** — Custom SSH key path for remote server connections. Defaults to `~/.ssh/emit-deploy` or `~/.ssh/emit-infra`.

### Dashboard (`apps/dashboard/.env.local`)

#### Optional
- **`NEXT_PUBLIC_API_URL`** — Public URL for direct API access. Only set if you need to bypass the Next.js proxy (cross-origin requests). Defaults to `/api` (proxied through Next.js rewrites).
- **`API_ORIGIN`** — Server-side origin for the Next.js rewrite proxy. Defaults to `http://localhost:7001`.

## Running the Project

### Development

```bash
# Install dependencies
pnpm install

# Run API and dashboard in dev mode
pnpm dev
```

The dashboard will be available at `http://localhost:3000` and the API at `http://localhost:7001`.

### Type Checking

```bash
# Check all packages
pnpm typecheck

# Or per package
pnpm nx typecheck dashboard --skip-nx-cache
pnpm nx typecheck api --skip-nx-cache
```

### Building

```bash
# Build all packages
pnpm build

# Or per package
pnpm nx build dashboard
pnpm nx build api
```

## SSH Key Setup

For the API to reach managed project servers, SSH keys must be present in `~/.ssh/`:

- **Default key names**: `emit-deploy`, `emit-infra`, `deploy-*`, or `emit-*`
- **Key permissions**: Should be `600` (`chmod 600 ~/.ssh/emit-deploy`)
- **Custom key path**: Override with `EMIT_SSH_KEY_PATH` env var

The API uses these keys to SSH into servers for:
- Status checks (uptime, disk %, memory %)
- Container logs and management
- Backup status queries

## Project Structure

- `apps/dashboard/` — Next.js frontend (port 3000)
- `apps/api/` — Fastify API server (port 7001)
- `packages/` — Shared utilities and core infrastructure libs
- `terraform/` — Infrastructure as Code (Hetzner Cloud)
- `ansible/` — Deployment playbooks

## Common Tasks

### List managed projects
```bash
curl http://localhost:7001/projects
```

### Get project status
```bash
curl http://localhost:7001/projects/:name/status
```

### Check API logs
```bash
# Watch API logs
pnpm nx logs api

# Or from dist
PORT=7001 node apps/api/dist/index.js
```

## Troubleshooting

### Port already in use
If port 3000 or 7001 is in use, override with environment variables:
```bash
PORT=7002 NEXT_PUBLIC_API_URL=http://localhost:7002 pnpm dev
```

### SSH key permission denied
Ensure keys in `~/.ssh/` are readable by your user:
```bash
chmod 600 ~/.ssh/emit-deploy ~/.ssh/emit-infra
```

### API can't reach servers
- Verify SSH key is at `~/.ssh/emit-deploy` or path specified in `EMIT_SSH_KEY_PATH`
- Test connectivity: `ssh -i ~/.ssh/emit-deploy user@server-ip`
- Check that `HCLOUD_TOKEN` is set for server discovery

### TypeCheck or build failures
Clear cache and reinstall:
```bash
rm -rf node_modules pnpm-lock.yaml .nx
pnpm install
pnpm typecheck
```
