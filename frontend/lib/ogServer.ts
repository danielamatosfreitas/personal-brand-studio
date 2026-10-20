/**
 * lib/ogServer.ts
 *
 * Fontes, medição e logo das imagens geradas no servidor (next/og), usados
 * por /api/export-card (cards e cenas de Reel) e /api/export-story (stories).
 * É a ÚNICA lista de fontes registradas no ImageResponse: a trava de fonte
 * (scripts/regressao-visual/check-fonts.mjs) lê este arquivo e confere todas
 * as combinações usadas nos templates dos cards e dos stories contra ele.
 *
 * Fontes: arquivos estáticos próprios em public/fonts/, buscados por fetch
 * same-origin. Cada peso/estilo tem seu próprio arquivo, sem síntese.
 */

import { parse as parseFont } from 'opentype.js'
import { MEASURE_FILES, measurerFromFont, type MeasureFonts } from './cardLayout'

// ─── Fontes (cache por instância quente) ──────────────────────────────────────

const fontCache: Record<string, ArrayBuffer> = {}

async function loadLocalFont(requestUrl: string, filename: string): Promise<ArrayBuffer> {
  if (fontCache[filename]) return fontCache[filename]
  const origin = new URL(requestUrl).origin
  const res = await fetch(`${origin}/fonts/${filename}`)
  if (!res.ok) throw new Error(`Fonte não encontrada: /fonts/${filename}`)
  const data = await res.arrayBuffer()
  fontCache[filename] = data
  return data
}

export interface LoadedFonts {
  eb500: ArrayBuffer; eb500i: ArrayBuffer; eb600: ArrayBuffer; eb700: ArrayBuffer
  dm400: ArrayBuffer; dm500: ArrayBuffer
}

let fontsReady: LoadedFonts | null = null

export async function loadAllFonts(requestUrl: string): Promise<LoadedFonts> {
  if (fontsReady) return fontsReady
  const [eb500, eb500i, eb600, eb700, dm400, dm500] = await Promise.all([
    loadLocalFont(requestUrl, 'EBGaramond-Medium.ttf'),       // manifesto da Ideia
    loadLocalFont(requestUrl, 'EBGaramond-MediumItalic.ttf'), // subtítulo e resolução
    loadLocalFont(requestUrl, 'EBGaramond-SemiBold.ttf'),     // título e número do slide
    loadLocalFont(requestUrl, 'EBGaramond-Bold.ttf'),         // badge "CH" da marca sem logo
    loadLocalFont(requestUrl, 'DMSans-400.ttf'),              // corpo e rodapé
    loadLocalFont(requestUrl, 'DMSans-500.ttf'),              // etiqueta, marca, lista
  ])
  fontsReady = { eb500, eb500i, eb600, eb700, dm400, dm500 }
  return fontsReady
}

/** Lista passada ao ImageResponse. */
export function imageFonts(fonts: LoadedFonts) {
  return [
    { name: 'EB Garamond', data: fonts.eb500,  weight: 500, style: 'normal' },
    { name: 'EB Garamond', data: fonts.eb500i, weight: 500, style: 'italic' },
    { name: 'EB Garamond', data: fonts.eb600,  weight: 600, style: 'normal' },
    { name: 'EB Garamond', data: fonts.eb700,  weight: 700, style: 'normal' },
    { name: 'DM Sans',   data: fonts.dm400,   weight: 400, style: 'normal' },
    { name: 'DM Sans',   data: fonts.dm500,   weight: 500, style: 'normal' },
  ] as const
}

// Fontes parseadas (opentype.js) pra medição -- os mesmos arquivos acima.
const measureFonts: MeasureFonts = {}

export async function loadMeasureFonts(requestUrl: string): Promise<MeasureFonts> {
  await Promise.all(MEASURE_FILES.map(async file => {
    if (!measureFonts[file]) measureFonts[file] = measurerFromFont(parseFont(await loadLocalFont(requestUrl, file)))
  }))
  return measureFonts
}

// ─── Logo (fetch do próprio domínio → base64) ─────────────────────────────────

export async function loadLogo(requestUrl: string): Promise<string | null> {
  try {
    const origin = new URL(requestUrl).origin
    const res = await fetch(`${origin}/images/logo.jpg`)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    // Converte em chunks para evitar estouro de stack em imagens grandes
    let binary = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.slice(i, i + chunk)))
    }
    return `data:image/jpeg;base64,${btoa(binary)}`
  } catch {
    return null // sem logo → usa badge "CH"
  }
}
