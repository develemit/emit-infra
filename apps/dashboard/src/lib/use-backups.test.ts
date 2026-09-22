import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBackups } from './use-backups'
import * as api from './api'

vi.mock('./api')

const backup = { key: 'a.dump', sizeBytes: 100, lastModified: new Date().toISOString() }

describe('useBackups deleteBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the row and surfaces an error when the delete fails', async () => {
    vi.mocked(api.listBackups).mockResolvedValue([backup])
    vi.mocked(api.deleteBackup).mockResolvedValue({ ok: false })

    const { result } = renderHook(() => useBackups('myapp'))
    await waitFor(() => expect(result.current.backups).toEqual([backup]))

    await act(async () => { await result.current.deleteBackup('a.dump') })

    expect(result.current.backups).toEqual([backup])
    expect(result.current.deleteError).toBe('Delete failed — check server logs')
  })

  it('keeps the row and surfaces an error when the delete request throws', async () => {
    vi.mocked(api.listBackups).mockResolvedValue([backup])
    vi.mocked(api.deleteBackup).mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useBackups('myapp'))
    await waitFor(() => expect(result.current.backups).toEqual([backup]))

    await act(async () => { await result.current.deleteBackup('a.dump') })

    expect(result.current.backups).toEqual([backup])
    expect(result.current.deleteError).toBe('Delete failed — check server logs')
  })

  it('removes the row after a successful delete', async () => {
    vi.mocked(api.listBackups)
      .mockResolvedValueOnce([backup])
      .mockResolvedValueOnce([])
    vi.mocked(api.deleteBackup).mockResolvedValue({ ok: true })

    const { result } = renderHook(() => useBackups('myapp'))
    await waitFor(() => expect(result.current.backups).toEqual([backup]))

    await act(async () => { await result.current.deleteBackup('a.dump') })

    expect(result.current.backups).toEqual([])
    expect(result.current.deleteError).toBeNull()
  })
})
