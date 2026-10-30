/**
 * lib/storyLayout.ts
 *
 * Layout dos stories do Instagram (1080x1920, o mesmo formato vertical do
 * Reel). Calcula a caixa absoluta de cada elemento com a fonte real (mesma
 * medição dos cards, lib/cardLayout.ts); components/storyTemplates.tsx só
 * desenha. Usado igual pelo servidor (/api/export-story) e pelo preview.
 *
 * Área segura de stories: nada nos 250 px do topo nem nos 340 px da base
 * (interface do Instagram), laterais x = 90 a 990. Nos stories para
 * empresas, a área da figurinha de link (y = 1444 a 1556) fica COMPLETAMENTE
 * livre e, logo acima, um texto discreto indica "Toque no link abaixo". A
 * moldura de vaga tem regra própria (ver MOLDURA): tudo entre y = 250 e
 * y = 1600, selo no topo, arte logo abaixo e a área da figurinha no fim.
 *
 * Três geradores:
 *  - moldura: a arte da vaga inteira, numa caixa de até 900 px de largura,
 *    com o selo "Mural de Vagas" da Capital Humano Intelligence acima dela, nunca por cima;
 *  - empresa: três modelos de texto fixo e a área livre da figurinha de link;
 *  - capa: capa de destaque ("Vagas", "Para empresas"), só ícone, legível
 *    quando o Instagram reduz a imagem a um círculo pequeno.
 */

import { CardLayoutError, fitText, lineRight, textWidth, type LaidWord, type MeasurableFont, type MeasureFonts } from './cardLayout'
import { palavrasDe } from './gradeLayout'

export const STORY = {
  width: 1080,
  height: 1920,
  left: 90,
  right: 990,
  uiTop: 250,
  uiBottom: 1920 - 340, // 1580
}
const CENTER_X = STORY.width / 2
const CONTENT_W = STORY.right - STORY.left // 900

/** Área da figurinha de link: fica vazia (a figurinha é colada ali à mão). */
export const LINK_RESERVE = { w: 560, h: 112, y: STORY.uiBottom - 24 - 112 } // 1444..1556
export const LINK_RESERVE_X = Math.round(STORY.width / 2 - LINK_RESERVE.w / 2)

/** Indicação discreta logo acima da área livre do link. */
export const LINK_HINT = { text: 'Toque no link abaixo', size: 28, lh: 36, gap: 20 }
const LINK_HINT_TOP = LINK_RESERVE.y - LINK_HINT.gap - LINK_HINT.lh // 1388

export const STORY_ROLES = {
  headline: { fontFamily: 'EB Garamond', fontWeight: 600, fontStyle: 'normal', file: 'EBGaramond-SemiBold.ttf' },
  support: { fontFamily: 'EB Garamond', fontWeight: 500, fontStyle: 'italic', file: 'EBGaramond-MediumItalic.ttf' },
  ui: { fontFamily: 'DM Sans', fontWeight: 400, fontStyle: 'normal', file: 'DMSans-400.ttf' },
  uiStrong: { fontFamily: 'DM Sans', fontWeight: 500, fontStyle: 'normal', file: 'DMSans-500.ttf' },
} as const
export type StoryRole = keyof typeof STORY_ROLES

/** Textos dos stories para empresas: fixos, sem alterar uma palavra. */
export const EMPRESA_MODELOS = [
  {
    titulo: 'Sua empresa também pode publicar vagas aqui, de graça.',
    apoio: 'As vagas ficam no Mural de Vagas da Capital Humano Intelligence, abertas para quem procura trabalho na cidade.',
    tom: 'verde',
  },
  {
    titulo: 'Tem vaga aberta?',
    apoio: 'Publique no Mural de Vagas da Capital Humano Intelligence sem custo e receba as candidaturas num só lugar.',
    tom: 'terracota',
  },
  {
    titulo: 'As vagas que você vê aqui todos os dias chegam pelo nosso Mural de Vagas.',
    apoio: 'Capital Humano Intelligence. A da sua empresa pode ser a próxima.',
    tom: 'verde',
  },
] as const

