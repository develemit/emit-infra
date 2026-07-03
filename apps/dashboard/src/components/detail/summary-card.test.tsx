import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { SummaryCard } from './summary-card'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; style?: React.CSSProperties }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ variant, children }: { variant: string; children: React.ReactNode }) =>
    React.createElement('span', { 'data-testid': 'badge', 'data-variant': variant }, children),
}))

describe('SummaryCard', () => {
  it('returns null when hidden is true', () => {
    const { container } = render(
      <SummaryCard icon="server" title="Networking" href="/networking" hidden />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the title', () => {
    render(<SummaryCard icon="server" title="Networking" href="/networking" />)
    expect(screen.getByText('Networking')).toBeTruthy()
  })

  it('links to the given href', () => {
    render(<SummaryCard icon="server" title="Networking" href="/networking" />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/networking')
  })

  it('renders the icon', () => {
    render(<SummaryCard icon="server" title="Networking" href="/networking" />)
    expect(screen.getByTestId('icon-server')).toBeTruthy()
  })

  it('renders a chevron arrow', () => {
    render(<SummaryCard icon="server" title="Networking" href="/networking" />)
    expect(screen.getByTestId('icon-chevRight')).toBeTruthy()
  })

  it('renders stats when provided', () => {
    render(
      <SummaryCard
        icon="server"
        title="Networking"
        href="/networking"
        stats={[
          { label: 'P50', value: '12ms' },
          { label: 'SSL', value: '45d' },
        ]}
      />
    )
    expect(screen.getByText('P50')).toBeTruthy()
    expect(screen.getByText('12ms')).toBeTruthy()
    expect(screen.getByText('SSL')).toBeTruthy()
    expect(screen.getByText('45d')).toBeTruthy()
  })

  it('renders badge when provided', () => {
    render(
      <SummaryCard
        icon="server"
        title="Networking"
        href="/networking"
        badge={{ variant: 'ok', label: 'healthy' }}
      />
    )
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-variant')).toBe('ok')
    expect(badge.textContent).toContain('healthy')
  })

  it('omits badge when not provided', () => {
    render(<SummaryCard icon="server" title="Networking" href="/networking" />)
    expect(screen.queryByTestId('badge')).toBeNull()
  })

  it('is not hidden when hidden is false', () => {
    render(<SummaryCard icon="server" title="Networking" href="/networking" hidden={false} />)
    expect(screen.getByText('Networking')).toBeTruthy()
  })
})
