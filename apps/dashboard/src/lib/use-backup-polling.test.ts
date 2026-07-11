import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBackupPolling } from './use-backup-polling'
import * as api from './api'

vi.mock('./api')

describe('useBackupPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with idle state', () => {
    const { result } = renderHook(() => useBackupPolling('my-project', vi.fn()))
    expect(result.current.runningBackup).toBe(false)
    expect(result.current.backupResult).toBeNull()
    expect(result.current.elapsedSecs).toBe(0)
  })

  it('sets runningBackup=true and resets result on start()', () => {
    const { result } = renderHook(() => useBackupPolling('my-project', vi.fn()))
    act(() => { result.current.start() })
    expect(result.current.runningBackup).toBe(true)
    expect(result.current.backupResult).toBeNull()
    expect(result.current.elapsedSecs).toBe(0)
  })

  it('increments elapsedSecs every second while running', async () => {
    vi.mocked(api.getBackupStatus).mockResolvedValue({ lastRun: new Date(0).toISOString(), status: 'ok' })
    const { result } = renderHook(() => useBackupPolling('my-project', vi.fn()))
    act(() => { result.current.start() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(result.current.elapsedSecs).toBe(3)
  })

  it('resets elapsedSecs to 0 after abort()', async () => {
    vi.mocked(api.getBackupStatus).mockResolvedValue({ lastRun: new Date(0).toISOString(), status: 'ok' })
    const { result } = renderHook(() => useBackupPolling('my-project', vi.fn()))
    act(() => { result.current.start() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    act(() => { result.current.abort() })
    expect(result.current.runningBackup).toBe(false)
    expect(result.current.elapsedSecs).toBe(0)
  })

  it('polls getBackupStatus and resolves complete when newer backup found', async () => {
    // lastRun is 1ms after triggerTime (Date.now() at start()), so the condition triggers.
    vi.mocked(api.getBackupStatus).mockResolvedValue({ lastRun: new Date(Date.now() + 1).toISOString(), status: 'ok' })
    const fetchBackups = vi.fn()
    const { result } = renderHook(() => useBackupPolling('my-project', fetchBackups))
    act(() => { result.current.start() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(result.current.runningBackup).toBe(false)
    expect(result.current.backupResult).toBe('complete')
    expect(fetchBackups).toHaveBeenCalled()
  })

  it('resolves failed when backup status is not ok', async () => {
    vi.mocked(api.getBackupStatus).mockResolvedValue({ lastRun: new Date(Date.now() + 1).toISOString(), status: 'failed' })
    const { result } = renderHook(() => useBackupPolling('my-project', vi.fn()))
    act(() => { result.current.start() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(result.current.backupResult).toBe('failed')
  })

  it('does not complete when backup lastRun is older than triggerTime', async () => {
    // lastRun is in the past (time 0), triggerTime is also 0 — not newer, so no completion
    vi.mocked(api.getBackupStatus).mockResolvedValue({ lastRun: new Date(0).toISOString(), status: 'ok' })
    const fetchBackups = vi.fn()
    const { result } = renderHook(() => useBackupPolling('my-project', fetchBackups))
    act(() => { result.current.start() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result.current.runningBackup).toBe(true)
    expect(fetchBackups).not.toHaveBeenCalled()
  })

  it('sets timeout state after 600 seconds with no completion', async () => {
    vi.mocked(api.getBackupStatus).mockResolvedValue({ lastRun: new Date(0).toISOString(), status: 'ok' })
    const { result } = renderHook(() => useBackupPolling('my-project', vi.fn()))
    act(() => { result.current.start() })
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    expect(result.current.runningBackup).toBe(false)
    expect(result.current.backupResult).toBe('timeout')
  })

  it('abort() stops the running state without setting a result', () => {
    const { result } = renderHook(() => useBackupPolling('my-project', vi.fn()))
    act(() => { result.current.start() })
    act(() => { result.current.abort() })
    expect(result.current.runningBackup).toBe(false)
    expect(result.current.backupResult).toBeNull()
  })

  it('clears intervals on unmount', async () => {
    vi.mocked(api.getBackupStatus).mockResolvedValue({ lastRun: new Date(0).toISOString(), status: 'ok' })
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { result, unmount } = renderHook(() => useBackupPolling('my-project', vi.fn()))
    act(() => { result.current.start() })
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
