import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { SecretsPanel } from './secrets-panel'
import { getSecretsDrift, type SecretsDrift } from '@/lib/api-secrets'

vi.mock('@/lib/api-secrets', () => ({
  getSecretsDrift: vi.fn(),
  applySecrets: vi.fn(),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; style?: React.CSSProperties }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ variant, children }: { variant: string; children: React.ReactNode }) =>
    React.createElement('span', { 'data-testid': 'badge', 'data-variant': variant }, children),
}))

describe('SecretsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when fetch returns null (unreachable)', async () => {
    vi.mocked(getSecretsDrift).mockResolvedValue(null)
    const { container } = render(<SecretsPanel name="myapp" />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('renders a not-monitored warning card when unconfigured', async () => {
    vi.mocked(getSecretsDrift).mockResolvedValue({ status: 'unconfigured' })
    render(<SecretsPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('Not monitored')).toBeTruthy()
      expect(screen.getByText(/scaffold-required-keys myapp/)).toBeTruthy()
    })
  })

  it('shows empty count and empty keys distinctly from missing keys', async () => {
    const drift: SecretsDrift = {
      status: 'drift',
      missing: ['DATABASE_URL'],
      extra: [],
      present: ['API_KEY'],
      empty: ['SECRET_TOKEN'],
    }
    vi.mocked(getSecretsDrift).mockResolvedValue(drift)
    render(<SecretsPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('1 missing · 1 empty · 0 extra · 1 present')).toBeTruthy()
      expect(screen.getByText('Missing Keys')).toBeTruthy()
      expect(screen.getByText('Empty Keys')).toBeTruthy()
      expect(screen.getByText('SECRET_TOKEN')).toBeTruthy()
    })
  })

  it('shows sync button when only empty keys are present (no missing)', async () => {
    const drift: SecretsDrift = {
      status: 'drift',
      missing: [],
      extra: [],
      present: [],
      empty: ['SECRET_TOKEN'],
    }
    vi.mocked(getSecretsDrift).mockResolvedValue(drift)
    render(<SecretsPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('Sync to server')).toBeTruthy()
    })
  })

  it('renders ok status with zero empty keys and no empty section', async () => {
    const drift: SecretsDrift = {
      status: 'ok',
      missing: [],
      extra: [],
      present: ['DATABASE_URL', 'API_KEY'],
      empty: [],
    }
    vi.mocked(getSecretsDrift).mockResolvedValue(drift)
    render(<SecretsPanel name="myapp" />)
    await waitFor(() => {
      expect(screen.getByText('0 missing · 0 empty · 0 extra · 2 present')).toBeTruthy()
    })
    expect(screen.queryByText('Empty Keys')).toBeNull()
  })
})
