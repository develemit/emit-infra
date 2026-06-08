# Hetzner Cloud — Compute

## What it does for develemit
Every project in the stack runs on a dedicated Hetzner Cloud VPS. Each server
hosts Docker Compose (API + web + postgres + nginx + any project-specific
containers). Servers are provisioned via Terraform using the `hetzner-server`
module and configured via Ansible.

## Pricing Tiers (Ashburn/ash datacenter, USD equiv)

| Type | vCPU | RAM | Disk | Bandwidth | $/month |
|---|---|---|---|---|---|
| CAX11 (ARM) | 2 | 4 GB | 40 GB SSD | 20 TB | ~$3.60 |
| **CX22 (Intel)** ← current | 2 | 4 GB | 40 GB SSD | 20 TB | ~$4.15 |
| CX32 (Intel) | 4 | 8 GB | 80 GB SSD | 20 TB | ~$8.30 |
| CX42 (Intel) | 8 | 16 GB | 160 GB SSD | 20 TB | ~$16.60 |

Billing is hourly (server creation to deletion). Powered-off servers still bill
for compute reservation — delete, don't stop.

## Currently Provisioned

| Project | Server Type | Region | Status | $/month |
|---|---|---|---|---|
| emit-vision | cx22 | ash (Ashburn) | active | ~$4.15 |
| martialops | cx22 | ash (Ashburn) | active | ~$4.15 |
| diner-decider | cx22 | ash (Ashburn) | planned | ~$4.15 |
| develemail | cx22 | ash (Ashburn) | planned | ~$4.15 |

**Current total: ~$8.30/month (2 active servers)**
**Planned total: ~$16.60/month (4 servers)**

## Upgrade Triggers

- **CX32** when: sustained CPU >70% on a cx22, or app container OOM-killing
- **CX42** when: multiple high-traffic apps co-located, or Postgres needing >4 GB RAM
- **Separate DB server**: when Postgres needs isolation from app containers (usually >10k active users on a single project)

## Alternatives Considered

| Option | $/month (equivalent) | Trade-offs |
|---|---|---|
| DigitalOcean Basic 4GB | $24 | 3-4× more expensive for same specs |
| Fly.io 2CPU/4GB | ~$14 | Serverless pricing model, less predictable |
| Render Starter | $25 | Per-service billing, expensive at scale |
| Vultr VC2-2C-4GB | ~$24 | Similar to DO, no advantage |

Hetzner is the clear winner for self-hosted VPS at this scale.