export type StoryTom = 'verde' | 'terracota'
export type StoryColor = 'text' | 'muted' | 'accent'
export type IconName = 'vagas' | 'empresas'

/** palavras: posição exata de cada palavra pela fonte, com kerning (como na
 *  grade dos cards, decisão de 15/10); o template desenha uma a uma. */
export interface StoryLine { text: string; x: number; y: number; w: number; h: number; inkLeft: number; palavras?: LaidWord[] }
export type StoryItem =
  | { kind: 'text'; role: StoryRole; color: StoryColor; fontSize: number; letterSpacingEm?: number; lines: StoryLine[] }
  | { kind: 'rule'; x: number; y: number; w: number; h: number }
  | { kind: 'logo'; x: number; y: number; size: number }
  | { kind: 'image'; x: number; y: number; w: number; h: number; raio?: number; sombra?: boolean; contorno?: number }
  | { kind: 'pill'; x: number; y: number; w: number; h: number }
  | { kind: 'icon'; name: IconName; x: number; y: number; size: number }
  | { kind: 'ring'; cx: number; cy: number; r: number; stroke: number }

export interface StoryLayout {
  tipo: 'moldura' | 'empresa' | 'capa'
  tom: StoryTom
  items: StoryItem[]
  /** Moldura de vaga: área livre reservada para a figurinha de link (não é desenhada). */
  figurinha?: { x: number; y: number; w: number; h: number }
  /** Moldura de vaga: fator de escala da arte (acima de MOLDURA.ampliacaoMax, pode sair borrada). */
  escala?: number
}

function font(fonts: MeasureFonts, role: StoryRole): MeasurableFont {
  const f = fonts[STORY_ROLES[role].file]
  if (!f) throw new Error(`Fonte de medição não carregada: ${STORY_ROLES[role].file}`)
  return f
}

/** Linhas centralizadas pela tinta real (cauda de itálico e sobra de glifo inclusas). */
function centered(f: MeasurableFont, lines: string[], size: number, top: number, lh: number): StoryLine[] {
  return lines.map((text, i) => {
    const left = Math.min(0, f.getInkBounds(text, size).left)
    const right = lineRight(f, text, size)
    const x = Math.round(CENTER_X - (right + left) / 2)
    return { text, x, y: top + i * lh, w: Math.ceil(right), h: lh, inkLeft: Math.floor(left), palavras: palavrasDe(f, text, size).palavras }
  })
}

function leftAligned(f: MeasurableFont, lines: string[], size: number, top: number, lh: number, indent: number): StoryLine[] {
  return lines.map((text, i) => ({
    text, x: STORY.left + indent, y: top + i * lh, w: Math.ceil(lineRight(f, text, size)), h: lh,
    inkLeft: Math.floor(Math.min(0, f.getInkBounds(text, size).left)),
    palavras: palavrasDe(f, text, size).palavras,
  }))
}

/** Maior tamanho (de max a min) em que o texto cabe em até maxLines linhas na largura. */
function fitSize(f: MeasurableFont, text: string, max: number, min: number, maxLines: number, width = CONTENT_W) {
  for (let s = max; s >= min; s--) {
    const fit = fitText(f, text, s, width)
    if (fit.fits && fit.lines.length <= maxLines) return { size: s, ...fit }
  }
  return null
}

function linkHint(fonts: MeasureFonts): StoryItem {
  return {
    kind: 'text', role: 'ui', color: 'muted', fontSize: LINK_HINT.size,
    lines: centered(font(fonts, 'ui'), [LINK_HINT.text], LINK_HINT.size, LINK_HINT_TOP, LINK_HINT.lh),
  }
}

