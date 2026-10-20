'use client'

/**
 * components/CardGenerator.tsx
 * Gerador de cards visuais — Fase 3.3.
 * Capa, conteúdo e quote compartilham a mesma paleta escolhida (CARD_VARIANTS)
 * e o mesmo esqueleto de layout: marca no topo, bloco central centralizado
 * verticalmente no espaço disponível, rodapé embaixo — evita o vazio que
 * sobrava quando o conteúdo só ficava ancorado no topo ou centralizado no
 * cartão inteiro (incluindo a área da marca e do rodapé).
 *
 * EXPORTAÇÃO: feita via /api/export-card (next/og + Satori no servidor).
 * html2canvas removido — bug de "double exposure" de fontes eliminado.
 */

import { useState, useRef, useEffect, useMemo, type ChangeEvent } from 'react'
import { parse as parseFont } from 'opentype.js'
import {
  CardLayoutError, FRAMES, MEASURE_FILES, buildLayoutInput, layoutCard, measurerFromFont, pickTemplate,
  type CardLayout, type MeasureFonts,
} from '../lib/cardLayout'
import { juntaEspacosTexto, layoutGrade } from '../lib/gradeLayout'
import { FAMILIES, ideiaPalette, type FamilyKey, type FamilyPalette } from '../lib/cardPalette'
import { CardImage } from './cardTemplates'
import { mediaApi, postsApi, type Platform } from '../services/api'
import { SEM_TITULO } from './CamposExtras'

// ── Tipos ──────────────────────────────────────────────────────────────────────

/** Formato do card na tela: "grade" é o formato novo (1080x1350, grade
 *  editorial, o mesmo do lote); "quadrado" é o formato antigo (1080x1080),
 *  mantido para refazer peças antigas sem nenhuma mudança. */
export type FormatoCard = 'grade' | 'quadrado'

export interface CardSlide {
  index: number
  total: number
  isCover: boolean
  title: string
  body: string
  /** Etiqueta opcional por peça (ex.: "GAP DA COERÊNCIA"). Sem valor, cada
   *  família usa sua etiqueta padrão (colors.eyebrow) -- hoje só a família
   *  Alerta lê este campo. */
  label?: string
}

interface CardGeneratorProps {
  slides: CardSlide[]
  variant: 'carousel' | 'quote'
  onClose: () => void
  /** Necessários apenas para o botão "Publicar carrossel no LinkedIn". */
  platform?: Platform
  postText?: string
  onToast?: (msg: string, type: 'success' | 'error') => void
  /** URN da Página de empresa escolhida no painel de revisão; undefined = perfil pessoal. */
  linkedinOrgUrn?: string
}

// ── Parser de carrossel ────────────────────────────────────────────────────────

// Ponto único de entrada pra normalização de texto (NFC -- "ê" como um único
// code point, não "e" + acento combinante separado). Nunca corrigir palavra
// por palavra depois que o texto já entrou no card.
function nfc(s: string): string {
  return s.normalize('NFC')
}

export function parseCarouselText(raw: string): CardSlide[] {
  raw = nfc(raw)
  const blocks = raw.split(/---+/).map(b => b.trim()).filter(Boolean)

  return blocks.map((block, i) => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    const firstLine = lines[0] || ''
    const isHeader = /^SLIDE\s+\d+/i.test(firstLine)
    const contentLines = isHeader ? lines.slice(1) : lines

    const titleLine = contentLines.find(l => l.includes('**')) || contentLines[0] || ''
    const title = titleLine.replace(/\*\*?(.*?)\*\*?/g, '$1').trim()

    const body = contentLines
      .filter(l => l !== titleLine)
      .join(' ')
      .replace(/\*\*?(.*?)\*\*?/g, '$1')
      .trim()

    return {
      index: i + 1,
      total: blocks.length,
      isCover: i === 0,
      title: title || `Slide ${i + 1}`,
      body,
    }
  })
}

export function extractQuote(text: string): string {
  text = nfc(text)
  const sentences = text
    .split(/\n+/)[0]
    .trim()
  return sentences || text.slice(0, 140)
}

export function singleCardFromText(text: string): CardSlide[] {
  return [{
    index: 1,
    total: 1,
    isCover: true,
    title: '',
    body: nfc(text),
  }]
}

// ── Identidade visual e templates ─────────────────────────────────────────────
// Paleta (lib/cardPalette.ts), layout (lib/cardLayout.ts) e desenho
// (components/cardTemplates.tsx) são os mesmos módulos que o servidor usa em
// app/api/export-card/route.tsx -- o preview mostra exatamente o PNG final.

