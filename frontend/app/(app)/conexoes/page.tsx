'use client'

import { ConnectionStatus } from '../../../components/ConnectionsPanel'
import { PageHeader, useApp } from '../../../components/AppShell'

export default function ConexoesPage() {
  const { linkedinOrgs } = useApp()
  return (
    <div className="space-y-8">
      <PageHeader title="Conexões"/>
      <ConnectionStatus linkedinOrgs={linkedinOrgs}/>
    </div>
  )
}
