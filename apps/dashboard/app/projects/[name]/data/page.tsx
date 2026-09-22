'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { getProjects, type ProjectSummary } from '@/lib/api'
import { useBackups } from '@/lib/use-backups'
import { SubPageShell } from '@/components/detail/sub-page-shell'
import { BackupPanel } from '@/components/detail/backup-panel'
import { SecretsPanel } from '@/components/detail/secrets-panel'
import { Icon } from '@/components/icon'
import { PanelState } from '@/components/ui/panel-state'

export default function DataPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const backupsHook = useBackups(name)

  useEffect(() => {
    getProjects().then(ps => setProject(ps.find(p => p.config.name === name) ?? null)).catch(() => {})
  }, [name])

  return (
    <SubPageShell name={name} title="Data &amp; Secrets">
      {project && (
        project.config.postgres?.backupBucket ? (
          <BackupPanel project={project} backups={backupsHook} />
        ) : (
          <div className="rounded-xl border border-border bg-card" style={{ padding: 18 }}>
            <div className="flex items-center gap-2 mb-4">
              <Icon name="database" size={16} style={{ color: 'var(--fg-muted)' }} />
              <span className="text-[13.5px] font-semibold text-fg">Backups</span>
            </div>
            <PanelState kind="not-configured" />
          </div>
        )
      )}
      {project?.config.requiredEnvKeys != null && (
        <SecretsPanel name={name} />
      )}
    </SubPageShell>
  )
}
