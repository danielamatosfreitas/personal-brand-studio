/**
 * lib/cardLayout.ts
 *
 * Motor de layout dos cards (1080×1080) -- fonte única do servidor
 * (app/api/export-card/route.tsx) e do cliente (components/CardGenerator.tsx),
 * que renderizam exatamente as caixas calculadas aqui via
 * components/cardTemplates.tsx (posição absoluta, uma div por linha).
 *
 * Especificação (regra fixa dos templates):
 *   1. Área segura: x de 90 a 990; y do fim do cabeçalho da marca + 40 px ao
 *      início do rodapé − 40 px. O bloco (etiqueta + título + divisor +
 *      subtítulo/resolução) é centralizado verticalmente só dentro dela.
 *   2. Título: EB Garamond 600, entrelinha 1.1, no máximo 5 linhas, no maior
 *      tamanho entre 96 e 52 px que faz o bloco inteiro caber, medido com a
 *      fonte real (advance widths via opentype.js). Se nem 52 px couber,
 *      lança CardLayoutError (o lote lista o slide e falha).
 *   4. Etiqueta: DM Sans 500, caixa alta, tamanho de cada família, 24 px
 *      acima do título.
 *   5. Subtítulo (capa) e resolução (alerta): EB Garamond 500 itálico, entre
 *      32 e 40 px, no máximo 3 linhas.
 *   6. Ideia: manifesto com o mesmo ajuste, entre 44 e 72 px, preenchendo a
 *      área segura; a última frase na cor de destaque.
 * (A regra 3, caixa dos títulos, é aplicada no parser do lote, não aqui.)
 */

export interface MeasurableFont {
  getAdvanceWidth(text: string, fontSize: number): number
  /** Extensão horizontal da tinta, relativa à origem da linha. `left` pode
   *  ser negativo (cauda de itálico, "j") e `right` pode passar do avanço. */
  getInkBounds(text: string, fontSize: number): { left: number; right: number }
  /** Contorno do texto (path SVG) com a linha de base em (x, baseline) e a
   *  caixa da tinta; usado pelo elemento gráfico da grade editorial. */
  contorno?(text: string, fontSize: number, x: number, baseline: number): { d: string; x1: number; y1: number; x2: number; y2: number }
}

/** Subconjunto do Font do opentype.js usado na medição. */
export interface GlyphFont {
  unitsPerEm: number
  charToGlyph(ch: string): unknown
  getKerningValue(left: unknown, right: unknown): number
}

/** Mede glifo a glifo (advance width real + kerning da fonte), sem passar
 *  pelo shaping (GSUB) do opentype.js, que lança erro em lookups que ele não
 *  suporta -- caso das fontes DM Sans ("lookupType 6, substFormat 2").
 *  Ligaduras só estreitam o texto, então medir sem elas é conservador. */
export function measurerFromFont(font: GlyphFont): MeasurableFont {
  type G = { advanceWidth?: number; xMin?: number; xMax?: number }
  // Percorre o texto posicionando cada glifo (avanço + kerning) e devolve o
  // avanço total e a extensão real do desenho (xMin/xMax do contorno) em
  // unidades da fonte.
  const run = (text: string) => {
    let pen = 0
    let left = Infinity
    let right = -Infinity
    let prev: unknown = null
    for (const ch of Array.from(text)) {
      const glyph = font.charToGlyph(ch) as G
      if (prev) pen += font.getKerningValue(prev, glyph)
      if (glyph.xMin !== undefined && glyph.xMax !== undefined) {
        left = Math.min(left, pen + glyph.xMin)
        right = Math.max(right, pen + glyph.xMax)
      }
      pen += glyph.advanceWidth || 0
      prev = glyph
    }
    return { pen, left: left === Infinity ? 0 : left, right: right === -Infinity ? pen : right }
  }
  const scale = (units: number, fontSize: number) => (units * fontSize) / font.unitsPerEm
  return {
    getAdvanceWidth(text: string, fontSize: number): number {
      return scale(run(text).pen, fontSize)
    },
    getInkBounds(text: string, fontSize: number) {
      const r = run(text)
      return { left: scale(r.left, fontSize), right: scale(r.right, fontSize) }
    },
    contorno(text: string, fontSize: number, x: number, baseline: number) {
      // Glifo a glifo (sem shaping), como a medição.
      type P = { toPathData(d?: number): string; getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } }
      type GP = { advanceWidth?: number; getPath(x: number, y: number, size: number): P }
      let pen = x
      let prev: unknown = null
      let d = ''
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
      for (const ch of Array.from(text)) {
        const glyph = font.charToGlyph(ch) as GP
        if (prev) pen += scale(font.getKerningValue(prev, glyph), fontSize)
        const p = glyph.getPath(pen, baseline, fontSize)
        d += p.toPathData(2)
        const b = p.getBoundingBox()
        if (isFinite(b.x1)) { x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2) }
        pen += scale(glyph.advanceWidth || 0, fontSize)
        prev = glyph
      }
      return { d, x1, y1, x2, y2 }
    },
  }
}

// ─── Geometria ────────────────────────────────────────────────────────────────

export const CARD_SIZE = 1080
export const PAD_X = 90
export const PAD_Y = 64
export const HEADER_TOP = PAD_Y
export const HEADER_H = 36
export const FOOTER_H = 20
export const FOOTER_TOP = CARD_SIZE - PAD_Y - FOOTER_H // 996
export const SAFE_GAP = 40

