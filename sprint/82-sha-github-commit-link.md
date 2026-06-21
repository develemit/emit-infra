# Link SHA to GitHub commit in CI and deploy history rows
**Difficulty:** 2

## Goal
When a project has a GitHub repo configured, make the short SHA in CI and deploy timeline rows an external link to the corresponding GitHub commit page. Opens in a new tab; clicking the row body still navigates to the log viewer.

## Reason
The SHA is the primary identifier for a CI or deploy run. With a single click it should take you to the diff, PR, and commit message on GitHub — right now you have to manually construct the URL. The `github.repo` field is already in `ProjectConfig` so this requires no new infrastructure.

## Context
- `ProjectConfig` in `apps/dashboard/src/lib/api.ts` has `github?: { repo: string }`. The repo value is in `owner/name` format (e.g. `"emitdutcher/tastease"`). The GitHub commit URL is `https://github.com/${repo}/commit/${sha}`.
- The detail page (`apps/dashboard/app/projects/[name]/page.tsx`) already fetches `project: ProjectSummary` via `getProjects()`. It passes `name` to `<CiTimeline>` and `<DeployTimeline>`. Extend both to also accept `repoUrl?: string`.
- In `page.tsx`, derive `repoUrl`: `project?.config.github ? \`https://github.com/${project.config.github.repo}/commit/\` : undefined` and pass it as a prop. The trailing `/commit/` means the component just appends the SHA.
- In the timeline components, when `repoUrl` is defined, wrap the SHA span in an `<a href={repoUrl + r.sha} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>`. The row itself is already a `<Link>` (navigation to log viewer); the `<a>` inside it opens GitHub in a new tab. `stopPropagation` prevents the row Link from also firing.
- Style the `<a>` with `className="hover:underline"` to indicate it's a link while keeping the monospace font styling from the parent span.

## Tasks
1. In `apps/dashboard/src/components/detail/ci-timeline.tsx`, add `repoUrl?: string` to `Props`. When defined, wrap the SHA `<span>` in `<a href={repoUrl + r.sha} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="hover:underline">`.
2. Do the same in `apps/dashboard/src/components/detail/deploy-timeline.tsx` using `d.sha`.
3. In `apps/dashboard/app/projects/[name]/page.tsx`, compute `repoUrl` from `project?.config.github?.repo` and pass it to both timeline components.
4. Verify: if `github` is not set on a project, the SHA renders as plain text (no link). No broken rendering when `repoUrl` is undefined.

## Files involved
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — add `repoUrl` prop; wrap SHA
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — same
- `apps/dashboard/app/projects/[name]/page.tsx` — derive and pass `repoUrl`

## Acceptance criteria
- [x] For projects with `github.repo` configured, clicking the SHA opens `github.com/{owner}/{repo}/commit/{fullSha}` in a new tab
- [x] Clicking the SHA link does NOT navigate to the log viewer
- [x] Clicking the rest of the row still navigates to the log viewer
- [x] For projects without `github.repo`, SHA renders as plain text (no link, no error)
- [x] `pnpm typecheck` passes

## Completed

**Date:** 2026-06-20

### Summary
Added `repoUrl?: string` prop to both `CiTimeline` and `DeployTimeline`. When defined, the SHA span is replaced with an `<a>` tag pointing to `https://github.com/{repo}/commit/{fullSha}` with `target="_blank"` and `onClick={e => e.stopPropagation()}` to prevent the parent `<Link>` from also firing. When undefined, the SHA renders as plain text — no change for projects without a GitHub config. The detail page derives `repoUrl` from `project?.config.github?.repo` and passes it to both timelines.

### Files changed
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — `repoUrl` prop + conditional `<a>` wrap on SHA
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — same for deploy rows
- `apps/dashboard/app/projects/[name]/page.tsx` — derives `repoUrl` and passes to both timelines

### Verification
- `pnpm typecheck` (dashboard): clean

### Follow-ups
none

## Out of scope
- Fetching commit message or PR title from GitHub API
- Adding repoUrl to project cards (home page)
- Linking branches to GitHub branch pages
