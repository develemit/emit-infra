import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { RestartSparkline, MobileContainerRow, DesktopContainerRow, type ContainerMetrics } from './container-row'
import type { Container } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  restartContainer: vi.fn().mockResolvedValue(undefined),
}))

const mockToast = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name, size }: { name: string; size: number }) =>
    React.createElement('span', { 'data-testid': `icon-${name}`, 'data-size': size }),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ variant, dot, children }: { variant: string; dot?: boolean; children: React.ReactNode }) =>
    React.createElement('span', { 'data-testid': 'badge', 'data-variant': variant, 'data-dot': dot }, children),
}))

const mockContainer: Container = {
  name: 'web',
  image: 'myapp:abc1234',
  status: 'Up 2 hours',
  state: 'running',
}

const mockMetrics: ContainerMetrics = {
  cpu: 45.2,
  memMb: 512,
  restarts: 2,
}

describe('RestartSparkline', () => {
  it('returns null when fewer than 2 points', () => {
    const { container } = render(
      <RestartSparkline points={[]} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('returns null when all restart counts are 0', () => {
    const points = [
      { t: 1000, restarts: 0 },
      { t: 2000, restarts: 0 },
      { t: 3000, restarts: 0 },
    ]
    const { container } = render(
      <RestartSparkline points={points} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders an svg with a polyline when data has variance', () => {
    const now = Date.now() / 1000
    const points = [
      { t: now - 3600, restarts: 0 },
      { t: now - 1800, restarts: 2 },
      { t: now, restarts: 5 },
    ]
    const { container } = render(
      <RestartSparkline points={points} />
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const polyline = container.querySelector('polyline')
    expect(polyline).not.toBeNull()
    expect(polyline?.getAttribute('stroke')).toBe('var(--err)')
  })

  it('uses var(--err) stroke when restarts increased in last hour', () => {
    const now = Date.now() / 1000
    const points = [
      { t: now - 1800, restarts: 1 },
      { t: now, restarts: 3 },
    ]
    const { container } = render(
      <RestartSparkline points={points} />
    )
    const polyline = container.querySelector('polyline')
    expect(polyline?.getAttribute('stroke')).toBe('var(--err)')
  })

  it('uses var(--fg-muted) stroke when restarts did not increase in last hour', () => {
    const now = Date.now() / 1000
    const points = [
      { t: now - 7200, restarts: 5 },
      { t: now - 3600, restarts: 3 },
      { t: now - 1800, restarts: 2 },
      { t: now, restarts: 2 },
    ]
    const { container } = render(
      <RestartSparkline points={points} />
    )
    const polyline = container.querySelector('polyline')
    expect(polyline?.getAttribute('stroke')).toBe('var(--fg-muted)')
  })
})

describe('MobileContainerRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the container name', () => {
    render(
      <MobileContainerRow
        c={mockContainer}
        logsHref="/logs"
        projectName="myapp"
      />
    )
    expect(screen.getByText('web')).toBeTruthy()
  })

  it('shows the correct badge variant for running state', () => {
    render(
      <MobileContainerRow
        c={mockContainer}
        logsHref="/logs"
        projectName="myapp"
      />
    )
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-variant')).toBe('ok')
    expect(badge.textContent).toContain('running')
  })

  it('shows the correct badge variant for exited state', () => {
    const exitedContainer = { ...mockContainer, state: 'exited' }
    render(
      <MobileContainerRow
        c={exitedContainer}
        logsHref="/logs"
        projectName="myapp"
      />
    )
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-variant')).toBe('err')
  })

  it('shows the correct badge variant for unknown state', () => {
    const unknownContainer = { ...mockContainer, state: 'paused' }
    render(
      <MobileContainerRow
        c={unknownContainer}
        logsHref="/logs"
        projectName="myapp"
      />
    )
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-variant')).toBe('warn')
  })

  it('shows build number when set', () => {
    const containerWithBuild = { ...mockContainer, buildNumber: '42' }
    render(
      <MobileContainerRow
        c={containerWithBuild}
        logsHref="/logs"
        projectName="myapp"
      />
    )
    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('falls back to image tag slice when buildNumber not set', () => {
    render(
      <MobileContainerRow
        c={mockContainer}
        logsHref="/logs"
        projectName="myapp"
      />
    )
    expect(screen.getByText('abc1234')).toBeTruthy()
  })

  it('calls restartContainer and onRefetch on restart button click', async () => {
    const { restartContainer } = await import('@/lib/api')
    const onRefetch = vi.fn()
    const user = userEvent.setup()

    render(
      <MobileContainerRow
        c={mockContainer}
        logsHref="/logs"
        projectName="myapp"
        onRefetch={onRefetch}
      />
    )

    const restartButton = screen.getByRole('button', { name: /restart/i })
    await user.click(restartButton)

    await waitFor(() => {
      expect(vi.mocked(restartContainer)).toHaveBeenCalledWith('myapp', 'web')
      expect(onRefetch).toHaveBeenCalled()
    })
  })

  it('renders metrics when provided', () => {
    render(
      <MobileContainerRow
        c={mockContainer}
        logsHref="/logs"
        projectName="myapp"
        metrics={mockMetrics}
      />
    )
    expect(screen.getByText('CPU 45.2%')).toBeTruthy()
    expect(screen.getByText('512 MB')).toBeTruthy()
    expect(screen.getByText('2 restarts')).toBeTruthy()
  })
})

describe('DesktopContainerRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the container name', () => {
    render(
      <table>
        <tbody>
          <DesktopContainerRow
            c={mockContainer}
            logsHref="/logs"
            projectName="myapp"
            isRestarting={false}
            onRestart={vi.fn()}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('web')).toBeTruthy()
  })

  it('shows the correct badge variant for state', () => {
    render(
      <table>
        <tbody>
          <DesktopContainerRow
            c={mockContainer}
            logsHref="/logs"
            projectName="myapp"
            isRestarting={false}
            onRestart={vi.fn()}
          />
        </tbody>
      </table>
    )
    const badge = screen.getByTestId('badge')
    expect(badge.getAttribute('data-variant')).toBe('ok')
    expect(badge.textContent).toContain('running')
  })

  it('shows build label and image', () => {
    render(
      <table>
        <tbody>
          <DesktopContainerRow
            c={mockContainer}
            logsHref="/logs"
            projectName="myapp"
            isRestarting={false}
            onRestart={vi.fn()}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('myapp:abc1234')).toBeTruthy()
    expect(screen.getByText('abc1234')).toBeTruthy()
  })

  it('calls onRestart when restart button is clicked', async () => {
    const onRestart = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(
      <table>
        <tbody>
          <DesktopContainerRow
            c={mockContainer}
            logsHref="/logs"
            projectName="myapp"
            isRestarting={false}
            onRestart={onRestart}
          />
        </tbody>
      </table>
    )

    const restartButton = screen.getByRole('button', { name: /restart/i })
    await user.click(restartButton)

    await waitFor(() => {
      expect(onRestart).toHaveBeenCalled()
    })
  })

  it('disables restart button when isRestarting is true', () => {
    render(
      <table>
        <tbody>
          <DesktopContainerRow
            c={mockContainer}
            logsHref="/logs"
            projectName="myapp"
            isRestarting={true}
            onRestart={vi.fn()}
          />
        </tbody>
      </table>
    )
    const restartButton = screen.getByRole('button', { name: /restart/i })
    expect((restartButton as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders metrics when provided', () => {
    render(
      <table>
        <tbody>
          <DesktopContainerRow
            c={mockContainer}
            logsHref="/logs"
            projectName="myapp"
            isRestarting={false}
            onRestart={vi.fn()}
            metrics={mockMetrics}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('45.2%')).toBeTruthy()
    expect(screen.getByText('512 MB')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('renders restart sparkline when provided', () => {
    const now = Date.now() / 1000
    const restartSeries = [
      { t: now - 3600, restarts: 0 },
      { t: now - 1800, restarts: 2 },
      { t: now, restarts: 5 },
    ]
    const { container } = render(
      <table>
        <tbody>
          <DesktopContainerRow
            c={mockContainer}
            logsHref="/logs"
            projectName="myapp"
            isRestarting={false}
            onRestart={vi.fn()}
            restartSeries={restartSeries}
          />
        </tbody>
      </table>
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })
})