export const SAFE = {
  left: PAD_X,
  right: CARD_SIZE - PAD_X,
  top: HEADER_TOP + HEADER_H + SAFE_GAP,
  bottom: FOOTER_TOP - SAFE_GAP,
}
export const SAFE_W = SAFE.right - SAFE.left // 900
export const SAFE_H = SAFE.bottom - SAFE.top // 816

// ─── Formatos de tela ─────────────────────────────────────────────────────────
// "quadrado" é o card 1080x1080 de sempre (valores acima). "reel" é a cena
// vertical 1080x1920: a interface do Instagram cobre os 250 px do topo e os
// 340 px da base, então NADA (nem cabeçalho nem rodapé) entra nessas faixas.
// As laterais (x = 90 a 990) são as mesmas nos dois formatos.

export type Formato = 'quadrado' | 'reel' | 'retrato' | 'grade'

export interface Frame {
  width: number
  height: number
  headerTop: number
  headerH: number
  footerTop: number
  footerH: number
  safe: { left: number; right: number; top: number; bottom: number }
  /** faixa vertical livre da interface da rede (todo texto, inclusive
   *  cabeçalho e rodapé, precisa ficar dentro dela) */
  uiBand: { top: number; bottom: number }
}

const REEL = { width: 1080, height: 1920, uiTop: 250, uiBottom: 1920 - 340, chromeGap: 14 }
// Retrato 1080x1350 (feed 4:5): mesmo cabeçalho, rodapé e margens do quadrado,
// com mais altura no meio. No perfil, o recorte 3:4 tira 34 px de cada lado,
// dentro das margens de 90 px.
const RETRATO_H = 1350
const RETRATO_FOOTER_TOP = RETRATO_H - PAD_Y - FOOTER_H // 1266
const REEL_HEADER_TOP = REEL.uiTop + REEL.chromeGap // 264
const REEL_FOOTER_TOP = REEL.uiBottom - REEL.chromeGap - FOOTER_H // 1546

export const FRAMES: Record<Formato, Frame> = {
  quadrado: {
    width: CARD_SIZE, height: CARD_SIZE, headerTop: HEADER_TOP, headerH: HEADER_H,
    footerTop: FOOTER_TOP, footerH: FOOTER_H, safe: SAFE, uiBand: { top: 0, bottom: CARD_SIZE },
  },
  reel: {
    width: REEL.width, height: REEL.height, headerTop: REEL_HEADER_TOP, headerH: HEADER_H,
    footerTop: REEL_FOOTER_TOP, footerH: FOOTER_H,
    safe: {
      left: PAD_X, right: REEL.width - PAD_X,
      top: REEL_HEADER_TOP + HEADER_H + SAFE_GAP, // 340
      bottom: REEL_FOOTER_TOP - SAFE_GAP, // 1506
    },
    uiBand: { top: REEL.uiTop, bottom: REEL.uiBottom },
  },
  retrato: {
    width: CARD_SIZE, height: RETRATO_H, headerTop: HEADER_TOP, headerH: HEADER_H,
    footerTop: RETRATO_FOOTER_TOP, footerH: FOOTER_H,
    safe: { left: SAFE.left, right: SAFE.right, top: SAFE.top, bottom: RETRATO_FOOTER_TOP - SAFE_GAP }, // y 140..1226
    uiBand: { top: 0, bottom: RETRATO_H },
  },
  // Grade editorial (teste de 13/10, lib/gradeLayout.ts): 1080x1350, margens de
  // 96 px, cabeçalho de 0 a 200 px, conteúdo de y = 300 a 1230, rodapé como hoje.
  grade: {
    width: CARD_SIZE, height: RETRATO_H, headerTop: 60, headerH: 80,
    footerTop: 1230, footerH: 120, // rodapé da grade: faixa de 1230 a 1350, DM Sans 22 px
    safe: { left: 96, right: CARD_SIZE - 96, top: 300, bottom: 1230 },
    uiBand: { top: 0, bottom: RETRATO_H },
  },
}

// ─── Tipografia por papel ─────────────────────────────────────────────────────
// Cada papel diz a fonte usada pra DESENHAR e o arquivo usado pra MEDIR -- os
// dois têm que ser o mesmo arquivo (scripts/regressao-visual/check-fonts.mjs
// confere contra o que route.tsx registra no ImageResponse).

export const TEXT_ROLES = {
  label: { fontFamily: 'DM Sans', fontWeight: 500, fontStyle: 'normal', file: 'DMSans-500.ttf' },
  number: { fontFamily: 'EB Garamond', fontWeight: 600, fontStyle: 'normal', file: 'EBGaramond-SemiBold.ttf' },
  title: { fontFamily: 'EB Garamond', fontWeight: 600, fontStyle: 'normal', file: 'EBGaramond-SemiBold.ttf' },
  subtitle: { fontFamily: 'EB Garamond', fontWeight: 500, fontStyle: 'italic', file: 'EBGaramond-MediumItalic.ttf' },
  body: { fontFamily: 'DM Sans', fontWeight: 400, fontStyle: 'normal', file: 'DMSans-400.ttf' },
  endereco: { fontFamily: 'DM Sans', fontWeight: 500, fontStyle: 'normal', file: 'DMSans-500.ttf' },
  pill: { fontFamily: 'DM Sans', fontWeight: 500, fontStyle: 'normal', file: 'DMSans-500.ttf' },
  manifesto: { fontFamily: 'EB Garamond', fontWeight: 500, fontStyle: 'normal', file: 'EBGaramond-Medium.ttf' },
} as const

