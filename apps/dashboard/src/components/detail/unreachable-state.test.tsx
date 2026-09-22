import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { UnreachableState } from './unreachable-state'
import type { ProjectSummary } from '@/lib/api-projects'
import type { DeployHistoryEntry } from '@/lib/api-history'

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

const project = {
  config: { name: 'myapp', domain: 'myapp.example.com', serverIp: '1.2.3.4' },
} as unknown as ProjectSummary

const deploy = {
  status: 'success',
  sha: 'abcdef1234567890',
  branch: 'main',
  startedAt: '2026-09-20T00:00:00.000Z',
  completedAt: '2026-09-20T00:05:00.000Z',
  durationSec: 300,
  servicesBuilt: ['api'],
} as DeployHistoryEntry

describe('UnreachableState', () => {
  it('shows the unreachable banner', () => {
    render(<UnreachableState project={project} deploys={[]} onRetry={vi.fn()} />)
    expect(screen.getByText(/SSH unreachable/)).toBeTruthy()
  })

  it('calls onRetry when Retry is clicked', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(<UnreachableState project={project} deploys={[]} onRetry={onRetry} />)
    await user.click(screen.getByText('Retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows last-known domain and IP from project config', () => {
    render(<UnreachableState project={project} deploys={[]} onRetry={vi.fn()} />)
    expect(screen.getByText('myapp.example.com')).toBeTruthy()
    expect(screen.getByText('1.2.3.4')).toBeTruthy()
  })

  it('shows the most recent deploy from history', () => {
    render(<UnreachableState project={project} deploys={[deploy]} onRetry={vi.fn()} />)
    expect(screen.getByText(/abcdef1/)).toBeTruthy()
    expect(screen.getByText(/success/)).toBeTruthy()
  })

  it('says so when there is no deploy history', () => {
    render(<UnreachableState project={project} deploys={[]} onRetry={vi.fn()} />)
    expect(screen.getByText('No deploy history')).toBeTruthy()
  })

  it('falls back gracefully when project is null', () => {
    render(<UnreachableState project={null} deploys={[]} onRetry={vi.fn()} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
