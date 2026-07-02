'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { getDiskBreakdown, type DiskCategory } from '@/lib/api'
import { SubPageShell } from '@/components/detail/sub-page-shell'
import { DiskDirsPanel } from '@/components/detail/disk-dirs-panel'
import { DiskBreakdownPanel } from '@/components/detail/disk-breakdown-panel'
import { PgTableSizesPanel } from '@/components/detail/pg-table-sizes-panel'
import { DockerUsage } from '@/components/detail/docker-usage'

export default function StoragePage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const [diskBreakdown, setDiskBreakdown] = useState<DiskCategory[]>([])

  useEffect(() => {
    getDiskBreakdown(name).then(r => setDiskBreakdown(r.categories)).catch(() => {})
  }, [name])

  return (
    <SubPageShell name={name} title="Storage">
      <DiskDirsPanel name={name} />
      <DiskBreakdownPanel categories={diskBreakdown} />
      <PgTableSizesPanel name={name} />
      <DockerUsage projectName={name} onPrune={() => {}} />
    </SubPageShell>
  )
}
