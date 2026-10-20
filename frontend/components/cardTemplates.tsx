/**
 * components/cardTemplates.tsx
 *
 * Template único dos cards, renderizado igual pelo servidor (Satori, em
 * app/api/export-card/route.tsx) e pelo cliente (preview em
 * components/CardGenerator.tsx). Não decide nada de layout: só desenha, em
 * posição absoluta, as caixas que lib/cardLayout.ts calculou com a fonte
 * real -- uma div por linha, sem quebra automática, pra que os dois motores
 * mostrem exatamente as mesmas linhas nos mesmos lugares.
 *
 * Restrições do Satori respeitadas aqui: toda div com mais de um filho tem
 * display:flex, e nenhuma propriedade de estilo recebe `undefined` explícito
 * (o Satori trava com "Cannot read properties of undefined (reading 'trim')").
 */

import {
  FRAMES, PAD_X, SAFE_W, TEXT_ROLES,
  type CardLayout, type ColorKey, type LaidItem, type LaidWords,
} from '../lib/cardLayout'
import { hexA, type FamilyPalette } from '../lib/cardPalette'

function colorOf(colors: FamilyPalette, key: ColorKey): string {
  return key === 'text' ? colors.text : key === 'muted' ? colors.muted : key === 'accent' ? colors.accent
    : key === 'link' ? colors.link : key === 'suave' ? hexA(colors.text, 0.8) : colors.accentContrast
}

// Formato grade: cada palavra na posição calculada pela fonte (com kerning).
// O Satori reserva para cada palavra a soma das letras soltas, sem kerning,
// mas desenha a palavra com kerning; a sobra ia para o vão seguinte. Aqui a
// palavra é desenhada sozinha no ponto exato: nas linhas do conteúdo, numa
// caixa da altura da linha; no cabeçalho e no rodapé, com a altura natural,
// centrada na faixa pelo próprio motor (a mesma altura de antes).
type Estilo = Record<string, string | number>
function palavrasAbs(palavras: { t: string; dx: number }[], h: number | null, estilo: Estilo, key: string) {
  return palavras.map((p, i) => (
    <span key={`${key}-${i}`} style={{
      // parte inteira na posição e a fração por deslocamento (o Satori
      // arredonda a posição para o pixel inteiro, o deslocamento não)
      ...estilo, position: 'absolute', left: `${Math.floor(p.dx)}px`,
      ...(h === null ? {} : { top: '0px', height: `${h}px` }),
      ...(p.dx % 1 ? { transform: `translateX(${Math.round((p.dx % 1) * 100) / 100}px)` } : {}),
      display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
    }}>{p.t}</span>
  ))
}
function Palavras({ p, h, estilo }: { p: LaidWords; h: number; estilo: Estilo }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: `${p.w}px`, height: `${h}px` }}>
      {palavrasAbs(p.palavras, null, estilo, 'p')}
    </div>
  )
}

function BrandMark({ logoSrc, colors, size }: { logoSrc: string | null; colors: FamilyPalette; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      {logoSrc ? (
        <img
          src={logoSrc}
          alt=""
          width={size}
          height={size}
          style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        <div style={{
          width: `${size}px`, height: `${size}px`, backgroundColor: colors.accent, borderRadius: '4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'EB Garamond', fontWeight: 700, fontSize: '11px', color: '#fff' }}>CH</span>
        </div>
      )}
      <span style={{
        fontFamily: 'DM Sans', fontWeight: 500, fontSize: '13px', letterSpacing: '0.08em', color: colors.muted,
      }}>
        CAPITAL HUMANO INTELLIGENCE
      </span>
    </div>
  )
}

function renderItem(item: LaidItem, colors: FamilyPalette, key: string, frame: { width: number; height: number }) {
  if (item.kind === 'elemento') {
    // Grade editorial: o número ou a letra grande, em contorno, atrás do texto.
    return (
      <svg key={key} width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`}
        style={{ position: 'absolute', left: '0px', top: '0px' }}>
        <path d={item.d} fill={colorOf(colors, item.color)} fillOpacity={item.opacity} />
      </svg>
    )
  }
  if (item.kind === 'rule') {
    return (
      <div key={key} style={{
        position: 'absolute', left: `${item.x}px`, top: `${item.y}px`,
        width: `${item.w}px`, height: `${item.h}px`, backgroundColor: colorOf(colors, item.color),
      }} />
    )
  }
  if (item.kind === 'pills') {
    return item.pills.map((p, i) => (
      <div key={`${key}-${i}`} style={{
        position: 'absolute', left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${colors.line}`, borderRadius: '999px', boxSizing: 'border-box',
        fontFamily: TEXT_ROLES.pill.fontFamily, fontWeight: TEXT_ROLES.pill.fontWeight, fontStyle: TEXT_ROLES.pill.fontStyle,
        fontSize: `${item.fontSize}px`, lineHeight: `${item.lineHeight}px`, color: colors.text, whiteSpace: 'nowrap',
      }}>
        {p.text}
      </div>
    ))
  }
  const role = TEXT_ROLES[item.role]
  const color = colorOf(colors, item.color)
  return item.lines.map((line, i) => line.palavras ? (
    <div key={`${key}-${i}`} style={{
      position: 'absolute', left: `${line.x}px`, top: `${line.y}px`, width: `${line.w}px`, height: `${line.h}px`, display: 'flex',
    }}>
      {palavrasAbs(line.palavras, line.h, {
        fontFamily: role.fontFamily, fontWeight: role.fontWeight, fontStyle: role.fontStyle,
        fontSize: `${item.fontSize}px`, lineHeight: `${line.h}px`, color,
        ...(item.letterSpacingEm ? { letterSpacing: `${item.letterSpacingEm}em` } : {}),
      }, `${key}-${i}`)}
    </div>
  ) : (
    <div key={`${key}-${i}`} style={{
      position: 'absolute', left: `${line.x}px`, top: `${line.y}px`, height: `${line.h}px`,
      display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
      fontFamily: role.fontFamily, fontWeight: role.fontWeight, fontStyle: role.fontStyle,
      fontSize: `${item.fontSize}px`, lineHeight: `${line.h}px`, color,
      ...(item.letterSpacingEm ? { letterSpacing: `${item.letterSpacingEm}em` } : {}),
    }}>
      {line.text}
    </div>
  ))
}

