import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { ResponseTimePanel } from './response-time-panel'
import { getResponseTimes } from '@/lib/api-infra'

vi.mock('@/lib/api-infra', () => ({
  getResponseTimes: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

describe('ResponseTimePanel', () => {
  it('renders nothing while loading', () => {
    vi.mocked(getResponseTimes).mockReturnValue(new Promise(() => {}))
    const { container } = render(<ResponseTimePanel name="myapp" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when there is genuinely no sample data', async () => {
    vi.mocked(getResponseTimes).mockResolvedValue({ ok: true, data: { available: false } })
    const { container } = render(<ResponseTimePanel name="myapp" />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('shows an unreachable state on a 503, never silently disappearing', async () => {
    vi.mocked(getResponseTimes).mockResolvedValue({ ok: false, kind: 'unreachable', message: "Couldn't reach the server" })
    render(<ResponseTimePanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText("Couldn't reach the server")).toBeTruthy()
    })
  })

  it('renders response time stats when the fetch succeeds', async () => {
    vi.mocked(getResponseTimes).mockResolvedValue({
      ok: true,
      data: { available: true, p50ms: 45, p95ms: 210, p99ms: 890, sampleCount: 12345 },
    })
    render(<ResponseTimePanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('45ms')).toBeTruthy()
      expect(screen.getByText('210ms')).toBeTruthy()
    })
  })
})
