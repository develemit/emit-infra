'use client'
import { useState, useEffect } from 'react'
import { getContainerRestarts, type ContainerRestartSeries } from './api'

export function useContainerRestarts(name: string): ContainerRestartSeries {
  const [series, setSeries] = useState<ContainerRestartSeries>({})

  useEffect(() => {
    let cancelled = false
    getContainerRestarts(name).then(result => {
      if (!cancelled) setSeries(result)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [name])

  return series
}
