# Sprint 163 — General project settings panel

> _Promoted from observability expansion plan, 2026-07-01._

**Difficulty:** 3

## Goal

Expand `PATCH /projects/:name/config` to accept all editable `ProjectConfig` fields, and add a collapsible "Settings" panel in the project detail page where users can edit server type, SSH key, postgres version, backup bucket, and required env keys without touching `.emit-infra.json` by hand.

## Reason

Sprint 153 added `PATCH /projects/:name/config` for `backupRetainDays` only. The same route pattern works for the full config. The dashboard already controls backup retention — this sprint closes the remaining gap: every field in `.emit-infra.json` should be editable from the UI so the file never needs to be hand-edited post-setup.

## Context

- `PATCH /projects/:name/config` is in `apps/api/src/routes/projects.ts`. Currently its Zod body schema (`PatchConfigBody`) only accepts `{ postgres: { backupRetainDays } }`. Expand it to accept all settable fields.
- `ProjectConfig` schema is in `packages/types/src/project-config.ts`. Fields:
  - `serverType: z.string().default('cx22')`
  - `sshKeyName: z.string().default('emit-deploy')`
  - `region: z.enum([...]).default('nbg1')` — read the exact enum from the schema
  - `domain: z.string()` — the server domain/IP
  - `serverIp: z.string().optional()` — optional static IP override
  - `postgres.version: z.string().default('16')`
  - `postgres.backupBucket: z.string().optional()`
  - `postgres.backupRetainDays: z.number().int().min(1).default(7)`
  - `requiredEnvKeys: z.string().array().optional()`
- The PATCH route should do a **deep merge** into the current JSON: read `.emit-infra.json`, merge top-level fields and the `postgres` sub-object, write back. **Never overwrite `name`** (it's the project identifier). Reject any attempt to change `name`.
- Dashboard: `ProjectSettingsPanel` — a collapsible card (collapsed by default, toggled by a "Settings" button). Sections:
  - **Server**: serverType (text input), region (select), domain (text input), serverIp (text input, optional)
  - **SSH**: sshKeyName (text input or select from `/projects/ssh-keys`)
  - **Database**: postgres.version (text input), postgres.backupBucket (text input)
  - **Access**: requiredEnvKeys (comma-separated textarea, split on save)
  - Each section has its own Save button (don't make one giant form — partial saves are safer).
- After a successful save, show a brief success message ("Saved") that fades out.
- The `GET /projects/ssh-keys` route already exists — use it to populate the SSH key dropdown.

## Tasks

1. Read `apps/api/src/routes/projects.ts` around the `PatchConfigBody` definition (added in sprint-153).
2. Read `packages/types/src/project-config.ts` in full to get exact field names and constraints.
3. Expand `PatchConfigBody` in `projects.ts` to accept:
   ```typescript
   const PatchConfigBody = z.object({
     serverType: z.string().optional(),
     sshKeyName: z.string().optional(),
     region: z.string().optional(),
     domain: z.string().optional(),
     serverIp: z.string().optional(),
     postgres: z.object({
       version: z.string().optional(),
       backupBucket: z.string().optional(),
       backupRetainDays: z.number().int().min(1).max(365).optional(),
     }).optional(),
     requiredEnvKeys: z.string().array().optional(),
   }).partial()
   ```
   - In the handler, reject if the body contains a `name` field.
   - Deep merge: for top-level fields, spread. For `postgres`, spread existing + incoming.
4. In `apps/dashboard/src/lib/api.ts`, add `updateProjectConfig(name, patch)` that calls `PATCH /projects/:name/config`.
5. Create `apps/dashboard/src/components/detail/project-settings-panel.tsx` (target ≤200 lines; split into sub-components if needed):
   - Collapsible: closed by default, toggled by a button with a gear/settings icon.
   - Four section groups (Server, SSH, Database, Access), each with its own Save button.
   - On save: call `updateProjectConfig`, show "Saved" text briefly, clear on timeout.
   - On error: show the error message inline.
6. Fetch `/projects/ssh-keys` for the SSH key dropdown inside the component (with `useEffect`).
7. Mount `<ProjectSettingsPanel project={project} />` in `apps/dashboard/app/projects/[name]/page.tsx` (near the bottom of the detail page, or in a dedicated "Config" section).
8. Run both typechecks.

## Files involved

- `apps/api/src/routes/projects.ts` — expand `PatchConfigBody` schema and merge logic
- `apps/dashboard/src/lib/api.ts` — add `updateProjectConfig`
- (new) `apps/dashboard/src/components/detail/project-settings-panel.tsx` — collapsible settings form
- `apps/dashboard/app/projects/[name]/page.tsx` — mount the panel

## Acceptance criteria

- [ ] `PATCH /projects/:name/config` accepts all ProjectConfig fields listed above
- [ ] Attempting to change `name` via the PATCH body returns 400
- [ ] Deep merge: patching `postgres.backupBucket` doesn't wipe `postgres.backupRetainDays`
- [ ] Settings panel is collapsed by default, expands on button click
- [ ] Each section saves independently with its own button
- [ ] Both typechecks pass clean

## Out of scope

- `github` field editing (too many sub-fields; leave for a dedicated sprint)
- Validation of domain/IP format (accept any string for now)
- Triggering an Ansible re-run after config changes
