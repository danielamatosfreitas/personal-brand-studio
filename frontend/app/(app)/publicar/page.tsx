'use client'

import { ExternalMediaPanel } from '../../../components/ExternalMediaPanel'
import { PageHeader, useApp } from '../../../components/AppShell'

export default function PublicarPage() {
  const { showToast, linkedinOrgs, bumpScheduled } = useApp()
  return (
    <div className="space-y-8">
      <PageHeader title="Publicar mídia pronta"/>
      <ExternalMediaPanel onToast={showToast} onScheduled={bumpScheduled} linkedinOrgs={linkedinOrgs}/>
    </div>
  )
}
