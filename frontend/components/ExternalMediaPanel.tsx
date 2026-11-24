'use client'

import { useState, useEffect, type ChangeEvent } from 'react'
import {
  postsApi, mediaApi,
  type LinkedInOrganization,
} from '../services/api'
import { LinkedInDestinationField } from './ui'
import { CamposExtras, EXTRAS_VAZIOS, SEM_TITULO, extrasParaCriar, type ValoresExtras } from './CamposExtras'
import { NOME_REDE, porRede, redesDe, resumo, soImagens, type Destino, type ResultadoRede } from '../lib/publicarRedes'

// ── Mídia externa (foto ou PDF já prontos, feitos fora do sistema) ─────────────

interface ExternalMediaPanelProps {
  onToast: (msg: string, type: 'success' | 'error') => void
  onScheduled?: () => void
  linkedinOrgs: LinkedInOrganization[]
}

const MAX_GALLERY_IMAGES = 9 // limite do próprio LinkedIn pra post de galeria (multiImage)
const MAX_INSTAGRAM_CARROSSEL = 10 // limite do próprio Instagram pra carrossel (Fase 3)

// Arquivo é opcional no LinkedIn (sem arquivo, o post sai só com o texto, na
// hora ou agendado) e obrigatório no Instagram, que não aceita post sem mídia.
const INSTAGRAM_SEM_ARQUIVO = 'O Instagram não aceita publicação só com texto. Escolha pelo menos uma imagem (JPG ou PNG) para publicar ou agendar no Instagram. No LinkedIn, o post pode sair só com o texto.'
// Facebook (Fase 4): as mesmas peças do Instagram, de 1 a 10 imagens.
const FACEBOOK_SEM_ARQUIVO = 'No Facebook, o app publica as mesmas peças do Instagram: escolha pelo menos uma imagem (JPG ou PNG). No LinkedIn, o post pode sair só com o texto.'

function semImagem(destino: Destino): string {
  return destino === 'facebook' ? FACEBOOK_SEM_ARQUIVO : INSTAGRAM_SEM_ARQUIVO
}

function nomeDestino(destino: Destino): string {
  return redesDe(destino).map(r => NOME_REDE[r]).join(' e ')
}

function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
}

function isVideoFile(f: File): boolean {
  return f.type.startsWith('video/') || /\.(mp4|mov)$/i.test(f.name)
}

