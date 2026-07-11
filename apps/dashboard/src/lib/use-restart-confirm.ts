'use client'
import { useState } from 'react'
import { restartContainer } from '@/lib/api'

interface Params {
  projectName: string
  containerName: string
  showToast: (message: string, variant: 'success' | 'error') => void
  onRefetch?: () => void
}

export function useRestartConfirm({ projectName, containerName, showToast, onRefetch }: Params) {
  const [restarting, setRestarting] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function handleRestart() {
    setConfirming(false)
    setRestarting(true)
    try {
      await restartContainer(projectName, containerName)
      showToast(`Restarted ${containerName}`, 'success')
      onRefetch?.()
    } catch {
      showToast(`Failed to restart ${containerName}`, 'error')
    } finally {
      setRestarting(false)
    }
  }

  return { restarting, confirming, setConfirming, handleRestart }
}
