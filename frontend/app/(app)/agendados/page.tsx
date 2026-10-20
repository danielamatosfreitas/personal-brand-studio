'use client'

import { ScheduledPostsPanel } from '../../../components/ScheduledPanel'
import { PageHeader, useApp } from '../../../components/AppShell'

export default function AgendadosPage() {
  const { scheduledRefreshKey } = useApp()
  return (
    <div className="space-y-8">
      <PageHeader title="Agendados"/>
      <ScheduledPostsPanel refreshKey={scheduledRefreshKey}/>
    </div>
  )
}
