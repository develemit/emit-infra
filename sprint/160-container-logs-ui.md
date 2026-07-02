# Sprint 160 — Container log viewer — dashboard UI

> _Promoted from observability expansion plan, 2026-07-01. Depends on sprint 159._

**Difficulty:** 3

## Goal

Add a "Logs" button to each container row in `ContainerTable`. Clicking it opens an inline `Terminal` below the container list that streams output from the sprint-159 SSE route (`GET /projects/:name/containers/:container/logs`).

## Reason

Sprint 159 exposed the container log stream via the API. This sprint wires it into the dashboard so operators can inspect container output without leaving the page or opening a terminal.

## Context

- `apps/dashboard/src/components/detail/container-table.tsx` renders the container list. Each row is `MobileContainerRow` or `DesktopContainerRow` from `./container-row.tsx`. The table component currently has a `logsBase` variable (`/projects/${projectName}/logs`) for CI logs — container logs are a separate endpoint.
- SSE consumer pattern: identical to `DeployPanel` in `apps/dashboard/src/components/deploy-panel.tsx`. It uses a `useEffect` + `fetch` + `ReadableStream` reader. Study that hook and replicate the pattern.
- `Terminal` component: `apps/dashboard/src/components/ui/terminal.tsx`. Props include `title`, `running`, `exit`, `children`. Mount it below the rows list.
- The `Icon` component is at `@/components/icon`. Use `name="logs"` or `name="file"` (check what icon names exist — look at other usages; fallback to `name="file"`).
- API URL: `${API_BASE}/projects/${encodeURIComponent(projectName)}/containers/${encodeURIComponent(containerName)}/logs`
  - This is a GET that streams SSE — use `fetch(url, { method: 'GET', headers: authHeaders() })`.
- State to add in `ContainerTable`: `const [activeLogsContainer, setActiveLogsContainer] = useState<string | null>(null)`.

## Tasks

1. Read `apps/dashboard/src/components/detail/container-table.tsx` in full to understand the current row rendering and available props.
2. Read `apps/dashboard/src/components/deploy-panel.tsx` to extract the SSE consumer pattern (`useDeploySse`).
3. Read `apps/dashboard/src/components/ui/terminal.tsx` to understand the `Terminal` props.
4. In `apps/dashboard/src/components/detail/container-table.tsx`:
   - Add `activeLogsContainer: string | null` state.
   - Add a `useContainerLogs(url: string | null)` hook (inline or in a sibling file) that opens the SSE stream when `url` is non-null — returns `{ lines, exit }`. Abort the stream when `url` goes back to null.
   - Add a small logs button to each container row (desktop variant): an icon button with `title="View logs"` that calls `setActiveLogsContainer(c.name === activeLogsContainer ? null : c.name)` (toggle).
   - Below the container rows `div`, render:
     ```tsx
     {activeLogsContainer && (
       <ContainerLogViewer
         projectName={projectName}
         containerName={activeLogsContainer}
         onClose={() => setActiveLogsContainer(null)}
       />
     )}
     ```
5. Create the `ContainerLogViewer` component (in the same file or a separate `container-log-viewer.tsx`):
   - Accepts `{ projectName, containerName, onClose }`.
   - Uses the `useContainerLogs` hook.
   - Renders a `<Terminal>` with `title={containerName}` containing `lines.map((l, i) => <div key={i} className="ec-ln">{l}</div>)`.
   - Close button that calls `onClose`.
6. Add `getApiBase()` and `authHeaders()` imports from `@/lib/api` (they're already exported).
7. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/components/detail/container-table.tsx` — add logs toggle button and log viewer mount
- (new or inline) `apps/dashboard/src/components/detail/container-log-viewer.tsx` — Terminal with SSE consumer (create as separate file if adding inline would push container-table.tsx over 300 lines)

## Acceptance criteria

- [ ] Each container row (desktop) has a logs icon button
- [ ] Clicking the button opens an inline Terminal streaming from the sprint-159 route
- [ ] Clicking again (or the close button) collapses the Terminal and aborts the stream
- [ ] Only one container's logs are shown at a time
- [ ] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Out of scope

- Mobile row variant (desktop only for now)
- Log search / filter
- Timestamps column
- Persisting the open/closed state across page navigations
