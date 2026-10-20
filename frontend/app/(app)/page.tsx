'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { postsApi, type PostResponse } from '../../services/api'
import { useApp } from '../../components/AppShell'
import { useConnectionStatus } from '../../components/ConnectionsPanel'
import { IconArrow, IconLinkedIn, IconInstagram, IconSpinner } from '../../components/ui'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function firstLine(content: string): string {
  const line = content.split('\n').map(l => l.trim()).find(Boolean) || ''
  return line.length > 90 ? `${line.slice(0, 89)}…` : line
}

function formatDay(iso: string): { day: string; time: string } {
  const d = new Date(iso)
  const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return { day, time }
}

/** Indicador discreto: ponto verde quando tudo está conectado, ponto dourado quando falta algo. */
function ConnectionsIndicator() {
  const { platforms, loading } = useConnectionStatus()
  if (loading || platforms.length === 0) return null

  const pending = platforms.filter(p => !(p.connected && !p.is_expired))
  const ok = pending.length === 0
  const names = pending.map(p => (p.platform === 'linkedin' ? 'LinkedIn' : 'Instagram')).join(' e ')

  return (
    <Link href="/conexoes"
      className="inline-flex items-center gap-2.5 text-sm text-brand-text-muted hover:text-brand-text transition-colors">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ok ? 'bg-brand-primary' : 'bg-brand-gold'}`}/>
      {ok ? 'Conexões em dia' : `Atenção: ${names} precisa de conexão`}
    </Link>
  )
}

function WeekBlock({ refreshKey }: { refreshKey: number }) {
  const [posts, setPosts] = useState<PostResponse[] | null>(null)

  useEffect(() => {
    let alive = true
    postsApi.list('scheduled')
      .then(list => { if (alive) setPosts(list) })
      .catch(() => { if (alive) setPosts([]) })
    return () => { alive = false }
  }, [refreshKey])

  const week = useMemo(() => {
    if (!posts) return []
    const now = Date.now()
    return posts
      .filter(p => p.scheduled_at && new Date(p.scheduled_at).getTime() >= now && new Date(p.scheduled_at).getTime() <= now + WEEK_MS)
      .sort((a, b) => new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime())
  }, [posts])

  return (
    <section className="bg-brand-primary text-brand-background rounded-brand-lg p-7 sm:p-9 order-2 lg:order-1">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h2 className="font-display font-semibold text-display-md text-brand-background">Esta semana</h2>
        {posts && (
          <span className="text-sm text-brand-background/75 whitespace-nowrap">
            {week.length === 1 ? '1 post' : `${week.length} posts`}
          </span>
        )}
      </div>
      <span className="block h-px w-12 bg-brand-gold mb-6"/>

      {posts === null ? (
        <div className="flex items-center gap-2 text-brand-background/75 text-sm py-2"><IconSpinner/>Carregando...</div>
      ) : week.length === 0 ? (
        <div className="py-2">
          <p className="text-base text-brand-background">Nenhum post agendado para os próximos 7 dias.</p>
          <p className="text-sm text-brand-background/75 mt-1">Quando você agendar uma publicação, ela aparece aqui.</p>
        </div>
      ) : (
        <ul className="divide-y divide-brand-background/15 border-y border-brand-background/15">
          {week.slice(0, 6).map(post => {
            const { day, time } = formatDay(post.scheduled_at as string)
            const isLinkedIn = post.platform === 'linkedin'
            return (
              <li key={post.id} className="grid grid-cols-[92px_1fr] sm:grid-cols-[120px_1fr] gap-x-4 py-4">
                <div>
                  <span className="block text-sm font-medium capitalize">{day}</span>
                  <span className="block text-sm text-brand-background/75">{time}</span>
                </div>
                <div className="min-w-0">
                  <span className="flex items-center gap-2 text-sm text-brand-background/80 mb-0.5">
                    {isLinkedIn ? <IconLinkedIn className="w-3.5 h-3.5"/> : <IconInstagram className="w-3.5 h-3.5"/>}
                    {isLinkedIn ? 'LinkedIn' : 'Instagram'}
                  </span>
                  <p className="text-base leading-snug text-brand-background break-words">{firstLine(post.content)}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {week.length > 6 && (
        <p className="text-sm text-brand-background/75 mt-4">e mais {week.length - 6} na semana.</p>
      )}
      <Link href="/agendados"
        className="inline-flex items-center gap-2 mt-6 text-sm font-medium text-brand-background underline underline-offset-4 decoration-brand-gold hover:decoration-brand-background">
        Ver todos os agendados
      </Link>
    </section>
  )
}

export default function InicioPage() {
  const { scheduledRefreshKey } = useApp()

  return (
    <div>
      <div className="mb-10 md:mb-12">
        <h1 className="page-title">Olá, Daniela.</h1>
        <span className="gold-rule mt-5"/>
        <p className="text-base text-brand-text-muted mt-5 max-w-xl">
          Seu sistema de conteúdo estratégico está pronto para trabalhar.
        </p>
        <div className="mt-4"><ConnectionsIndicator/></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 flex flex-col order-2 lg:order-1">
          <WeekBlock refreshKey={scheduledRefreshKey}/>
        </div>

        <Link href="/criar"
          className="lg:col-span-2 order-1 lg:order-2 group flex flex-col justify-between min-h-[220px] lg:min-h-0
                     bg-brand-accent hover:bg-brand-accent-dark transition-colors text-white rounded-brand-lg p-7 sm:p-9">
          <div>
            <h2 className="font-display font-semibold text-display-lg text-white leading-tight">Criar novo conteúdo</h2>
            <p className="text-base text-white mt-4 max-w-xs">
              Descreva o tema e a IA escreve no seu tom de voz.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 mt-8 text-base font-medium">
            Começar
            <IconArrow className="w-5 h-5 transition-transform group-hover:translate-x-1"/>
          </span>
        </Link>
      </div>
    </div>
  )
}
