'use client'

/**
 * Stories do Instagram: moldura de vaga, stories para empresas e capas de
 * destaque. Cada gerador mostra o preview (mesmo layout e mesmo desenho do
 * servidor) e baixa o PNG de /api/export-story. Nada é publicado.
 */

import { useMemo, useState, type ChangeEvent } from 'react'
import { PageHeader, useApp } from '../../../components/AppShell'
import { useMeasureFonts } from '../../../components/CardGenerator'
import { StoryImage } from '../../../components/storyTemplates'
import { IconSpinner } from '../../../components/ui'
import { CardLayoutError, type MeasureFonts } from '../../../lib/cardLayout'
import {
  EMPRESA_MODELOS, STORY, layoutCapa, layoutEmpresa, layoutMoldura, type IconName, type StoryLayout,
} from '../../../lib/storyLayout'

const LOGO = '/images/logo.jpg'
const MAX_LADO = 1600

type Pedido = Record<string, unknown>

// ── Preview ────────────────────────────────────────────────────────────────────

function StoryPreview({ layout, imageSrc = null, width }: { layout: StoryLayout; imageSrc?: string | null; width: number }) {
  const s = width / STORY.width
  return (
    <div className="relative overflow-hidden rounded-brand border border-brand-border flex-shrink-0"
      style={{ width, height: Math.round(STORY.height * s) }}>
      <div style={{ transform: `scale(${s})`, transformOrigin: 'top left', width: STORY.width, height: STORY.height }}>
        <StoryImage layout={layout} logoSrc={LOGO} imageSrc={imageSrc}/>
      </div>
    </div>
  )
}

/** Como o Instagram mostra a capa: um círculo pequeno com o centro da imagem. */
function CirclePreview({ layout, size }: { layout: StoryLayout; size: number }) {
  const s = size / STORY.width
  return (
    <div className="relative overflow-hidden rounded-full border border-brand-border flex-shrink-0" style={{ width: size, height: size }}>
      <div style={{
        position: 'absolute', left: 0, top: -Math.round((STORY.height * s - size) / 2),
        transform: `scale(${s})`, transformOrigin: 'top left', width: STORY.width, height: STORY.height,
      }}>
        <StoryImage layout={layout} logoSrc={LOGO}/>
      </div>
    </div>
  )
}

function useLayout(fonts: MeasureFonts | null, build: (f: MeasureFonts) => StoryLayout) {
  return useMemo(() => {
    if (!fonts) return { layout: null, erro: null }
    try {
      return { layout: build(fonts), erro: null }
    } catch (e) {
      if (e instanceof CardLayoutError) return { layout: null, erro: e.message }
      throw e
    }
  }, [fonts, build])
}

// ── Download ───────────────────────────────────────────────────────────────────

