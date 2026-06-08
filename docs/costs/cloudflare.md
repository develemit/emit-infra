# Cloudflare — DNS, CDN, and R2 Storage

## What it does for develemit
Two distinct roles:
1. **DNS + CDN**: All project domains are managed in Cloudflare. DNS records are
   provisioned via Terraform (`cloudflare-dns` module). Cloudflare proxies HTTP
   traffic, provides DDoS protection, and handles SSL termination at the edge.
2. **R2 Object Storage**: S3-compatible storage with zero egress fees. Used by
   projects that handle file uploads (currently: diner-decider).

## Cloudflare DNS / CDN Pricing

| Tier | Price | Key Limits |
|---|---|---|
| Free | $0 | Unlimited DNS queries, basic DDoS, 1 WAF rule |
| Pro | $20/month | Advanced WAF, image optimization, 5 Page Rules |
| Business | $200/month | Custom SSL, 25 WAF rules, priority support |

**Current usage: Free tier** — sufficient for all current projects. DNS is
free regardless of query volume. CDN caching is included.

Upgrade trigger: if a project needs custom WAF rules or advanced bot management.
At that point evaluate per-project Pro ($20/domain) vs. shared Business.

## Cloudflare R2 Pricing

| Resource | Free Allowance | Paid Rate |
|---|---|---|
| Storage | 10 GB/month | $0.015/GB/month |
| Class A ops (PUT, POST) | 1M/month | $4.50/million |
| Class B ops (GET) | 10M/month | $0.36/million |
| Egress | **Always free** | — |

## R2 Usage Estimates

| Project | Use Case | Est. Storage | Est. Ops/month | Monthly Cost |
|---|---|---|---|---|
| diner-decider | Restaurant photos | ~2 GB | ~50k GET, ~5k PUT | $0 (free tier) |
| develemail (future) | Email attachments | ~5 GB | ~100k GET, ~20k PUT | $0 (free tier) |

**Current R2 cost: $0** — well within free tier. Won't hit paid tier until
a single project stores >10 GB.

## Total Cloudflare Cost

**Now and for the foreseeable future: $0/month.**

The R2 free egress is a meaningful advantage over S3 (~$0.09/GB outbound) for
any file-heavy project. No reason to consider alternatives.
