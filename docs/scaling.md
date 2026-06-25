# Scaling Plan — Develemit Stack

_Written: 2026-06-21. Based on actual infrastructure: Hetzner CX23 per project, Docker Compose,
nginx, Postgres, Redis, Cloudflare DNS._

---

## Current Baseline

| Dimension | Value |
|---|---|
| Server per project | CX23 — 2 vCPU (AMD EPYC-Genoa), 4 GB RAM, 80 GB SSD |
| Cost per project | €7.09/month (€6.49 server + €0.60 IPv4) |
| Total active | 4 servers — emit-vision, tastease, diner-decider, martialops |
| Total monthly | ~€28–35/month |
| Architecture | Docker Compose, nginx reverse proxy, Postgres, Redis (Upstash), Cloudflare DNS |
| Users today | <100 across all projects |

**Verdict: You are nowhere near any infrastructure bottleneck.** The CX23 can handle
~2,000–5,000 concurrent users for a typical Next.js + API + Postgres app before
anything starts to strain. Your constraint right now is users, not servers.

---

## What Cloudflare Already Gives You (at $0)

Cloudflare sits in front of all projects as DNS. When the orange cloud (proxy mode) is
enabled per domain, it also becomes a CDN and DDoS shield. Emit-vision already uses
Cloudflare Origin Certificates and full proxy mode. Other projects likely have DNS-only
(grey cloud) — see the Cloudflare sprint to finish this.

With Cloudflare proxy enabled on all projects, you immediately get:

| Capability | Impact |
|---|---|
| Static asset caching (JS, CSS, images) | ~60–80% of page requests never reach your server |
| DDoS protection | Absorbs volumetric attacks at Cloudflare's edge — your server stays up |
| Bandwidth offload | Hetzner gives 20 TB/month free; Cloudflare serves most traffic without touching it |
| Global CDN | ~330 edge PoPs; Asian/US users get static assets from a nearby node |
| Bot filtering | Reduces junk traffic hitting your origin |
| SSL termination | Cloudflare handles TLS handshakes; origin uses simpler Origin Certificates |

**This single move is the highest-leverage thing you can do right now and costs nothing.**
It effectively gives you a 5–10× headroom increase with zero server changes.

---

## Scaling Tiers

### Tier 0 — Now (<100 users, <100 concurrent)
**Status: ✅ Fine as-is**

CX23 per project. No changes needed. Cloudflare proxy on all domains is the only
action worth taking. Focus on product, not infra.

**Monthly cost: ~€35/month (5 projects)**

---

### Tier 1 — Early traction (100–5,000 users, ~50–500 concurrent)
**Status: Still fine, Cloudflare does the heavy lifting**

With Cloudflare proxy active, static assets are served from the edge. Only API calls
and dynamic page renders hit your origin. A Next.js app on a CX23 handles 500 concurrent
dynamic requests without sweating.

**Watch for:** CPU sustained >70% in your metrics dashboard. You'll see it in the
sparklines before it becomes a problem.

**Action if needed:** Upgrade CX23 → CX32 (4 vCPU, 8 GB RAM, €11.09/month, +€4/month).
This is a Hetzner snapshot + new server operation — no architecture change.

**Monthly cost: ~€35–55/month**

---

### Tier 2 — Real traction (5,000–50,000 users, ~500–5,000 concurrent)
**Status: Server upgrades, not architecture changes**

At this scale, Cloudflare is still handling the majority of traffic. You're now getting
real load on the Postgres connection pool and the API containers.

**What breaks first (in order):**
1. **Postgres connections** — Docker Compose gives each app container a direct Postgres
   connection. At high concurrency you'll hit `too many connections`. Fix: add PgBouncer
   in transaction mode as a container in the same Compose stack. ~2 hours of work, no
   schema changes.
2. **RAM on the app server** — more concurrent Node.js processes means more V8 heap.
   Upgrade to CX42 (8 vCPU, 16 GB RAM, €20.19/month) before OOM-kills start.
3. **Single-point-of-failure** — one server going down means full outage. At 5k+ real
   users this starts to matter. Blue-green deployments (already in place) prevent deploy
   downtime but don't protect against hardware failure.

**Actions:**
- Add PgBouncer to Docker Compose stack
- Upgrade to CX42 or CX52 depending on memory headroom
- Add Cloudflare Health Check + Hetzner snapshot-based failover runbook

**Monthly cost per project: ~€25–45/month**

---

### Tier 3 — Scale (50,000–500,000 users, ~5,000–50,000 concurrent)
**Status: Architecture changes required — but not before you need them**

This is where the single-server model needs to evolve. Cloudflare still handles the vast
majority of traffic (static, cached API responses), but write-heavy API endpoints, auth,
and DB mutations have real pressure.

**What breaks:**
- **Write throughput on Postgres** — a single Postgres instance handles ~1,000–5,000
  writes/second on CX52 hardware, but connection overhead becomes the real limit.
  Read replicas for analytics/search, PgBouncer for connection pooling.
- **Vertical limit** — CX52 (16 vCPU, 32 GB) is Hetzner's top shared-CPU server at
  €38.39/month. Beyond this you need dedicated servers (CCX line) or horizontal scaling.
- **Stateful sessions on one box** — need sticky sessions or move session state to Redis
  (Upstash paid tier, or self-hosted Redis on the same server).

