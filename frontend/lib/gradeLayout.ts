/**
 * lib/gradeLayout.ts
 *
 * "Grade editorial" (aprovada pela Dani em 13/10, em TESTE): layout dos cards
 * em 1080x1350 com tudo alinhado em cima. Só entra quando a API recebe o
 * formato "grade" (no lote, LOTE_ESTILO=grade); sem isso, o motor de sempre
 * (lib/cardLayout.ts, layoutCard) desenha tudo como antes.
 *
 * Grade:
 *  - margens laterais de 96 px; cabeçalho de 0 a 200 px (desenhado em
 *    components/cardTemplates.tsx); rodapé como hoje;
 *  - conteúdo começa sempre em y = 300, nunca centralizado na vertical, na
 *    ordem rótulo, título, filete, corpo, convite (32, 40, 40 e 32 px);
 *  - capa: título EB Garamond 140 px (até 120, no máximo 5 linhas) e o
 *    subtítulo itálico 48 px logo abaixo (40 px);
 *  - slide interno: título 104 px (até 88 se passar de 3 linhas), corpo DM
 *    Sans 48 px com entrelinha 1,35, convite final 48 px em dourado claro;
 *  - slide sem título: corpo em EB Garamond 72 px (até 60), creme;
 *  - card de frase: frase EB Garamond 88 px (até 72) em dourado claro e a
 *    assinatura DM Sans 32 px, creme a 80%, 40 px abaixo;
 *  - elemento gráfico: letra-chave da peça, dourado a 10%, em caixa fixa
 *    (caixa do glifo com 440 px de altura, direita em x = 984 e base em
 *    y = 1230), igual em todos os slides; se o texto invadir a caixa, sai
 *    (nunca diminui nem muda de lugar).
 */

import {
  CardLayoutError, TEXT_ROLES, fitText, separaConvite, textWidth,
  type CardLayout, type ColorKey, type LaidItem, type LaidLine, type LaidText, type LaidWord, type LaidWords, type LayoutInput,
  type MeasurableFont, type MeasureFonts, type TextRole,
} from './cardLayout'

export const GRADE = {
  margem: 96,
  topo: 300,
  cabecalho: 200,
  base: 1230,
  largura: 1080 - 2 * 96, // 888
  espaco: { rotuloTitulo: 32, tituloFilete: 40, fileteCorpo: 40, corpoConvite: 32, tituloSubtitulo: 40, fraseAssinatura: 40 },
  rotulo: { px: 30, lh: 1.2, spacing: 0.12 },
  tituloCapa: { max: 140, min: 120, linhas: 5, lh: 1.08 },
  tituloInterno: { max: 104, min: 88, linhas: 3, lh: 1.1 },
  subtitulo: { px: 48, lh: 1.3 },
  corpo: { px: 48, lh: 1.35 },
  corpoSemTitulo: { max: 72, min: 60, lh: 1.28 },
  // Slide sem título com texto curto (até 80 caracteres): EB Garamond 104 px (14/10).
  corpoCurto: { limite: 80, px: 104, lh: 1.15 },
  frase: { max: 88, min: 72, lh: 1.2 },
  assinatura: { px: 32, lh: 1.3 },
  endereco: { px: 34, lh: 1.3, gap: 32 },
  filete: { w: 64, h: 3 },
  // Caixa fixa do elemento (14/10): a do V nos slides 2, 3, 4 e 6 da peça 3.
  elemento: { altura: 440, opacidade: 0.1, folga: 24 },
}

export interface GradeInput extends LayoutInput {
  indice: number
  total: number
  /** Texto do elemento gráfico ("V", "02"); vazio = sem elemento. */
  elemento?: string
}

/** Formato novo: espaços consecutivos viram um só (sem mexer nas quebras de
 *  linha). Usado pelo servidor (/api/export-card) e pela prévia da tela. */
export function juntaEspacosTexto(t: string): string {
  return t.replace(/[ \t\u00A0]{2,}/g, ' ')
}

function fonte(fonts: MeasureFonts, role: TextRole): MeasurableFont {
  const f = fonts[TEXT_ROLES[role].file]
  if (!f) throw new Error(`Fonte de medição não carregada: ${TEXT_ROLES[role].file}`)
  return f
}

