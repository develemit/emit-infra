import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { PgTableSizesPanel } from './pg-table-sizes-panel'
import { getPgTableSizes } from '@/lib/api-infra'

vi.mock('@/lib/api-infra', () => ({
  getPgTableSizes: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: () => React.createElement('span'),
}))

describe('PgTableSizesPanel', () => {
  it('renders a not-configured state distinct from an empty table list', async () => {
    vi.mocked(getPgTableSizes).mockResolvedValue({ ok: false, kind: 'not-configured', message: 'Not configured for this project' })

    render(<PgTableSizesPanel name="develemail" />)

    await waitFor(() => expect(screen.getByText('Not configured for this project')).toBeTruthy())
    expect(screen.queryByText('No tables found')).toBeNull()
    expect(screen.queryByText('Nothing here yet')).toBeNull()
  })

  it('renders an empty state when postgres is configured but has no tables', async () => {
    vi.mocked(getPgTableSizes).mockResolvedValue({ ok: true, data: [] })

    render(<PgTableSizesPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText('Nothing here yet')).toBeTruthy())
  })

  it('renders an unreachable state on a 503', async () => {
    vi.mocked(getPgTableSizes).mockResolvedValue({ ok: false, kind: 'unreachable', message: "Couldn't reach the server" })

    render(<PgTableSizesPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText("Couldn't reach the server")).toBeTruthy())
  })

  it('renders tables when the fetch succeeds', async () => {
    vi.mocked(getPgTableSizes).mockResolvedValue({
      ok: true,
      data: [{ name: 'users', totalBytes: 2048, rowEstimate: 500 }],
    })

    render(<PgTableSizesPanel name="myapp" />)

    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
  })
})
