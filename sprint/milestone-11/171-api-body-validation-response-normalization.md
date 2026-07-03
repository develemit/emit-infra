# API Body Validation + Nginx Response Normalization
**Difficulty:** 2

## Goal
Add Zod body validation to `POST /projects/:name/register` and normalize the `nginx-endpoints` response to always return `{ endpoints: NginxEndpoint[] }`.

## Reason
The register endpoint accepts an arbitrary config shape with no validation — a malformed payload silently produces a broken project config file that can't be parsed on next load. The nginx-endpoints route returns either `{ available: false }` or `{ available: true, endpoints }`, forcing the dashboard component to branch on shape rather than always having a consistent array to render.

## Context
- `apps/api/src/routes/projects.ts` lines ~74–90: `POST /projects/:name/register` reads a JSON body and writes a config file. Check `packages/types/` for the `ProjectConfig` shape to derive required fields. At minimum validate: `name` (string), `domain` (string), `sshKeyName` (string). Optional fields can remain unvalidated in this sprint. Return 400 with `{ error: 'validation failed', details: ... }` on failure.
- `apps/api/src/routes/nginx-endpoints.ts`: the unavailable branch currently returns `{ available: false }`. Change it to return `{ available: false, endpoints: [] }`. Then update the dashboard types/component to use the always-present `endpoints` array and drop the `available` boolean branch.
- `apps/dashboard/src/lib/api.ts` — update `NginxEndpointsData` interface: remove `available: false` variant, simplify to `{ endpoints: NginxEndpoint[] }` or keep `available` as an always-present boolean alongside `endpoints`.
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` — update the render logic to use the simplified shape.

## Tasks
1. Read `projects.ts` lines ~74–90 and `packages/types/` to understand the register flow and `ProjectConfig` fields.
2. Define a `RegisterBody` Zod schema in `projects.ts` covering required fields (`name`, `domain`, `sshKeyName`). Apply it with `z.parse` and return 400 on failure.
3. In `nginx-endpoints.ts`, add `endpoints: []` to the unavailable response.
4. Update `NginxEndpointsData` in `api.ts` to the normalized shape.
5. Update `nginx-endpoints-panel.tsx` to simplify the conditional rendering.
6. Typecheck.

## Files involved
- `apps/api/src/routes/projects.ts` — add Zod body validation to register endpoint
- `apps/api/src/routes/nginx-endpoints.ts` — normalize unavailable response to include `endpoints: []`
- `apps/dashboard/src/lib/api.ts` — update NginxEndpointsData interface
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` — simplify render logic

## Acceptance criteria
- [x] `POST /projects/:name/register` with missing `domain` or `sshKeyName` returns 400
- [x] `GET /projects/:name/nginx-endpoints` always returns an object with an `endpoints` array (empty when unavailable)
- [x] Dashboard nginx panel renders correctly with the normalized shape
- [x] Typecheck passes

## Out of scope
- Deep nested validation of optional ProjectConfig fields (postgres, healthCheck, etc.)
- Rate limiting on register
- Adding `available` boolean removal (keep it if useful for showing a "not installed" message — just ensure `endpoints` is always present)

## Completed

**Date:** 2026-07-02

### Summary
Added `RegisterBody` Zod schema to `projects.ts` validating `config.name`, `config.domain`, and `config.sshKeyName` as required strings. The schema uses `.strict().passthrough()` to reject known-required missing fields while allowing optional ones through. Returns 400 with `{ error: 'validation failed', details }` on failure.

Normalized the nginx-endpoints response: both unavailable branches in `parseOutput()` now return `{ available: false, endpoints: [] }`. Updated `NginxEndpointsData` in `api.ts` to `{ available: boolean; endpoints: NginxEndpoint[] }` and the error fallback in `getNginxEndpoints` to include `endpoints: []`. The panel now checks `!available || endpoints.length === 0` rather than branching on discriminated union shape.

### Files changed
- `apps/api/src/routes/projects.ts` — added `RegisterBody` Zod schema and validation before writing config file
- `apps/api/src/routes/nginx-endpoints.ts` — both unavailable branches now return `{ available: false, endpoints: [] }`
- `apps/dashboard/src/lib/api.ts` — `NginxEndpointsData` simplified to `{ available: boolean; endpoints: NginxEndpoint[] }`; error fallback updated
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` — simplified conditional to `!available || endpoints.length === 0`

### Verification
- `npx nx test api`: 54/54 pass
- `npx nx run-many -t typecheck`: clean (all 5 packages pass)

### Follow-ups
- none