**Architecture to adopt:**
```
Cloudflare (edge, cache, DDoS)
        ↓
Hetzner Load Balancer (~€6/month) — health checks, SSL termination
        ↓
2× CX42 app servers (blue/green already works here)
        ↓
1× CX32 Postgres server (dedicated, not shared with app)
+
Redis (Upstash Pro ~$10/month, or self-hosted)
```

This architecture change takes a weekend of work and requires:
- Hetzner Load Balancer provisioned via Terraform (already in infra)
- Moving Postgres from the app server Docker Compose to a dedicated server
- Updating app connection strings to point at the DB server IP
- Keeping blue-green deploy but deploying to both app servers

**Monthly cost per project: ~€60–120/month**

---

### Tier 4 — Millions of Users (500,000–5M users)
**Status: Plan now, build later**

At this scale, the infra spend is still modest relative to revenue. A project with
500k MAU at any reasonable conversion rate is generating significant revenue — infra
becomes a small fraction of costs again.

**What's needed:**
- **Multi-region** — Cloudflare already serves edge from 330 PoPs. DB is still a single
  region. For global write throughput, need Postgres read replicas in multiple regions
  or a distributed DB (Neon, PlanetScale, CockroachDB, etc.). This is a migration
  project in itself.
- **CDN-first architecture** — API responses that can be cached should have explicit
  `Cache-Control` headers so Cloudflare holds them at the edge. Reduces origin load by
  80%+ for read-heavy apps.
- **Horizontal app scaling** — 3–5 app servers behind the load balancer. Stateless
  containers already support this (blue-green already runs two slots).
- **Observability** — emit-infra metrics dashboard is a strong foundation. At this scale,
  add distributed tracing (emit-vision has ClickHouse, which can serve this role) and
  error tracking.
- **Background jobs** — queue-backed workers (emit-vision already has a worker container)
  should be on separate servers from the web-facing API so a job spike doesn't starve
  web requests.

**Cost estimate (single project at 1M MAU):**
| Component | Cost |
|---|---|
| 3× CX42 app servers | ~€61/month |
| 1× CX52 Postgres server | ~€39/month |
| Hetzner Load Balancer | ~€6/month |
| Cloudflare Pro (optional) | $20/month |
| Upstash Redis Pro | ~$10/month |
| **Total** | **~€120–140/month (~$140–165)** |

That's less than a single Vercel Pro + PlanetScale scale bill.

---

## Decision Tree: When to Scale What

```
CPU > 70% sustained for >1h?
  → Upgrade server tier (CX23 → CX32 → CX42)

Postgres connections erroring?
  → Add PgBouncer (2h work, no downtime)

RAM OOM kills on app container?
  → Upgrade server tier

Server unavailability matters (SLA / paying customers)?
  → Add Hetzner Load Balancer + second app server

Postgres slow queries or >10k active users?
  → Move Postgres to dedicated server

Users in multiple continents?
  → Cloudflare is already handling edge. Add read replicas if DB latency matters.

All of the above AND you have $100k+ MRR?
  → Consider a proper infra hire. Still on Hetzner though — it's excellent value.
```

---

## What NOT to Build Yet

These are the premature scaling traps:

| Don't | Why |
|---|---|
| Kubernetes | Massive operational overhead for <50k users. Docker Compose with blue-green is genuinely better at this scale. |
| Managed Postgres (RDS, Neon) | 3–5× the cost of self-hosted on Hetzner. Switch when you have ops headcount, not before. |
| Microservices | Your apps already have service separation (web/api/worker/marketing). Don't fragment further until team size forces it. |
| Multi-region DB | Only needed above ~500k users with global latency SLAs. Cloudflare edge handles read latency already. |
| CDN for API responses | Add `Cache-Control` headers first (1h work). Buy weeks of runway before any CDN investment. |

---

## Immediate Actions (in priority order)

1. **Enable Cloudflare proxy on all projects** (see Cloudflare sprint) — free, highest leverage
2. **Add nginx `CF-Connecting-IP` headers** — ensures real user IPs in logs/rate-limiting
3. **Add nginx static asset cache headers** — signals to Cloudflare what to cache
4. **When a project hits 70% CPU** — upgrade server tier, takes 20 min
5. **When Postgres connections error** — add PgBouncer, 2h work
6. **When you have 10k+ users on a project** — dedicated DB server

Nothing on this list costs more than €15/month until you're well past 10k users.

---

## Viral Spike Preparation (specific to marketing launches)

If you're running a marketing campaign that could spike to 10k–100k visitors in 24h:

1. **Cloudflare proxy active** — absorbs the static traffic spike automatically
2. **Cloudflare Cache Rules** — cache your marketing page (`/`) at the edge with a 1h TTL.
   A viral HN/Reddit hit becomes Cloudflare serving a cached page, not your server.
3. **Pre-scale the server** — temporarily upgrade to CX32/CX42 for the campaign period.
   Hetzner bills hourly, so upgrading for 72h costs ~€2–3.
4. **Rate limit the API** — add nginx `limit_req_zone` to prevent a surge of signups
   from hammering your DB. 10 req/s per IP is reasonable for auth endpoints.
5. **Have a runbook** — know in advance exactly how to upgrade a server (snapshot → new
   server → update DNS) so it takes 15 min not 2 hours if needed.

The realistic viral scenario: your marketing site gets 50k hits in a day. With Cloudflare
caching the marketing page, your origin sees ~200–500 dynamic requests. Your CX23 handles
that without breaking a sweat.