function useDownload() {
  const { showToast } = useApp()
  const [baixando, setBaixando] = useState<string | null>(null)

  const baixar = async (chave: string, pedido: Pedido, arquivo: string) => {
    setBaixando(chave)
    try {
      const res = await fetch('/api/export-story', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedido),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Erro ${res.status} ao gerar a imagem.`)
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = arquivo
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      showToast((e as Error).message || 'Não foi possível gerar a imagem.', 'error')
    } finally {
      setBaixando(null)
    }
  }
  return { baixar, baixando }
}

function BotaoBaixar({ ocupado, onClick, principal = false, disabled = false }: {
  ocupado: boolean; onClick: () => void; principal?: boolean; disabled?: boolean
}) {
  return (
    <button onClick={onClick} disabled={ocupado || disabled}
      className={`${principal ? 'btn-primary' : 'btn-outline'} flex items-center justify-center gap-2`}>
      {ocupado && <IconSpinner/>}
      {ocupado ? 'Gerando...' : 'Baixar PNG'}
    </button>
  )
}

// ── Imagem enviada ─────────────────────────────────────────────────────────────

interface Imagem { src: string; w: number; h: number; nome: string }

function lerImagem(file: File): Promise<Imagem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
    reader.onload = () => {
      const original = String(reader.result)
      const img = new Image()
      img.onerror = () => reject(new Error('Arquivo de imagem inválido.'))
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight
        // Imagem grande é reduzida antes de enviar (o story tem 900 px de largura útil).
        if (Math.max(w, h) <= MAX_LADO && file.size <= 4 * 1024 * 1024) {
          resolve({ src: original, w, h, nome: file.name })
          return
        }
        const k = MAX_LADO / Math.max(w, h)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * Math.min(1, k))
        canvas.height = Math.round(h * Math.min(1, k))
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Não foi possível processar a imagem.')); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve({ src: canvas.toDataURL('image/jpeg', 0.92), w: canvas.width, h: canvas.height, nome: file.name })
      }
      img.src = original
    }
    reader.readAsDataURL(file)
  })
}

// ── Geradores ──────────────────────────────────────────────────────────────────

function MolduraVaga({ fonts }: { fonts: MeasureFonts | null }) {
  const { showToast } = useApp()
  const { baixar, baixando } = useDownload()
  const [imagem, setImagem] = useState<Imagem | null>(null)

  const build = useMemo(() => (f: MeasureFonts) =>
    layoutMoldura(f, { imgW: imagem?.w || 1080, imgH: imagem?.h || 1350 }), [imagem])
  const { layout, erro } = useLayout(fonts, build)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/\.(png|jpe?g)$/i.test(file.name) && !['image/png', 'image/jpeg'].includes(file.type)) {
      showToast('Envie a imagem do card da vaga em PNG ou JPG.', 'error')
      return
    }
    try {
      setImagem(await lerImagem(file))
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  return (
    <section className="card">
      <h2 className="section-title mb-1">Moldura de vaga</h2>
      <p className="text-base text-brand-text-muted mb-7 max-w-2xl">
        Suba a arte da vaga em qualquer proporção (quadrada, 4:5 ou retrato tipo A4). Ela entra inteira, sem corte e sem nada por cima, centralizada sobre o verde da marca, com o selo &quot;Mural de Vagas&quot; da Capital Humano Intelligence acima dela. Abaixo da arte aparece &quot;Toque no link abaixo para ver mais vagas&quot; e, logo depois, fica o espaço livre para a figurinha de link. O topo e a base do story ficam vazios, porque o Instagram cobre essas faixas.
      </p>
      <div className="flex flex-col md:flex-row gap-8">
        <div className="flex-1 min-w-0 space-y-5">
          <div>
            <span className="field-label">Imagem do card da vaga</span>
            <label className="btn-outline w-full flex items-center justify-center gap-2 cursor-pointer py-3">
              {imagem ? 'Trocar imagem' : 'Escolher PNG ou JPG'}
              <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" className="hidden" onChange={onFile}/>
            </label>
            {imagem && <p className="text-sm text-brand-text-muted mt-2 break-all">{imagem.nome}</p>}
          </div>
          {erro && <p role="alert" className="text-sm text-brand-accent-dark">{erro}</p>}
          <BotaoBaixar principal ocupado={baixando === 'moldura'} disabled={!imagem || !!erro}
            onClick={() => imagem && baixar('moldura', { tipo: 'moldura', imagem: imagem.src, imgW: imagem.w, imgH: imagem.h }, 'story-moldura-vaga.png')}/>
          {!imagem && <p className="text-sm text-brand-text-muted">Escolha a imagem para liberar o download.</p>}
        </div>
        <div className="flex justify-center">
          {layout ? <StoryPreview layout={layout} imageSrc={imagem?.src || null} width={270}/> : <PreviewCarregando width={270}/>}
        </div>
      </div>
    </section>
  )
}

function PreviewCarregando({ width }: { width: number }) {
  return (
    <div className="rounded-brand border border-dashed border-brand-border-strong flex items-center justify-center text-sm text-brand-text-muted"
      style={{ width, height: Math.round(width * STORY.height / STORY.width) }}>
      <IconSpinner/>
    </div>
  )
}

function StoryEmpresa({ fonts, modelo }: { fonts: MeasureFonts | null; modelo: 1 | 2 | 3 }) {
  const { baixar, baixando } = useDownload()
  const build = useMemo(() => (f: MeasureFonts) => layoutEmpresa(f, modelo), [modelo])
  const { layout, erro } = useLayout(fonts, build)
  return (
    <div className="flex flex-col items-center gap-4">
      {layout ? <StoryPreview layout={layout} width={230}/> : <PreviewCarregando width={230}/>}
      {erro && <p role="alert" className="text-sm text-brand-accent-dark">{erro}</p>}
      <span className="text-sm text-brand-text-muted">Modelo {modelo}</span>
      <BotaoBaixar ocupado={baixando === `empresa${modelo}`} disabled={!layout}
        onClick={() => baixar(`empresa${modelo}`, { tipo: 'empresa', modelo }, `story-empresa-${modelo}.png`)}/>
    </div>
  )
}

function CapaDestaque({ icone, nome }: { icone: IconName; nome: string }) {
  const { baixar, baixando } = useDownload()
  const layout = useMemo(() => layoutCapa(icone), [icone])
  return (
    <div className="flex flex-col items-center gap-4">
      <StoryPreview layout={layout} width={190}/>
      <div className="flex items-center gap-3">
        <CirclePreview layout={layout} size={64}/>
        <span className="text-sm text-brand-text-muted">{nome}, como aparece no perfil</span>
      </div>
      <BotaoBaixar ocupado={baixando === icone} onClick={() => baixar(icone, { tipo: 'capa', icone }, `capa-destaque-${icone}.png`)}/>
    </div>
  )
}

export default function StoriesPage() {
  const fonts = useMeasureFonts()
  return (
    <div className="space-y-8">
      <PageHeader title="Stories" subtitle="Gere a imagem, baixe o PNG e publique pelo aplicativo do Instagram, colocando a figurinha de link pelo próprio app."/>
      <MolduraVaga fonts={fonts}/>
      <section className="card">
        <h2 className="section-title mb-1">Stories para empresas</h2>
        <p className="text-base text-brand-text-muted mb-7 max-w-2xl">
          Três modelos com texto fixo e a área livre para a figurinha de link.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {EMPRESA_MODELOS.map((_, i) => <StoryEmpresa key={i} fonts={fonts} modelo={(i + 1) as 1 | 2 | 3}/>)}
        </div>
      </section>
      <section className="card">
        <h2 className="section-title mb-1">Capas de destaque</h2>
        <p className="text-base text-brand-text-muted mb-7 max-w-2xl">
          Ícone grande no centro, legível quando o Instagram reduz a capa a um círculo.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-xl">
          <CapaDestaque icone="vagas" nome="Vagas"/>
          <CapaDestaque icone="empresas" nome="Para empresas"/>
        </div>
      </section>
    </div>
  )
}