// ─── Moldura de vaga ─────────────────────────────────────────────────────────
// A arte da empresa parceira pode vir em qualquer formato (retrato, quadrada,
// horizontal). Regra única, em 1080x1920 (decisão de 15/10, depois de o selo
// da versão antiga cobrir a arte de clientes):
//  - zona segura: todo conteúdo entre y = 250 e y = 1600 (o Instagram cobre o
//    topo com a barra de progresso, a foto e o nome, e a base com o campo de
//    resposta); fora dela, só o fundo verde;
//  - selo no topo da zona (y = 250), centralizado, sobre o fundo verde: logo
//    de 96 px e, à direita, "Mural de Vagas" (DM Sans 500, 46 px) e "Capital
//    Humano Intelligence" (DM Sans 400, 32 px);
//  - no fim da zona, de baixo para cima: área livre da figurinha de link
//    (600x140, terminando em y = 1600), 24 px, a frase "Toque no link abaixo
//    para ver mais vagas" em uma linha (creme cheio, DM Sans 500, 40 px,
//    reduz até 34 px), 40 px;
//  - arte no espaço que sobra entre o selo (com respiro de 24 px) e a frase:
//    inteira, proporcional, sem corte (cantos retos), nunca ampliada além do
//    tamanho original, centralizada na horizontal e na vertical desse espaço;
//    nada por cima dela. Sombra suave e contorno de 2 px em creme a 40%, os
//    dois por fora da arte.
// Espaço da arte: x = 90 a 990 e y = 370 a 1346, ou seja, até 900 x 976 px.

export const MOLDURA = {
  topo: STORY.uiTop, // 250
  base: 1600,
  espaco: { seloArte: 24, arteFrase: 40, fraseFigurinha: 24 },
  arte: { maxW: CONTENT_W, raio: 0, contorno: 2 },
  selo: { logo: 96, gap: 22, linha1: { texto: 'Mural de Vagas', px: 46, lh: 54 }, linha2: { texto: 'Capital Humano Intelligence', px: 32, lh: 40 } },
  frase: { texto: 'Toque no link abaixo para ver mais vagas', px: 40, pxMin: 34, lh: 50 },
  figurinha: { w: 600, h: 140 },
  /** A arte nunca é ampliada além do tamanho original (perderia nitidez). */
  ampliacaoMax: 1,
}
/** Indicação do link na moldura. */
export const HINT_MOLDURA = MOLDURA.frase.texto

export function layoutMoldura(
  fonts: MeasureFonts,
  opts: { imgW: number; imgH: number },
): StoryLayout {
  const forte = font(fonts, 'uiStrong')
  const leve = font(fonts, 'ui')
  const { selo, frase, figurinha, arte, espaco } = MOLDURA

  // Frase do link em uma linha: 40 px, reduz até 34 px se precisar.
  let fpx = frase.px
  while (fpx > frase.pxMin && lineRight(forte, frase.texto, fpx) > CONTENT_W) fpx--
  if (lineRight(forte, frase.texto, fpx) > CONTENT_W) throw new CardLayoutError(`A frase do link não cabe em uma linha: "${frase.texto}"`)

  // Zonas fixas: selo no topo, figurinha e frase no fim; a arte no meio.
  const seloH = Math.max(selo.logo, selo.linha1.lh + selo.linha2.lh)
  const figY = MOLDURA.base - figurinha.h
  const fraseY = figY - espaco.fraseFigurinha - frase.lh
  const espacoTopo = MOLDURA.topo + seloH + espaco.seloArte
  const espacoBase = fraseY - espaco.arteFrase
  const maxH = espacoBase - espacoTopo
  if (maxH < 100) throw new CardLayoutError('A moldura não cabe entre as faixas do Instagram.')

  // Arte: contain no espaço que sobra, sem nunca ampliar além do original.
  const iw = Math.max(1, opts.imgW), ih = Math.max(1, opts.imgH)
  const escala = Math.min(arte.maxW / iw, maxH / ih, MOLDURA.ampliacaoMax)
  const aw = Math.min(arte.maxW, Math.round(iw * escala)), ah = Math.min(maxH, Math.round(ih * escala))
  const y = MOLDURA.topo
  const items: StoryItem[] = []

  // Selo: logo + duas linhas, o conjunto centralizado na largura.
  const w1 = Math.ceil(lineRight(forte, selo.linha1.texto, selo.linha1.px))
  const w2 = Math.ceil(lineRight(leve, selo.linha2.texto, selo.linha2.px))
  const sx = Math.round(CENTER_X - (selo.logo + selo.gap + Math.max(w1, w2)) / 2)
  const tx = sx + selo.logo + selo.gap
  const ty = y + Math.round((seloH - (selo.linha1.lh + selo.linha2.lh)) / 2)
  items.push({ kind: 'logo', x: sx, y: y + Math.round((seloH - selo.logo) / 2), size: selo.logo })
  items.push({ kind: 'text', role: 'uiStrong', color: 'text', fontSize: selo.linha1.px, lines: [{ text: selo.linha1.texto, x: tx, y: ty, w: w1, h: selo.linha1.lh, inkLeft: 0, palavras: palavrasDe(forte, selo.linha1.texto, selo.linha1.px).palavras }] })
  items.push({ kind: 'text', role: 'ui', color: 'text', fontSize: selo.linha2.px, lines: [{ text: selo.linha2.texto, x: tx, y: ty + selo.linha1.lh, w: w2, h: selo.linha2.lh, inkLeft: 0, palavras: palavrasDe(leve, selo.linha2.texto, selo.linha2.px).palavras }] })

  // Arte centralizada no espaço que sobra (na vertical também: arte baixa ou
  // pequena fica no meio, com fundo verde acima e abaixo).
  items.push({
    kind: 'image', x: Math.round(CENTER_X - aw / 2), y: espacoTopo + Math.floor((maxH - ah) / 2), w: aw, h: ah,
    raio: arte.raio, sombra: true, contorno: arte.contorno,
  })

  // Frase: creme cheio, peso médio, a maior em contraste depois do selo.
  items.push({ kind: 'text', role: 'uiStrong', color: 'text', fontSize: fpx, lines: centered(forte, [frase.texto], fpx, fraseY, frase.lh) })

  return {
    tipo: 'moldura', tom: 'verde', items,
    figurinha: { x: Math.round(CENTER_X - figurinha.w / 2), y: figY, w: figurinha.w, h: figurinha.h },
    escala,
  }
}

