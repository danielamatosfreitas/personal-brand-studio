'use client'

/**
 * Ferramenta de desenvolvimento -- NÃO faz parte do fluxo do produto.
 * Renderiza o SlideCanvas real do caminho CLIENTE (CardGenerator.tsx)
 * isolado, sem AuthGate, em 1080x1080. Usado por scripts/regressao-visual/
 * pra tirar screenshot do lado cliente e comparar com o PNG do lado
 * servidor (/api/export-card) depois de qualquer mudança de fonte/layout.
 *
 * Só existe em desenvolvimento -- 404 em produção (guarda abaixo). Não faz
 * nenhuma chamada de rede: recebe título/corpo/família só pela querystring e
 * renderiza o componente puro, sem tocar API, Supabase ou dado de usuário.
 *
 * Uso: /dev-preview-slide?family=alerta&title=...&body=...&index=1&total=1
 *      &ideiaTone=verde&variant=carousel&isCover=0&label=...
 */

import { notFound, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'
import { SlideCanvas, type FamilyKey } from '../../components/CardGenerator'

// Mede quantas linhas cada bloco de texto do card ocupou de verdade no DOM
// (Range.getClientRects() -- um retângulo por linha visual), em vez de
// estimar por projeção de pixel na imagem final. Só é possível no lado
// cliente, que roda num DOM real; o lado servidor (Satori) não expõe isso,
// por isso o script de regressão só mede este lado.
function useLineCountDebug() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const countLines = (el: Element): number => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = range.getClientRects()
      // agrupa rects por posição vertical (arredondada) -- cada linha real
      // pode gerar mais de um rect (ex.: texto com span de cor diferente)
      const tops = new Set(Array.from(rects).map(r => Math.round(r.top)))
      return tops.size
    }

    // título/corpo em todos os templates usam display:flex + flexWrap:wrap
    // pra quebrar linha -- é a assinatura que identifica esses blocos sem
    // precisar mexer no componente de produção pra marcar cada um.
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('div, span'))
      .filter(el => {
        const cs = getComputedStyle(el)
        return cs.display === 'flex' && cs.flexWrap === 'wrap' && (el.textContent || '').trim().length > 0
      })

    const result = candidates.map((el, i) => ({
      index: i,
      fontSize: getComputedStyle(el).fontSize,
      lines: countLines(el),
      textStart: (el.textContent || '').slice(0, 24),
    }))

    const debugEl = document.createElement('pre')
    debugEl.id = '__line_debug__'
    debugEl.style.cssText = 'position:fixed;top:0;left:0;font-size:1px;color:transparent;white-space:pre;pointer-events:none;'
    debugEl.textContent = JSON.stringify(result)
    document.body.appendChild(debugEl)
    return () => { debugEl.remove() }
  }, [])

  return rootRef
}

function Inner() {
  const params = useSearchParams()
  const title = params.get('title') || ''
  const body = params.get('body') || ''
  const label = params.get('label') || undefined
  const family = (params.get('family') || 'diagnostico') as FamilyKey
  const variant = (params.get('variant') || 'carousel') as 'carousel' | 'quote'
  const ideiaTone = (params.get('ideiaTone') || 'verde') as 'verde' | 'terracota'
  const index = Number(params.get('index') || '1')
  const total = Number(params.get('total') || '1')
  const isCover = params.get('isCover') === '1'
  const rootRef = useLineCountDebug()

  return (
    <div ref={rootRef} style={{ width: '1080px', height: '1080px', margin: 0, padding: 0 }}>
      <SlideCanvas
        slide={{ index, total, isCover, title, body, label }}
        variant={variant}
        logo={null}
        family={family}
        ideiaTone={ideiaTone}
      />
    </div>
  )
}

export default function DevPreviewSlide() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  )
}
