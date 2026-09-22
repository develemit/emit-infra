import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { CronPanel } from './cron-panel'
import { getCronJobs } from '@/lib/api-ops'

vi.mock('@/lib/api-ops', () => ({
  getCronJobs: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

describe('CronPanel', () => {
  it('shows an unreachable state on a 503, never "No cron jobs found"', async () => {
    vi.mocked(getCronJobs).mockResolvedValue({ ok: false, kind: 'unreachable', message: "Couldn't reach the server" })

    render(<CronPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText("Couldn't reach the server")).toBeTruthy())
    expect(screen.queryByText('No cron jobs found')).toBeNull()
  })

  it('shows an empty state when there really are no jobs', async () => {
    vi.mocked(getCronJobs).mockResolvedValue({ ok: true, data: [] })

    render(<CronPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText('Nothing here yet')).toBeTruthy())
  })

  it('renders jobs when the fetch succeeds', async () => {
    vi.mocked(getCronJobs).mockResolvedValue({
      ok: true,
      data: [{ schedule: '0 * * * *', command: 'echo hi', source: 'crontab -l' }],
    })

    render(<CronPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText('echo hi')).toBeTruthy())
  })

  it('states the panel is read-only and where jobs are managed', async () => {
    vi.mocked(getCronJobs).mockResolvedValue({ ok: true, data: [] })

    render(<CronPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText(/Read-only/)).toBeTruthy())
    expect(screen.getByText(/ansible\/roles/)).toBeTruthy()
  })
})