// ─── Story para empresas ─────────────────────────────────────────────────────

export function layoutEmpresa(fonts: MeasureFonts, modelo: 1 | 2 | 3): StoryLayout {
  const m = EMPRESA_MODELOS[modelo - 1]
  const items: StoryItem[] = []
  // Cabeçalho da marca, igual aos cards: logo + nome.
  const brandTop = STORY.uiTop + 14
  items.push({ kind: 'logo', x: STORY.left, y: brandTop, size: 48 })
  const bSize = 20
  const brand = 'CAPITAL HUMANO INTELLIGENCE'
  const bw = Math.ceil(textWidth(font(fonts, 'uiStrong'), brand, bSize, 0.08))
  items.push({
    kind: 'text', role: 'uiStrong', color: 'muted', fontSize: bSize, letterSpacingEm: 0.08,
    lines: [{ text: brand, x: STORY.left + 48 + 16, y: brandTop + 12, w: bw, h: 24, inkLeft: 0, palavras: palavrasDe(font(fonts, 'uiStrong'), brand, bSize, 0.08).palavras }],
  })

  items.push(linkHint(fonts))

  // Bloco: filete, título e apoio, centralizado entre o cabeçalho e a indicação do link.
  const zoneTop = brandTop + 48 + 60
  const zoneBottom = LINK_HINT_TOP - 56
  const head = font(fonts, 'headline')
  const sup = font(fonts, 'support')
  for (let t = 120; t >= 56; t--) {
    const tf = fitText(head, m.titulo, t, CONTENT_W)
    if (!tf.fits || tf.lines.length > 6) continue
    const sf = fitSize(sup, m.apoio, 52, 34, 4)
    if (!sf) throw new CardLayoutError(`Texto de apoio não cabe: "${m.apoio}"`)
    const tLh = Math.round(t * 1.1)
    const sLh = Math.round(sf.size * 1.3)
    const total = 3 + 40 + tLh * tf.lines.length + 40 + sLh * sf.lines.length
    if (total > zoneBottom - zoneTop) continue
    let y = zoneTop + Math.floor((zoneBottom - zoneTop - total) / 2)
    items.push({ kind: 'rule', x: STORY.left, y, w: 64, h: 3 })
    y += 3 + 40
    items.push({ kind: 'text', role: 'headline', color: 'text', fontSize: t, lines: leftAligned(head, tf.lines, t, y, tLh, tf.indent) })
    y += tLh * tf.lines.length + 40
    items.push({ kind: 'text', role: 'support', color: 'muted', fontSize: sf.size, lines: leftAligned(sup, sf.lines, sf.size, y, sLh, sf.indent) })
    return { tipo: 'empresa', tom: m.tom, items }
  }
  throw new CardLayoutError(`Título não cabe na área segura do story: "${m.titulo}"`)
}