export { FAMILIES, ideiaPalette }
export type { FamilyKey, FamilyPalette }

// ── Logo customizada (upload da usuária, salva em base64 no localStorage) ──────

export const LOGO_STORAGE_KEY = 'pb-custom-logo'

export function getStoredLogo(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(LOGO_STORAGE_KEY)
  } catch {
    return null
  }
}

// ── Fontes de medição (os mesmos arquivos do servidor, carregados uma vez) ─────

let measureFontsPromise: Promise<MeasureFonts> | null = null

function loadMeasureFonts(): Promise<MeasureFonts> {
  if (!measureFontsPromise) {
    measureFontsPromise = Promise.all(MEASURE_FILES.map(async file => {
      const res = await fetch(`/fonts/${file}`)
      if (!res.ok) throw new Error(`Fonte não encontrada: /fonts/${file}`)
      return [file, measurerFromFont(parseFont(await res.arrayBuffer()))] as const
    })).then(entries => Object.fromEntries(entries))
  }
  return measureFontsPromise
}

/** Null enquanto carrega -- o preview não desenha o card antes de ter a
 *  medição real (nunca cai de volta numa estimativa que pode estourar). */
export function useMeasureFonts(): MeasureFonts | null {
  const [fonts, setFonts] = useState<MeasureFonts | null>(null)
  useEffect(() => {
    let alive = true
    loadMeasureFonts()
      .then(f => { if (alive) setFonts(f) })
      .catch(err => console.error('[CardGenerator] Falha ao carregar fontes de medição:', err))
    return () => { alive = false }
  }, [])
  return fonts
}

// ── Roteador de slide (preview na tela) ───────────────────────────────────────

// Exportado pra uso em app/dev-preview-slide/ (ferramenta de regressão
// visual, scripts/regressao-visual/) -- renderiza o mesmo componente do
// preview real fora do fluxo normal do app, sem precisar de AuthGate.
export function SlideCanvas({ slide, variant, logo, family, ideiaTone, formato = 'quadrado' }: {
  slide: CardSlide
  variant: 'carousel' | 'quote'
  logo: string | null
  family: FamilyKey
  ideiaTone: 'verde' | 'terracota'
  /** Sem valor: formato antigo (a ferramenta de regressão visual usa assim). */
  formato?: FormatoCard
}) {
  const fonts = useMeasureFonts()
  const colors = family === 'ideia' ? ideiaPalette(ideiaTone) : FAMILIES[family]
  const frame = FRAMES[formato]
  if (!fonts) return <div style={{ width: `${frame.width}px`, height: `${frame.height}px`, backgroundColor: colors.bg }} />

  let layout: CardLayout
  try {
    if (formato === 'grade') {
      // Mesmo caminho do servidor (app/api/export-card/route.tsx, formato "grade").
      const s = {
        ...slide, title: juntaEspacosTexto(slide.title), body: juntaEspacosTexto(slide.body),
        ...(slide.label ? { label: juntaEspacosTexto(slide.label) } : {}),
      }
      layout = layoutGrade({ ...buildLayoutInput(pickTemplate(family, variant, s), s, colors.eyebrow), indice: s.index, total: s.total }, fonts)
    } else {
      layout = layoutCard(buildLayoutInput(pickTemplate(family, variant, slide), slide, colors.eyebrow), fonts)
    }
  } catch (e) {
    if (!(e instanceof CardLayoutError)) throw e
    return (
      <div style={{
        width: `${frame.width}px`, height: `${frame.height}px`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '90px', textAlign: 'center', boxSizing: 'border-box',
        backgroundColor: '#1F1F1D', color: '#F3EEE3', fontFamily: "'DM Sans', sans-serif", fontSize: '30px',
      }}>
        {e.message}
      </div>
    )
  }
  return (
    <CardImage
      layout={layout}
      colors={colors}
      index={slide.index}
      total={slide.total}
      logoSrc={logo || '/images/logo.jpg'}
    />
  )
}

// ── Exportação via API (sem html2canvas) ───────────────────────────────────────

