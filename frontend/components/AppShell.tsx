'use client'

/**
 * components/AppShell.tsx
 * Casca do app: login (AuthGate), barra lateral verde com a navegação
 * (menu superior no celular), toast e o estado compartilhado entre as
 * páginas (destinos do LinkedIn, atualização da lista de agendados).
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { oauthApi, clearAccessToken, type LinkedInOrganization } from '../services/api'
import AuthGate from './AuthGate'
import { guardaResultadoConexao } from './ConnectionsPanel'
import {
  BrandLogo, Toast, IconHome, IconCreate, IconClock, IconUpload, IconLink, IconMenu, IconClose, IconStories, IconCalendar,
} from './ui'

interface AppContextValue {
  showToast: (msg: string, type: 'success' | 'error') => void
  linkedinOrgs: LinkedInOrganization[]
  scheduledRefreshKey: number
  bumpScheduled: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp precisa estar dentro do AppShell')
  return ctx
}

const NAV = [
  { href: '/', label: 'Início', Icon: IconHome },
  { href: '/criar', label: 'Criar', Icon: IconCreate },
  { href: '/agendados', label: 'Agendados', Icon: IconClock },
  { href: '/calendario', label: 'Calendário', Icon: IconCalendar },
  { href: '/publicar', label: 'Publicar mídia pronta', Icon: IconUpload },
  { href: '/stories', label: 'Stories', Icon: IconStories },
  { href: '/conexoes', label: 'Conexões', Icon: IconLink },
]

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-1">
      {NAV.map(({ href, label, Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link key={href} href={href} onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`relative flex items-center gap-3 px-4 py-3 rounded-brand text-sm font-medium transition-colors
              ${active
                ? 'bg-brand-background/10 text-brand-background'
                : 'text-brand-background/75 hover:bg-brand-background/[0.06] hover:text-brand-background'}`}>
            {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-brand-gold rounded-full"/>}
            <Icon className="w-5 h-5 flex-shrink-0"/>
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function SidebarFooter() {
  return (
    <div className="pt-5 border-t border-brand-background/15">
      <div className="flex items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-background/80 inline-block flex-shrink-0"/>
          <span className="text-xs text-brand-background/75 whitespace-nowrap">Sistema online</span>
        </div>
        <button
          onClick={() => { clearAccessToken(); window.location.reload() }}
          className="text-sm text-brand-background/75 hover:text-brand-background transition-colors underline-offset-4 hover:underline">
          Sair
        </button>
      </div>
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/'
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [scheduledRefreshKey, setScheduledRefreshKey] = useState(0)
  const [linkedinOrgs, setLinkedinOrgs] = useState<LinkedInOrganization[]>([])

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type })
  }, [])
  const bumpScheduled = useCallback(() => setScheduledRefreshKey(k => k + 1), [])

  useEffect(() => {
    // Lista vazia até reconectar o LinkedIn com o escopo w_organization_social
    // -- falha silenciosa por design, não é algo pra interromper a usuária.
    oauthApi.getLinkedInOrganizations()
      .then(r => setLinkedinOrgs(r.organizations))
      .catch(() => {})
  }, [])

  // Volta de um fluxo OAuth: o backend redireciona para "/?oauth=...".
  // Mostra o aviso, guarda o resultado para a tela de Conexões mostrar de
  // forma fixa (o aviso some sozinho) e leva para a página de Conexões.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const plataforma = params.get('oauth')
    if (!plataforma) return
    const sucesso = params.get('status') === 'success'
    const mensagem = params.get('message') || (sucesso ? 'Conta conectada.' : 'Não foi possível conectar. Clique em Conectar de novo.')
    showToast(mensagem, sucesso ? 'success' : 'error')
    guardaResultadoConexao({ plataforma, sucesso, mensagem })
    router.replace('/conexoes')
  }, [router, showToast])

  useEffect(() => { setMenuOpen(false) }, [pathname])

  return (
    <AppContext.Provider value={{ showToast, linkedinOrgs, scheduledRefreshKey, bumpScheduled }}>
      <div className="min-h-screen bg-brand-background">

        {/* Barra lateral (desktop) */}
        <aside className="hidden md:flex fixed inset-y-0 left-0 w-[272px] flex-col bg-brand-primary px-5 py-8 z-20">
          <Link href="/" className="block px-4 mb-8">
            <BrandLogo size={48}/>
            <span className="block font-display font-semibold text-brand-background text-[1.6rem] leading-tight mt-4 whitespace-nowrap">Personal Brand OS</span>
            <span className="block text-xs text-brand-background/70 mt-1">Capital Humano Intelligence</span>
          </Link>
          <span className="block h-px bg-brand-gold/70 mx-4 mb-6"/>
          <div className="flex-1 overflow-y-auto">
            <NavList pathname={pathname}/>
          </div>
          <SidebarFooter/>
        </aside>

        {/* Menu superior (celular) */}
        <header className="md:hidden sticky top-0 z-30 bg-brand-primary">
          <div className="flex items-center justify-between px-5 h-16">
            <Link href="/" className="flex items-center gap-3 min-w-0">
              <BrandLogo size={36}/>
              <span className="font-display font-semibold text-brand-background text-xl truncate">Personal Brand OS</span>
            </Link>
            <button onClick={() => setMenuOpen(o => !o)}
              aria-expanded={menuOpen} aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
              className="text-brand-background w-10 h-10 flex items-center justify-center rounded-brand hover:bg-brand-background/10">
              {menuOpen ? <IconClose/> : <IconMenu/>}
            </button>
          </div>
          {menuOpen && (
            <div className="px-4 pb-5 pt-1 border-t border-brand-background/15">
              <NavList pathname={pathname} onNavigate={() => setMenuOpen(false)}/>
              <div className="mt-4"><SidebarFooter/></div>
            </div>
          )}
        </header>

        {/* Conteúdo */}
        <main className="md:ml-[272px] px-5 sm:px-10 lg:px-14 py-8 md:py-12">
          <div className="max-w-[1040px]">
            {children}
          </div>
        </main>

        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}
      </div>
    </AppContext.Provider>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <Shell>{children}</Shell>
    </AuthGate>
  )
}

/** Cabeçalho padrão de página: título (40 a 48 px) e linha de apoio. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8 md:mb-10">
      <h1 className="page-title">{title}</h1>
      <span className="gold-rule mt-5"/>
      {subtitle && <p className="text-base text-brand-text-muted mt-5 max-w-2xl">{subtitle}</p>}
    </div>
  )
}
