import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { BackupPanel } from './backup-panel'
import { fmtElapsed } from './backup-panel-helpers'
import { getBackupStatus, updateBackupRetainDays } from '@/lib/api'
import type { ProjectSummary } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  getBackupStatus: vi.fn(),
  updateBackupRetainDays: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; style?: React.CSSProperties }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

const mockProject = {
  config: {
    name: 'myapp',
    postgres: { backupRetainDays: 7 },
    warnThresholds: { backupAgeHours: 24 },
  },
} as unknown as ProjectSummary

function makeBackups(overrides: Record<string, unknown> = {}) {
  return {
    backups: [],
    loading: false,
    triggering: false,
    error: null,
    deleteError: null,
    deleteBackup: vi.fn().mockResolvedValue(undefined),
    triggerBackup: vi.fn().mockResolvedValue(undefined),
    downloadBackup: vi.fn(),
    fetchBackups: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ── fmtElapsed pure logic ──────────────────────────────────────────────────

describe('fmtElapsed', () => {
  it('formats seconds below 60', () => {
    expect(fmtElapsed(0)).toBe('0s')
    expect(fmtElapsed(45)).toBe('45s')
    expect(fmtElapsed(59)).toBe('59s')
  })

  it('formats seconds at 60 and above', () => {
    expect(fmtElapsed(60)).toBe('1m 0s')
    expect(fmtElapsed(90)).toBe('1m 30s')
    expect(fmtElapsed(125)).toBe('2m 5s')
  })
})

// ── Rendering ──────────────────────────────────────────────────────────────

describe('BackupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state', () => {
    render(<BackupPanel project={mockProject} backups={makeBackups({ loading: true })} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows empty state when no backups', () => {
    render(<BackupPanel project={mockProject} backups={makeBackups()} />)
    expect(screen.getByText('No backups found')).toBeTruthy()
  })

  it('renders backup list entries', () => {
    const backups = makeBackups({
      backups: [
        { key: 'myapp-2026-01-01.tar.gz', sizeBytes: 1024 * 1024, lastModified: new Date().toISOString() },
      ],
    })
    render(<BackupPanel project={mockProject} backups={backups} />)
    expect(screen.getByText('myapp-2026-01-01.tar.gz')).toBeTruthy()
    expect(screen.getByText('1.0 MB')).toBeTruthy()
  })

  it('shows stale warning when newest backup exceeds age threshold', () => {
    const oldDate = new Date(Date.now() - 25 * 3600 * 1000).toISOString()
    const backups = makeBackups({
      backups: [{ key: 'old.tar.gz', sizeBytes: 512, lastModified: oldDate }],
    })
    render(<BackupPanel project={mockProject} backups={backups} />)
    expect(screen.getByText(/older than 24h/i)).toBeTruthy()
  })

  it('does not show stale warning when backup is recent', () => {
    const recentDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    const backups = makeBackups({
      backups: [{ key: 'fresh.tar.gz', sizeBytes: 512, lastModified: recentDate }],
    })
    render(<BackupPanel project={mockProject} backups={backups} />)
    expect(screen.queryByText(/older than/i)).toBeNull()
  })

  it('shows initial idle button state', () => {
    render(<BackupPanel project={mockProject} backups={makeBackups()} />)
    const btn = screen.getByRole('button', { name: /back up now/i })
    expect(btn).toBeTruthy()
  })

  it('delete requires confirm click — first click shows Confirm?', async () => {
    const user = userEvent.setup()
    const backups = makeBackups({
      backups: [{ key: 'myapp.tar.gz', sizeBytes: 1024, lastModified: new Date().toISOString() }],
    })
    render(<BackupPanel project={mockProject} backups={backups} />)

    await user.click(screen.getByTitle('Delete'))
    expect(screen.getByText('Confirm?')).toBeTruthy()
  })

  it('delete second click calls deleteBackup', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined)
    const backups = makeBackups({
      backups: [{ key: 'myapp.tar.gz', sizeBytes: 1024, lastModified: new Date().toISOString() }],
      deleteBackup: mockDelete,
    })
    render(<BackupPanel project={mockProject} backups={backups} />)

    const deleteBtn = screen.getByTitle('Delete')
    fireEvent.click(deleteBtn)
    await waitFor(() => screen.getByText('Confirm?'))
    fireEvent.click(screen.getByTitle('Delete'))
    expect(mockDelete).toHaveBeenCalledWith('myapp.tar.gz')
  })
})

// ── State machine (fake timers) ────────────────────────────────────────────

function triggerBtnText(container: HTMLElement): string {
  // Finds the backup trigger button by looking for buttons that don't say "Save"
  const btns = Array.from(container.querySelectorAll('button'))
  const btn = btns.find(b => !b.textContent?.includes('Save') && !b.hasAttribute('title'))
  return btn?.textContent ?? ''
}

describe('BackupPanel button state machine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('transitions to running state on trigger', async () => {
    vi.mocked(getBackupStatus).mockResolvedValue({ lastRun: '2000-01-01T00:00:00Z', status: 'ok' })
    const { container } = render(<BackupPanel project={mockProject} backups={makeBackups()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
    })

    expect(triggerBtnText(container)).toContain('Running…')
  })

  it('shows fmtElapsed in running button — 45s', async () => {
    vi.mocked(getBackupStatus).mockResolvedValue({ lastRun: '2000-01-01T00:00:00Z', status: 'ok' })
    const { container } = render(<BackupPanel project={mockProject} backups={makeBackups()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(45000) })

    expect(triggerBtnText(container)).toContain('45s')
  })

  it('shows fmtElapsed in running button — 1m 30s', async () => {
    vi.mocked(getBackupStatus).mockResolvedValue({ lastRun: '2000-01-01T00:00:00Z', status: 'ok' })
    const { container } = render(<BackupPanel project={mockProject} backups={makeBackups()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(90000) })

    expect(triggerBtnText(container)).toContain('1m 30s')
  })

  it('transitions to complete when getBackupStatus returns new lastRun', async () => {
    const futureRun = new Date(Date.now() + 999999).toISOString()
    vi.mocked(getBackupStatus).mockResolvedValue({ lastRun: futureRun, status: 'ok' })
    const { container } = render(<BackupPanel project={mockProject} backups={makeBackups()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })

    expect(triggerBtnText(container)).toContain('Backup complete')
  })

  it('transitions to failed when getBackupStatus returns non-ok status', async () => {
    const futureRun = new Date(Date.now() + 999999).toISOString()
    vi.mocked(getBackupStatus).mockResolvedValue({ lastRun: futureRun, status: 'failed' })
    const { container } = render(<BackupPanel project={mockProject} backups={makeBackups()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })

    expect(triggerBtnText(container)).toContain('Backup failed')
  })

  it('transitions to timeout after 600s with no completion', async () => {
    vi.mocked(getBackupStatus).mockResolvedValue({ lastRun: '2000-01-01T00:00:00Z', status: 'ok' })
    const { container } = render(<BackupPanel project={mockProject} backups={makeBackups()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(600000) })

    expect(triggerBtnText(container)).toContain('Status unknown')
  })
})