// Formato exato do body enviado a /api/export-card pra um slide -- ponto único
// de montagem, usado tanto pra exportar quanto pra calcular o hash da versão
// final (computeSlidesFingerprint abaixo). Evita que os dois se desalinhem:
// qualquer campo novo que passe a entrar no payload automaticamente entra
// também no hash, sem precisar lembrar de atualizar uma lista de campos à parte.
function buildExportPayload(
  slide: CardSlide, variant: string, logo: string | null, family: FamilyKey, ideiaTone: 'verde' | 'terracota', formato: FormatoCard,
) {
  // Formato antigo: o mesmo corpo de sempre (sem o campo), então o PNG sai
  // idêntico ao de antes desta opção existir.
  return { slide, variant, logo, family, ideiaTone, ...(formato === 'grade' ? { formato: 'grade' } : {}) }
}

// Hash simples (djb2) do payload completo que seria enviado pra cada slide.
// Não precisa ser criptográfico -- só precisa mudar sempre que o payload
// mudar, pra servir de "impressão digital" da versão final gerada. Guardado
// junto com os PNGs da versão final: se o hash atual não bater mais com o
// hash guardado, a versão final está desatualizada (ver finalIsValid).
function djb2Hash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}

function computeSlidesFingerprint(
  slides: CardSlide[], variant: string, logo: string | null, family: FamilyKey, ideiaTone: 'verde' | 'terracota', formato: FormatoCard,
): string {
  const payloads = slides.map(s => buildExportPayload(s, variant, logo, family, ideiaTone, formato))
  return djb2Hash(JSON.stringify(payloads))
}

async function exportViaApi(
  slide: CardSlide, variant: string, logo: string | null, family: FamilyKey, ideiaTone: 'verde' | 'terracota', formato: FormatoCard,
): Promise<Blob> {
  const res = await fetch('/api/export-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildExportPayload(slide, variant, logo, family, ideiaTone, formato)),
  })
  if (!res.ok) {
    // Propaga a mensagem real do servidor (ex.: título não cabe nem no
    // tamanho mínimo) em vez de um erro genérico -- quem chama decide como
    // mostrar pro usuário.
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `Falha ao gerar o card (HTTP ${res.status}).`)
  }
  return res.blob()
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Componente Principal ────────────────────────────────────────────────────────

