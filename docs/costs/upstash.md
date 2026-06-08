# Upstash — Serverless Redis

## What it does for develemit
Upstash Redis is provisioned via Terraform (`upstash-redis` module) as a
managed Redis instance for projects that need caching, rate limiting, or
session storage. It connects over TLS (`rediss://`).

## Pricing Tiers

| Tier | Price | Commands | Storage | Bandwidth |
|---|---|---|---|---|
| Free | $0 | 10k/day (300k/month) | 256 MB | 1 GB/month |
| Pay-as-you-go | $0 base | $0.20/100k commands | $0.25/GB | $0.03/GB |
| Fixed-250M | $10/month | Unlimited | 250 MB | Unlimited |
| Fixed-1GB | $40/month | Unlimited | 1 GB | Unlimited |

Commands reset daily on free tier — the daily cap (not monthly) is the real
constraint for apps with burst traffic patterns.

## Usage Estimates

| Project | Use Case | Est. Commands/day | Monthly Cost |
|---|---|---|---|
| martialops | Rate limiting, session cache | ~2k | $0 (free tier) |
| develemail | Rate limiting, queue metadata | ~5k | $0 (free tier) |
| emit-vision | Analytics caching | ~1k | $0 (free tier) |

**Current cost: $0/month** — all projects within free tier.

## Upgrade Triggers

- Free → Pay-as-you-go: when any project exceeds 10k commands/day consistently
- Pay-as-you-go → Fixed-250M: when monthly bill exceeds ~$8 (equivalent to
  4M+ commands/month)
- Fixed-250M → Fixed-1GB: when stored data exceeds 200 MB or commands are
  very high volume

## Notes

Each Terraform-provisioned project gets its own Upstash database (separate
auth, separate quota). This means the 10k/day free limit applies per project,
not shared across all projects.
