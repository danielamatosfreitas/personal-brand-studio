'use client'

import { CalendarioPanel } from '../../../components/CalendarioPanel'
import { PageHeader } from '../../../components/AppShell'

export default function CalendarioPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Calendário"/>
      <CalendarioPanel/>
    </div>
  )
}