// ─── Capas de destaque ───────────────────────────────────────────────────────

export function layoutCapa(icone: IconName): StoryLayout {
  const cy = STORY.height / 2
  const size = 440
  return {
    tipo: 'capa',
    tom: 'verde',
    items: [
      { kind: 'ring', cx: CENTER_X, cy, r: 400, stroke: 6 },
      { kind: 'icon', name: icone, x: CENTER_X - size / 2, y: cy - size / 2, size },
    ],
  }
}

// ─── Trava de área segura ────────────────────────────────────────────────────

/** Toda caixa dentro de x = 90..990 e y = 250..1580 (na moldura de vaga, até
 *  y = 1600); nos stories para empresas e na moldura, nenhuma dentro da área
 *  da figurinha de link; na moldura, nenhum elemento sobre a arte do cliente.
 *  Vazio = ok. */
export function checkStorySafe(layout: StoryLayout): string[] {
  const problems: string[] = []
  const moldura = layout.tipo === 'moldura'
  const base = moldura ? MOLDURA.base : STORY.uiBottom
  const reserva = moldura
    ? layout.figurinha
    : layout.tipo === 'empresa' ? { x: LINK_RESERVE_X, y: LINK_RESERVE.y, w: LINK_RESERVE.w, h: LINK_RESERVE.h } : undefined
  if (moldura && (!reserva || reserva.y < STORY.uiTop || reserva.y + reserva.h > base)) problems.push('área da figurinha de link fora das zonas')
  const arte = layout.items.find(it => it.kind === 'image')
  const cruza = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x0 < b.x + b.w && a.x1 > b.x && a.y0 < b.y + b.h && a.y1 > b.y
  const check = (what: string, x0: number, y0: number, x1: number, y1: number, ehArte = false) => {
    if (x0 < STORY.left || x1 > STORY.right || y0 < STORY.uiTop || y1 > base) {
      problems.push(`${what} fora da área segura do story: x=${x0}..${x1}, y=${y0}..${y1}`)
    }
    if (reserva && cruza({ x0, y0, x1, y1 }, reserva)) problems.push(`${what} invade a área da figurinha de link: y=${y0}..${y1}`)
    if (moldura && !ehArte && arte && arte.kind === 'image' && cruza({ x0, y0, x1, y1 }, arte)) problems.push(`${what} sobreposto à arte do cliente`)
  }
  for (const it of layout.items) {
    if (it.kind === 'text') it.lines.forEach(l => check(`texto "${l.text}"`, l.x + l.inkLeft, l.y, l.x + l.w, l.y + l.h))
    else if (it.kind === 'ring') check('anel', it.cx - it.r - it.stroke, it.cy - it.r - it.stroke, it.cx + it.r + it.stroke, it.cy + it.r + it.stroke)
    else if (it.kind === 'logo' || it.kind === 'icon') check(it.kind, it.x, it.y, it.x + it.size, it.y + it.size)
    else if (it.kind === 'image') {
      // O contorno (2 px, por fora) conta no eixo vertical; nas laterais a arte
      // de 900 px já encosta nas margens de 90 px e o contorno passa 2 px delas,
      // fora de qualquer faixa coberta pelo Instagram.
      const c = it.contorno || 0
      check('arte', it.x, it.y - c, it.x + it.w, it.y + it.h + c, true)
      if (it.x - c < 0 || it.x + it.w + c > STORY.width) problems.push('contorno da arte fora da tela')
    }
    else check(it.kind, it.x, it.y, it.x + it.w, it.y + it.h)
  }
  return problems
}
