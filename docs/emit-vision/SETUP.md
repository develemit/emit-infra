# emit-vision — Infrastructure Setup

This document records the one-time setup decisions, manual steps, and gotchas for the
emit-vision production infrastructure. Terraform automates recurring provisioning;
this doc covers everything Terraform cannot.

## Account structure

All service accounts live under the `emit@develemit.com` identity unless noted.

| Service     | Purpose                          | Notes                                      |
|-------------|----------------------------------|--------------------------------------------|
| Hetzner     | VPS (CPX22, nbg1)               | Server + floating IP + firewall            |
| Cloudflare  | DNS + R2 object storage         | Zone: `emitvision.com`                     |
| Neon        | Postgres (managed, free tier)   | Created manually — see below               |
| Upstash     | Redis (global, free tier)       | Managed by Terraform                       |
| Resend      | Transactional email             | Domain verified as `emitvision.com`        |
| Stripe      | Payments (emit-vision sub-acct) | Separate project under Develemit org       |

## Prerequisites

```
emit-vision/infra/.env               # TF_VAR_* values — gitignored
emit-vision/infra/secrets.prod.env   # All 26 app secrets — gitignored
emit-vision/infra/terraform/terraform.tfstate  # Local state — gitignored, back up manually
```

Generate the deploy SSH key once:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/emit-vision-deploy -C emit-vision-deploy
```

Source the env file before any `terraform` command (the SSH key value contains spaces,
so `xargs` will not work — use `source`):
```bash
set -a && source infra/.env && set +a
cd infra/terraform && terraform apply
```

## Manual steps Terraform cannot automate

### Cloudflare R2

R2 requires opt-in from the Cloudflare dashboard before the API can create buckets.

1. Log in to dash.cloudflare.com → R2 → "Get started"
2. Accept billing terms (free tier: 10 GB storage, 10M reads/mo)
3. Then run `terraform apply` — bucket creation will succeed

### Neon (Postgres)

The Neon free tier allows **one project per account**. Terraform was not used for Neon
because `terraform import` would require the neon provider and we hit the project limit.

- Database was created manually at console.neon.tech
- Connection string stored directly in `infra/secrets.prod.env` as `DATABASE_URL`
- `infra/terraform/neon.tf` is intentionally empty (see comment inside)
- If upgrading to Neon paid, you can re-add the provider and import the existing project

### Resend (email)

- Domain must be added as `emitvision.com` (not `emit.vision` — the Cloudflare zone
  is `emitvision.com`)
- Terraform adds the required DNS records to Cloudflare automatically
- DNS propagation + Resend verification takes 5–30 minutes
- API key (send-only restricted key) goes in `secrets.prod.env` as `RESEND_API_KEY`

### Stripe

emit-vision runs as a **separate project** inside the Develemit Stripe organization.
Stripe does not support true sub-accounts; the convention used here is:

- One Stripe account per product (emit-vision has its own login via account-switching)
- Both **test** and **live** mode products created: Starter ($9), Pro ($29), Team ($79)
- Webhook endpoint: `https://api.emitvision.com/webhooks/stripe`
- Selected events: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.trial_will_end`
- `STRIPE_WEBHOOK_SECRET` (test) and `STRIPE_WEBHOOK_SECRET_LIVE` stored in secrets

### Hetzner

- Server type: `cpx22` (AMD, 4 vCPU, 8 GB RAM, 80 GB disk) in `nbg1` (Nuremberg)
- Note: `cx21`/`cx22` type names are deprecated; use `cpx*` AMD lineup
- Staging environment was intentionally omitted (solo dev; saves ~€8/mo)
- Floating IP is attached to the server; `SERVER_IP` goes in secrets

## Secrets inventory

See `emit-vision/infra/secrets.prod.env` for the full list. Key groupings:

```
# App
JWT_SECRET, SESSION_SECRET, LOCAL_API_KEY

# Database / cache
DATABASE_URL        # Neon connection string (manual)
REDIS_URL           # Upstash (terraform output)

# Storage
R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

# Email
RESEND_API_KEY

# Payments
STRIPE_PUBLISHABLE_KEY, STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM

# Infra
SERVER_IP           # Hetzner floating IP (terraform output)
```

## GitHub Actions secrets

All secrets in `secrets.prod.env` must also be set as GitHub Actions secrets for the
deploy workflow. Additionally:

- `NX_CLOUD_ACCESS_TOKEN` — Nx Cloud remote cache token (not in secrets.prod.env)

## Terraform state

State is local (`infra/terraform/terraform.tfstate`). Back this file up manually after
each `terraform apply`. If it is lost, run `terraform import` for each managed resource.

Managed resources:
- `hcloud_server.prod` — Hetzner VPS
- `hcloud_firewall.prod` — firewall rules
- `hcloud_floating_ip.main` — static IP
- `hcloud_floating_ip_assignment.main`
- `cloudflare_record.*` — DNS records
- `cloudflare_r2_bucket.backups`
- `upstash_redis_database.main`

## Cost baseline (as of June 2026)

| Item              | Cost/mo   |
|-------------------|-----------|
| Hetzner CPX22     | €8.49     |
| Hetzner floating IP | €0.50   |
| Neon free tier    | €0        |
| Upstash free tier | €0        |
| Cloudflare R2     | €0 (< 10 GB) |
| Resend free tier  | €0 (< 3K emails/mo) |
| **Total**         | **~€9/mo** |

Team-tier customers at 10M events/mo each begin to stress disk at 5–6 concurrent
customers. Mitigation: 64 KB/event + 1 MB/batch hard limits (sprint 74) and SDK-side
truncation (sprint 75).