export interface CardImageProps {
  layout: CardLayout
  colors: FamilyPalette
  index: number
  total: number
  logoSrc: string | null
  /** Só desenha fundo, cabeçalho e rodapé (usado pelo lote pra isolar a
   *  tinta do bloco numa comparação pixel a pixel). */
  hideBlock?: boolean
  /** Só desenha o fundo (usado pelo gerador de Reel pra isolar a tinta do
   *  cabeçalho e do rodapé e conferir que ficam fora da interface da rede). */
  hideChrome?: boolean
}

export function CardImage({ layout, colors, index, total, logoSrc, hideBlock, hideChrome }: CardImageProps) {
  const t = layout.template
  const frame = FRAMES[layout.formato || 'quadrado']
  const grade = layout.formato === 'grade'
  const cromo = layout.grade?.cromo
  const showCounter = t !== 'ideia' && total > 1
  const bgImage =
    t === 'capa' ? `radial-gradient(circle at 85% 12%, ${hexA(colors.accent, 0.12)}, transparent 45%)`
      : t === 'ideia' ? `radial-gradient(circle at 15% 88%, ${hexA(colors.accent, 0.10)}, transparent 50%)`
        : null

  return (
    <div style={{
      width: `${frame.width}px`, height: `${frame.height}px`, position: 'relative', display: 'flex', overflow: 'hidden',
      backgroundColor: colors.bg,
      ...(bgImage ? { backgroundImage: bgImage } : {}),
    }}>
      {hideChrome ? null : grade ? (
        // Grade editorial: logo de 80 px na margem de 96 px, nome em 24 px e o
        // número do slide à direita, em 24 px, no dourado claro.
        <div style={{
          position: 'absolute', left: '96px', top: `${frame.headerTop}px`, width: '888px', height: `${frame.headerH}px`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {logoSrc ? (
              <img src={logoSrc} alt="" width={80} height={80}
                style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: colors.accent }} />
            )}
            {cromo ? (
              <Palavras p={cromo.nome} h={frame.headerH} estilo={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '24px', letterSpacing: '0.08em', color: hexA(colors.text, 0.8) }} />
            ) : (
              <span style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '24px', letterSpacing: '0.08em', color: hexA(colors.text, 0.8) }}>
                CAPITAL HUMANO INTELLIGENCE
              </span>
            )}
          </div>
          {total > 1 ? (cromo && cromo.contador ? (
            <Palavras p={cromo.contador} h={frame.headerH} estilo={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '24px', color: colors.link }} />
          ) : (
            <span style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '24px', color: colors.link }}>
              {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </span>
          )) : null}
        </div>
      ) : <div style={{
        position: 'absolute', left: `${PAD_X}px`, top: `${frame.headerTop}px`, width: `${SAFE_W}px`, height: `${frame.headerH}px`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <BrandMark logoSrc={logoSrc} colors={colors} size={t === 'capa' || t === 'ideia' ? 36 : 28} />
        {showCounter ? (
          <span style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '14px', color: colors.muted }}>
            {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        ) : null}
      </div>}

      {hideBlock || hideChrome ? null : layout.items.flatMap((item, i) => {
        const el = renderItem(item, colors, `i${i}`, frame)
        return Array.isArray(el) ? el : [el]
      })}

      {hideChrome ? null : grade ? (
        // Grade editorial: rodapé em DM Sans 22 px, creme a 80%, na faixa de
        // 1230 a 1350. No card de frase, só o slogan (a assinatura "por Daniela
        // Matos" já aparece abaixo da frase).
        <div style={{
          position: 'absolute', left: '96px', top: `${frame.footerTop}px`, width: '888px', height: `${frame.footerH}px`,
          display: 'flex', alignItems: 'center', justifyContent: total === 1 && t === 'ideia' ? 'flex-end' : 'space-between',
        }}>
          {total === 1 && t === 'ideia' ? null : cromo ? (
            <Palavras p={cromo.autora} h={frame.footerH} estilo={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '22px', color: hexA(colors.text, 0.8) }} />
          ) : (
            <span style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '22px', color: hexA(colors.text, 0.8) }}>Daniela Matos</span>
          )}
          {cromo ? (
            <Palavras p={cromo.slogan} h={frame.footerH} estilo={{ fontFamily: 'DM Sans', fontWeight: 400, fontSize: '22px', color: hexA(colors.text, 0.8) }} />
          ) : (
            <span style={{ fontFamily: 'DM Sans', fontWeight: 400, fontSize: '22px', color: hexA(colors.text, 0.8) }}>Gente, Cultura & Estratégia</span>
          )}
        </div>
      ) : <div style={{
        position: 'absolute', left: `${PAD_X}px`, top: `${frame.footerTop}px`, width: `${SAFE_W}px`, height: `${frame.footerH}px`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '14px', color: colors.muted }}>Daniela Matos</span>
        <span style={{ fontFamily: 'DM Sans', fontWeight: 400, fontSize: '13px', color: colors.muted }}>Gente, Cultura & Estratégia</span>
      </div>}
    </div>
  )
}