export type TextRole = keyof typeof TEXT_ROLES
export const MEASURE_FILES: string[] = Array.from(new Set(Object.values(TEXT_ROLES).map(r => r.file)))

const TITLE = { max: 96, min: 52, lineHeight: 1.1, maxLines: 5 }
const SUBTITLE = { max: 40, min: 32, lineHeight: 1.35, maxLines: 3 }
const MANIFESTO = { max: 72, min: 44, lineHeight: 1.28, width: 880 }
const LABEL_GAP = 24
/** Endereço: DM Sans 500 em 34 px; só se não couber numa linha, reduz até 30 px. */
const ENDERECO = { px: 34, pxMin: 30, lineHeight: 1.3, gap: 32 }
// Assinatura do card de frase (ex.: "por Daniela Matos"): discreta, logo abaixo da frase.
const ASSINATURA = { px: 30, lineHeight: 1.3, gap: 32 }
// Estilo v2 (decisão de 13/10, só peças no formato novo e pilotos): rótulo de
// 28 px no dourado claro da família (cor "link": #D3AF63 sobre o verde, 4,69:1;
// o dourado #A9822E dá 2,75:1) e convite à ação do último slide em dourado.
const ROTULO_V2 = { px: 28 }
// Capa no estilo v2 (13/10): rótulo e título no alto, 120 px abaixo do
// cabeçalho; subtítulo embaixo, 80 px acima do rodapé; o meio fica livre.
const CAPA_V2 = { respiroTopo: 120, respiroBase: 80, vaoMin: 48 }
const CONVITE = /^(?:Me conta|Comenta|Faça)\b/

/** Último slide (estilo v2): separa do corpo o convite à ação final
 *  (frase que começa com "Me conta", "Comenta" ou "Faça"). */
export function separaConvite(body: string, ultimo?: boolean): { main: string; cta: string } {
  if (!ultimo || !body) return { main: body, cta: '' }
  if (CONVITE.test(body)) return { main: '', cta: body }
  const m = body.match(/^([\s\S]*?[.!?…])\s+((?:Me conta|Comenta|Faça)\b[\s\S]*)$/)
  return m ? { main: m[1].trim(), cta: m[2].trim() } : { main: body, cta: '' }
}
const LABEL_LINE_HEIGHT = 1.2
const PILL = { fontSize: 28, lineHeight: 36, padX: 22, padY: 12, border: 1, gap: 14 }

// Linha com entrelinha < 1.2 pode ter tinta (descendentes) um pouco abaixo da
// caixa da linha; reserva essa folga quando o último elemento do bloco é texto.
const INK_SLACK_RATIO = 0.12

// ─── Tipos de saída ───────────────────────────────────────────────────────────

export type Template = 'capa' | 'conteudo' | 'alerta' | 'dado' | 'ideia'
export type ColorKey = 'text' | 'muted' | 'accent' | 'accentContrast' | 'link' | 'suave'

export interface Box { x: number; y: number; w: number; h: number }
/** Palavra com a posição exata (dx a partir do início da linha), calculada
 *  pela fonte com kerning. Só no formato grade: o Satori reserva para cada
 *  palavra a soma das letras soltas, sem kerning, e a sobra ia para o vão. */
export interface LaidWord { t: string; dx: number }
export interface LaidWords { palavras: LaidWord[]; w: number }
export interface LaidLine extends Box { text: string; palavras?: LaidWord[] }
export interface LaidText {
  kind: 'text'
  role: TextRole
  color: ColorKey
  fontSize: number
  letterSpacingEm?: number
  lines: LaidLine[]
}
export interface LaidRule extends Box { kind: 'rule'; color: 'accent' | 'link' }
export interface LaidPill extends Box { text: string }
export interface LaidPills { kind: 'pills'; fontSize: number; lineHeight: number; pills: LaidPill[] }
/** Grade editorial: número ou letra grande, em contorno vetorial, com opacidade baixa. */
export interface LaidElemento extends Box { kind: 'elemento'; d: string; color: ColorKey; opacity: number }
export type LaidItem = LaidText | LaidRule | LaidPills | LaidElemento

export interface CardLayout {
  template: Template
  formato: Formato
  items: LaidItem[]
  block: Box
  sizes: { title?: number; subtitle?: number; manifesto?: number; corpo?: number }
  /** Grade editorial: onde começa o conteúdo e o elemento gráfico usado. */
  grade?: {
    conteudoTopo: number; elemento: { texto: string; altura: number } | null; elementoOmitido?: string
    /** cabeçalho e rodapé com as palavras posicionadas pela fonte */
    cromo?: { nome: LaidWords; contador?: LaidWords; autora: LaidWords; slogan: LaidWords }
  }
}

export interface LayoutInput {
  template: Template
  title: string
  /** subtítulo (capa), resolução (alerta), corpo (conteúdo/dado) ou manifesto (ideia) */
  body: string
  /** texto da etiqueta (capa/alerta/dado) */
  label: string
  /** número do slide de conteúdo ("01") */
  number: string
  /** tela de destino; padrão "quadrado" */
  formato?: Formato
  /** Ideia: qual trecho vai na cor de destaque. "ultima" (padrão dos cards):
   *  a última frase, ou o texto todo se for frase única. "ultimaSeVarias":
   *  só destaca quando há mais de uma frase (cenas do Reel). */
  destaque?: 'ultima' | 'ultimaSeVarias'
  /** Endereço (sem "https://") na última linha do slide, na cor de link da família. */
  endereco?: string
  /** Dado: pílulas explícitas (ex.: notas por dimensão), além do corpo. */
  pills?: string[]
  /** Rótulo vindo do Eyebrow do .txt (peças no formato novo, desde 13/10):
   *  substitui a etiqueta padrão da família e, no slide de conteúdo, o número. */
  rotulo?: string
  /** Slide de conteúdo sem o número automático (título já começa com número). */
  semNumero?: boolean
  /** Card de frase: assinatura discreta logo abaixo da frase. */
  assinatura?: string
  /** Estilo v2 (13/10): rótulo de 28 px em dourado claro, slide sem título
   *  com o corpo grande em EB Garamond creme, convite final em dourado. */
  estiloV2?: boolean
  /** Último slide do carrossel (para o convite à ação do estilo v2). */
  ultimo?: boolean
}