export function ExternalMediaPanel({ onToast, onScheduled, linkedinOrgs }: ExternalMediaPanelProps) {
  // "instagram+facebook" cria dois posts independentes (Fase 4).
  const [destino, setDestino] = useState<Destino>('linkedin')
  const imagens = soImagens(destino)
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  // Posts já criados (um por rede), para não duplicar ao salvar e depois publicar.
  const [savedPosts, setSavedPosts] = useState<ResultadoRede[] | null>(null)
  const [busy, setBusy] = useState<'upload' | 'publish' | 'schedule' | null>(null)
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [linkedinDestination, setLinkedinDestination] = useState('') // '' = perfil pessoal

  const hasPdf = files.some(isPdfFile)
  // PDF no LinkedIn sai como documento: o título vem só do campo (19/10).
  const usaTitulo = hasPdf && redesDe(destino).includes('linkedin')
  const [extras, setExtras] = useState<ValoresExtras>(EXTRAS_VAZIOS)
  const hasVideo = files.some(isVideoFile)

  // Gera (e libera) URLs de preview pras miniaturas — PDF não tem preview de imagem.
  useEffect(() => {
    const urls = files.map(f => (isPdfFile(f) ? '' : URL.createObjectURL(f)))
    setPreviewUrls(urls)
    return () => { urls.forEach(u => u && URL.revokeObjectURL(u)) }
  }, [files])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    if (picked.length === 0) return

    for (const f of picked) {
      const okType = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'video/quicktime'].includes(f.type)
      const okExt = /\.(jpe?g|png|pdf|mp4|mov)$/i.test(f.name)
      if (!okType && !okExt) {
        onToast(`"${f.name}" não é JPG, PNG, PDF, MP4 ou MOV.`, 'error')
        return
      }
    }

    // Instagram e Facebook: a ordem das imagens é a ordem dos nomes (slide-01, slide-02...).
    if (imagens) picked.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
    const combined = [...files, ...picked]
    const combinedHasPdf = combined.some(isPdfFile)
    const combinedHasVideo = combined.some(isVideoFile)

    // Vídeo não pode ser combinado com nada — nem foto, nem PDF, nem outro vídeo.
    if (combinedHasVideo && combined.length > 1) {
      onToast('Vídeo não pode ser combinado com outros arquivos no mesmo post. Escolha um vídeo sozinho.', 'error')
      return
    }
    // O LinkedIn não publica PDF junto com fotos no mesmo post — documento é sempre solo.
    if (combinedHasPdf && combined.length > 1) {
      onToast('PDF não pode ser combinado com fotos no mesmo post. Escolha um PDF sozinho, ou só fotos (até 9).', 'error')
      return
    }
    if (imagens && (combinedHasPdf || combinedHasVideo)) {
      onToast(`Por aqui, ${destino === 'instagram+facebook' ? 'o Instagram e o Facebook só aceitam' : `o ${nomeDestino(destino)} só aceita`} foto (JPG ou PNG).`, 'error')
      return
    }
    const maximo = imagens ? MAX_INSTAGRAM_CARROSSEL : MAX_GALLERY_IMAGES
    if (combined.length > maximo) {
      onToast(`Máximo de ${maximo} arquivos por post.`, 'error')
      return
    }

    setFiles(combined)
    setSavedPosts(null) // seleção mudou = post novo, não reaproveita o rascunho anterior
  }

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
    setSavedPosts(null)
  }

  // Cria um post por rede (as imagens sobem uma vez só). Uma rede falhar não
  // impede a outra; devolve o resultado de cada uma.
  const ensurePosts = async (scheduled_at?: string): Promise<ResultadoRede[]> => {
    if (savedPosts && !scheduled_at) return savedPosts
    if (files.length === 0 && imagens) throw new Error(semImagem(destino))
    if (!content.trim()) throw new Error(files.length ? 'Escreva uma legenda antes.' : 'Escreva o texto do post antes.')
    if (usaTitulo && !extras.titulo.trim()) throw new Error(SEM_TITULO)

    setBusy(scheduled_at ? 'schedule' : 'upload')
    try {
      const uploaded = files.length ? await Promise.all(files.map(f => mediaApi.uploadFile(f))) : []
      const media_urls = uploaded.map(u => u.url)
      const criados = await porRede(redesDe(destino), async rede => (await postsApi.create({
        platform: rede, content: content.trim(), media_urls, ...(scheduled_at ? { scheduled_at } : {}),
        linkedin_organization_urn: rede === 'linkedin' ? (linkedinDestination || undefined) : undefined,
        ...extrasParaCriar(extras, rede === 'linkedin' && usaTitulo),
      })).id)
      if (!scheduled_at) setSavedPosts(criados.filter(c => c.ok))
      return criados
    } finally {
      setBusy(null)
    }
  }

  const handleSaveDraft = async () => {
    try {
      const criados = await ensurePosts()
      const aviso = resumo(criados, 'rascunho salvo')
      onToast(criados.length === 1 && criados[0].ok
        ? (files.length ? 'Rascunho salvo com a mídia enviada.' : 'Rascunho salvo, só com o texto.')
        : aviso.texto, aviso.tipo)
    } catch (e: unknown) {
      onToast((e as Error).message || 'Erro ao salvar rascunho.', 'error')
    }
  }

  const handlePublish = async () => {
    setBusy('publish')
    try {
      const criados = await ensurePosts()
      setBusy('publish')
      // Cada rede publica sozinha; a falha de uma não cancela a outra.
      const publicados = await porRede(criados.filter(c => c.ok).map(c => c.rede), async rede => {
        const id = criados.find(c => c.rede === rede)!.id!
        const pub = await postsApi.publish(id)
        if (!pub.success) throw new Error(pub.message || 'Falha ao publicar.')
        return id
      })
      const resultados = criados.map(c => c.ok ? publicados.find(p => p.rede === c.rede)! : c)
      const aviso = resumo(resultados, 'publicado')
      onToast(resultados.length === 1 && resultados[0].ok ? 'Publicado com sucesso!' : aviso.texto, aviso.tipo)
      setSavedPosts(null) // nova tentativa cria post novo; o que já saiu não é publicado de novo
      if (resultados.every(r => r.ok)) {
        setFiles([])
        setContent('')
        setLinkedinDestination('')
        setExtras(EXTRAS_VAZIOS)
      }
    } catch (e: unknown) {
      onToast((e as Error).message || 'Erro ao publicar.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleSchedule = async () => {
    if (files.length === 0 && imagens) { onToast(semImagem(destino), 'error'); return }
    if (!content.trim()) { onToast(files.length ? 'Escreva uma legenda antes.' : 'Escreva o texto do post antes.', 'error'); return }
    if (!scheduledAt) { onToast('Escolha data e hora do agendamento.', 'error'); return }

    const iso = new Date(scheduledAt).toISOString()
    if (new Date(iso).getTime() <= Date.now()) {
      onToast('Escolha uma data e hora no futuro.', 'error')
      return
    }

    try {
      // Um agendamento por rede, cada um com o seu status na fila do app.
      const criados = await ensurePosts(iso)
      const quando = new Date(iso).toLocaleString('pt-BR')
      const aviso = resumo(criados, `agendado para ${quando}`)
      onToast(criados.length === 1 && criados[0].ok ? `Agendado para ${quando}.` : aviso.texto, aviso.tipo)
      if (criados.some(c => c.ok)) onScheduled?.()
      if (criados.every(c => c.ok)) {
        setFiles([])
        setContent('')
        setSavedPosts(null)
        setScheduleMode(false)
        setScheduledAt('')
        setLinkedinDestination('')
        setExtras(EXTRAS_VAZIOS)
      }
    } catch (e: unknown) {
      onToast((e as Error).message || 'Erro ao agendar.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const platformLabel = nomeDestino(destino)

  return (
    <div className="card">
      <p className="text-base text-brand-text-muted mb-7 max-w-2xl">
        Já tem uma foto ou um PDF finalizado em outra ferramenta? Suba direto aqui, sem passar pelo gerador de cards. No LinkedIn, o arquivo é opcional: sem ele, o post sai só com o texto.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="field-label">
            Plataforma
          </label>
          <div className="relative">
            <select value={destino}
              onChange={e => { setDestino(e.target.value as Destino); setSavedPosts(null); setLinkedinDestination('') }}
              className="select pr-8">
              <option value="linkedin">LinkedIn</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="instagram+facebook">Instagram + Facebook</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand-text-muted text-xs">▾</span>
          </div>
        </div>

        <div>
          <label className="field-label">
            {destino === 'linkedin' ? 'Arquivos (opcional)' : 'Imagens (obrigatório)'}
          </label>
          <label className="btn-outline w-full flex items-center justify-center gap-2 cursor-pointer text-sm py-3">
            {files.length > 0 ? 'Adicionar mais' : 'Escolher JPG, PNG, PDF, MP4 ou MOV'}
            <input type="file"
              accept=".jpg,.jpeg,.png,.pdf,.mp4,.mov,image/jpeg,image/png,application/pdf,video/mp4,video/quicktime"
              multiple={imagens || (!hasPdf && !hasVideo)}
              className="hidden" onChange={handleFileChange}/>
          </label>
          {files.length === 0 && (
            <p className="text-sm text-brand-text-muted mt-2">
              {destino === 'linkedin'
                ? 'Sem arquivo, o post sai só com o texto.'
                : destino === 'instagram'
                  ? 'O Instagram não aceita post só com texto: escolha uma imagem, ou de 2 a 10 para um carrossel.'
                  : destino === 'facebook'
                    ? 'Escolha uma imagem, ou de 2 a 10 para um post com várias fotos na página.'
                    : 'Escolha uma imagem, ou de 2 a 10. Saem dois posts independentes, um em cada rede.'}
            </p>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="mb-4">
          {hasVideo ? (
            <div className="relative w-full max-w-xs rounded-brand overflow-hidden border border-brand-border bg-brand-surface-muted">
              <video src={previewUrls[0]} controls className="w-full h-auto block"/>
              <button onClick={() => handleRemoveFile(0)}
                aria-label={`Remover ${files[0].name}`}
                className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none flex items-center justify-center hover:bg-black/80">
                ×
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative w-20 h-20 rounded-brand overflow-hidden border border-brand-border bg-brand-surface-muted flex-shrink-0">
                  {isPdfFile(f) ? (
                    <div className="w-full h-full flex items-center justify-center text-brand-text-muted text-xs font-medium">PDF</div>
                  ) : (
                    <img src={previewUrls[i]} alt="" className="w-full h-full object-cover"/>
                  )}
                  <button onClick={() => handleRemoveFile(i)}
                    aria-label={`Remover ${f.name}`}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none flex items-center justify-center hover:bg-black/80">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-sm text-brand-text-muted mt-2">
            {hasVideo
              ? '1 vídeo'
              : files.length === 1
                ? (hasPdf ? '1 documento' : '1 imagem')
                : imagens
                  ? `${files.length} imagens (nesta ordem) · máximo ${MAX_INSTAGRAM_CARROSSEL}`
                  : `${files.length} imagens (galeria) · máximo ${MAX_GALLERY_IMAGES}`}
          </p>
        </div>
      )}

      {destino === 'linkedin' && (
        <LinkedInDestinationField orgs={linkedinOrgs} value={linkedinDestination} onChange={setLinkedinDestination}/>
      )}

      <div className="mb-6">
        <label className="field-label">
          Legenda / texto do post
        </label>
        <textarea
          value={content}
          onChange={e => { setContent(e.target.value); setSavedPosts(null) }}
          placeholder="Escreva o texto que acompanha a publicação..."
          rows={5}
          className="input resize-none text-base"
        />
      </div>

      <CamposExtras valores={extras} onChange={v => { setExtras(v); setSavedPosts(null) }} usaTitulo={usaTitulo}/>

      <label className="flex items-center gap-2.5 mb-4 text-sm text-brand-text-muted cursor-pointer">
        <input type="checkbox" checked={scheduleMode}
          onChange={e => setScheduleMode(e.target.checked)}
          className="rounded w-4 h-4 accent-brand-primary"/>
        Agendar para depois, em vez de publicar agora
      </label>
      {scheduleMode && (
        <input type="datetime-local"
          value={scheduledAt}
          onChange={e => setScheduledAt(e.target.value)}
          className="input mb-4 w-full sm:w-auto"/>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={handleSaveDraft} disabled={busy !== null}
          className="btn-outline flex items-center justify-center gap-2">
          {busy === 'upload' ? 'Enviando...' : 'Salvar rascunho'}
        </button>
        <button onClick={scheduleMode ? handleSchedule : handlePublish} disabled={busy !== null}
          className="btn-accent flex items-center justify-center gap-2">
          {busy
            ? (scheduleMode ? 'Agendando...' : 'Publicando...')
            : scheduleMode
              ? 'Agendar'
              : `Publicar no ${platformLabel}`}
        </button>
      </div>
    </div>
  )
}
