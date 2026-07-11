import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSettingsSection } from './use-settings-section'

describe('useSettingsSection', () => {
  it('sets saved on success', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useSettingsSection(fn))

    act(() => { result.current[1]() })

    await waitFor(() => {
      expect(result.current[0].saved).toBe(true)
      expect(result.current[0].saving).toBe(false)
      expect(result.current[0].error).toBeNull()
    })
  })

  it('sets error on failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useSettingsSection(fn))

    act(() => { result.current[1]() })

    await waitFor(() => {
      expect(result.current[0].error).toBe('Network error')
      expect(result.current[0].saving).toBe(false)
      expect(result.current[0].saved).toBe(false)
    })
  })

  it('uses "Save failed" fallback when error is not an Error instance', async () => {
    const fn = vi.fn().mockRejectedValue('plain string error')
    const { result } = renderHook(() => useSettingsSection(fn))

    act(() => { result.current[1]() })

    await waitFor(() => {
      expect(result.current[0].error).toBe('Save failed')
    })
  })
})
