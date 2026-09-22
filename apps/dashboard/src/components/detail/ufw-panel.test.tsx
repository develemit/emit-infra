import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { UfwPanel } from './ufw-panel'
import { getUfwRules } from '@/lib/api-ops'

vi.mock('@/lib/api-ops', () => ({
  getUfwRules: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

describe('UfwPanel', () => {
  it('shows an unreachable state on a 503, never "Inactive" or "No rules configured"', async () => {
    vi.mocked(getUfwRules).mockResolvedValue({ ok: false, kind: 'unreachable', message: "Couldn't reach the server" })

    render(<UfwPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText("Couldn't reach the server")).toBeTruthy())
    expect(screen.queryByText('Inactive')).toBeNull()
    expect(screen.queryByText('No rules configured')).toBeNull()
  })

  it('shows an empty state, not an error, when the server reports no rules', async () => {
    vi.mocked(getUfwRules).mockResolvedValue({ ok: true, data: { status: 'active', rules: [] } })

    render(<UfwPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText('Nothing here yet')).toBeTruthy())
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('renders rules when the fetch succeeds', async () => {
    vi.mocked(getUfwRules).mockResolvedValue({
      ok: true,
      data: { status: 'active', rules: [{ num: 1, to: '22/tcp', action: 'ALLOW', from: 'Anywhere' }] },
    })

    render(<UfwPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText('22/tcp')).toBeTruthy())
  })

  it('states the panel is read-only and where the firewall is managed', async () => {
    vi.mocked(getUfwRules).mockResolvedValue({ ok: true, data: { status: 'active', rules: [] } })

    render(<UfwPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText(/Read-only/)).toBeTruthy())
    expect(screen.getByText(/ansible\/roles\/common/)).toBeTruthy()
  })
})
