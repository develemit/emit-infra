# Hetzner Cloud — Compute

## What it does for develemit
Every project in the stack runs on a dedicated Hetzner Cloud VPS. Each server
hosts Docker Compose (API + web + postgres + nginx + any project-specific
containers). Servers are provisioned via Terraform using the `hetzner-server`
module and configured via Ansible.

## Pricing Tiers (CPX shared-CPU line, EU datacenter)

| Type | vCPU | RAM | Disk | EU/month | ash/month |
|---|---|---|---|---|---|
| CPX11 | 2 | 2 GB | 40 GB SSD | ~€4.15 | ~€5.99 |
| **CPX21** | 3 | 4 GB | 80 GB SSD | ~€7.90 | **~€13.99** |
| **CPX22** ← emit-vision | 4 | 8 GB | 80 GB SSD | **~€9.49** | ~€14.99 |
| CPX31 | 4 | 8 GB | 160 GB SSD | ~€13.09 | ~€20.99 |
| CPX41 | 8 | 16 GB | 240 GB SSD | ~€22.19 | ~€36.99 |

Billing is hourly (server creation to deletion). Powered-off servers still bill
for compute reservation — delete, don't stop.

## Currently Provisioned

IPv4 addresses are billed separately at **€0.60/month** per server since 2024
(confirmed via `/v1/pricing` API).

| Project | Server Type | Region | Server/month | +IPv4 | Total/month |
|---|---|---|---|---|---|
| emit-vision-prod | cpx22 | nbg1 (Nuremberg) | €9.49 | €0.60 | **€10.09** |
| martialops | cpx21 | ash (Ashburn) | €13.99 | €0.60 | **€14.59** |

**Current total: ~€24.68/month (~$26.90/month) — 2 active servers**

> Live figures confirmed by the emit-infra billing widget (`GET /billing/hetzner`).

## Planned Servers (new projects use cpx22 nbg1 unless latency requires ash)

| Project | Planned Type | Region | Est. Total/month |
|---|---|---|---|
| diner-decider | cpx22 | nbg1 | ~€10.09 |
| develemail | cpx22 | nbg1 | ~€10.09 |

**Planned total: ~€44.86/month — 4 servers**

## Upgrade Triggers

- **CPX31** when: sustained CPU >70% on a cpx22, or app container OOM-killing
- **CPX41** when: multiple high-traffic apps co-located, or Postgres needing >8 GB RAM
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
