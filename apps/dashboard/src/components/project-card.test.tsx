import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { ProjectCard } from './project-card'
import type { ProjectSummary, ProjectStatus } from '@/lib/api-projects'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/lib/use-uptime-pct', () => ({
  useUptimePct: () => null,
}))

vi.mock('@/lib/use-disk-trend', () => ({
  useDiskTrend: () => null,
}))

vi.mock('@/lib/use-pipeline-status', () => ({
  usePipelineStatus: () => ({ ci: null, deploy: null }),
  runStateOf: () => 'idle',
}))

const mockProject = {
  config: { name: 'myapp', domain: 'myapp.example.com', region: 'nbg1' },
} as unknown as ProjectSummary

describe('ProjectCard', () => {
  it('shows "never reached" when unreachable with no last-seen time', () => {
    const status = { error: 'unreachable' } as unknown as ProjectStatus
    render(<ProjectCard project={mockProject} status={status} />)
    expect(screen.getByText('SSH unreachable — never reached')).toBeTruthy()
    expect(screen.queryByText(/last seen —/)).toBeNull()
  })

  it('shows the relative last-seen time when unreachable with a deployedAt', () => {
    const status = {
      error: 'unreachable',
      deployedAt: String(Math.floor(Date.now() / 1000) - 7200),
    } as unknown as ProjectStatus
    render(<ProjectCard project={mockProject} status={status} />)
    expect(screen.getByText('SSH unreachable — last seen 2h ago')).toBeTruthy()
  })
})