export default function CardGenerator({
  slides, variant, onClose, platform, postText, onToast, linkedinOrgUrn,
}: CardGeneratorProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [exportingAll, setExportingAll] = useState(false)
  const [publishingLinkedIn, setPublishingLinkedIn] = useState(false)
  const [tituloDocumento, setTituloDocumento] = useState('')
  const [logo, setLogo] = useState<string | null>(() => getStoredLogo())
  const [family, setFamily] = useState<FamilyKey>('diagnostico')
  const [ideiaTone, setIdeiaTone] = useState<'verde' | 'terracota'>('verde')
  // Peças novas saem no formato novo; o antigo fica disponível para refazer peças antigas.
  const [formato, setFormato] = useState<FormatoCard>('grade')
  const frame = FRAMES[formato]

  // Versão final -- PNGs reais do servidor (/api/export-card), gerados sob
  // demanda e guardados aqui. "Publicar" e "Baixar todos" só ficam
  // disponíveis enquanto ela for válida (ver finalIsValid), e usam
  // exatamente esses blobs -- nunca chamam a API de novo.
  const [finalBlobs, setFinalBlobs] = useState<Blob[] | null>(null)
  const [finalUrls, setFinalUrls] = useState<string[] | null>(null)
  const [finalFingerprint, setFinalFingerprint] = useState<string | null>(null)
  const [generatingFinal, setGeneratingFinal] = useState(false)

  // Impressão digital do payload completo que seria enviado a /api/export-card
  // agora mesmo, pra cada slide -- construída pela mesma função que monta o
  // body de verdade (buildExportPayload), então nenhum campo do payload pode
  // ficar de fora por esquecimento (ao contrário de uma lista de dependências
  // do useEffect mantida à mão, que já deixou passar "variant" antes).
  const currentFingerprint = useMemo(
    () => computeSlidesFingerprint(slides, variant, logo, family, ideiaTone, formato),
    [slides, variant, logo, family, ideiaTone, formato],
  )

  // Versão final só é válida se existir E se o hash guardado no momento em
  // que foi gerada ainda bater com o hash do payload atual -- qualquer
  // mudança (texto, etiqueta, família, tom, logo, variant) muda o hash e
  // invalida, mesmo que o campo mudado não estivesse numa lista de deps.
  const finalIsValid = finalBlobs !== null && finalFingerprint === currentFingerprint

  // Descarta a versão final assim que ela deixar de bater com o payload
  // atual -- inclusive libera os object URLs antigos. Roda também na
  // primeira montagem, mas aí é um no-op (finalFingerprint começa null).
  useEffect(() => {
    if (finalFingerprint !== null && finalFingerprint !== currentFingerprint) {
      setFinalBlobs(null)
      setFinalUrls(prev => {
        prev?.forEach(u => URL.revokeObjectURL(u))
        return null
      })
      setFinalFingerprint(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFingerprint])

  // Preview responsivo: o card real tem 1080 px de largura (1080 ou 1350 de
  // altura, conforme o formato); em vez de uma escala
  // fixa (que estourava a largura da tela em celulares menores que ~380px),
  // mede o espaço disponível e calcula a escala certa pra caber nele.
  const previewBoxRef = useRef<HTMLDivElement>(null)
  const [previewSize, setPreviewSize] = useState(0)

  useEffect(() => {
    const el = previewBoxRef.current
    if (!el) return
    const update = () => setPreviewSize(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const handleGenerateFinal = async () => {
    setGeneratingFinal(true)
    // Fixa o hash no valor de agora -- é exatamente o payload que o loop
    // abaixo vai enviar pra cada slide, então é isso que fica guardado como
    // "hash da versão final", não o hash lido depois do loop (que já
    // poderia ter mudado se o usuário editasse algo durante a geração).
    const fingerprintAtGeneration = currentFingerprint
    try {
      const blobs: Blob[] = []
      for (let i = 0; i < slides.length; i++) {
        const blob = await exportViaApi(slides[i], variant, logo, family, ideiaTone, formato)
        blobs.push(blob)
      }
      finalUrls?.forEach(u => URL.revokeObjectURL(u))
      setFinalBlobs(blobs)
      setFinalUrls(blobs.map(b => URL.createObjectURL(b)))
      setFinalFingerprint(fingerprintAtGeneration)
      onToast?.('Versão final gerada. Conferida, agora dá pra publicar/baixar.', 'success')
    } catch (e: unknown) {
      const err = e as Error
      onToast?.(err.message || 'Falha ao gerar a versão final.', 'error')
    } finally {
      setGeneratingFinal(false)
    }
  }

  const currentSlide = slides[currentIndex]

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setLogo(dataUrl)
      try { window.localStorage.setItem(LOGO_STORAGE_KEY, dataUrl) } catch { /* quota cheia: segue só em memória */ }
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveLogo = () => {
    setLogo(null)
    try { window.localStorage.removeItem(LOGO_STORAGE_KEY) } catch { /* noop */ }
  }

  const handleDownloadCurrent = () => {
    if (!finalIsValid || !finalBlobs) return // botão fica desativado nesse caso, isto é só reforço
    triggerDownload(finalBlobs[currentIndex], `capital-humano-slide-${currentSlide.index}.png`)
  }

  const handleDownloadAll = async () => {
    if (!finalIsValid || !finalBlobs) return // botão fica desativado nesse caso, isto é só reforço
    setExportingAll(true)
    try {
      for (let i = 0; i < slides.length; i++) {
        setCurrentIndex(i)
        triggerDownload(finalBlobs[i], `capital-humano-slide-${slides[i].index}.png`)
        // Pequena pausa para o browser processar o download
        await new Promise(r => setTimeout(r, 300))
      }
    } finally {
      setExportingAll(false)
    }
  }

  const handlePublishLinkedIn = async () => {
    if (!postText || !finalIsValid || !finalBlobs) return // botão fica desativado sem versão final, isto é só reforço
    if (!tituloDocumento.trim()) {
      onToast?.(SEM_TITULO, 'error')
      return
    }
    setPublishingLinkedIn(true)
    try {
      // 1. Usa os PNGs da versão final já gerada e aprovada -- não chama
      //    /api/export-card de novo, publica exatamente o que foi conferido.
      const pngBlobs = finalBlobs

      // 2. Sobe pro Supabase Storage e monta o PDF multi-página
      const images_base64 = await Promise.all(pngBlobs.map(blobToBase64))
      const { pdf_url } = await mediaApi.uploadSlides({ images_base64, assemble_pdf: true })
      if (!pdf_url) throw new Error('O backend não retornou a URL do PDF montado.')

      // 3. Cria o post com o PDF em media_urls e publica no LinkedIn (Documents API)
      const post = await postsApi.create({
        platform: 'linkedin', content: postText, media_urls: [pdf_url],
        linkedin_organization_urn: linkedinOrgUrn, titulo_documento: tituloDocumento.trim(),
      })
      const pub = await postsApi.publish(post.id)

      if (pub.success) {
        onToast?.('Carrossel publicado no LinkedIn!', 'success')
      } else {
        onToast?.(pub.message || 'Falha ao publicar o carrossel.', 'error')
      }
    } catch (e: unknown) {
      const err = e as Error
      onToast?.(err.message || 'Falha ao publicar o carrossel no LinkedIn.', 'error')
    } finally {
      setPublishingLinkedIn(false)
    }
  }

  return (
    <div className="card animate-slide-up">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="section-title">Card visual</h2>
          <p className="text-xs text-brand-text-muted mt-0.5">
            {slides.length > 1 ? `Slide ${currentIndex + 1} de ${slides.length}` : 'Pronto para baixar'}
          </p>
        </div>
        <button onClick={onClose}
          className="text-brand-text-light hover:text-brand-text transition-colors w-7 h-7
                     flex items-center justify-center rounded-brand hover:bg-brand-surface-muted">
          ×
        </button>
      </div>

      {/* Logo da marca — usada nos cards no lugar da logo padrão da Capital Humano Intelligence */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3 p-3 rounded-brand bg-brand-surface-muted">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <img src={logo || '/images/logo.jpg'} alt="Logo" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
          <span className="text-xs text-brand-text-muted">
            {logo ? 'Sua logo está sendo usada nos cards.' : 'Sem logo customizada. Os cards usam a logo padrão da Capital Humano Intelligence.'}
          </span>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <label className="btn-outline px-3 py-1.5 text-xs cursor-pointer flex-1 sm:flex-none text-center">
            {logo ? 'Trocar logo' : 'Enviar logo'}
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </label>
          {logo && (
            <button onClick={handleRemoveLogo} className="btn-outline px-3 py-1.5 text-xs flex-1 sm:flex-none">Remover</button>
          )}
        </div>
      </div>

      {/* Formato: novo (grade 1080x1350) por padrão; antigo (1080x1080) para refazer peças antigas */}
      <div className="mb-4">
        <p className="text-xs font-medium text-brand-text-muted uppercase tracking-wide mb-2">
          Formato
        </p>
        <div className="flex gap-2 flex-wrap">
          {([
            ['grade', 'Formato novo (1080x1350)'],
            ['quadrado', 'Formato antigo (1080x1080)'],
          ] as const).map(([valor, rotulo]) => (
            <button
              key={valor}
              onClick={() => setFormato(valor)}
              className="px-3 py-1.5 rounded-brand text-xs font-medium transition-colors"
              style={{
                border: formato === valor ? '1.5px solid #A9822E' : '1.5px solid transparent',
                backgroundColor: formato === valor ? 'rgba(169,130,46,0.08)' : 'transparent',
                color: formato === valor ? '#1F1F1D' : undefined,
              }}
            >
              {rotulo}
            </button>
          ))}
        </div>
        {formato === 'quadrado' && (
          <p className="text-xs text-brand-text-muted mt-2">
            Use o formato antigo só para refazer uma peça antiga. Peças novas saem no formato novo.
          </p>
        )}
      </div>

      {/* Família visual — define paleta, propósito e template do card (dourado é o acento fixo das 4) */}
      <div className="mb-4">
        <p className="text-xs font-medium text-brand-text-muted uppercase tracking-wide mb-2">
          Família visual
        </p>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(FAMILIES) as FamilyKey[]).map(key => {
            const scheme = key === 'ideia' ? ideiaPalette(ideiaTone) : FAMILIES[key]
            const active = key === family
            return (
              <button
                key={key}
                onClick={() => setFamily(key)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-brand text-xs font-medium transition-colors"
                style={{
                  border: active ? `1.5px solid ${scheme.accent}` : '1.5px solid transparent',
                  backgroundColor: active ? 'rgba(169,130,46,0.08)' : 'transparent',
                  color: active ? '#1F1F1D' : undefined,
                }}
              >
                <span style={{
                  width: '16px', height: '16px', borderRadius: '4px',
                  backgroundColor: scheme.bg, border: '1px solid rgba(0,0,0,0.12)',
                  flexShrink: 0,
                }} />
                {scheme.label}
              </button>
            )
          })}
        </div>
        {family === 'ideia' && (
          <div className="flex gap-2 mt-2">
            {(['verde', 'terracota'] as const).map(tone => (
              <button
                key={tone}
                onClick={() => setIdeiaTone(tone)}
                className="px-3 py-1 rounded-brand text-xs font-medium transition-colors"
                style={{
                  border: ideiaTone === tone ? '1.5px solid #A9822E' : '1.5px solid transparent',
                  backgroundColor: ideiaTone === tone ? 'rgba(169,130,46,0.08)' : 'transparent',
                  color: ideiaTone === tone ? '#1F1F1D' : undefined,
                }}
              >
                Fundo {tone === 'verde' ? 'verde' : 'terracota'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Preview em escala reduzida — apenas visual, exportação é feita via API.
          Escala calculada dinamicamente (ver previewSize acima) em vez de fixa,
          pra caber tanto num monitor largo quanto num iPhone SE. */}
      <div className="mb-5 bg-brand-surface-muted rounded-brand-lg p-4 sm:p-6 overflow-hidden">
        <div ref={previewBoxRef} className="w-full max-w-[380px] mx-auto">
          <div style={{ width: previewSize || 1, height: Math.round((previewSize || 1) * frame.height / frame.width), overflow: 'hidden' }}>
            {previewSize > 0 && (
              finalIsValid && finalUrls ? (
                <img
                  src={finalUrls[currentIndex]}
                  alt={`Slide ${currentIndex + 1} (versão final)`}
                  style={{ width: previewSize, height: Math.round(previewSize * frame.height / frame.width), display: 'block' }}
                />
              ) : (
                <div style={{ transform: `scale(${previewSize / frame.width})`, transformOrigin: 'top left' }}>
                  <SlideCanvas slide={currentSlide} variant={variant} logo={logo} family={family} ideiaTone={ideiaTone} formato={formato} />
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <div className="mb-5">
        <button
          onClick={handleGenerateFinal}
          disabled={generatingFinal || exportingAll}
          className="btn-outline w-full flex items-center justify-center gap-2 text-sm"
        >
          {generatingFinal
            ? 'Gerando versão final...'
            : finalIsValid
              ? 'Versão final gerada. Gerar de novo'
              : 'Gerar versão final'}
        </button>
        {finalIsValid && (
          <p className="text-xs text-brand-text-muted mt-2">
            Versão final conferida. Qualquer alteração no card desativa Publicar e Baixar até gerar de novo.
          </p>
        )}
      </div>

      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-2 mb-5">
          <button onClick={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0}
            className="btn-outline px-3 py-1.5 text-xs disabled:opacity-30">← Anterior</button>
          <span className="text-xs text-brand-text-muted px-3 font-mono">{currentIndex + 1} / {slides.length}</span>
          <button onClick={() => setCurrentIndex(i => Math.min(slides.length - 1, i + 1))} disabled={currentIndex === slides.length - 1}
            className="btn-outline px-3 py-1.5 text-xs disabled:opacity-30">Próximo →</button>
        </div>
      )}

      {slides.length > 1 && platform === 'linkedin' && postText && (
        <div className="mb-4">
          <label className="field-label">Título do documento (PDF no LinkedIn)</label>
          <input value={tituloDocumento} onChange={e => setTituloDocumento(e.target.value)} maxLength={200}
            placeholder="Ex.: Quando tudo passa pelo dono" className="input"/>
          <p className="text-xs text-brand-text-muted mt-1">Obrigatório para publicar o carrossel. O app não usa a legenda como título.</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={handleDownloadCurrent} disabled={exportingAll || !finalIsValid} className="btn-outline flex items-center justify-center gap-2">
          {`Baixar ${slides.length > 1 ? 'este slide' : 'card'}`}
        </button>
        {slides.length > 1 && (
          <button onClick={handleDownloadAll} disabled={exportingAll || !finalIsValid} className="btn-accent flex items-center justify-center gap-2">
            {exportingAll ? `Gerando ${currentIndex + 1}/${slides.length}...` : `Baixar todos (${slides.length})`}
          </button>
        )}
        {slides.length > 1 && platform === 'linkedin' && postText && (
          <button onClick={handlePublishLinkedIn}
            disabled={exportingAll || publishingLinkedIn || !finalIsValid}
            className="btn-accent flex items-center justify-center gap-2">
            {publishingLinkedIn ? 'Publicando no LinkedIn...' : 'Publicar carrossel no LinkedIn'}
          </button>
        )}
      </div>

      {slides.length > 1 && (
        <p className="text-xs text-brand-text-muted mt-3">
          {platform === 'linkedin'
            ? 'Baixe os PNGs pra conferir, ou publique direto: a ferramenta monta o PDF e posta como documento no seu LinkedIn.'
            : 'Cada slide baixa como PNG separado, em ordem. Monte o carrossel no app do Instagram fazendo upload das imagens na sequência numerada.'}
        </p>
      )}
    </div>
  )
}
