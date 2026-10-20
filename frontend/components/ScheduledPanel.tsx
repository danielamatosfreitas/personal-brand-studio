'use client'

import { useState, useEffect, useCallback } from 'react'
import { postsApi, type PostResponse, type PreviaPost } from '../services/api'
import { IconLinkedIn, IconInstagram, IconFacebook, IconSpinner, IconCalendar } from './ui'
import { PainelVer, FormEditar } from './ScheduledPostView'

function IconeRede({ rede, className }: { rede: string; className: string }) {
  return rede === 'linkedin' ? <IconLinkedIn className={className}/>
    : rede === 'facebook' ? <IconFacebook className={className}/> : <IconInstagram className={className}/>
}

// ── Posts agendados ──────────────────────────────────────────────────────────

interface ScheduledPostsPanelProps {
  refreshKey: number
}

export function ScheduledPostsPanel({ refreshKey }: ScheduledPostsPanelProps) {
  const [posts, setPosts] = useState<PostResponse[]>([])
  const [falhasIg, setFalhasIg] = useState<PostResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const fetchScheduled = useCallback(async () => {
    try {
      const list = await postsApi.list('scheduled')
      list.sort((a, b) => new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime())
      setPosts(list)
      // Instagram (Fase 3) e Facebook (Fase 4): post que não saiu fica marcado como falho, com o
      // motivo, e nunca é tentado de novo sozinho.
      const falhos = await postsApi.list('failed')
      setFalhasIg(falhos.filter(p => p.platform === 'instagram' || p.platform === 'facebook').slice(0, 5))
    } catch {
      // backend pode estar iniciando — silencioso, igual ConnectionStatus
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchScheduled() }, [fetchScheduled, refreshKey])

  // Painel aberto: um post por vez, em modo Ver ou Editar.
  const [aberto, setAberto] = useState<{ id: string; modo: 'ver' | 'editar' } | null>(null)
  const [previa, setPrevia] = useState<PreviaPost | null>(null)
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [erroPrevia, setErroPrevia] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ id: string; texto: string } | null>(null)

  const abre = async (id: string, modo: 'ver' | 'editar') => {
    if (aberto?.id === id && aberto.modo === modo) {
      setAberto(null)
      return
    }
    setAberto({ id, modo })
    setAviso(null)
    setErroPrevia(null)
    if (previa?.id === id) return
    setPrevia(null)
    setCarregandoPrevia(true)
    try {
      setPrevia(await postsApi.previa(id))
    } catch (e) {
      setErroPrevia(`Não foi possível abrir o post agora. ${e instanceof Error ? e.message : ''}`.trim())
    } finally {
      setCarregandoPrevia(false)
    }
  }

  const handleSalvo = async (nova: PreviaPost, mensagem: string) => {
    setPrevia(nova)
    setAberto({ id: nova.id, modo: 'ver' })
    setAviso({ id: nova.id, texto: mensagem })
    await fetchScheduled()
  }

  const handleCancel = async (id: string) => {
    setCancelingId(id)
    try {
      await postsApi.cancel(id)
      await fetchScheduled()
    } catch {
      // se falhar, o post continua na lista — a usuária tenta de novo
    } finally {
      setCancelingId(null)
    }
  }

  return (
    <div className="card">
      <h2 className="section-title mb-1">Próximas publicações</h2>
      <p className="text-sm text-brand-text-muted mb-6">Publicação automática, sem precisar estar online.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-brand-text-muted text-sm py-2"><IconSpinner/>Carregando...</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <IconCalendar className="w-5 h-5"/>
          </div>
          <div>
            <p className="text-base font-medium text-brand-text">Nada agendado no momento</p>
            <p className="text-sm text-brand-text-muted mt-1">
              Quando você agendar uma publicação, ela aparece aqui.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-brand-border border-y border-brand-border">
          {posts.map(post => (
            <div key={post.id} className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-brand-primary flex-shrink-0">
                    <IconeRede rede={post.platform} className="w-3.5 h-3.5"/>
                  </span>
                  <span className="text-sm font-medium text-brand-text">
                    {post.scheduled_at
                      ? new Date(post.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                      : 'Sem agendamento'}
                  </span>
                </div>
                <p className="text-sm text-brand-text-muted line-clamp-2 break-words">{post.content.split('\n')[0].slice(0, 80)}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => abre(post.id, 'ver')} aria-expanded={aberto?.id === post.id && aberto.modo === 'ver'}
                  className="btn-outline px-4 py-2 text-sm flex-1 sm:flex-none">
                  {aberto?.id === post.id && aberto.modo === 'ver' ? 'Fechar' : 'Ver'}
                </button>
                <button onClick={() => abre(post.id, 'editar')} aria-expanded={aberto?.id === post.id && aberto.modo === 'editar'}
                  className="btn-outline px-4 py-2 text-sm flex-1 sm:flex-none">
                  Editar
                </button>
                <button onClick={() => handleCancel(post.id)} disabled={cancelingId === post.id}
                  className="btn-outline px-4 py-2 text-sm flex-1 sm:flex-none">
                  {cancelingId === post.id ? 'Cancelando...' : 'Cancelar'}
                </button>
              </div>
            </div>
            {aviso?.id === post.id && (
              <p className="text-sm text-brand-primary mt-3" role="status">{aviso.texto}</p>
            )}
            {aberto?.id === post.id && (
              carregandoPrevia ? (
                <div className="flex items-center gap-2 text-brand-text-muted text-sm py-3"><IconSpinner/>Abrindo o post...</div>
              ) : erroPrevia ? (
                <p className="text-sm text-red-700 mt-3" role="alert">{erroPrevia}</p>
              ) : previa?.id === post.id ? (
                aberto.modo === 'ver'
                  ? <PainelVer previa={previa}/>
                  : <FormEditar previa={previa} onSalvo={handleSalvo} onFechar={() => setAberto(null)}/>
              ) : null
            )}
            </div>
          ))}
        </div>
      )}

      {falhasIg.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-brand-text mb-2">Instagram e Facebook: não publicados</h3>
          <div className="divide-y divide-brand-border border-y border-brand-border">
            {falhasIg.map(post => (
              <div key={post.id} className="py-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-brand-text-muted flex-shrink-0"><IconeRede rede={post.platform} className="w-3.5 h-3.5"/></span>
                  <span className="text-sm text-brand-text-muted">
                    {post.scheduled_at
                      ? new Date(post.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                      : 'Sem agendamento'}
                    {' · '}{post.content.split('\n')[0].slice(0, 60)}
                  </span>
                </div>
                <p className="text-sm text-red-700 break-words" role="status">
                  {(post.error_log || 'Motivo não registrado.').replace(/^\[(Instagram|Facebook)\]\s*/, '')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
