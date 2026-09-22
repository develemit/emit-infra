import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { CertPanel } from './cert-panel'
import { getCertDetails } from '@/lib/api-infra'

vi.mock('@/lib/api-infra', () => ({
  getCertDetails: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

describe('CertPanel', () => {
  it('renders nothing while loading', () => {
    vi.mocked(getCertDetails).mockReturnValue(new Promise(() => {}))
    const { container } = render(<CertPanel name="myapp" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows an unreachable state on a 503, never silently disappearing', async () => {
    vi.mocked(getCertDetails).mockResolvedValue({ ok: false, kind: 'unreachable', message: "Couldn't reach the server" })
    render(<CertPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText("Couldn't reach the server")).toBeTruthy()
    })
  })

  it('renders cert details when the fetch succeeds', async () => {
    vi.mocked(getCertDetails).mockResolvedValue({
      ok: true,
      data: {
        issuer: 'O=Let\'s Encrypt, CN=R3',
        subject: 'CN=example.com',
        serial: 'AABBCCDDEEFF00112233',
        notBefore: '2026-08-01T00:00:00.000Z',
        notAfter: '2026-11-01T00:00:00.000Z',
        sans: ['example.com'],
        renewTimerLastRan: '2026-09-20T00:00:00.000Z',
        daysUntilExpiry: 40,
      },
    })
    render(<CertPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('40d')).toBeTruthy()
    })
  })
})