export class CardLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardLayoutError'
    Object.setPrototypeOf(this, CardLayoutError.prototype)
  }
}

// ─── Entrada ──────────────────────────────────────────────────────────────────

/** Remove a etiqueta numerada ("· C2 #09", ou o código antigo) do fim de textos -- a numeração é
 *  referência interna (calendário, copies), nunca vai pra arte final. */
export function stripChiTag(text: string): string {
  return text.replace(/\s*·\s*[A-Z0-9]{2,4}\s*#\d+\s*$/i, '').trim()
}

export function pickTemplate(
  family: 'diagnostico' | 'alerta' | 'dado' | 'ideia',
  variant: string,
  slide: { isCover: boolean; total: number },
): Template {
  const isPlainSingle = slide.total === 1
  if (family === 'ideia' || variant === 'quote' || (isPlainSingle && variant !== 'carousel')) return 'ideia'
  if (family === 'alerta') return 'alerta'
  if (family === 'dado') return 'dado'
  return slide.isCover ? 'capa' : 'conteudo'
}

export function buildLayoutInput(
  template: Template,
  slide: {
    title: string; body: string; label?: string; index: number; endereco?: string; pills?: string[]
    rotulo?: string; semNumero?: boolean; assinatura?: string; total?: number; estiloV2?: boolean
  },
  eyebrow: string,
): LayoutInput {
  const endereco = (slide.endereco || '').replace(/^https?:\/\//i, '').trim()
  const pills = (slide.pills || []).map(p => p.trim()).filter(Boolean)
  return {
    template,
    title: slide.title || '',
    body: stripChiTag(slide.body || ''),
    // Etiqueta registrada na peça (ex.: "GAP DA COERÊNCIA", "EXEMPLO") vale
    // para qualquer família; sem ela, a etiqueta padrão da família.
    // O rótulo do Eyebrow (formato novo) vale mais que a etiqueta.
    label: slide.rotulo ? slide.rotulo : slide.label ? slide.label : eyebrow,
    number: String(slide.index - 1).padStart(2, '0'),
    ...(endereco ? { endereco } : {}),
    ...(pills.length ? { pills } : {}),
    ...(slide.rotulo ? { rotulo: slide.rotulo } : {}),
    ...(slide.semNumero ? { semNumero: true } : {}),
    ...(slide.assinatura ? { assinatura: slide.assinatura.trim() } : {}),
    ...(slide.estiloV2 ? { estiloV2: true, ...(slide.total && slide.index === slide.total ? { ultimo: true } : {}) } : {}),
  }
}

// ─── Medição ──────────────────────────────────────────────────────────────────

export function textWidth(font: MeasurableFont, text: string, size: number, letterSpacingEm = 0): number {
  const n = Array.from(text).length
  return font.getAdvanceWidth(text, size) + (n > 1 ? letterSpacingEm * size * (n - 1) : 0)
}

/** Quebra gulosa por palavra na largura real; respeita quebras de linha
 *  explícitas. Palavra sozinha maior que a largura fica numa linha própria
 *  (quem chama rejeita esse tamanho via maxWidth). */
const NUMERO = /^\d+(?:[.,]\d+)?%?$/
const NUMERO_COM_PONTUACAO = /^\d+(?:[.,]\d+)?%?[.,;:!?)]*$/
const COMECA_COM_LETRA = /^[A-Za-zÀ-ÖØ-öø-ÿ]/
// Palavras curtas de ligação não são unidade ("8 a 10", "2 e 3").
const NAO_UNIDADE = new Set(['a', 'e', 'o', 'à', 'ao', 'ou', 'de', 'da', 'do', 'em', 'no', 'na', 'por', 'para', 'com', 'que'])

/** Junta as palavras que nunca podem ficar em linhas diferentes (como se
 *  ligadas por espaço que não quebra): o padrão "N de N" ("25 de 45") e um
 *  número com a unidade que vem logo depois ("15 perguntas", "30 minutos").
 *  Um número seguido de pontuação ("2025,") não se liga à palavra seguinte. */
export function unidadesInquebraveis(words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (NUMERO.test(w) && words[i + 1] === 'de' && words[i + 2] && NUMERO_COM_PONTUACAO.test(words[i + 2])) {
      out.push(`${w} de ${words[i + 2]}`)
      i += 2
    } else if (NUMERO.test(w) && words[i + 1] && COMECA_COM_LETRA.test(words[i + 1])
      && !NAO_UNIDADE.has(words[i + 1].toLowerCase().replace(/[.,;:!?]+$/, ''))) {
      out.push(`${w} ${words[i + 1]}`)
      i += 1
    } else out.push(w)
  }
  return out
}

