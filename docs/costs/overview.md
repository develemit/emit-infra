# Infrastructure Cost Overview — Develemit Stack

_Last updated: 2026-06-07_

## Modeling Assumptions

| Variable | Value | Basis |
|---|---|---|
| Server type | cx22 (2 vCPU, 4 GB RAM) | All current .emit-infra.json configs |
| Datacenter | Ashburn (ash) | All current projects |
| Repos | Public | All develemit/* repos |
| Redis usage | <10k commands/day per project | Conservative estimate |
| R2 storage | <10 GB total | Current usage patterns |
| Email volume | Varies by project (see per-project notes) | — |
| Currency | USD (Hetzner EUR × 1.09 approx) | 2026-06 exchange rate |

---

## Current Monthly Spend (June 2026)

| Service | Vendor | Cost | Notes |
|---|---|---|---|
| emit-vision server | Hetzner cx22 | ~$4.15 | Active |
| martialops server | Hetzner cx22 | ~$4.15 | Active |
| DNS / CDN | Cloudflare | $0 | Free tier |
| R2 Storage | Cloudflare | $0 | <10 GB, free tier |
| Redis | Upstash | $0 | Free tier per project |
| CI/CD + Registry | GitHub | $0 | Public repos |
| **Total** | | **~$8.30/month** | |

---

## Planned Stack (all 4 projects provisioned)

| Service | Vendor | Cost | Notes |
|---|---|---|---|
| emit-vision server | Hetzner cx22 | ~$4.15 | Active |
| martialops server | Hetzner cx22 | ~$4.15 | Active |
| diner-decider server | Hetzner cx22 | ~$4.15 | Planned |
| develemail server | Hetzner cx22 | ~$4.15 | Planned |
| DNS / CDN (4 domains) | Cloudflare | $0 | Free tier |
| R2 Storage | Cloudflare | $0 | Free tier |
| Redis (4 instances) | Upstash | $0 | Free tier |
| CI/CD + Registry | GitHub | $0 | Public repos |
| **Total** | | **~$16.60/month** | |

---

## Cost by Scale (per project, using martialops as model)

| Scale | Users | Infra Cost | Notes |
|---|---|---|---|
| Launch | 0–500 | ~$4.15/month | Single cx22 handles it comfortably |
| Growth | 500–5k | ~$4.15/month | cx22 still sufficient, monitor CPU/RAM |
| Scale | 5k–20k | ~$8.30/month | Likely upgrade to cx32 ($8.30) for DB headroom |
| Mature | 20k–100k | ~$20–40/month | Separate DB server or managed Postgres |

**The dominant cost at every scale is Stripe fees, not infrastructure.**
At $20/user/month and 500 paying users: Stripe takes ~$300/month (2.9% + $0.30).
Infrastructure at that scale: $4.15/month. Infra is <2% of Stripe fees.

---

## Revenue & Gross Margin (martialops model, $20/month plan)

| Paying Users | MRR | Stripe Fees (~3.2%) | Infra | Net Revenue | Gross Margin |
|---|---|---|---|---|---|
| 10 | $200 | $6.40 | $4.15 | $189.45 | 94.7% |
| 50 | $1,000 | $32 | $4.15 | $963.85 | 96.4% |
| 100 | $2,000 | $64 | $4.15 | $1,931.85 | 96.6% |
| 500 | $10,000 | $320 | $4.15 | $9,675.85 | 96.8% |
| 1,000 | $20,000 | $640 | $8.30 | $19,351.70 | 96.8% |
| 5,000 | $100,000 | $3,200 | $20 | $96,780 | 96.8% |

Infrastructure is never the margin story — Stripe is.

---

## Pivot Triggers

| When | Threshold | Action | Cost Change |
|---|---|---|---|
| Now | 2 active projects | — | $8.30/month |
| +2 projects | diner-decider + develemail launched | Add 2× cx22 | +$8.30 → $16.60/month |
| Any project >70% CPU | Sustained high load | Upgrade cx22 → cx32 | +$4.15/server |
| R2 >10 GB | File upload growth | R2 paid: $0.015/GB | ~+$0.15/GB over 10 GB |
| Redis >10k cmds/day | High-traffic project | Upstash pay-as-you-go | $0.20/100k commands |
| Postgres >3 GB RAM | DB-heavy workload | Separate DB server (cx22) | +$4.15/month |
| Private repos needed | IP protection | GitHub paid | +$0–4/month |

---

## Break-Even Analysis

Minimum paid infrastructure to go live with a single project: **$4.15/month** (one cx22).

With that server running, break-even at various price points:
- $5/month plan → 1 paying user covers infra
- $20/month plan → infra is covered in <1 paying user's fees

---

## Minimum Cost to Launch (single project)

| Item | Cost |
|---|---|
| Hetzner cx22 | ~$4.15/month |
| Cloudflare DNS | $0 |
| Upstash Redis | $0 |
| GitHub CI/CD | $0 |
| Cloudflare R2 | $0 |
| **Total** | **~$4.15/month** |

This is the floor. There is no cheaper viable self-hosted production stack.

---

## Dashboard Billing Widget (planned)

A real-time cost widget is planned for the emit-infra dashboard. It will call
the Hetzner Cloud API (`/v1/servers`, `/v1/volumes`, `/v1/floating_ips`) using
the stored `TF_VAR_hcloud_token` to calculate current-month spend to date and
project end-of-month total. See sprint `28-hetzner-billing-widget.md`.

---

## File Index

- [hetzner.md](hetzner.md) — Compute servers, pricing tiers, current inventory
- [cloudflare.md](cloudflare.md) — DNS, CDN, R2 storage costs
- [upstash.md](upstash.md) — Serverless Redis pricing and usage
- [github.md](github.md) — Actions CI/CD and container registry
