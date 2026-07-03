import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { HealthCard } from './health-card'
import type { ProjectSummary, ProjectStatus, ScaleAdvice } from '@/lib/api'

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; style?: React.CSSProperties }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/components/ui/meter', () => ({
  Meter: ({ label, value }: { label: string; value: number; lg?: boolean }) =>
    React.createElement('div', { 'data-testid': 'meter', 'data-label': label, 'data-value': value }),
}))

const mockProject = {
  config: { name: 'myapp', region: 'us-east' },
} as unknown as ProjectSummary

const mockStatus = {
  disk: 40,
  memory: 60,
  diskUsed: '4G',
  diskTotal: '10G',
  memUsed: '1G',
  memTotal: '2G',
  uptime: 'up 5 days',
  region: 'us-east',
  serverType: 'cx22',
  ip: '1.2.3.4',
  nginxStatus: 'active',
  sslExpiry: null,
  redisStatus: null,
  deployedAt: null,
  activeSlot: null,
  buildNumber: '42',
  queueFailed: null,
  queueWait: null,
} as unknown as ProjectStatus

describe('HealthCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the Server Health header', () => {
    render(<HealthCard project={mockProject} status={mockStatus} />)
    expect(screen.getByText('Server Health')).toBeTruthy()
  })

  it('renders uptime stat from status.uptime', () => {
    render(<HealthCard project={mockProject} status={mockStatus} />)
    // "up 5 days" stripped of "up " → "5 days"
    expect(screen.getAllByText('5 days').length).toBeGreaterThan(0)
  })

  it('renders build number', () => {
    render(<HealthCard project={mockProject} status={mockStatus} />)
    expect(screen.getAllByText('42').length).toBeGreaterThan(0)
  })

  it('shows polledAgo refresh button when prop provided', () => {
    render(<HealthCard project={mockProject} status={mockStatus} polledAgo="5s ago" />)
    expect(screen.getByText('5s ago')).toBeTruthy()
  })

  it('calls onRefresh when polledAgo button is clicked', async () => {
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    render(<HealthCard project={mockProject} status={mockStatus} polledAgo="5s ago" onRefresh={onRefresh} />)
    await user.click(screen.getByText('5s ago'))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('does not show polledAgo button when prop is absent', () => {
    render(<HealthCard project={mockProject} status={mockStatus} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders uptimePct as percentage', () => {
    render(<HealthCard project={mockProject} status={mockStatus} uptimePct={99.5} />)
    expect(screen.getAllByText('99.5%').length).toBeGreaterThan(0)
  })

  it('renders — when uptimePct is null', () => {
    render(<HealthCard project={mockProject} status={mockStatus} uptimePct={null} />)
    // "—" appears in multiple stat tiles (e.g. deployed, ssl, etc.)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows nginx as Active when nginxStatus is active', () => {
    render(<HealthCard project={mockProject} status={mockStatus} />)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
  })

  it('shows nginx as Down when nginxStatus is not active', () => {
    const downStatus = { ...mockStatus, nginxStatus: 'dead' } as unknown as ProjectStatus
    render(<HealthCard project={mockProject} status={downStatus} />)
    expect(screen.getAllByText('Down').length).toBeGreaterThan(0)
  })

  it('shows SSL as Expired when sslExpiry is in the past', () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString()
    const expiredStatus = { ...mockStatus, sslExpiry: pastExpiry } as unknown as ProjectStatus
    render(<HealthCard project={mockProject} status={expiredStatus} />)
    expect(screen.getAllByText('Expired').length).toBeGreaterThan(0)
  })

  it('renders disk and memory meters', () => {
    render(<HealthCard project={mockProject} status={mockStatus} />)
    const meters = screen.getAllByTestId('meter')
    expect(meters.length).toBeGreaterThan(0)
  })

  it('shows scaleAdvice nudge when scaleAdvice is provided', () => {
    const advice: ScaleAdvice = {
      resource: 'memory',
      sustainedPct: 88,
      nextTier: 'cx32',
      currentEurMonth: 10,
      nextEurMonth: 20,
      note: null,
    } as unknown as ScaleAdvice
    render(<HealthCard project={mockProject} status={mockStatus} scaleAdvice={advice} />)
    expect(screen.getByText(/memory.*88%.*sustained/i)).toBeTruthy()
  })

  it('hides scaleAdvice nudge when scaleAdvice is null', () => {
    render(<HealthCard project={mockProject} status={mockStatus} scaleAdvice={null} />)
    expect(screen.queryByText(/sustained/i)).toBeNull()
  })
})
