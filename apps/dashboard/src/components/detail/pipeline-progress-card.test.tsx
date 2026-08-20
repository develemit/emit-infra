import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { PipelineProgressCard } from './pipeline-progress-card'
import * as pipelineStatus from '@/lib/use-pipeline-status'
import type { CiStatus, DeployStatus, RunState } from '@/lib/api-containers'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/lib/use-pipeline-status', () => ({
  usePipelineStatus: vi.fn(),
  runStateOf: vi.fn(),
}))

function mockPipeline(
  ci: CiStatus | null,
  deploy: DeployStatus | null,
  ciState: RunState,
  deployState: RunState,
) {
  vi.mocked(pipelineStatus.usePipelineStatus).mockReturnValue({ ci, deploy })
  vi.mocked(pipelineStatus.runStateOf).mockImplementation((status) => {
    if (status === ci) return ciState
    if (status === deploy) return deployState
    return 'idle'
  })
}

describe('PipelineProgressCard', () => {
  it('renders nothing when neither ci nor deploy is active', () => {
    mockPipeline(null, null, 'idle', 'idle')
    const { container } = render(<PipelineProgressCard name="demo" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a live deploy exactly as today: progress bar + pct + counting timer', () => {
    const deploy: DeployStatus = {
      status: 'deploying',
      sha: 'abcdef1234',
      branch: 'main',
      startedAt: new Date().toISOString(),
      progress: { step: 2, total: 3, pct: 66, label: 'building' },
      runState: { state: 'running', reason: 'fresh heartbeat', heartbeatAgeSec: 5, pidAlive: true, sameHost: true },
    }
    mockPipeline(null, deploy, 'idle', 'running')
    render(<PipelineProgressCard name="demo" />)

    expect(screen.getByText('Deploying')).toBeTruthy()
    expect(screen.getByText('66%')).toBeTruthy()
    expect(screen.getByText(/building/)).toBeTruthy()
    expect(screen.getByText(/abcdef12/)).toBeTruthy()
  })

  it('renders the orphaned treatment: no progress bar, states the stale duration', () => {
    const deploy: DeployStatus = {
      status: 'deploying',
      sha: 'abcdef1234',
      startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      progress: { step: 2, total: 3, pct: 66, label: 'building' },
      runState: { state: 'orphaned', reason: 'writer pid is gone', heartbeatAgeSec: 960, pidAlive: false, sameHost: true },
    }
    mockPipeline(null, deploy, 'idle', 'orphaned')
    render(<PipelineProgressCard name="demo" />)

    expect(screen.getByText('Deploy orphaned')).toBeTruthy()
    expect(screen.getByText(/No heartbeat for 16m/)).toBeTruthy()
    expect(screen.queryByText('66%')).toBeNull()
  })

  it('renders the unknown treatment as indeterminate, not as running', () => {
    const ci: CiStatus = {
      status: 'running',
      startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      // no runState — the pre-283 shape this represents never had one either
    }
    mockPipeline(ci, null, 'unknown', 'idle')
    render(<PipelineProgressCard name="demo" />)

    expect(screen.getByText('CI status unknown')).toBeTruthy()
    expect(screen.getByText(/no liveness data/)).toBeTruthy()
    expect(screen.queryByText('CI Running')).toBeNull()
  })

  it('prefers deploy over ci when both are active', () => {
    const ci: CiStatus = { status: 'running', runState: { state: 'running', reason: 'x', heartbeatAgeSec: 1, pidAlive: true, sameHost: true } }
    const deploy: DeployStatus = { status: 'deploying', runState: { state: 'running', reason: 'x', heartbeatAgeSec: 1, pidAlive: true, sameHost: true } }
    mockPipeline(ci, deploy, 'running', 'running')
    render(<PipelineProgressCard name="demo" />)

    expect(screen.getByText('Deploying')).toBeTruthy()
    expect(screen.queryByText('CI Running')).toBeNull()
  })
})
