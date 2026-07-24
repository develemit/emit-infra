import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { NginxConfigPanel } from './nginx-config-panel'
import { getNginxDrift, type NginxDrift } from '@/lib/api-infra'

vi.mock('@/lib/api-infra', () => ({
  getNginxDrift: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; style?: React.CSSProperties }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ variant, children }: { variant: string; children: React.ReactNode }) =>
    React.createElement('span', { 'data-testid': 'badge', 'data-variant': variant }, children),
}))

describe('NginxConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when status is unconfigured', async () => {
    vi.mocked(getNginxDrift).mockResolvedValue({ status: 'unconfigured' })
    const { container } = render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('returns null when fetch returns null (unreachable)', async () => {
    vi.mocked(getNginxDrift).mockResolvedValue(null)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('Unreachable')).toBeTruthy()
    })
  })

  it('shows loading state initially', () => {
    vi.mocked(getNginxDrift).mockReturnValue(new Promise(() => {}))
    render(<NginxConfigPanel name="myapp" />)
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0)
  })

  it('renders ok status badge when aligned', async () => {
    const drift: NginxDrift = {
      status: 'ok',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
      localLines: 10,
      serverLines: 10,
      diff: [],
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      const badge = screen.getByTestId('badge')
      expect((badge as HTMLElement).getAttribute('data-variant')).toBe('ok')
      expect(badge.textContent).toBe('Aligned')
    })
  })

  it('renders Aligned message for ok status', async () => {
    const drift: NginxDrift = {
      status: 'ok',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
      localLines: 10,
      serverLines: 10,
      diff: [],
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('Vhost config is aligned')).toBeTruthy()
    })
  })

  it('renders drift status badge', async () => {
    const drift: NginxDrift = {
      status: 'drift',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
      localLines: 10,
      serverLines: 12,
      diff: ['- old line', '+ new line'],
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      const badge = screen.getByTestId('badge')
      expect((badge as HTMLElement).getAttribute('data-variant')).toBe('warn')
      expect(badge.textContent).toBe('Drift')
    })
  })

  it('renders diff toggle when drifted', async () => {
    const drift: NginxDrift = {
      status: 'drift',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
      localLines: 10,
      serverLines: 12,
      diff: ['- old line', '+ new line'],
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('Show diff')).toBeTruthy()
    })
  })

  it('expands diff viewer when toggle clicked', async () => {
    const drift: NginxDrift = {
      status: 'drift',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
      localLines: 10,
      serverLines: 12,
      diff: ['- old line', '+ new line'],
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    const user = userEvent.setup()
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => screen.getByText('Show diff'))

    await user.click(screen.getByText('Show diff'))
    expect(screen.getByText('Hide diff')).toBeTruthy()
    expect(screen.getByText('- old line')).toBeTruthy()
    expect(screen.getByText('+ new line')).toBeTruthy()
  })

  it('renders missing-local status', async () => {
    const drift: NginxDrift = {
      status: 'missing-local',
      localPath: '/repo/nginx.conf',
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      const badge = screen.getByTestId('badge')
      expect((badge as HTMLElement).getAttribute('data-variant')).toBe('err')
      expect(badge.textContent).toBe('Missing')
    })
  })

  it('renders missing-local message', async () => {
    const drift: NginxDrift = {
      status: 'missing-local',
      localPath: '/repo/nginx.conf',
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('Local config file not found')).toBeTruthy()
    })
  })

  it('renders missing-server status', async () => {
    const drift: NginxDrift = {
      status: 'missing-server',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      const badge = screen.getByTestId('badge')
      expect((badge as HTMLElement).getAttribute('data-variant')).toBe('err')
      expect(badge.textContent).toBe('Missing')
    })
  })

  it('renders missing-server message', async () => {
    const drift: NginxDrift = {
      status: 'missing-server',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('Server config file not found')).toBeTruthy()
    })
  })

  it('calls refresh when refresh button clicked', async () => {
    const drift: NginxDrift = {
      status: 'ok',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
      localLines: 10,
      serverLines: 10,
      diff: [],
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    const user = userEvent.setup()
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => screen.getByText('Aligned'))

    await user.click(screen.getByText('Refresh'))
    expect(vi.mocked(getNginxDrift).mock.calls.length).toBeGreaterThan(1)
  })

  it('renders header with icon and title', async () => {
    const drift: NginxDrift = {
      status: 'ok',
      localPath: '/repo/nginx.conf',
      serverPath: '/etc/nginx/sites-available/myapp',
      localLines: 10,
      serverLines: 10,
      diff: [],
    }
    vi.mocked(getNginxDrift).mockResolvedValue(drift)
    render(<NginxConfigPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('Nginx Config')).toBeTruthy()
      expect(screen.getByTestId('icon-globe')).toBeTruthy()
    })
  })
})
