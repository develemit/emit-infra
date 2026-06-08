# Infrastructure Cost Overview — Develemit Stack

_Last updated: 2026-06-08 (numbers confirmed via Hetzner billing API)_

## Modeling Assumptions

| Variable | Value | Basis |
|---|---|---|
| emit-vision server | cpx22 nbg1 | Confirmed via Hetzner API |
| martialops server | cpx21 ash | Confirmed via Hetzner API |
| New projects | cpx22 nbg1 (default) | Best value, EU latency acceptable |
| Repos | Public | All develemit/* repos |
| Redis usage | <10k commands/day per project | Conservative estimate |
| R2 storage | <10 GB total | Current usage patterns |
| Currency | USD (Hetzner EUR × 1.09 approx) | 2026-06 exchange rate |

---

## Current Monthly Spend (June 2026)

| Service | Vendor | Cost | Notes |
|---|---|---|---|
| emit-vision-prod (cpx22 nbg1) | Hetzner | €9.49 | Active |
| emit-vision IPv4 | Hetzner | €0.60 | Active |
| martialops (cpx21 ash) | Hetzner | €13.99 | Active |
| martialops IPv4 | Hetzner | €0.60 | Active |
| DNS / CDN | Cloudflare | $0 | Free tier |
| R2 Storage | Cloudflare | $0 | <10 GB, free tier |
| Redis | Upstash | $0 | Free tier per project |
| CI/CD + Registry | GitHub | $0 | Public repos |
| **Total** | | **€24.68/month (~$26.90)** | |

---

## Planned Stack (all 4 projects provisioned)

| Service | Vendor | Cost | Notes |
|---|---|---|---|
| emit-vision-prod (cpx22 nbg1) | Hetzner | €10.09 | Active |
| martialops (cpx21 ash) | Hetzner | €14.59 | Active |
| diner-decider (cpx22 nbg1) | Hetzner | €10.09 | Planned |
| develemail (cpx22 nbg1) | Hetzner | €10.09 | Planned |
| DNS / CDN (4 domains) | Cloudflare | $0 | Free tier |
| R2 Storage | Cloudflare | $0 | Free tier |
| Redis (4 instances) | Upstash | $0 | Free tier |
| CI/CD + Registry | GitHub | $0 | Public repos |
| **Total** | | **€44.86/month (~$48.90)** | |

---

## Cost by Scale (per project, cpx22 nbg1 as baseline)

| Scale | Users | Infra Cost | Notes |
|---|---|---|---|
| Launch | 0–500 | ~€10/month | Single cpx22 handles it comfortably |
| Growth | 500–5k | ~€10/month | cpx22 still sufficient, monitor CPU/RAM |
| Scale | 5k–20k | ~€20/month | Likely upgrade to cpx31 (~€14) for DB headroom |
| Mature | 20k–100k | ~€35–60/month | Separate DB server or managed Postgres |

**The dominant cost at every scale is Stripe fees, not infrastructure.**
At $20/user/month and 500 paying users: Stripe takes ~$300/month (2.9% + $0.30).
Infrastructure at that scale: ~€10/month. Infra is <4% of Stripe fees.

---

## Revenue & Gross Margin (martialops model, $20/month plan)

| Paying Users | MRR | Stripe Fees (~3.2%) | Infra | Net Revenue | Gross Margin |
|---|---|---|---|---|---|
| 10 | $200 | $6.40 | ~$11 | $182.60 | 91.3% |
| 50 | $1,000 | $32 | ~$11 | $957 | 95.7% |
| 100 | $2,000 | $64 | ~$11 | $1,925 | 96.3% |
| 500 | $10,000 | $320 | ~$11 | $9,669 | 96.7% |
| 1,000 | $20,000 | $640 | ~$22 | $19,338 | 96.7% |
| 5,000 | $100,000 | $3,200 | ~$40 | $96,760 | 96.8% |

Infrastructure is never the margin story — Stripe is.

---

## Pivot Triggers

| When | Threshold | Action | Cost Change |
|---|---|---|---|
| Now | 2 active projects | — | €24.68/month |
| +2 projects | diner-decider + develemail launched | Add 2× cpx22 nbg1 | +€20.18 → €44.86/month |
| Any project >70% CPU | Sustained high load | Upgrade cpx22 → cpx31 | +~€4/server |
| R2 >10 GB | File upload growth | R2 paid: $0.015/GB | ~+$0.15/GB over 10 GB |
| Redis >10k cmds/day | High-traffic project | Upstash pay-as-you-go | $0.20/100k commands |
| Postgres >3 GB RAM | DB-heavy workload | Separate DB server (cpx22) | +€10/month |
| Private repos needed | IP protection | GitHub paid | +$0–4/month |

---

## Break-Even Analysis

Minimum paid infrastructure for a single project: **~€10/month** (cpx22 nbg1 + IPv4).

With that server running, break-even at various price points:
- $5/month plan → 3 paying users cover infra
- $20/month plan → infra is covered in <1 paying user's fees

---

## Minimum Cost to Launch (single project)

| Item | Cost |
|---|---|
| Hetzner cpx22 nbg1 | €9.49/month |
| Hetzner IPv4 | €0.60/month |
| Cloudflare DNS | $0 |
| Upstash Redis | $0 |
| GitHub CI/CD | $0 |
| Cloudflare R2 | $0 |
| **Total** | **~€10.09/month (~$11)** |

---

## Dashboard Billing Widget

Live cost data is surfaced on the emit-infra dashboard via `GET /billing/hetzner`.
Queries the Hetzner Cloud API in real time and caches for 1 hour. Requires
`HCLOUD_TOKEN` in `apps/api/.env`. See `sprint/28-hetzner-billing-widget.md`.

---

## File Index

- [hetzner.md](hetzner.md) — Compute servers, pricing tiers, current inventory
- [cloudflare.md](cloudflare.md) — DNS, CDN, R2 storage costs
- [upstash.md](upstash.md) — Serverless Redis pricing and usage
- [github.md](github.md) — Actions CI/CD and container registry
