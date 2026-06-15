# Infrastructure Cost Overview — Develemit Stack

_Last updated: 2026-06-15 (numbers confirmed via Hetzner billing API)_

## Modeling Assumptions

| Variable | Value | Basis |
|---|---|---|
| All servers | cx23 nbg1 | Migrated from CPX legacy line June 2026 |
| Repos | Public | All develemit/* repos |
| Redis usage | <10k commands/day per project | Conservative estimate |
| R2 storage | <10 GB total | Current usage patterns |
| Currency | USD (Hetzner EUR × 1.09 approx) | 2026-06 exchange rate |

> **CPX → CX migration note:** Hetzner's CPX series is deprecated and priced 2–3× higher than equivalent CX specs. All new servers must use CX. Existing CPX servers should be migrated (snapshot → new CX server → delete old). See `docs/costs/hetzner.md` for the full pricing comparison.

---

## Current Monthly Spend (June 2026)

| Service | Vendor | Cost | Notes |
|---|---|---|---|
| emit-vision-prod (cx23 nbg1) | Hetzner | €7.09 | CPX22→CX23 migration pending |
| martialops (cx23 nbg1) | Hetzner | €7.09 | Migrated June 2026 |
| tastease (cx23 nbg1) | Hetzner | €7.09 | Active |
| diner-decider (cx23 nbg1) | Hetzner | €7.09 | Migrated June 2026 (was CPX21 ash) |
| DNS / CDN | Cloudflare | $0 | Free tier |
| R2 Storage | Cloudflare | $0 | <10 GB, free tier |
| Redis | Upstash | $0 | Free tier per project |
| CI/CD + Registry | GitHub | $0 | Public repos |
| **Total** | | **€28.36/month (~$30.90)** | emit-vision still on CPX22 = €44.26 until migrated |

---

## Planned Stack (5 projects)

| Service | Vendor | Cost | Notes |
|---|---|---|---|
| emit-vision-prod (cx23 nbg1) | Hetzner | €7.09 | |
| martialops (cx23 nbg1) | Hetzner | €7.09 | |
| tastease (cx23 nbg1) | Hetzner | €7.09 | |
| diner-decider (cx23 nbg1) | Hetzner | €7.09 | |
| develemail (cx23 nbg1) | Hetzner | €7.09 | Planned |
| DNS / CDN (5 domains) | Cloudflare | $0 | Free tier |
| R2 Storage | Cloudflare | $0 | Free tier |
| Redis (5 instances) | Upstash | $0 | Free tier |
| CI/CD + Registry | GitHub | $0 | Public repos |
| **Total** | | **€35.45/month (~$38.60)** | |

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
| Now | 4 active projects | — | ~€44/month (€28 after emit-vision migration) |
| +1 project | develemail launched | Add 1× cx23 nbg1 | +€7.09 → ~€35/month |
| Any project >70% CPU | Sustained high load | Upgrade cx23 → cx32 | +~€4.60/server |
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
