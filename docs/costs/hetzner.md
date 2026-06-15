# Hetzner Cloud — Compute

## What it does for develemit
Every project in the stack runs on a dedicated Hetzner Cloud VPS. Each server
hosts Docker Compose (API + web + postgres + nginx + any project-specific
containers). Servers are provisioned via Terraform using the `hetzner-server`
module and configured via Ansible.

## Pricing Tiers

### CX shared-CPU line (current — use for all new servers)

| Type | vCPU | RAM | Disk | EU/month | ash/month |
|---|---|---|---|---|---|
| CX22 | 2 | 4 GB | 40 GB SSD | ~€4.35 | ~€6.29 |
| **CX23** ← all projects | 2 | 4 GB | 80 GB SSD | **~€6.49** | ~€9.39 |
| CX32 | 4 | 8 GB | 80 GB SSD | ~€11.09 | ~€16.09 |
| CX42 | 8 | 16 GB | 160 GB SSD | ~€20.19 | ~€29.29 |
| CX52 | 16 | 32 GB | 240 GB SSD | ~€38.39 | ~€55.59 |

### CPX legacy line (deprecated — do not use for new servers)

Hetzner still runs CPX instances but at significantly higher prices than CX equivalents. Migrate any existing CPX servers to CX.

| Type | vCPU | RAM | EU/month | ash/month | CX equivalent |
|---|---|---|---|---|---|
| CPX21 | 3 | 4 GB | ~€14.19 | ~€37.49 | CX23 |
| CPX22 | 2 | 4 GB | ~€22.99 | ~€33.29 | CX23 |
| CPX31 | 4 | 8 GB | ~€27.09 | ~€39.19 | CX32 |
| CPX41 | 8 | 16 GB | ~€51.09 | ~€74.09 | CX42 |

Billing is hourly (server creation to deletion). Powered-off servers still bill
for compute reservation — delete, don't stop.

## Currently Provisioned

IPv4 addresses are billed separately at **€0.60/month** per server since 2024
(confirmed via `/v1/pricing` API).

| Project | Server Type | Region | Server/month | +IPv4 | Total/month |
|---|---|---|---|---|---|
| emit-vision-prod | cx23 | nbg1 (Nuremberg) | €6.49 | €0.60 | **€7.09** |
| martialops | cx23 | nbg1 (Nuremberg) | €6.49 | €0.60 | **€7.09** |
| tastease | cx23 | nbg1 (Nuremberg) | €6.49 | €0.60 | **€7.09** |
| diner-decider | cx23 | nbg1 (Nuremberg) | €6.49 | €0.60 | **€7.09** |

**Current total: ~€28.36/month — 4 active servers**

> Note: emit-vision-prod is still on CPX22 (€22.99) pending migration — actual current total is ~€44.26 until that migration is complete. See emit-vision pitfalls for the data-safe migration process.

## Planned Servers (new projects use cx23 nbg1 unless US latency is a hard requirement)

| Project | Planned Type | Region | Est. Total/month |
|---|---|---|---|
| develemail | cx23 | nbg1 | ~€7.09 |

**Planned total: ~€35.45/month — 5 servers**

## Upgrade Triggers

- **CX32** when: sustained CPU >70% on a CX23, or app container OOM-killing
- **CX42** when: multiple high-traffic apps co-located, or Postgres needing >8 GB RAM
- **Separate DB server**: when Postgres needs isolation from app containers (usually >10k active users on a single project)

## Alternatives Considered

| Option | $/month (equivalent) | Trade-offs |
|---|---|---|
| DigitalOcean Basic 4GB | $24 | Similar price, worse value for EU workloads |
| Fly.io 2CPU/4GB | ~$14 | Serverless pricing model, less predictable |
| Render Starter | $25 | Per-service billing, expensive at scale |
| Vultr VC2-2C-4GB | ~$24 | Similar to DO, no advantage |

Hetzner EU datacenters remain the best value for this stack. Consider nbg1/fsn1
over ash for new projects unless US latency is a hard requirement.