export function wrap(font: MeasurableFont, text: string, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = unidadesInquebraveis(paragraph.split(/\s+/).filter(Boolean))
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (!current || lineRight(font, candidate, size) <= maxWidth) current = candidate
      else {
        out.push(current)
        current = word
      }
    }
    if (current) out.push(current)
  }
  return out
}

/** Onde a linha termina de fato: o maior entre o avanço e a tinta. */
export function lineRight(font: MeasurableFont, text: string, size: number): number {
  return Math.max(font.getAdvanceWidth(text, size), font.getInkBounds(text, size).right)
}

function widest(font: MeasurableFont, lines: string[], size: number): number {
  return lines.reduce((m, l) => Math.max(m, lineRight(font, l, size)), 0)
}

/** Margem de 1 px entre a tinta e a borda esquerda da área segura, pra
 *  absorver o antisserrilhado do rasterizador. */
const INK_PAD = 1
/** Margem à direita: o Satori posiciona glifos com arredondamento próprio e,
 *  numa linha de ~900 px, a tinta chegou 1–2 px além da medição (lote de
 *  29/09, "…conversa com gestor" medida até x=989, tinta em x=990). */
const RIGHT_PAD = 4

/** Recuo comum do parágrafo pra que nenhum glifo com tinta à esquerda da
 *  origem (cauda de "f"/"j" itálico) saia da área segura. */
function inkIndent(font: MeasurableFont, lines: string[], size: number): number {
  const left = lines.reduce((m, l) => Math.min(m, font.getInkBounds(l, size).left), 0)
  return left < 0 ? Math.ceil(-left) + INK_PAD : 0
}

export interface Fitted { lines: string[]; indent: number; fits: boolean }

/** Quebra o texto na largura disponível contando a tinta real dos dois lados:
 *  recuo à esquerda + linha mais larga ≤ maxWidth − RIGHT_PAD. */
export function fitText(font: MeasurableFont, text: string, size: number, maxWidth: number): Fitted {
  const limit = maxWidth - RIGHT_PAD
  let avail = limit
  let result: Fitted = { lines: [], indent: 0, fits: false }
  for (let i = 0; i < 3; i++) {
    const lines = wrap(font, text, size, avail)
    const indent = inkIndent(font, lines, size)
    result = { lines, indent, fits: indent + widest(font, lines, size) <= limit }
    if (result.fits || limit - indent >= avail) break
    avail = limit - indent
  }
  return result
}

// ─── Peças do bloco ───────────────────────────────────────────────────────────

interface Piece {
  h: number
  /** folga de tinta abaixo, se esta peça for a última do bloco */
  inkSlack: number
  place(y: number): LaidItem[]
}

const gap = (h: number): Piece => ({ h, inkSlack: 0, place: () => [] })

const rule = (w: number, h: number): Piece => ({
  h, inkSlack: 0,
  place: y => [{ kind: 'rule', color: 'accent', x: SAFE.left, y, w, h }],
})

function textPiece(
  font: MeasurableFont, role: TextRole, color: ColorKey, size: number, lineHeight: number, lines: string[],
  indent = inkIndent(font, lines, size),
): Piece {
  const lh = Math.round(size * lineHeight)
  return {
    h: lh * lines.length,
    inkSlack: lineHeight < 1.2 ? Math.ceil(size * INK_SLACK_RATIO) : 0,
    place: y => [{
      kind: 'text', role, color, fontSize: size,
      lines: lines.map((text, i) => ({
        text, x: SAFE.left + indent, y: y + i * lh, w: Math.ceil(lineRight(font, text, size)), h: lh,
      })),
    }],
  }
}

function labelPiece(
  font: MeasurableFont, text: string, size: number, letterSpacingEm: number, withDash: boolean,
  color: ColorKey = 'accent',
): Piece {
  const upper = text.toLocaleUpperCase('pt-BR')
  const h = Math.round(size * LABEL_LINE_HEIGHT)
  const x = SAFE.left + (withDash ? 52 : 0)
  const w = Math.ceil(textWidth(font, upper, size, letterSpacingEm))
  if (x + w > SAFE.right) throw new CardLayoutError(`Etiqueta não cabe na largura da área segura: "${upper}"`)
  return {
    h, inkSlack: 0,
    place: y => [
      ...(withDash ? [{ kind: 'rule' as const, color: 'accent' as const, x: SAFE.left, y: y + Math.round(h / 2) - 1, w: 40, h: 2 }] : []),
      { kind: 'text', role: 'label', color, fontSize: size, letterSpacingEm, lines: [{ text: upper, x, y, w, h }] },
    ],
  }
}

function numberPiece(font: MeasurableFont, text: string, size = 22, color: ColorKey = 'accent'): Piece {
  const h = Math.round(size * LABEL_LINE_HEIGHT)
  return {
    h, inkSlack: 0,
    place: y => [{
      kind: 'text', role: 'number', color, fontSize: size,
      lines: [{ text, x: SAFE.left + inkIndent(font, [text], size), y, w: Math.ceil(lineRight(font, text, size)), h }],
    }],
  }
}

