'use client'

/**
 * components/AuthGate.tsx
 * Tela de login por senha única, protegendo toda a interface.
 *
 * A proteção real está no backend (require_access_token em cada rota) —
 * isso aqui é a experiência de login em cima dela: pede a senha, valida
 * contra o backend, guarda no localStorage se estiver certa, e mostra
 * "senha incorreta" se não. Sem embutir a senha correta em lugar nenhum
 * do código: a única forma de descobrir se está certa é o backend dizer.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { getAccessToken, setAccessToken, clearAccessToken, verifyAccessToken, MODO_DEMO } from '../services/api'
import { BrandLogo } from './ui'

type GateStatus = 'checking' | 'authed' | 'locked'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GateStatus>('checking')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    // Demonstração (npm run demo): sem senha, a API de exemplo responde tudo.
    if (MODO_DEMO) {
      setStatus('authed')
      return
    }
    const stored = getAccessToken()
    if (!stored) {
      setStatus('locked')
      return
    }
    verifyAccessToken(stored).then(result => {
      // Só descarta o token guardado se o backend disse mesmo que é
      // inválido -- falha de rede/CORS não é motivo pra deslogar.
      if (result === 'invalid') clearAccessToken()
      setStatus(result === 'valid' ? 'authed' : 'locked')
    })
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return
    setError('')
    setVerifying(true)
    const result = await verifyAccessToken(password)
    setVerifying(false)
    if (result === 'valid') {
      setAccessToken(password)
      setStatus('authed')
    } else if (result === 'invalid') {
      setError('Senha incorreta.')
    } else {
      setError('Não foi possível conectar ao servidor. Tente de novo em instantes.')
    }
  }

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-background">
        <span className="text-sm text-brand-text-muted">Verificando acesso...</span>
      </div>
    )
  }

  if (status === 'locked') {
    return (
      <div className="min-h-screen grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] bg-brand-background">
        {/* Painel da marca */}
        <div className="bg-brand-primary text-brand-background px-8 py-10 md:px-14 md:py-16 flex flex-col justify-between gap-10">
          <div className="flex items-center gap-3">
            <BrandLogo size={48}/>
            <span className="text-sm text-brand-background/80">Capital Humano Intelligence</span>
          </div>
          <div>
            <h1 className="font-display font-semibold text-display-lg md:text-display-xl text-brand-background">
              Personal Brand Studio
            </h1>
            <span className="block h-px w-14 bg-brand-gold mt-5"/>
            <p className="font-display text-display-sm text-brand-background/90 mt-5 max-w-sm">
              Gente, Cultura &amp; Estratégia
            </p>
          </div>
          <span className="hidden md:block text-xs text-brand-background/70">Daniela Matos</span>
        </div>

        {/* Formulário */}
        <div className="flex items-center justify-center px-6 py-12 md:px-14">
          <form onSubmit={handleSubmit} className="w-full max-w-sm">
            <h2 className="section-title mb-2">Acesso restrito</h2>
            <p className="text-base text-brand-text-muted mb-7">Digite a senha para continuar.</p>

            <label htmlFor="senha" className="field-label">Senha</label>
            <input
              id="senha"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="input mb-4"
            />

            {error && <p role="alert" className="text-sm text-brand-accent-dark mb-4">{error}</p>}

            <button type="submit" disabled={verifying || !password}
              className="btn-primary w-full py-3.5 text-base flex items-center justify-center gap-2">
              {verifying ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
