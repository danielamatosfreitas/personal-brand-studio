'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  oauthApi, type OAuthStatusItem, type LinkedInOrganization, type ContaInstagram, type ContaFacebook, type Platform,
} from '../services/api'
import { IconLinkedIn, IconInstagram, IconFacebook, IconSpinner, IconCheck } from './ui'

/** Lê o status das plataformas conectadas. Falha silenciosa (o backend pode estar iniciando). */
export function useConnectionStatus() {
  const [platforms, setPlatforms] = useState<OAuthStatusItem[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await oauthApi.getStatus()
      setPlatforms(r.platforms)
    } catch {
      // silencioso: backend pode estar iniciando
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { platforms, loading, refresh }
}

// Resultado da última volta da tela da rede (Meta, LinkedIn), guardado na
// sessão do navegador para ficar visível em Conexões até a próxima tentativa.
export interface ResultadoConexao { plataforma: string; sucesso: boolean; mensagem: string }
const CHAVE_RESULTADO = 'pb-resultado-conexao'
const EVENTO_RESULTADO = 'pb-resultado-conexao'

export function guardaResultadoConexao(r: ResultadoConexao) {
  try { sessionStorage.setItem(CHAVE_RESULTADO, JSON.stringify(r)) } catch { /* sem sessionStorage: fica só o aviso */ }
  window.dispatchEvent(new CustomEvent(EVENTO_RESULTADO, { detail: r }))
}

function leResultadoConexao(): ResultadoConexao | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(CHAVE_RESULTADO) || 'null')
    return r && typeof r.mensagem === 'string' && typeof r.plataforma === 'string' ? r : null
  } catch {
    return null
  }
}

function limpaResultadoConexao() {
  try { sessionStorage.removeItem(CHAVE_RESULTADO) } catch { /* nada a limpar */ }
}

interface ConnectionStatusProps {
  linkedinOrgs: LinkedInOrganization[]
}

