import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BillingWidget } from './billing-widget'

function mockFetch(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })
}

const serverItem = {
  type: 'server' as const,
  name: 'emit-vision-prod',
  serverRate: 8.99,
  ipv4Rate: 0.5,
  monthlyRate: 9.49,
  spendToDate: 9.49,
}

const floatingIpItem = {
  type: 'floating_ip' as const,
  name: 'emit-vision production static IP',
  monthlyRate: 3.5,
  spendToDate: 3.16,
}

function billingPayload(breakdown: unknown[], month = '2026-07') {
  return {
    month,
    spendToDate: 41.11,
    projectedMonthly: 41.45,
    currency: 'EUR',
    breakdown,
    fetchedAt: '2026-07-29T00:00:00Z',
  }
}

describe('BillingWidget', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a server line item with serverRate and ipv4Rate', async () => {
    vi.stubGlobal('fetch', mockFetch(billingPayload([serverItem])))

    render(<BillingWidget />)

    await waitFor(() => screen.getByText('emit-vision-prod'))
    expect(screen.getByText('€8.99 + €0.50 IPv4')).toBeTruthy()
  })

  it('renders a floating-IP line item with its monthly rate and no IPv4 fragment', async () => {
    vi.stubGlobal('fetch', mockFetch(billingPayload([floatingIpItem])))

    render(<BillingWidget />)

    await waitFor(() => screen.getByText('emit-vision production static IP'))
    expect(screen.getByText('€3.50 floating IP')).toBeTruthy()
    expect(screen.queryByText(/IPv4/)).toBeNull()
  })

  it('renders "July 2026" for a 2026-07 payload', async () => {
    vi.stubGlobal('fetch', mockFetch(billingPayload([serverItem], '2026-07')))

    render(<BillingWidget />)

    await waitFor(() => screen.getByText('July 2026'))
  })

  it('renders the unavailable state when the API returns an error', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'HCLOUD_TOKEN not set' }))

    render(<BillingWidget />)

    await waitFor(() => screen.getByText(/Billing unavailable/))
  })
})