/** Posição de cada palavra numa linha composta de uma vez pela fonte (avanço
 *  e kerning de todos os pares, inclusive com o espaço), mais o espaçamento
 *  entre letras que o Satori soma depois de cada letra. */
export function palavrasDe(f: MeasurableFont, texto: string, size: number, spacingEm = 0): LaidWords {
  const ls = spacingEm * size
  const palavras: LaidWord[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) {
    const prefixo = texto.slice(0, m.index)
    const primeiro = Array.from(m[0])[0]
    const dx = prefixo
      ? f.getAdvanceWidth(prefixo + primeiro, size) - f.getAdvanceWidth(primeiro, size) + ls * Array.from(prefixo).length
      : 0
    palavras.push({ t: m[0], dx: Math.round(dx * 100) / 100 })
  }
  return { palavras, w: Math.ceil(textWidth(f, texto, size, spacingEm)) }
}

function bloco(f: MeasurableFont, role: TextRole, color: ColorKey, size: number, lh: number, texto: string, y: number, extra: Partial<LaidText> = {}): { item: LaidText; fim: number } {
  const fit = fitText(f, texto, size, GRADE.largura)
  if (!fit.fits) throw new CardLayoutError(`Palavra não cabe na largura da grade: "${texto}"`)
  const h = Math.round(size * lh)
  const lines: LaidLine[] = fit.lines.map((text, i) => ({
    text, x: GRADE.margem + fit.indent, y: y + i * h, w: Math.ceil(f.getInkBounds(text, size).right), h,
    palavras: palavrasDe(f, text, size).palavras,
  }))
  return { item: { kind: 'text', role, color, fontSize: size, lines, ...extra }, fim: y + h * lines.length }
}

/** Maior tamanho (de max a min) em que o texto cabe em até `linhas` linhas; senão, o mínimo. */
function tamanho(f: MeasurableFont, texto: string, max: number, min: number, linhas: number): number {
  for (let s = max; s >= min; s--) {
    const fit = fitText(f, texto, s, GRADE.largura)
    if (fit.fits && fit.lines.length <= linhas) return s
  }
  return min
}