function pillsPiece(font: MeasurableFont, items: string[]): Piece {
  const pillH = PILL.lineHeight + PILL.padY * 2 + PILL.border * 2
  const placed: { text: string; x: number; row: number; w: number }[] = []
  let x = SAFE.left
  let row = 0
  for (const text of items) {
    const w = Math.ceil(font.getAdvanceWidth(text, PILL.fontSize)) + (PILL.padX + PILL.border) * 2
    if (w > SAFE_W) throw new CardLayoutError(`Item da lista não cabe na largura: "${text}"`)
    if (x > SAFE.left && x + w > SAFE.right) {
      row++
      x = SAFE.left
    }
    placed.push({ text, x, row, w })
    x += w + PILL.gap
  }
  const rows = row + 1
  return {
    h: rows * pillH + (rows - 1) * PILL.gap,
    inkSlack: 0,
    place: y => [{
      kind: 'pills', fontSize: PILL.fontSize, lineHeight: PILL.lineHeight,
      pills: placed.map(p => ({ text: p.text, x: p.x, y: y + p.row * (pillH + PILL.gap), w: p.w, h: pillH })),
    }],
  }
}

function stackHeight(pieces: Piece[]): number {
  const last = pieces[pieces.length - 1]
  return pieces.reduce((s, p) => s + p.h, 0) + (last ? last.inkSlack : 0)
}

function assemble(template: Template, formato: Formato, pieces: Piece[], sizes: CardLayout['sizes']): CardLayout {
  const safe = FRAMES[formato].safe
  const total = stackHeight(pieces)
  const top = safe.top + Math.floor((safe.bottom - safe.top - total) / 2)
  const items: LaidItem[] = []
  let y = top
  for (const p of pieces) {
    items.push(...p.place(y))
    y += p.h
  }
  return { template, formato, items, block: { x: safe.left, y: top, w: SAFE_W, h: total }, sizes }
}

/** Capa v2: grupo de cima a partir de `yTopo` e grupo de baixo terminando em `yFim`. */
function assembleTopoBase(template: Template, formato: Formato, topo: Piece[], yTopo: number, base: Piece[], yFim: number, sizes: CardLayout['sizes']): CardLayout {
  const items: LaidItem[] = []
  let y = yTopo
  for (const p of topo) { items.push(...p.place(y)); y += p.h }
  const hBase = stackHeight(base)
  y = yFim - hBase
  for (const p of base) { items.push(...p.place(y)); y += p.h }
  const fim = base.length ? yFim : yTopo + stackHeight(topo)
  return { template, formato, items, block: { x: SAFE.left, y: yTopo, w: SAFE_W, h: fim - yTopo }, sizes }
}

// ─── Layout por template ──────────────────────────────────────────────────────

export type MeasureFonts = Record<string, MeasurableFont>

function fontFor(fonts: MeasureFonts, role: TextRole): MeasurableFont {
  const f = fonts[TEXT_ROLES[role].file]
  if (!f) throw new Error(`Fonte de medição não carregada: ${TEXT_ROLES[role].file}`)
  return f
}

function isEnumerable(body: string): string[] | null {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.length > 1 && lines.every(l => l.length <= 40) ? lines : null
}

/** Tamanhos válidos do subtítulo/resolução (maior primeiro): ≤ 3 linhas e
 *  nenhuma linha mais larga que a área segura. */
function subtitleOptions(font: MeasurableFont, body: string): { size: number; lines: string[]; indent: number }[] {
  const opts: { size: number; lines: string[]; indent: number }[] = []
  for (let s = SUBTITLE.max; s >= SUBTITLE.min; s--) {
    const f = fitText(font, body, s, SAFE_W)
    if (f.lines.length <= SUBTITLE.maxLines && f.fits) opts.push({ size: s, lines: f.lines, indent: f.indent })
  }
  return opts
}

