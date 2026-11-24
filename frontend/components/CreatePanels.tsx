'use client'

import { useState } from 'react'
import {
  aiApi, postsApi,
  type Platform, type FormatType, type GeneratePostResponse, type LinkedInOrganization,
} from '../services/api'
import CardGenerator, { parseCarouselText, singleCardFromText } from './CardGenerator'
import { IconSpinner, IconCheck, LinkedInDestinationField } from './ui'
import { CamposExtras, EXTRAS_VAZIOS, extrasParaCriar, type ValoresExtras } from './CamposExtras'

// ── Painel de Revisão ──────────────────────────────────────────────────────────

interface ReviewPanelProps {
  result: GeneratePostResponse
  onClose: () => void
  onToast: (msg: string, type: 'success' | 'error') => void
  onScheduled?: () => void
  linkedinOrgs: LinkedInOrganization[]
}

export function ReviewPanel({ result, onClose, onToast, onScheduled, linkedinOrgs }: ReviewPanelProps) {
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [text, setText] = useState(result.generated_text)
  const [savedPostId, setSavedPostId] = useState<string | null>(null)
  const [showCardGenerator, setShowCardGenerator] = useState(false)
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [linkedinDestination, setLinkedinDestination] = useState('') // '' = perfil pessoal
  const [extras, setExtras] = useState<ValoresExtras>(EXTRAS_VAZIOS)

  const orgUrn = linkedinDestination || undefined
  // Post de texto: sem PDF, então sem título do documento.
  const extrasPost = extrasParaCriar(extras, false)

  const handleSaveDraft = async () => {
    setSaving(true)
    try {
      const post = await postsApi.create({ platform: result.platform, content: text, linkedin_organization_urn: orgUrn, ...extrasPost })
      setSavedPostId(post.id)
      onToast('Rascunho salvo com sucesso.', 'success')
    } catch (e: unknown) {
      const err = e as Error
      onToast(err.message || 'Erro ao salvar rascunho.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    setPublishing(true)
    try {
      let postId = savedPostId
      if (!postId) {
        const post = await postsApi.create({ platform: result.platform, content: text, linkedin_organization_urn: orgUrn, ...extrasPost })
        postId = post.id
        setSavedPostId(postId)
      }
      const pub = await postsApi.publish(postId)
      if (pub.success) {
        onToast('Post publicado com sucesso!', 'success')
      } else {
        onToast(pub.message || 'Erro ao publicar.', 'error')
      }
    } catch (e: unknown) {
      const err = e as Error
      onToast(err.message || 'Erro ao publicar. Verifique se o LinkedIn está conectado.', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const handleSchedule = async () => {
    if (!scheduledAt) {
      onToast('Escolha data e hora do agendamento.', 'error')
      return
    }
    const iso = new Date(scheduledAt).toISOString()
    if (new Date(iso).getTime() <= Date.now()) {
      onToast('Escolha uma data e hora no futuro.', 'error')
      return
    }
    setPublishing(true)
    try {
      const post = await postsApi.create({ platform: result.platform, content: text, scheduled_at: iso, linkedin_organization_urn: orgUrn, ...extrasPost })
      setSavedPostId(post.id)
      onToast(`Agendado para ${new Date(iso).toLocaleString('pt-BR')}.`, 'success')
      onScheduled?.()
    } catch (e: unknown) {
      const err = e as Error
      onToast(err.message || 'Erro ao agendar.', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const platformLabel = result.platform === 'linkedin' ? 'LinkedIn' : 'Instagram'
  const formatLabel = result.format_type === 'carousel' ? 'Carrossel' : 'Texto'

  return (
    <div className="card animate-slide-up">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="section-title">
            Revisar e publicar
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-brand-text-muted">
              {platformLabel} · {formatLabel} · {result.word_count} palavras
            </span>
            {savedPostId && (
              <span className="badge-connected">
                <IconCheck/>Rascunho salvo
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose}
          className="text-brand-text-muted hover:text-brand-text transition-colors w-8 h-8 text-lg
                     flex items-center justify-center rounded-brand hover:bg-brand-surface-muted"
          aria-label="Fechar">
          ×
        </button>
      </div>

      {/* Área de edição */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={result.format_type === 'carousel' ? 18 : 12}
        className="input resize-none leading-relaxed mb-5"
      />

      {/* Destino no LinkedIn — perfil pessoal ou Página de empresa */}
      {result.platform === 'linkedin' && (
        <LinkedInDestinationField orgs={linkedinOrgs} value={linkedinDestination} onChange={setLinkedinDestination}/>
      )}

      <CamposExtras valores={extras} onChange={setExtras} usaTitulo={false}/>

      {/* Aviso de carrossel */}
      {result.format_type === 'carousel' && !showCardGenerator && (
        <div className="mb-5 p-4 rounded-brand bg-brand-surface-muted border border-brand-border text-sm text-brand-text-muted">
          Este é o roteiro do carrossel. Gere os cards visuais abaixo, na ordem.
        </div>
      )}

      {/* Gerador de cards visuais */}
      {showCardGenerator && (
        <div className="mb-4">
          <CardGenerator
            slides={
              result.format_type === 'carousel'
                ? parseCarouselText(text)
                : singleCardFromText(text)
            }
            variant={result.format_type === 'carousel' ? 'carousel' : 'quote'}
            onClose={() => setShowCardGenerator(false)}
            platform={result.platform}
            postText={text}
            onToast={onToast}
            linkedinOrgUrn={orgUrn}
          />
        </div>
      )}

      {/* Agendamento — só se aplica ao caminho de publicação direta (texto/legenda) */}
      {result.format_type !== 'carousel' && (
        <label className="flex items-center gap-2.5 mb-4 text-sm text-brand-text-muted cursor-pointer">
          <input type="checkbox" checked={scheduleMode}
            onChange={e => setScheduleMode(e.target.checked)}
            className="rounded w-4 h-4 accent-brand-primary"/>
          Agendar para depois, em vez de publicar agora
        </label>
      )}
      {result.format_type !== 'carousel' && scheduleMode && (
        <input type="datetime-local"
          value={scheduledAt}
          onChange={e => setScheduledAt(e.target.value)}
          className="input mb-4 w-full sm:w-auto"/>
      )}

      {/* Ações */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={handleSaveDraft} disabled={saving || publishing}
          className="btn-outline flex items-center justify-center gap-2">
          {saving && <IconSpinner/>}
          {saving ? 'Salvando...' : 'Salvar rascunho'}
        </button>

        <button onClick={() => setShowCardGenerator(s => !s)}
          className="btn-outline flex items-center justify-center gap-2">
          {showCardGenerator ? 'Ocultar cards' : 'Gerar card visual'}
        </button>

        {result.format_type !== 'carousel' && (
          <button onClick={scheduleMode ? handleSchedule : handlePublish} disabled={saving || publishing}
            className="btn-accent flex items-center justify-center gap-2">
            {publishing && <IconSpinner/>}
            {publishing
              ? (scheduleMode ? 'Agendando...' : 'Publicando...')
              : scheduleMode
                ? 'Agendar'
                : result.format_type === 'quote'
                  ? `Salvar legenda (publique a imagem manualmente)`
                  : `Publicar no ${platformLabel}`}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Estúdio de Criação ─────────────────────────────────────────────────────────

interface StudioProps {
  onResult: (r: GeneratePostResponse) => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

export function CreationStudio({ onResult, onToast }: StudioProps) {
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState<Platform>('linkedin')
  const [formatType, setFormatType] = useState<FormatType>('text')
  const [loading, setLoading] = useState(false)

  const handleGenerate = async () => {
    if (!topic.trim() || topic.trim().length < 5) {
      onToast('Descreva o tema com pelo menos 5 caracteres.', 'error')
      return
    }
    setLoading(true)
    try {
      const result = await aiApi.generatePost({ topic, platform, format_type: formatType })
      onResult(result)
    } catch (e: unknown) {
      const err = e as Error
      onToast(err.message || 'Erro ao gerar conteúdo.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const platformHints = {
    linkedin_text: 'Analítico, profundo, âncora em consultoria real. 180 a 280 palavras.',
    linkedin_carousel: 'Roteiro de 3 a 9 slides, a IA decide o tamanho ideal pelo tema.',
    instagram_quote: 'Uma frase de impacto isolada, em card visual escuro.',
    instagram_text: 'Legenda mais longa, "voadora elegante". 70 a 120 palavras.',
    instagram_carousel: 'Roteiro de 3 a 9 slides, tom direto "voadora elegante".',
  }

  const currentHint = platform === 'instagram'
    ? (formatType === 'quote'
        ? platformHints.instagram_quote
        : formatType === 'carousel'
          ? platformHints.instagram_carousel
          : platformHints.instagram_text)
    : (formatType === 'carousel' ? platformHints.linkedin_carousel : platformHints.linkedin_text)

  return (
    <div className="card">
      <h2 className="section-title mb-1">
        Estúdio de criação
      </h2>
      <p className="text-base text-brand-text-muted mb-7 max-w-2xl">
        Descreva o tema e a IA gera o conteúdo no seu tom de voz.
      </p>

      {/* Tema */}
      <div className="mb-5">
        <label className="field-label">
          Tema do post
        </label>
        <textarea
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="Ex.: turnover alto como sintoma de cultura organizacional fraca"
          rows={4}
          className="input resize-none text-base"
          onKeyDown={e => {
            if (e.key === 'Enter' && e.metaKey) handleGenerate()
          }}
        />
      </div>

      {/* Plataforma e formato — coluna única no mobile, lado a lado a partir de 640px */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
        <div>
          <label className="field-label">
            Plataforma
          </label>
          <div className="relative">
            <select value={platform}
              onChange={e => {
                const next = e.target.value as Platform
                setPlatform(next)
                setFormatType(next === 'instagram' ? 'quote' : 'text')
              }}
              className="select pr-8">
              <option value="linkedin">LinkedIn</option>
              <option value="instagram">Instagram</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand-text-muted text-xs">▾</span>
          </div>
        </div>

        <div>
          <label className="field-label">
            Formato
          </label>
          <div className="relative">
            <select value={formatType}
              onChange={e => setFormatType(e.target.value as FormatType)}
              className="select pr-8">
              {platform === 'linkedin' ? (
                <>
                  <option value="text">Texto puro</option>
                  <option value="carousel">Carrossel</option>
                </>
              ) : (
                <>
                  <option value="quote">Card de frase</option>
                  <option value="carousel">Carrossel</option>
                  <option value="text">Legenda longa</option>
                </>
              )}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand-text-muted text-xs">▾</span>
          </div>
        </div>
      </div>

      {/* Hint do formato */}
      <p className="text-sm text-brand-text-muted mb-7">{currentHint}</p>

      {/* Botão */}
      <button onClick={handleGenerate} disabled={loading}
        className="btn-primary w-full sm:w-auto sm:min-w-[260px] flex items-center justify-center gap-2 py-3.5 text-base">
        {loading ? (
          <><IconSpinner/>Gerando conteúdo...</>
        ) : (
          'Gerar com IA →'
        )}
      </button>

      {loading && (
        <p className="text-sm text-brand-text-muted mt-3 animate-pulse">
          A IA está escrevendo no seu tom de voz. Aguarde alguns segundos.
        </p>
      )}
    </div>
  )
}
