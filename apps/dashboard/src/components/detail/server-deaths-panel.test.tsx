import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ServerDeathsPanel } from './server-deaths-panel'
import { getServerDeaths, type ServerDeathEntry } from '@/lib/api-history'

vi.mock('@/lib/api-history', () => ({
  getServerDeaths: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; style?: React.CSSProperties }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ variant, children }: { variant: string; dot?: boolean; children: React.ReactNode }) =>
    React.createElement('span', { 'data-testid': 'badge', 'data-variant': variant }, children),
}))

function makeDeath(overrides: Partial<ServerDeathEntry> = {}): ServerDeathEntry {
  return {
    ts: '2026-08-23T01:00:00Z',
    name: 'myapp',
    reason: 'health-timeout',
    exitCode: null,
    signal: null,
    uptimeSec: 120,
    restartCount: 1,
    pid: 111,
    host: 'box1',
    lastOutput: '',
    ...overrides,
  }
}

describe('ServerDeathsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a quiet empty state when there are no deaths', async () => {
    vi.mocked(getServerDeaths).mockResolvedValue({ deaths: [] })
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => expect(screen.getByText('No crashes recorded.')).toBeTruthy())
  })

  it('does not show a count badge when there are no deaths', async () => {
    vi.mocked(getServerDeaths).mockResolvedValue({ deaths: [] })
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => expect(screen.getByText('No crashes recorded.')).toBeTruthy())
    expect(screen.queryByTestId('badge')).toBeNull()
  })

  it('falls back to an empty list if the fetch fails', async () => {
    vi.mocked(getServerDeaths).mockRejectedValue(new Error('network error'))
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => expect(screen.getByText('No crashes recorded.')).toBeTruthy())
  })

  it('renders reason, uptime, and restart count for a death', async () => {
    vi.mocked(getServerDeaths).mockResolvedValue({
      deaths: [makeDeath({ reason: 'exited', exitCode: 1, signal: 'SIGTERM', uptimeSec: 90, restartCount: 3 })],
    })
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('killed by SIGTERM')).toBeTruthy()
      expect(screen.getByText('up 1m 30s')).toBeTruthy()
      expect(screen.getByText('restart #3')).toBeTruthy()
    })
  })

  it('describes an exit with no signal by exit code', async () => {
    vi.mocked(getServerDeaths).mockResolvedValue({
      deaths: [makeDeath({ reason: 'exited', exitCode: 1, signal: null })],
    })
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => expect(screen.getByText('exited 1')).toBeTruthy())
  })

  it('describes a health-timeout death without an exit code or signal', async () => {
    vi.mocked(getServerDeaths).mockResolvedValue({
      deaths: [makeDeath({ reason: 'health-timeout', exitCode: null, signal: null })],
    })
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => expect(screen.getByText('health check timed out')).toBeTruthy())
  })

  it('keeps lastOutput collapsed until the disclosure is clicked', async () => {
    vi.mocked(getServerDeaths).mockResolvedValue({
      deaths: [makeDeath({ lastOutput: 'boom: connection refused' })],
    })
    const user = userEvent.setup()
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => screen.getByText('output'))
    expect(screen.queryByText('boom: connection refused')).toBeNull()

    await user.click(screen.getByText('output'))
    expect(screen.getByText('boom: connection refused')).toBeTruthy()

    await user.click(screen.getByText('output'))
    expect(screen.queryByText('boom: connection refused')).toBeNull()
  })

  it('does not show a disclosure toggle when lastOutput is empty', async () => {
    vi.mocked(getServerDeaths).mockResolvedValue({ deaths: [makeDeath({ lastOutput: '' })] })
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => screen.getByText('restart #1'))
    expect(screen.queryByText('output')).toBeNull()
  })

  it('shows a count badge matching the number of deaths', async () => {
    vi.mocked(getServerDeaths).mockResolvedValue({
      deaths: [makeDeath(), makeDeath({ ts: '2026-08-23T02:00:00Z' })],
    })
    render(<ServerDeathsPanel name="myapp" />)
    await waitFor(() => {
      const badges = screen.getAllByTestId('badge')
      expect(badges.some(b => b.textContent === '2')).toBe(true)
    })
  })
})
