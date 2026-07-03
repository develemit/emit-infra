'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { getSla, type SlaData } from '@/lib/api'
import { SubPageShell } from '@/components/detail/sub-page-shell'
import { SlaPanel } from '@/components/detail/sla-panel'
import { IncidentPanel } from '@/components/detail/incident-panel'
import { AlertHistoryPanel } from '@/components/detail/alert-history-panel'

export default function ReliabilityPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const [sla, setSla] = useState<SlaData | null>(null)

  useEffect(() => {
    getSla(name).then(setSla).catch(() => {})
  }, [name])

  return (
    <SubPageShell name={name} title="Reliability">
      {sla && <SlaPanel sla={sla} />}
      <IncidentPanel name={name} />
      <AlertHistoryPanel name={name} />
    </SubPageShell>
  )
}
