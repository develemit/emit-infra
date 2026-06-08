# GitHub — Actions CI/CD and Container Registry

## What it does for develemit
- **GitHub Actions**: Runs CI (lint, typecheck, test, e2e) and deploy workflows
  on every push to main
- **GHCR (GitHub Container Registry)**: Stores Docker images for projects that
  use the GHCR build-push deploy pattern (emit-infra scaffolded workflow)

## Pricing

| Resource | Free (Public Repos) | Free (Private Repos) | Paid Rate |
|---|---|---|---|
| Actions minutes | Unlimited | 2,000/month | $0.008/minute (Linux) |
| GHCR storage | Unlimited | 500 MB | $0.008/GB/month |
| GHCR bandwidth | Unlimited | 1 GB/month | $0.50/GB |

**All current repos are public** → Actions and GHCR are effectively free.

## Usage Estimates

| Project | CI duration (est.) | Deploys/month | Actions minutes/month |
|---|---|---|---|
| martialops | ~8 min/run | ~20 | ~160 min |
| develemail | ~6 min/run | ~15 | ~90 min |
| emit-vision | ~5 min/run | ~10 | ~50 min |
| diner-decider | ~5 min/run | ~10 | ~50 min |

**Total: ~350 minutes/month** — free on public repos, and within the 2k/month
free tier even if repos went private.

## Cost

**Now: $0/month.** No anticipated trigger to paid tier.

If repos go private: 350 minutes × $0.008 = **$2.80/month** — still negligible.

## Notes

- martialops currently builds Docker images on the server (git pull → compose build),
  not via GHCR. This uses server CPU/RAM during deploy and is slower than the
  GHCR pull pattern. Consider migrating to GHCR for faster deploys.
- GHCR image storage accumulates without cleanup. The deploy workflow's
  `docker image prune -f` handles dangling layers on the server side but not
  the registry itself. A periodic GHCR cleanup action is worth adding when
  image count grows.
