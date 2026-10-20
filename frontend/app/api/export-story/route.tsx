/**
 * app/api/export-story/route.tsx
 *
 * Gera o PNG de um story do Instagram (1080x1920) com next/og, pelo mesmo
 * caminho dos cards: fontes e medição de lib/ogServer.ts, layout com a fonte
 * real em lib/storyLayout.ts, desenho em components/storyTemplates.tsx.
 * Não publica nada: só devolve a imagem para baixar.
 *
 * Corpo (JSON):
 *   { tipo: 'moldura', imagem: dataURL PNG/JPG, imgW, imgH }
 *   { tipo: 'empresa', modelo: 1 | 2 | 3 }
 *   { tipo: 'capa', icone: 'vagas' | 'empresas' }
 * Erros de encaixe (texto que não cabe) voltam 422 com a mensagem.
 */

import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { CardLayoutError } from '../../../lib/cardLayout'
import { imageFonts, loadAllFonts, loadLogo, loadMeasureFonts } from '../../../lib/ogServer'
import { STORY, checkStorySafe, layoutCapa, layoutEmpresa, layoutMoldura, type StoryLayout } from '../../../lib/storyLayout'
import { StoryImage } from '../../../components/storyTemplates'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const MAX_IMAGE_CHARS = 8 * 1024 * 1024 // ~6 MB de imagem em base64

function fail(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      tipo?: string; modelo?: number; icone?: string
      imagem?: string; imgW?: number; imgH?: number
      /** só fora de produção: devolve as caixas no header X-Story-Layout */
      _debug?: boolean
      /** só fora de produção: desenha só o fundo (verificação de tinta) */
      _soFundo?: boolean
      /** só fora de produção: desenha só o fundo e a arte (isola a tinta da arte) */
      _soImagem?: boolean
    }
    const debugAllowed = process.env.NODE_ENV !== 'production'

    const [fonts, logoSrc, measure] = await Promise.all([
      loadAllFonts(request.url), loadLogo(request.url), loadMeasureFonts(request.url),
    ])

    let layout: StoryLayout
    let imageSrc: string | null = null
    if (body.tipo === 'moldura') {
      const img = body.imagem || ''
      if (!/^data:image\/(png|jpe?g);base64,/.test(img)) return fail(400, 'Envie a imagem do card da vaga em PNG ou JPG.')
      if (img.length > MAX_IMAGE_CHARS) return fail(413, 'Imagem grande demais. Use um arquivo de até 6 MB.')
      const imgW = Number(body.imgW), imgH = Number(body.imgH)
      if (!(imgW > 0 && imgH > 0)) return fail(400, 'Dimensões da imagem ausentes.')
      layout = layoutMoldura(measure, { imgW, imgH })
      imageSrc = img
    } else if (body.tipo === 'empresa') {
      const m = Number(body.modelo)
      if (m !== 1 && m !== 2 && m !== 3) return fail(400, 'Modelo inválido (1, 2 ou 3).')
      layout = layoutEmpresa(measure, m)
    } else if (body.tipo === 'capa') {
      if (body.icone !== 'vagas' && body.icone !== 'empresas') return fail(400, 'Capa inválida (vagas ou empresas).')
      layout = layoutCapa(body.icone)
    } else {
      return fail(400, 'Tipo de story inválido.')
    }

    const problems = checkStorySafe(layout)
    if (problems.length) return fail(422, problems.join('; '))

    const headers: Record<string, string> = debugAllowed && body._debug
      ? { 'X-Story-Layout': encodeURIComponent(JSON.stringify({ story: STORY, layout, problems })) }
      : {}

    return new ImageResponse(
      <StoryImage layout={layout} logoSrc={logoSrc} imageSrc={imageSrc} hideAll={debugAllowed && body._soFundo === true} onlyImage={debugAllowed && body._soImagem === true} />,
      { width: STORY.width, height: STORY.height, headers, fonts: [...imageFonts(fonts)] },
    )
  } catch (err) {
    const isLayout = err instanceof CardLayoutError
    if (!isLayout) console.error('[export-story] Erro:', err)
    return fail(isLayout ? 422 : 500, err instanceof Error ? err.message : 'Falha ao gerar o story.')
  }
}
