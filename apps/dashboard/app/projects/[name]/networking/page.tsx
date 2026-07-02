'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { getNginxEndpoints, type NginxEndpointsData } from '@/lib/api'
import { useServerMetrics } from '@/lib/use-server-metrics'
import { useDeployMarkers } from '@/lib/use-deploy-markers'
import type { DeployMarker } from '@/components/detail/resource-chart'
import { SubPageShell } from '@/components/detail/sub-page-shell'
import { ResponseTimePanel } from '@/components/detail/response-time-panel'
import { NginxEndpointsPanel } from '@/components/detail/nginx-endpoints-panel'
import { CertPanel } from '@/components/detail/cert-panel'
import { NetworkChart } from '@/components/detail/network-chart'
import { QueueChart } from '@/components/detail/queue-chart'

export default function NetworkingPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const { points: serverPoints, loading: metricsLoading } = useServerMetrics(name, 24)
  const { deploys } = useDeployMarkers(name)
  const [nginxEndpoints, setNginxEndpoints] = useState<NginxEndpointsData | null>(null)
  const [nginxSettled, setNginxSettled] = useState(false)

  useEffect(() => {
    getNginxEndpoints(name)
      .then(setNginxEndpoints)
      .catch(() => {})
      .finally(() => setNginxSettled(true))
  }, [name])

  const loading = metricsLoading || !nginxSettled

  const networkPoints = serverPoints.length >= 2
    ? serverPoints.map(p => ({ t: p.t * 1000, netRxBytes: p.netRxBytes, netTxBytes: p.netTxBytes }))
    : []
  const deployMarkers: DeployMarker[] = deploys.map(d => ({
    completedAt: d.completedAt, sha: d.sha, status: d.status,
  }))

  if (loading) {
    return (
      <SubPageShell name={name} title="Networking">
        <div className="h-[180px] rounded-xl bg-card border border-border animate-pulse" />
        <div className="h-[180px] rounded-xl bg-card border border-border animate-pulse" />
      </SubPageShell>
    )
  }

  return (
    <SubPageShell name={name} title="Networking">
      <ResponseTimePanel name={name} />
      {nginxEndpoints && (
        <NginxEndpointsPanel
          available={nginxEndpoints.available}
          endpoints={nginxEndpoints.available ? nginxEndpoints.endpoints : []}
        />
      )}
      <CertPanel name={name} />
      {networkPoints.length >= 2 && (
        <NetworkChart points={networkPoints} deploys={deployMarkers} hours={24} />
      )}
      {serverPoints.some(p => p.queueFailed != null) && (
        <QueueChart points={serverPoints} />
      )}
    </SubPageShell>
  )
}
