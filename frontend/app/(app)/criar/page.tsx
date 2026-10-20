'use client'

import { useCallback, useState } from 'react'
import type { GeneratePostResponse } from '../../../services/api'
import { CreationStudio, ReviewPanel } from '../../../components/CreatePanels'
import { PageHeader, useApp } from '../../../components/AppShell'

export default function CriarPage() {
  const { showToast, linkedinOrgs, bumpScheduled } = useApp()
  const [result, setResult] = useState<GeneratePostResponse | null>(null)

  const handleResult = useCallback((r: GeneratePostResponse) => {
    setResult(r)
    setTimeout(() => {
      document.getElementById('review-panel')?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }, [])

  return (
    <div className="space-y-8">
      <PageHeader title="Criar"/>
      <CreationStudio onResult={handleResult} onToast={showToast}/>
      {result && (
        <div id="review-panel">
          <ReviewPanel result={result} onClose={() => setResult(null)} onToast={showToast}
            onScheduled={bumpScheduled} linkedinOrgs={linkedinOrgs}/>
        </div>
      )}
    </div>
  )
}
