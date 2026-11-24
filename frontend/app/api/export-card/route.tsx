/**
 * app/api/export-card/route.tsx
 *
 * Gera o card como PNG no servidor usando next/og (Satori → Resvg).
 *
 * O layout inteiro vem de lib/cardLayout.ts (área segura, tamanho do título
 * medido com a fonte real, caixas absolutas de cada linha) e o desenho de
 * components/cardTemplates.tsx -- os mesmos dois módulos que o preview do
 * cliente usa, então servidor e cliente mostram exatamente as mesmas linhas
 * nos mesmos lugares.
 *
 * Fontes: arquivos estáticos próprios em public/fonts/ (EB Garamond e DM
 * Sans), buscados por fetch same-origin, igual ao logo. Cada peso/estilo tem
 * seu próprio arquivo, sem síntese. Histórico: Cormorant Garamond e Cormorant
 * tinham o circunflexo (â/ê/ô) com defeito de desenho em tamanho grande
 * (confirmado com fontTools + 3 renderizadores); EB Garamond, de outra
 * fundição, é a fonte final.
 *
 * Logo: logo customizada enviada pelo cliente (base64) tem prioridade;
 *       senão cai no fetch do próprio domínio (public/images/logo.jpg).
 *
 * Erros: conteúdo que não cabe na área segura (CardLayoutError) volta 422
 * com a mensagem explícita -- o card nunca é gerado estourado.
 */

import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import {
  CardLayoutError, FRAMES, buildLayoutInput, checkSafeArea, layoutCard, pickTemplate, type Formato,
} from '../../../lib/cardLayout'
import { imageFonts, loadAllFonts, loadLogo, loadMeasureFonts } from '../../../lib/ogServer'
import { juntaEspacosTexto, layoutGrade } from '../../../lib/gradeLayout'
import { resolveFamily, toFamilyKey } from '../../../lib/cardPalette'
import { CardImage } from '../../../components/cardTemplates'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

interface CardSlide {
  index: number
  total: number
  isCover: boolean
  title: string
  body: string
  /** Etiqueta opcional por peça (ex.: "GAP DA COERÊNCIA", "EXEMPLO"); sem
   *  ela, a etiqueta padrão da família. */
  label?: string
  /** Endereço na última linha do slide (sem "https://"). */
  endereco?: string
  /** Pílulas explícitas (família Dado). */
  pills?: string[]
  /** Rótulo vindo do Eyebrow (peças no formato novo). */
  rotulo?: string
  /** Sem o número automático do slide de conteúdo. */
  semNumero?: boolean
  /** Assinatura do card de frase. */
  assinatura?: string
  /** Estilo v2 (13/10): peças no formato novo e pilotos. */
  estiloV2?: boolean
  /** Grade editorial: texto do elemento gráfico ("V", "02"); vazio = sem elemento. */
  elemento?: string
}

// Normaliza todo texto que entra no card pra NFC (forma composta -- "ê" como
// um único code point, não "e" + acento combinante separado).
function normalizeSlide(slide: CardSlide): CardSlide {
  return {
    ...slide,
    title: (slide.title || '').normalize('NFC'),
    body: (slide.body || '').normalize('NFC'),
    label: slide.label ? slide.label.normalize('NFC') : slide.label,
    endereco: typeof slide.endereco === 'string' ? slide.endereco.normalize('NFC') : undefined,
    pills: Array.isArray(slide.pills) ? slide.pills.filter(p => typeof p === 'string').map(p => p.normalize('NFC')) : undefined,
    rotulo: typeof slide.rotulo === 'string' && slide.rotulo.trim() ? slide.rotulo.normalize('NFC') : undefined,
    semNumero: slide.semNumero === true ? true : undefined,
    assinatura: typeof slide.assinatura === 'string' && slide.assinatura.trim() ? slide.assinatura.normalize('NFC') : undefined,
    estiloV2: slide.estiloV2 === true ? true : undefined,
    elemento: typeof slide.elemento === 'string' ? slide.elemento.normalize('NFC') : undefined,
  }
}