export function layoutCard(input: LayoutInput, fonts: MeasureFonts): CardLayout {
  const { template } = input
  const formato: Formato = input.formato || 'quadrado'
  const frame = FRAMES[formato]
  if (frame.safe.left !== SAFE.left || frame.safe.right !== SAFE.right) throw new Error('formato com laterais diferentes não suportado')
  const safeH = frame.safe.bottom - frame.safe.top

  // Endereço: última linha do bloco, DM Sans 400 26 px, na cor de link da família.
  const enderecoPieces: Piece[] = []
  if (input.endereco) {
    const ef = fontFor(fonts, 'endereco')
    let px = ENDERECO.px
    let f = fitText(ef, input.endereco, px, SAFE_W)
    while ((!f.fits || f.lines.length > 1) && px > ENDERECO.pxMin) {
      px--
      f = fitText(ef, input.endereco, px, SAFE_W)
    }
    if (!f.fits || f.lines.length > 1) throw new CardLayoutError(`Endereço não cabe numa linha nem em ${ENDERECO.pxMin} px: "${input.endereco}"`)
    enderecoPieces.push(gap(ENDERECO.gap), textPiece(ef, 'endereco', 'link', px, ENDERECO.lineHeight, f.lines, f.indent))
  }

  if (template === 'ideia') {
    const font = fontFor(fonts, 'manifesto')
    const rotuloIdeia: Piece[] = input.rotulo
      ? [labelPiece(fontFor(fonts, 'label'), input.rotulo, input.estiloV2 ? ROTULO_V2.px : 21, 0.12, true, input.estiloV2 ? 'link' : 'accent'), gap(LABEL_GAP)]
      : []
    const assinaturaPieces: Piece[] = []
    if (input.assinatura) {
      const af = fontFor(fonts, 'body')
      const f = fitText(af, input.assinatura, ASSINATURA.px, SAFE_W)
      if (!f.fits || f.lines.length > 1) throw new CardLayoutError(`Assinatura não cabe numa linha: "${input.assinatura}"`)
      assinaturaPieces.push(gap(ASSINATURA.gap), textPiece(af, 'body', 'muted', ASSINATURA.px, ASSINATURA.lineHeight, f.lines, f.indent))
    }
    const text = (input.body || input.title).trim()
    const parts = text.split(/(?<=[.!?])\s+/)
    // Frase única no modo "ultimaSeVarias": vai inteira na cor do texto.
    const semDestaque = !!input.estiloV2 || (input.destaque === 'ultimaSeVarias' && parts.length < 2)
    const highlight = semDestaque ? '' : (parts[parts.length - 1] || text)
    const main = semDestaque ? text : parts.slice(0, -1).join(' ')
    for (let m = MANIFESTO.max; m >= MANIFESTO.min; m--) {
      const mainFit = main ? fitText(font, main, m, MANIFESTO.width) : { lines: [], indent: 0, fits: true }
      const hlFit = highlight ? fitText(font, highlight, m, MANIFESTO.width) : { lines: [], indent: 0, fits: true }
      // Mesmo recuo nos dois trechos, pra alinharem entre si.
      const indent = Math.max(mainFit.indent, hlFit.indent)
      const all = [...mainFit.lines, ...hlFit.lines]
      if (!mainFit.fits || !hlFit.fits || indent + widest(font, all, m) > MANIFESTO.width - RIGHT_PAD) continue
      const pieces = [
        ...rotuloIdeia,
        rule(52, 3), gap(36),
        ...(mainFit.lines.length ? [textPiece(font, 'manifesto', 'text', m, MANIFESTO.lineHeight, mainFit.lines, indent)] : []),
        ...(hlFit.lines.length ? [textPiece(font, 'manifesto', 'accentContrast', m, MANIFESTO.lineHeight, hlFit.lines, indent)] : []),
        ...assinaturaPieces,
        ...enderecoPieces,
      ]
      if (stackHeight(pieces) <= safeH) return assemble(template, formato, pieces, { manifesto: m })
    }
    throw new CardLayoutError(`Manifesto não cabe na área segura nem em ${MANIFESTO.min} px: "${text}"`)
  }

  const titleFont = fontFor(fonts, 'title')
  const title = input.title.trim()
  const body = input.body.trim()

  // Subtítulo (capa) e resolução (alerta): regra 5, tamanho entre 32 e 40.
  const usesSubtitle = (template === 'capa' || template === 'alerta') && !!body
  const subFont = fontFor(fonts, 'subtitle')
  const subOpts = usesSubtitle ? subtitleOptions(subFont, body) : []
  if (usesSubtitle && subOpts.length === 0) {
    throw new CardLayoutError(`${template === 'capa' ? 'Subtítulo' : 'Resolução'} passa de ${SUBTITLE.maxLines} linhas mesmo em ${SUBTITLE.min} px: "${body}"`)
  }

  // Parte fixa do bloco abaixo do título (não depende do tamanho do título).
  let tail: Piece[] = []
  if (template === 'dado') {
    const enumerable = !input.pills && body ? isEnumerable(body) : null
    tail = [gap(26), rule(64, 3)]
    if (input.pills) tail.push(gap(26), pillsPiece(fontFor(fonts, 'pill'), input.pills))
    if (enumerable) tail.push(gap(26), pillsPiece(fontFor(fonts, 'pill'), enumerable))
    else if (body) {
      const bodyFont = fontFor(fonts, 'body')
      const f = fitText(bodyFont, body, 36, 850)
      if (!f.fits) throw new CardLayoutError(`Palavra do corpo não cabe na largura: "${body}"`)
      tail.push(gap(26), textPiece(bodyFont, 'body', 'muted', 36, 1.45, f.lines, f.indent))
    }
  } else if (template === 'conteudo') {
    tail = [gap(24), rule(48, 3)]
    if (body) {
      const bodyFont = fontFor(fonts, 'body')
      const { main: corpo, cta } = input.estiloV2 ? separaConvite(body, input.ultimo) : { main: body, cta: '' }
      if (corpo) {
        const f = fitText(bodyFont, corpo, 39, SAFE_W)
        if (!f.fits) throw new CardLayoutError(`Palavra do corpo não cabe na largura: "${corpo}"`)
        tail.push(gap(26), textPiece(bodyFont, 'body', 'text', 39, 1.4, f.lines, f.indent))
      }
      if (cta) {
        const fc = fitText(bodyFont, cta, 39, SAFE_W)
        if (!fc.fits) throw new CardLayoutError(`Palavra do convite não cabe na largura: "${cta}"`)
        tail.push(gap(corpo ? 20 : 26), textPiece(bodyFont, 'body', 'link', 39, 1.4, fc.lines, fc.indent))
      }
    }
  }

  const lp = (text: string, size: number, spacing: number, dash: boolean) =>
    labelPiece(fontFor(fonts, 'label'), text, input.estiloV2 ? ROTULO_V2.px : size, spacing, dash, input.estiloV2 ? 'link' : 'accent')
  const head: Piece[] =
    template === 'capa' ? [lp(input.label, 21, 0.12, true), gap(LABEL_GAP)]
      : template === 'alerta' ? [lp(input.label, 22, 0.12, true), gap(LABEL_GAP)]
        : template === 'dado' ? [lp(input.label, 18, 0.14, false), gap(LABEL_GAP)]
          : input.rotulo ? [lp(input.rotulo, 21, 0.12, true), gap(LABEL_GAP)]
            : input.semNumero ? []
              : [numberPiece(fontFor(fonts, 'number'), input.number, input.estiloV2 ? ROTULO_V2.px : 22, input.estiloV2 ? 'link' : 'accent'), gap(8)]

  // Slide de conteúdo sem título (formato novo: rótulo e corpo): rótulo, filete e corpo.
  if (template === 'conteudo' && !title && input.estiloV2) {
    // Estilo v2: corpo grande em EB Garamond creme, como o card de frase
    // (mesma regra de tamanho: 72 px, reduzindo até 44 se não couber).
    const mf = fontFor(fonts, 'manifesto')
    const { main: corpo, cta } = separaConvite(body, input.ultimo)
    for (let m = MANIFESTO.max; m >= MANIFESTO.min; m--) {
      const f = corpo ? fitText(mf, corpo, m, MANIFESTO.width) : { lines: [], indent: 0, fits: true }
      const fc = cta ? fitText(mf, cta, m, MANIFESTO.width) : { lines: [], indent: 0, fits: true }
      if (!f.fits || !fc.fits) continue
      const pieces = [
        ...head, rule(52, 3), gap(36),
        ...(f.lines.length ? [textPiece(mf, 'manifesto', 'text', m, MANIFESTO.lineHeight, f.lines, f.indent)] : []),
        ...(fc.lines.length ? [gap(f.lines.length ? 24 : 0), textPiece(mf, 'manifesto', 'link', m, MANIFESTO.lineHeight, fc.lines, fc.indent)] : []),
        ...enderecoPieces,
      ]
      if (stackHeight(pieces) <= safeH) return assemble(template, formato, pieces, { manifesto: m })
    }
    throw new CardLayoutError(`Corpo não cabe na área segura nem em ${MANIFESTO.min} px: "${body}"`)
  }
  if (template === 'conteudo' && !title) {
    const pieces = [...head, ...tail, ...enderecoPieces]
    if (stackHeight(pieces) <= safeH) return assemble(template, formato, pieces, {})
    throw new CardLayoutError(`Corpo não cabe na área segura: "${body}"`)
  }

  for (let t = TITLE.max; t >= TITLE.min; t--) {
    const tf = fitText(titleFont, title, t, SAFE_W)
    if (tf.lines.length > TITLE.maxLines || !tf.fits) continue
    const titlePiece = textPiece(titleFont, 'title', 'text', t, TITLE.lineHeight, tf.lines, tf.indent)
    const subCandidates = usesSubtitle ? subOpts : [null]
    for (const sub of subCandidates) {
      const subPieces: Piece[] = !sub ? []
        : template === 'capa'
          ? [gap(28), textPiece(subFont, 'subtitle', 'muted', sub.size, SUBTITLE.lineHeight, sub.lines, sub.indent)]
          : [gap(30), rule(48, 3), gap(30), textPiece(subFont, 'subtitle', 'text', sub.size, SUBTITLE.lineHeight, sub.lines, sub.indent)]
      if (template === 'capa' && input.estiloV2) {
        const topo = [...head, titlePiece]
        const base = [
          ...(sub ? [textPiece(subFont, 'subtitle', 'muted', sub.size, SUBTITLE.lineHeight, sub.lines, sub.indent)] : []),
          ...enderecoPieces,
        ]
        const yTopo = frame.headerTop + frame.headerH + CAPA_V2.respiroTopo
        const yFim = frame.footerTop - CAPA_V2.respiroBase
        const fimTopo = yTopo + stackHeight(topo)
        const cabe = base.length ? fimTopo + CAPA_V2.vaoMin <= yFim - stackHeight(base) : fimTopo <= frame.safe.bottom
        if (yTopo >= frame.safe.top && yFim <= frame.safe.bottom && cabe) {
          return assembleTopoBase(template, formato, topo, yTopo, base, yFim, { title: t, ...(sub ? { subtitle: sub.size } : {}) })
        }
        continue
      }
      const pieces = [...head, titlePiece, ...subPieces, ...tail, ...enderecoPieces]
      if (stackHeight(pieces) <= safeH) {
        return assemble(template, formato, pieces, { title: t, ...(sub ? { subtitle: sub.size } : {}) })
      }
    }
  }
  throw new CardLayoutError(`Título não cabe na área segura nem em ${TITLE.min} px: "${title}"`)
}

