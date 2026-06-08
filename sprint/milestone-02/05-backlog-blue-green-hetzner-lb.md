# Sprint 05 — Backlog: Two-Server Blue-Green with Hetzner LB

- **Difficulty:** XL
- **Status:** backlog

## Goal

True blue-green deployment across two Hetzner servers behind a Hetzner Load
Balancer, with zero shared resources between environments.

## Reason

Single-server blue-green (sprint 04) still shares CPU/memory. For projects
that need full isolation — or that are too large for double-stacking on one
server — a two-server setup with an LB provides the gold standard of deploy
safety and horizontal scale.

## Context

- Hetzner Load Balancers support target-based routing and health checks
- Hetzner Cloud API (or `hcloud` CLI) can manage LB targets programmatically
- This would integrate with `packages/core/src/ansible.ts` and the provision flow
- Requires provisioning two servers per project instead of one

## Design Notes

- Provision creates two servers + one Hetzner LB
- LB health checks determine which server receives traffic
- Deploy targets the inactive server, validates, then updates LB targets
- Rollback = swap LB back to the other server
- Could reuse `hcloud` CLI or Hetzner API for LB management
- Consider Terraform for declarative infra state

## Why Backlog

This is a significant infrastructure investment (double server cost, LB cost,
new provisioning logic). It's the right choice for production services with
SLA requirements, but overkill for most projects in the current portfolio.
Worth having as a documented option for when a project graduates to that level.

## Files Likely Involved

- `packages/core/src/hetzner-lb.ts` (new — LB management)
- `ansible/playbooks/provision-lb.yml` (new)
- `ansible/roles/app-deploy/tasks/lb-blue-green.yml` (new)
- `apps/cli/src/commands/provision.ts` (LB option)
- `apps/dashboard` (LB status visibility)

## Completed

**Date:** 2026-06-06

### Summary
Backlog design document — no implementation. Documents the two-server
blue-green pattern with Hetzner Load Balancer for future reference.

### Files changed
- `sprint/05-backlog-blue-green-hetzner-lb.md` — this file (backlog item)

### Verification
- N/A (documentation only)

### Follow-ups
none
