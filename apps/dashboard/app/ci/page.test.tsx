import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import CiPage from './page'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/lib/api', () => ({
  getProjects: vi.fn().mockResolvedValue([
    { config: { name: 'healthy-app', domain: 'healthy.example.com' } },
  ]),
  getCiHistory: vi.fn().mockResolvedValue({
    runs: [{ status: 'success', durationSec: 30, completedAt: new Date().toISOString() }],
  }),
}))

describe('CiPage', () => {
  it('shows an empty-filter message when no project matches the selected tab', async () => {
    const user = userEvent.setup()
    render(<CiPage />)

    await waitFor(() => {
      expect(screen.getAllByText('healthy-app').length).toBeGreaterThan(0)
    })

    await user.click(screen.getByRole('button', { name: /Failing/ }))

    const messages = await screen.findAllByText('No projects match this filter')
    expect(messages.length).toBeGreaterThan(0)
    expect(screen.queryByText('healthy-app')).toBeNull()
  })
})