export function layoutGrade(input: GradeInput, fonts: MeasureFonts): CardLayout {
  const items: LaidItem[] = []
  const sizes: CardLayout['sizes'] = {}
  const titulo = input.title.trim()
  const corpoTxt = input.body.trim()
  const ultimo = input.total > 1 && input.indice === input.total
  const cardDeFrase = input.total === 1 && input.template === 'ideia'
  let y = GRADE.topo

  // Rótulo (só o que vem do Eyebrow; sem rótulo padrão da família).
  if (input.rotulo && !cardDeFrase) {
    const f = fonte(fonts, 'label')
    const texto = input.rotulo.toLocaleUpperCase('pt-BR')
    const h = Math.round(GRADE.rotulo.px * GRADE.rotulo.lh)
    const w = Math.ceil(textWidth(f, texto, GRADE.rotulo.px, GRADE.rotulo.spacing))
    if (w > GRADE.largura) throw new CardLayoutError(`Rótulo não cabe na largura: "${texto}"`)
    items.push({ kind: 'text', role: 'label', color: 'link', fontSize: GRADE.rotulo.px, letterSpacingEm: GRADE.rotulo.spacing, lines: [{ text: texto, x: GRADE.margem, y, w, h, palavras: palavrasDe(f, texto, GRADE.rotulo.px, GRADE.rotulo.spacing).palavras }] })
    y += h + GRADE.espaco.rotuloTitulo
  }

  let topoBloco = GRADE.topo
  if (cardDeFrase) {
    // Frase em dourado claro e a assinatura 40 px abaixo; o bloco fica
    // centralizado na vertical entre o cabeçalho (200) e o rodapé (1230),
    // alinhado à esquerda na margem (decisão de 14/10). Sem elemento gráfico.
    const f = fonte(fonts, 'manifesto')
    const s = tamanho(f, corpoTxt, GRADE.frase.max, GRADE.frase.min, 99)
    const b = bloco(f, 'manifesto', 'link', s, GRADE.frase.lh, corpoTxt, 0)
    const partes: LaidText[] = [b.item]
    let fim = b.fim
    sizes.manifesto = s
    if (input.assinatura) {
      const a = bloco(fonte(fonts, 'body'), 'body', 'suave', GRADE.assinatura.px, GRADE.assinatura.lh, input.assinatura, fim + GRADE.espaco.fraseAssinatura)
      partes.push(a.item)
      fim = a.fim
    }
    topoBloco = GRADE.cabecalho + Math.round((GRADE.base - GRADE.cabecalho - fim) / 2)
    for (const p of partes) for (const l of p.lines) l.y += topoBloco
    items.push(...partes)
    y = topoBloco + fim
  } else if (input.template === 'capa') {
    const tf = fonte(fonts, 'title')
    const s = tamanho(tf, titulo, GRADE.tituloCapa.max, GRADE.tituloCapa.min, GRADE.tituloCapa.linhas)
    const t = bloco(tf, 'title', 'text', s, GRADE.tituloCapa.lh, titulo, y)
    items.push(t.item)
    sizes.title = s
    y = t.fim
    if (corpoTxt) {
      const sub = bloco(fonte(fonts, 'subtitle'), 'subtitle', 'suave', GRADE.subtitulo.px, GRADE.subtitulo.lh, corpoTxt, y + GRADE.espaco.tituloSubtitulo)
      items.push(sub.item)
      sizes.subtitle = GRADE.subtitulo.px
      y = sub.fim
    }
  } else {
    const { main: corpo, cta } = separaConvite(corpoTxt, ultimo)
    if (titulo) {
      const tf = fonte(fonts, 'title')
      const s = tamanho(tf, titulo, GRADE.tituloInterno.max, GRADE.tituloInterno.min, GRADE.tituloInterno.linhas)
      const t = bloco(tf, 'title', 'text', s, GRADE.tituloInterno.lh, titulo, y)
      items.push(t.item)
      sizes.title = s
      y = t.fim + GRADE.espaco.tituloFilete
      items.push({ kind: 'rule', color: 'link', x: GRADE.margem, y, w: GRADE.filete.w, h: GRADE.filete.h })
      y += GRADE.filete.h + GRADE.espaco.fileteCorpo
      const bf = fonte(fonts, 'body')
      if (corpo) {
        const b = bloco(bf, 'body', 'text', GRADE.corpo.px, GRADE.corpo.lh, corpo, y)
        items.push(b.item)
        y = b.fim
      }
      if (cta) {
        const c = bloco(bf, 'body', 'link', GRADE.corpo.px, GRADE.corpo.lh, cta, y + (corpo ? GRADE.espaco.corpoConvite : 0))
        items.push(c.item)
        y = c.fim
      }
      sizes.corpo = GRADE.corpo.px
    } else {
      // Slide sem título: corpo grande em EB Garamond creme, ancorado no alto.
      if (input.rotulo) {
        items.push({ kind: 'rule', color: 'link', x: GRADE.margem, y, w: GRADE.filete.w, h: GRADE.filete.h })
        y += GRADE.filete.h + GRADE.espaco.fileteCorpo
      }
      const mf = fonte(fonts, 'manifesto')
      let escolhido: { s: number; itens: LaidText[]; fim: number } | null = null
      const curto = corpoTxt.length <= GRADE.corpoCurto.limite
      const opcoes: { s: number; lh: number }[] = []
      if (curto) opcoes.push({ s: GRADE.corpoCurto.px, lh: GRADE.corpoCurto.lh })
      for (let s = GRADE.corpoSemTitulo.max; s >= GRADE.corpoSemTitulo.min; s--) opcoes.push({ s, lh: GRADE.corpoSemTitulo.lh })
      for (const { s, lh } of opcoes) {
        const itens: LaidText[] = []
        let yy = y
        if (corpo) { const b = bloco(mf, 'manifesto', 'text', s, lh, corpo, yy); itens.push(b.item); yy = b.fim }
        if (cta) { const c = bloco(mf, 'manifesto', 'link', s, lh, cta, yy + (corpo ? GRADE.espaco.corpoConvite : 0)); itens.push(c.item); yy = c.fim }
        escolhido = { s, itens, fim: yy }
        if (yy <= GRADE.base) break
      }
      if (escolhido) { items.push(...escolhido.itens); y = escolhido.fim; sizes.manifesto = escolhido.s }
    }
    if (input.endereco) {
      const e = bloco(fonte(fonts, 'endereco'), 'endereco', 'link', GRADE.endereco.px, GRADE.endereco.lh, input.endereco, y + GRADE.endereco.gap)
      items.push(e.item)
      y = e.fim
    }
  }
  if (y > GRADE.base) throw new CardLayoutError(`Conteúdo passa da área da grade (termina em y=${y}, limite ${GRADE.base}).`)
  const fimConteudo = y

  // Elemento gráfico (decisões de 14/10): só a letra-chave do campo "Elemento"
  // (1 ou 2 letras; número nunca vira elemento) e nunca no card de frase. A
  // caixa é fixa e depende só da letra: caixa do glifo na fonte com 440 px de
  // altura, borda direita em x = 984 e base em y = 1230 (no V, a tinta
  // desenhada ocupa x 524..929, y 790..1229), a mesma em todos os slides da
  // peça. Se o texto do slide invadir a caixa (com folga de 24 px) ou ela não
  // couber inteira na área, o elemento é omitido nesse slide: nunca é
  // reduzido, deslocado nem cortado.
  const elementoTxt = (input.elemento ?? '').trim()
  const pedido = !cardDeFrase && /^[A-Za-zÀ-ÖØ-öø-ÿ]{1,2}$/.test(elementoTxt)
  let elemento: { texto: string; altura: number } | null = null
  const ef = fonts[TEXT_ROLES.title.file]
  if (pedido && ef && ef.contorno) {
    const ref = ef.contorno(elementoTxt, 1000, 0, 0)
    const size = 1000 * GRADE.elemento.altura / (ref.y2 - ref.y1)
    const p = ef.contorno(elementoTxt, size, 0, 0)
    const dx = GRADE.margem + GRADE.largura - p.x2, dy = GRADE.base - p.y2
    const fin = ef.contorno(elementoTxt, size, dx, dy)
    const textos = items.flatMap(it => (it.kind === 'text' ? it.lines : []))
    const f = GRADE.elemento.folga
    const inteiro = fin.x1 >= GRADE.margem && fin.x2 <= GRADE.margem + GRADE.largura + 0.5
      && fin.y1 >= GRADE.cabecalho && fin.y2 <= GRADE.base + 0.5
    const invadida = textos.some(l => l.x < fin.x2 + f && l.x + l.w > fin.x1 - f && l.y < fin.y2 + f && l.y + l.h > fin.y1 - f)
    if (inteiro && !invadida) {
      items.unshift({
        kind: 'elemento', d: fin.d, color: 'link', opacity: GRADE.elemento.opacidade,
        x: Math.floor(fin.x1), y: Math.floor(fin.y1), w: Math.ceil(fin.x2 - fin.x1), h: Math.ceil(fin.y2 - fin.y1),
      })
      elemento = { texto: elementoTxt, altura: Math.round(fin.y2 - fin.y1) }
    }
  }

  return {
    template: input.template, formato: 'grade', items,
    block: { x: GRADE.margem, y: topoBloco, w: GRADE.largura, h: fimConteudo - topoBloco },
    sizes,
    grade: {
      conteudoTopo: topoBloco, elemento, ...(pedido && !elemento ? { elementoOmitido: elementoTxt } : {}),
      // Cabeçalho (DM Sans 500, 24 px, nome com espaçamento 0,08 em) e rodapé
      // (DM Sans 22 px) com as palavras na posição exata, como o corpo.
      cromo: {
        nome: palavrasDe(fonte(fonts, 'label'), 'CAPITAL HUMANO INTELLIGENCE', 24, 0.08),
        ...(input.total > 1 ? { contador: palavrasDe(fonte(fonts, 'label'), `${String(input.indice).padStart(2, '0')} / ${String(input.total).padStart(2, '0')}`, 24) } : {}),
        autora: palavrasDe(fonte(fonts, 'label'), 'Daniela Matos', 22),
        slogan: palavrasDe(fonte(fonts, 'body'), 'Gente, Cultura & Estratégia', 22),
      },
    },
  }
}