/** Confere que toda caixa calculada está dentro da área segura. Devolve a
 *  lista de violações (vazia = ok). Usado pelo lote como checagem automática. */
export function checkSafeArea(layout: CardLayout): string[] {
  const problems: string[] = []
  const frame = FRAMES[layout.formato || 'quadrado']
  const safe = frame.safe
  const check = (what: string, b: Box) => {
    if (b.x < safe.left || b.x + b.w > safe.right || b.y < safe.top || b.y + b.h > safe.bottom) {
      problems.push(`${what} fora da área segura: x=${b.x}..${b.x + b.w}, y=${b.y}..${b.y + b.h}`)
    }
  }
  // Cabeçalho e rodapé também precisam ficar fora da interface da rede.
  if (frame.headerTop < frame.uiBand.top) problems.push(`cabeçalho em y=${frame.headerTop}, dentro da faixa da interface (até ${frame.uiBand.top})`)
  if (frame.footerTop + frame.footerH > frame.uiBand.bottom) problems.push(`rodapé até y=${frame.footerTop + frame.footerH}, dentro da faixa da interface (a partir de ${frame.uiBand.bottom})`)
  for (const item of layout.items) {
    if (item.kind === 'text') item.lines.forEach(l => check(`${item.role} "${l.text}"`, l))
    else if (item.kind === 'rule') check('divisor', item)
    else if (item.kind === 'elemento') check('elemento gráfico', item)
    else item.pills.forEach(p => check(`item "${p.text}"`, p))
  }
  return problems
}