// Formato novo (grade editorial, 14/10): espaços consecutivos viram um só em
// todos os campos de texto, sem mexer nas quebras de linha.
function juntaEspacos(slide: CardSlide): CardSlide {
  const j = juntaEspacosTexto
  const out: CardSlide = { ...slide, title: j(slide.title), body: j(slide.body) }
  if (typeof slide.label === 'string') out.label = j(slide.label)
  if (typeof slide.endereco === 'string') out.endereco = j(slide.endereco)
  if (Array.isArray(slide.pills)) out.pills = slide.pills.map(j)
  if (typeof slide.rotulo === 'string') out.rotulo = j(slide.rotulo)
  if (typeof slide.assinatura === 'string') out.assinatura = j(slide.assinatura)
  if (typeof slide.elemento === 'string') out.elemento = j(slide.elemento)
  return out
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { slide: rawSlide, variant, logo, family, ideiaTone, formato: rawFormato, destaque, _debug, _semBloco, _soFundo } = (await request.json()) as {
      slide: CardSlide
      variant: string
      logo?: string | null
      family?: string
      ideiaTone?: string
      /** só fora de produção: devolve as caixas calculadas no header X-Card-Layout */
      _debug?: boolean
      /** só fora de produção: desenha só fundo/cabeçalho/rodapé (verificação do lote) */
      _semBloco?: boolean
      /** só fora de produção: desenha só o fundo (verificação do Reel) */
      _soFundo?: boolean
      /** "reel" = cena vertical 1080x1920; "retrato" = 1080x1350; padrão: card quadrado 1080x1080 */
      formato?: string
      /** Ideia: "ultimaSeVarias" não destaca frase única (cenas do Reel) */
      destaque?: string
    }
    const slide = rawFormato === 'grade' ? juntaEspacos(normalizeSlide(rawSlide)) : normalizeSlide(rawSlide)
    const familyKey = toFamilyKey(family)
    const colors = resolveFamily(familyKey, ideiaTone)
    const debugAllowed = process.env.NODE_ENV !== 'production'

    // Logo customizada enviada pelo cliente (upload da usuária, já em base64)
    // tem prioridade sobre o logo padrão do servidor.
    const [fonts, logoSrc, measure] = await Promise.all([
      loadAllFonts(request.url),
      logo ? Promise.resolve(logo) : loadLogo(request.url),
      loadMeasureFonts(request.url),
    ])

    const template = pickTemplate(familyKey, variant, slide)
    const formato: Formato = rawFormato === 'reel' ? 'reel' : rawFormato === 'retrato' ? 'retrato' : rawFormato === 'grade' ? 'grade' : 'quadrado'
    const frame = FRAMES[formato]
    // Grade editorial (teste de 13/10): só com o formato "grade".
    const layout = formato === 'grade'
      ? layoutGrade({
        ...buildLayoutInput(template, slide, colors.eyebrow),
        indice: slide.index, total: slide.total,
        // Elemento só quando pedido (campo "Elemento" ou LOTE_ELEMENTO); número nunca vira elemento.
        ...(slide.elemento !== undefined ? { elemento: slide.elemento } : {}),
      }, measure)
      : layoutCard({
        ...buildLayoutInput(template, slide, colors.eyebrow),
        formato,
        ...(destaque === 'ultimaSeVarias' ? { destaque: 'ultimaSeVarias' as const } : {}),
      }, measure)

    const debugHeaders: Record<string, string> = debugAllowed && _debug
      ? {
        'X-Card-Layout': encodeURIComponent(JSON.stringify({
          safe: frame.safe, uiBand: frame.uiBand, width: frame.width, height: frame.height,
          header: { top: frame.headerTop, h: frame.headerH }, footer: { top: frame.footerTop, h: frame.footerH },
          formato, template: layout.template, block: layout.block, sizes: layout.sizes, grade: layout.grade,
          items: layout.items, problems: checkSafeArea(layout),
        })),
      }
      : {}

    return new ImageResponse(
      <CardImage
        layout={layout}
        colors={colors}
        index={slide.index}
        total={slide.total}
        logoSrc={logoSrc}
        hideBlock={debugAllowed && _semBloco === true}
        hideChrome={debugAllowed && _soFundo === true}
      />,
      {
        width: frame.width,
        height: frame.height,
        headers: debugHeaders,
        fonts: [...imageFonts(fonts)],
      },
    )
  } catch (err) {
    const isLayout = err instanceof CardLayoutError
    if (!isLayout) console.error('[export-card] Erro:', err)
    const message = err instanceof Error ? err.message : 'Falha ao gerar card. Verifique os logs.'
    return new Response(
      JSON.stringify({ error: message }),
      { status: isLayout ? 422 : 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