export function ConnectionStatus({ linkedinOrgs }: ConnectionStatusProps) {
  const { platforms, loading } = useConnectionStatus()
  const [conectando, setConectando] = useState<Platform | null>(null)
  const [erroConexao, setErroConexao] = useState<string | null>(null)
  const [contaIg, setContaIg] = useState<ContaInstagram | null>(null)
  const [contaFb, setContaFb] = useState<ContaFacebook | null>(null)
  const [resultado, setResultado] = useState<ResultadoConexao | null>(null)

  useEffect(() => {
    setResultado(leResultadoConexao())
    const novo = (e: Event) => setResultado((e as CustomEvent<ResultadoConexao>).detail)
    window.addEventListener(EVENTO_RESULTADO, novo)
    return () => window.removeEventListener(EVENTO_RESULTADO, novo)
  }, [])

  // Instagram conectado: confere com o próprio Instagram qual é a conta.
  const igConectado = platforms.some(p => p.platform === 'instagram' && p.connected && !p.is_expired)
  useEffect(() => {
    if (!igConectado) return
    oauthApi.getContaInstagram().then(setContaIg).catch(() => setContaIg(null))
  }, [igConectado])

  // Facebook conectado (Fase 4): confere com o Facebook qual é a página.
  const fbConectado = platforms.some(p => p.platform === 'facebook' && p.connected && !p.is_expired)
  useEffect(() => {
    if (!fbConectado) return
    oauthApi.getContaFacebook().then(setContaFb).catch(() => setContaFb(null))
  }, [fbConectado])

  const handleConnect = async (platform: Platform) => {
    setErroConexao(null)
    limpaResultadoConexao()
    setResultado(null)
    setConectando(platform)
    try {
      const { url } = await oauthApi.iniciarConexao(platform)
      window.location.href = url
    } catch (e) {
      setConectando(null)
      setErroConexao(`Não foi possível iniciar a conexão agora. ${e instanceof Error ? e.message : ''}`.trim())
    }
  }

  const getPlatformInfo = (item: OAuthStatusItem) => {
    if (item.platform === 'linkedin') return { icon: <IconLinkedIn className="w-5 h-5"/>, label: 'LinkedIn' }
    if (item.platform === 'facebook') return { icon: <IconFacebook className="w-5 h-5"/>, label: 'Facebook (página)' }
    return { icon: <IconInstagram className="w-5 h-5"/>, label: 'Instagram' }
  }

  return (
    <div className="card">
      <h2 className="section-title mb-1">Plataformas autorizadas</h2>
      <p className="text-sm text-brand-text-muted mb-6">
        Contas com permissão para publicar em seu nome.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-brand-text-muted text-sm py-2">
          <IconSpinner/>Verificando...
        </div>
      ) : platforms.length === 0 ? (
        <p className="text-sm text-brand-text-muted">
          Não foi possível ler o status agora. Tente recarregar a página em instantes.
        </p>
      ) : (
        <div className="divide-y divide-brand-border border-y border-brand-border">
          {platforms.map(item => {
            const { icon, label } = getPlatformInfo(item)
            const isConnected = item.connected && !item.is_expired
            const showOrgs = item.platform === 'linkedin' && isConnected && linkedinOrgs.length > 0

            return (
              <div key={item.platform} className="py-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={isConnected ? 'text-brand-primary' : 'text-brand-text-muted'}>
                      {icon}
                    </span>
                    <span className="text-base font-medium text-brand-text">{label}</span>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {isConnected ? (
                      <span className="badge-connected"><IconCheck/>Conectado</span>
                    ) : (
                      <span className={item.is_expired ? 'badge-expired' : 'badge-disconnected'}>
                        {item.is_expired ? 'Autorização expirada' : 'Não conectado'}
                      </span>
                    )}
                    <button
                      onClick={() => handleConnect(item.platform)}
                      disabled={conectando !== null}
                      className="btn-outline px-4 py-2 text-sm whitespace-nowrap"
                      title={isConnected ? 'Refazer a autorização. Útil depois de um escopo novo, por exemplo.' : undefined}
                    >
                      {conectando === item.platform ? 'Abrindo...' : isConnected ? 'Reconectar' : item.is_expired ? 'Reconectar' : 'Conectar'}
                    </button>
                  </div>
                </div>

                {item.platform === 'instagram' && isConnected && contaIg && (
                  <p className="text-sm text-brand-text-muted mt-3 pl-8">
                    {contaIg.conta
                      ? `Conta: @${contaIg.conta}${contaIg.pode_publicar ? ' · pode publicar' : ''}`
                      : ''}
                    {contaIg.motivo ? `${contaIg.conta ? ' · ' : ''}${contaIg.motivo}` : ''}
                  </p>
                )}

                {item.platform === 'facebook' && isConnected && contaFb && (
                  <p className="text-sm text-brand-text-muted mt-3 pl-8">
                    {contaFb.pagina ? `Página conectada: ${contaFb.pagina}${contaFb.pagina_certa ? ' · única Página onde o app publica' : ''}` : ''}
                    {contaFb.motivo ? `${contaFb.pagina ? ' · ' : ''}${contaFb.motivo}` : ''}
                  </p>
                )}

                {resultado && resultado.plataforma === item.platform && !(resultado.sucesso && isConnected && item.platform === 'facebook' && contaFb?.pagina) && (
                  <p className={`text-sm mt-3 pl-8 ${resultado.sucesso ? 'text-brand-primary' : 'text-red-700'}`} role="status">
                    {resultado.sucesso ? resultado.mensagem : `Não foi possível conectar: ${resultado.mensagem}`}
                  </p>
                )}

                {showOrgs && (
                  <p className="text-sm text-brand-text-muted mt-3 pl-8">
                    Páginas disponíveis: {linkedinOrgs.map(o => o.name).join(', ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
      {erroConexao && (
        <p className="text-sm text-red-700 mt-4" role="alert">{erroConexao}</p>
      )}
    </div>
  )
}
